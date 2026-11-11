import type { Pool } from './db.js';
import { UserError } from './errors.js';
import { LIMITS } from './limits.js';
import { requireUuid } from './text.js';

interface Queryable {
  query: Pool['query'];
}

export interface AttachmentView {
  id: string;
  filename: string;
  mime_type: string;
  size: number;
}

/**
 * A bot may read a file when it uploaded it, when the file is on a direct message it sent or received,
 * or when the file is on a post in a room it is a member of now.
 */
export const FILE_ACCESS_SQL = `(
  f.owner_bot_id = $2
  OR EXISTS (
    SELECT 1 FROM message_attachments ma
    JOIN messages m ON m.id = ma.message_id
    WHERE ma.file_id = f.id AND (m.from_bot_id = $2 OR m.to_bot_id = $2)
  )
  OR EXISTS (
    SELECT 1 FROM room_post_attachments ra
    JOIN room_posts p ON p.id = ra.post_id
    JOIN room_members rm ON rm.room_id = p.room_id AND rm.bot_id = $2
    WHERE ra.file_id = f.id
  )
)`;

/** Validate ids and check the actor can read every file. Returns ids in the order given, deduplicated. */
export async function resolveAttachments(db: Queryable, actorId: string, raw: readonly string[] | null | undefined): Promise<AttachmentView[]> {
  if (!raw || raw.length === 0) return [];
  const ids = [...new Set(raw.map((id) => requireUuid(id, 'attachment id')))];
  if (ids.length > LIMITS.attachmentsPerMessage) {
    throw new UserError(`Attach at most ${LIMITS.attachmentsPerMessage} files.`);
  }
  const result = await db.query<{ id: string; filename: string; mime_type: string; size_bytes: string; status: string }>(
    `SELECT f.id, f.filename, f.mime_type, f.size_bytes, f.status
     FROM files f
     WHERE f.id::text = ANY($1::text[]) AND ${FILE_ACCESS_SQL}`,
    [ids, actorId],
  );
  const byId = new Map(result.rows.map((row) => [row.id, row]));
  return ids.map((id) => {
    const row = byId.get(id);
    if (!row) throw new UserError(`File ${id} not found.`);
    if (row.status !== 'ready') throw new UserError(`File ${id} is not uploaded yet. Call complete_upload first.`);
    return { id: row.id, filename: row.filename, mime_type: row.mime_type, size: Number(row.size_bytes) };
  });
}

export async function insertAttachments(
  db: Queryable,
  table: 'message_attachments' | 'room_post_attachments',
  parentId: string,
  files: readonly AttachmentView[],
): Promise<void> {
  const column = table === 'message_attachments' ? 'message_id' : 'post_id';
  for (const [position, file] of files.entries()) {
    await db.query(`INSERT INTO ${table} (${column}, file_id, position) VALUES ($1, $2, $3)`, [parentId, file.id, position]);
  }
}

export async function loadAttachments(
  db: Queryable,
  table: 'message_attachments' | 'room_post_attachments',
  parentIds: readonly string[],
): Promise<Map<string, AttachmentView[]>> {
  const map = new Map<string, AttachmentView[]>();
  if (parentIds.length === 0) return map;
  const column = table === 'message_attachments' ? 'message_id' : 'post_id';
  const result = await db.query<{ parent_id: string; id: string; filename: string; mime_type: string; size_bytes: string }>(
    `SELECT a.${column} AS parent_id, f.id, f.filename, f.mime_type, f.size_bytes
     FROM ${table} a JOIN files f ON f.id = a.file_id
     WHERE a.${column}::text = ANY($1::text[])
     ORDER BY a.position`,
    [parentIds],
  );
  for (const row of result.rows) {
    const list = map.get(row.parent_id) ?? [];
    list.push({ id: row.id, filename: row.filename, mime_type: row.mime_type, size: Number(row.size_bytes) });
    map.set(row.parent_id, list);
  }
  return map;
}

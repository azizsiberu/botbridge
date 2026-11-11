import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { FILE_ACCESS_SQL } from './attachments.js';
import type { Config, FileConfig } from './config.js';
import type { Pool } from './db.js';
import { UserError } from './errors.js';
import type { FileStorage } from './storage.js';
import { writeAudit, type Actor } from './store.js';
import { requireUuid } from './text.js';

export interface FileView {
  id: string;
  filename: string;
  mime_type: string;
  size: number;
  sha256: string | null;
  status: 'pending' | 'ready';
  owner: { id: string; name: string };
  created_at: string;
}

interface FileRow {
  id: string;
  owner_bot_id: string;
  owner_name: string;
  filename: string;
  mime_type: string;
  size_bytes: string;
  sha256: string | null;
  storage: 'db' | 's3';
  storage_key: string;
  status: 'pending' | 'ready';
  created_at: Date;
}

const FILE_SELECT = `
  SELECT f.id, f.owner_bot_id, owner.name AS owner_name, f.filename, f.mime_type, f.size_bytes, f.sha256,
         f.storage, f.storage_key, f.status, f.created_at
  FROM files f
  JOIN bots owner ON owner.id = f.owner_bot_id
`;

function fileView(row: FileRow): FileView {
  return {
    id: row.id,
    filename: row.filename,
    mime_type: row.mime_type,
    size: Number(row.size_bytes),
    sha256: row.sha256,
    status: row.status,
    owner: { id: row.owner_bot_id, name: row.owner_name },
    created_at: row.created_at.toISOString(),
  };
}

export interface FileDeps {
  pool: Pool;
  config: Config;
  storage: FileStorage;
}

export function normalizeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!cleaned || cleaned === '.' || cleaned === '..') throw new UserError('filename is required.');
  if (cleaned.length > 255) throw new UserError('filename must be at most 255 characters.');
  return cleaned;
}

export function normalizeMimeType(raw: string, files: Pick<FileConfig, 'allowedTypes'>): string {
  const base = raw.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(base)) {
    throw new UserError('mime_type must look like type/subtype, for example application/pdf.');
  }
  const family = `${base.split('/')[0]}/*`;
  const allowed = files.allowedTypes.some((type) => type === '*/*' || type === base || type === family);
  if (!allowed) throw new UserError(`Files of type ${base} are not allowed on this bridge.`);
  return base;
}

function decodeBase64(raw: string, maxBytes: number): Buffer {
  const compact = raw.replace(/\s+/g, '');
  if (compact.length > Math.ceil(maxBytes / 3) * 4 + 4) {
    throw new UserError(`File is larger than the ${maxBytes} byte limit.`);
  }
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(compact)) throw new UserError('content_base64 is not valid base64.');
  const data = Buffer.from(compact, 'base64');
  if (data.length === 0) throw new UserError('File is empty.');
  if (data.length > maxBytes) throw new UserError(`File is larger than the ${maxBytes} byte limit.`);
  return data;
}

export async function uploadFile(
  deps: FileDeps,
  actor: Actor,
  input: { filename: string; mimeType: string; contentBase64: string },
): Promise<FileView> {
  const { pool, config, storage } = deps;
  const filename = normalizeFilename(input.filename);
  const mimeType = normalizeMimeType(input.mimeType, config.files);
  const data = decodeBase64(input.contentBase64, config.files.maxBytes);
  const sha256 = createHash('sha256').update(data).digest('hex');
  const id = randomUUID();
  const key = `files/${id}`;
  await storage.put(key, data, mimeType);
  try {
    await pool.query(
      `INSERT INTO files (id, owner_bot_id, filename, mime_type, size_bytes, sha256, storage, storage_key, status, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ready', now())`,
      [id, actor.id, filename, mimeType, data.length, sha256, storage.kind, key],
    );
  } catch (error) {
    await storage.remove(key).catch(() => undefined);
    throw error;
  }
  await writeAudit(pool, {
    actorId: actor.id,
    action: 'file.uploaded',
    resourceType: 'file',
    resourceId: id,
    detail: { via: 'inline', mime_type: mimeType, size: data.length, storage: storage.kind },
  });
  return requireOwnFile(pool, actor, id);
}

export async function createUpload(
  deps: FileDeps,
  actor: Actor,
  input: { filename: string; mimeType: string; size: number },
): Promise<{ file: FileView; upload: { url: string; method: 'PUT'; headers: Record<string, string>; expires_at: string } }> {
  const { pool, config, storage } = deps;
  if (!storage.presignedUploads) {
    throw new UserError('This bridge stores files in Postgres, so direct uploads are off. Use upload_file with base64 content.');
  }
  const filename = normalizeFilename(input.filename);
  const mimeType = normalizeMimeType(input.mimeType, config.files);
  if (!Number.isInteger(input.size) || input.size < 1) throw new UserError('size must be a positive integer.');
  if (input.size > config.files.maxBytes) throw new UserError(`File is larger than the ${config.files.maxBytes} byte limit.`);
  const id = randomUUID();
  const key = `files/${id}`;
  const ttl = config.files.urlTtlSeconds;
  const url = storage.presignPut(key, mimeType, ttl);
  if (!url) throw new UserError('Direct uploads are not available on this bridge.');
  await pool.query(
    `INSERT INTO files (id, owner_bot_id, filename, mime_type, size_bytes, storage, storage_key, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')`,
    [id, actor.id, filename, mimeType, input.size, storage.kind, key],
  );
  await writeAudit(pool, {
    actorId: actor.id,
    action: 'file.upload_started',
    resourceType: 'file',
    resourceId: id,
    detail: { via: 'presigned', mime_type: mimeType, size: input.size, storage: storage.kind },
  });
  return {
    file: await requireOwnFile(pool, actor, id),
    upload: {
      url,
      method: 'PUT',
      headers: { 'content-type': mimeType },
      expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
    },
  };
}

export async function completeUpload(deps: FileDeps, actor: Actor, fileId: string): Promise<FileView> {
  const { pool, config, storage } = deps;
  const id = requireUuid(fileId, 'file_id');
  const result = await pool.query<FileRow>(`${FILE_SELECT} WHERE f.id = $1 AND f.owner_bot_id = $2`, [id, actor.id]);
  const row = result.rows[0];
  if (!row) throw new UserError('File not found.');
  if (row.status === 'ready') return fileView(row);
  const size = await storage.head(row.storage_key);
  if (size === null) throw new UserError('No bytes have been uploaded for this file yet. PUT them to the upload URL first.');
  if (size > config.files.maxBytes || size < 1) {
    await storage.remove(row.storage_key).catch(() => undefined);
    await pool.query(`DELETE FROM files WHERE id = $1`, [id]);
    await writeAudit(pool, {
      actorId: actor.id,
      action: 'file.upload_rejected',
      resourceType: 'file',
      resourceId: id,
      detail: { size, max: config.files.maxBytes },
    });
    throw new UserError(`The uploaded object is ${size} bytes, outside the 1–${config.files.maxBytes} byte limit. It was deleted.`);
  }
  await pool.query(
    `UPDATE files SET status = 'ready', size_bytes = $2, completed_at = now() WHERE id = $1 AND status = 'pending'`,
    [id, size],
  );
  await writeAudit(pool, {
    actorId: actor.id,
    action: 'file.uploaded',
    resourceType: 'file',
    resourceId: id,
    detail: { via: 'presigned', mime_type: row.mime_type, size, storage: row.storage },
  });
  return requireOwnFile(pool, actor, id);
}

async function requireOwnFile(pool: Pool, actor: Actor, id: string): Promise<FileView> {
  const result = await pool.query<FileRow>(`${FILE_SELECT} WHERE f.id = $1 AND f.owner_bot_id = $2`, [id, actor.id]);
  const row = result.rows[0];
  if (!row) throw new Error('file disappeared after insert');
  return fileView(row);
}

async function readableFile(pool: Pool, actor: Actor, fileId: string): Promise<FileRow> {
  const id = requireUuid(fileId, 'file_id');
  const result = await pool.query<FileRow>(`${FILE_SELECT} WHERE f.id = $1 AND f.status = 'ready' AND ${FILE_ACCESS_SQL}`, [id, actor.id]);
  const row = result.rows[0];
  if (!row) throw new UserError('File not found.');
  return row;
}

export async function getFile(
  deps: FileDeps,
  actor: Actor,
  input: { fileId: string; as: 'url' | 'content' },
): Promise<Record<string, unknown>> {
  const { pool, config, storage } = deps;
  const row = await readableFile(pool, actor, input.fileId);
  const file = fileView(row);
  if (input.as === 'content') {
    const data = await storage.get(row.storage_key);
    if (!data) throw new UserError('The file bytes are missing from storage.');
    await writeAudit(pool, {
      actorId: actor.id,
      action: 'file.downloaded',
      targetId: row.owner_bot_id,
      resourceType: 'file',
      resourceId: row.id,
      detail: { via: 'content', size: data.length },
    });
    return { file, content_base64: data.toString('base64') };
  }
  const ttl = config.files.urlTtlSeconds;
  const expiresAt = Math.floor(Date.now() / 1000) + ttl;
  const url =
    storage.presignGet(row.storage_key, row.filename, row.mime_type, ttl) ??
    localDownloadUrl(config, { fileId: row.id, botId: actor.id, exp: expiresAt });
  await writeAudit(pool, {
    actorId: actor.id,
    action: 'file.download_url',
    targetId: row.owner_bot_id,
    resourceType: 'file',
    resourceId: row.id,
    detail: { via: storage.kind === 's3' ? 's3_presigned' : 'signed_link', ttl_seconds: ttl },
  });
  return { file, url, expires_at: new Date(expiresAt * 1000).toISOString() };
}

function linkKey(secret: string): Buffer {
  return createHmac('sha256', secret).update('botbridge-file-link-v1').digest();
}

function linkSignature(secret: string, fileId: string, botId: string, exp: number): string {
  return createHmac('sha256', linkKey(secret)).update(`GET\n${fileId}\n${botId}\n${exp}`).digest('base64url');
}

/** A short-lived link to /files/<id> on this server, for the db backend. Bound to one bot and one file. */
export function localDownloadUrl(config: Config, input: { fileId: string; botId: string; exp: number }): string {
  const sig = linkSignature(config.secret, input.fileId, input.botId, input.exp);
  const query = new URLSearchParams({ b: input.botId, exp: String(input.exp), sig });
  return `${config.publicUrl ?? ''}/files/${input.fileId}?${query.toString()}`;
}

export function verifyLocalDownload(
  config: Config,
  input: { fileId: string; botId: string; exp: string; sig: string },
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const exp = Number(input.exp);
  if (!Number.isInteger(exp) || exp < nowSeconds) return false;
  if (exp > nowSeconds + config.files.urlTtlSeconds + 60) return false;
  const expected = Buffer.from(linkSignature(config.secret, input.fileId, input.botId, exp));
  const presented = Buffer.from(input.sig);
  return expected.length === presented.length && timingSafeEqual(expected, presented);
}

/** For the HTTP route. Rechecks that the bot still has access when the link is used. */
export async function fileForLink(
  deps: FileDeps,
  fileId: string,
  botId: string,
): Promise<{ row: FileRow; data: Buffer } | null> {
  const result = await deps.pool.query<FileRow>(
    `${FILE_SELECT} WHERE f.id = $1 AND f.status = 'ready' AND ${FILE_ACCESS_SQL}
       AND EXISTS (SELECT 1 FROM bots b WHERE b.id = $2 AND b.revoked_at IS NULL)`,
    [fileId, botId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const data = await deps.storage.get(row.storage_key);
  if (!data) return null;
  await writeAudit(deps.pool, {
    actorId: botId,
    action: 'file.downloaded',
    targetId: row.owner_bot_id,
    resourceType: 'file',
    resourceId: row.id,
    detail: { via: 'signed_link', size: data.length },
  });
  return { row, data };
}

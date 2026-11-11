import { randomUUID } from 'node:crypto';
import { insertAttachments, loadAttachments, resolveAttachments, type AttachmentView } from './attachments.js';
import type { Pool, PoolClient } from './db.js';
import { UserError, isUniqueViolation } from './errors.js';
import { LIMITS } from './limits.js';
import { parseMentions, takeMentionSlot } from './mentions.js';
import { canReach } from './tenancy.js';
import {
  BOT_FROM,
  BOT_SELECT,
  enqueueDoorbell,
  findActive,
  toActor,
  withTx,
  writeAudit,
  type Actor,
  type BotRecord,
} from './store.js';
import { isUuid, preview, requireText } from './text.js';

const ROOM_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;

export interface RoomRef {
  id: string;
  name: string;
}

export interface RoomSummary extends RoomRef {
  created_by: { id: string; name: string };
  created_at: string;
  members: Array<{ id: string; name: string }>;
  unread: number;
  last_post_at: string | null;
}

export interface RoomPostView {
  id: string;
  room: RoomRef;
  from: { id: string; name: string };
  text: string;
  mentions: string[];
  mentioned_you: boolean;
  attachments: AttachmentView[];
  created_at: string;
}

function normalizeRoomName(raw: string): string {
  const name = raw.trim().toLowerCase().replace(/^#/, '');
  if (!ROOM_NAME_RE.test(name)) {
    throw new UserError('Room name must be 1–63 characters: lowercase letters, digits, underscores, or hyphens, starting with a letter or digit.');
  }
  return name;
}

interface Queryable {
  query: Pool['query'];
}

/** A room the actor belongs to, by name or id. Non-members get the same answer as a missing room. */
async function memberRoom(db: Queryable, actor: Actor, ref: string): Promise<RoomRef & { last_read_seq: number }> {
  const raw = ref.trim();
  const byId = isUuid(raw);
  const name = byId ? null : normalizeRoomName(raw);
  const result = await db.query<{ id: string; name: string; last_read_seq: string }>(
    `SELECT r.id, r.name, rm.last_read_seq
     FROM rooms r
     JOIN room_members rm ON rm.room_id = r.id AND rm.bot_id = $1
     WHERE ($2::uuid IS NOT NULL AND r.id = $2) OR ($3::text IS NOT NULL AND r.name = $3)
     LIMIT 1`,
    [actor.id, byId ? raw.toLowerCase() : null, name],
  );
  const row = result.rows[0];
  if (!row) throw new UserError(`Room "${raw}" not found, or you are not a member.`);
  return { id: row.id, name: row.name, last_read_seq: Number(row.last_read_seq) };
}

async function activeMembers(db: Queryable, roomId: string): Promise<BotRecord[]> {
  const result = await db.query<BotRecord>(
    `SELECT ${BOT_SELECT} ${BOT_FROM}
     JOIN room_members rm ON rm.bot_id = b.id AND rm.room_id = $1
     WHERE b.revoked_at IS NULL
     ORDER BY b.name`,
    [roomId],
  );
  return result.rows;
}

/** Each newcomer must be reachable from every current member, the same rule send_message uses. */
async function resolveNewcomers(pool: Pool, actor: Actor, names: readonly string[], current: BotRecord[]): Promise<{ add: BotRecord[]; already: string[] }> {
  const currentIds = new Set(current.map((bot) => bot.id));
  const add: BotRecord[] = [];
  const already: string[] = [];
  for (const raw of names) {
    const bot = await findActive(pool, raw);
    if (!bot) throw new UserError(`No active bot matches "${raw}".`);
    if (currentIds.has(bot.id)) {
      if (bot.id !== actor.id && !already.includes(bot.name)) already.push(bot.name);
      continue;
    }
    if (add.some((item) => item.id === bot.id)) continue;
    add.push(bot);
  }
  if (current.length + add.length > LIMITS.roomMembers) {
    throw new UserError(`A room can have at most ${LIMITS.roomMembers} members.`);
  }
  const everyone = [...current, ...add];
  for (const newcomer of add) {
    const asActor = toActor(newcomer);
    for (const other of everyone) {
      if (other.id === newcomer.id) continue;
      if (!(await canReach(pool, asActor, other))) {
        throw new UserError(
          `"${newcomer.name}" cannot join: it has no approved connection with "${other.name}". Every member of a room must be able to reach every other member.`,
        );
      }
    }
  }
  return { add, already };
}

async function addMembers(client: PoolClient, actor: Actor, room: RoomRef, bots: BotRecord[]): Promise<void> {
  const seq = await client.query<{ seq: string | null }>(`SELECT max(seq) AS seq FROM room_posts WHERE room_id = $1`, [room.id]);
  const lastSeq = seq.rows[0]?.seq ?? '0';
  for (const bot of bots) {
    await client.query(
      `INSERT INTO room_members (room_id, bot_id, invited_by_bot_id, last_read_seq)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (room_id, bot_id) DO NOTHING`,
      [room.id, bot.id, bot.id === actor.id ? null : actor.id, bot.id === actor.id ? 0 : lastSeq],
    );
    if (bot.id === actor.id) continue;
    await enqueueDoorbell(client, bot, {
      type: 'room.invited',
      from: { id: actor.id, name: actor.name },
      resource: { type: 'room', id: room.id },
      thread_id: null,
      room,
      preview: `${actor.name} added you to #${room.name}`,
    });
  }
}

export async function createRoom(pool: Pool, actor: Actor, input: { name: string; members: readonly string[] }): Promise<RoomSummary> {
  const name = normalizeRoomName(input.name);
  const self = await findActive(pool, actor.id);
  if (!self) throw new UserError('Your bot is not active.');
  const { add } = await resolveNewcomers(pool, actor, input.members, [self]);
  const room: RoomRef = { id: randomUUID(), name };
  try {
    await withTx(pool, async (client) => {
      await client.query(`INSERT INTO rooms (id, name, created_by_bot_id) VALUES ($1, $2, $3)`, [room.id, name, actor.id]);
      await addMembers(client, actor, room, [self, ...add]);
      await writeAudit(client, {
        actorId: actor.id,
        action: 'room.created',
        resourceType: 'room',
        resourceId: room.id,
        detail: { name, members: add.map((bot) => bot.name) },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new UserError(`A room named "${name}" already exists. Pick another name.`);
    throw error;
  }
  return requireSummary(pool, actor, room.id);
}

export async function inviteToRoom(
  pool: Pool,
  actor: Actor,
  input: { room: string; members: readonly string[] },
): Promise<{ room: RoomSummary; added: string[]; already_members: string[] }> {
  const room = await memberRoom(pool, actor, input.room);
  const current = await activeMembers(pool, room.id);
  const { add, already } = await resolveNewcomers(pool, actor, input.members, current);
  if (add.length > 0) {
    await withTx(pool, async (client) => {
      await addMembers(client, actor, room, add);
      await writeAudit(client, {
        actorId: actor.id,
        action: 'room.invited',
        resourceType: 'room',
        resourceId: room.id,
        detail: { members: add.map((bot) => bot.name) },
      });
    });
  }
  return { room: await requireSummary(pool, actor, room.id), added: add.map((bot) => bot.name), already_members: already };
}

export async function leaveRoom(pool: Pool, actor: Actor, ref: string): Promise<{ left: RoomRef }> {
  const room = await memberRoom(pool, actor, ref);
  await withTx(pool, async (client) => {
    await client.query(`DELETE FROM room_members WHERE room_id = $1 AND bot_id = $2`, [room.id, actor.id]);
    await writeAudit(client, {
      actorId: actor.id,
      action: 'room.left',
      resourceType: 'room',
      resourceId: room.id,
      detail: { name: room.name },
    });
  });
  return { left: { id: room.id, name: room.name } };
}

export async function listRooms(pool: Pool, actor: Actor, roomId?: string): Promise<RoomSummary[]> {
  const result = await pool.query<{
    id: string;
    name: string;
    created_at: Date;
    creator_id: string;
    creator_name: string;
    unread: string;
    last_post_at: Date | null;
  }>(
    `SELECT r.id, r.name, r.created_at, creator.id AS creator_id, creator.name AS creator_name,
            (SELECT count(*) FROM room_posts p WHERE p.room_id = r.id AND p.seq > rm.last_read_seq) AS unread,
            (SELECT max(p.created_at) FROM room_posts p WHERE p.room_id = r.id) AS last_post_at
     FROM rooms r
     JOIN room_members rm ON rm.room_id = r.id AND rm.bot_id = $1
     JOIN bots creator ON creator.id = r.created_by_bot_id
     WHERE ($2::uuid IS NULL OR r.id = $2)
     ORDER BY r.name`,
    [actor.id, roomId ?? null],
  );
  const ids = result.rows.map((row) => row.id);
  const members = await pool.query<{ room_id: string; id: string; name: string }>(
    `SELECT rm.room_id, b.id, b.name
     FROM room_members rm JOIN bots b ON b.id = rm.bot_id
     WHERE rm.room_id::text = ANY($1::text[]) AND b.revoked_at IS NULL
     ORDER BY b.name`,
    [ids],
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    created_by: { id: row.creator_id, name: row.creator_name },
    created_at: row.created_at.toISOString(),
    members: members.rows.filter((member) => member.room_id === row.id).map((member) => ({ id: member.id, name: member.name })),
    unread: Number(row.unread),
    last_post_at: row.last_post_at ? row.last_post_at.toISOString() : null,
  }));
}

async function requireSummary(pool: Pool, actor: Actor, roomId: string): Promise<RoomSummary> {
  const [summary] = await listRooms(pool, actor, roomId);
  if (!summary) throw new Error('room disappeared');
  return summary;
}

export interface PostResult {
  post: RoomPostView;
  mentions: { notified: string[]; throttled: string[]; unreachable: string[]; not_in_room: string[] };
}

export async function postRoom(
  pool: Pool,
  actor: Actor,
  input: { room: string; text: string; attachments?: readonly string[] | null; mentionLimitPerMinute: number },
): Promise<PostResult> {
  const text = requireText(input.text, LIMITS.roomPostChars, 'Post');
  const room = await memberRoom(pool, actor, input.room);
  const files = await resolveAttachments(pool, actor.id, input.attachments);
  const names = parseMentions(text).filter((name) => name !== actor.name);
  const members = await activeMembers(pool, room.id);
  const mentioned = members.filter((bot) => bot.id !== actor.id && names.includes(bot.name));
  const notInRoom = names.filter((name) => !mentioned.some((bot) => bot.name === name));
  const reachable: BotRecord[] = [];
  for (const bot of mentioned) {
    if (await canReach(pool, actor, bot)) reachable.push(bot);
  }
  const id = randomUUID();
  const notified: string[] = [];
  const throttled: string[] = [];
  const unreachable: string[] = [];
  await withTx(pool, async (client) => {
    const inserted = await client.query<{ seq: string }>(
      `INSERT INTO room_posts (id, room_id, from_bot_id, body, mentions)
       VALUES ($1, $2, $3, $4, $5::uuid[])
       RETURNING seq`,
      [id, room.id, actor.id, text, mentioned.map((bot) => bot.id)],
    );
    const seq = inserted.rows[0]?.seq;
    // Your own post is never unread for you.
    await client.query(
      `UPDATE room_members SET last_read_seq = GREATEST(last_read_seq, $3) WHERE room_id = $1 AND bot_id = $2`,
      [room.id, actor.id, seq],
    );
    await insertAttachments(client, 'room_post_attachments', id, files);
    for (const bot of mentioned) {
      if (!reachable.includes(bot)) {
        unreachable.push(bot.name);
        continue;
      }
      if (!(await takeMentionSlot(client, bot.id, room.id, input.mentionLimitPerMinute))) {
        throttled.push(bot.name);
        continue;
      }
      await enqueueDoorbell(client, bot, {
        type: 'room.mention',
        from: { id: actor.id, name: actor.name },
        resource: { type: 'room_post', id },
        thread_id: null,
        room: { id: room.id, name: room.name },
        preview: preview(text),
        mentioned: true,
        ...(files.length > 0 ? { attachments: files.length } : {}),
      });
      notified.push(bot.name);
    }
    await writeAudit(client, {
      actorId: actor.id,
      action: 'room.posted',
      resourceType: 'room_post',
      resourceId: id,
      detail: {
        room_id: room.id,
        chars: text.length,
        preview: preview(text, 120),
        ...(mentioned.length > 0 ? { mentions: mentioned.map((bot) => bot.name), throttled } : {}),
        ...(files.length > 0 ? { attachments: files.map((file) => file.id) } : {}),
      },
    });
  });
  const [post] = await loadPosts(pool, actor, room, { ids: [id] });
  if (!post) throw new Error('post disappeared after insert');
  return { post, mentions: { notified, throttled, unreachable, not_in_room: notInRoom } };
}

async function loadPosts(
  db: Queryable,
  actor: Actor,
  room: RoomRef,
  where: { ids?: string[]; afterSeq?: number; since?: Date; limit?: number; newest?: boolean },
): Promise<Array<RoomPostView & { seq: number }>> {
  const limit = where.limit ?? LIMITS.roomReadMax;
  const result = await db.query<{
    id: string;
    seq: string;
    body: string;
    created_at: Date;
    from_id: string;
    from_name: string;
    mention_names: string[] | null;
    mentioned_you: boolean;
  }>(
    `SELECT * FROM (
       SELECT p.id, p.seq, p.body, p.created_at, sender.id AS from_id, sender.name AS from_name,
              (SELECT array_agg(b.name ORDER BY b.name) FROM bots b WHERE b.id = ANY(p.mentions)) AS mention_names,
              ($2::uuid = ANY(p.mentions)) AS mentioned_you
       FROM room_posts p
       JOIN bots sender ON sender.id = p.from_bot_id
       WHERE p.room_id = $1
         AND ($3::text[] IS NULL OR p.id::text = ANY($3::text[]))
         AND ($4::bigint IS NULL OR p.seq > $4)
         AND ($5::timestamptz IS NULL OR p.created_at > $5)
       ORDER BY p.seq ${where.newest ? 'DESC' : 'ASC'}
       LIMIT $6
     ) page
     ORDER BY seq ASC`,
    [room.id, actor.id, where.ids ?? null, where.afterSeq ?? null, where.since ?? null, limit],
  );
  const attachments = await loadAttachments(db, 'room_post_attachments', result.rows.map((row) => row.id));
  return result.rows.map((row) => ({
    id: row.id,
    seq: Number(row.seq),
    room: { id: room.id, name: room.name },
    from: { id: row.from_id, name: row.from_name },
    text: row.body,
    mentions: row.mention_names ?? [],
    mentioned_you: row.mentioned_you,
    attachments: attachments.get(row.id) ?? [],
    created_at: row.created_at.toISOString(),
  }));
}

export async function readRoom(
  pool: Pool,
  actor: Actor,
  input: { room: string; since?: string | null; limit?: number; unreadOnly?: boolean; markRead?: boolean },
): Promise<{ room: RoomRef; posts: RoomPostView[]; unread_remaining: number }> {
  const limit = input.limit ?? LIMITS.roomReadDefault;
  if (!Number.isInteger(limit) || limit < 1 || limit > LIMITS.roomReadMax) {
    throw new UserError(`limit must be an integer from 1 to ${LIMITS.roomReadMax}.`);
  }
  const room = await memberRoom(pool, actor, input.room);
  let afterSeq: number | undefined;
  let since: Date | undefined;
  const sinceRaw = input.since?.trim();
  if (sinceRaw) {
    if (isUuid(sinceRaw)) {
      const cursor = await pool.query<{ seq: string }>(`SELECT seq FROM room_posts WHERE id = $1 AND room_id = $2`, [
        sinceRaw.toLowerCase(),
        room.id,
      ]);
      const seq = cursor.rows[0]?.seq;
      if (!seq) throw new UserError('since post not found in this room.');
      afterSeq = Number(seq);
    } else {
      const parsed = new Date(sinceRaw);
      if (Number.isNaN(parsed.getTime())) throw new UserError('since must be a post id or an ISO 8601 timestamp.');
      since = parsed;
    }
  }
  if (input.unreadOnly) afterSeq = Math.max(afterSeq ?? 0, room.last_read_seq);
  const newest = afterSeq === undefined && since === undefined;
  const posts = await loadPosts(pool, actor, room, { afterSeq, since, limit, newest });
  const maxSeq = posts.reduce((max, post) => Math.max(max, post.seq), 0);
  if (input.markRead !== false && maxSeq > room.last_read_seq) {
    await pool.query(
      `UPDATE room_members SET last_read_seq = GREATEST(last_read_seq, $3) WHERE room_id = $1 AND bot_id = $2`,
      [room.id, actor.id, maxSeq],
    );
  }
  const readTo = input.markRead !== false ? Math.max(room.last_read_seq, maxSeq) : room.last_read_seq;
  const remaining = await pool.query<{ count: string }>(
    `SELECT count(*) FROM room_posts WHERE room_id = $1 AND seq > $2`,
    [room.id, readTo],
  );
  return {
    room: { id: room.id, name: room.name },
    posts: posts.map(({ seq: _seq, ...post }) => post),
    unread_remaining: Number(remaining.rows[0]?.count ?? 0),
  };
}

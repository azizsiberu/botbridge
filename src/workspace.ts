import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { guard } from './admin-routes.js';
import type { AdminAuth, ClerkDirectory } from './identity.js';
import {
  actorById,
  consumeRate,
  directory,
  sendMessage,
  broadcast,
  ackMessages,
  listTasks,
  postTask,
  getTask,
  completeTask,
  type Actor,
} from './store.js';
import { listRooms, createRoom, readRoom, postRoom, inviteToRoom, leaveRoom } from './rooms.js';
import { uploadFile, createUpload, completeUpload, getFile, type FileDeps } from './files.js';
import { loadAttachments } from './attachments.js';
import { UserError } from './errors.js';
import { LIMITS } from './limits.js';

const id = z.string().uuid();
const name = z.string().trim().min(1);
const files = z.array(id).max(LIMITS.attachmentsPerMessage).optional();
const memberList = z.array(name).max(LIMITS.roomMembers);
type Dependencies = FileDeps & { adminAuth: AdminAuth; directory: ClerkDirectory | null };

export function workspaceRouter(deps: Dependencies) {
  const { pool, config } = deps;
  const router = Router({ mergeParams: true });
  router.use(async (req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    const account = await guard(deps, req, res);
    if (!account) return;
    const actor = await actorById(pool, id.parse(req.params.botId));
    if (!actor || actor.ownerUserId !== account.id) {
      res.status(403).json({ message: 'Choose an active bot owned by your account.' });
      return;
    }
    const limit = await consumeRate(pool, actor.id, config.rateLimitPerMinute, 1);
    if (!limit.ok) {
      res
        .set('Retry-After', String(limit.retryAfterSeconds))
        .status(429)
        .json({ message: 'Rate limit reached. Try again in a minute.' });
      return;
    }
    res.locals.actor = actor;
    next();
  });
  type Action = (actor: Actor, req: Request) => Promise<unknown>;
  function endpoint(method: 'get' | 'post', path: string, action: Action) {
    router[method](path, async (req, res) => {
      res.json(await action(res.locals.actor, req));
    });
  }
  async function conversations(actor: Actor) {
    return (
      await pool.query(
        `SELECT DISTINCT ON (thread_id,peer.id) thread_id AS id, peer.name, peer.id AS peer_id,
        m.created_at, count(*) FILTER (WHERE to_bot_id=$1 AND read_at IS NULL) OVER (PARTITION BY thread_id,peer.id)::int AS unread
      FROM messages m JOIN bots peer ON peer.id=CASE WHEN from_bot_id=$1 THEN to_bot_id ELSE from_bot_id END
      WHERE from_bot_id=$1 OR to_bot_id=$1 ORDER BY thread_id,peer.id,m.created_at DESC`,
        [actor.id],
      )
    ).rows.sort((a, b) => b.created_at - a.created_at);
  }
  endpoint('get', '/directory', (actor) => directory(pool, actor));
  endpoint('get', '/summary', async (actor) => {
    const [messages, rooms, tasks] = await Promise.all([
      conversations(actor),
      listRooms(pool, actor),
      listTasks(pool, actor, { role: 'any', limit: LIMITS.inboxMax }),
    ]);
    return {
      messages,
      rooms: rooms.map(({ id, name, unread, last_post_at, created_at }) => ({
        id,
        name,
        unread,
        created_at: last_post_at ?? created_at,
      })),
      tasks: tasks.map(({ id, from, to, status, created_at, completed_at }) => ({
        id,
        from,
        to,
        status,
        created_at: completed_at ?? created_at,
      })),
    };
  });
  endpoint('get', '/messages', conversations);
  endpoint('get', '/threads/:id', async (actor, req) => {
    const rows = (
      await pool.query(
        `SELECT m.id,m.kind,m.body AS text,m.created_at,m.read_at,
        json_build_object('id',s.id,'name',s.name) AS "from",json_build_object('id',r.id,'name',r.name) AS "to"
        FROM messages m JOIN bots s ON s.id=m.from_bot_id JOIN bots r ON r.id=m.to_bot_id
        WHERE m.thread_id=$1 AND ((s.id=$2 AND r.id=$3) OR (r.id=$2 AND s.id=$3)) ORDER BY m.created_at,m.id`,
        [id.parse(req.params.id), actor.id, id.parse(req.query.peer)],
      )
    ).rows;
    if (!rows.length) throw new UserError('Conversation unavailable.');
    const attachments = await loadAttachments(
      pool,
      'message_attachments',
      rows.map((row) => row.id),
    );
    return rows.map((row) => ({ ...row, attachments: attachments.get(row.id) ?? [] }));
  });
  endpoint('post', '/messages', async (actor, req) => {
    const body = z.object({ to: id, text: name, threadId: id.optional(), attachments: files }).parse(req.body);
    if (body.threadId) {
      const pair = await pool.query(
        'SELECT 1 FROM messages WHERE thread_id=$1 AND ((from_bot_id=$2 AND to_bot_id=$3) OR (to_bot_id=$2 AND from_bot_id=$3)) LIMIT 1',
        [body.threadId, actor.id, body.to],
      );
      if (!pair.rowCount) throw new UserError('Conversation unavailable.');
    }
    return sendMessage(pool, actor, body);
  });
  endpoint('post', '/ack', (actor, req) =>
    ackMessages(pool, actor, z.array(id).min(1).max(100).parse(req.body?.ids)),
  );
  endpoint('post', '/broadcast', (actor, req) => broadcast(pool, actor, name.parse(req.body?.text)));
  endpoint('get', '/rooms', (actor) => listRooms(pool, actor));
  endpoint('post', '/rooms', (actor, req) =>
    createRoom(pool, actor, z.object({ name, members: memberList }).parse(req.body)),
  );
  endpoint('get', '/rooms/:id', (actor, req) =>
    readRoom(pool, actor, { room: id.parse(req.params.id), markRead: false }),
  );
  endpoint('post', '/rooms/:id/read', (actor, req) =>
    readRoom(pool, actor, { room: id.parse(req.params.id), markRead: true }),
  );
  endpoint('post', '/rooms/:id/invite', (actor, req) =>
    inviteToRoom(pool, actor, {
      room: id.parse(req.params.id),
      members: memberList.min(1).parse(req.body?.members),
    }),
  );
  endpoint('post', '/rooms/:id/leave', (actor, req) => leaveRoom(pool, actor, id.parse(req.params.id)));
  endpoint('post', '/rooms/:id/posts', (actor, req) =>
    postRoom(pool, actor, {
      room: id.parse(req.params.id),
      ...z.object({ text: name, attachments: files }).parse(req.body),
      mentionLimitPerMinute: config.mentionDoorbellsPerMinute,
    }),
  );
  endpoint('get', '/tasks', (actor, req) =>
    listTasks(pool, actor, {
      role: z.enum(['any', 'inbox', 'outbox']).parse(req.query.role ?? 'any'),
      limit: LIMITS.inboxMax,
    }),
  );
  endpoint('get', '/tasks/:id', async (actor, req) => {
    const task = await getTask(pool, actor, id.parse(req.params.id));
    if (!task) throw new UserError('Task unavailable.');
    return task;
  });
  endpoint('post', '/tasks', (actor, req) =>
    postTask(pool, actor, z.object({ to: id, instructions: name }).parse(req.body)),
  );
  endpoint('post', '/tasks/:id/complete', (actor, req) =>
    completeTask(pool, actor, id.parse(req.params.id), name.parse(req.body?.result)),
  );
  endpoint('get', '/uploads', async () => ({
    direct: deps.storage.presignedUploads,
    maxBytes: config.files.maxBytes,
    allowedTypes: config.files.allowedTypes,
  }));
  endpoint('post', '/files', (actor, req) =>
    uploadFile(deps, actor, z.object({ filename: name, mimeType: name, contentBase64: name }).parse(req.body)),
  );
  endpoint('post', '/uploads', (actor, req) =>
    createUpload(
      deps,
      actor,
      z.object({ filename: name, mimeType: name, size: z.number().int().positive() }).parse(req.body),
    ),
  );
  endpoint('post', '/uploads/:id/complete', (actor, req) => completeUpload(deps, actor, id.parse(req.params.id)));
  endpoint('get', '/files/:id', (actor, req) =>
    getFile(deps, actor, { fileId: id.parse(req.params.id), as: 'url' }),
  );
  router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof UserError || err instanceof z.ZodError)
      res.status(400).json({ message: err instanceof UserError ? err.message : 'Invalid request.' });
    else next(err);
  });
  return router;
}

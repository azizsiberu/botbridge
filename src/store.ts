import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from './db.js';
import { encryptSecret, generateToken, generateWebhookSecret, hashToken, tokenPrefix } from './crypto.js';
import { UserError, isUniqueViolation } from './errors.js';
import { LIMITS } from './limits.js';
import { renderDoorbellBody, type DoorbellNotice } from './doorbell.js';
import {
  assertWebhookUrl,
  isUuid,
  normalizeCapabilities,
  normalizeDescription,
  normalizeName,
  normalizeProfile,
  preview,
  requireText,
  requireUuid,
  type WebhookProfile,
} from './text.js';

export interface PublicBot {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
}

export interface Actor {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  webhookConfigured: boolean;
  webhookProfile: WebhookProfile | null;
}

interface BotRecord extends PublicBot {
  webhook_url: string | null;
  webhook_secret_enc: string | null;
  webhook_profile: WebhookProfile | null;
  revoked_at: Date | null;
  token_prefix: string;
  created_at: Date;
}

interface Queryable {
  query: Pool['query'];
}

function publicBot(row: { id: string; name: string; description: string; capabilities: string[] }): PublicBot {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    capabilities: row.capabilities,
  };
}

async function writeAudit(
  db: Queryable,
  entry: {
    actorId: string | null;
    action: string;
    targetId?: string | null;
    resourceType: string;
    resourceId?: string | null;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (actor_bot_id, action, target_bot_id, resource_type, resource_id, detail)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      entry.actorId,
      entry.action,
      entry.targetId ?? null,
      entry.resourceType,
      entry.resourceId ?? null,
      JSON.stringify(entry.detail ?? {}),
    ],
  );
}

async function enqueueDoorbell(
  db: Queryable,
  recipient: BotRecord,
  notice: Omit<DoorbellNotice, 'id' | 'occurred_at' | 'bot'>,
): Promise<void> {
  if (!recipient.webhook_url || !recipient.webhook_profile || !recipient.webhook_secret_enc) return;
  const id = randomUUID();
  const full: DoorbellNotice = {
    id,
    occurred_at: new Date().toISOString(),
    bot: { id: recipient.id, name: recipient.name },
    ...notice,
  };
  await db.query(
    `INSERT INTO doorbell_jobs (id, bot_id, event, body)
     VALUES ($1, $2, $3, $4)`,
    [id, recipient.id, full.type, renderDoorbellBody(recipient.webhook_profile, full)],
  );
}

const BOT_COLUMNS = `id, name, description, capabilities, webhook_url, webhook_secret_enc, webhook_profile, revoked_at, token_prefix, created_at`;

async function findActive(db: Queryable, to: string): Promise<BotRecord | null> {
  if (isUuid(to)) {
    const byId = await db.query<BotRecord>(
      `SELECT ${BOT_COLUMNS} FROM bots WHERE id = $1 AND revoked_at IS NULL`,
      [to],
    );
    if (byId.rows[0]) return byId.rows[0];
  }
  const byName = await db.query<BotRecord>(
    `SELECT ${BOT_COLUMNS} FROM bots WHERE name = $1 AND revoked_at IS NULL`,
    [to.trim().toLowerCase()],
  );
  return byName.rows[0] ?? null;
}

export async function authenticateBot(pool: Pool, token: string): Promise<Actor | null> {
  if (!token.startsWith('bb_') || token.length < 20) return null;
  const result = await pool.query<BotRecord>(
    `SELECT ${BOT_COLUMNS} FROM bots WHERE token_hash = $1`,
    [hashToken(token)],
  );
  const row = result.rows[0];
  if (!row || row.revoked_at) return null;
  return {
    ...publicBot(row),
    webhookConfigured: row.webhook_url !== null,
    webhookProfile: row.webhook_profile,
  };
}

export async function addBot(
  pool: Pool,
  input: { name: string; description?: string; capabilities?: string[] | string },
): Promise<{ bot: PublicBot; token: string }> {
  const name = normalizeName(input.name);
  const description = normalizeDescription(input.description ?? '');
  const capabilities = normalizeCapabilities(input.capabilities ?? []);
  const token = generateToken();
  const id = randomUUID();
  try {
    await pool.query(
      `INSERT INTO bots (id, name, description, capabilities, token_hash, token_prefix)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, name, description, capabilities, hashToken(token), tokenPrefix(token)],
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw new UserError(`A bot named "${name}" already exists.`);
    throw error;
  }
  await writeAudit(pool, {
    actorId: id,
    action: 'bot.created',
    resourceType: 'bot',
    resourceId: id,
    detail: { name },
  });
  return { bot: { id, name, description, capabilities }, token };
}

export async function listBotsAdmin(pool: Pool): Promise<
  Array<{
    id: string;
    name: string;
    description: string;
    capabilities: string[];
    token_prefix: string;
    webhook_profile: string | null;
    webhook_url: string | null;
    revoked_at: string | null;
    created_at: string;
  }>
> {
  const result = await pool.query<BotRecord>(
    `SELECT ${BOT_COLUMNS} FROM bots ORDER BY revoked_at NULLS FIRST, name`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    capabilities: row.capabilities,
    token_prefix: row.token_prefix,
    webhook_profile: row.webhook_profile,
    webhook_url: row.webhook_url,
    revoked_at: row.revoked_at ? row.revoked_at.toISOString() : null,
    created_at: row.created_at.toISOString(),
  }));
}

export async function updateBot(
  pool: Pool,
  name: string,
  patch: { description?: string; capabilities?: string[] | string },
): Promise<PublicBot> {
  const normalized = normalizeName(name);
  const current = await findActive(pool, normalized);
  if (!current) throw new UserError(`No active bot named "${normalized}".`);
  const description = patch.description === undefined ? current.description : normalizeDescription(patch.description);
  const capabilities =
    patch.capabilities === undefined ? current.capabilities : normalizeCapabilities(patch.capabilities);
  await pool.query(`UPDATE bots SET description = $2, capabilities = $3 WHERE id = $1`, [
    current.id,
    description,
    capabilities,
  ]);
  return { id: current.id, name: current.name, description, capabilities };
}

export async function revokeBot(pool: Pool, name: string): Promise<void> {
  const normalized = normalizeName(name);
  const result = await pool.query<{ id: string }>(
    `UPDATE bots SET revoked_at = now() WHERE name = $1 AND revoked_at IS NULL RETURNING id`,
    [normalized],
  );
  const row = result.rows[0];
  if (!row) throw new UserError(`No active bot named "${normalized}".`);
  await writeAudit(pool, {
    actorId: row.id,
    action: 'bot.revoked',
    resourceType: 'bot',
    resourceId: row.id,
    detail: { name: normalized },
  });
}

export async function setWebhook(
  pool: Pool,
  masterSecret: string,
  input: { name: string; url: string; profile: string; secret?: string },
): Promise<{ secret: string; generated: boolean }> {
  const name = normalizeName(input.name);
  const bot = await findActive(pool, name);
  if (!bot) throw new UserError(`No active bot named "${name}".`);
  const profile = normalizeProfile(input.profile);
  const url = assertWebhookUrl(input.url);
  const generated = !input.secret;
  const secret = input.secret?.trim() || generateWebhookSecret();
  if (secret.length < 8 || secret.length > 512) {
    throw new UserError('Webhook secret must be 8–512 characters.');
  }
  await pool.query(
    `UPDATE bots
     SET webhook_url = $2, webhook_secret_enc = $3, webhook_profile = $4
     WHERE id = $1`,
    [bot.id, url, encryptSecret(secret, masterSecret), profile],
  );
  await writeAudit(pool, {
    actorId: bot.id,
    action: 'bot.webhook_set',
    resourceType: 'bot',
    resourceId: bot.id,
    detail: { profile },
  });
  return { secret, generated };
}

export async function clearWebhook(pool: Pool, name: string): Promise<void> {
  const normalized = normalizeName(name);
  const bot = await findActive(pool, normalized);
  if (!bot) throw new UserError(`No active bot named "${normalized}".`);
  await pool.query(
    `UPDATE bots
     SET webhook_url = NULL, webhook_secret_enc = NULL, webhook_profile = NULL
     WHERE id = $1`,
    [bot.id],
  );
}

export async function directory(pool: Pool): Promise<PublicBot[]> {
  const result = await pool.query<PublicBot>(
    `SELECT id, name, description, capabilities
     FROM bots WHERE revoked_at IS NULL ORDER BY name`,
  );
  return result.rows;
}

async function withTx<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await fn(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export interface SentMessage {
  id: string;
  thread_id: string;
  to: PublicBot;
  created_at: string;
}

export async function sendMessage(
  pool: Pool,
  actor: Actor,
  input: { to: string; text: string; threadId?: string | null },
): Promise<SentMessage> {
  const text = requireText(input.text, LIMITS.messageChars, 'Message');
  const recipient = await findActive(pool, input.to);
  if (!recipient) throw new UserError(`No active bot matches "${input.to}".`);
  const threadId = input.threadId ? requireUuid(input.threadId, 'thread_id') : randomUUID();
  const id = randomUUID();
  const createdAt = await withTx(pool, async (client) => {
    const inserted = await client.query<{ created_at: Date }>(
      `INSERT INTO messages (id, thread_id, from_bot_id, to_bot_id, kind, body)
       VALUES ($1, $2, $3, $4, 'direct', $5)
       RETURNING created_at`,
      [id, threadId, actor.id, recipient.id, text],
    );
    await writeAudit(client, {
      actorId: actor.id,
      action: 'message.sent',
      targetId: recipient.id,
      resourceType: 'message',
      resourceId: id,
      detail: { thread_id: threadId, chars: text.length, preview: preview(text, 120) },
    });
    await enqueueDoorbell(client, recipient, {
      type: 'message.created',
      from: { id: actor.id, name: actor.name },
      resource: { type: 'message', id },
      thread_id: threadId,
      preview: preview(text),
    });
    return inserted.rows[0]?.created_at;
  });
  if (!createdAt) throw new Error('insert did not return a row');
  return {
    id,
    thread_id: threadId,
    to: publicBot(recipient),
    created_at: createdAt.toISOString(),
  };
}

export async function broadcast(
  pool: Pool,
  actor: Actor,
  text: string,
): Promise<{ thread_id: string; recipients: PublicBot[]; messages: Array<{ id: string; to: string }> }> {
  const body = requireText(text, LIMITS.broadcastChars, 'Broadcast');
  const others = await pool.query<BotRecord>(
    `SELECT ${BOT_COLUMNS} FROM bots WHERE revoked_at IS NULL AND id <> $1 ORDER BY name`,
    [actor.id],
  );
  if (others.rows.length > LIMITS.broadcastRecipients) {
    throw new UserError(`Broadcast is limited to ${LIMITS.broadcastRecipients} other bots.`);
  }
  const threadId = randomUUID();
  const messages: Array<{ id: string; to: string }> = [];
  await withTx(pool, async (client) => {
    for (const recipient of others.rows) {
      const id = randomUUID();
      await client.query(
        `INSERT INTO messages (id, thread_id, from_bot_id, to_bot_id, kind, body)
         VALUES ($1, $2, $3, $4, 'broadcast', $5)`,
        [id, threadId, actor.id, recipient.id, body],
      );
      await enqueueDoorbell(client, recipient, {
        type: 'broadcast.created',
        from: { id: actor.id, name: actor.name },
        resource: { type: 'message', id },
        thread_id: threadId,
        preview: preview(body),
      });
      messages.push({ id, to: recipient.name });
    }
    await writeAudit(client, {
      actorId: actor.id,
      action: 'broadcast.sent',
      resourceType: 'thread',
      resourceId: threadId,
      detail: { recipients: messages.length, chars: body.length, preview: preview(body, 120) },
    });
  });
  return {
    thread_id: threadId,
    recipients: others.rows.map(publicBot),
    messages,
  };
}

export interface InboxMessage {
  id: string;
  thread_id: string;
  from: { id: string; name: string };
  kind: 'direct' | 'broadcast';
  text: string;
  created_at: string;
  read_at: string | null;
}

export async function readInbox(
  pool: Pool,
  actor: Actor,
  input: { unreadOnly?: boolean; limit?: number; threadId?: string | null },
): Promise<InboxMessage[]> {
  const limit = input.limit ?? LIMITS.inboxDefault;
  if (!Number.isInteger(limit) || limit < 1 || limit > LIMITS.inboxMax) {
    throw new UserError(`limit must be an integer from 1 to ${LIMITS.inboxMax}.`);
  }
  const threadId = input.threadId ? requireUuid(input.threadId, 'thread_id') : null;
  const result = await pool.query<{
    id: string;
    thread_id: string;
    from_id: string;
    from_name: string;
    kind: 'direct' | 'broadcast';
    body: string;
    created_at: Date;
    read_at: Date | null;
  }>(
    `SELECT m.id, m.thread_id, m.kind, m.body, m.created_at, m.read_at,
            sender.id AS from_id, sender.name AS from_name
     FROM messages m
     JOIN bots sender ON sender.id = m.from_bot_id
     WHERE m.to_bot_id = $1
       AND ($2::boolean = false OR m.read_at IS NULL)
       AND ($3::uuid IS NULL OR m.thread_id = $3)
     ORDER BY m.created_at DESC
     LIMIT $4`,
    [actor.id, input.unreadOnly === true, threadId, limit],
  );
  return result.rows.map((row) => ({
    id: row.id,
    thread_id: row.thread_id,
    from: { id: row.from_id, name: row.from_name },
    kind: row.kind,
    text: row.body,
    created_at: row.created_at.toISOString(),
    read_at: row.read_at ? row.read_at.toISOString() : null,
  }));
}

export async function ackMessages(
  pool: Pool,
  actor: Actor,
  ids: string[],
): Promise<{ acked: string[]; missing: string[] }> {
  const unique = [...new Set(ids.map((id) => requireUuid(id, 'message id')))];
  if (unique.length === 0) throw new UserError('Provide at least one message id.');
  if (unique.length > 100) throw new UserError('Ack at most 100 messages at a time.');
  const result = await pool.query<{ id: string }>(
    `UPDATE messages
     SET read_at = COALESCE(read_at, now())
     WHERE to_bot_id = $1 AND id::text = ANY($2::text[])
     RETURNING id`,
    [actor.id, unique],
  );
  const acked = result.rows.map((row) => row.id);
  const ackedSet = new Set(acked);
  await writeAudit(pool, {
    actorId: actor.id,
    action: 'message.ack',
    resourceType: 'message',
    detail: { acked: acked.length },
  });
  return { acked, missing: unique.filter((id) => !ackedSet.has(id)) };
}

export interface TaskView {
  id: string;
  from: { id: string; name: string };
  to: { id: string; name: string };
  instructions: string;
  status: 'open' | 'completed';
  result: string | null;
  created_at: string;
  completed_at: string | null;
}

interface TaskRow {
  id: string;
  from_id: string;
  from_name: string;
  to_id: string;
  to_name: string;
  instructions: string;
  status: 'open' | 'completed';
  result: string | null;
  created_at: Date;
  completed_at: Date | null;
}

function taskView(row: TaskRow): TaskView {
  return {
    id: row.id,
    from: { id: row.from_id, name: row.from_name },
    to: { id: row.to_id, name: row.to_name },
    instructions: row.instructions,
    status: row.status,
    result: row.result,
    created_at: row.created_at.toISOString(),
    completed_at: row.completed_at ? row.completed_at.toISOString() : null,
  };
}

const TASK_SELECT = `
  SELECT t.id, t.instructions, t.status, t.result, t.created_at, t.completed_at,
         author.id AS from_id, author.name AS from_name,
         assignee.id AS to_id, assignee.name AS to_name
  FROM tasks t
  JOIN bots author ON author.id = t.from_bot_id
  JOIN bots assignee ON assignee.id = t.to_bot_id
`;

export async function postTask(
  pool: Pool,
  actor: Actor,
  input: { to: string; instructions: string },
): Promise<TaskView> {
  const instructions = requireText(input.instructions, LIMITS.taskChars, 'Instructions');
  const recipient = await findActive(pool, input.to);
  if (!recipient) throw new UserError(`No active bot matches "${input.to}".`);
  const id = randomUUID();
  await withTx(pool, async (client) => {
    await client.query(
      `INSERT INTO tasks (id, from_bot_id, to_bot_id, instructions, status)
       VALUES ($1, $2, $3, $4, 'open')`,
      [id, actor.id, recipient.id, instructions],
    );
    await writeAudit(client, {
      actorId: actor.id,
      action: 'task.posted',
      targetId: recipient.id,
      resourceType: 'task',
      resourceId: id,
      detail: { chars: instructions.length, preview: preview(instructions, 120) },
    });
    await enqueueDoorbell(client, recipient, {
      type: 'task.created',
      from: { id: actor.id, name: actor.name },
      resource: { type: 'task', id },
      thread_id: null,
      preview: preview(instructions),
    });
  });
  const task = await getTask(pool, actor, id);
  if (!task) throw new Error('task disappeared after insert');
  return task;
}

export async function getTask(pool: Pool, actor: Actor, id: string): Promise<TaskView | null> {
  const taskId = requireUuid(id, 'task id');
  const result = await pool.query<TaskRow>(
    `${TASK_SELECT}
     WHERE t.id = $1 AND (t.from_bot_id = $2 OR t.to_bot_id = $2)`,
    [taskId, actor.id],
  );
  const row = result.rows[0];
  return row ? taskView(row) : null;
}

export async function listTasks(
  pool: Pool,
  actor: Actor,
  input: { role?: 'inbox' | 'outbox' | 'any'; status?: 'open' | 'completed'; limit?: number },
): Promise<TaskView[]> {
  const limit = input.limit ?? LIMITS.inboxDefault;
  if (!Number.isInteger(limit) || limit < 1 || limit > LIMITS.inboxMax) {
    throw new UserError(`limit must be an integer from 1 to ${LIMITS.inboxMax}.`);
  }
  const role = input.role ?? 'inbox';
  const result = await pool.query<TaskRow>(
    `${TASK_SELECT}
     WHERE (
       ($1 = 'inbox' AND t.to_bot_id = $2) OR
       ($1 = 'outbox' AND t.from_bot_id = $2) OR
       ($1 = 'any' AND (t.to_bot_id = $2 OR t.from_bot_id = $2))
     )
     AND ($3::text IS NULL OR t.status = $3)
     ORDER BY t.created_at DESC
     LIMIT $4`,
    [role, actor.id, input.status ?? null, limit],
  );
  return result.rows.map(taskView);
}

export async function completeTask(pool: Pool, actor: Actor, id: string, resultText: string): Promise<TaskView> {
  const taskId = requireUuid(id, 'task id');
  const result = requireText(resultText, LIMITS.resultChars, 'Result');
  const existing = await pool.query<{ from_bot_id: string; to_bot_id: string; status: string }>(
    `SELECT from_bot_id, to_bot_id, status FROM tasks WHERE id = $1`,
    [taskId],
  );
  const row = existing.rows[0];
  if (!row || (row.from_bot_id !== actor.id && row.to_bot_id !== actor.id)) {
    throw new UserError('Task not found.');
  }
  if (row.to_bot_id !== actor.id) throw new UserError('Only the assignee can complete this task.');
  if (row.status !== 'open') throw new UserError('This task is already completed.');

  await withTx(pool, async (client) => {
    const updated = await client.query(
      `UPDATE tasks
       SET status = 'completed', result = $2, completed_at = now()
       WHERE id = $1 AND to_bot_id = $3 AND status = 'open'`,
      [taskId, result, actor.id],
    );
    if ((updated.rowCount ?? 0) !== 1) throw new UserError('This task is already completed.');
    await writeAudit(client, {
      actorId: actor.id,
      action: 'task.completed',
      targetId: row.from_bot_id,
      resourceType: 'task',
      resourceId: taskId,
      detail: { chars: result.length, preview: preview(result, 120) },
    });
    const author = await client.query<BotRecord>(
      `SELECT ${BOT_COLUMNS} FROM bots WHERE id = $1 AND revoked_at IS NULL`,
      [row.from_bot_id],
    );
    const authorRow = author.rows[0];
    if (authorRow && authorRow.id !== actor.id) {
      await enqueueDoorbell(client, authorRow, {
        type: 'task.completed',
        from: { id: actor.id, name: actor.name },
        resource: { type: 'task', id: taskId },
        thread_id: null,
        preview: preview(result),
      });
    }
  });

  const task = await getTask(pool, actor, taskId);
  if (!task) throw new Error('task disappeared after completion');
  return task;
}

export async function consumeRate(
  pool: Pool,
  botId: string,
  limit: number,
  calls: number,
): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> {
  const result = await pool.query<{ hits: number }>(
    `INSERT INTO rate_windows (bot_id, window_start, hits)
     VALUES ($1, date_trunc('minute', now()), $2)
     ON CONFLICT (bot_id, window_start)
     DO UPDATE SET hits = rate_windows.hits + EXCLUDED.hits
     RETURNING hits`,
    [botId, calls],
  );
  const hits = result.rows[0]?.hits ?? calls;
  if (hits > limit) return { ok: false, retryAfterSeconds: 60 };
  return { ok: true };
}

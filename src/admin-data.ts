import type { Pool } from './db.js';
import { LIMITS } from './limits.js';
import type { Config } from './config.js';
import { VERSION } from './version.js';

export interface DayCount {
  day: string;
  count: number;
}

function fillDays(rows: DayCount[], days: number): DayCount[] {
  const byDay = new Map(rows.map((row) => [row.day, row.count]));
  const out: DayCount[] = [];
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  for (let i = 0; i < days; i += 1) {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + i);
    const key = day.toISOString().slice(0, 10);
    out.push({ day: key, count: byDay.get(key) ?? 0 });
  }
  return out;
}

async function messageSeries(pool: Pool, days: number, ownerUserId: string | null): Promise<DayCount[]> {
  const result = await pool.query<{ day: string; count: number }>(
    `SELECT to_char(date_trunc('day', m.created_at), 'YYYY-MM-DD') AS day, count(*)::int AS count
     FROM messages m
     JOIN bots sender ON sender.id = m.from_bot_id
     JOIN bots recipient ON recipient.id = m.to_bot_id
     WHERE m.created_at >= now() - make_interval(days => $1)
       AND ($2::uuid IS NULL OR sender.owner_user_id = $2 OR recipient.owner_user_id = $2)
     GROUP BY 1
     ORDER BY 1`,
    [days, ownerUserId],
  );
  return fillDays(result.rows, days);
}

async function taskSeries(pool: Pool, days: number, ownerUserId: string | null): Promise<DayCount[]> {
  const result = await pool.query<{ day: string; count: number }>(
    `SELECT to_char(date_trunc('day', t.created_at), 'YYYY-MM-DD') AS day, count(*)::int AS count
     FROM tasks t
     JOIN bots author ON author.id = t.from_bot_id
     JOIN bots assignee ON assignee.id = t.to_bot_id
     WHERE t.created_at >= now() - make_interval(days => $1)
       AND ($2::uuid IS NULL OR author.owner_user_id = $2 OR assignee.owner_user_id = $2)
     GROUP BY 1
     ORDER BY 1`,
    [days, ownerUserId],
  );
  return fillDays(result.rows, days);
}

export async function overview(pool: Pool, days: number, ownerUserId: string | null) {
  const [bots, messages, unread, tasks, doorbell, recent, mailSeries, workSeries] = await Promise.all([
    pool.query<{ active: number; revoked: number }>(
      `SELECT count(*) FILTER (WHERE revoked_at IS NULL)::int AS active,
              count(*) FILTER (WHERE revoked_at IS NOT NULL)::int AS revoked
       FROM bots
       WHERE ($1::uuid IS NULL OR owner_user_id = $1)`,
      [ownerUserId],
    ),
    pool.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM messages m
       JOIN bots sender ON sender.id = m.from_bot_id
       JOIN bots recipient ON recipient.id = m.to_bot_id
       WHERE ($1::uuid IS NULL OR sender.owner_user_id = $1 OR recipient.owner_user_id = $1)`,
      [ownerUserId],
    ),
    pool.query<{ unread: number }>(
      `SELECT count(*)::int AS unread FROM messages m
       JOIN bots recipient ON recipient.id = m.to_bot_id
       WHERE m.read_at IS NULL AND ($1::uuid IS NULL OR recipient.owner_user_id = $1)`,
      [ownerUserId],
    ),
    pool.query<{ open: number; completed: number }>(
      `SELECT count(*) FILTER (WHERE t.status = 'open')::int AS open,
              count(*) FILTER (WHERE t.status = 'completed')::int AS completed
       FROM tasks t
       JOIN bots author ON author.id = t.from_bot_id
       JOIN bots assignee ON assignee.id = t.to_bot_id
       WHERE ($1::uuid IS NULL OR author.owner_user_id = $1 OR assignee.owner_user_id = $1)`,
      [ownerUserId],
    ),
    pool.query<{ delivered: number; pending: number; failed: number }>(
      `SELECT count(*) FILTER (WHERE j.delivered_at IS NOT NULL)::int AS delivered,
              count(*) FILTER (WHERE j.delivered_at IS NULL AND j.attempts < j.max_attempts)::int AS pending,
              count(*) FILTER (WHERE j.delivered_at IS NULL AND j.attempts >= j.max_attempts)::int AS failed
       FROM doorbell_jobs j
       JOIN bots b ON b.id = j.bot_id
       WHERE ($1::uuid IS NULL OR b.owner_user_id = $1)`,
      [ownerUserId],
    ),
    pool.query(
      `SELECT a.id::text, a.created_at, a.action, a.resource_type, a.resource_id, a.detail,
              actor.name AS actor_name, target.name AS target_name
       FROM audit_log a
       LEFT JOIN bots actor ON actor.id = a.actor_bot_id
       LEFT JOIN bots target ON target.id = a.target_bot_id
       WHERE ($1::uuid IS NULL OR actor.owner_user_id = $1 OR target.owner_user_id = $1)
       ORDER BY a.id DESC
       LIMIT 12`,
      [ownerUserId],
    ),
    messageSeries(pool, days, ownerUserId),
    taskSeries(pool, days, ownerUserId),
  ]);

  return {
    bots: bots.rows[0] ?? { active: 0, revoked: 0 },
    messages: { total: messages.rows[0]?.total ?? 0, unread: unread.rows[0]?.unread ?? 0, series: mailSeries },
    tasks: {
      open: tasks.rows[0]?.open ?? 0,
      completed: tasks.rows[0]?.completed ?? 0,
      series: workSeries,
    },
    doorbell: doorbell.rows[0] ?? { delivered: 0, pending: 0, failed: 0 },
    recent: recent.rows.map(serializeAudit),
  };
}

export async function listAdminBots(pool: Pool, query: string, ownerUserId: string | null) {
  const result = await pool.query(
    `SELECT b.id, b.name, b.description, b.capabilities, b.token_prefix, b.webhook_url, b.webhook_profile,
            b.revoked_at, b.created_at, b.updated_at, u.display_name AS owner_name, u.id AS owner_id
     FROM bots b
     JOIN users u ON u.id = b.owner_user_id
     WHERE ($2::uuid IS NULL OR b.owner_user_id = $2)
       AND ($1 = '' OR b.name ILIKE '%' || $1 || '%' OR b.description ILIKE '%' || $1 || '%'
            OR u.display_name ILIKE '%' || $1 || '%')
     ORDER BY b.revoked_at NULLS FIRST, b.name`,
    [query, ownerUserId],
  );
  return result.rows.map(serializeBot);
}

export async function listAdminMessages(
  pool: Pool,
  filter: {
    from?: string;
    to?: string;
    thread?: string;
    unread?: boolean;
    after?: string;
    before?: string;
    q?: string;
    limit: number;
    offset: number;
    ownerUserId: string | null;
  },
) {
  const where = `
    WHERE ($1 = '' OR sender.name ILIKE '%' || $1 || '%')
      AND ($2 = '' OR recipient.name ILIKE '%' || $2 || '%')
      AND ($3::uuid IS NULL OR m.thread_id = $3)
      AND ($4::boolean IS NOT TRUE OR m.read_at IS NULL)
      AND ($5::timestamptz IS NULL OR m.created_at >= $5)
      AND ($6::timestamptz IS NULL OR m.created_at < $6)
      AND ($7 = '' OR m.body ILIKE '%' || $7 || '%')
      AND ($8::uuid IS NULL OR sender.owner_user_id = $8 OR recipient.owner_user_id = $8)
  `;
  const params = [
    filter.from ?? '',
    filter.to ?? '',
    filter.thread ?? null,
    filter.unread === true,
    filter.after ?? null,
    filter.before ?? null,
    filter.q ?? '',
    filter.ownerUserId,
  ];
  const [rows, total] = await Promise.all([
    pool.query(
      `SELECT m.id, m.thread_id, m.kind, m.body, m.created_at, m.read_at,
              sender.id AS from_id, sender.name AS from_name,
              recipient.id AS to_id, recipient.name AS to_name
       FROM messages m
       JOIN bots sender ON sender.id = m.from_bot_id
       JOIN bots recipient ON recipient.id = m.to_bot_id
       ${where}
       ORDER BY m.created_at DESC
       LIMIT $9 OFFSET $10`,
      [...params, filter.limit, filter.offset],
    ),
    pool.query<{ total: number }>(
      `SELECT count(*)::int AS total
       FROM messages m
       JOIN bots sender ON sender.id = m.from_bot_id
       JOIN bots recipient ON recipient.id = m.to_bot_id
       ${where}`,
      params,
    ),
  ]);
  return {
    total: total.rows[0]?.total ?? 0,
    messages: rows.rows.map((row) => ({
      id: row.id,
      thread_id: row.thread_id,
      kind: row.kind,
      text: row.body,
      created_at: iso(row.created_at),
      read_at: isoOrNull(row.read_at),
      from: { id: row.from_id, name: row.from_name },
      to: { id: row.to_id, name: row.to_name },
    })),
  };
}

export async function threadMessages(pool: Pool, threadId: string, ownerUserId: string | null) {
  const result = await pool.query(
    `SELECT m.id, m.thread_id, m.kind, m.body, m.created_at, m.read_at,
            sender.id AS from_id, sender.name AS from_name,
            recipient.id AS to_id, recipient.name AS to_name
     FROM messages m
     JOIN bots sender ON sender.id = m.from_bot_id
     JOIN bots recipient ON recipient.id = m.to_bot_id
     WHERE m.thread_id = $1
       AND ($2::uuid IS NULL OR sender.owner_user_id = $2 OR recipient.owner_user_id = $2)
     ORDER BY m.created_at ASC`,
    [threadId, ownerUserId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    thread_id: row.thread_id,
    kind: row.kind,
    text: row.body,
    created_at: iso(row.created_at),
    read_at: isoOrNull(row.read_at),
    from: { id: row.from_id, name: row.from_name },
    to: { id: row.to_id, name: row.to_name },
  }));
}

export async function listAdminTasks(pool: Pool, status: string | null, query: string, ownerUserId: string | null) {
  const result = await pool.query(
    `SELECT t.id, t.instructions, t.status, t.result, t.created_at, t.completed_at,
            author.id AS from_id, author.name AS from_name,
            assignee.id AS to_id, assignee.name AS to_name
     FROM tasks t
     JOIN bots author ON author.id = t.from_bot_id
     JOIN bots assignee ON assignee.id = t.to_bot_id
     WHERE ($1::text IS NULL OR t.status = $1)
       AND ($2 = '' OR t.instructions ILIKE '%' || $2 || '%' OR coalesce(t.result, '') ILIKE '%' || $2 || '%'
            OR author.name ILIKE '%' || $2 || '%' OR assignee.name ILIKE '%' || $2 || '%')
       AND ($3::uuid IS NULL OR author.owner_user_id = $3 OR assignee.owner_user_id = $3)
     ORDER BY t.created_at DESC
     LIMIT 300`,
    [status, query, ownerUserId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    instructions: row.instructions,
    status: row.status,
    result: row.result,
    created_at: iso(row.created_at),
    completed_at: isoOrNull(row.completed_at),
    from: { id: row.from_id, name: row.from_name },
    to: { id: row.to_id, name: row.to_name },
  }));
}

export async function listAudit(
  pool: Pool,
  filter: { action?: string; actor?: string; after?: string; before?: string; limit: number; offset: number; ownerUserId: string | null },
) {
  const params = [filter.action ?? '', filter.actor ?? '', filter.after ?? null, filter.before ?? null, filter.ownerUserId];
  const where = `
    WHERE ($1 = '' OR a.action = $1)
      AND ($2 = '' OR actor.name ILIKE '%' || $2 || '%' OR target.name ILIKE '%' || $2 || '%')
      AND ($3::timestamptz IS NULL OR a.created_at >= $3)
      AND ($4::timestamptz IS NULL OR a.created_at < $4)
      AND ($5::uuid IS NULL OR actor.owner_user_id = $5 OR target.owner_user_id = $5)
  `;
  const [rows, total] = await Promise.all([
    pool.query(
      `SELECT a.id::text, a.created_at, a.action, a.resource_type, a.resource_id, a.detail,
              actor.name AS actor_name, target.name AS target_name
       FROM audit_log a
       LEFT JOIN bots actor ON actor.id = a.actor_bot_id
       LEFT JOIN bots target ON target.id = a.target_bot_id
       ${where}
       ORDER BY a.id DESC
       LIMIT $6 OFFSET $7`,
      [...params, filter.limit, filter.offset],
    ),
    pool.query<{ total: number }>(
      `SELECT count(*)::int AS total
       FROM audit_log a
       LEFT JOIN bots actor ON actor.id = a.actor_bot_id
       LEFT JOIN bots target ON target.id = a.target_bot_id
       ${where}`,
      params,
    ),
  ]);
  return { total: total.rows[0]?.total ?? 0, entries: rows.rows.map(serializeAudit) };
}

export async function listDoorbell(
  pool: Pool,
  filter: { bot?: string; state?: string; limit: number; offset: number; ownerUserId: string | null },
) {
  const params = [filter.bot ?? '', filter.state ?? '', filter.ownerUserId];
  const where = `
    WHERE ($1 = '' OR b.name ILIKE '%' || $1 || '%' OR b.id::text = $1)
      AND (
        $2 = ''
        OR ($2 = 'delivered' AND j.delivered_at IS NOT NULL)
        OR ($2 = 'pending' AND j.delivered_at IS NULL AND j.attempts < j.max_attempts)
        OR ($2 = 'failed' AND j.delivered_at IS NULL AND j.attempts >= j.max_attempts)
      )
      AND ($3::uuid IS NULL OR b.owner_user_id = $3)
  `;
  const [rows, total] = await Promise.all([
    pool.query(
      `SELECT j.id, j.event, j.attempts, j.max_attempts, j.last_status, j.last_error,
              j.delivered_at, j.next_attempt_at, j.created_at, b.id AS bot_id, b.name AS bot_name
       FROM doorbell_jobs j
       JOIN bots b ON b.id = j.bot_id
       ${where}
       ORDER BY j.created_at DESC
       LIMIT $4 OFFSET $5`,
      [...params, filter.limit, filter.offset],
    ),
    pool.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM doorbell_jobs j JOIN bots b ON b.id = j.bot_id ${where}`,
      params,
    ),
  ]);
  return {
    total: total.rows[0]?.total ?? 0,
    deliveries: rows.rows.map((row) => ({
      id: row.id,
      event: row.event,
      attempts: row.attempts,
      max_attempts: row.max_attempts,
      last_status: row.last_status,
      last_error: row.last_error,
      delivered_at: isoOrNull(row.delivered_at),
      next_attempt_at: iso(row.next_attempt_at),
      created_at: iso(row.created_at),
      state: doorbellState(row),
      bot: { id: row.bot_id, name: row.bot_name },
    })),
  };
}

export async function doorbellJob(pool: Pool, id: string) {
  const result = await pool.query(
    `SELECT id, attempts, max_attempts, last_status, last_error, delivered_at, next_attempt_at
     FROM doorbell_jobs WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    attempts: row.attempts,
    max_attempts: row.max_attempts,
    last_status: row.last_status,
    last_error: row.last_error,
    delivered_at: isoOrNull(row.delivered_at),
    next_attempt_at: iso(row.next_attempt_at),
    state: doorbellState(row),
  };
}

export function settingsPayload(config: Config) {
  return {
    version: VERSION,
    publicUrl: config.publicUrl,
    clerk: Boolean(config.clerkPublishableKey),
    devAuth: config.dashboardDevAuth,
    allowedHosts: config.allowedHosts,
    rateLimitPerMinute: config.rateLimitPerMinute,
    limits: LIMITS,
    allowlist: {
      emails: config.adminEmails,
      userIds: config.adminUserIds,
      orgId: config.adminOrgId,
      orgRole: config.adminOrgRole,
    },
  };
}

function serializeBot(row: {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  token_prefix: string;
  webhook_url: string | null;
  webhook_profile: string | null;
  revoked_at: Date | null;
  created_at: Date;
  updated_at: Date;
  owner_name: string;
  owner_id: string;
}) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    capabilities: row.capabilities,
    token_prefix: row.token_prefix,
    webhook: row.webhook_url ? { url: row.webhook_url, profile: row.webhook_profile } : null,
    revoked_at: isoOrNull(row.revoked_at),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    owner: { id: row.owner_id, display_name: row.owner_name },
    status: row.revoked_at ? 'revoked' : 'active',
  };
}

function serializeAudit(row: {
  id: string;
  created_at: Date;
  action: string;
  resource_type: string;
  resource_id: string | null;
  detail: unknown;
  actor_name: string | null;
  target_name: string | null;
}) {
  return {
    id: row.id,
    created_at: iso(row.created_at),
    action: row.action,
    resource_type: row.resource_type,
    resource_id: row.resource_id,
    detail: row.detail,
    actor_name: row.actor_name,
    target_name: row.target_name,
  };
}

function doorbellState(row: { delivered_at: Date | null; attempts: number; max_attempts: number }): string {
  if (row.delivered_at) return 'delivered';
  if (row.attempts >= row.max_attempts) return 'failed';
  return 'pending';
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isoOrNull(value: Date | string | null): string | null {
  if (!value) return null;
  return iso(value);
}

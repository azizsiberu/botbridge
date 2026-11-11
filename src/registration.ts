import { randomUUID } from 'node:crypto';
import { originFromClientInfo, slugBotName, suffixedBotName } from './bot-name.js';
import { generateApiKey, hashToken, tokenPrefix } from './crypto.js';
import type { Pool } from './db.js';
import { UserError, isUniqueViolation } from './errors.js';
import { oauthClientName } from './oauth-client.js';
import { actorById, insertBotRow, writeAudit, type Actor } from './store.js';
import { isUuid, normalizeDescription } from './text.js';
import { normalizeOAuthClientId, noteOAuthPending, clearOAuthPending, oauthSplitClients } from './tenancy.js';

export interface ClientInfoInput {
  name?: string;
  title?: string;
}

export interface ConnectContext {
  body: unknown;
  sessionId: string | null;
  botHeader: string | null;
}

export interface ResolvedConnection {
  actor: Actor;
  /** Set when this response should advertise Mcp-Session-Id. */
  sessionId: string | null;
}

interface GrantRow {
  id: string;
  bot_id: string;
  origin_name: string | null;
  bot_revoked: Date | null;
}

interface SessionRow {
  id: string;
  user_id: string;
  bot_id: string;
  kind: 'oauth' | 'api_key';
  api_key_id: string | null;
  oauth_client_id: string | null;
}

interface ApiKeyRow {
  id: string;
  user_id: string;
  label: string;
  revoked_at: Date | null;
}

export function connectContext(input: { body: unknown; sessionHeader: string | null; botHeader: string | null }): ConnectContext {
  const session = input.sessionHeader?.trim() ?? '';
  const bot = input.botHeader?.trim() ?? '';
  return {
    body: input.body,
    sessionId: isUuid(session) ? session.toLowerCase() : null,
    botHeader: bot || null,
  };
}

/** clientInfo from an initialize message, or null when this request is not initialize. */
export function clientInfoFromBody(body: unknown): ClientInfoInput | null {
  const messages = Array.isArray(body) ? body : [body];
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    if ((message as { method?: unknown }).method !== 'initialize') continue;
    const params = (message as { params?: unknown }).params;
    if (!params || typeof params !== 'object') return {};
    const info = (params as { clientInfo?: unknown }).clientInfo;
    if (!info || typeof info !== 'object') return {};
    const name = (info as { name?: unknown }).name;
    const title = (info as { title?: unknown }).title;
    return {
      name: typeof name === 'string' ? name : undefined,
      title: typeof title === 'string' ? title : undefined,
    };
  }
  return null;
}

export async function resolveApiKeyConnection(pool: Pool, token: string, ctx: ConnectContext): Promise<ResolvedConnection> {
  if (!token.startsWith('bbk_') || token.length < 20) {
    throw new UserError('Unknown or revoked API key');
  }
  const found = await pool.query<ApiKeyRow>(
    `SELECT id, user_id, label, revoked_at FROM api_keys WHERE token_hash = $1`,
    [hashToken(token)],
  );
  const key = found.rows[0];
  if (!key || key.revoked_at) throw new UserError('Unknown or revoked API key');
  await pool.query(`UPDATE api_keys SET last_used_at = now() WHERE id = $1`, [key.id]);

  const session = await loadSession(pool, ctx.sessionId);
  if (session && session.kind === 'api_key' && session.api_key_id === key.id && session.user_id === key.user_id) {
    const actor = await requireLiveBot(pool, session.bot_id, 'This API key session is bound to a paused bot.');
    await touchSession(pool, session.id);
    return { actor, sessionId: session.id };
  }

  const info = clientInfoFromBody(ctx.body);
  const pinned = pinnedName(ctx.botHeader);
  const fromInfo = originFromClientInfo(info);
  const clientName = pinned ?? fromInfo;
  if (!clientName) {
    const only = await onlyKeyBot(pool, key.id);
    if (only) return { actor: only, sessionId: null };
    const count = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM api_key_bots WHERE api_key_id = $1`, [key.id]);
    const n = count.rows[0]?.n ?? 0;
    throw new UserError(
      n > 1
        ? 'This key is used by more than one bot. Send initialize again, or set X-Botbridge-Bot to the bot name.'
        : 'Send initialize so botbridge can name the bot, or set the X-Botbridge-Bot header.',
    );
  }

  const actor = await withLock(pool, `api:${key.id}`, clientName, async (db) => {
    const bound = await db.query<{ bot_id: string }>(
      `SELECT bot_id FROM api_key_bots WHERE api_key_id = $1 AND client_name = $2`,
      [key.id, clientName],
    );
    const existingId = bound.rows[0]?.bot_id;
    if (existingId) {
      const existing = await actorById(pool, existingId);
      if (!existing || existing.ownerUserId !== key.user_id) {
        throw new UserError('The bot for this client is paused. Reactivate it, or pick another name with X-Botbridge-Bot.');
      }
      return existing;
    }
    if (pinned) {
      const owned = await botByName(pool, key.user_id, pinned);
      if (owned) {
        await bindKeyBot(db, key.id, clientName, owned.id);
        return owned;
      }
    }
    const created = await createAutoBot(db, {
      ownerUserId: key.user_id,
      baseName: clientName,
      description: clip(
        `Created automatically when ${displayClient(info, clientName)} connected with API key "${key.label}".`,
        500,
      ),
      auditAction: 'api_key.bot.auto_created',
      auditDetail: { name: clientName, api_key: key.label, client_name: clientName },
    });
    await bindKeyBot(db, key.id, clientName, created.id);
    return created;
  });

  const sessionId = info ? await openSession(pool, { userId: key.user_id, botId: actor.id, kind: 'api_key', apiKeyId: key.id }) : null;
  return { actor, sessionId };
}

export async function resolveOAuthConnection(
  pool: Pool,
  accountId: string,
  rawClientId: string,
  ctx: ConnectContext,
  selectionUrl: string | null,
): Promise<ResolvedConnection> {
  const clientId = normalizeOAuthClientId(rawClientId);
  const choose = chooseLink(selectionUrl, clientId);
  try {
    const resolved = await resolveOAuth(pool, accountId, clientId, ctx, choose);
    await clearOAuthPending(pool, accountId, clientId);
    return resolved;
  } catch (error) {
    if (error instanceof UserError) await noteOAuthPending(pool, accountId, clientId, error.message);
    throw error;
  }
}

async function resolveOAuth(
  pool: Pool,
  accountId: string,
  clientId: string,
  ctx: ConnectContext,
  choose: string,
): Promise<ResolvedConnection> {
  const session = await loadSession(pool, ctx.sessionId);
  if (session && session.kind === 'oauth' && session.user_id === accountId && session.oauth_client_id === clientId) {
    const actor = await requireLiveBot(pool, session.bot_id, `The bot for this connection is paused. Reactivate it, or bind it to another bot: ${choose}`);
    await touchSession(pool, session.id);
    return { actor, sessionId: session.id };
  }

  const info = clientInfoFromBody(ctx.body);
  const pinned = pinnedName(ctx.botHeader);
  const fromInfo = originFromClientInfo(info);
  const fallback = slugBotName(oauthClientName(clientId)) ?? 'client';
  const origin = pinned ?? fromInfo ?? fallback;
  const label = clip((info?.title?.trim() || info?.name?.trim() || oauthClientName(clientId)), 200);

  const actor = await withLock(pool, `oauth:${accountId}`, clientId, async (db) => {
    const split = await oauthSplitClients(pool, accountId);
    const grants = await listGrants(db, accountId, clientId);
    const match = pickGrant(grants, origin, split);
    if (match) {
      if (match.bot_revoked) {
        throw new UserError(`The bot bound to this connection is paused. Reactivate it, or bind it to another bot: ${choose}`);
      }
      if (!match.origin_name) {
        await db.query(`UPDATE oauth_grants SET origin_name = $2 WHERE id = $1 AND origin_name IS NULL`, [match.id, origin]);
      }
      const existing = await actorById(pool, match.bot_id);
      if (!existing || existing.ownerUserId !== accountId) {
        throw new UserError(`The bot bound to this connection is no longer available. Bind it to another bot: ${choose}`);
      }
      return existing;
    }
    if (pinned) {
      const owned = await botByName(pool, accountId, pinned);
      if (owned) {
        await insertGrant(db, { userId: accountId, botId: owned.id, clientId, label, originName: origin });
        return owned;
      }
    }
    return createAutoBot(db, {
      ownerUserId: accountId,
      baseName: origin,
      description: clip(`Created automatically when ${label} connected with OAuth.`, 500),
      auditAction: 'oauth.bot.auto_created',
      auditDetail: { name: origin, client_id: clientId, origin_name: origin, label },
      afterInsert: async (botId) => {
        await insertGrant(db, { userId: accountId, botId, clientId, label, originName: origin });
      },
    });
  });

  const sessionId = info ? await openSession(pool, { userId: accountId, botId: actor.id, kind: 'oauth', oauthClientId: clientId }) : null;
  return { actor, sessionId };
}

function pickGrant(grants: GrantRow[], origin: string, split: boolean): GrantRow | undefined {
  if (!split) return grants[0];
  return grants.find((grant) => grant.origin_name === origin) ?? grants.find((grant) => !grant.origin_name);
}

async function listGrants(db: Query, accountId: string, clientId: string): Promise<GrantRow[]> {
  const result = await db.query<GrantRow>(
    `SELECT g.id, g.bot_id, g.origin_name, b.revoked_at AS bot_revoked
     FROM oauth_grants g
     JOIN bots b ON b.id = g.bot_id
     WHERE g.user_id = $1 AND g.clerk_client_id = $2 AND g.revoked_at IS NULL
     ORDER BY g.created_at, g.id`,
    [accountId, clientId],
  );
  return result.rows;
}

async function insertGrant(
  db: Query,
  input: { userId: string; botId: string; clientId: string; label: string; originName: string },
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO oauth_grants (id, user_id, bot_id, clerk_client_id, label, origin_name)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), input.userId, input.botId, input.clientId, input.label, input.originName],
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new UserError('That client was registered a moment ago. Try the connection again.');
    }
    throw error;
  }
}

async function createAutoBot(
  db: Query,
  input: {
    ownerUserId: string;
    baseName: string;
    description: string;
    auditAction: string;
    auditDetail: Record<string, unknown>;
    afterInsert?: (botId: string) => Promise<void>;
  },
): Promise<Actor> {
  const description = normalizeDescription(input.description);
  for (let n = 1; n <= 100; n += 1) {
    const name = suffixedBotName(input.baseName, n);
    const taken = await db.query(`SELECT 1 FROM bots WHERE name = $1`, [name]);
    if ((taken.rowCount ?? 0) > 0) continue;
    await db.query('SAVEPOINT bot_name');
    try {
      const row = await insertBotRow(db, { name, description, ownerUserId: input.ownerUserId });
      await writeAudit(db, {
        actorId: row.bot.id,
        action: 'bot.created',
        resourceType: 'bot',
        resourceId: row.bot.id,
        detail: { name: row.bot.name, source: input.auditAction },
      });
      if (input.afterInsert) await input.afterInsert(row.bot.id);
      await writeAudit(db, {
        actorId: row.bot.id,
        action: input.auditAction,
        resourceType: 'bot',
        resourceId: row.bot.id,
        detail: { ...input.auditDetail, name: row.bot.name },
      });
      await db.query('RELEASE SAVEPOINT bot_name');
      const owner = await db.query<{ display_name: string }>(`SELECT display_name FROM users WHERE id = $1`, [input.ownerUserId]);
      return {
        id: row.bot.id,
        name: row.bot.name,
        description: row.bot.description,
        capabilities: row.bot.capabilities,
        webhookConfigured: false,
        webhookProfile: null,
        ownerUserId: input.ownerUserId,
        ownerName: owner.rows[0]?.display_name ?? '',
      };
    } catch (error) {
      await db.query('ROLLBACK TO SAVEPOINT bot_name');
      if (error instanceof UserError && error.message.startsWith('A bot named ')) continue;
      throw error;
    }
  }
  throw new UserError('Could not register a bot because every name in this series is taken.');
}

async function onlyKeyBot(pool: Pool, apiKeyId: string): Promise<Actor | null> {
  const result = await pool.query<{ bot_id: string }>(
    `SELECT bot_id FROM api_key_bots WHERE api_key_id = $1 ORDER BY created_at, client_name`,
    [apiKeyId],
  );
  if (result.rows.length !== 1) return null;
  const id = result.rows[0]?.bot_id;
  if (!id) return null;
  const actor = await actorById(pool, id);
  if (!actor) throw new UserError('The bot for this key is paused. Reactivate it, or set X-Botbridge-Bot to another name.');
  return actor;
}

async function botByName(pool: Pool, userId: string, name: string): Promise<Actor | null> {
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM bots WHERE owner_user_id = $1 AND name = $2 AND revoked_at IS NULL`,
    [userId, name],
  );
  const id = result.rows[0]?.id;
  if (!id) return null;
  return actorById(pool, id);
}

async function bindKeyBot(db: Query, apiKeyId: string, clientName: string, botId: string): Promise<void> {
  await db.query(
    `INSERT INTO api_key_bots (api_key_id, client_name, bot_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (api_key_id, client_name) DO UPDATE SET bot_id = EXCLUDED.bot_id`,
    [apiKeyId, clientName, botId],
  );
}

async function requireLiveBot(pool: Pool, botId: string, message: string): Promise<Actor> {
  const actor = await actorById(pool, botId);
  if (!actor) throw new UserError(message);
  return actor;
}

async function loadSession(pool: Pool, sessionId: string | null): Promise<SessionRow | null> {
  if (!sessionId) return null;
  const result = await pool.query<SessionRow>(
    `SELECT id, user_id, bot_id, kind, api_key_id, oauth_client_id FROM mcp_sessions WHERE id = $1`,
    [sessionId],
  );
  return result.rows[0] ?? null;
}

async function touchSession(pool: Pool, sessionId: string): Promise<void> {
  await pool.query(`UPDATE mcp_sessions SET last_seen_at = now() WHERE id = $1`, [sessionId]);
}

async function openSession(
  pool: Pool,
  input: { userId: string; botId: string; kind: 'oauth' | 'api_key'; apiKeyId?: string; oauthClientId?: string },
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO mcp_sessions (id, user_id, bot_id, kind, api_key_id, oauth_client_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, input.userId, input.botId, input.kind, input.apiKeyId ?? null, input.oauthClientId ?? null],
  );
  return id;
}

function pinnedName(header: string | null): string | null {
  if (!header) return null;
  const name = slugBotName(header);
  if (!name) {
    throw new UserError('X-Botbridge-Bot must be a bot name: lowercase letters, digits, underscores, or hyphens.');
  }
  return name;
}

function displayClient(info: ClientInfoInput | null, fallback: string): string {
  return info?.title?.trim() || info?.name?.trim() || fallback;
}

function chooseLink(selectionUrl: string | null, clientId: string): string {
  const base = selectionUrl ?? '/oauth/choose';
  return `${base}?client_id=${encodeURIComponent(clientId)}`;
}

function clip(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

interface Query {
  query: Pool['query'];
}

async function withLock<T>(pool: Pool, key1: string, key2: string, fn: (db: Query) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [key1, key2]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function createApiKey(
  pool: Pool,
  userId: string,
  label: string,
): Promise<{ id: string; label: string; token: string; token_prefix: string; created_at: string }> {
  const name = label.trim();
  if (!name || name.length > 80) throw new UserError('Label must be 1–80 characters.');
  const token = generateApiKey();
  const id = randomUUID();
  const prefix = tokenPrefix(token);
  const inserted = await pool.query<{ created_at: Date }>(
    `INSERT INTO api_keys (id, user_id, label, token_hash, token_prefix)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING created_at`,
    [id, userId, name, hashToken(token), prefix],
  );
  await pool.query(
    `INSERT INTO audit_log (actor_bot_id, action, resource_type, resource_id, detail)
     VALUES (NULL, 'api_key.created', 'api_key', $1, $2::jsonb)`,
    [id, JSON.stringify({ label: name, prefix })],
  );
  return {
    id,
    label: name,
    token,
    token_prefix: prefix,
    created_at: inserted.rows[0]?.created_at.toISOString() ?? new Date().toISOString(),
  };
}

export async function listApiKeys(
  pool: Pool,
  userId: string,
): Promise<
  Array<{ id: string; label: string; token_prefix: string; created_at: string; last_used_at: string | null; revoked_at: string | null }>
> {
  const result = await pool.query<{
    id: string;
    label: string;
    token_prefix: string;
    created_at: Date;
    last_used_at: Date | null;
    revoked_at: Date | null;
  }>(
    `SELECT id, label, token_prefix, created_at, last_used_at, revoked_at
     FROM api_keys WHERE user_id = $1
     ORDER BY created_at DESC, id`,
    [userId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    label: row.label,
    token_prefix: row.token_prefix,
    created_at: row.created_at.toISOString(),
    last_used_at: row.last_used_at ? row.last_used_at.toISOString() : null,
    revoked_at: row.revoked_at ? row.revoked_at.toISOString() : null,
  }));
}

export async function revokeApiKey(pool: Pool, userId: string, keyId: string): Promise<void> {
  if (!isUuid(keyId)) throw new UserError('API key id must be a UUID.');
  const result = await pool.query<{ label: string }>(
    `UPDATE api_keys SET revoked_at = now()
     WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
     RETURNING label`,
    [keyId, userId],
  );
  const row = result.rows[0];
  if (!row) throw new UserError('API key not found.');
  await pool.query(
    `INSERT INTO audit_log (actor_bot_id, action, resource_type, resource_id, detail)
     VALUES (NULL, 'api_key.revoked', 'api_key', $1, $2::jsonb)`,
    [keyId, JSON.stringify({ label: row.label })],
  );
}

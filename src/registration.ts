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

/** How far a connection may go on its own when no bot fits it yet. */
export interface RegistrationPolicy {
  /** BOTBRIDGE_AUTO_REGISTER. Off: only the first connection of a client id or key may create a bot. */
  autoRegister: boolean;
}

const DEFAULT_POLICY: RegistrationPolicy = { autoRegister: false };

interface ApprovalRequest {
  kind: 'oauth' | 'api_key';
  userId: string;
  oauthClientId: string | null;
  apiKeyId: string | null;
  requestedName: string;
  label: string | null;
  reason: string;
}

/** A connection that wanted a new bot. It is refused now and waits for the owner. */
class NeedsApproval extends UserError {
  constructor(
    message: string,
    readonly request: ApprovalRequest,
  ) {
    super(message);
    this.name = 'NeedsApproval';
  }
}

export async function resolveApiKeyConnection(
  pool: Pool,
  token: string,
  ctx: ConnectContext,
  policy: RegistrationPolicy = DEFAULT_POLICY,
): Promise<ResolvedConnection> {
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

  let actor: Actor;
  try {
    actor = await withLock(pool, `api:${key.id}`, clientName, async (db) => {
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
        const named = await ownBotByName(db, key.user_id, pinned);
        if (named?.revoked) {
          throw new UserError(`The bot "${pinned}" is paused. Revoked bots are not re-created. Reactivate it on the dashboard, or pick another name.`);
        }
        if (named) {
          const owned = await actorById(pool, named.id);
          if (!owned) throw new UserError(`The bot "${pinned}" is not available. Pick another name with X-Botbridge-Bot.`);
          await bindKeyBot(db, key.id, clientName, owned.id);
          return owned;
        }
      }

      await assertNotRetired(db, { ownerUserId: key.user_id, name: clientName, apiKeyId: key.id });
      const everBound = await keyEverBound(db, key.id);
      if (everBound && !policy.autoRegister) {
        if (!pinned) {
          const live = await liveKeyBots(db, key.id);
          if (live.length === 1 && live[0]) {
            const only = await actorById(pool, live[0]);
            if (only) return only;
          }
        }
        throw new NeedsApproval(
          pinned
            ? `This API key already has a bot, so "${clientName}" was not created automatically. The account owner can approve it on the dashboard, or create the bot first.`
            : `This API key is used by more than one bot and none is named "${clientName}". Set X-Botbridge-Bot to one of them, or ask the account owner to approve a new bot on the dashboard.`,
          {
            kind: 'api_key',
            userId: key.user_id,
            oauthClientId: null,
            apiKeyId: key.id,
            requestedName: clientName,
            label: clip(displayClient(info, clientName), 200),
            reason: pinned ? 'new_pinned_name' : 'ambiguous_client',
          },
        );
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
  } catch (error) {
    if (error instanceof NeedsApproval) throw await recordApprovalRequest(pool, error);
    throw error;
  }

  const sessionId = info ? await openSession(pool, { userId: key.user_id, botId: actor.id, kind: 'api_key', apiKeyId: key.id }) : null;
  return { actor, sessionId };
}

export async function resolveOAuthConnection(
  pool: Pool,
  accountId: string,
  rawClientId: string,
  ctx: ConnectContext,
  selectionUrl: string | null,
  policy: RegistrationPolicy = DEFAULT_POLICY,
): Promise<ResolvedConnection> {
  const clientId = normalizeOAuthClientId(rawClientId);
  const choose = chooseLink(selectionUrl, clientId);
  try {
    const resolved = await resolveOAuth(pool, accountId, clientId, ctx, choose, policy);
    await clearOAuthPending(pool, accountId, clientId);
    return resolved;
  } catch (error) {
    const shown = error instanceof NeedsApproval ? await recordApprovalRequest(pool, error) : error;
    if (shown instanceof UserError) await noteOAuthPending(pool, accountId, clientId, shown.message);
    throw shown;
  }
}

async function resolveOAuth(
  pool: Pool,
  accountId: string,
  clientId: string,
  ctx: ConnectContext,
  choose: string,
  policy: RegistrationPolicy,
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
    const grants = await listGrants(db, accountId, clientId);
    const register = async (reason: string, refusal: string): Promise<Actor> => {
      // The first connection of a client id may create its bot: the owner just
      // signed in and consented. After that a new bot needs the owner, unless
      // the operator turned BOTBRIDGE_AUTO_REGISTER on.
      await assertNotRetired(db, { ownerUserId: accountId, name: origin, clientId });
      if (!policy.autoRegister && (await clientEverBound(db, accountId, clientId))) {
        throw new NeedsApproval(refusal, {
          kind: 'oauth',
          userId: accountId,
          oauthClientId: clientId,
          apiKeyId: null,
          requestedName: origin,
          label,
          reason,
        });
      }
      return createAutoBot(db, {
        ownerUserId: accountId,
        baseName: origin,
        description: clip(`Created automatically when ${label} connected with OAuth.`, 500),
        auditAction: 'oauth.bot.auto_created',
        auditDetail: { name: origin, client_id: clientId, origin_name: origin, label, pinned: pinned !== null },
        afterInsert: async (botId) => {
          await insertGrant(db, { userId: accountId, botId, clientId, label, originName: origin });
        },
      });
    };

    // An explicit X-Botbridge-Bot always wins over whatever grant this client id already has.
    if (pinned) {
      const named = await ownBotByName(db, accountId, pinned);
      if (named?.revoked) {
        throw new UserError(`The bot "${pinned}" is paused. Revoked bots are not re-created. Reactivate it on the dashboard, or pick another name with X-Botbridge-Bot.`);
      }
      const forPin = grants.find((grant) => grant.origin_name === pinned);
      if (named) {
        const owned = await actorById(pool, named.id);
        if (!owned) throw new UserError(`The bot "${pinned}" is not available. Pick another name with X-Botbridge-Bot.`);
        if (forPin?.bot_id !== owned.id) {
          if (forPin) await db.query(`UPDATE oauth_grants SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [forPin.id]);
          await insertGrant(db, { userId: accountId, botId: owned.id, clientId, label, originName: pinned });
          await writeAudit(db, {
            actorId: owned.id,
            action: 'oauth.bot.pinned',
            resourceType: 'bot',
            resourceId: owned.id,
            detail: { name: owned.name, client_id: clientId, origin_name: pinned },
          });
        }
        return owned;
      }
      // The pinned name was registered earlier under a suffix (the plain name belongs to another account).
      if (forPin) return grantActor(pool, accountId, forPin, choose);
      return register(
        'new_pinned_name',
        `This connection already has a bot, so "${pinned}" was not created automatically. The account owner can approve it on the dashboard, or create the bot first and connect again.`,
      );
    }

    const split = await oauthSplitClients(pool, accountId);
    const match = policy.autoRegister || !split
      ? pickGrant(grants, { origin, fromInitialize: info !== null, split })
      : pickExistingGrant(grants, { origin, fromInitialize: info !== null });
    if (match === 'ambiguous') {
      if (info !== null && !policy.autoRegister) {
        return register(
          'ambiguous_client',
          `This OAuth client is connected as more than one bot and none is named "${origin}". Set X-Botbridge-Bot to one of them, or ask the account owner to approve a new bot on the dashboard.`,
        );
      }
      throw new UserError(
        'This OAuth client is connected as more than one bot. Send initialize again, or set X-Botbridge-Bot to the bot name.',
      );
    }
    if (match) {
      if (!match.origin_name && info !== null) {
        await db.query(`UPDATE oauth_grants SET origin_name = $2 WHERE id = $1 AND origin_name IS NULL`, [match.id, origin]);
      }
      return grantActor(pool, accountId, match, choose);
    }
    return register(
      'new_client_name',
      `This connection already had a bot, so "${origin}" was not created automatically. The account owner can approve it on the dashboard, or set X-Botbridge-Bot to an existing bot.`,
    );
  });

  const sessionId = info ? await openSession(pool, { userId: accountId, botId: actor.id, kind: 'oauth', oauthClientId: clientId }) : null;
  return { actor, sessionId };
}

/**
 * Without auto-registration: a grant for this exact origin wins (and is
 * refused when its bot is paused). Otherwise the one bot that still works on
 * this client id is used. Several working bots are a guess, so refuse. No
 * working bot but a paused one: refuse, never mint a replacement.
 */
function pickExistingGrant(
  grants: GrantRow[],
  input: { origin: string; fromInitialize: boolean },
): GrantRow | undefined | 'ambiguous' {
  const exact = grants.find((grant) => grant.origin_name === input.origin);
  if (exact) return exact;
  const live = grants.filter((grant) => !grant.bot_revoked);
  if (live.length === 1) return live[0];
  if (live.length > 1) return 'ambiguous';
  return grants[0];
}

async function grantActor(pool: Pool, accountId: string, grant: GrantRow, choose: string): Promise<Actor> {
  if (grant.bot_revoked) {
    throw new UserError(`The bot bound to this connection is paused. Reactivate it, or bind it to another bot: ${choose}`);
  }
  const existing = await actorById(pool, grant.bot_id);
  if (!existing || existing.ownerUserId !== accountId) {
    throw new UserError(`The bot bound to this connection is no longer available. Bind it to another bot: ${choose}`);
  }
  return existing;
}

/**
 * Pick the grant for this connection, or undefined to register a new bot.
 *
 * Default (split): a grant is reused only when its recorded origin (client
 * name at initialize) matches. A grant with no origin yet (made before origins
 * were recorded, or bound by hand at /oauth/choose) is claimed by the first
 * client that connects. Another client name on the same client id gets its own
 * bot, so one agent never silently acts as another.
 *
 * Shared (split off, opt-in): every client name on this client id reuses the
 * first grant, which was the old default.
 *
 * A request that is not initialize carries no client name. It reuses the only
 * grant, or the grant for the fallback name, and is refused when that would be
 * a guess between several bots.
 */
function pickGrant(
  grants: GrantRow[],
  input: { origin: string; fromInitialize: boolean; split: boolean },
): GrantRow | undefined | 'ambiguous' {
  const exact = grants.find((grant) => grant.origin_name === input.origin);
  if (exact) return exact;
  if (!input.split) return grants[0];
  if (!input.fromInitialize) {
    if (grants.length === 0) return undefined;
    if (grants.length === 1) return grants[0];
    return 'ambiguous';
  }
  return grants.find((grant) => !grant.origin_name);
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
    const taken = await db.query<{ owner_user_id: string; revoked_at: Date | null }>(
      `SELECT owner_user_id, revoked_at FROM bots WHERE name = $1`,
      [name],
    );
    const holder = taken.rows[0];
    if (holder) {
      // Never step around a bot this account revoked: that would bring it back under a new name.
      if (holder.owner_user_id === input.ownerUserId && holder.revoked_at) throw retiredError(name);
      continue;
    }
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

function retiredError(name: string): UserError {
  return new UserError(
    `The bot "${name}" was revoked on this account. Revoked bots are not re-created automatically. The account owner can reactivate it on the dashboard.`,
  );
}

/** Refuse to register a name this account already revoked, directly or through this client's grants. */
async function assertNotRetired(
  db: Query,
  input: { ownerUserId: string; name: string; clientId?: string; apiKeyId?: string },
): Promise<void> {
  const own = await db.query<{ revoked_at: Date | null }>(
    `SELECT revoked_at FROM bots WHERE owner_user_id = $1 AND name = $2`,
    [input.ownerUserId, input.name],
  );
  if (own.rows[0]?.revoked_at) throw retiredError(input.name);
  if (input.clientId) {
    const viaGrant = await db.query<{ name: string }>(
      `SELECT b.name FROM oauth_grants g JOIN bots b ON b.id = g.bot_id
       WHERE g.user_id = $1 AND g.clerk_client_id = $2 AND g.origin_name = $3 AND b.revoked_at IS NOT NULL
       LIMIT 1`,
      [input.ownerUserId, input.clientId, input.name],
    );
    if (viaGrant.rows[0]) throw retiredError(viaGrant.rows[0].name);
  }
  if (input.apiKeyId) {
    const viaKey = await db.query<{ name: string }>(
      `SELECT b.name FROM api_key_bots k JOIN bots b ON b.id = k.bot_id
       WHERE k.api_key_id = $1 AND k.client_name = $2 AND b.revoked_at IS NOT NULL
       LIMIT 1`,
      [input.apiKeyId, input.name],
    );
    if (viaKey.rows[0]) throw retiredError(viaKey.rows[0].name);
  }
}

/** True once this account and OAuth client id have had any bot, even if the grant was later revoked. */
async function clientEverBound(db: Query, accountId: string, clientId: string): Promise<boolean> {
  const result = await db.query(`SELECT 1 FROM oauth_grants WHERE user_id = $1 AND clerk_client_id = $2 LIMIT 1`, [accountId, clientId]);
  return (result.rowCount ?? 0) > 0;
}

async function keyEverBound(db: Query, apiKeyId: string): Promise<boolean> {
  const result = await db.query(`SELECT 1 FROM api_key_bots WHERE api_key_id = $1 LIMIT 1`, [apiKeyId]);
  return (result.rowCount ?? 0) > 0;
}

async function liveKeyBots(db: Query, apiKeyId: string): Promise<string[]> {
  const result = await db.query<{ bot_id: string }>(
    `SELECT DISTINCT k.bot_id FROM api_key_bots k JOIN bots b ON b.id = k.bot_id
     WHERE k.api_key_id = $1 AND b.revoked_at IS NULL`,
    [apiKeyId],
  );
  return result.rows.map((row) => row.bot_id);
}

/**
 * Keep one open request per client and name so the owner sees it. A request
 * the owner declined stays declined: the client is told so and nothing new opens.
 * Returns the error to show the client.
 */
async function recordApprovalRequest(pool: Pool, error: NeedsApproval): Promise<UserError> {
  const req = error.request;
  const existing = await pool.query<{ id: string; status: string }>(
    `SELECT id, status FROM bot_registration_requests
     WHERE user_id = $1 AND kind = $2
       AND oauth_client_id IS NOT DISTINCT FROM $3
       AND api_key_id IS NOT DISTINCT FROM $4
       AND requested_name = $5
       AND status IN ('pending', 'declined')
     ORDER BY created_at DESC
     LIMIT 1`,
    [req.userId, req.kind, req.oauthClientId, req.apiKeyId, req.requestedName],
  );
  const row = existing.rows[0];
  if (row?.status === 'declined') {
    return new UserError(`The account owner declined a bot named "${req.requestedName}" for this connection. Set X-Botbridge-Bot to an existing bot.`);
  }
  if (row) {
    await pool.query(
      `UPDATE bot_registration_requests SET attempts = attempts + 1, last_seen_at = now(), reason = $2, label = coalesce($3, label) WHERE id = $1`,
      [row.id, req.reason, req.label],
    );
    return new UserError(`${error.message} Request ${row.id} is waiting for approval.`);
  }
  const id = randomUUID();
  await pool.query(
    `INSERT INTO bot_registration_requests (id, user_id, kind, oauth_client_id, api_key_id, requested_name, label, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, req.userId, req.kind, req.oauthClientId, req.apiKeyId, req.requestedName, req.label, req.reason],
  );
  await writeAudit(pool, {
    actorId: null,
    action: 'bot.registration.requested',
    resourceType: 'bot_registration_request',
    resourceId: id,
    detail: { name: req.requestedName, kind: req.kind, client_id: req.oauthClientId, api_key_id: req.apiKeyId, reason: req.reason },
  });
  return new UserError(`${error.message} Request ${id} is waiting for approval.`);
}

export interface RegistrationRequest {
  id: string;
  kind: 'oauth' | 'api_key';
  requested_name: string;
  label: string | null;
  client: string;
  reason: string | null;
  status: 'pending' | 'approved' | 'declined';
  attempts: number;
  owner: { id: string; display_name: string };
  bot: { id: string; name: string } | null;
  created_at: string;
  last_seen_at: string;
  decided_at: string | null;
}

/** Requests for one account, or every account when userId is null (operator CLI, admin view). */
export async function listRegistrationRequests(
  pool: Pool,
  userId: string | null,
  options: { status?: 'pending' | 'all' } = {},
): Promise<RegistrationRequest[]> {
  const result = await pool.query<{
    id: string;
    kind: 'oauth' | 'api_key';
    requested_name: string;
    label: string | null;
    oauth_client_id: string | null;
    api_key_label: string | null;
    reason: string | null;
    status: 'pending' | 'approved' | 'declined';
    attempts: number;
    user_id: string;
    display_name: string;
    bot_id: string | null;
    bot_name: string | null;
    created_at: Date;
    last_seen_at: Date;
    decided_at: Date | null;
  }>(
    `SELECT r.id, r.kind, r.requested_name, r.label, r.oauth_client_id, k.label AS api_key_label, r.reason, r.status,
            r.attempts, r.user_id, u.display_name, r.bot_id, b.name AS bot_name, r.created_at, r.last_seen_at, r.decided_at
     FROM bot_registration_requests r
     JOIN users u ON u.id = r.user_id
     LEFT JOIN api_keys k ON k.id = r.api_key_id
     LEFT JOIN bots b ON b.id = r.bot_id
     WHERE ($1::uuid IS NULL OR r.user_id = $1)
       AND ($2::boolean OR r.status = 'pending')
     ORDER BY r.last_seen_at DESC, r.id
     LIMIT 200`,
    [userId, options.status === 'all'],
  );
  return result.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    requested_name: row.requested_name,
    label: row.label,
    client: row.kind === 'oauth' ? (row.oauth_client_id ?? '') : `API key "${row.api_key_label ?? '?'}"`,
    reason: row.reason,
    status: row.status,
    attempts: row.attempts,
    owner: { id: row.user_id, display_name: row.display_name },
    bot: row.bot_id && row.bot_name ? { id: row.bot_id, name: row.bot_name } : null,
    created_at: row.created_at.toISOString(),
    last_seen_at: row.last_seen_at.toISOString(),
    decided_at: row.decided_at ? row.decided_at.toISOString() : null,
  }));
}

/**
 * The owner's answer. Approve creates the bot (or binds an existing bot of the
 * account with that name) and binds it to the client, so the next connect lands
 * on it. A revoked bot is never brought back this way. The new bot gets no
 * reach into other accounts until those accounts approve a connection for it.
 * userId null = operator (CLI), allowed for any account.
 */
export async function decideRegistrationRequest(
  pool: Pool,
  input: { id: string; userId: string | null; decision: 'approve' | 'decline'; name?: string | null },
): Promise<{ status: 'approved' | 'declined'; bot: { id: string; name: string } | null }> {
  if (!isUuid(input.id)) throw new UserError('Request id must be a UUID.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query<{
      id: string;
      user_id: string;
      kind: 'oauth' | 'api_key';
      oauth_client_id: string | null;
      api_key_id: string | null;
      requested_name: string;
      label: string | null;
    }>(
      `SELECT id, user_id, kind, oauth_client_id, api_key_id, requested_name, label
       FROM bot_registration_requests
       WHERE id = $1 AND status = 'pending' AND ($2::uuid IS NULL OR user_id = $2)
       FOR UPDATE`,
      [input.id, input.userId],
    );
    const req = found.rows[0];
    if (!req) throw new UserError('That request is not waiting for you.');

    if (input.decision === 'decline') {
      await client.query(`UPDATE bot_registration_requests SET status = 'declined', decided_at = now() WHERE id = $1`, [req.id]);
      await writeAudit(client, {
        actorId: null,
        action: 'bot.registration.declined',
        resourceType: 'bot_registration_request',
        resourceId: req.id,
        detail: { name: req.requested_name, kind: req.kind },
      });
      await client.query('COMMIT');
      return { status: 'declined', bot: null };
    }

    const wanted = input.name?.trim() ? slugBotName(input.name) : req.requested_name;
    if (!wanted) throw new UserError('Bot name must use lowercase letters, digits, underscores, or hyphens.');
    const named = await ownBotByName(client, req.user_id, wanted);
    if (named?.revoked) throw retiredError(wanted);
    let botId: string;
    let botName = wanted;
    if (named) {
      botId = named.id;
    } else {
      const description = normalizeDescription(
        clip(`Approved by the account owner for ${req.label ?? req.requested_name} (${req.kind === 'oauth' ? 'OAuth' : 'API key'}).`, 500),
      );
      const row = await insertBotRow(client, { name: wanted, description, ownerUserId: req.user_id });
      botId = row.bot.id;
      botName = row.bot.name;
      await writeAudit(client, {
        actorId: botId,
        action: 'bot.created',
        resourceType: 'bot',
        resourceId: botId,
        detail: { name: botName, source: 'bot.registration.approved' },
      });
    }

    if (req.kind === 'oauth' && req.oauth_client_id) {
      await client.query(
        `UPDATE oauth_grants SET revoked_at = now()
         WHERE user_id = $1 AND clerk_client_id = $2 AND origin_name = $3 AND revoked_at IS NULL`,
        [req.user_id, req.oauth_client_id, req.requested_name],
      );
      await insertGrant(client, {
        userId: req.user_id,
        botId,
        clientId: req.oauth_client_id,
        label: req.label ?? req.requested_name,
        originName: req.requested_name,
      });
    } else if (req.kind === 'api_key' && req.api_key_id) {
      const key = await client.query<{ revoked_at: Date | null }>(`SELECT revoked_at FROM api_keys WHERE id = $1`, [req.api_key_id]);
      if (!key.rows[0] || key.rows[0].revoked_at) throw new UserError('That API key was revoked.');
      await bindKeyBot(client, req.api_key_id, req.requested_name, botId);
    }

    await client.query(
      `UPDATE bot_registration_requests SET status = 'approved', decided_at = now(), bot_id = $2 WHERE id = $1`,
      [req.id, botId],
    );
    await writeAudit(client, {
      actorId: botId,
      action: 'bot.registration.approved',
      resourceType: 'bot_registration_request',
      resourceId: req.id,
      detail: { name: botName, requested_name: req.requested_name, kind: req.kind, client_id: req.oauth_client_id },
    });
    await client.query('COMMIT');
    return { status: 'approved', bot: { id: botId, name: botName } };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
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

async function ownBotByName(db: Query, userId: string, name: string): Promise<{ id: string; revoked: boolean } | null> {
  const result = await db.query<{ id: string; revoked_at: Date | null }>(
    `SELECT id, revoked_at FROM bots WHERE owner_user_id = $1 AND name = $2`,
    [userId, name],
  );
  const row = result.rows[0];
  return row ? { id: row.id, revoked: row.revoked_at !== null } : null;
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

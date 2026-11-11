import type { ReachableBot } from './workspace-types.js';
import { randomUUID } from 'node:crypto';
import type { Config } from './config.js';
import type { Pool } from './db.js';
import { UserError, isUniqueViolation } from './errors.js';
import type { AdminIdentity } from './identity.js';
import { oauthClientName } from './oauth-client.js';
import type { Actor } from './store.js';

const OAUTH_CLIENT_ID_MAX = 2048;

export const UNASSIGNED_USER_ID = '00000000-0000-4000-8000-000000000001';

export interface Account {
  id: string;
  clerkUserId: string | null;
  email: string | null;
  displayName: string;
  status: 'active' | 'suspended';
  isAdmin: boolean;
}

export type { ReachableBot } from './workspace-types.js';

interface BotRef {
  id: string;
  name: string;
  owner_user_id: string;
  revoked_at: Date | null;
}

export async function reconcileTenancy(pool: Pool, config: Config): Promise<void> {
  await pool.query(
    `UPDATE instance_settings
     SET signup_mode = $1
     WHERE id = 1 AND signup_locked = false`,
    [config.signupMode],
  );
  if (!config.legacyOwnerEmail) return;
  const owner = await upsertUser(pool, {
    clerkUserId: null,
    email: config.legacyOwnerEmail,
    displayName: config.legacyOwnerEmail,
  });
  await pool.query(
    `UPDATE bots SET owner_user_id = $1, updated_at = now()
     WHERE owner_user_id = $2`,
    [owner.id, UNASSIGNED_USER_ID],
  );
  await pool.query(`UPDATE instance_settings SET legacy_claimed = true WHERE id = 1`);
}

export async function syncAccount(pool: Pool, config: Config, identity: AdminIdentity, isAdmin: boolean): Promise<Account> {
  const email = identity.email?.toLowerCase() ?? null;
  const existing = await findAccount(pool, identity.userId, email);
  if (existing?.status === 'suspended') {
    throw new UserError('This account is suspended.');
  }
  if (!existing) {
    const allowed = isAdmin || (await signupAllows(pool, email));
    if (!allowed) throw new UserError('This bridge is invite-only. Ask an admin for an invite.');
  }
  const account = await upsertUser(pool, {
    clerkUserId: identity.userId,
    email,
    displayName: email ?? identity.userId,
  });
  if (account.status === 'suspended') throw new UserError('This account is suspended.');
  if (email) {
    await pool.query(`UPDATE invites SET accepted_at = coalesce(accepted_at, now()) WHERE email = $1`, [email]);
  }
  if (isAdmin) await claimLegacyOnFirstAdmin(pool, config, account.id);
  return { ...account, isAdmin };
}

async function claimLegacyOnFirstAdmin(pool: Pool, config: Config, adminUserId: string): Promise<void> {
  if (config.legacyOwnerEmail) return;
  const settings = await pool.query<{ legacy_claimed: boolean }>(`SELECT legacy_claimed FROM instance_settings WHERE id = 1`);
  if (settings.rows[0]?.legacy_claimed) return;
  await pool.query(
    `UPDATE bots SET owner_user_id = $1, updated_at = now() WHERE owner_user_id = $2`,
    [adminUserId, UNASSIGNED_USER_ID],
  );
  await pool.query(`UPDATE instance_settings SET legacy_claimed = true WHERE id = 1`);
}

async function signupAllows(pool: Pool, email: string | null): Promise<boolean> {
  const settings = await pool.query<{ signup_mode: string }>(`SELECT signup_mode FROM instance_settings WHERE id = 1`);
  if ((settings.rows[0]?.signup_mode ?? 'open') === 'open') return true;
  if (!email) return false;
  const invite = await pool.query(`SELECT 1 FROM invites WHERE email = $1`, [email]);
  return (invite.rowCount ?? 0) > 0;
}

async function findAccount(pool: Pool, clerkUserId: string, email: string | null): Promise<Account | null> {
  const result = await pool.query<{ id: string; clerk_user_id: string | null; email: string | null; display_name: string; status: 'active' | 'suspended' }>(
    `SELECT id, clerk_user_id, email, display_name, status
     FROM users
     WHERE clerk_user_id = $1 OR ($2::text IS NOT NULL AND email = $2)
     ORDER BY clerk_user_id NULLS LAST
     LIMIT 1`,
    [clerkUserId, email],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    clerkUserId: row.clerk_user_id,
    email: row.email,
    displayName: row.display_name,
    status: row.status,
    isAdmin: false,
  };
}

async function upsertUser(
  pool: Pool,
  input: { clerkUserId: string | null; email: string | null; displayName: string },
): Promise<Account> {
  const email = input.email?.toLowerCase() ?? null;
  if (input.clerkUserId) {
    const byClerk = await pool.query<{ id: string }>(`SELECT id FROM users WHERE clerk_user_id = $1`, [input.clerkUserId]);
    if (byClerk.rows[0]) {
      const updated = await pool.query<{ id: string; clerk_user_id: string | null; email: string | null; display_name: string; status: 'active' | 'suspended' }>(
        `UPDATE users
         SET email = coalesce($2, email), display_name = CASE WHEN display_name = clerk_user_id THEN coalesce($3, display_name) ELSE display_name END, updated_at = now()
         WHERE id = $1
         RETURNING id, clerk_user_id, email, display_name, status`,
        [byClerk.rows[0].id, email, input.displayName],
      );
      const row = updated.rows[0];
      if (!row) throw new Error('user update failed');
      return { id: row.id, clerkUserId: row.clerk_user_id, email: row.email, displayName: row.display_name, status: row.status, isAdmin: false };
    }
  }
  if (email) {
    const byEmail = await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);
    if (byEmail.rows[0]) {
      const updated = await pool.query<{ id: string; clerk_user_id: string | null; email: string | null; display_name: string; status: 'active' | 'suspended' }>(
        `UPDATE users SET clerk_user_id = coalesce(clerk_user_id, $2), updated_at = now() WHERE id = $1
         RETURNING id, clerk_user_id, email, display_name, status`,
        [byEmail.rows[0].id, input.clerkUserId],
      );
      const row = updated.rows[0];
      if (!row) throw new Error('user update failed');
      return { id: row.id, clerkUserId: row.clerk_user_id, email: row.email, displayName: row.display_name, status: row.status, isAdmin: false };
    }
  }
  const id = randomUUID();
  try {
    await pool.query(
      `INSERT INTO users (id, clerk_user_id, email, display_name) VALUES ($1, $2, $3, $4)`,
      [id, input.clerkUserId, email, input.displayName],
    );
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const again = await findAccount(pool, input.clerkUserId ?? '', email);
    if (again) return again;
    throw error;
  }
  return { id, clerkUserId: input.clerkUserId, email, displayName: input.displayName, status: 'active', isAdmin: false };
}

export async function operatorOwnerId(pool: Pool, legacyEmail: string | null): Promise<string> {
  if (legacyEmail) {
    const found = await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [legacyEmail.toLowerCase()]);
    if (found.rows[0]) return found.rows[0].id;
  }
  return UNASSIGNED_USER_ID;
}

export async function canReach(pool: Pool, actor: Actor, target: { id: string; owner_user_id: string; revoked_at: Date | null }): Promise<boolean> {
  if (target.revoked_at) return false;
  if (target.id === actor.id) return true;
  if (target.owner_user_id === actor.ownerUserId) {
    const owner = await pool.query<{ status: string }>(`SELECT status FROM users WHERE id = $1`, [actor.ownerUserId]);
    return owner.rows[0]?.status === 'active';
  }
  const targetOwner = await pool.query<{ status: string }>(`SELECT status FROM users WHERE id = $1`, [target.owner_user_id]);
  if (targetOwner.rows[0]?.status !== 'active') return false;
  // An account connection covers the bots both accounts had when it was
  // approved (plus bots flagged account_links, which is every bot from before
  // this rule). A bot created later needs its own approval.
  const link = await pool.query(
    `SELECT 1
     FROM connections c
     JOIN bots ab ON ab.id = $3
     JOIN bots tb ON tb.id = $4
     WHERE c.status = 'active'
       AND (
         (c.kind = 'account' AND (
            (c.from_user_id = $1 AND c.to_user_id = $2) OR (c.from_user_id = $2 AND c.to_user_id = $1)
         )
         AND (ab.account_links OR ab.created_at <= coalesce(c.decided_at, c.created_at))
         AND (tb.account_links OR tb.created_at <= coalesce(c.decided_at, c.created_at)))
         OR (c.kind = 'bot' AND (
            (c.from_bot_id = $3 AND c.to_bot_id = $4) OR (c.from_bot_id = $4 AND c.to_bot_id = $3)
         ))
       )
     LIMIT 1`,
    [actor.ownerUserId, target.owner_user_id, actor.id, target.id],
  );
  return (link.rowCount ?? 0) > 0;
}

export async function assertCanReach(pool: Pool, actor: Actor, target: { id: string; name: string; owner_user_id: string; revoked_at: Date | null }): Promise<void> {
  if (await canReach(pool, actor, target)) return;
  throw new UserError(
    `You cannot reach "${target.name}". Bots on your account can talk. Another account needs an approved connection.`,
  );
}

export async function reachableBots(pool: Pool, actor: Actor): Promise<ReachableBot[]> {
  const result = await pool.query<{
    id: string;
    name: string;
    description: string;
    capabilities: string[];
    owner_user_id: string;
    owner_name: string;
  }>(
    `SELECT b.id, b.name, b.description, b.capabilities, b.owner_user_id, u.display_name AS owner_name
     FROM bots b
     JOIN users u ON u.id = b.owner_user_id
     WHERE b.revoked_at IS NULL
       AND u.status = 'active'
       AND (
         b.id = $1
         OR b.owner_user_id = $2
         OR EXISTS (
           SELECT 1 FROM connections c
           JOIN bots ab ON ab.id = $1
           WHERE c.status = 'active' AND c.kind = 'account'
             AND ((c.from_user_id = $2 AND c.to_user_id = b.owner_user_id)
               OR (c.to_user_id = $2 AND c.from_user_id = b.owner_user_id))
             AND (ab.account_links OR ab.created_at <= coalesce(c.decided_at, c.created_at))
             AND (b.account_links OR b.created_at <= coalesce(c.decided_at, c.created_at))
         )
         OR EXISTS (
           SELECT 1 FROM connections c
           WHERE c.status = 'active' AND c.kind = 'bot'
             AND ((c.from_bot_id = $1 AND c.to_bot_id = b.id)
               OR (c.to_bot_id = $1 AND c.from_bot_id = b.id))
         )
       )
     ORDER BY b.name`,
    [actor.id, actor.ownerUserId],
  );
  const relations = new Map<string, ReachableBot['relation']>();
  for (const row of result.rows) {
    if (row.id === actor.id) relations.set(row.id, 'self');
    else if (row.owner_user_id === actor.ownerUserId) relations.set(row.id, 'same_account');
  }
  const links = await pool.query<{ kind: string; from_bot_id: string | null; to_bot_id: string | null; from_user_id: string; to_user_id: string }>(
    `SELECT kind, from_bot_id, to_bot_id, from_user_id, to_user_id
     FROM connections
     WHERE status = 'active'
       AND (from_user_id = $1 OR to_user_id = $1 OR from_bot_id = $2 OR to_bot_id = $2)`,
    [actor.ownerUserId, actor.id],
  );
  for (const row of result.rows) {
    if (relations.has(row.id)) continue;
    const botLink = links.rows.some(
      (link) =>
        link.kind === 'bot' &&
        ((link.from_bot_id === actor.id && link.to_bot_id === row.id) || (link.to_bot_id === actor.id && link.from_bot_id === row.id)),
    );
    relations.set(row.id, botLink ? 'bot_link' : 'account_link');
  }
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    capabilities: row.capabilities,
    relation: relations.get(row.id) ?? 'account_link',
    owner: { id: row.owner_user_id, display_name: row.owner_name },
  }));
}

export async function requestConnection(
  pool: Pool,
  actor: Actor,
  input: { kind: 'account' | 'bot'; email?: string | null; botName?: string | null },
): Promise<{ id: string; status: string }> {
  if (input.kind === 'account') {
    const email = input.email?.trim().toLowerCase();
    if (!email) throw new UserError('An account connection needs the other user\'s email.');
    const target = await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1 AND status = 'active'`, [email]);
    const toUser = target.rows[0];
    if (!toUser) throw new UserError('No active account uses that email.');
    if (toUser.id === actor.ownerUserId) throw new UserError('That account already owns this bot.');
    return insertConnection(pool, { kind: 'account', fromUserId: actor.ownerUserId, toUserId: toUser.id, fromBotId: null, toBotId: null });
  }
  const name = input.botName?.trim().toLowerCase();
  if (!name) throw new UserError('A bot connection needs the other bot\'s name.');
  const target = await pool.query<BotRef>(
    `SELECT id, name, owner_user_id, revoked_at FROM bots WHERE name = $1`,
    [name],
  );
  const bot = target.rows[0];
  if (!bot || bot.revoked_at) throw new UserError(`No active bot named "${name}".`);
  if (bot.owner_user_id === actor.ownerUserId) throw new UserError('That bot is already on your account.');
  return insertConnection(pool, {
    kind: 'bot',
    fromUserId: actor.ownerUserId,
    toUserId: bot.owner_user_id,
    fromBotId: actor.id,
    toBotId: bot.id,
  });
}

async function insertConnection(
  pool: Pool,
  input: { kind: 'account' | 'bot'; fromUserId: string; toUserId: string; fromBotId: string | null; toBotId: string | null },
): Promise<{ id: string; status: string }> {
  const existing = await pool.query<{ id: string; status: string }>(
    `SELECT id, status FROM connections
     WHERE status IN ('pending', 'active')
       AND (
         (kind = 'account' AND $1 = 'account' AND (
            (from_user_id = $2 AND to_user_id = $3) OR (from_user_id = $3 AND to_user_id = $2)
         ))
         OR (kind = 'bot' AND $1 = 'bot' AND (
            (from_bot_id = $4 AND to_bot_id = $5) OR (from_bot_id = $5 AND to_bot_id = $4)
         ))
       )
     LIMIT 1`,
    [input.kind, input.fromUserId, input.toUserId, input.fromBotId, input.toBotId],
  );
  if (existing.rows[0]) {
    throw new UserError(existing.rows[0].status === 'active' ? 'That connection is already active.' : 'That request is already pending.');
  }
  const id = randomUUID();
  await pool.query(
    `INSERT INTO connections (id, kind, from_user_id, from_bot_id, to_user_id, to_bot_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
    [id, input.kind, input.fromUserId, input.fromBotId, input.toUserId, input.toBotId],
  );
  return { id, status: 'pending' };
}

export async function decideConnection(pool: Pool, userId: string, id: string, decision: 'active' | 'declined'): Promise<void> {
  const result = await pool.query(
    `UPDATE connections
     SET status = $3, decided_at = now()
     WHERE id = $1 AND to_user_id = $2 AND status = 'pending'`,
    [id, userId, decision],
  );
  if ((result.rowCount ?? 0) !== 1) throw new UserError('That request is not waiting for you.');
}

export async function revokeConnection(pool: Pool, userId: string, id: string): Promise<void> {
  const result = await pool.query(
    `UPDATE connections
     SET status = 'revoked', revoked_at = now()
     WHERE id = $1 AND status = 'active' AND (from_user_id = $2 OR to_user_id = $2)`,
    [id, userId],
  );
  if ((result.rowCount ?? 0) !== 1) throw new UserError('You cannot revoke that connection.');
}

export async function listConnections(pool: Pool, userId: string) {
  const result = await pool.query(
    `SELECT c.id, c.kind, c.status, c.created_at, c.decided_at,
            fu.display_name AS from_name, tu.display_name AS to_name,
            fb.name AS from_bot, tb.name AS to_bot,
            c.from_user_id, c.to_user_id
     FROM connections c
     JOIN users fu ON fu.id = c.from_user_id
     JOIN users tu ON tu.id = c.to_user_id
     LEFT JOIN bots fb ON fb.id = c.from_bot_id
     LEFT JOIN bots tb ON tb.id = c.to_bot_id
     WHERE c.from_user_id = $1 OR c.to_user_id = $1
     ORDER BY c.created_at DESC`,
    [userId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    status: row.status,
    direction: row.from_user_id === userId ? 'outgoing' : 'incoming',
    from: { name: row.from_name, bot: row.from_bot },
    to: { name: row.to_name, bot: row.to_bot },
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
  }));
}

export async function bindOAuthGrant(
  pool: Pool,
  userId: string,
  input: { botId: string; clientId: string; label?: string | null; grantId?: string | null },
): Promise<{ id: string }> {
  const clientId = normalizeOAuthClientId(input.clientId);
  const bot = await pool.query<{ owner_user_id: string; revoked_at: Date | null }>(
    `SELECT owner_user_id, revoked_at FROM bots WHERE id = $1`,
    [input.botId],
  );
  const row = bot.rows[0];
  if (!row || row.revoked_at || row.owner_user_id !== userId) throw new UserError('Choose one of your active bots.');

  let originName: string | null = null;
  if (input.grantId) {
    const prev = await pool.query<{ clerk_client_id: string; origin_name: string | null; bot_id: string }>(
      `SELECT clerk_client_id, origin_name, bot_id FROM oauth_grants
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [input.grantId, userId],
    );
    const current = prev.rows[0];
    if (!current || current.clerk_client_id !== clientId) throw new UserError('That connection was not found.');
    originName = current.origin_name;
    await pool.query(`UPDATE oauth_grants SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [input.grantId]);
    await pool.query(
      `UPDATE mcp_sessions SET bot_id = $4, last_seen_at = now()
       WHERE user_id = $1 AND kind = 'oauth' AND oauth_client_id = $2 AND bot_id = $3`,
      [userId, clientId, current.bot_id, input.botId],
    );
  } else {
    await pool.query(
      `UPDATE oauth_grants SET revoked_at = now()
       WHERE user_id = $1 AND clerk_client_id = $2 AND revoked_at IS NULL`,
      [userId, clientId],
    );
    await pool.query(
      `UPDATE mcp_sessions SET bot_id = $3, last_seen_at = now()
       WHERE user_id = $1 AND kind = 'oauth' AND oauth_client_id = $2`,
      [userId, clientId, input.botId],
    );
  }
  const id = randomUUID();
  await pool.query(
    `INSERT INTO oauth_grants (id, user_id, bot_id, clerk_client_id, label, origin_name) VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, userId, input.botId, clientId, input.label ?? null, originName],
  );
  await clearOAuthPending(pool, userId, clientId);
  return { id };
}

export interface PendingOAuthClient {
  client_id: string;
  name: string;
  last_seen_at: string;
  last_error: string | null;
}

export async function oauthSplitClients(pool: Pool, userId: string): Promise<boolean> {
  const result = await pool.query<{ oauth_split_clients: boolean }>(
    `SELECT oauth_split_clients FROM users WHERE id = $1`,
    [userId],
  );
  return result.rows[0]?.oauth_split_clients === true;
}

export async function setOauthSplitClients(pool: Pool, userId: string, enabled: boolean): Promise<void> {
  const result = await pool.query(`UPDATE users SET oauth_split_clients = $2, updated_at = now() WHERE id = $1`, [userId, enabled]);
  if ((result.rowCount ?? 0) !== 1) throw new UserError('Account not found.');
}

export async function listPendingOAuthClients(pool: Pool, userId: string): Promise<PendingOAuthClient[]> {
  const result = await pool.query<{ clerk_client_id: string; last_seen_at: Date | string; last_error: string | null }>(
    `SELECT p.clerk_client_id, p.last_seen_at, p.last_error
     FROM oauth_pending_clients p
     WHERE p.user_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM oauth_grants g
         WHERE g.user_id = p.user_id
           AND g.clerk_client_id = p.clerk_client_id
           AND g.revoked_at IS NULL
       )
     ORDER BY p.last_seen_at DESC, p.clerk_client_id`,
    [userId],
  );
  return result.rows.map((row) => ({
    client_id: row.clerk_client_id,
    name: oauthClientName(row.clerk_client_id),
    last_seen_at: row.last_seen_at instanceof Date ? row.last_seen_at.toISOString() : new Date(row.last_seen_at).toISOString(),
    last_error: row.last_error,
  }));
}

export function normalizeOAuthClientId(value: string): string {
  const clientId = value.trim();
  if (!clientId || clientId.length > OAUTH_CLIENT_ID_MAX) {
    throw new UserError(`client_id must be 1–${OAUTH_CLIENT_ID_MAX} characters.`);
  }
  return clientId;
}

export async function clearOAuthPending(pool: Pool, userId: string, clientId: string): Promise<void> {
  await pool.query(`DELETE FROM oauth_pending_clients WHERE user_id = $1 AND clerk_client_id = $2`, [userId, clientId]);
}

export async function noteOAuthPending(pool: Pool, userId: string, clientId: string, message: string): Promise<void> {
  await pool.query(
    `INSERT INTO oauth_pending_clients (user_id, clerk_client_id, last_seen_at, last_error)
     VALUES ($1, $2, now(), $3)
     ON CONFLICT (user_id, clerk_client_id)
     DO UPDATE SET last_seen_at = now(), last_error = EXCLUDED.last_error`,
    [userId, clientId, message.slice(0, 500)],
  );
}

export async function revokeOAuthGrant(pool: Pool, userId: string, grantId: string, isAdmin: boolean): Promise<void> {
  const result = await pool.query(
    `UPDATE oauth_grants SET revoked_at = now()
     WHERE id = $1 AND revoked_at IS NULL AND ($2::boolean OR user_id = $3)`,
    [grantId, isAdmin, userId],
  );
  if ((result.rowCount ?? 0) !== 1) throw new UserError('Grant not found.');
}

export async function resolveGrantBot(
  pool: Pool,
  profile: { userId: string; email: string | null; clientId: string },
  columns: string,
): Promise<{ id: string } | null> {
  const account = await findAccount(pool, profile.userId, profile.email?.toLowerCase() ?? null);
  if (!account || account.status === 'suspended') return null;
  const grant = await pool.query<{ bot_id: string }>(
    `SELECT g.bot_id
     FROM oauth_grants g
     JOIN bots b ON b.id = g.bot_id
     WHERE g.user_id = $1 AND g.clerk_client_id = $2 AND g.revoked_at IS NULL AND b.revoked_at IS NULL`,
    [account.id, profile.clientId || 'default'],
  );
  const botId = grant.rows[0]?.bot_id;
  if (!botId) return null;
  const bot = await pool.query<{ id: string }>(`SELECT id FROM (${columns}) AS bot WHERE id = $1`, [botId]);
  return bot.rows[0] ?? { id: botId };
}

export async function accountIdForClerk(pool: Pool, clerkUserId: string, email: string | null): Promise<string | null> {
  const account = await findAccount(pool, clerkUserId, email?.toLowerCase() ?? null);
  return account?.id ?? null;
}

export async function getSignupMode(pool: Pool): Promise<'open' | 'invite'> {
  const result = await pool.query<{ signup_mode: 'open' | 'invite' }>(`SELECT signup_mode FROM instance_settings WHERE id = 1`);
  return result.rows[0]?.signup_mode ?? 'open';
}

export async function setSignupMode(pool: Pool, mode: 'open' | 'invite'): Promise<void> {
  await pool.query(`UPDATE instance_settings SET signup_mode = $1, signup_locked = true WHERE id = 1`, [mode]);
}

export async function suspendUser(pool: Pool, userId: string, suspended: boolean): Promise<void> {
  if (userId === UNASSIGNED_USER_ID) throw new UserError('The unassigned owner cannot be suspended.');
  const result = await pool.query(`UPDATE users SET status = $2, updated_at = now() WHERE id = $1`, [
    userId,
    suspended ? 'suspended' : 'active',
  ]);
  if ((result.rowCount ?? 0) !== 1) throw new UserError('User not found.');
}

export async function createInvite(pool: Pool, email: string, createdBy: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new UserError('Invite needs an email address.');
  await pool.query(
    `INSERT INTO invites (id, email, created_by) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO NOTHING`,
    [randomUUID(), normalized, createdBy],
  );
}

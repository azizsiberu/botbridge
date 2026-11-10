import { Router, type Request, type Response } from 'express';
import {
  doorbellJob,
  listAdminBots,
  listAdminMessages,
  listAdminTasks,
  listAudit,
  listDoorbell,
  overview,
  settingsPayload,
  threadMessages,
} from './admin-data.js';
import { connectGuide } from './connect-guide.js';
import type { Config } from './config.js';
import type { Pool } from './db.js';
import { processDueJobs } from './doorbell.js';
import { UserError } from './errors.js';
import { isAllowlisted, type AdminAuth, type ClerkDirectory } from './identity.js';
import { log } from './log.js';
import {
  actorById,
  addBot,
  clearWebhook,
  enqueueTestPing,
  getBotById,
  reactivateBot,
  revokeBot,
  rotateBotToken,
  setWebhook,
  updateBotById,
} from './store.js';
import {
  bindOAuthGrant,
  createInvite,
  decideConnection,
  getSignupMode,
  listConnections,
  reachableBots,
  revokeConnection,
  revokeOAuthGrant,
  setSignupMode,
  suspendUser,
  syncAccount,
  type Account,
} from './tenancy.js';
import { isUuid } from './text.js';

interface Deps {
  pool: Pool;
  config: Config;
  adminAuth: AdminAuth;
  directory: ClerkDirectory | null;
}

export function adminRouter(deps: Deps): Router {
  const router = Router();
  router.use((req, res, next) => {
    void guard(deps, req, res)
      .then((account) => {
        if (!account) return;
        res.locals.account = account;
        next();
      })
      .catch(next);
  });

  router.get('/me', async (_req, res) => {
    const account = current(res);
    res.json({
      account: publicAccount(account),
      signupMode: await getSignupMode(deps.pool),
    });
  });

  router.get('/overview', async (req, res) => {
    const days = req.query.days === '30' ? 30 : 14;
    res.json(await overview(deps.pool, days, scope(current(res))));
  });

  router.get('/settings', async (_req, res) => {
    const account = current(res);
    res.json({
      ...settingsPayload(deps.config),
      signupMode: await getSignupMode(deps.pool),
      isAdmin: account.isAdmin,
      allowlist: account.isAdmin ? settingsPayload(deps.config).allowlist : undefined,
    });
  });

  router.get('/bots', async (req, res) => {
    const account = current(res);
    const owner = req.query.all === '1' && account.isAdmin ? null : account.id;
    res.json({ bots: await listAdminBots(deps.pool, text(req.query.q), owner) });
  });

  router.post('/bots', async (req, res) => {
    const account = current(res);
    const body = objectBody(req);
    const created = await addBot(deps.pool, {
      name: stringField(body, 'name'),
      description: optionalString(body, 'description') ?? '',
      capabilities: optionalString(body, 'capabilities') ?? '',
      ownerUserId: account.id,
    });
    res.status(201).json({
      bot: created.bot,
      token: created.token,
      guide: connectGuide(deps.config.publicUrl, Boolean(deps.config.clerkPublishableKey), created.token),
    });
  });

  router.get('/bots/:id', async (req, res) => {
    const bot = await requireOwned(deps.pool, req.params.id, current(res));
    const bots = await listAdminBots(deps.pool, '', current(res).isAdmin ? null : current(res).id);
    res.json({ bot: bots.find((item) => item.id === bot.id) });
  });

  router.get('/bots/:id/reach', async (req, res) => {
    const bot = await requireOwned(deps.pool, req.params.id, current(res));
    const actor = await actorById(deps.pool, bot.id);
    res.json({ bots: actor ? await reachableBots(deps.pool, actor) : [] });
  });

  router.patch('/bots/:id', async (req, res) => {
    await requireOwned(deps.pool, req.params.id, current(res));
    const body = objectBody(req);
    const bot = await updateBotById(deps.pool, req.params.id, {
      name: optionalString(body, 'name'),
      description: optionalString(body, 'description'),
      capabilities: optionalString(body, 'capabilities'),
    });
    res.json({ bot });
  });

  router.post('/bots/:id/revoke', async (req, res) => {
    const bot = await requireOwned(deps.pool, req.params.id, current(res));
    await revokeBot(deps.pool, bot.name);
    res.json({ ok: true });
  });

  router.post('/bots/:id/reactivate', async (req, res) => {
    await requireOwned(deps.pool, req.params.id, current(res));
    await reactivateBot(deps.pool, req.params.id);
    res.json({ ok: true });
  });

  router.post('/bots/:id/rotate-token', async (req, res) => {
    await requireOwned(deps.pool, req.params.id, current(res));
    const rotated = await rotateBotToken(deps.pool, req.params.id);
    res.json({
      token: rotated.token,
      guide: connectGuide(deps.config.publicUrl, Boolean(deps.config.clerkPublishableKey), rotated.token),
    });
  });

  router.put('/bots/:id/webhook', async (req, res) => {
    const bot = await requireOwned(deps.pool, req.params.id, current(res));
    const body = objectBody(req);
    const saved = await setWebhook(deps.pool, deps.config.secret, {
      name: bot.name,
      url: stringField(body, 'url'),
      profile: stringField(body, 'profile'),
      secret: optionalString(body, 'secret'),
    });
    res.json({ ok: true, generated: saved.generated, secret: saved.generated ? saved.secret : undefined });
  });

  router.delete('/bots/:id/webhook', async (req, res) => {
    const bot = await requireOwned(deps.pool, req.params.id, current(res));
    await clearWebhook(deps.pool, bot.name);
    res.json({ ok: true });
  });

  router.post('/bots/:id/webhook/test', async (req, res) => {
    await requireOwned(deps.pool, req.params.id, current(res));
    const id = await enqueueTestPing(deps.pool, req.params.id);
    await processDueJobs(deps.pool, deps.config.secret);
    res.json({ delivery: await doorbellJob(deps.pool, id) });
  });

  router.get('/bots/:id/connect', async (req, res) => {
    await requireOwned(deps.pool, req.params.id, current(res));
    res.json(connectGuide(deps.config.publicUrl, Boolean(deps.config.clerkPublishableKey)));
  });

  router.get('/connections', async (_req, res) => {
    res.json({ connections: await listConnections(deps.pool, current(res).id) });
  });

  router.post('/connections/:id/approve', async (req, res) => {
    await decideConnection(deps.pool, current(res).id, req.params.id, 'active');
    res.json({ ok: true });
  });

  router.post('/connections/:id/decline', async (req, res) => {
    await decideConnection(deps.pool, current(res).id, req.params.id, 'declined');
    res.json({ ok: true });
  });

  router.post('/connections/:id/revoke', async (req, res) => {
    await revokeConnection(deps.pool, current(res).id, req.params.id);
    res.json({ ok: true });
  });

  router.get('/grants', async (_req, res) => {
    const account = current(res);
    const result = await deps.pool.query(
      `SELECT g.id, g.clerk_client_id, g.label, g.created_at, g.revoked_at, b.id AS bot_id, b.name AS bot_name
       FROM oauth_grants g JOIN bots b ON b.id = g.bot_id
       WHERE g.user_id = $1
       ORDER BY g.created_at DESC`,
      [account.id],
    );
    res.json({
      grants: result.rows.map((row) => ({
        id: row.id,
        client_id: row.clerk_client_id,
        label: row.label,
        created_at: row.created_at,
        revoked_at: row.revoked_at,
        bot: { id: row.bot_id, name: row.bot_name },
      })),
    });
  });

  router.post('/grants', async (req, res) => {
    const body = objectBody(req);
    const created = await bindOAuthGrant(deps.pool, current(res).id, {
      botId: stringField(body, 'bot_id'),
      clientId: stringField(body, 'client_id'),
      label: optionalString(body, 'label'),
    });
    res.status(201).json(created);
  });

  router.post('/grants/:id/revoke', async (req, res) => {
    const account = current(res);
    await revokeOAuthGrant(deps.pool, account.id, req.params.id, account.isAdmin);
    res.json({ ok: true });
  });

  router.get('/messages', async (req, res) => {
    const thread = optionalQuery(req, 'thread');
    if (thread && !isUuid(thread)) throw new UserError('thread must be a UUID.');
    res.json(
      await listAdminMessages(deps.pool, {
        from: text(req.query.from),
        to: text(req.query.to),
        thread,
        unread: req.query.unread === '1' || req.query.unread === 'true',
        after: optionalQuery(req, 'after'),
        before: optionalQuery(req, 'before'),
        q: text(req.query.q),
        limit: limitOf(req, 50, 200),
        offset: offsetOf(req),
        ownerUserId: scope(current(res)),
      }),
    );
  });

  router.get('/threads/:id', async (req, res) => {
    if (!isUuid(req.params.id)) throw new UserError('thread must be a UUID.');
    const messages = await threadMessages(deps.pool, req.params.id, scope(current(res)));
    if (messages.length === 0) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ thread_id: req.params.id, messages });
  });

  router.get('/tasks', async (req, res) => {
    const status = optionalQuery(req, 'status');
    if (status && status !== 'open' && status !== 'completed') throw new UserError('status must be open or completed.');
    res.json({ tasks: await listAdminTasks(deps.pool, status ?? null, text(req.query.q), scope(current(res))) });
  });

  router.get('/audit', async (req, res) => {
    res.json(
      await listAudit(deps.pool, {
        action: text(req.query.action),
        actor: text(req.query.actor),
        after: optionalQuery(req, 'after'),
        before: optionalQuery(req, 'before'),
        limit: limitOf(req, 50, 200),
        offset: offsetOf(req),
        ownerUserId: scope(current(res)),
      }),
    );
  });

  router.get('/doorbell', async (req, res) => {
    const state = optionalQuery(req, 'state');
    if (state && !['delivered', 'pending', 'failed'].includes(state)) {
      throw new UserError('state must be delivered, pending, or failed.');
    }
    res.json(
      await listDoorbell(deps.pool, {
        bot: text(req.query.bot),
        state,
        limit: limitOf(req, 50, 200),
        offset: offsetOf(req),
        ownerUserId: scope(current(res)),
      }),
    );
  });

  router.get('/admin/users', async (_req, res) => {
    assertAdmin(current(res));
    const result = await deps.pool.query(
      `SELECT u.id, u.email, u.display_name, u.status, u.clerk_user_id, u.created_at,
              count(b.id)::int AS bots
       FROM users u
       LEFT JOIN bots b ON b.owner_user_id = u.id
       GROUP BY u.id
       ORDER BY u.created_at`,
    );
    res.json({ users: result.rows });
  });

  router.post('/admin/users/:id/suspend', async (req, res) => {
    assertAdmin(current(res));
    const body = objectBody(req);
    await suspendUser(deps.pool, req.params.id, body.suspended !== false);
    res.json({ ok: true });
  });

  router.post('/admin/invites', async (req, res) => {
    const account = current(res);
    assertAdmin(account);
    const body = objectBody(req);
    await createInvite(deps.pool, stringField(body, 'email'), account.id);
    res.status(201).json({ ok: true });
  });

  router.post('/admin/signup', async (req, res) => {
    assertAdmin(current(res));
    const body = objectBody(req);
    const mode = stringField(body, 'mode');
    if (mode !== 'open' && mode !== 'invite') throw new UserError('mode must be open or invite.');
    await setSignupMode(deps.pool, mode);
    res.json({ signupMode: mode });
  });

  router.use((error: unknown, _req: Request, res: Response, next: (error?: unknown) => void) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (error instanceof UserError) {
      const status = error.message === 'Instance admins only.' ? 403 : 400;
      res.status(status).json({ error: status === 403 ? 'forbidden' : 'invalid', message: error.message });
      return;
    }
    log('error', 'admin route failed', { error: error instanceof Error ? error.message : 'unknown' });
    res.status(500).json({ error: 'internal_error' });
  });

  return router;
}

function current(res: Response): Account {
  return res.locals.account as Account;
}

function scope(account: Account): string | null {
  return account.isAdmin ? null : account.id;
}

function assertAdmin(account: Account): void {
  if (!account.isAdmin) throw new UserError('Instance admins only.');
}

async function guard(deps: Deps, req: Request, res: Response): Promise<Account | null> {
  const header = req.header('authorization') ?? '';
  const token = /^bearer\s+/i.test(header) ? header.replace(/^bearer\s+/i, '').trim() : '';
  if (!token) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  const identity = await deps.adminAuth.verifySession(token);
  if (!identity) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  const isAdmin = isAllowlisted(deps.config, identity);
  try {
    return await syncAccount(deps.pool, deps.config, identity, isAdmin);
  } catch (error) {
    const message = error instanceof UserError ? error.message : 'Could not open this account.';
    const status = message.includes('suspended') || message.includes('invite') ? 403 : 400;
    res.status(status).json({ error: status === 403 ? 'forbidden' : 'invalid', message });
    return null;
  }
}

async function requireOwned(pool: Pool, id: string | undefined, account: Account) {
  if (!isUuid(id ?? '')) throw new UserError('Bot id must be a UUID.');
  const bot = await getBotById(pool, id ?? '');
  if (!bot) throw new UserError('Bot not found.');
  if (!account.isAdmin && bot.owner_user_id !== account.id) throw new UserError('Bot not found.');
  return bot;
}

function objectBody(req: Request): Record<string, unknown> {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    throw new UserError('JSON object body is required.');
  }
  return req.body as Record<string, unknown>;
}

function stringField(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || value.trim() === '') throw new UserError(`${key} is required.`);
  return value;
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new UserError(`${key} must be a string.`);
  return value;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalQuery(req: Request, key: string): string | undefined {
  const value = text(req.query[key]);
  return value || undefined;
}

function limitOf(req: Request, fallback: number, max: number): number {
  const raw = text(req.query.limit);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new UserError(`limit must be an integer from 1 to ${max}.`);
  }
  return parsed;
}

function offsetOf(req: Request): number {
  const raw = text(req.query.offset);
  if (!raw) return 0;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 5000) throw new UserError('offset must be an integer from 0 to 5000.');
  return parsed;
}

function publicAccount(account: Account) {
  return {
    id: account.id,
    email: account.email,
    displayName: account.displayName,
    isAdmin: account.isAdmin,
    status: account.status,
  };
}

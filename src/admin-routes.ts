import { Router, type Request, type Response } from 'express';
import { connectGuide } from './connect-guide.js';
import type { Config } from './config.js';
import type { Pool } from './db.js';
import { processDueJobs } from './doorbell.js';
import { UserError } from './errors.js';
import { log } from './log.js';
import {
  allowlistConfigured,
  isAllowlisted,
  type AdminAuth,
  type AdminIdentity,
  type ClerkDirectory,
} from './identity.js';
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
import {
  addBot,
  clearWebhook,
  enqueueTestPing,
  getBotById,
  reactivateBot,
  revokeBot,
  rotateBotToken,
  setClerkLink,
  setWebhook,
  updateBotById,
} from './store.js';
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
    void guard(deps, req, res).then((identity) => {
      if (!identity) return;
      res.locals.admin = identity;
      next();
    }).catch(next);
  });

  router.get('/overview', async (req, res) => {
    const days = req.query.days === '30' ? 30 : 14;
    res.json(await overview(deps.pool, days));
  });

  router.get('/settings', (_req, res) => {
    res.json(settingsPayload(deps.config));
  });

  router.get('/bots', async (req, res) => {
    res.json({ bots: await listAdminBots(deps.pool, text(req.query.q)) });
  });

  router.post('/bots', async (req, res) => {
    const body = objectBody(req);
    const created = await addBot(deps.pool, {
      name: stringField(body, 'name'),
      description: optionalString(body, 'description') ?? '',
      capabilities: optionalString(body, 'capabilities') ?? '',
    });
    res.status(201).json({
      bot: created.bot,
      token: created.token,
      guide: connectGuide(deps.config.publicUrl, Boolean(deps.config.clerkPublishableKey), created.token),
    });
  });

  router.get('/bots/:id', async (req, res) => {
    const bot = await requireBot(deps.pool, req.params.id);
    const bots = await listAdminBots(deps.pool, '');
    const found = bots.find((item) => item.id === bot.id);
    res.json({ bot: found });
  });

  router.patch('/bots/:id', async (req, res) => {
    const body = objectBody(req);
    const bot = await updateBotById(deps.pool, req.params.id, {
      name: optionalString(body, 'name'),
      description: optionalString(body, 'description'),
      capabilities: optionalString(body, 'capabilities'),
    });
    res.json({ bot });
  });

  router.post('/bots/:id/revoke', async (req, res) => {
    const bot = await requireBot(deps.pool, req.params.id);
    await revokeBot(deps.pool, bot.name);
    res.json({ ok: true });
  });

  router.post('/bots/:id/reactivate', async (req, res) => {
    await reactivateBot(deps.pool, req.params.id);
    res.json({ ok: true });
  });

  router.post('/bots/:id/rotate-token', async (req, res) => {
    const rotated = await rotateBotToken(deps.pool, req.params.id);
    res.json({
      token: rotated.token,
      guide: connectGuide(deps.config.publicUrl, Boolean(deps.config.clerkPublishableKey), rotated.token),
    });
  });

  router.put('/bots/:id/webhook', async (req, res) => {
    const bot = await requireBot(deps.pool, req.params.id);
    const body = objectBody(req);
    const saved = await setWebhook(deps.pool, deps.config.secret, {
      name: bot.name,
      url: stringField(body, 'url'),
      profile: stringField(body, 'profile'),
      secret: optionalString(body, 'secret'),
    });
    res.json({
      ok: true,
      generated: saved.generated,
      secret: saved.generated ? saved.secret : undefined,
    });
  });

  router.delete('/bots/:id/webhook', async (req, res) => {
    const bot = await requireBot(deps.pool, req.params.id);
    await clearWebhook(deps.pool, bot.name);
    res.json({ ok: true });
  });

  router.post('/bots/:id/webhook/test', async (req, res) => {
    const id = await enqueueTestPing(deps.pool, req.params.id);
    await processDueJobs(deps.pool, deps.config.secret);
    const job = await doorbellJob(deps.pool, id);
    res.json({ delivery: job });
  });

  router.put('/bots/:id/clerk', async (req, res) => {
    const body = objectBody(req);
    const clear = body.clear === true;
    if (clear) {
      await setClerkLink(deps.pool, req.params.id, { userId: null, email: null });
      res.json({ ok: true });
      return;
    }
    const userId = optionalString(body, 'clerk_user_id');
    const email = optionalString(body, 'clerk_email');
    if (!userId && !email) throw new UserError('Provide a Clerk user id or email, or clear the link.');
    let resolved = { userId: userId ?? null, email: email ?? null };
    if (deps.directory) {
      const found = await deps.directory.lookup({ userId, email });
      if (!found) throw new UserError('Clerk has no user with that id or email.');
      resolved = { userId: found.userId, email: found.email ?? email ?? null };
    }
    await setClerkLink(deps.pool, req.params.id, resolved);
    res.json({ ok: true, clerk_user_id: resolved.userId, clerk_email: resolved.email });
  });

  router.get('/bots/:id/connect', async (req, res) => {
    await requireBot(deps.pool, req.params.id);
    res.json(connectGuide(deps.config.publicUrl, Boolean(deps.config.clerkPublishableKey)));
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
        limit: limit(req, 50, 200),
        offset: offset(req),
      }),
    );
  });

  router.get('/threads/:id', async (req, res) => {
    if (!isUuid(req.params.id)) throw new UserError('thread must be a UUID.');
    const messages = await threadMessages(deps.pool, req.params.id);
    if (messages.length === 0) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ thread_id: req.params.id, messages });
  });

  router.get('/tasks', async (req, res) => {
    const status = optionalQuery(req, 'status');
    if (status && status !== 'open' && status !== 'completed') throw new UserError('status must be open or completed.');
    res.json({ tasks: await listAdminTasks(deps.pool, status ?? null, text(req.query.q)) });
  });

  router.get('/audit', async (req, res) => {
    res.json(
      await listAudit(deps.pool, {
        action: text(req.query.action),
        actor: text(req.query.actor),
        after: optionalQuery(req, 'after'),
        before: optionalQuery(req, 'before'),
        limit: limit(req, 50, 200),
        offset: offset(req),
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
        limit: limit(req, 50, 200),
        offset: offset(req),
      }),
    );
  });

  router.use((error: unknown, _req: Request, res: Response, next: (error?: unknown) => void) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (error instanceof UserError) {
      res.status(400).json({ error: 'invalid', message: error.message });
      return;
    }
    log('error', 'admin route failed', { error: error instanceof Error ? error.message : 'unknown' });
    res.status(500).json({ error: 'internal_error' });
  });

  return router;
}

async function guard(deps: Deps, req: Request, res: Response): Promise<AdminIdentity | null> {
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
  if (!allowlistConfigured(deps.config) || !isAllowlisted(deps.config, identity)) {
    res.status(403).json({
      error: 'forbidden',
      message: 'This account is not on the botbridge admin allowlist.',
    });
    return null;
  }
  return identity;
}

async function requireBot(pool: Pool, id: string) {
  if (!isUuid(id ?? '')) throw new UserError('Bot id must be a UUID.');
  const bot = await getBotById(pool, id);
  if (!bot) throw new UserError('Bot not found.');
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

function limit(req: Request, fallback: number, max: number): number {
  const raw = text(req.query.limit);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new UserError(`limit must be an integer from 1 to ${max}.`);
  }
  return parsed;
}

function offset(req: Request): number {
  const raw = text(req.query.offset);
  if (!raw) return 0;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 5000) throw new UserError('offset must be an integer from 0 to 5000.');
  return parsed;
}

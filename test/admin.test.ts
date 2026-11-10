import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AdminIdentity } from '../src/identity.js';
import { connectClient, issueBot, listenForTests, resetDb, toolJson, type TestServer } from './helpers.js';

const admin: AdminIdentity = { userId: 'user_admin', email: 'admin@example.com', orgRoles: [] };

describe('admin api', () => {
  let app: TestServer;
  let hook: Server;
  let hookUrl = '';
  let hits = 0;

  beforeAll(async () => {
    app = await listenForTests(
      { adminEmails: ['admin@example.com'] },
      {
        adminAuth: {
          async verifySession(token) {
            if (token === 'admin') return admin;
            if (token === 'stranger') return { userId: 'user_stranger', email: 'nope@example.com', orgRoles: [] };
            return null;
          },
        },
        directory: {
          async lookup(input) {
            if (input.email === 'ada@example.com') return { userId: 'user_ada', email: 'ada@example.com' };
            if (input.userId === 'user_ada') return { userId: 'user_ada', email: 'ada@example.com' };
            return null;
          },
        },
      },
    );
    hook = createServer((_req, res) => {
      hits += 1;
      res.statusCode = 204;
      res.end();
    });
    await new Promise<void>((resolve) => hook.listen(0, '127.0.0.1', resolve));
    const address = hook.address();
    if (!address || typeof address === 'string') throw new Error('hook did not bind');
    hookUrl = `http://127.0.0.1:${address.port}/hook`;
  });

  beforeEach(async () => {
    await resetDb(app.pool);
    hits = 0;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => hook.close((error) => (error ? reject(error) : resolve())));
    await app.close();
  });

  it('rejects missing and non-allowlisted sessions', async () => {
    const missing = await fetch(`${app.baseUrl}/api/admin/overview`);
    expect(missing.status).toBe(401);
    const stranger = await call(app, '/api/admin/overview', 'stranger');
    expect(stranger.status).toBe(200);
    const adminOnly = await call(app, '/api/admin/admin/users', 'stranger');
    expect(adminOnly.status).toBe(403);
  });

  it('creates a bot, rotates the token, and serves the directory', async () => {
    const created = await call(app, '/api/admin/bots', 'admin', {
      method: 'POST',
      body: JSON.stringify({ name: 'Ada', description: 'Writes', capabilities: 'writing,edit' }),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { token: string; bot: { id: string; name: string }; guide: { mcpUrl: string } };
    expect(body.token.startsWith('bb_')).toBe(true);
    expect(body.bot.name).toBe('ada');
    expect(body.guide.mcpUrl.endsWith('/mcp')).toBe(true);

    const listed = await json<{ bots: Array<{ name: string; token_prefix: string }> }>(app, '/api/admin/bots?q=ada');
    expect(listed.bots[0]?.name).toBe('ada');
    expect(JSON.stringify(listed)).not.toContain(body.token);

    const client = await connectClient(app.baseUrl, body.token, 'ada');
    const who = toolJson(await client.callTool({ name: 'whoami', arguments: {} }));
    expect(who.auth).toBe('token');
    await client.close();

    const rotated = await json<{ token: string }>(app, `/api/admin/bots/${body.bot.id}/rotate-token`, { method: 'POST' });
    expect(rotated.token).not.toBe(body.token);
    const stale = await fetch(`${app.baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${body.token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(stale.status).toBe(401);

    await call(app, `/api/admin/bots/${body.bot.id}/revoke`, 'admin', { method: 'POST' });
    const revoked = await fetch(`${app.baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${rotated.token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(revoked.status).toBe(401);
    await call(app, `/api/admin/bots/${body.bot.id}/reactivate`, 'admin', { method: 'POST' });
    const back = await connectClient(app.baseUrl, rotated.token, 'ada');
    expect(toolJson(await back.callTool({ name: 'whoami', arguments: {} })).name).toBe('ada');
    await back.close();
  });

  it('filters mail, tasks, audit, and a doorbell test', async () => {
    const alice = await issueBot(app.pool, 'alice');
    const bob = await issueBot(app.pool, 'bob');
    const aliceClient = await connectClient(app.baseUrl, alice.token, 'alice');
    const sent = toolJson(await aliceClient.callTool({ name: 'send_message', arguments: { to: 'bob', text: 'Proof in the inbox.' } }));
    await aliceClient.callTool({ name: 'post_task', arguments: { to: 'bob', instructions: 'Read the proof.' } });
    await aliceClient.close();

    const mail = await json<{ messages: Array<{ text: string; thread_id: string }> }>(app, '/api/admin/messages?from=alice&unread=1&q=proof');
    expect(mail.messages).toHaveLength(1);
    const thread = await json<{ messages: unknown[] }>(app, `/api/admin/threads/${mail.messages[0]?.thread_id}`);
    expect(thread.messages.length).toBeGreaterThan(0);
    expect(sent.thread_id).toBe(mail.messages[0]?.thread_id);

    const tasks = await json<{ tasks: Array<{ status: string }> }>(app, '/api/admin/tasks?status=open');
    expect(tasks.tasks).toHaveLength(1);

    const audit = await json<{ entries: Array<{ action: string }> }>(app, '/api/admin/audit?action=message.sent');
    expect(audit.entries.some((entry) => entry.action === 'message.sent')).toBe(true);

    const saved = await call(app, `/api/admin/bots/${bob.id}/webhook`, 'admin', {
      method: 'PUT',
      body: JSON.stringify({ url: hookUrl, profile: 'generic' }),
    });
    const savedBody = (await saved.json()) as { generated: boolean; secret?: string };
    expect(savedBody.generated).toBe(true);
    expect(savedBody.secret?.startsWith('bbs_')).toBe(true);

    const ping = await json<{ delivery: { state: string; last_status: number } }>(app, `/api/admin/bots/${bob.id}/webhook/test`, {
      method: 'POST',
    });
    expect(ping.delivery.state).toBe('delivered');
    expect(ping.delivery.last_status).toBe(204);
    expect(hits).toBe(1);

    const log = await json<{ deliveries: Array<{ event: string }> }>(app, '/api/admin/doorbell?state=delivered&bot=bob');
    expect(log.deliveries.some((row) => row.event === 'doorbell.test')).toBe(true);

    const stats = await json<{ bots: { active: number }; messages: { series: unknown[] } }>(app, '/api/admin/overview');
    expect(stats.bots.active).toBeGreaterThanOrEqual(2);
    expect(stats.messages.series.length).toBe(14);

    const settings = await json<{ version: string; isAdmin: boolean }>(app, '/api/admin/settings');
    expect(settings.version).toBe('0.2.0');
    expect(settings.isAdmin).toBe(true);
    void bob;
  });
});

async function call(app: TestServer, path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${app.baseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

async function json<T>(app: TestServer, path: string, init: RequestInit = {}): Promise<T> {
  const response = await call(app, path, 'admin', init);
  expect(response.ok, `${path} ${response.status} ${await response.clone().text()}`).toBe(true);
  return (await response.json()) as T;
}

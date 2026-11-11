import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectClient, issueBot, listenForTests, resetDb, toolJson, type TestServer } from './helpers.js';
import { bindOAuthGrant, revokeOAuthGrant, syncAccount } from '../src/tenancy.js';
import { addBot, revokeBot } from '../src/store.js';

const future = Math.floor(Date.now() / 1000) + 3600;
const cursorClientId = 'https://cursor.com/oauth/mcp-client.json';

describe('oauth bot binding', () => {
  let app: TestServer;

  beforeAll(async () => {
    app = await listenForTests(
      { publicUrl: 'http://127.0.0.1:8799' },
      {
        oauth: {
          async verifyAccessToken(token) {
            if (token === 'oauth-ada') {
              return { userId: 'user_ada', email: 'ada@example.com', expiresAt: future, scopes: ['profile', 'email'], clientId: 'chatgpt' };
            }
            if (token === 'oauth-cursor') {
              return {
                userId: 'user_ada',
                email: 'ada@example.com',
                expiresAt: future,
                scopes: ['profile', 'email'],
                clientId: cursorClientId,
              };
            }
            return null;
          },
        },
        adminAuth: {
          async verifySession(token) {
            if (token === 'ada') return { userId: 'user_ada', email: 'ada@example.com', orgRoles: [] };
            if (token === 'bea') return { userId: 'user_bea', email: 'bea@example.com', orgRoles: [] };
            return null;
          },
        },
      },
    );
  });

  beforeEach(async () => {
    await resetDb(app.pool);
  });

  afterAll(async () => {
    await app.close();
  });

  it('refuses an unbound oauth client and uses the bot the user chose', async () => {
    const account = await syncAccount(app.pool, app.config, { userId: 'user_ada', email: 'ada@example.com', orgRoles: [] }, false);
    const writing = await addBot(app.pool, { name: 'ada-writer', ownerUserId: account.id, description: 'Writes' });
    await addBot(app.pool, { name: 'ada-review', ownerUserId: account.id });

    const unbound = await mcp(app, 'oauth-ada');
    expect(unbound.status).toBe(401);
    expect(await unbound.text()).toContain('/oauth/choose');

    const waiting = await pending(app, 'ada');
    expect(waiting.clients.map((client) => client.client_id)).toEqual(['chatgpt']);
    expect(waiting.clients[0]?.name).toBe('chatgpt');

    await bindOAuthGrant(app.pool, account.id, { botId: writing.bot.id, clientId: 'chatgpt', label: 'ChatGPT' });
    expect((await pending(app, 'ada')).clients).toEqual([]);

    const client = await connectClient(app.baseUrl, 'oauth-ada', 'chatgpt');
    const who = toolJson(await client.callTool({ name: 'whoami', arguments: {} }));
    expect(who.name).toBe('ada-writer');
    expect(who.auth).toBe('oauth');
    await client.close();

    const bob = await issueBot(app.pool, 'bob');
    const staticClient = await connectClient(app.baseUrl, bob.token, 'bob');
    expect(toolJson(await staticClient.callTool({ name: 'whoami', arguments: {} })).auth).toBe('token');
    await staticClient.close();
  });

  it('binds the only active bot on the first verified token and records the audit', async () => {
    const account = await syncAccount(app.pool, app.config, { userId: 'user_ada', email: 'ada@example.com', orgRoles: [] }, false);
    await addBot(app.pool, { name: 'ada-writer', ownerUserId: account.id });
    const spare = await addBot(app.pool, { name: 'ada-spare', ownerUserId: account.id });
    await revokeBot(app.pool, spare.bot.name);

    const client = await connectClient(app.baseUrl, 'oauth-cursor', 'cursor');
    const who = toolJson(await client.callTool({ name: 'whoami', arguments: {} }));
    expect(who.name).toBe('ada-writer');
    expect(who.auth).toBe('oauth');
    await client.close();

    const grants = await app.pool.query<{ clerk_client_id: string; label: string; active: number }>(
      `SELECT clerk_client_id, label, count(*) FILTER (WHERE revoked_at IS NULL)::int AS active
       FROM oauth_grants WHERE user_id = $1 GROUP BY clerk_client_id, label`,
      [account.id],
    );
    expect(grants.rows).toEqual([{ clerk_client_id: cursorClientId, label: 'cursor.com', active: 1 }]);

    const audit = await app.pool.query<{ action: string; detail: { client_id: string; label: string; bot: string } }>(
      `SELECT action, detail FROM audit_log WHERE action = 'oauth.grant.auto'`,
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.detail).toMatchObject({ client_id: cursorClientId, label: 'cursor.com', bot: 'ada-writer' });
    expect((await pending(app, 'ada')).clients).toEqual([]);

    const again = await connectClient(app.baseUrl, 'oauth-cursor', 'cursor-again');
    expect(toolJson(await again.callTool({ name: 'whoami', arguments: {} })).name).toBe('ada-writer');
    await again.close();
    const audits = await app.pool.query(`SELECT 1 FROM audit_log WHERE action = 'oauth.grant.auto'`);
    expect(audits.rowCount).toBe(1);
  });

  it('keeps a revoked grant revoked and shows the client on the desk', async () => {
    const account = await syncAccount(app.pool, app.config, { userId: 'user_ada', email: 'ada@example.com', orgRoles: [] }, false);
    await addBot(app.pool, { name: 'ada-writer', ownerUserId: account.id });
    const first = await mcp(app, 'oauth-cursor');
    expect(first.status).not.toBe(401);

    const grant = await app.pool.query<{ id: string }>(
      `SELECT id FROM oauth_grants WHERE user_id = $1 AND revoked_at IS NULL`,
      [account.id],
    );
    await revokeOAuthGrant(app.pool, account.id, grant.rows[0]?.id ?? '', false);

    const unbound = await mcp(app, 'oauth-cursor');
    expect(unbound.status).toBe(401);
    const body = await unbound.text();
    expect(body).toContain('/oauth/choose');
    expect(body).toContain(encodeURIComponent(cursorClientId));

    const waiting = await pending(app, 'ada');
    expect(waiting.clients).toEqual([
      expect.objectContaining({ client_id: cursorClientId, name: 'cursor.com' }),
    ]);
    const other = await pending(app, 'bea');
    expect(other.clients).toEqual([]);
    const anonymous = await fetch(`${app.baseUrl}/api/admin/oauth/pending`);
    expect(anonymous.status).toBe(401);

    const active = await app.pool.query(`SELECT 1 FROM oauth_grants WHERE user_id = $1 AND revoked_at IS NULL`, [account.id]);
    expect(active.rowCount).toBe(0);
  });

  it('records a pending client when the account has no bot yet', async () => {
    await syncAccount(app.pool, app.config, { userId: 'user_ada', email: 'ada@example.com', orgRoles: [] }, false);
    const unbound = await mcp(app, 'oauth-ada');
    expect(unbound.status).toBe(401);
    expect((await pending(app, 'ada')).clients.map((client) => client.name)).toEqual(['chatgpt']);
    const grants = await app.pool.query(`SELECT 1 FROM oauth_grants`);
    expect(grants.rowCount).toBe(0);
  });
});

async function mcp(app: TestServer, token: string): Promise<Response> {
  return fetch(`${app.baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
}

async function pending(app: TestServer, token: string): Promise<{ clients: Array<{ client_id: string; name: string; last_seen_at: string }> }> {
  const response = await fetch(`${app.baseUrl}/api/admin/oauth/pending`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { clients: Array<{ client_id: string; name: string; last_seen_at: string }> };
}

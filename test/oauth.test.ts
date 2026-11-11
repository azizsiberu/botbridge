import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectClient, issueBot, listenForTests, resetDb, toolJson, type TestServer } from './helpers.js';
import { syncAccount } from '../src/tenancy.js';
import { addBot } from '../src/store.js';

const future = Math.floor(Date.now() / 1000) + 3600;
const cursorClientId = 'https://cursor.com/oauth/mcp-client.json';

describe('oauth registration', () => {
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
            if (token === 'oauth-other') {
              return {
                userId: 'user_ada',
                email: 'ada@example.com',
                expiresAt: future,
                scopes: ['profile', 'email'],
                clientId: 'https://claude.ai/oauth/claude-code-client',
              };
            }
            return null;
          },
        },
        adminAuth: {
          async verifySession(token) {
            if (token === 'ada') return { userId: 'user_ada', email: 'ada@example.com', orgRoles: [] };
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

  it('creates a bot from clientInfo on the first OAuth connection and reuses it', async () => {
    const account = await syncAccount(app.pool, app.config, { userId: 'user_ada', email: 'ada@example.com', orgRoles: [] }, false);
    await addBot(app.pool, { name: 'ada-writer', ownerUserId: account.id, description: 'Writes' });
    await addBot(app.pool, { name: 'ada-review', ownerUserId: account.id });

    const client = await connectClient(app.baseUrl, 'oauth-cursor', 'Cursor', { title: 'Inbox' });
    const who = toolJson(await client.callTool({ name: 'whoami', arguments: {} }));
    expect(who.name).toBe('cursor-inbox');
    expect(who.auth).toBe('oauth');
    expect(who.description).toContain('OAuth');
    await client.close();

    const again = await connectClient(app.baseUrl, 'oauth-cursor', 'Cursor', { title: 'Inbox' });
    expect(toolJson(await again.callTool({ name: 'whoami', arguments: {} })).name).toBe('cursor-inbox');
    await again.close();

    const names = await app.pool.query<{ name: string }>(
      `SELECT name FROM bots WHERE owner_user_id = $1 ORDER BY name`,
      [account.id],
    );
    expect(names.rows.map((row) => row.name)).toEqual(['ada-review', 'ada-writer', 'cursor-inbox']);

    const audit = await app.pool.query<{ detail: { client_id: string; name: string } }>(
      `SELECT detail FROM audit_log WHERE action = 'oauth.bot.auto_created'`,
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.detail).toMatchObject({ client_id: cursorClientId, name: 'cursor-inbox' });
    expect((await pending(app, 'ada')).clients).toEqual([]);

    const sameClientDifferentName = await connectClient(app.baseUrl, 'oauth-cursor', 'other-app');
    expect(toolJson(await sameClientDifferentName.callTool({ name: 'whoami', arguments: {} })).name).toBe('cursor-inbox');
    await sameClientDifferentName.close();
    const audits = await app.pool.query(`SELECT 1 FROM audit_log WHERE action = 'oauth.bot.auto_created'`);
    expect(audits.rowCount).toBe(1);
  });

  it('registers a separate bot per OAuth client, and per client name when the account opts in', async () => {
    const account = await syncAccount(app.pool, app.config, { userId: 'user_ada', email: 'ada@example.com', orgRoles: [] }, false);
    const chatgpt = await connectClient(app.baseUrl, 'oauth-ada', 'chatgpt');
    expect(toolJson(await chatgpt.callTool({ name: 'whoami', arguments: {} })).name).toBe('chatgpt');
    await chatgpt.close();

    const claude = await connectClient(app.baseUrl, 'oauth-other', 'claude-code');
    expect(toolJson(await claude.callTool({ name: 'whoami', arguments: {} })).name).toBe('claude-code');
    await claude.close();

    await app.pool.query(`UPDATE users SET oauth_split_clients = true WHERE id = $1`, [account.id]);
    const split = await connectClient(app.baseUrl, 'oauth-cursor', 'cursor');
    expect(toolJson(await split.callTool({ name: 'whoami', arguments: {} })).name).toBe('cursor');
    await split.close();
    const second = await connectClient(app.baseUrl, 'oauth-cursor', 'cursor-grok');
    expect(toolJson(await second.callTool({ name: 'whoami', arguments: {} })).name).toBe('cursor-grok');
    await second.close();

    const grants = await app.pool.query<{ origin_name: string }>(
      `SELECT origin_name FROM oauth_grants WHERE user_id = $1 AND clerk_client_id = $2 AND revoked_at IS NULL ORDER BY origin_name`,
      [account.id, cursorClientId],
    );
    expect(grants.rows.map((row) => row.origin_name)).toEqual(['cursor', 'cursor-grok']);
  });

  it('falls back to the OAuth client host when the request is not initialize', async () => {
    await syncAccount(app.pool, app.config, { userId: 'user_ada', email: 'ada@example.com', orgRoles: [] }, false);
    const response = await fetch(`${app.baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer oauth-cursor',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(response.status).not.toBe(401);
    const names = await app.pool.query<{ name: string; description: string }>(`SELECT name, description FROM bots`);
    expect(names.rows[0]?.name).toBe('cursor-com');
    expect(names.rows[0]?.description).toContain('cursor.com');
  });

  it('keeps a legacy bb_ token on its own bot', async () => {
    const bob = await issueBot(app.pool, 'bob');
    const client = await connectClient(app.baseUrl, bob.token, 'bob');
    const who = toolJson(await client.callTool({ name: 'whoami', arguments: {} }));
    expect(who.name).toBe('bob');
    expect(who.auth).toBe('token');
    await client.close();
  });
});

describe('account API keys', () => {
  let app: TestServer;

  beforeAll(async () => {
    app = await listenForTests(
      { publicUrl: 'http://127.0.0.1:8799', adminEmails: ['ada@example.com'] },
      {
        adminAuth: {
          async verifySession(token) {
            if (token === 'ada') return { userId: 'user_ada', email: 'ada@example.com', orgRoles: [] };
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

  it('creates one bot per client name, reuses it, and stops when the key is revoked', async () => {
    const created = await fetch(`${app.baseUrl}/api/admin/api-keys`, {
      method: 'POST',
      headers: { authorization: 'Bearer ada', 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'Laptop' }),
    });
    expect(created.status).toBe(201);
    const key = (await created.json()) as { id: string; token: string; token_prefix: string };
    expect(key.token.startsWith('bbk_')).toBe(true);

    const writer = await connectClient(app.baseUrl, key.token, 'Writer');
    expect(toolJson(await writer.callTool({ name: 'whoami', arguments: {} })).name).toBe('writer');
    await writer.close();

    const writerAgain = await connectClient(app.baseUrl, key.token, 'writer');
    expect(toolJson(await writerAgain.callTool({ name: 'whoami', arguments: {} })).name).toBe('writer');
    await writerAgain.close();

    const reviewer = await connectClient(app.baseUrl, key.token, 'reviewer');
    expect(toolJson(await reviewer.callTool({ name: 'whoami', arguments: {} })).name).toBe('reviewer');
    await reviewer.close();

    const bots = await app.pool.query<{ name: string }>(`SELECT name FROM bots ORDER BY name`);
    expect(bots.rows.map((row) => row.name)).toEqual(['reviewer', 'writer']);

    const listed = await fetch(`${app.baseUrl}/api/admin/api-keys`, { headers: { authorization: 'Bearer ada' } });
    const body = (await listed.json()) as { keys: Array<{ last_used_at: string | null; token_prefix: string }> };
    expect(body.keys[0]?.token_prefix).toBe(key.token_prefix);
    expect(body.keys[0]?.last_used_at).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain(key.token);

    const pinned = await connectClient(app.baseUrl, key.token, 'ignored', { headers: { 'X-Botbridge-Bot': 'writer' } });
    expect(toolJson(await pinned.callTool({ name: 'whoami', arguments: {} })).name).toBe('writer');
    await pinned.close();
    const afterPin = await app.pool.query(`SELECT 1 FROM bots`);
    expect(afterPin.rowCount).toBe(2);

    const legacy = await issueBot(app.pool, 'bob');
    const legacyClient = await connectClient(app.baseUrl, legacy.token, 'not-bob');
    expect(toolJson(await legacyClient.callTool({ name: 'whoami', arguments: {} })).name).toBe('bob');
    await legacyClient.close();

    const revoked = await fetch(`${app.baseUrl}/api/admin/api-keys/${key.id}/revoke`, {
      method: 'POST',
      headers: { authorization: 'Bearer ada' },
    });
    expect(revoked.status).toBe(200);
    const rejected = await fetch(`${app.baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key.token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'writer' } } }),
    });
    expect(rejected.status).toBe(401);
  });
});

async function pending(app: TestServer, token: string): Promise<{ clients: unknown[] }> {
  const response = await fetch(`${app.baseUrl}/api/admin/oauth/pending`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { clients: unknown[] };
}

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectClient, issueBot, listenForTests, resetDb, toolJson, type TestServer } from './helpers.js';
import { bindOAuthGrant, syncAccount } from '../src/tenancy.js';
import { addBot } from '../src/store.js';

const future = Math.floor(Date.now() / 1000) + 3600;
const cursorClientId = 'https://cursor.com/oauth/mcp-client.json';
const grokClientId = 'https://grok.example/oauth/mcp-client.json';

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
            if (token === 'oauth-grok') {
              return { userId: 'user_ada', email: 'ada@example.com', expiresAt: future, scopes: ['profile', 'email'], clientId: grokClientId };
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
    expect(toolJson(await sameClientDifferentName.callTool({ name: 'whoami', arguments: {} })).name).toBe('other-app');
    await sameClientDifferentName.close();
    const audits = await app.pool.query(`SELECT 1 FROM audit_log WHERE action = 'oauth.bot.auto_created'`);
    expect(audits.rowCount).toBe(2);
  });

  it('registers a separate bot per OAuth client, and per client name by default', async () => {
    const account = await syncAccount(app.pool, app.config, { userId: 'user_ada', email: 'ada@example.com', orgRoles: [] }, false);
    const chatgpt = await connectClient(app.baseUrl, 'oauth-ada', 'chatgpt');
    expect(toolJson(await chatgpt.callTool({ name: 'whoami', arguments: {} })).name).toBe('chatgpt');
    await chatgpt.close();

    const claude = await connectClient(app.baseUrl, 'oauth-other', 'claude-code');
    expect(toolJson(await claude.callTool({ name: 'whoami', arguments: {} })).name).toBe('claude-code');
    await claude.close();

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

  it('gives a second agent on a shared client id its own bot instead of the first one', async () => {
    const account = await syncAccount(app.pool, app.config, { userId: 'user_ada', email: 'ada@example.com', orgRoles: [] }, false);
    const column = await app.pool.query<{ column_default: string }>(
      `SELECT column_default FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'oauth_split_clients'`,
    );
    expect(column.rows[0]?.column_default).toBe('true');
    // The first Grok Bot was bound by hand to an existing bot, the way grokbot-aziz was.
    const aziz = await addBot(app.pool, { name: 'grokbot-aziz', ownerUserId: account.id });
    await bindOAuthGrant(app.pool, account.id, { botId: aziz.bot.id, clientId: grokClientId });

    const first = await connectClient(app.baseUrl, 'oauth-grok', 'Grok Bot', { title: 'Aziz' });
    expect(toolJson(await first.callTool({ name: 'whoami', arguments: {} })).name).toBe('grokbot-aziz');
    await first.close();

    const second = await connectClient(app.baseUrl, 'oauth-grok', 'Grok Bot', { title: 'Ajeg' });
    const who = toolJson(await second.callTool({ name: 'whoami', arguments: {} }));
    expect(who.name).toBe('grok-bot-ajeg');
    expect(who.id).not.toBe(aziz.bot.id);
    await second.close();

    // Each agent reconnecting lands on its own bot again.
    const firstAgain = await connectClient(app.baseUrl, 'oauth-grok', 'Grok Bot', { title: 'Aziz' });
    expect(toolJson(await firstAgain.callTool({ name: 'whoami', arguments: {} })).name).toBe('grokbot-aziz');
    await firstAgain.close();
    const secondAgain = await connectClient(app.baseUrl, 'oauth-grok', 'Grok Bot', { title: 'Ajeg' });
    expect(toolJson(await secondAgain.callTool({ name: 'whoami', arguments: {} })).name).toBe('grok-bot-ajeg');
    await secondAgain.close();

    const grants = await app.pool.query<{ origin_name: string; bot_name: string }>(
      `SELECT g.origin_name, b.name AS bot_name FROM oauth_grants g JOIN bots b ON b.id = g.bot_id
       WHERE g.user_id = $1 AND g.clerk_client_id = $2 AND g.revoked_at IS NULL ORDER BY g.origin_name`,
      [account.id, grokClientId],
    );
    expect(grants.rows).toEqual([
      { origin_name: 'grok-bot-ajeg', bot_name: 'grok-bot-ajeg' },
      { origin_name: 'grok-bot-aziz', bot_name: 'grokbot-aziz' },
    ]);
  });

  it('keeps one MCP session on its bot across requests', async () => {
    await syncAccount(app.pool, app.config, { userId: 'user_ada', email: 'ada@example.com', orgRoles: [] }, false);
    const one = await connectClient(app.baseUrl, 'oauth-grok', 'Grok Bot', { title: 'One' });
    const two = await connectClient(app.baseUrl, 'oauth-grok', 'Grok Bot', { title: 'Two' });
    for (let i = 0; i < 3; i += 1) {
      expect(toolJson(await one.callTool({ name: 'whoami', arguments: {} })).name).toBe('grok-bot-one');
      expect(toolJson(await two.callTool({ name: 'whoami', arguments: {} })).name).toBe('grok-bot-two');
    }
    await one.close();
    await two.close();

    // Without initialize or a session there is no client name. With two bots on this client id that is a guess, so refuse.
    const guess = await fetch(`${app.baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer oauth-grok',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(guess.status).toBe(401);
    const bots = await app.pool.query(`SELECT 1 FROM bots`);
    expect(bots.rowCount).toBe(2);
  });

  it('lets X-Botbridge-Bot win over an existing grant for the same client', async () => {
    const account = await syncAccount(app.pool, app.config, { userId: 'user_ada', email: 'ada@example.com', orgRoles: [] }, false);
    const first = await connectClient(app.baseUrl, 'oauth-grok', 'Grok Bot');
    expect(toolJson(await first.callTool({ name: 'whoami', arguments: {} })).name).toBe('grok-bot');
    await first.close();

    // Identical clientInfo: only the header can tell this agent apart. It gets the named bot, created on first use.
    const pinned = await connectClient(app.baseUrl, 'oauth-grok', 'Grok Bot', { headers: { 'X-Botbridge-Bot': 'grokbot-ajeg' } });
    expect(toolJson(await pinned.callTool({ name: 'whoami', arguments: {} })).name).toBe('grokbot-ajeg');
    await pinned.close();
    const pinnedAgain = await connectClient(app.baseUrl, 'oauth-grok', 'Grok Bot', { headers: { 'X-Botbridge-Bot': 'grokbot-ajeg' } });
    expect(toolJson(await pinnedAgain.callTool({ name: 'whoami', arguments: {} })).name).toBe('grokbot-ajeg');
    await pinnedAgain.close();

    // A pin to a bot that already exists in the account binds to it.
    await addBot(app.pool, { name: 'ada-writer', ownerUserId: account.id });
    const writer = await connectClient(app.baseUrl, 'oauth-grok', 'Grok Bot', { headers: { 'X-Botbridge-Bot': 'ada-writer' } });
    expect(toolJson(await writer.callTool({ name: 'whoami', arguments: {} })).name).toBe('ada-writer');
    await writer.close();

    // The unpinned agent still has its own bot.
    const unpinned = await connectClient(app.baseUrl, 'oauth-grok', 'Grok Bot');
    expect(toolJson(await unpinned.callTool({ name: 'whoami', arguments: {} })).name).toBe('grok-bot');
    await unpinned.close();

    const names = await app.pool.query<{ name: string }>(`SELECT name FROM bots ORDER BY name`);
    expect(names.rows.map((row) => row.name)).toEqual(['ada-writer', 'grok-bot', 'grokbot-ajeg']);

    // A pin to a paused bot is refused rather than minting a replacement.
    await app.pool.query(`UPDATE bots SET revoked_at = now() WHERE name = 'ada-writer'`);
    await expect(
      connectClient(app.baseUrl, 'oauth-grok', 'Grok Bot', { headers: { 'X-Botbridge-Bot': 'ada-writer' } }),
    ).rejects.toThrow();
    const after = await app.pool.query(`SELECT 1 FROM bots`);
    expect(after.rowCount).toBe(3);
  });

  it('picks the bot from /mcp/b/<name> so identical clients get their own bots without the dashboard', async () => {
    await syncAccount(app.pool, app.config, { userId: 'user_ada', email: 'ada@example.com', orgRoles: [] }, false);
    // Two Grok Bots with identical clientInfo, same Clerk user, same client id: only the URL differs.
    const ajeg = await connectClient(app.baseUrl, 'oauth-grok', 'Grok Bot', { path: '/mcp/b/grokbot-ajeg' });
    const aziz = await connectClient(app.baseUrl, 'oauth-grok', 'Grok Bot', { path: '/mcp/b/grokbot-aziz' });
    const ajegId = toolJson(await ajeg.callTool({ name: 'whoami', arguments: {} }));
    const azizId = toolJson(await aziz.callTool({ name: 'whoami', arguments: {} }));
    expect(ajegId.name).toBe('grokbot-ajeg');
    expect(azizId.name).toBe('grokbot-aziz');

    // They can reach each other.
    await ajeg.callTool({ name: 'send_message', arguments: { to: 'grokbot-aziz', text: 'halo' } });
    const inbox = toolJson(await aziz.callTool({ name: 'read_inbox', arguments: {} }));
    expect(JSON.stringify(inbox)).toContain('halo');
    await ajeg.close();
    await aziz.close();

    // Reconnecting on the same URL keeps the same bot.
    const again = await connectClient(app.baseUrl, 'oauth-grok', 'Grok Bot', { path: '/mcp/b/grokbot-ajeg' });
    expect(toolJson(await again.callTool({ name: 'whoami', arguments: {} })).id).toBe(ajegId.id);
    await again.close();

    // A header that names a different bot than the URL is refused.
    await expect(
      connectClient(app.baseUrl, 'oauth-grok', 'Grok Bot', { path: '/mcp/b/grokbot-ajeg', headers: { 'X-Botbridge-Bot': 'grokbot-aziz' } }),
    ).rejects.toThrow();

    const names = await app.pool.query<{ name: string }>(`SELECT name FROM bots ORDER BY name`);
    expect(names.rows.map((row) => row.name)).toEqual(['grokbot-ajeg', 'grokbot-aziz']);
  });

  it('can still share one bot across client names when the account opts out', async () => {
    const account = await syncAccount(app.pool, app.config, { userId: 'user_ada', email: 'ada@example.com', orgRoles: [] }, false);
    await app.pool.query(`UPDATE users SET oauth_split_clients = false WHERE id = $1`, [account.id]);
    const first = await connectClient(app.baseUrl, 'oauth-grok', 'Grok Bot', { title: 'Aziz' });
    expect(toolJson(await first.callTool({ name: 'whoami', arguments: {} })).name).toBe('grok-bot-aziz');
    await first.close();
    const shared = await connectClient(app.baseUrl, 'oauth-grok', 'Grok Bot', { title: 'Ajeg' });
    expect(toolJson(await shared.callTool({ name: 'whoami', arguments: {} })).name).toBe('grok-bot-aziz');
    await shared.close();
    const pinned = await connectClient(app.baseUrl, 'oauth-grok', 'Grok Bot', { headers: { 'X-Botbridge-Bot': 'grokbot-ajeg' } });
    expect(toolJson(await pinned.callTool({ name: 'whoami', arguments: {} })).name).toBe('grokbot-ajeg');
    await pinned.close();
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

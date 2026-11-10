import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectClient, issueBot, listenForTests, resetDb, toolJson, type TestServer } from './helpers.js';
import { bindOAuthGrant, syncAccount } from '../src/tenancy.js';
import { addBot } from '../src/store.js';

const future = Math.floor(Date.now() / 1000) + 3600;

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
    const account = await syncAccount(
      app.pool,
      app.config,
      { userId: 'user_ada', email: 'ada@example.com', orgRoles: [] },
      false,
    );
    const writing = await addBot(app.pool, { name: 'ada-writer', ownerUserId: account.id, description: 'Writes' });
    await addBot(app.pool, { name: 'ada-review', ownerUserId: account.id });

    const unbound = await fetch(`${app.baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer oauth-ada',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(unbound.status).toBe(401);
    expect(await unbound.text()).toContain('/oauth/choose');

    await bindOAuthGrant(app.pool, account.id, { botId: writing.bot.id, clientId: 'chatgpt', label: 'ChatGPT' });
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
});

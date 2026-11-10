import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectClient, issueBot, listenForTests, resetDb, toolJson, type TestServer } from './helpers.js';
import { setClerkLink } from '../src/store.js';

const future = Math.floor(Date.now() / 1000) + 3600;

describe('clerk oauth bots', () => {
  let app: TestServer;

  beforeAll(async () => {
    app = await listenForTests(
      { publicUrl: 'http://127.0.0.1:8787', clerkPublishableKey: null, clerkSecretKey: null },
      {
        oauth: {
          async verifyAccessToken(token) {
            if (token === 'oauth-ada') {
              return { userId: 'user_ada', email: 'ada@example.com', expiresAt: future, scopes: ['profile', 'email'], clientId: 'client_ada' };
            }
            if (token === 'oauth-lin') {
              return { userId: 'user_lin', email: 'lin@example.com', expiresAt: future, scopes: ['email'], clientId: 'client_lin' };
            }
            if (token === 'oauth-old') {
              return { userId: 'user_old', email: 'old@example.com', expiresAt: future, scopes: [], clientId: 'client_old' };
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

  it('provisions a bot on first oauth sign-in and keeps static tokens working', async () => {
    const ada = await mcp(app.baseUrl, 'oauth-ada');
    const who = toolJson(await ada.callTool({ name: 'whoami', arguments: {} }));
    expect(who.name).toBe('ada');
    expect(who.auth).toBe('oauth');
    const again = await mcp(app.baseUrl, 'oauth-ada');
    const second = toolJson(await again.callTool({ name: 'whoami', arguments: {} }));
    expect(second.id).toBe(who.id);
    await ada.close();
    await again.close();

    const bob = await issueBot(app.pool, 'bob');
    const bobClient = await connectClient(app.baseUrl, bob.token, 'bob');
    expect(toolJson(await bobClient.callTool({ name: 'whoami', arguments: {} })).auth).toBe('token');
    await bobClient.close();

    const sender = await mcp(app.baseUrl, 'oauth-ada');
    const delivered = toolJson(await sender.callTool({ name: 'send_message', arguments: { to: 'bob', text: 'from oauth' } }));
    expect(delivered.to).toMatchObject({ name: 'bob' });
    await sender.close();
  });

  it('uses a bot reserved by email and refuses a revoked link', async () => {
    const lin = await issueBot(app.pool, 'lin');
    await setClerkLink(app.pool, lin.id, { userId: null, email: 'lin@example.com' });
    const client = await mcp(app.baseUrl, 'oauth-lin');
    const who = toolJson(await client.callTool({ name: 'whoami', arguments: {} }));
    expect(who.id).toBe(lin.id);
    expect(who.name).toBe('lin');
    await client.close();

    const old = await issueBot(app.pool, 'old');
    await setClerkLink(app.pool, old.id, { userId: 'user_old', email: 'old@example.com' });
    await app.pool.query(`UPDATE bots SET revoked_at = now() WHERE id = $1`, [old.id]);
    const denied = await fetch(`${app.baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer oauth-old',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    expect(denied.status).toBe(401);
    const text = await denied.text();
    expect(text.toLowerCase()).toContain('revoked');
  });
});

async function mcp(baseUrl: string, token: string) {
  return connectClient(baseUrl, token, 'oauth-client');
}

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectClient, issueBot, listenForTests, resetDb, toolJson, type TestServer } from './helpers.js';
import { revokeBot } from '../src/store.js';

describe('auth and limits', () => {
  let app: TestServer;

  beforeAll(async () => {
    app = await listenForTests({ rateLimitPerMinute: 2 });
  });

  beforeEach(async () => {
    await resetDb(app.pool);
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects missing, unknown, and revoked tokens', async () => {
    const health = await fetch(`${app.baseUrl}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, service: 'botbridge' });

    const missing = await fetch(`${app.baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(missing.status).toBe(401);
    expect(missing.headers.get('www-authenticate')?.toLowerCase()).toContain('bearer');

    const unknown = await fetch(`${app.baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: 'Bearer bb_not-a-real-token',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(unknown.status).toBe(401);

    const alice = await issueBot(app.pool, 'alice');
    const client = await connectClient(app.baseUrl, alice.token, 'alice');
    const who = toolJson(await client.callTool({ name: 'whoami', arguments: {} }));
    expect(who.name).toBe('alice');
    await client.close();

    await revokeBot(app.pool, 'alice');
    const revoked = await fetch(`${app.baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${alice.token}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(revoked.status).toBe(401);
  });

  it('rate limits tool calls per token', async () => {
    const alice = await issueBot(app.pool, 'alice');
    const client = await connectClient(app.baseUrl, alice.token, 'alice');
    try {
      await client.callTool({ name: 'whoami', arguments: {} });
      await client.callTool({ name: 'whoami', arguments: {} });
      await expect(client.callTool({ name: 'whoami', arguments: {} })).rejects.toThrow();
    } finally {
      await client.close();
    }

    const blocked = await fetch(`${app.baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${alice.token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'whoami', arguments: {} },
      }),
    });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBe('60');
  });
});

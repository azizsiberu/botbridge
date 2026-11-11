import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import type { AdminIdentity } from '../src/identity.js';
import { addBot } from '../src/store.js';
import { bindOAuthGrant, syncAccount } from '../src/tenancy.js';
import { connectClient, listenForTests, resetDb, toolJson, toolText, type TestServer } from './helpers.js';

const future = Math.floor(Date.now() / 1000) + 3600;
const openbotClientId = 'https://openbot.example/oauth/mcp-client.json';
const grokClientId = 'https://grok.example/oauth/mcp-client.json';
const arya: AdminIdentity = { userId: 'user_arya', email: 'arya@example.com', orgRoles: [] };
const ajeg: AdminIdentity = { userId: 'user_ajeg', email: 'ajeg@example.com', orgRoles: [] };

function profile(user: AdminIdentity, clientId: string) {
  return { userId: user.userId, email: user.email, expiresAt: future, scopes: ['profile', 'email'], clientId };
}

interface Request {
  id: string;
  requested_name: string;
  status: string;
  attempts: number;
  reason: string | null;
}

describe('no silent bot registration (default BOTBRIDGE_AUTO_REGISTER=0)', () => {
  let app: TestServer;

  beforeAll(async () => {
    app = await listenForTests(
      { publicUrl: 'http://127.0.0.1:8799' },
      {
        oauth: {
          async verifyAccessToken(token) {
            if (token === 'oauth-arya') return profile(arya, openbotClientId);
            if (token === 'oauth-ajeg-grok') return profile(ajeg, grokClientId);
            return null;
          },
        },
        adminAuth: {
          async verifySession(token) {
            if (token === 'arya') return arya;
            if (token === 'ajeg') return ajeg;
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

  it('defaults to off and reads BOTBRIDGE_AUTO_REGISTER', () => {
    expect(app.config.autoRegister).toBe(false);
    const base = { DATABASE_URL: 'postgres://x', BOTBRIDGE_SECRET: 'a-test-secret-long-enough' };
    expect(loadConfig({ ...base }).autoRegister).toBe(false);
    expect(loadConfig({ ...base, BOTBRIDGE_AUTO_REGISTER: '1' }).autoRegister).toBe(true);
    expect(loadConfig({ ...base, BOTBRIDGE_AUTO_REGISTER: '0' }).autoRegister).toBe(false);
    expect(() => loadConfig({ ...base, BOTBRIDGE_AUTO_REGISTER: 'maybe' })).toThrow();
  });

  it('creates the first bot of a client, then puts every other agent on that bot instead of minting new ones', async () => {
    await syncAccount(app.pool, app.config, arya, false);
    const main = await connectClient(app.baseUrl, 'oauth-arya', 'OpenBot', { title: 'Arya' });
    const mainWho = toolJson(await main.callTool({ name: 'whoami', arguments: {} }));
    expect(mainWho.name).toBe('openbot-arya');
    await main.close();

    // Sub-agents share the same MCP connection but announce other names.
    for (const title of ['Aika', 'Bagas']) {
      const sub = await connectClient(app.baseUrl, 'oauth-arya', 'OpenBot', { title });
      expect(toolJson(await sub.callTool({ name: 'whoami', arguments: {} })).id).toBe(mainWho.id);
      await sub.close();
    }

    const bots = await app.pool.query<{ name: string }>(`SELECT name FROM bots ORDER BY name`);
    expect(bots.rows.map((row) => row.name)).toEqual(['openbot-arya']);
    const created = await app.pool.query(`SELECT 1 FROM audit_log WHERE action = 'oauth.bot.auto_created'`);
    expect(created.rowCount).toBe(1);
  });

  it('refuses a new name when the client already has several bots, and lets the owner approve it', async () => {
    const account = await syncAccount(app.pool, app.config, arya, false);
    const one = await addBot(app.pool, { name: 'openbot-arya', ownerUserId: account.id });
    const two = await addBot(app.pool, { name: 'openbot-probe', ownerUserId: account.id });
    await app.pool.query(
      `INSERT INTO oauth_grants (id, user_id, bot_id, clerk_client_id, origin_name)
       VALUES (gen_random_uuid(), $1, $2, $4, 'openbot-arya'), (gen_random_uuid(), $1, $3, $4, 'openbot-probe')`,
      [account.id, one.bot.id, two.bot.id, openbotClientId],
    );

    await expect(connectClient(app.baseUrl, 'oauth-arya', 'OpenBot', { title: 'Aika' })).rejects.toThrow();
    await expect(connectClient(app.baseUrl, 'oauth-arya', 'OpenBot', { title: 'Aika' })).rejects.toThrow();
    expect((await app.pool.query(`SELECT 1 FROM bots`)).rowCount).toBe(2);

    const listed = await registrations(app, 'arya');
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ requested_name: 'openbot-aika', status: 'pending', attempts: 2, reason: 'ambiguous_client' });
    // Another account does not see it and cannot approve it.
    expect(await registrations(app, 'ajeg')).toHaveLength(0);
    const foreign = await fetch(`${app.baseUrl}/api/admin/registrations/${listed[0]?.id}/approve`, {
      method: 'POST',
      headers: { authorization: 'Bearer ajeg' },
    });
    expect(foreign.status).toBe(400);

    const approved = await fetch(`${app.baseUrl}/api/admin/registrations/${listed[0]?.id}/approve`, {
      method: 'POST',
      headers: { authorization: 'Bearer arya' },
    });
    expect(approved.status).toBe(200);
    const body = (await approved.json()) as { status: string; bot: { name: string } };
    expect(body).toMatchObject({ status: 'approved', bot: { name: 'openbot-aika' } });
    const flag = await app.pool.query<{ account_links: boolean }>(`SELECT account_links FROM bots WHERE name = 'openbot-aika'`);
    expect(flag.rows[0]?.account_links).toBe(false);

    const aika = await connectClient(app.baseUrl, 'oauth-arya', 'OpenBot', { title: 'Aika' });
    expect(toolJson(await aika.callTool({ name: 'whoami', arguments: {} })).name).toBe('openbot-aika');
    await aika.close();
    expect(await registrations(app, 'arya')).toHaveLength(0);
  });

  it('keeps a declined request declined', async () => {
    const account = await syncAccount(app.pool, app.config, arya, false);
    const one = await addBot(app.pool, { name: 'openbot-arya', ownerUserId: account.id });
    await bindOAuthGrant(app.pool, account.id, { botId: one.bot.id, clientId: openbotClientId });
    await expect(connectClient(app.baseUrl, 'oauth-arya', 'OpenBot', { path: '/mcp/b/aika' })).rejects.toThrow();
    const [request] = await registrations(app, 'arya');
    expect(request).toMatchObject({ requested_name: 'aika', reason: 'new_pinned_name' });
    const declined = await fetch(`${app.baseUrl}/api/admin/registrations/${request?.id}/decline`, {
      method: 'POST',
      headers: { authorization: 'Bearer arya' },
    });
    expect(declined.status).toBe(200);
    const again = await rawInitialize(app, 'oauth-arya', '/mcp/b/aika', { name: 'OpenBot' });
    expect(again.status).toBe(401);
    expect(again.text).toContain('declined');
    const rows = await app.pool.query(`SELECT 1 FROM bot_registration_requests`);
    expect(rows.rowCount).toBe(1);
    expect((await app.pool.query(`SELECT 1 FROM bots`)).rowCount).toBe(1);
  });

  it('keeps existing /mcp/b/<name> and X-Botbridge-Bot setups working, but will not create a new pinned bot on its own', async () => {
    const account = await syncAccount(app.pool, app.config, ajeg, false);
    // Production shape: both Grok Bots already exist and share one OAuth client id.
    const aziz = await addBot(app.pool, { name: 'grokbot-aziz', ownerUserId: account.id });
    await bindOAuthGrant(app.pool, account.id, { botId: aziz.bot.id, clientId: grokClientId });
    await addBot(app.pool, { name: 'grokbot-ajeg', ownerUserId: account.id });

    const ajegBot = await connectClient(app.baseUrl, 'oauth-ajeg-grok', 'Grok Bot', { path: '/mcp/b/grokbot-ajeg' });
    const azizBot = await connectClient(app.baseUrl, 'oauth-ajeg-grok', 'Grok Bot', { headers: { 'X-Botbridge-Bot': 'grokbot-aziz' } });
    expect(toolJson(await ajegBot.callTool({ name: 'whoami', arguments: {} })).name).toBe('grokbot-ajeg');
    expect(toolJson(await azizBot.callTool({ name: 'whoami', arguments: {} })).name).toBe('grokbot-aziz');
    await ajegBot.callTool({ name: 'send_message', arguments: { to: 'grokbot-aziz', text: 'halo' } });
    expect(JSON.stringify(toolJson(await azizBot.callTool({ name: 'read_inbox', arguments: {} })))).toContain('halo');
    await ajegBot.close();
    await azizBot.close();

    // Unpinned with two bots on the client id: no guess, no new bot.
    await expect(connectClient(app.baseUrl, 'oauth-ajeg-grok', 'Grok Bot', { title: 'Third' })).rejects.toThrow();
    // A pin to a name that does not exist yet waits for the owner.
    await expect(connectClient(app.baseUrl, 'oauth-ajeg-grok', 'Grok Bot', { path: '/mcp/b/grokbot-new' })).rejects.toThrow();
    const names = await app.pool.query<{ name: string }>(`SELECT name FROM bots ORDER BY name`);
    expect(names.rows.map((row) => row.name)).toEqual(['grokbot-ajeg', 'grokbot-aziz']);

    // Once the owner creates it, the same pin works.
    await addBot(app.pool, { name: 'grokbot-new', ownerUserId: account.id });
    const later = await connectClient(app.baseUrl, 'oauth-ajeg-grok', 'Grok Bot', { path: '/mcp/b/grokbot-new' });
    expect(toolJson(await later.callTool({ name: 'whoami', arguments: {} })).name).toBe('grokbot-new');
    await later.close();
  });

  it('never re-creates a revoked bot, with or without a live grant', async () => {
    const account = await syncAccount(app.pool, app.config, arya, false);
    const first = await connectClient(app.baseUrl, 'oauth-arya', 'OpenBot', { title: 'Aika' });
    expect(toolJson(await first.callTool({ name: 'whoami', arguments: {} })).name).toBe('openbot-aika');
    await first.close();

    await app.pool.query(`UPDATE bots SET revoked_at = now() WHERE name = 'openbot-aika'`);
    await expect(connectClient(app.baseUrl, 'oauth-arya', 'OpenBot', { title: 'Aika' })).rejects.toThrow();
    await expect(connectClient(app.baseUrl, 'oauth-arya', 'OpenBot', { title: 'Someone' })).rejects.toThrow();

    // Even after the grant itself is revoked, reconnecting is refused rather than minting openbot-aika-2.
    await app.pool.query(`UPDATE oauth_grants SET revoked_at = now() WHERE user_id = $1`, [account.id]);
    await expect(connectClient(app.baseUrl, 'oauth-arya', 'OpenBot', { title: 'Aika' })).rejects.toThrow();
    const pinned = await rawInitialize(app, 'oauth-arya', '/mcp/b/openbot-aika', { name: 'OpenBot' });
    expect(pinned.status).toBe(401);
    expect(pinned.text).toMatch(/not re-created/);
    const unpinned = await rawInitialize(app, 'oauth-arya', '/mcp', { name: 'OpenBot', title: 'Aika' });
    expect(unpinned.status).toBe(401);
    expect(unpinned.text).toMatch(/revoked/);
    // Nothing to approve either: a revoked name is not offered back to the owner as a new bot.
    expect(await registrations(app, 'arya')).toHaveLength(0);
    const names = await app.pool.query<{ name: string }>(`SELECT name FROM bots ORDER BY name`);
    expect(names.rows.map((row) => row.name)).toEqual(['openbot-aika']);
  });

  it('puts a second client name on an API key onto the existing bot', async () => {
    await syncAccount(app.pool, app.config, arya, false);
    const created = await fetch(`${app.baseUrl}/api/admin/api-keys`, {
      method: 'POST',
      headers: { authorization: 'Bearer arya', 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'OpenBot' }),
    });
    const key = (await created.json()) as { token: string };
    const main = await connectClient(app.baseUrl, key.token, 'arya');
    const mainId = toolJson(await main.callTool({ name: 'whoami', arguments: {} })).id;
    await main.close();
    const sub = await connectClient(app.baseUrl, key.token, 'aika');
    expect(toolJson(await sub.callTool({ name: 'whoami', arguments: {} })).id).toBe(mainId);
    await sub.close();

    await expect(connectClient(app.baseUrl, key.token, 'x', { headers: { 'X-Botbridge-Bot': 'bagas' } })).rejects.toThrow();
    const [request] = await registrations(app, 'arya');
    expect(request).toMatchObject({ requested_name: 'bagas', status: 'pending' });
    const approved = await fetch(`${app.baseUrl}/api/admin/registrations/${request?.id}/approve`, {
      method: 'POST',
      headers: { authorization: 'Bearer arya', 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(approved.status).toBe(200);
    const bagas = await connectClient(app.baseUrl, key.token, 'x', { headers: { 'X-Botbridge-Bot': 'bagas' } });
    expect(toolJson(await bagas.callTool({ name: 'whoami', arguments: {} })).name).toBe('bagas');
    await bagas.close();
  });
});

describe('revoked bots stay revoked with BOTBRIDGE_AUTO_REGISTER=1', () => {
  let app: TestServer;

  beforeAll(async () => {
    app = await listenForTests(
      { publicUrl: 'http://127.0.0.1:8799', autoRegister: true },
      { oauth: { async verifyAccessToken(token) { return token === 'oauth-arya' ? profile(arya, openbotClientId) : null; } } },
    );
  });

  beforeEach(async () => {
    await resetDb(app.pool);
  });

  afterAll(async () => {
    await app.close();
  });

  it('refuses instead of registering a suffixed copy', async () => {
    const account = await syncAccount(app.pool, app.config, arya, false);
    const first = await connectClient(app.baseUrl, 'oauth-arya', 'OpenBot', { title: 'Aika' });
    await first.close();
    await app.pool.query(`UPDATE bots SET revoked_at = now() WHERE name = 'openbot-aika'`);
    await app.pool.query(`UPDATE oauth_grants SET revoked_at = now() WHERE user_id = $1`, [account.id]);
    await expect(connectClient(app.baseUrl, 'oauth-arya', 'OpenBot', { title: 'Aika' })).rejects.toThrow();
    const names = await app.pool.query<{ name: string }>(`SELECT name FROM bots ORDER BY name`);
    expect(names.rows.map((row) => row.name)).toEqual(['openbot-aika']);
    // A different name is still allowed in this mode.
    const other = await connectClient(app.baseUrl, 'oauth-arya', 'OpenBot', { title: 'Bagas' });
    expect(toolJson(await other.callTool({ name: 'whoami', arguments: {} })).name).toBe('openbot-bagas');
    await other.close();
  });
});

describe('cross-account reach for new bots', () => {
  let app: TestServer;

  beforeAll(async () => {
    app = await listenForTests(
      {},
      {
        adminAuth: {
          async verifySession(token) {
            if (token === 'arya') return arya;
            if (token === 'ajeg') return ajeg;
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

  it('does not let a bot created after an account connection reach the other account until it is approved', async () => {
    const aryaAccount = await syncAccount(app.pool, app.config, arya, false);
    const ajegAccount = await syncAccount(app.pool, app.config, ajeg, false);
    const aryaMain = await addBot(app.pool, { name: 'openbot-arya', ownerUserId: aryaAccount.id });
    await addBot(app.pool, { name: 'grokbot-ajeg', ownerUserId: ajegAccount.id });

    const main = await connectClient(app.baseUrl, aryaMain.token, 'arya');
    const requested = toolJson(await main.callTool({ name: 'request_connection', arguments: { kind: 'account', email: 'ajeg@example.com' } }));
    const linkId = (requested.request as { id: string }).id;
    await fetch(`${app.baseUrl}/api/admin/connections/${linkId}/approve`, { method: 'POST', headers: { authorization: 'Bearer ajeg' } });
    toolJson(await main.callTool({ name: 'send_message', arguments: { to: 'grokbot-ajeg', text: 'from the approved bot' } }));

    // A bot that shows up on Arya's account later does not inherit the link.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const stray = await addBot(app.pool, { name: 'openbot-aika', ownerUserId: aryaAccount.id });
    const aika = await connectClient(app.baseUrl, stray.token, 'aika');
    const blocked = await aika.callTool({ name: 'send_message', arguments: { to: 'grokbot-ajeg', text: 'sneaking in' } });
    expect(blocked.isError).toBe(true);
    expect(toolText(blocked)).toContain('cannot reach');
    const directory = toolJson(await aika.callTool({ name: 'list_bots', arguments: {} }));
    const names = (directory.bots as Array<{ name: string }>).map((bot) => bot.name);
    expect(names).toContain('openbot-arya');
    expect(names).not.toContain('grokbot-ajeg');
    // Same account still works.
    toolJson(await aika.callTool({ name: 'send_message', arguments: { to: 'openbot-arya', text: 'hi boss' } }));

    // Ajeg's side does not see the new bot either.
    const ajegReach = await fetch(`${app.baseUrl}/api/admin/bots`, { headers: { authorization: 'Bearer ajeg' } });
    const ajegBots = (await ajegReach.json()) as { bots: Array<{ id: string }> };
    const ajegBotId = ajegBots.bots[0]?.id;
    const reach = await fetch(`${app.baseUrl}/api/admin/bots/${ajegBotId}/reach`, { headers: { authorization: 'Bearer ajeg' } });
    const reachNames = ((await reach.json()) as { bots: Array<{ name: string }> }).bots.map((bot) => bot.name);
    expect(reachNames).toContain('openbot-arya');
    expect(reachNames).not.toContain('openbot-aika');

    // Ajeg approves this one bot explicitly.
    const asked = toolJson(await aika.callTool({ name: 'request_connection', arguments: { kind: 'bot', bot: 'grokbot-ajeg' } }));
    const botLink = (asked.request as { id: string }).id;
    await fetch(`${app.baseUrl}/api/admin/connections/${botLink}/approve`, { method: 'POST', headers: { authorization: 'Bearer ajeg' } });
    toolJson(await aika.callTool({ name: 'send_message', arguments: { to: 'grokbot-ajeg', text: 'approved now' } }));
    await aika.close();
    await main.close();
  });
});

async function registrations(app: TestServer, token: string): Promise<Request[]> {
  const response = await fetch(`${app.baseUrl}/api/admin/registrations`, { headers: { authorization: `Bearer ${token}` } });
  expect(response.status).toBe(200);
  return ((await response.json()) as { requests: Request[] }).requests;
}

async function rawInitialize(
  app: TestServer,
  token: string,
  path: string,
  clientInfo: { name: string; title?: string },
): Promise<{ status: number; text: string }> {
  const response = await fetch(`${app.baseUrl}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo } }),
  });
  return { status: response.status, text: `${response.headers.get('www-authenticate') ?? ''} ${await response.text()}` };
}

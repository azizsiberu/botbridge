import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AdminIdentity } from '../src/identity.js';
import { addBot } from '../src/store.js';
import { reconcileTenancy, UNASSIGNED_USER_ID } from '../src/tenancy.js';
import { connectClient, listenForTests, resetDb, toolJson, toolText, type TestServer } from './helpers.js';

const ada: AdminIdentity = { userId: 'user_ada', email: 'ada@example.com', orgRoles: [] };
const lin: AdminIdentity = { userId: 'user_lin', email: 'lin@example.com', orgRoles: [] };

describe('multi-tenant isolation', () => {
  let app: TestServer;

  beforeAll(async () => {
    app = await listenForTests(
      { adminEmails: ['dev-admin@localhost'], signupMode: 'open' },
      {
        adminAuth: {
          async verifySession(token) {
            if (token === 'ada') return ada;
            if (token === 'lin') return lin;
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

  it('lets same-account bots talk and blocks other accounts until both sides agree', async () => {
    const adaAccount = await accountId(app, 'ada');
    const linAccount = await accountId(app, 'lin');
    const writer = await addBot(app.pool, { name: 'ada-writer', ownerUserId: adaAccount });
    await addBot(app.pool, { name: 'ada-notes', ownerUserId: adaAccount });
    const reviewer = await addBot(app.pool, { name: 'lin-review', ownerUserId: linAccount });

    const adaClient = await connectClient(app.baseUrl, writer.token, 'writer');
    const sent = toolJson(await adaClient.callTool({ name: 'send_message', arguments: { to: 'ada-notes', text: 'same desk' } }));
    expect((sent.to as { name: string }).name).toBe('ada-notes');

    const blocked = await adaClient.callTool({ name: 'send_message', arguments: { to: 'lin-review', text: 'across' } });
    expect(blocked.isError).toBe(true);
    expect(toolText(blocked)).toContain('cannot reach');

    const directory = toolJson(await adaClient.callTool({ name: 'list_bots', arguments: {} }));
    const names = (directory.bots as Array<{ name: string }>).map((bot) => bot.name);
    expect(names).toContain('ada-writer');
    expect(names).toContain('ada-notes');
    expect(names).not.toContain('lin-review');

    const requested = toolJson(
      await adaClient.callTool({
        name: 'request_connection',
        arguments: { kind: 'account', email: 'lin@example.com' },
      }),
    );
    const requestId = (requested.request as { id: string }).id;
    const approved = await fetch(`${app.baseUrl}/api/admin/connections/${requestId}/approve`, {
      method: 'POST',
      headers: { authorization: 'Bearer lin' },
    });
    expect(approved.status).toBe(200);

    const across = toolJson(await adaClient.callTool({ name: 'send_message', arguments: { to: 'lin-review', text: 'now allowed' } }));
    expect((across.to as { name: string }).name).toBe('lin-review');

    const linMail = await fetch(`${app.baseUrl}/api/admin/messages?q=now%20allowed`, {
      headers: { authorization: 'Bearer lin' },
    });
    const linBody = (await linMail.json()) as { messages: unknown[] };
    expect(linBody.messages.length).toBe(1);
    const adaPeek = await fetch(`${app.baseUrl}/api/admin/messages?q=now%20allowed`, {
      headers: { authorization: 'Bearer ada' },
    });
    const adaBody = (await adaPeek.json()) as { messages: unknown[] };
    expect(adaBody.messages.length).toBe(1);

    const stranger = await fetch(`${app.baseUrl}/api/admin/bots/${reviewer.bot.id}`, {
      headers: { authorization: 'Bearer ada' },
    });
    expect(stranger.status).toBe(400);

    await fetch(`${app.baseUrl}/api/admin/connections/${requestId}/revoke`, {
      method: 'POST',
      headers: { authorization: 'Bearer ada' },
    });
    const after = await adaClient.callTool({ name: 'send_message', arguments: { to: 'lin-review', text: 'again' } });
    expect(after.isError).toBe(true);
    await adaClient.close();
  });

  it('assigns legacy bots to the designated owner email', async () => {
    await addBot(app.pool, { name: 'grokbot-aziz', ownerUserId: UNASSIGNED_USER_ID, description: 'Original' });
    await reconcileTenancy(app.pool, { ...app.config, legacyOwnerEmail: 'aziz@example.com' });
    const row = await app.pool.query<{ email: string }>(
      `SELECT u.email FROM bots b JOIN users u ON u.id = b.owner_user_id WHERE b.name = 'grokbot-aziz'`,
    );
    expect(row.rows[0]?.email).toBe('aziz@example.com');
    const token = await app.pool.query<{ token_prefix: string }>(`SELECT token_prefix FROM bots WHERE name = 'grokbot-aziz'`);
    expect(token.rows[0]?.token_prefix.startsWith('bb_')).toBe(true);
  });
});

async function accountId(app: TestServer, token: string): Promise<string> {
  const response = await fetch(`${app.baseUrl}/api/admin/me`, { headers: { authorization: `Bearer ${token}` } });
  const body = (await response.json()) as { account: { id: string } };
  return body.account.id;
}

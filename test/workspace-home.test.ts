import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest';
import { listenForTests, resetDb, type TestServer } from './helpers.js';

let app: TestServer;
beforeAll(async () => {
  app = await listenForTests(
    { adminEmails: ['operator@example.com'] },
    {
      adminAuth: {
        async verifySession(userId) {
          return { userId, email: userId + '@example.com', orgRoles: [] };
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
async function bot(name: string, user = 'home-user') {
  const response = await fetch(app.baseUrl + '/api/admin/bots', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + user, 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  expect(response.ok).toBe(true);
  return ((await response.json()) as { bot: { id: string } }).bot.id;
}
async function message(from: string, to: string, body: string, thread = randomUUID(), day = 1) {
  await app.pool.query(
    `INSERT INTO messages (id,thread_id,from_bot_id,to_bot_id,kind,body,created_at)
    VALUES ($1,$2,$3,$4,'direct',$5,'2026-11-01'::timestamptz + $6 * interval '1 day')`,
    [randomUUID(), thread, from, to, body, day],
  );
  return thread;
}
async function home(user = 'home-user', query = '') {
  const response = await fetch(app.baseUrl + '/api/workspace/conversations' + query, {
    headers: { authorization: 'Bearer ' + user },
  });
  expect(response.ok, await response.clone().text()).toBe(true);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  return (await response.json()) as {
    total: number;
    conversations: Array<{ id: string; preview: string; unread: number }>;
  };
}
it('combines all owned bots, deduplicates pairs, and orders by the latest message', async () => {
  const a = await bot('home-a'),
    b = await bot('home-b'),
    c = await bot('home-c');
  const first = await message(a, b, 'first');
  await message(b, a, 'latest reply', first, 3);
  const second = await message(c, b, 'another bot', undefined, 2);
  const result = await home();
  expect(result.total).toBe(2);
  expect(result.conversations.map((row) => row.id)).toEqual([first, second]);
  expect(result.conversations[0]).toMatchObject({ preview: 'latest reply', unread: 2 });
  await app.pool.query('UPDATE bots SET revoked_at=now() WHERE id=$1', [c]);
  expect((await home()).total).toBe(2);
});
it('does not reveal unrelated accounts, even to an instance admin', async () => {
  const a = await bot('member-a'),
    b = await bot('member-b');
  const x = await bot('operator-a', 'operator'),
    y = await bot('operator-b', 'operator');
  await message(a, b, 'member private');
  await message(x, y, 'operator private');
  await message(a, x, 'shared conversation');
  expect((await home()).conversations.map((row) => row.preview).sort()).toEqual([
    'member private',
    'shared conversation',
  ]);
  expect((await home('operator')).conversations.map((row) => row.preview).sort()).toEqual([
    'operator private',
    'shared conversation',
  ]);
  expect((await fetch(app.baseUrl + '/api/workspace/conversations')).status).toBe(401);
});
it('paginates without dropping the total or duplicating conversations', async () => {
  const a = await bot('paging-a'),
    b = await bot('paging-b');
  for (let i = 0; i < 51; i++) await message(a, b, 'message ' + i, undefined, i);
  const first = await home(),
    last = await home('home-user', '?offset=50');
  expect(first.total).toBe(51);
  expect(first.conversations).toHaveLength(50);
  expect(last.total).toBe(51);
  expect(last.conversations).toHaveLength(1);
  expect(first.conversations.some((row) => row.id === last.conversations[0]?.id)).toBe(false);
});

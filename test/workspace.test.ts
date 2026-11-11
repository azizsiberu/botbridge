import { createServer, type Server } from 'node:http';
import { actorById, readInbox, setWebhook } from '../src/store.js';
import { processDueJobs } from '../src/doorbell.js';
import { requestConnection, suspendUser } from '../src/tenancy.js';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { listenForTests, resetDb, type TestServer } from './helpers.js';
let app: TestServer;
beforeAll(async () => {
  app = await listenForTests(
    { adminEmails: ['admin@example.com'] },
    {
      adminAuth: {
        async verifySession(userId) {
          return { userId, email: userId + '@example.com', orgRoles: [] };
        },
      },
    },
  );
  await resetDb(app.pool);
  await app.pool.query("UPDATE users SET status='active' WHERE clerk_user_id='member' AND email='member@example.com'");
});
afterAll(async () => {
  await app.close();
});
function request(path: string, token: string, body?: unknown) {
  return fetch(app.baseUrl + path, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}
type CreatedBot = { bot: { id: string } };
type Resource = { id: string };
type Counts = { messages: [{unread:number}]; rooms:[{unread:number}] };
async function ok<T = unknown>(path: string, token: string, body?: unknown) {
  const res = await request(path, token, body);
  expect(res.ok, await res.clone().text()).toBe(true);
  return (await res.json()) as T;
}
it('scopes summaries, replies, rooms, tasks and attachments to the selected bot', async () => {
  const a = (await ok<CreatedBot>('/api/admin/bots', 'member', { name: 'writer' })).bot.id;
  const b = (await ok<CreatedBot>('/api/admin/bots', 'member', { name: 'reader' })).bot.id;
  const c = (await ok<CreatedBot>('/api/admin/bots', 'admin', { name: 'stranger' })).bot.id;
  const path = (id: string) => '/api/workspace/bots/' + id;
  expect((await request(path(a) + '/summary', 'admin')).status).toBe(403);
  expect((await request(path(c) + '/messages', 'admin', { to: a, text: 'unlinked' })).ok).toBe(false);
  const f = await ok<Resource>(path(a) + '/files', 'member', {
    filename: 'note.txt',
    mimeType: 'text/plain',
    contentBase64: 'SGk=',
  });
  const dm = await ok<{thread_id:string}>(path(a) + '/messages', 'member', {
    to: b,
    text: 'private-message-marker',
    attachments: [f.id],
  });
  await ok(path(b) + '/messages', 'member', { to: a, threadId: dm.thread_id, text: 'reply' });
  expect((await request(path(c) + '/threads/' + dm.thread_id + '?peer=' + a, 'admin')).ok).toBe(false);
  expect((await request(path(c) + '/files/' + f.id, 'admin')).ok).toBe(false);
  const thread = await ok<[{id:string;attachments:[Resource]}]>(path(b) + '/threads/' + dm.thread_id + '?peer=' + a, 'member');
  expect(thread[0].attachments[0].id).toBe(f.id);
  const task = await ok<Resource>(path(a) + '/tasks', 'member', { to: b, instructions: 'private-task-marker' });
  expect((await request(path(a) + '/tasks/' + task.id + '/complete', 'member', { result: 'failed' })).ok).toBe(
    false,
  );
  await ok(path(b) + '/tasks/' + task.id + '/complete', 'member', { result: 'private-result-marker' });
  const room = await ok<Resource>(path(a) + '/rooms', 'member', { name: 'members', members: [b] });
  await ok(path(a) + '/rooms/' + room.id + '/posts', 'member', { text: '@reader private-room-marker' });
  expect((await request(path(c) + '/rooms/' + room.id, 'admin')).ok).toBe(false);
  const summary = await ok<Counts>(path(b) + '/summary', 'member');
  expect(JSON.stringify(summary)).not.toMatch(/private-(message|task|room|result)-marker|signed|preview|detail/);
  expect(summary.rooms[0].unread).toBe(1);
  expect(summary.messages[0].unread).toBe(1);
  expect((await ok<{unread_remaining:number}>(path(b) + '/rooms/' + room.id, 'member')).unread_remaining).toBe(1);
  await ok(path(b) + '/rooms/' + room.id + '/read', 'member', {});
  await ok(path(b) + '/ack', 'member', { ids: [thread[0].id] });
  expect((await ok<Counts>(path(b) + '/summary', 'member')).messages[0].unread).toBe(0);
  await ok(path(a) + '/broadcast', 'member', { text: 'team update' });
  await ok(path(b) + '/rooms/' + room.id + '/leave', 'member', {});
  expect((await request(path(b) + '/rooms/' + room.id, 'member')).ok).toBe(false);
  await ok('/api/admin/bots/' + b + '/revoke', 'member', {});
  expect((await request(path(b) + '/summary', 'member')).status).toBe(403);
  const actor = await actorById(app.pool, a);
  if (!actor) throw Error('Missing test bot');
  const link = await requestConnection(app.pool, actor, { kind: 'bot', botName: 'stranger' });
  await ok('/api/admin/connections/' + link.id + '/approve', 'admin', {});
  expect((await ok<Resource[]>(path(a) + '/directory', 'member')).some((bot: { id: string }) => bot.id === c)).toBe(true);
  await ok(path(a) + '/messages', 'member', { to: c, text: 'linked' });
  await ok('/api/admin/connections/' + link.id + '/revoke', 'member', {});
  expect((await request(path(a) + '/messages', 'member', { to: c, text: 'revoked link' })).ok).toBe(false);
  await suspendUser(app.pool, actor.ownerUserId, true);
  try {
    expect((await request(path(a) + '/summary', 'member')).status).toBe(403);
  } finally { await suspendUser(app.pool, actor.ownerUserId, false); }
});

it('delivers a workspace compose message to the recipient inbox and doorbell', async () => {
  await resetDb(app.pool);
  await app.pool.query("UPDATE users SET status='active' WHERE clerk_user_id='member'");
  const from = (await ok<CreatedBot>('/api/admin/bots', 'member', { name: 'composer' })).bot.id;
  const listener = (await ok<CreatedBot>('/api/admin/bots', 'member', { name: 'listener' })).bot.id;
  const quiet = (await ok<CreatedBot>('/api/admin/bots', 'member', { name: 'quiet' })).bot.id;
  const captured: string[] = [];
  const hook: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      captured.push(Buffer.concat(chunks).toString('utf8'));
      res.statusCode = 200;
      res.end('ok');
    });
  });
  await new Promise<void>((resolve) => hook.listen(0, '127.0.0.1', resolve));
  const address = hook.address();
  if (!address || typeof address === 'string') throw new Error('hook did not bind');
  try {
    await setWebhook(app.pool, app.config.secret, {
      name: 'listener',
      url: `http://127.0.0.1:${address.port}/hook`,
      profile: 'generic',
    });
    const sent = await ok<{ doorbell: boolean; to: { name: string }; thread_id: string }>(
      '/api/workspace/bots/' + from + '/messages',
      'member',
      { to: listener, text: 'compose-reaches-the-bot', attachments: [] },
    );
    expect(sent.doorbell).toBe(true);
    expect(sent.to.name).toBe('listener');
    const listenerActor = await actorById(app.pool, listener);
    if (!listenerActor) throw new Error('listener missing');
    const inbox = await readInbox(app.pool, listenerActor, {});
    expect(inbox.map((message) => message.text)).toContain('compose-reaches-the-bot');
    const jobs = await app.pool.query<{ event: string; body: string }>(
      `SELECT event, body FROM doorbell_jobs WHERE bot_id = $1`,
      [listener],
    );
    expect(jobs.rows).toHaveLength(1);
    expect(jobs.rows[0]?.event).toBe('message.created');
    expect(jobs.rows[0]?.body).toContain('compose-reaches-the-bot');
    await app.pool.query(`UPDATE doorbell_jobs SET next_attempt_at = now() WHERE delivered_at IS NULL`);
    expect(await processDueJobs(app.pool, app.config.secret)).toBe(1);
    expect(captured.some((body) => body.includes('compose-reaches-the-bot'))).toBe(true);

    const quietSend = await ok<{ doorbell: boolean }>(
      '/api/workspace/bots/' + from + '/messages',
      'member',
      { to: quiet, text: 'compose-stays-in-inbox', attachments: [] },
    );
    expect(quietSend.doorbell).toBe(false);
    const quietActor = await actorById(app.pool, quiet);
    if (!quietActor) throw new Error('quiet missing');
    const quietInbox = await readInbox(app.pool, quietActor, {});
    expect(quietInbox.map((message) => message.text)).toContain('compose-stays-in-inbox');
    const quietJobs = await app.pool.query(`SELECT 1 FROM doorbell_jobs WHERE bot_id = $1`, [quiet]);
    expect(quietJobs.rowCount).toBe(0);
  } finally {
    await new Promise<void>((resolve, reject) => hook.close((error) => (error ? reject(error) : resolve())));
  }
});

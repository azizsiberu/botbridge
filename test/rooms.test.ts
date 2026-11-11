import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/client';
import { setWebhook } from '../src/store.js';
import { addBot } from '../src/store.js';
import { parseMentions } from '../src/mentions.js';
import { connectClient, issueBot, listenForTests, resetDb, toolJson, toolText, type TestServer } from './helpers.js';

describe('mentions parser', () => {
  it('finds @names, lowercases them, and ignores emails', () => {
    expect(parseMentions('hi @Bob and @cara-2, mail ajeg@example.com, (@bob) again @dan.')).toEqual(['bob', 'cara-2', 'dan']);
    expect(parseMentions('no mentions here')).toEqual([]);
  });
});

describe('rooms', () => {
  let app: TestServer;
  const clients: Client[] = [];

  beforeAll(async () => {
    app = await listenForTests({ mentionDoorbellsPerMinute: 2 });
  });

  beforeEach(async () => {
    await resetDb(app.pool);
  });

  afterAll(async () => {
    await app.close();
  });

  async function connect(token: string, name: string): Promise<Client> {
    const client = await connectClient(app.baseUrl, token, name);
    clients.push(client);
    return client;
  }

  async function closeAll(): Promise<void> {
    while (clients.length > 0) await clients.pop()?.close();
  }

  async function hook(name: string): Promise<void> {
    await setWebhook(app.pool, app.config.secret, { name, url: 'http://127.0.0.1:9/hook', profile: 'grok', secret: 'test-routine-key' });
  }

  async function jobs(name: string): Promise<Array<{ event: string; body: Record<string, unknown> }>> {
    const result = await app.pool.query<{ event: string; body: string }>(
      `SELECT j.event, j.body FROM doorbell_jobs j JOIN bots b ON b.id = j.bot_id WHERE b.name = $1 ORDER BY j.created_at`,
      [name],
    );
    return result.rows.map((row) => ({ event: row.event, body: JSON.parse(row.body) as Record<string, unknown> }));
  }

  it('creates a room, rings only mentioned members, and tracks unread per member', async () => {
    const ajeg = await issueBot(app.pool, 'ajeg');
    const aziz = await issueBot(app.pool, 'aziz');
    const arya = await issueBot(app.pool, 'arya');
    await hook('aziz');
    await hook('arya');
    const ajegClient = await connect(ajeg.token, 'ajeg');
    const azizClient = await connect(aziz.token, 'aziz');
    const aryaClient = await connect(arya.token, 'arya');
    try {
      const created = toolJson(await ajegClient.callTool({ name: 'create_room', arguments: { name: 'ajeg-ops', members: ['aziz', 'arya'] } }));
      const room = created.room as { id: string; name: string; members: Array<{ name: string }> };
      expect(room.name).toBe('ajeg-ops');
      expect(room.members.map((member) => member.name)).toEqual(['ajeg', 'arya', 'aziz']);
      expect((await jobs('aziz')).map((job) => job.event)).toEqual(['room.invited']);

      const plain = toolJson(await ajegClient.callTool({ name: 'post_room', arguments: { room: 'ajeg-ops', text: 'Stock count is done.' } }));
      expect((plain.mentions as { notified: string[] }).notified).toEqual([]);
      expect(await jobs('arya')).toHaveLength(1);

      const mention = toolJson(
        await ajegClient.callTool({ name: 'post_room', arguments: { room: 'ajeg-ops', text: '@aziz can you check Serpong? cc @nobody' } }),
      );
      expect(mention.mentions).toEqual({ notified: ['aziz'], throttled: [], unreachable: [], not_in_room: ['nobody'] });
      const azizJobs = await jobs('aziz');
      expect(azizJobs.map((job) => job.event)).toEqual(['room.invited', 'room.mention']);
      const notice = azizJobs[1]?.body as { room: { name: string }; from: { name: string }; preview: string; mentioned: boolean };
      expect(notice.room.name).toBe('ajeg-ops');
      expect(notice.from.name).toBe('ajeg');
      expect(notice.preview).toContain('check Serpong');
      expect(notice.mentioned).toBe(true);
      expect(await jobs('arya')).toHaveLength(1);

      const listed = toolJson(await aryaClient.callTool({ name: 'list_rooms', arguments: {} }));
      expect((listed.rooms as Array<{ unread: number }>)[0]?.unread).toBe(2);
      const ownList = toolJson(await ajegClient.callTool({ name: 'list_rooms', arguments: {} }));
      expect((ownList.rooms as Array<{ unread: number }>)[0]?.unread).toBe(0);

      const firstRead = toolJson(await aryaClient.callTool({ name: 'read_room', arguments: { room: 'ajeg-ops', unread_only: true, limit: 1 } }));
      const firstPosts = firstRead.posts as Array<{ id: string; text: string; mentions: string[] }>;
      expect(firstPosts.map((post) => post.text)).toEqual(['Stock count is done.']);
      expect(firstRead.unread_remaining).toBe(1);
      const secondRead = toolJson(await aryaClient.callTool({ name: 'read_room', arguments: { room: 'ajeg-ops', unread_only: true } }));
      const secondPosts = secondRead.posts as Array<{ text: string; mentions: string[]; mentioned_you: boolean }>;
      expect(secondPosts).toHaveLength(1);
      expect(secondPosts[0]?.mentions).toEqual(['aziz']);
      expect(secondPosts[0]?.mentioned_you).toBe(false);
      expect(secondRead.unread_remaining).toBe(0);

      const sinceFirst = toolJson(await azizClient.callTool({ name: 'read_room', arguments: { room: room.id, since: firstPosts[0]?.id, mark_read: false } }));
      expect((sinceFirst.posts as Array<{ mentioned_you: boolean }>)[0]?.mentioned_you).toBe(true);
      expect(sinceFirst.unread_remaining).toBe(2);

      const reply = toolJson(await azizClient.callTool({ name: 'post_room', arguments: { room: 'ajeg-ops', text: 'On it.' } }));
      expect((reply.post as { from: { name: string } }).from.name).toBe('aziz');
    } finally {
      await closeAll();
    }
  });

  it('rate limits mention doorbells per bot per room', async () => {
    const ajeg = await issueBot(app.pool, 'ajeg');
    await issueBot(app.pool, 'aziz');
    await hook('aziz');
    const ajegClient = await connect(ajeg.token, 'ajeg');
    try {
      toolJson(await ajegClient.callTool({ name: 'create_room', arguments: { name: 'loop', members: ['aziz'] } }));
      const results: Array<{ notified: string[]; throttled: string[] }> = [];
      for (let i = 0; i < 3; i += 1) {
        const posted = toolJson(await ajegClient.callTool({ name: 'post_room', arguments: { room: 'loop', text: `@aziz ping ${i}` } }));
        results.push(posted.mentions as { notified: string[]; throttled: string[] });
      }
      expect(results.map((item) => item.notified.length)).toEqual([1, 1, 0]);
      expect(results[2]?.throttled).toEqual(['aziz']);
      expect((await jobs('aziz')).filter((job) => job.event === 'room.mention')).toHaveLength(2);
      const count = await app.pool.query<{ count: string }>(`SELECT count(*) FROM room_posts`);
      expect(Number(count.rows[0]?.count)).toBe(3);
    } finally {
      await closeAll();
    }
  });

  it('keeps non-members out and applies connection rules to invites', async () => {
    const ada = await insertUser(`ada-${randomUUID()}@example.com`);
    const lin = await insertUser(`lin-${randomUUID()}@example.com`);
    const writer = await addBot(app.pool, { name: 'ada-writer', ownerUserId: ada });
    await addBot(app.pool, { name: 'ada-notes', ownerUserId: ada });
    const reviewer = await addBot(app.pool, { name: 'lin-review', ownerUserId: lin });
    const writerClient = await connect(writer.token, 'writer');
    const reviewerClient = await connect(reviewer.token, 'reviewer');
    try {
      const blocked = await writerClient.callTool({ name: 'create_room', arguments: { name: 'desk', members: ['lin-review'] } });
      expect(blocked.isError).toBe(true);
      expect(toolText(blocked)).toContain('no approved connection');

      toolJson(await writerClient.callTool({ name: 'create_room', arguments: { name: 'desk', members: ['ada-notes'] } }));
      const peek = await reviewerClient.callTool({ name: 'read_room', arguments: { room: 'desk' } });
      expect(peek.isError).toBe(true);
      expect(toolText(peek)).toContain('not a member');
      const sneak = await reviewerClient.callTool({ name: 'post_room', arguments: { room: 'desk', text: 'hi' } });
      expect(sneak.isError).toBe(true);

      // A bot link between ada-writer and lin-review is not enough: lin-review cannot reach ada-notes.
      await app.pool.query(
        `INSERT INTO connections (id, kind, from_user_id, from_bot_id, to_user_id, to_bot_id, status, decided_at)
         VALUES ($1, 'bot', $2, $3, $4, $5, 'active', now())`,
        [randomUUID(), ada, writer.bot.id, lin, reviewer.bot.id],
      );
      const partial = await writerClient.callTool({ name: 'invite_to_room', arguments: { room: 'desk', members: ['lin-review'] } });
      expect(partial.isError).toBe(true);
      expect(toolText(partial)).toContain('ada-notes');

      // An account link covers every pair.
      await app.pool.query(
        `INSERT INTO connections (id, kind, from_user_id, to_user_id, status, decided_at) VALUES ($1, 'account', $2, $3, 'active', now())`,
        [randomUUID(), ada, lin],
      );
      const invited = toolJson(await writerClient.callTool({ name: 'invite_to_room', arguments: { room: 'desk', members: ['lin-review', 'ada-notes'] } }));
      expect(invited.added).toEqual(['lin-review']);
      expect(invited.already_members).toEqual(['ada-notes']);
      toolJson(await reviewerClient.callTool({ name: 'post_room', arguments: { room: 'desk', text: 'Thanks for the invite.' } }));

      const left = toolJson(await reviewerClient.callTool({ name: 'leave_room', arguments: { room: 'desk' } }));
      expect((left.left as { name: string }).name).toBe('desk');
      const gone = await reviewerClient.callTool({ name: 'read_room', arguments: { room: 'desk' } });
      expect(gone.isError).toBe(true);

      const duplicate = await writerClient.callTool({ name: 'create_room', arguments: { name: 'desk', members: [] } });
      expect(toolText(duplicate)).toContain('already exists');
    } finally {
      await closeAll();
    }
  });

  async function insertUser(email: string): Promise<string> {
    const id = randomUUID();
    await app.pool.query(`INSERT INTO users (id, email, display_name) VALUES ($1, $2, $2)`, [id, email]);
    return id;
  }
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectClient, issueBot, listenForTests, resetDb, toolJson, toolText, type TestServer } from './helpers.js';

describe('mailbox flows', () => {
  let app: TestServer;

  beforeAll(async () => {
    app = await listenForTests();
  });

  beforeEach(async () => {
    await resetDb(app.pool);
  });

  afterAll(async () => {
    await app.close();
  });

  it('lets two bots exchange a message and complete a task', async () => {
    const alice = await issueBot(app.pool, 'alice', {
      description: 'Writes the brief',
      capabilities: 'research,writing',
    });
    const bob = await issueBot(app.pool, 'bob', { description: 'Checks the brief', capabilities: 'review' });
    const aliceClient = await connectClient(app.baseUrl, alice.token, 'alice');
    const bobClient = await connectClient(app.baseUrl, bob.token, 'bob');

    try {
      const who = toolJson(await aliceClient.callTool({ name: 'whoami', arguments: {} }));
      expect(who.name).toBe('alice');
      expect(who.capabilities).toEqual(['research', 'writing']);

      const directory = toolJson(await aliceClient.callTool({ name: 'list_bots', arguments: {} }));
      const bots = directory.bots as Array<{ name: string }>;
      expect(bots.map((bot) => bot.name).sort()).toEqual(['alice', 'bob']);

      const sent = toolJson(
        await aliceClient.callTool({
          name: 'send_message',
          arguments: { to: 'bob', text: 'The brief is ready.' },
        }),
      );
      expect(sent.thread_id).toEqual(expect.any(String));

      const inbox = toolJson(await bobClient.callTool({ name: 'read_inbox', arguments: { unread_only: true } }));
      const messages = inbox.messages as Array<{ id: string; text: string; from: { name: string }; thread_id: string }>;
      expect(messages).toHaveLength(1);
      expect(messages[0]?.text).toBe('The brief is ready.');
      expect(messages[0]?.from.name).toBe('alice');

      const acked = toolJson(
        await bobClient.callTool({ name: 'ack_messages', arguments: { ids: [messages[0]?.id] } }),
      );
      expect(acked.acked).toEqual([messages[0]?.id]);

      const empty = toolJson(await bobClient.callTool({ name: 'read_inbox', arguments: { unread_only: true } }));
      expect(empty.messages).toEqual([]);

      const posted = toolJson(
        await aliceClient.callTool({
          name: 'post_task',
          arguments: { to: 'bob', instructions: 'Confirm the brief is complete.' },
        }),
      );
      const task = posted.task as { id: string; status: string };
      expect(task.status).toBe('open');

      const listed = toolJson(
        await bobClient.callTool({ name: 'list_tasks', arguments: { role: 'inbox', status: 'open' } }),
      );
      expect(listed.tasks).toHaveLength(1);

      const completed = toolJson(
        await bobClient.callTool({
          name: 'complete_task',
          arguments: { id: task.id, result: 'Confirmed. Nothing missing.' },
        }),
      );
      expect((completed.task as { status: string }).status).toBe('completed');

      const fetched = toolJson(await aliceClient.callTool({ name: 'get_task', arguments: { id: task.id } }));
      expect((fetched.task as { result: string; status: string }).result).toBe('Confirmed. Nothing missing.');
      expect((fetched.task as { status: string }).status).toBe('completed');

      const audit = await app.pool.query<{ action: string }>(
        `SELECT action FROM audit_log ORDER BY id`,
      );
      const actions = audit.rows.map((row) => row.action);
      expect(actions).toContain('message.sent');
      expect(actions).toContain('task.posted');
      expect(actions).toContain('task.completed');
    } finally {
      await aliceClient.close();
      await bobClient.close();
    }
  });

  it('broadcasts to other bots and hides tasks from strangers', async () => {
    const alice = await issueBot(app.pool, 'alice');
    const bob = await issueBot(app.pool, 'bob');
    const cara = await issueBot(app.pool, 'cara');
    const aliceClient = await connectClient(app.baseUrl, alice.token, 'alice');
    const bobClient = await connectClient(app.baseUrl, bob.token, 'bob');
    const caraClient = await connectClient(app.baseUrl, cara.token, 'cara');

    try {
      const cast = toolJson(await aliceClient.callTool({ name: 'broadcast', arguments: { text: 'Office hours moved.' } }));
      expect((cast.recipients as unknown[]).map((bot) => (bot as { name: string }).name).sort()).toEqual(['bob', 'cara']);

      const bobInbox = toolJson(await bobClient.callTool({ name: 'read_inbox', arguments: {} }));
      const bobMessages = bobInbox.messages as Array<{ kind: string; text: string }>;
      expect(bobMessages[0]?.kind).toBe('broadcast');
      expect(bobMessages[0]?.text).toBe('Office hours moved.');

      const aliceInbox = toolJson(await aliceClient.callTool({ name: 'read_inbox', arguments: {} }));
      expect(aliceInbox.messages).toEqual([]);

      const posted = toolJson(
        await aliceClient.callTool({
          name: 'post_task',
          arguments: { to: 'bob', instructions: 'Private task' },
        }),
      );
      const taskId = (posted.task as { id: string }).id;
      const hidden = await caraClient.callTool({ name: 'get_task', arguments: { id: taskId } });
      expect(hidden.isError).toBe(true);
      expect(toolText(hidden)).toContain('Task not found');

      const refused = await aliceClient.callTool({
        name: 'complete_task',
        arguments: { id: taskId, result: 'I posted this.' },
      });
      expect(refused.isError).toBe(true);
      expect(toolText(refused)).toContain('Only the assignee');

      const missing = await aliceClient.callTool({
        name: 'send_message',
        arguments: { to: 'nobody', text: 'hello' },
      });
      expect(missing.isError).toBe(true);
    } finally {
      await aliceClient.close();
      await bobClient.close();
      await caraClient.close();
    }
  });
});

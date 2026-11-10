import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { Client, StreamableHTTPClientTransport, type CallToolResult } from '@modelcontextprotocol/client';

const exec = promisify(execFile);

/**
 * Black-box check against a running botbridge.
 *
 *   DATABASE_URL=... BOTBRIDGE_SECRET=... BOTBRIDGE_URL=http://127.0.0.1:8787 npm run e2e
 *
 * Registers two bots with the admin CLI, then uses the official MCP client
 * to exchange a message and complete a task.
 */
async function main(): Promise<void> {
  const baseUrl = process.env.BOTBRIDGE_URL?.replace(/\/$/, '');
  if (!baseUrl) throw new Error('BOTBRIDGE_URL is required, for example http://127.0.0.1:8787');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required so the CLI can register bots');
  if (!process.env.BOTBRIDGE_SECRET) throw new Error('BOTBRIDGE_SECRET is required');

  const health = await fetch(`${baseUrl}/health`);
  if (!health.ok) throw new Error(`Health check failed: HTTP ${health.status}`);

  const suffix = randomBytes(3).toString('hex');
  const aliceName = `alice-${suffix}`;
  const bobName = `bob-${suffix}`;
  const alice = await addBot(aliceName, 'Sends the note');
  const bob = await addBot(bobName, 'Answers the note');

  const aliceClient = await connect(baseUrl, alice.token, aliceName);
  const bobClient = await connect(baseUrl, bob.token, bobName);
  try {
    const sent = await call(aliceClient, 'send_message', {
      to: bobName,
      text: 'Meet me at the post office.',
    });
    const threadId = String(sent.thread_id);

    const inbox = await call(bobClient, 'read_inbox', { unread_only: true });
    const messages = asArray(inbox.messages);
    const message = messages.find((item) => item.text === 'Meet me at the post office.');
    if (!message) throw new Error('Bob did not receive the message');

    await call(bobClient, 'ack_messages', { ids: [message.id] });
    const posted = await call(aliceClient, 'post_task', {
      to: bobName,
      instructions: 'Reply that you received the note.',
    });
    const task = asRecord(posted.task);
    const completed = await call(bobClient, 'complete_task', {
      id: String(task.id),
      result: 'Received.',
    });
    const done = asRecord(completed.task);
    if (done.status !== 'completed' || done.result !== 'Received.') {
      throw new Error('Task did not complete');
    }
    const seen = await call(aliceClient, 'get_task', { id: String(task.id) });
    const fetched = asRecord(seen.task);
    if (fetched.result !== 'Received.' || fetched.status !== 'completed') {
      throw new Error('Sender could not read the completed task');
    }
    if (String(message.thread_id) !== threadId) throw new Error('Thread id was not preserved');
    process.stdout.write(`ok thread=${threadId} task=${String(task.id)}\n`);
  } finally {
    await aliceClient.close();
    await bobClient.close();
  }
}

async function addBot(name: string, description: string): Promise<{ token: string }> {
  const { stdout } = await exec(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/cli.ts', 'bot', 'add', name, '--description', description], {
    env: process.env,
  });
  const match = stdout.match(/^token:\s*(\S+)$/m);
  const token = match?.[1];
  if (!token) throw new Error(`CLI did not print a token for ${name}`);
  return { token };
}

async function connect(baseUrl: string, token: string, name: string): Promise<Client> {
  const client = new Client({ name, version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    authProvider: { token: async () => token },
  });
  await client.connect(transport);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(textOf(result));
  const structured = result.structuredContent;
  if (structured && typeof structured === 'object' && !Array.isArray(structured)) {
    return structured as Record<string, unknown>;
  }
  return JSON.parse(textOf(result)) as Record<string, unknown>;
}

function textOf(result: CallToolResult): string {
  const block = result.content.find((item) => item.type === 'text');
  return block && block.type === 'text' ? block.text : 'tool failed';
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected an object');
  return value as Record<string, unknown>;
}

function asArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) throw new Error('expected a list');
  return value.map(asRecord);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'e2e failed'}\n`);
  process.exit(1);
});

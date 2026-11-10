import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signDoorbell } from '../src/crypto.js';
import { processDueJobs } from '../src/doorbell.js';
import { sendMessage, setWebhook, type Actor } from '../src/store.js';
import { UNASSIGNED_USER_ID } from '../src/tenancy.js';
import { issueBot, listenForTests, resetDb, type TestServer } from './helpers.js';

interface Captured {
  headers: Record<string, string | string[] | undefined>;
  body: string;
  statusToReturn: number;
}

describe('doorbell', () => {
  let app: TestServer;
  let hook: Server;
  let hookUrl = '';
  let captured: Captured[] = [];
  let nextStatus = 200;

  beforeAll(async () => {
    app = await listenForTests();
    hook = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        captured.push({
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf8'),
          statusToReturn: nextStatus,
        });
        res.statusCode = nextStatus;
        res.end('ok');
      });
    });
    await new Promise<void>((resolve) => hook.listen(0, '127.0.0.1', resolve));
    const address = hook.address();
    if (!address || typeof address === 'string') throw new Error('hook did not bind');
    hookUrl = `http://127.0.0.1:${address.port}/hook`;
  });

  beforeEach(async () => {
    await resetDb(app.pool);
    captured = [];
    nextStatus = 200;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => hook.close((error) => (error ? reject(error) : resolve())));
    await app.close();
  });

  async function deliver(): Promise<number> {
    await app.pool.query(`UPDATE doorbell_jobs SET next_attempt_at = now() WHERE delivered_at IS NULL`);
    return processDueJobs(app.pool, app.config.secret);
  }

  it('signs a generic doorbell and retries a failed delivery', async () => {
    const alice = await issueBot(app.pool, 'alice');
    await issueBot(app.pool, 'bob');
    const saved = await setWebhook(app.pool, app.config.secret, {
      name: 'bob',
      url: hookUrl,
      profile: 'generic',
    });
    nextStatus = 503;
    await sendMessage(app.pool, { ...bobActor(alice), webhookConfigured: false, webhookProfile: null }, {
      to: 'bob',
      text: 'Ring the bell',
    });

    expect(await deliver()).toBe(1);
    expect(captured).toHaveLength(1);
    const first = captured[0];
    expect(first?.statusToReturn).toBe(503);
    const timestamp = header(first?.headers ?? {}, 'x-botbridge-timestamp');
    const delivery = header(first?.headers ?? {}, 'x-botbridge-delivery');
    const signature = header(first?.headers ?? {}, 'x-botbridge-signature');
    expect(signature).toBe(`sha256=${signDoorbell(saved.secret, timestamp, delivery, first?.body ?? '')}`);
    const notice = JSON.parse(first?.body ?? '{}') as { type: string; preview: string; from: { name: string } };
    expect(notice.type).toBe('message.created');
    expect(notice.preview).toBe('Ring the bell');
    expect(notice.from.name).toBe('alice');

    nextStatus = 200;
    expect(await deliver()).toBe(1);
    expect(captured).toHaveLength(2);
    const delivered = await app.pool.query<{ delivered_at: Date | null }>(
      `SELECT delivered_at FROM doorbell_jobs`,
    );
    expect(delivered.rows[0]?.delivered_at).not.toBeNull();
  });

  it('speaks OpenBot and Grok Bot webhook shapes', async () => {
    const alice = await issueBot(app.pool, 'alice');
    await issueBot(app.pool, 'open');
    await issueBot(app.pool, 'grok');
    const openSecret = 'openbot-routine-secret';
    const grokKey = 'grok-routine-key';
    await setWebhook(app.pool, app.config.secret, {
      name: 'open',
      url: hookUrl,
      profile: 'openbot',
      secret: openSecret,
    });
    await setWebhook(app.pool, app.config.secret, {
      name: 'grok',
      url: hookUrl,
      profile: 'grok',
      secret: grokKey,
    });

    const actor: Actor = bobActor(alice);
    await sendMessage(app.pool, actor, { to: 'open', text: 'for openbot' });
    await sendMessage(app.pool, actor, { to: 'grok', text: 'for grok' });
    expect(await deliver()).toBe(2);

    const open = captured.find((item) => item.body.includes('for openbot'));
    const grok = captured.find((item) => item.body.includes('for grok'));
    expect(open).toBeDefined();
    expect(grok).toBeDefined();

    const openBody = JSON.parse(open?.body ?? '{}') as { type: string; data: { preview: string } };
    expect(openBody.type).toBe('message.created');
    expect(openBody.data.preview).toBe('for openbot');
    const openTimestamp = header(open?.headers ?? {}, 'x-openbot-timestamp');
    const openDelivery = header(open?.headers ?? {}, 'x-openbot-delivery-id');
    expect(header(open?.headers ?? {}, 'x-openbot-signature')).toBe(
      `sha256=${signDoorbell(openSecret, openTimestamp, openDelivery, open?.body ?? '')}`,
    );

    const grokBody = JSON.parse(grok?.body ?? '{}') as { preview: string };
    expect(grokBody.preview).toBe('for grok');
    expect(header(grok?.headers ?? {}, 'authorization')).toBe(`Bearer ${grokKey}`);
    const grokTimestamp = header(grok?.headers ?? {}, 'x-botbridge-timestamp');
    const grokDelivery = header(grok?.headers ?? {}, 'x-botbridge-delivery');
    expect(header(grok?.headers ?? {}, 'x-botbridge-signature')).toBe(
      `sha256=${signDoorbell(grokKey, grokTimestamp, grokDelivery, grok?.body ?? '')}`,
    );
  });
});

function header(headers: Record<string, string | string[] | undefined>, name: string): string {
  const value = headers[name];
  if (typeof value !== 'string') throw new Error(`missing header ${name}`);
  return value;
}

function bobActor(bot: { id: string; name: string }) {
  return {
    id: bot.id,
    name: bot.name,
    description: '',
    capabilities: [] as string[],
    webhookConfigured: false,
    webhookProfile: null,
    ownerUserId: UNASSIGNED_USER_ID,
    ownerName: 'Unassigned',
  };
}

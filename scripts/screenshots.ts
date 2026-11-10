import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { start } from '../src/serve.js';
import { testConfig } from '../test/helpers.js';
import { addBot } from '../src/store.js';

const out = new URL('../docs/screenshots/', import.meta.url);

async function main(): Promise<void> {
  const running = await start(
    testConfig({
      port: 8791,
      host: '127.0.0.1',
      nodeEnv: 'development',
      dashboardDevAuth: true,
      adminEmails: ['dev-admin@localhost'],
      publicUrl: 'http://127.0.0.1:8791',
    }),
  );
  try {
    await running.pool.query('TRUNCATE bots RESTART IDENTITY CASCADE');
    const ada = await addBot(running.pool, { name: 'ada', description: 'Drafts the morning note', capabilities: 'writing,research' });
    const lin = await addBot(running.pool, { name: 'lin', description: 'Checks the note before it goes out', capabilities: 'review' });
    const desk = await addBot(running.pool, { name: 'newsroom', description: 'Publishes the finished brief', capabilities: 'publish' });
    const archive = await addBot(running.pool, { name: 'archive', description: 'Keeps the old copies', capabilities: 'storage' });
    await running.pool.query(`UPDATE bots SET revoked_at = now() - interval '2 days' WHERE id = $1`, [archive.bot.id]);
    await running.pool.query(`UPDATE bots SET clerk_email = 'ada@example.com', clerk_user_id = 'user_ada' WHERE id = $1`, [ada.bot.id]);
    await running.pool.query(
      `UPDATE bots SET webhook_url = 'https://lin.example/hooks/botbridge', webhook_profile = 'openbot', webhook_secret_enc = 'v1.placeholder' WHERE id = $1`,
      [lin.bot.id],
    );

    const thread = randomUUID();
    const samples = [
      [ada.bot.id, lin.bot.id, 'The brief is ready for a read.', 0],
      [lin.bot.id, ada.bot.id, 'Cut the second paragraph. The rest can ship.', 0],
      [ada.bot.id, desk.bot.id, 'Sending the revised brief to the desk.', 1],
      [desk.bot.id, ada.bot.id, 'Posted. Link is in the thread.', 2],
    ] as const;
    for (const [from, to, body, days] of samples) {
      const id = randomUUID();
      await running.pool.query(
        `INSERT INTO messages (id, thread_id, from_bot_id, to_bot_id, kind, body, created_at, read_at)
         VALUES ($1, $2, $3, $4, 'direct', $5, now() - make_interval(days => $6), CASE WHEN $6 > 0 THEN now() ELSE NULL END)`,
        [id, thread, from, to, body, days],
      );
    }
    for (let day = 1; day <= 12; day += 1) {
      await running.pool.query(
        `INSERT INTO messages (id, thread_id, from_bot_id, to_bot_id, kind, body, created_at, read_at)
         VALUES ($1, $2, $3, $4, 'broadcast', $5, now() - make_interval(days => $6), now())`,
        [randomUUID(), randomUUID(), ada.bot.id, lin.bot.id, `Day ${day} note`, day],
      );
    }
    await running.pool.query(
      `INSERT INTO tasks (id, from_bot_id, to_bot_id, instructions, status, created_at)
       VALUES ($1, $2, $3, 'Confirm the brief is complete and name anything missing.', 'open', now() - interval '3 hours')`,
      [randomUUID(), ada.bot.id, lin.bot.id],
    );
    await running.pool.query(
      `INSERT INTO tasks (id, from_bot_id, to_bot_id, instructions, status, result, created_at, completed_at)
       VALUES ($1, $2, $3, 'File yesterday’s brief.', 'completed', 'Filed under morning notes.', now() - interval '1 day', now() - interval '20 hours')`,
      [randomUUID(), desk.bot.id, archive.bot.id],
    );
    await running.pool.query(
      `INSERT INTO doorbell_jobs (id, bot_id, event, body, attempts, max_attempts, delivered_at, last_status, created_at)
       VALUES ($1, $2, 'message.created', '{}', 1, 5, now(), 200, now() - interval '2 hours')`,
      [randomUUID(), lin.bot.id],
    );
    await running.pool.query(
      `INSERT INTO doorbell_jobs (id, bot_id, event, body, attempts, max_attempts, last_status, last_error, created_at)
       VALUES ($1, $2, 'task.created', '{}', 5, 5, 500, 'HTTP 500', now() - interval '5 hours')`,
      [randomUUID(), desk.bot.id],
    );
    await running.pool.query(
      `INSERT INTO audit_log (actor_bot_id, action, target_bot_id, resource_type, resource_id, detail)
       VALUES ($1, 'message.sent', $2, 'message', $3, '{"preview":"The brief is ready for a read."}'),
              ($2, 'task.posted', $1, 'task', $4, '{"preview":"Confirm the brief is complete."}')`,
      [ada.bot.id, lin.bot.id, randomUUID(), randomUUID()],
    );

    await mkdir(out, { recursive: true });
    const base = `http://127.0.0.1:${running.port}`;
    const pages: Array<[string, string, number, number]> = [
      ['/', 'overview.png', 1440, 1100],
      ['/bots', 'bots.png', 1440, 1100],
      [`/bots/${ada.bot.id}`, 'bot.png', 1440, 1400],
      ['/mail', 'mail.png', 1440, 1100],
      [`/mail/${thread}`, 'thread.png', 1440, 1000],
      ['/tasks', 'tasks.png', 1440, 1000],
      ['/audit', 'audit.png', 1440, 1000],
      ['/doorbell', 'doorbell.png', 1440, 900],
      ['/settings', 'settings.png', 1440, 1100],
      ['/', 'overview-mobile.png', 390, 900],
    ];
    for (const [path, file, width, height] of pages) {
      await shot(`${base}${path}`, new URL(file, out).pathname, width, height);
    }
  } finally {
    await running.close();
  }
}

function shot(url: string, file: string, width: number, height: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const profile = `/tmp/botbridge-chrome-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const child = spawn(
      '/usr/local/bin/google-chrome',
      [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--hide-scrollbars',
        '--no-first-run',
        `--user-data-dir=${profile}`,
        '--force-device-scale-factor=1',
        `--window-size=${width},${height}`,
        '--virtual-time-budget=8000',
        `--screenshot=${file}`,
        url,
      ],
      { stdio: 'ignore', detached: true },
    );
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }, 12_000);
    child.on('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

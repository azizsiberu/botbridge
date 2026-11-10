import { LIMITS } from './limits.js';
import { log } from './log.js';
import { decryptSecret, signDoorbell } from './crypto.js';
import type { Pool } from './db.js';
import type { WebhookProfile } from './text.js';

export interface DoorbellNotice {
  id: string;
  type: 'message.created' | 'broadcast.created' | 'task.created' | 'task.completed' | 'doorbell.test';
  occurred_at: string;
  bot: { id: string; name: string };
  from: { id: string; name: string };
  resource: { type: 'message' | 'task' | 'doorbell'; id: string };
  thread_id: string | null;
  preview: string;
}

const BACKOFF_MS = [1_000, 5_000, 30_000, 120_000, 600_000];

export function renderDoorbellBody(profile: WebhookProfile, notice: DoorbellNotice): string {
  if (profile === 'openbot') {
    return JSON.stringify({
      type: notice.type,
      occurredAt: notice.occurred_at,
      data: notice,
    });
  }
  return JSON.stringify(notice);
}

export function doorbellHeaders(
  profile: WebhookProfile,
  secret: string,
  event: string,
  deliveryId: string,
  body: string,
  nowMs = Date.now(),
): Record<string, string> {
  const timestamp = String(Math.floor(nowMs / 1000));
  const signature = `sha256=${signDoorbell(secret, timestamp, deliveryId, body)}`;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': 'botbridge/0.1',
  };

  if (profile === 'openbot') {
    headers['x-openbot-timestamp'] = timestamp;
    headers['x-openbot-delivery-id'] = deliveryId;
    headers['x-openbot-signature'] = signature;
    return headers;
  }

  if (profile === 'grok') {
    headers.authorization = `Bearer ${secret}`;
  }

  headers['x-botbridge-timestamp'] = timestamp;
  headers['x-botbridge-delivery'] = deliveryId;
  headers['x-botbridge-event'] = event;
  headers['x-botbridge-signature'] = signature;
  return headers;
}

interface JobRow {
  id: string;
  bot_id: string;
  event: string;
  body: string;
  attempts: number;
  max_attempts: number;
}

interface BotWebhook {
  webhook_url: string | null;
  webhook_secret_enc: string | null;
  webhook_profile: WebhookProfile | null;
}

export interface DoorbellDeps {
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export async function processDueJobs(pool: Pool, masterSecret: string, deps: DoorbellDeps = {}): Promise<number> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const nowMs = deps.nowMs ?? Date.now;
  const claimed = await pool.query<JobRow>(
    `WITH due AS (
       SELECT id FROM doorbell_jobs
       WHERE delivered_at IS NULL
         AND next_attempt_at <= now()
         AND attempts < max_attempts
       ORDER BY next_attempt_at
       LIMIT 10
       FOR UPDATE SKIP LOCKED
     )
     UPDATE doorbell_jobs AS job
     SET attempts = job.attempts + 1,
         next_attempt_at = now() + interval '5 minutes'
     FROM due
     WHERE job.id = due.id
     RETURNING job.id, job.bot_id, job.event, job.body, job.attempts, job.max_attempts`,
  );

  for (const job of claimed.rows) {
    await deliverJob(pool, masterSecret, job, fetchImpl, nowMs);
  }
  return claimed.rows.length;
}

async function deliverJob(
  pool: Pool,
  masterSecret: string,
  job: JobRow,
  fetchImpl: typeof fetch,
  nowMs: () => number,
): Promise<void> {
  const bot = await pool.query<BotWebhook>(
    `SELECT webhook_url, webhook_secret_enc, webhook_profile
     FROM bots WHERE id = $1 AND revoked_at IS NULL`,
    [job.bot_id],
  );
  const row = bot.rows[0];
  if (!row?.webhook_url || !row.webhook_secret_enc || !row.webhook_profile) {
    await pool.query(
      `UPDATE doorbell_jobs
       SET delivered_at = now(), last_error = 'webhook not configured'
       WHERE id = $1`,
      [job.id],
    );
    return;
  }

  let secret: string;
  try {
    secret = decryptSecret(row.webhook_secret_enc, masterSecret);
  } catch (error) {
    log('error', 'doorbell decrypt failed', {
      job_id: job.id,
      bot_id: job.bot_id,
      error: error instanceof Error ? error.message : 'unknown',
    });
    await finishFailure(pool, job, null, 'could not decrypt webhook secret');
    return;
  }

  const headers = doorbellHeaders(row.webhook_profile, secret, job.event, job.id, job.body, nowMs());
  try {
    const response = await fetchImpl(row.webhook_url, {
      method: 'POST',
      headers,
      body: job.body,
      redirect: 'manual',
      signal: AbortSignal.timeout(LIMITS.doorbellTimeoutMs),
    });
    if (response.status >= 200 && response.status < 300) {
      await pool.query(
        `UPDATE doorbell_jobs
         SET delivered_at = now(), last_status = $2, last_error = NULL
         WHERE id = $1`,
        [job.id, response.status],
      );
      return;
    }
    const message = `HTTP ${response.status}`;
    if (!retryableStatus(response.status)) {
      await pool.query(
        `UPDATE doorbell_jobs
         SET attempts = max_attempts, last_status = $2, last_error = $3
         WHERE id = $1`,
        [job.id, response.status, message],
      );
      return;
    }
    await finishFailure(pool, job, response.status, message);
  } catch (error) {
    const message = error instanceof Error ? error.name : 'network error';
    log('error', 'doorbell delivery failed', { job_id: job.id, bot_id: job.bot_id, error: message });
    await finishFailure(pool, job, null, message);
  }
}

async function finishFailure(pool: Pool, job: JobRow, status: number | null, message: string): Promise<void> {
  const delay = BACKOFF_MS[Math.min(job.attempts - 1, BACKOFF_MS.length - 1)] ?? 600_000;
  await pool.query(
    `UPDATE doorbell_jobs
     SET next_attempt_at = now() + ($2::int * interval '1 millisecond'),
         last_status = $3,
         last_error = $4
     WHERE id = $1`,
    [job.id, delay, status, message.slice(0, 500)],
  );
}

export function startDoorbellWorker(pool: Pool, masterSecret: string, intervalMs = 1_000): () => void {
  let stopped = false;
  let running = false;
  const timer = setInterval(() => {
    if (stopped || running) return;
    running = true;
    processDueJobs(pool, masterSecret)
      .catch((error: unknown) => {
        log('error', 'doorbell worker failed', {
          error: error instanceof Error ? error.message : 'unknown',
        });
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

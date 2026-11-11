/**
 * The dashboard asks /api/admin/me once to decide whether to show Admin.
 * Clerk can reject that first call (verification throws, or the browser has
 * no session token yet) and accept the same session a few seconds later.
 */
export const adminProbeDelaysMs = [0, 300, 800, 1500, 3000, 5000, 8000] as const;

export interface AdminProbeSignal {
  aborted: boolean;
}

/** status null covers network failures and a session token that is not ready yet. */
export function shouldRetryAdminProbe(status: number | null, attempt: number, attempts: number): boolean {
  if (attempt >= attempts - 1) return false;
  if (status === null || status === 401 || status === 429 || status >= 500) return true;
  return false;
}

export async function pollAdminProbe<T>(
  load: (attempt: number) => Promise<T>,
  options: {
    delaysMs?: readonly number[];
    sleep?: (ms: number) => Promise<void>;
    signal?: AdminProbeSignal;
    statusOf: (error: unknown) => number | null;
  },
): Promise<T | null> {
  const delays = options.delaysMs ?? adminProbeDelaysMs;
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    const wait = delays[attempt] ?? 0;
    if (wait > 0) await sleep(wait);
    if (options.signal?.aborted) return null;
    try {
      return await load(attempt);
    } catch (error) {
      if (options.signal?.aborted) return null;
      if (!shouldRetryAdminProbe(options.statusOf(error), attempt, delays.length)) return null;
    }
  }
  return null;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

import { describe, expect, it } from 'vitest';
import { pollAdminProbe, shouldRetryAdminProbe } from '../src/admin-probe.js';

describe('admin nav probe', () => {
  it('retries a rejected session and keeps a definitive refusal', () => {
    expect(shouldRetryAdminProbe(401, 0, 4)).toBe(true);
    expect(shouldRetryAdminProbe(503, 1, 4)).toBe(true);
    expect(shouldRetryAdminProbe(429, 0, 4)).toBe(true);
    expect(shouldRetryAdminProbe(null, 0, 4)).toBe(true);
    expect(shouldRetryAdminProbe(403, 0, 4)).toBe(false);
    expect(shouldRetryAdminProbe(400, 0, 4)).toBe(false);
    expect(shouldRetryAdminProbe(401, 3, 4)).toBe(false);
  });

  it('returns the account after transient 401s', async () => {
    const statuses = [401, 401, 200];
    let calls = 0;
    const account = await pollAdminProbe(
      async () => {
        const status = statuses[calls] ?? 200;
        calls += 1;
        if (status !== 200) throw Object.assign(new Error('rejected'), { status });
        return { isAdmin: true };
      },
      {
        delaysMs: [0, 0, 0, 0],
        sleep: async () => undefined,
        statusOf: (error) => (error instanceof Error && 'status' in error && typeof error.status === 'number' ? error.status : null),
      },
    );
    expect(account).toEqual({ isAdmin: true });
    expect(calls).toBe(3);
  });

  it('does not retry a forbidden account', async () => {
    let calls = 0;
    const account = await pollAdminProbe(
      async () => {
        calls += 1;
        throw Object.assign(new Error('suspended'), { status: 403 });
      },
      {
        delaysMs: [0, 0, 0],
        sleep: async () => undefined,
        statusOf: (error) => (error instanceof Error && 'status' in error && typeof error.status === 'number' ? error.status : null),
      },
    );
    expect(account).toBeNull();
    expect(calls).toBe(1);
  });

  it('retries a missing token, then stops', async () => {
    let calls = 0;
    const account = await pollAdminProbe(
      async () => {
        calls += 1;
        throw new Error('Clerk session token is not ready');
      },
      {
        delaysMs: [0, 0, 0],
        sleep: async () => undefined,
        statusOf: () => null,
      },
    );
    expect(account).toBeNull();
    expect(calls).toBe(3);
  });

  it('stops when the page unmounts during the wait', async () => {
    const signal = { aborted: false };
    let calls = 0;
    const account = await pollAdminProbe(
      async () => {
        calls += 1;
        throw Object.assign(new Error('rejected'), { status: 401 });
      },
      {
        delaysMs: [0, 10],
        signal,
        sleep: async () => {
          signal.aborted = true;
        },
        statusOf: () => 401,
      },
    );
    expect(account).toBeNull();
    expect(calls).toBe(1);
  });
});

import { createClerkClient, type ClerkClient } from '@clerk/backend';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../src/config.js';
import { errorFields } from '../src/errors.js';
import { createAdminAuth } from '../src/identity.js';

vi.mock('@clerk/backend', () => ({
  createClerkClient: vi.fn(),
}));

const sessionToken = 'session_should_not_appear';
const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.signaturevalue';

describe('clerk verification logs', () => {
  afterEach(() => {
    vi.mocked(createClerkClient).mockReset();
  });

  it('keeps name, status, reason, and cause when message is empty, and drops secrets', () => {
    const cause = new Error(`connect failed Bearer ${jwt}`);
    const failure = Object.assign(new Error(''), {
      status: 401,
      reason: 'jwk-remote-failed-to-load',
      action: 'Make sure your system clock is in sync.',
      clerkTraceId: 'trace_123',
      cause,
      errors: [
        {
          code: 'authentication_invalid',
          message: '',
          longMessage: 'Session could not be verified',
          meta: { authorization: `Bearer ${sessionToken}`, token: jwt },
        },
      ],
      getFullMessage: () => `rejected ${jwt}`,
    });
    failure.name = 'TokenVerificationError';

    const fields = errorFields(failure);
    expect(fields).toMatchObject({
      name: 'TokenVerificationError',
      message: '',
      status: 401,
      reason: 'jwk-remote-failed-to-load',
      action: 'Make sure your system clock is in sync.',
      clerkTraceId: 'trace_123',
      detail: 'rejected [redacted]',
      errors: [{ code: 'authentication_invalid', message: '', longMessage: 'Session could not be verified' }],
      cause: { name: 'Error', message: 'connect failed Bearer [redacted]' },
    });
    const encoded = JSON.stringify(fields);
    expect(encoded).not.toContain(sessionToken);
    expect(encoded).not.toContain(jwt);
    expect(encoded).not.toContain('authorization');
  });

  it('logs those fields when session verification throws', async () => {
    const failure = Object.assign(new Error(''), {
      status: 401,
      reason: 'jwk-failed-to-resolve',
      cause: Object.assign(new Error(''), { code: 'ENOTFOUND', hostname: 'api.clerk.com' }),
      errors: [{ code: 'authentication_invalid', message: 'nope', meta: { secret: 'sk_test_should_not_leak' } }],
    });
    failure.name = 'ClerkAPIResponseError';
    vi.mocked(createClerkClient).mockReturnValue({
      authenticateRequest: async () => {
        throw failure;
      },
    } as unknown as ClerkClient);

    const previous = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = 'error';
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const identity = await createAdminAuth({
        dashboardDevAuth: false,
        clerkSecretKey: 'sk_test_dummy',
        clerkPublishableKey: 'pk_test_dummy',
        adminOrgId: null,
      } as Config).verifySession(sessionToken);
      expect(identity).toBeNull();
      const line = spy.mock.calls.map((call) => String(call[0])).find((entry) => entry.includes('admin session rejected'));
      expect(line).toBeTruthy();
      const parsed = JSON.parse(line ?? '{}') as { error: Record<string, unknown> };
      expect(parsed.error).toMatchObject({
        name: 'ClerkAPIResponseError',
        message: '',
        status: 401,
        reason: 'jwk-failed-to-resolve',
        errors: [{ code: 'authentication_invalid', message: 'nope' }],
        cause: { code: 'ENOTFOUND', hostname: 'api.clerk.com' },
      });
      expect(line).not.toContain(sessionToken);
      expect(line).not.toContain('sk_test_should_not_leak');
      expect(line).not.toContain('sk_test_dummy');
    } finally {
      process.env.LOG_LEVEL = previous;
      spy.mockRestore();
    }
  });
});

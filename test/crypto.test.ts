import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, signDoorbell, verifyDoorbell } from '../src/crypto.js';

describe('doorbell signatures', () => {
  it('accepts a signature over the exact body and rejects tampering', () => {
    const secret = 'bbs_test_secret_value';
    const body = JSON.stringify({ type: 'message.created', preview: 'hello' });
    const timestamp = '1760000000';
    const deliveryId = '4f3b1c0a-1111-4111-8111-111111111111';
    const signature = signDoorbell(secret, timestamp, deliveryId, body);

    expect(
      verifyDoorbell({
        secret,
        timestamp,
        deliveryId,
        body,
        signature: `sha256=${signature}`,
        nowMs: 1760000000 * 1000,
      }),
    ).toBe(true);

    expect(
      verifyDoorbell({
        secret,
        timestamp,
        deliveryId,
        body: `${body} `,
        signature: `sha256=${signature}`,
        nowMs: 1760000000 * 1000,
      }),
    ).toBe(false);

    expect(
      verifyDoorbell({
        secret,
        timestamp,
        deliveryId,
        body,
        signature: `sha256=${signature}`,
        nowMs: (1760000000 + 301) * 1000,
      }),
    ).toBe(false);
  });

  it('round-trips a webhook secret through the master key', () => {
    const master = 'test-secret-not-for-production';
    const secret = 'routine-secret-from-openbot';
    const stored = encryptSecret(secret, master);
    expect(stored).not.toContain(secret);
    expect(decryptSecret(stored, master)).toBe(secret);
    expect(() => decryptSecret(stored, 'a-different-master-key')).toThrow();
  });
});

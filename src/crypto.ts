import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const SECRET_VERSION = 'v1';

export function generateToken(): string {
  return `bb_${randomBytes(32).toString('base64url')}`;
}

/** Account API key. Hashed at rest. Distinct from a per-bot `bb_` token. */
export function generateApiKey(): string {
  return `bbk_${randomBytes(32).toString('base64url')}`;
}

export function generateWebhookSecret(): string {
  return `bbs_${randomBytes(32).toString('base64url')}`;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function tokenPrefix(token: string): string {
  return token.slice(0, 11);
}

function masterKey(master: string): Buffer {
  return createHash('sha256').update(master).digest();
}

/** AES-256-GCM so the doorbell can sign later without storing the secret in the clear. */
export function encryptSecret(secret: string, master: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey(master), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    SECRET_VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptSecret(payload: string, master: string): string {
  const [version, ivB64, tagB64, ctB64] = payload.split('.');
  if (version !== SECRET_VERSION || !ivB64 || !tagB64 || !ctB64) {
    throw new Error('webhook secret could not be decrypted');
  }
  const decipher = createDecipheriv('aes-256-gcm', masterKey(master), Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64url')),
    decipher.final(),
  ]);
  return plain.toString('utf8');
}

/**
 * HMAC-SHA256 over `timestamp.deliveryId.body`, lowercase hex.
 * The body is the exact bytes that were sent.
 */
export function signDoorbell(secret: string, timestamp: string, deliveryId: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${deliveryId}.${body}`).digest('hex');
}

export function verifyDoorbell(input: {
  secret: string;
  timestamp: string;
  deliveryId: string;
  body: string;
  signature: string;
  nowMs?: number;
  toleranceSeconds?: number;
}): boolean {
  const presented = input.signature.startsWith('sha256=')
    ? input.signature.slice('sha256='.length)
    : input.signature;
  if (!/^[0-9a-f]{64}$/.test(presented)) return false;
  const expected = signDoorbell(input.secret, input.timestamp, input.deliveryId, input.body);
  const left = Buffer.from(expected, 'hex');
  const right = Buffer.from(presented, 'hex');
  if (left.length !== right.length || !timingSafeEqual(left, right)) return false;
  const ts = Number(input.timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = (input.nowMs ?? Date.now()) / 1000;
  const tolerance = input.toleranceSeconds ?? 300;
  return Math.abs(now - ts) <= tolerance;
}

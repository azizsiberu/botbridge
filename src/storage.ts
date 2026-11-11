import { createHash, createHmac } from 'node:crypto';
import type { FileConfig, S3Config } from './config.js';
import type { Pool } from './db.js';

/** Where file bytes live. Metadata and access rules stay in Postgres either way. */
export interface FileStorage {
  readonly kind: 'db' | 's3';
  /** True when clients can PUT bytes straight to storage with a presigned URL. */
  readonly presignedUploads: boolean;
  put(key: string, data: Buffer, mimeType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  /** Size in bytes, or null when the object does not exist. */
  head(key: string): Promise<number | null>;
  remove(key: string): Promise<void>;
  /** A presigned PUT URL, or null when this backend cannot take direct uploads. */
  presignPut(key: string, mimeType: string, ttlSeconds: number): string | null;
  /** A presigned GET URL, or null when the HTTP app serves the bytes itself. */
  presignGet(key: string, filename: string, mimeType: string, ttlSeconds: number): string | null;
}

const S3_TIMEOUT_MS = 30_000;

export function createStorage(pool: Pool, config: FileConfig): FileStorage {
  if (config.storage === 's3') {
    if (!config.s3) throw new Error('S3 storage selected without S3 settings');
    return new S3Storage(config.s3);
  }
  return new DbStorage(pool);
}

/** Bytes in Postgres. Fine for development, tests, and small installs. */
export class DbStorage implements FileStorage {
  readonly kind = 'db' as const;
  readonly presignedUploads = false;
  constructor(private readonly pool: Pool) {}

  async put(key: string, data: Buffer): Promise<void> {
    await this.pool.query(
      `INSERT INTO file_blobs (storage_key, data) VALUES ($1, $2)
       ON CONFLICT (storage_key) DO UPDATE SET data = EXCLUDED.data`,
      [key, data],
    );
  }

  async get(key: string): Promise<Buffer | null> {
    const result = await this.pool.query<{ data: Buffer }>(`SELECT data FROM file_blobs WHERE storage_key = $1`, [key]);
    return result.rows[0]?.data ?? null;
  }

  async head(key: string): Promise<number | null> {
    const result = await this.pool.query<{ size: number }>(
      `SELECT octet_length(data) AS size FROM file_blobs WHERE storage_key = $1`,
      [key],
    );
    const row = result.rows[0];
    return row ? Number(row.size) : null;
  }

  async remove(key: string): Promise<void> {
    await this.pool.query(`DELETE FROM file_blobs WHERE storage_key = $1`, [key]);
  }

  presignPut(): string | null {
    return null;
  }

  presignGet(): string | null {
    return null;
  }
}

/** Any S3-compatible bucket: AWS S3, Cloudflare R2, MinIO. Signs with SigV4 query auth, no SDK. */
export class S3Storage implements FileStorage {
  readonly kind = 's3' as const;
  readonly presignedUploads = true;
  constructor(
    private readonly config: S3Config,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private objectKey(key: string): string {
    return `${this.config.prefix}${key}`;
  }

  private sign(method: string, key: string, ttlSeconds: number, query: Record<string, string> = {}): string {
    return presignS3Url({
      ...this.config,
      method,
      key: this.objectKey(key),
      expiresSeconds: ttlSeconds,
      query,
    });
  }

  async put(key: string, data: Buffer, mimeType: string): Promise<void> {
    const response = await this.fetchImpl(this.sign('PUT', key, 300), {
      method: 'PUT',
      headers: { 'content-type': mimeType },
      body: new Uint8Array(data),
      signal: AbortSignal.timeout(S3_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`object storage PUT failed with HTTP ${response.status}`);
  }

  async get(key: string): Promise<Buffer | null> {
    const response = await this.fetchImpl(this.sign('GET', key, 300), { signal: AbortSignal.timeout(S3_TIMEOUT_MS) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`object storage GET failed with HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }

  async head(key: string): Promise<number | null> {
    const response = await this.fetchImpl(this.sign('HEAD', key, 300), {
      method: 'HEAD',
      signal: AbortSignal.timeout(S3_TIMEOUT_MS),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`object storage HEAD failed with HTTP ${response.status}`);
    const length = Number(response.headers.get('content-length'));
    return Number.isFinite(length) ? length : null;
  }

  async remove(key: string): Promise<void> {
    const response = await this.fetchImpl(this.sign('DELETE', key, 300), {
      method: 'DELETE',
      signal: AbortSignal.timeout(S3_TIMEOUT_MS),
    });
    if (!response.ok && response.status !== 404) throw new Error(`object storage DELETE failed with HTTP ${response.status}`);
  }

  presignPut(key: string, _mimeType: string, ttlSeconds: number): string {
    return this.sign('PUT', key, ttlSeconds);
  }

  presignGet(key: string, filename: string, mimeType: string, ttlSeconds: number): string {
    return this.sign('GET', key, ttlSeconds, {
      'response-content-disposition': contentDisposition(filename),
      'response-content-type': mimeType,
    });
  }
}

export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeRfc3986(filename)}`;
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

function amzDate(now: Date): { stamp: string; day: string } {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { stamp, day: stamp.slice(0, 8) };
}

/** AWS Signature Version 4, query-string auth, UNSIGNED-PAYLOAD. Works with S3 and R2. */
export function presignS3Url(input: {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  method: string;
  key: string;
  expiresSeconds: number;
  query?: Record<string, string>;
  now?: Date;
}): string {
  const endpoint = new URL(input.endpoint);
  const host = input.forcePathStyle ? endpoint.host : `${input.bucket}.${endpoint.host}`;
  const basePath = endpoint.pathname.replace(/\/+$/, '');
  const keyPath = input.key.split('/').map(encodeRfc3986).join('/');
  const canonicalUri = input.forcePathStyle
    ? `${basePath}/${encodeRfc3986(input.bucket)}/${keyPath}`
    : `${basePath}/${keyPath}`;
  const { stamp, day } = amzDate(input.now ?? new Date());
  const scope = `${day}/${input.region}/s3/aws4_request`;
  const params: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${input.accessKeyId}/${scope}`,
    'X-Amz-Date': stamp,
    'X-Amz-Expires': String(input.expiresSeconds),
    'X-Amz-SignedHeaders': 'host',
    ...(input.query ?? {}),
  };
  const canonicalQuery = Object.keys(params)
    .sort()
    .map((name) => `${encodeRfc3986(name)}=${encodeRfc3986(params[name] ?? '')}`)
    .join('&');
  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalUri,
    canonicalQuery,
    `host:${host}`,
    '',
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, day), input.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  return `${endpoint.protocol}//${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

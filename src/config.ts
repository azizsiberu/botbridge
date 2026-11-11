import { LIMITS } from './limits.js';

export interface Config {
  databaseUrl: string;
  secret: string;
  host: string;
  port: number;
  allowedHosts: string[];
  rateLimitPerMinute: number;
  nodeEnv: string;
  /** Canonical origin, no trailing slash. Required when Clerk is configured. */
  publicUrl: string | null;
  clerkPublishableKey: string | null;
  clerkSecretKey: string | null;
  adminEmails: string[];
  adminUserIds: string[];
  adminOrgId: string | null;
  adminOrgRole: string | null;
  /** Local screenshot and dev login. Refused when NODE_ENV is production. */
  dashboardDevAuth: boolean;
  /** Email that should own bots created before accounts existed. */
  legacyOwnerEmail: string | null;
  signupMode: 'open' | 'invite';
  files: FileConfig;
  /** Mention doorbells one bot may receive per room (or DM sender) per minute. Extra mentions are stored but do not ring. */
  mentionDoorbellsPerMinute: number;
  /**
   * BOTBRIDGE_AUTO_REGISTER. Off by default: only the first connection of an
   * OAuth client or API key may create a bot. Later new client names reuse
   * the existing bot or wait for the owner's approval. On restores the old
   * one-bot-per-client-name behavior.
   */
  autoRegister: boolean;
}

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  prefix: string;
}

export interface FileConfig {
  storage: 'db' | 's3';
  maxBytes: number;
  /** Lowercase MIME types; `type/*` matches a whole family. */
  allowedTypes: string[];
  urlTtlSeconds: number;
  s3: S3Config | null;
}

export const DEFAULT_FILE_TYPES = [
  'image/*',
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/json',
  'application/pdf',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/msword',
];

const PLACEHOLDER_SECRETS = new Set([
  'change-me',
  'dev-only-change-me-please',
  'replace-with-a-long-random-string',
]);

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = required(env, 'DATABASE_URL');
  const secret = required(env, 'BOTBRIDGE_SECRET');
  if (secret.length < 16) {
    throw new Error('BOTBRIDGE_SECRET must be at least 16 characters');
  }
  const nodeEnv = env.NODE_ENV ?? 'development';
  if (nodeEnv === 'production' && PLACEHOLDER_SECRETS.has(secret)) {
    throw new Error('BOTBRIDGE_SECRET is still a placeholder. Set a unique secret before production.');
  }

  const port = Number(env.PORT ?? '8787');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer from 1 to 65535');
  }

  const allowedHosts = (env.ALLOWED_HOSTS ?? 'localhost,127.0.0.1,[::1]')
    .split(',')
    .map((host) => host.trim())
    .filter((host) => host.length > 0);
  if (allowedHosts.length === 0) {
    throw new Error('ALLOWED_HOSTS must name at least one host');
  }

  const rateLimitPerMinute = Number(env.RATE_LIMIT_PER_MINUTE ?? String(LIMITS.rateLimitPerMinute));
  if (!Number.isInteger(rateLimitPerMinute) || rateLimitPerMinute < 1 || rateLimitPerMinute > 10_000) {
    throw new Error('RATE_LIMIT_PER_MINUTE must be an integer from 1 to 10000');
  }

  const logLevel = env.LOG_LEVEL ?? 'info';
  if (logLevel !== 'silent' && logLevel !== 'info' && logLevel !== 'error') {
    throw new Error('LOG_LEVEL must be silent, info, or error');
  }

  const clerkPublishableKey = env.CLERK_PUBLISHABLE_KEY?.trim() || null;
  const clerkSecretKey = env.CLERK_SECRET_KEY?.trim() || null;
  if (Boolean(clerkPublishableKey) !== Boolean(clerkSecretKey)) {
    throw new Error('Set both CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY, or neither.');
  }

  const publicUrl = normalizePublicUrl(env.BOTBRIDGE_PUBLIC_URL);
  if (clerkPublishableKey && !publicUrl) {
    throw new Error('BOTBRIDGE_PUBLIC_URL is required when Clerk is configured. Example: https://bridge.forget.it.com');
  }

  const dashboardDevAuth = env.BOTBRIDGE_DASHBOARD_DEV_AUTH === '1';
  if (dashboardDevAuth && nodeEnv === 'production') {
    throw new Error('BOTBRIDGE_DASHBOARD_DEV_AUTH cannot be enabled when NODE_ENV is production.');
  }

  return {
    databaseUrl,
    secret,
    host: env.HOST?.trim() || '0.0.0.0',
    port,
    allowedHosts,
    rateLimitPerMinute,
    nodeEnv,
    publicUrl,
    clerkPublishableKey,
    clerkSecretKey,
    adminEmails: splitList(env.BOTBRIDGE_ADMIN_EMAILS).map((email) => email.toLowerCase()),
    adminUserIds: splitList(env.BOTBRIDGE_ADMIN_USER_IDS),
    adminOrgId: env.BOTBRIDGE_ADMIN_ORG_ID?.trim() || null,
    adminOrgRole: env.BOTBRIDGE_ADMIN_ORG_ROLE?.trim() || null,
    dashboardDevAuth,
    legacyOwnerEmail: env.BOTBRIDGE_LEGACY_OWNER_EMAIL?.trim().toLowerCase() || null,
    signupMode: env.BOTBRIDGE_SIGNUP_MODE === 'invite' ? 'invite' : 'open',
    files: loadFileConfig(env),
    mentionDoorbellsPerMinute: intEnv(env, 'BOTBRIDGE_MENTION_DOORBELLS_PER_MINUTE', 6, 1, 1_000),
    autoRegister: boolEnv(env, 'BOTBRIDGE_AUTO_REGISTER', false),
  };
}

function boolEnv(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true;
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
  throw new Error(`${name} must be 1 or 0`);
}

function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function loadFileConfig(env: NodeJS.ProcessEnv): FileConfig {
  const storageRaw = env.BOTBRIDGE_STORAGE?.trim().toLowerCase() || 'db';
  if (storageRaw !== 'db' && storageRaw !== 's3') {
    throw new Error('BOTBRIDGE_STORAGE must be db or s3');
  }
  const maxBytes = intEnv(env, 'BOTBRIDGE_FILE_MAX_BYTES', 5 * 1024 * 1024, 1, 100 * 1024 * 1024);
  const urlTtlSeconds = intEnv(env, 'BOTBRIDGE_FILE_URL_TTL_SECONDS', 300, 30, 3_600);
  const typesRaw = splitList(env.BOTBRIDGE_FILE_ALLOWED_TYPES).map((type) => type.toLowerCase());
  const allowedTypes = typesRaw.length > 0 ? typesRaw : DEFAULT_FILE_TYPES;
  for (const type of allowedTypes) {
    if (type !== '*/*' && !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/(\*|[a-z0-9][a-z0-9!#$&^_.+-]*)$/.test(type)) {
      throw new Error(`BOTBRIDGE_FILE_ALLOWED_TYPES has an invalid MIME type: ${type}`);
    }
  }
  let s3: S3Config | null = null;
  if (storageRaw === 's3') {
    const endpoint = required(env, 'BOTBRIDGE_S3_ENDPOINT').replace(/\/+$/, '');
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new Error('BOTBRIDGE_S3_ENDPOINT must be an absolute URL, for example https://<account>.r2.cloudflarestorage.com');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('BOTBRIDGE_S3_ENDPOINT must use https (or http for a local test server).');
    }
    s3 = {
      endpoint,
      region: env.BOTBRIDGE_S3_REGION?.trim() || 'auto',
      bucket: required(env, 'BOTBRIDGE_S3_BUCKET'),
      accessKeyId: required(env, 'BOTBRIDGE_S3_ACCESS_KEY_ID'),
      secretAccessKey: required(env, 'BOTBRIDGE_S3_SECRET_ACCESS_KEY'),
      forcePathStyle: env.BOTBRIDGE_S3_FORCE_PATH_STYLE?.trim() !== '0',
      prefix: (env.BOTBRIDGE_S3_PREFIX?.trim() ?? 'botbridge/').replace(/^\/+/, ''),
    };
  }
  return { storage: storageRaw, maxBytes, allowedTypes, urlTtlSeconds, s3 };
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizePublicUrl(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('BOTBRIDGE_PUBLIC_URL must be an absolute http or https URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('BOTBRIDGE_PUBLIC_URL must use http or https.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('BOTBRIDGE_PUBLIC_URL must be an origin plus an optional path, with no query or credentials.');
  }
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${path === '/' ? '' : path}`;
}

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
}

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
  };
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

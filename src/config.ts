import { LIMITS } from './limits.js';

export interface Config {
  databaseUrl: string;
  secret: string;
  host: string;
  port: number;
  allowedHosts: string[];
  rateLimitPerMinute: number;
  nodeEnv: string;
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

  return {
    databaseUrl,
    secret,
    host: env.HOST?.trim() || '0.0.0.0',
    port,
    allowedHosts,
    rateLimitPerMinute,
    nodeEnv,
  };
}

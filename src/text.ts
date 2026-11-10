import { LIMITS } from './limits.js';
import { UserError } from './errors.js';

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const CAPABILITY_RE = /^[a-z0-9][a-z0-9_+.:-]{0,47}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type WebhookProfile = 'generic' | 'openbot' | 'grok';

export function normalizeName(name: string): string {
  const normalized = name.trim().toLowerCase();
  if (!NAME_RE.test(normalized)) {
    throw new UserError(
      'Bot name must be 1–63 characters: lowercase letters, digits, underscores, or hyphens, starting with a letter or digit.',
    );
  }
  return normalized;
}

export function normalizeDescription(description: string): string {
  const value = description.trim();
  if (value.length > LIMITS.descriptionChars) {
    throw new UserError(`Description must be at most ${LIMITS.descriptionChars} characters.`);
  }
  return value;
}

export function normalizeCapabilities(raw: readonly string[] | string): string[] {
  const parts = typeof raw === 'string' ? raw.split(',') : raw;
  const capabilities: string[] = [];
  for (const part of parts) {
    const capability = part.trim().toLowerCase();
    if (!capability) continue;
    if (!CAPABILITY_RE.test(capability)) {
      throw new UserError(
        `Capability "${part.trim()}" must be 1–48 characters: lowercase letters, digits, and _ + . : -`,
      );
    }
    if (!capabilities.includes(capability)) capabilities.push(capability);
  }
  if (capabilities.length > 16) throw new UserError('A bot can list at most 16 capabilities.');
  return capabilities;
}

export function normalizeProfile(profile: string): WebhookProfile {
  if (profile === 'generic' || profile === 'openbot' || profile === 'grok') return profile;
  throw new UserError('Webhook profile must be generic, openbot, or grok.');
}

export function assertWebhookUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UserError('Webhook URL is not a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UserError('Webhook URL must use http or https.');
  }
  if (url.username || url.password) {
    throw new UserError('Webhook URL must not include credentials.');
  }
  if (url.hash) throw new UserError('Webhook URL must not include a fragment.');
  return url.toString();
}

export function requireText(value: string, max: number, label: string): string {
  const text = value;
  if (text.trim().length === 0) throw new UserError(`${label} must not be empty.`);
  if (text.length > max) throw new UserError(`${label} must be at most ${max} characters.`);
  return text;
}

export function requireUuid(value: string, label: string): string {
  if (!UUID_RE.test(value)) throw new UserError(`${label} must be a UUID.`);
  return value.toLowerCase();
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function preview(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1)}…`;
}

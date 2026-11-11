/** A refusal we can show to the calling bot. */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

const SCALAR_KEYS = [
  'status',
  'statusCode',
  'code',
  'reason',
  'action',
  'clerkTraceId',
  'retryAfter',
  'errno',
  'tokenCarrier',
  'longMessage',
  'syscall',
  'hostname',
] as const;

const JWT = /\beyJ[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]{8,}){2}\b/g;
const BEARER = /\bBearer\s+\S+/gi;
const CLERK_KEY = /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]+\b/g;

/** Fields safe to log from a Clerk or network failure. Tokens and secrets are stripped. */
export function errorFields(error: unknown, depth = 0, seen?: WeakSet<object>): Record<string, unknown> {
  if (depth > 4) return { truncated: true };
  if (typeof error === 'string') return { message: redact(error) };
  if (typeof error === 'number' || typeof error === 'boolean') return { message: String(error) };
  if (error == null) return { message: String(error) };
  if (typeof error !== 'object') return { message: redact(String(error)) };

  const objects = seen ?? new WeakSet<object>();
  if (objects.has(error)) return { circular: true };
  objects.add(error);

  const record = error as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  if (error instanceof Error) {
    fields.name = error.name;
    fields.message = redact(error.message);
    const detail = fullMessage(error);
    if (detail && detail !== error.message) fields.detail = redact(detail);
  } else {
    if (typeof record.name === 'string') fields.name = redact(record.name);
    if (typeof record.message === 'string') fields.message = redact(record.message);
  }
  copyScalars(fields, record);
  if (Array.isArray(record.errors)) {
    fields.errors = record.errors.slice(0, 8).map((item) => errorItem(item, depth, objects));
  }
  if (record.cause !== undefined) fields.cause = errorFields(record.cause, depth + 1, objects);
  if (error instanceof Error && error.stack) {
    fields.stack = error.stack.split('\n').slice(0, 8).map((line) => redact(line, 240)).join('\n');
  }
  return fields;
}

function errorItem(item: unknown, depth: number, seen: WeakSet<object>): Record<string, unknown> {
  if (item instanceof Error) return errorFields(item, depth + 1, seen);
  if (!item || typeof item !== 'object') return { message: redact(String(item)) };
  const record = item as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  for (const key of ['code', 'message', 'longMessage'] as const) {
    const raw = record[key];
    if (typeof raw === 'string') fields[key] = redact(raw);
  }
  return fields;
}

function copyScalars(fields: Record<string, unknown>, record: Record<string, unknown>): void {
  for (const key of SCALAR_KEYS) {
    if (fields[key] !== undefined) continue;
    const value = scalar(record[key]);
    if (value !== undefined) fields[key] = value;
  }
}

function scalar(value: unknown): string | number | boolean | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string' && value) return redact(value);
  return undefined;
}

function fullMessage(error: Error): string | null {
  const candidate = error as Error & { getFullMessage?: () => unknown };
  if (typeof candidate.getFullMessage !== 'function') return null;
  try {
    const value = candidate.getFullMessage();
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

function redact(value: string, max = 400): string {
  const cleaned = value.replace(JWT, '[redacted]').replace(BEARER, 'Bearer [redacted]').replace(CLERK_KEY, '[redacted]');
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max)}…`;
}

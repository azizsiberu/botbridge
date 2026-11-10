export interface PublicConfig {
  version: string;
  publicUrl: string | null;
  clerkPublishableKey: string | null;
  devAuth: boolean;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let tokenGetter: () => Promise<string | null> = async () => null;

export function setTokenGetter(getter: () => Promise<string | null>): void {
  tokenGetter = getter;
}

export async function publicConfig(): Promise<PublicConfig> {
  const response = await fetch('/api/public-config');
  if (!response.ok) throw new ApiError(response.status, 'Could not load configuration');
  return (await response.json()) as PublicConfig;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await tokenGetter();
  const response = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    let message = response.statusText;
    try {
      const body = (await response.json()) as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      /* ignore */
    }
    throw new ApiError(response.status, message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export interface Bot {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  token_prefix: string;
  webhook: { url: string; profile: string } | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
  clerk_user_id: string | null;
  clerk_email: string | null;
  status: 'active' | 'revoked';
}

export interface Overview {
  bots: { active: number; revoked: number };
  messages: { total: number; unread: number; series: Array<{ day: string; count: number }> };
  tasks: { open: number; completed: number; series: Array<{ day: string; count: number }> };
  doorbell: { delivered: number; pending: number; failed: number };
  recent: AuditEntry[];
}

export interface MailMessage {
  id: string;
  thread_id: string;
  kind: string;
  text: string;
  created_at: string;
  read_at: string | null;
  from: { id: string; name: string };
  to: { id: string; name: string };
}

export interface Task {
  id: string;
  instructions: string;
  status: 'open' | 'completed';
  result: string | null;
  created_at: string;
  completed_at: string | null;
  from: { id: string; name: string };
  to: { id: string; name: string };
}

export interface AuditEntry {
  id: string;
  created_at: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  detail: unknown;
  actor_name: string | null;
  target_name: string | null;
}

export interface Delivery {
  id: string;
  event: string;
  attempts: number;
  max_attempts: number;
  last_status: number | null;
  last_error: string | null;
  delivered_at: string | null;
  next_attempt_at: string;
  created_at: string;
  state: string;
  bot: { id: string; name: string };
}

export interface Guide {
  mcpUrl: string;
  resourceMetadataUrl: string | null;
  oauth: boolean;
  tokenPlaceholder: string;
  snippets: Record<string, string>;
}

export interface Settings {
  version: string;
  publicUrl: string | null;
  clerk: boolean;
  devAuth: boolean;
  allowedHosts: string[];
  rateLimitPerMinute: number;
  limits: Record<string, number>;
  allowlist: { emails: string[]; userIds: string[]; orgId: string | null; orgRole: string | null };
}

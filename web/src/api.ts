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

let tokenGetter: (options?: { skipCache?: boolean }) => Promise<string | null> = async () => null;

export function setTokenGetter(getter: (options?: { skipCache?: boolean }) => Promise<string | null>): void {
  tokenGetter = getter;
}

export async function publicConfig(signal?: AbortSignal): Promise<PublicConfig> {
  const response = await fetch('/api/public-config', { signal });
  if (!response.ok) throw new ApiError(response.status, 'Could not load configuration');
  return (await response.json()) as PublicConfig;
}

export async function api<T>(
  path: string,
  init: RequestInit = {},
  auth: { skipCache?: boolean; requireToken?: boolean } = {},
): Promise<T> {
  const token = await tokenGetter(auth.skipCache ? { skipCache: true } : undefined);
  if (auth.requireToken && !token) throw new ApiError(401, 'Clerk session token is not ready');
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
  owner?: { id: string; display_name: string };
  status: 'active' | 'revoked';
}

export interface Account {
  id: string;
  email: string | null;
  displayName: string;
  isAdmin: boolean;
  status: string;
}

export interface Connection {
  id: string;
  kind: 'account' | 'bot';
  status: string;
  direction: 'incoming' | 'outgoing';
  from: { name: string; bot: string | null };
  to: { name: string; bot: string | null };
  created_at: string;
}

export interface Grant {
  id: string;
  client_id: string;
  label: string | null;
  origin_name: string | null;
  created_at: string;
  revoked_at: string | null;
  bot: { id: string; name: string };
}

export interface PendingOAuthClient {
  client_id: string;
  name: string;
  last_seen_at: string;
  last_error: string | null;
}

export interface RegistrationRequest {
  id: string;
  kind: 'oauth' | 'api_key';
  requested_name: string;
  label: string | null;
  client: string;
  reason: string | null;
  status: 'pending' | 'approved' | 'declined';
  attempts: number;
  last_seen_at: string;
}

export interface ApiKey {
  id: string;
  label: string;
  token_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
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
  isAdmin?: boolean;
  signupMode?: 'open' | 'invite';
  oauthSplitClients?: boolean;
  allowlist?: { emails: string[]; userIds: string[]; orgId: string | null; orgRole: string | null };
}

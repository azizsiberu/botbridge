import { createClerkClient, type ClerkClient } from '@clerk/backend';
import { verifyClerkToken } from '@clerk/mcp-tools/server';
import type { Config } from './config.js';
import { log } from './log.js';

export interface AdminIdentity {
  userId: string;
  email: string | null;
  orgRoles: Array<{ orgId: string; role: string }>;
}

export interface AdminAuth {
  verifySession(token: string): Promise<AdminIdentity | null>;
}

export interface OAuthProfile {
  userId: string;
  email: string | null;
  expiresAt: number;
  scopes: string[];
  clientId: string;
}

export interface OAuthVerifier {
  verifyAccessToken(token: string): Promise<OAuthProfile | null>;
}

export interface ClerkDirectory {
  lookup(input: { userId?: string | null; email?: string | null }): Promise<{ userId: string; email: string | null } | null>;
}

const DEV_ADMIN: AdminIdentity = {
  userId: 'user_devadmin',
  email: 'dev-admin@localhost',
  orgRoles: [],
};

export function isAllowlisted(config: Config, identity: AdminIdentity): boolean {
  if (config.adminUserIds.includes(identity.userId)) return true;
  if (identity.email && config.adminEmails.includes(identity.email.toLowerCase())) return true;
  if (config.adminOrgId && config.adminOrgRole) {
    return identity.orgRoles.some((membership) => membership.orgId === config.adminOrgId && membership.role === config.adminOrgRole);
  }
  return false;
}

export function allowlistConfigured(config: Config): boolean {
  return config.adminEmails.length > 0 || config.adminUserIds.length > 0 || Boolean(config.adminOrgId && config.adminOrgRole);
}

let clerkClient: ClerkClient | null = null;

function clerk(config: Config): ClerkClient | null {
  if (!config.clerkSecretKey) return null;
  clerkClient ??= createClerkClient({
    secretKey: config.clerkSecretKey,
    publishableKey: config.clerkPublishableKey ?? undefined,
  });
  return clerkClient;
}

export function createAdminAuth(config: Config): AdminAuth {
  return {
    async verifySession(token: string): Promise<AdminIdentity | null> {
      if (config.dashboardDevAuth && token === 'dev-admin') return DEV_ADMIN;
      const client = clerk(config);
      if (!client) return null;
      try {
        const state = await client.authenticateRequest(sessionRequest(token), { acceptsToken: 'session_token' });
        if (!state.isAuthenticated) return null;
        const auth = state.toAuth();
        const userId = auth.userId;
        if (!userId) return null;
        const user = await client.users.getUser(userId);
        const email = primaryEmail(user);
        const orgRoles = config.adminOrgId ? await orgMemberships(client, userId) : [];
        return { userId, email, orgRoles };
      } catch (error) {
        log('error', 'admin session rejected', { error: error instanceof Error ? error.message : 'unknown' });
        return null;
      }
    },
  };
}

export function createOAuthVerifier(config: Config): OAuthVerifier | null {
  if (!config.clerkSecretKey || !config.publicUrl) return null;
  const resourceUrl = `${config.publicUrl}/mcp`;
  return {
    async verifyAccessToken(token: string): Promise<OAuthProfile | null> {
      const client = clerk(config);
      if (!client) return null;
      try {
        const state = await client.authenticateRequest(new Request(resourceUrl, { headers: { authorization: `Bearer ${token}` } }), {
          acceptsToken: 'oauth_token',
          audience: resourceUrl,
        });
        if (!state.isAuthenticated) return null;
        const auth = state.toAuth();
        const info = verifyClerkToken(auth, token);
        const userId = info?.extra.userId ?? auth.userId;
        if (!userId) return null;
        const user = await client.users.getUser(userId);
        return {
          userId,
          email: primaryEmail(user),
          expiresAt: info?.expiresAt ?? jwtExpiry(token) ?? Math.floor(Date.now() / 1000) + 60 * 10,
          scopes: info?.scopes ?? [],
          clientId: info?.clientId || userId,
        };
      } catch (error) {
        log('error', 'oauth token rejected', { error: error instanceof Error ? error.message : 'unknown' });
        return null;
      }
    },
  };
}

export function createClerkDirectory(config: Config): ClerkDirectory | null {
  const client = clerk(config);
  if (!client) return null;
  return {
    async lookup(input): Promise<{ userId: string; email: string | null } | null> {
      if (input.userId) {
        const user = await client.users.getUser(input.userId);
        return { userId: user.id, email: primaryEmail(user) };
      }
      if (input.email) {
        const list = await client.users.getUserList({ emailAddress: [input.email], limit: 1 });
        const user = list.data[0];
        if (!user) return null;
        return { userId: user.id, email: primaryEmail(user) };
      }
      return null;
    },
  };
}

function sessionRequest(token: string): Request {
  return new Request('http://botbridge.local/api/admin', { headers: { authorization: `Bearer ${token}` } });
}

function primaryEmail(user: { primaryEmailAddressId: string | null; emailAddresses: Array<{ id: string; emailAddress: string }> }): string | null {
  const primary = user.emailAddresses.find((address) => address.id === user.primaryEmailAddressId);
  return primary?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? null;
}

async function orgMemberships(client: ClerkClient, userId: string): Promise<Array<{ orgId: string; role: string }>> {
  const list = await client.users.getOrganizationMembershipList({ userId, limit: 50 });
  return list.data.map((membership) => ({ orgId: membership.organization.id, role: membership.role }));
}

function jwtExpiry(token: string): number | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { exp?: unknown };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server';
import { UserError } from './errors.js';
import type { OAuthVerifier } from './identity.js';
import type { Pool } from './db.js';
import { TOKEN_LIFETIME_SECONDS } from './limits.js';
import { mcpRequestStore } from './mcp-request.js';
import { connectContext, resolveApiKeyConnection, resolveOAuthConnection } from './registration.js';
import { accountIdForClerk } from './tenancy.js';
import { authenticateBot, type Actor } from './store.js';

export function createTokenVerifier(pool: Pool, oauth: OAuthVerifier | null = null, selectionUrl?: string | null): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      if (token.startsWith('bb_')) {
        const actor = await authenticateBot(pool, token);
        if (!actor) throw new OAuthError(OAuthErrorCode.InvalidToken, 'Unknown or revoked bot token');
        return botAuth(token, actor, 'token', Math.floor(Date.now() / 1000) + TOKEN_LIFETIME_SECONDS, ['bot']);
      }
      try {
        const ctx = currentConnectContext();
        if (token.startsWith('bbk_')) {
          const resolved = await resolveApiKeyConnection(pool, token, ctx);
          return botAuth(
            token,
            resolved.actor,
            'api_key',
            Math.floor(Date.now() / 1000) + TOKEN_LIFETIME_SECONDS,
            ['bot'],
            resolved.sessionId,
          );
        }
        if (!oauth) throw new OAuthError(OAuthErrorCode.InvalidToken, 'Unknown or revoked bot token');
        const profile = await oauth.verifyAccessToken(token);
        if (!profile) throw new OAuthError(OAuthErrorCode.InvalidToken, 'Clerk rejected this access token');
        const accountId = await accountIdForClerk(pool, profile.userId, profile.email);
        if (!accountId) throw new UserError('Sign in on the botbridge dashboard before using OAuth.');
        const clientId = (profile.clientId || 'default').trim() || 'default';
        const resolved = await resolveOAuthConnection(pool, accountId, clientId, ctx, selectionUrl ?? null);
        const info = botAuth(
          token,
          resolved.actor,
          'oauth',
          profile.expiresAt,
          profile.scopes.length > 0 ? profile.scopes : ['profile', 'email'],
          resolved.sessionId,
        );
        return {
          ...info,
          extra: { ...info.extra, clerkUserId: profile.userId },
        };
      } catch (error) {
        if (error instanceof UserError) throw new OAuthError(OAuthErrorCode.InvalidToken, error.message);
        if (error instanceof OAuthError) throw error;
        throw error;
      }
    },
  };
}

function currentConnectContext() {
  const req = mcpRequestStore.getStore();
  return connectContext({
    body: req?.body,
    sessionHeader: req?.header('mcp-session-id') ?? null,
    botHeader: botFromRequest(req?.header('x-botbridge-bot') ?? null, pathBot(req?.params)),
  });
}

function pathBot(params: unknown): string | null {
  if (!params || typeof params !== 'object') return null;
  const bot = (params as { bot?: unknown }).bot;
  return typeof bot === 'string' && bot.trim() ? bot : null;
}

/** The bot named by X-Botbridge-Bot or by /mcp/b/<bot>. Two different names are refused rather than guessed. */
export function botFromRequest(header: string | null, path: string | null): string | null {
  const fromHeader = header?.trim() || null;
  if (fromHeader && path && fromHeader.toLowerCase() !== path.trim().toLowerCase()) {
    throw new UserError(`X-Botbridge-Bot "${fromHeader}" does not match the bot in the URL "${path}". Use one or the other.`);
  }
  return fromHeader ?? path;
}

function botAuth(
  token: string,
  actor: Actor,
  method: 'token' | 'oauth' | 'api_key',
  expiresAt: number,
  scopes: string[],
  sessionId?: string | null,
): AuthInfo {
  return {
    token,
    clientId: actor.id,
    scopes,
    // Static bot tokens do not expire until revoke. The SDK still requires expiresAt.
    expiresAt,
    extra: {
      ...botExtra(actor),
      authMethod: method,
      ...(sessionId ? { mcpSessionId: sessionId } : {}),
    },
  };
}

function botExtra(actor: Actor): Record<string, unknown> {
  return {
    botId: actor.id,
    botName: actor.name,
    description: actor.description,
    capabilities: actor.capabilities,
    webhookConfigured: actor.webhookConfigured,
    webhookProfile: actor.webhookProfile,
    ownerUserId: actor.ownerUserId,
    ownerName: actor.ownerName,
  };
}

export function actorFromAuth(authInfo: AuthInfo | undefined): Actor {
  const extra = authInfo?.extra;
  if (!extra || typeof extra.botId !== 'string' || typeof extra.botName !== 'string') {
    throw new Error('Authenticated request is missing bot identity');
  }
  const capabilities = Array.isArray(extra.capabilities)
    ? extra.capabilities.filter((item): item is string => typeof item === 'string')
    : [];
  const profile = extra.webhookProfile;
  return {
    id: extra.botId,
    name: extra.botName,
    description: typeof extra.description === 'string' ? extra.description : '',
    capabilities,
    webhookConfigured: extra.webhookConfigured === true,
    webhookProfile: profile === 'generic' || profile === 'openbot' || profile === 'grok' ? profile : null,
    ownerUserId: typeof extra.ownerUserId === 'string' ? extra.ownerUserId : '',
    ownerName: typeof extra.ownerName === 'string' ? extra.ownerName : '',
  };
}

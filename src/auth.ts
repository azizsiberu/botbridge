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
import { authenticateBot, resolveOAuthBot, type Actor } from './store.js';

export function createTokenVerifier(pool: Pool, oauth: OAuthVerifier | null = null): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      if (token.startsWith('bb_')) {
        const actor = await authenticateBot(pool, token);
        if (!actor) throw new OAuthError(OAuthErrorCode.InvalidToken, 'Unknown or revoked bot token');
        return botAuth(token, actor, 'token', Math.floor(Date.now() / 1000) + TOKEN_LIFETIME_SECONDS, ['bot']);
      }
      if (!oauth) throw new OAuthError(OAuthErrorCode.InvalidToken, 'Unknown or revoked bot token');
      const profile = await oauth.verifyAccessToken(token);
      if (!profile) throw new OAuthError(OAuthErrorCode.InvalidToken, 'Clerk rejected this access token');
      try {
        const actor = await resolveOAuthBot(pool, { userId: profile.userId, email: profile.email });
        return {
          ...botAuth(token, actor, 'oauth', profile.expiresAt, profile.scopes.length > 0 ? profile.scopes : ['profile', 'email']),
          extra: {
            ...botExtra(actor),
            authMethod: 'oauth',
            clerkUserId: profile.userId,
          },
        };
      } catch (error) {
        if (error instanceof UserError) throw new OAuthError(OAuthErrorCode.InvalidToken, error.message);
        throw error;
      }
    },
  };
}

function botAuth(token: string, actor: Actor, method: 'token' | 'oauth', expiresAt: number, scopes: string[]): AuthInfo {
  return {
    token,
    clientId: actor.id,
    scopes,
    // Static bot tokens do not expire until revoke. The SDK still requires expiresAt.
    expiresAt,
    extra: { ...botExtra(actor), authMethod: method },
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
  };
}

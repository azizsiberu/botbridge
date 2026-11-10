import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server';
import type { Pool } from './db.js';
import { TOKEN_LIFETIME_SECONDS } from './limits.js';
import { authenticateBot, type Actor } from './store.js';

export function createTokenVerifier(pool: Pool): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      const actor = await authenticateBot(pool, token);
      if (!actor) {
        throw new OAuthError(OAuthErrorCode.InvalidToken, 'Unknown or revoked bot token');
      }
      return {
        token,
        clientId: actor.id,
        scopes: ['bot'],
        // The SDK rejects tokens with no expiry. These tokens are revoked, not expired.
        expiresAt: Math.floor(Date.now() / 1000) + TOKEN_LIFETIME_SECONDS,
        extra: {
          botId: actor.id,
          botName: actor.name,
          description: actor.description,
          capabilities: actor.capabilities,
          webhookConfigured: actor.webhookConfigured,
          webhookProfile: actor.webhookProfile,
        },
      };
    },
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

export interface ConnectGuide {
  mcpUrl: string;
  resourceMetadataUrl: string | null;
  oauth: boolean;
  tokenPlaceholder: string;
  snippets: {
    generic: string;
    claudeCode: string;
    cursor: string;
    grok: string;
    openbot: string;
    chatgpt: string;
  };
}

export function connectGuide(publicUrl: string | null, oauth: boolean, token?: string): ConnectGuide {
  const origin = publicUrl ?? 'https://bridge.example.com';
  const mcpUrl = `${origin}/mcp`;
  const legacy = token ?? 'bb_your_token';
  const keyHeader = 'Authorization: Bearer bbk_your_api_key';
  const oauthNote = oauth
    ? 'OAuth: add the URL and sign in. botbridge creates a bot for this client. You do not pick one first.'
    : 'OAuth is not configured. Set Clerk and BOTBRIDGE_PUBLIC_URL, then add the URL and sign in.';
  const keyNote = [
    'API key: create one on the API keys page and send this header. Each client name becomes its own bot.',
    keyHeader,
    'Optional: X-Botbridge-Bot: your-bot-name',
    `A legacy per-bot token still works in place of the key: Authorization: Bearer ${legacy}`,
  ].join('\n');
  return {
    mcpUrl,
    resourceMetadataUrl: oauth ? `${origin}/.well-known/oauth-protected-resource/mcp` : null,
    oauth,
    tokenPlaceholder: legacy,
    snippets: {
      generic: [`URL: ${mcpUrl}`, oauthNote, keyNote].join('\n\n'),
      claudeCode: [httpConfig(mcpUrl, false), '', oauthNote, '', httpConfig(mcpUrl, true), '', keyNote].join('\n'),
      cursor: [httpConfig(mcpUrl, false), '', oauthNote, '', httpConfig(mcpUrl, true), '', keyNote].join('\n'),
      grok: [
        'In Grok Bot, add a remote MCP connector.',
        `URL: ${mcpUrl}`,
        oauth ? 'Sign in with OAuth, or send an account API key.' : 'Send an account API key.',
        keyHeader,
        'The path has to be /mcp.',
        'A webhook routine is separate: it wakes the bot. The connector is how the bot calls tools after it is awake.',
        `Legacy per-bot tokens still work: Authorization: Bearer ${legacy}`,
      ].join('\n'),
      openbot: [
        'In OpenBot, add a remote HTTP MCP server.',
        `URL: ${mcpUrl}`,
        keyHeader,
        'For the doorbell, create a webhook routine and save its URL and secret on this bot with the openbot profile.',
        `Legacy per-bot tokens still work: Authorization: Bearer ${legacy}`,
      ].join('\n'),
      chatgpt: oauth
        ? [
            'ChatGPT custom connectors use OAuth. They do not take a pasted token.',
            `Server URL: ${mcpUrl}`,
            'Choose OAuth when ChatGPT asks how to authenticate.',
            'Sign in with Clerk. botbridge registers a bot for that client and shows it in the desk.',
            'The same client keeps that bot the next time it connects.',
            'To use a bot you already have, open Connections and bind this client to it.',
          ].join('\n')
        : [
            'OAuth is not configured on this botbridge yet.',
            'ChatGPT custom connectors do not accept a static bearer token.',
            'Set Clerk and BOTBRIDGE_PUBLIC_URL, then connect with OAuth.',
            `Server URL once OAuth is on: ${mcpUrl}`,
          ].join('\n'),
    },
  };
}

function httpConfig(mcpUrl: string, withKey: boolean): string {
  return JSON.stringify(
    {
      mcpServers: {
        botbridge: {
          type: 'http',
          url: mcpUrl,
          ...(withKey ? { headers: { Authorization: 'Bearer bbk_your_api_key' } } : {}),
        },
      },
    },
    null,
    2,
  );
}

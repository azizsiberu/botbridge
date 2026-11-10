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
  const shown = token ?? 'bb_your_token';
  const header = `Authorization: Bearer ${shown}`;
  return {
    mcpUrl,
    resourceMetadataUrl: oauth ? `${origin}/.well-known/oauth-protected-resource/mcp` : null,
    oauth,
    tokenPlaceholder: shown,
    snippets: {
      generic: `${header}\n${mcpUrl}`,
      claudeCode: JSON.stringify(
        {
          mcpServers: {
            botbridge: {
              type: 'http',
              url: mcpUrl,
              headers: { Authorization: `Bearer ${shown}` },
            },
          },
        },
        null,
        2,
      ),
      cursor: JSON.stringify(
        {
          mcpServers: {
            botbridge: {
              url: mcpUrl,
              headers: { Authorization: `Bearer ${shown}` },
            },
          },
        },
        null,
        2,
      ),
      grok: [
        'In Grok Bot, add a remote MCP connector.',
        `URL: ${mcpUrl}`,
        `Header: ${header}`,
        'The path has to be /mcp.',
        'A webhook routine is separate: it wakes the bot. The connector is how the bot calls tools after it is awake.',
      ].join('\n'),
      openbot: [
        'In OpenBot, add a remote HTTP MCP server.',
        `URL: ${mcpUrl}`,
        `Header: ${header}`,
        'For the doorbell, create a webhook routine and save its URL and secret on this bot with the openbot profile.',
      ].join('\n'),
      chatgpt: oauth
        ? [
            'ChatGPT custom connectors use OAuth, not a pasted bearer token.',
            `Server URL: ${mcpUrl}`,
            'Choose OAuth when ChatGPT asks how to authenticate.',
            'Sign in with Clerk. botbridge uses the Clerk user linked to this bot.',
            'If this bot has no Clerk link yet, the first sign-in creates a new bot unless an admin reserved your email here first.',
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

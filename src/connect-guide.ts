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
            'ChatGPT, Cursor, and other OAuth clients sign in with Clerk. They do not use the bearer token above.',
            `Server URL: ${mcpUrl}`,
            'An account with one active bot is bound on the first connection.',
            'With several bots, open the desk. Overview and Connections list the client, and Choose bot finishes the grant.',
            'Cursor client ids are URLs. The desk shows the host, for example cursor.com.',
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

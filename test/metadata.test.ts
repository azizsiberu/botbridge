import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listenForTests, type TestServer } from './helpers.js';

const publishableKey = `pk_test_${Buffer.from('clerk.example.com$').toString('base64')}`;

describe('protected resource metadata', () => {
  let app: TestServer;

  beforeAll(async () => {
    app = await listenForTests({ publicUrl: 'https://bridge.example.com', clerkPublishableKey: publishableKey });
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves the /mcp resource for a per-bot URL so the token audience does not change', async () => {
    const plain = await (await fetch(`${app.baseUrl}/.well-known/oauth-protected-resource/mcp`)).json();
    const response = await fetch(`${app.baseUrl}/.well-known/oauth-protected-resource/mcp/b/grokbot-ajeg`);
    expect(response.status).toBe(200);
    const perBot = (await response.json()) as { resource?: string };
    expect(perBot.resource).toBe('https://bridge.example.com/mcp');
    expect(perBot).toEqual(plain);
  });
});

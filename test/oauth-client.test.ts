import { describe, expect, it } from 'vitest';
import { oauthClientName } from '../src/oauth-client.js';

describe('oauth client names', () => {
  it('shows the host of a CIMD client id and leaves opaque ids alone', () => {
    expect(oauthClientName('https://cursor.com/oauth/mcp-client.json')).toBe('cursor.com');
    expect(oauthClientName('https://Cursor.com/oauth/mcp-client.json')).toBe('cursor.com');
    expect(oauthClientName('https://user:pass@cursor.com/oauth/mcp-client.json')).toBe('cursor.com');
    expect(oauthClientName('chatgpt')).toBe('chatgpt');
    expect(oauthClientName('javascript:alert(1)')).toBe('javascript:alert(1)');
    expect(oauthClientName('')).toBe('default');
    expect(oauthClientName('   ')).toBe('default');
  });
});

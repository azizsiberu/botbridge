import { describe, expect, it } from 'vitest';
import { originFromClientInfo, slugBotName, suffixedBotName } from '../src/bot-name.js';

describe('bot names from clients', () => {
  it('slugs a host and keeps a clientInfo name with its title', () => {
    expect(slugBotName('cursor.com')).toBe('cursor-com');
    expect(slugBotName('  Cursor  ')).toBe('cursor');
    expect(originFromClientInfo({ name: 'cursor', title: 'Cursor' })).toBe('cursor');
    expect(originFromClientInfo({ name: 'cursor', title: 'Inbox' })).toBe('cursor-inbox');
    expect(originFromClientInfo({ title: 'My Bot' })).toBe('my-bot');
    expect(suffixedBotName('cursor', 1)).toBe('cursor');
    expect(suffixedBotName('cursor', 2)).toBe('cursor-2');
    expect(suffixedBotName('a'.repeat(63), 12).length).toBeLessThanOrEqual(63);
  });
});

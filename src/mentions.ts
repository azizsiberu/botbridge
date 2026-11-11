import type { Pool } from './db.js';

interface Queryable {
  query: Pool['query'];
}

// @name, where name follows bot-name rules. Not preceded by a word character, so emails do not count.
const MENTION_RE = /(?<![A-Za-z0-9_.@-])@([a-z0-9][a-z0-9_-]{0,62})(?![a-z0-9_-])/gi;

/** Lowercase bot names mentioned in text, in order of first appearance, at most 20. */
export function parseMentions(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(MENTION_RE)) {
    const name = match[1]?.toLowerCase();
    if (name && !names.includes(name)) names.push(name);
    if (names.length >= 20) break;
  }
  return names;
}

/**
 * Count one mention doorbell for a bot in a scope (a room id, or `dm:<sender id>`) this minute.
 * Returns false when the bot is over the limit: the post is still stored, but the bell does not ring.
 */
export async function takeMentionSlot(db: Queryable, botId: string, scope: string, limit: number): Promise<boolean> {
  const result = await db.query<{ hits: number }>(
    `INSERT INTO mention_windows (bot_id, scope, window_start, hits)
     VALUES ($1, $2, date_trunc('minute', now()), 1)
     ON CONFLICT (bot_id, scope, window_start)
     DO UPDATE SET hits = mention_windows.hits + 1
     RETURNING hits`,
    [botId, scope],
  );
  return (result.rows[0]?.hits ?? 1) <= limit;
}

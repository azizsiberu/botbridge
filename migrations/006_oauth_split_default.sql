-- A new client name on a shared OAuth client id now gets its own bot by
-- default. Before this, a second agent that shared a client id (two Grok Bots,
-- two Cursor-based apps) was silently bound to the first agent's bot.
-- The opt-out stays in Settings for clients whose name changes between runs.
ALTER TABLE users
  ALTER COLUMN oauth_split_clients SET DEFAULT true;

UPDATE users SET oauth_split_clients = true WHERE oauth_split_clients = false;

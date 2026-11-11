-- Account API keys, MCP session bindings, and OAuth client-name splits.
-- Existing oauth_grants rows and per-bot bb_ tokens are left in place.

ALTER TABLE users
  ADD COLUMN oauth_split_clients boolean NOT NULL DEFAULT false;

ALTER TABLE oauth_grants
  ADD COLUMN origin_name text;

ALTER TABLE oauth_grants
  ADD CONSTRAINT oauth_grants_origin_len CHECK (origin_name IS NULL OR char_length(origin_name) BETWEEN 1 AND 63);

-- One active grant per client id and origin. NULL origin (grants from before
-- this column, and manual rebinds) shares one slot so a client id still maps
-- to a single bot until an origin name is recorded.
DROP INDEX oauth_grants_active;
CREATE UNIQUE INDEX oauth_grants_active
  ON oauth_grants (user_id, clerk_client_id, COALESCE(origin_name, ''))
  WHERE revoked_at IS NULL;

ALTER TABLE oauth_pending_clients
  ADD COLUMN last_error text;

CREATE TABLE api_keys (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id),
  label text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  token_prefix text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT api_keys_label_len CHECK (char_length(label) BETWEEN 1 AND 80)
);

CREATE INDEX api_keys_user ON api_keys (user_id, created_at DESC);

-- Which bot an account key should act as for a given client name.
CREATE TABLE api_key_bots (
  api_key_id uuid NOT NULL REFERENCES api_keys (id) ON DELETE CASCADE,
  client_name text NOT NULL,
  bot_id uuid NOT NULL REFERENCES bots (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (api_key_id, client_name),
  CONSTRAINT api_key_bots_name_len CHECK (char_length(client_name) BETWEEN 1 AND 63)
);

-- Streamable HTTP here does not keep SDK session state. We remember the bot
-- chosen at initialize and read it back from Mcp-Session-Id.
CREATE TABLE mcp_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  bot_id uuid NOT NULL REFERENCES bots (id) ON DELETE CASCADE,
  kind text NOT NULL,
  api_key_id uuid REFERENCES api_keys (id) ON DELETE CASCADE,
  oauth_client_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mcp_sessions_kind CHECK (kind IN ('oauth', 'api_key')),
  CONSTRAINT mcp_sessions_shape CHECK (
    (kind = 'api_key' AND api_key_id IS NOT NULL AND oauth_client_id IS NULL)
    OR (kind = 'oauth' AND api_key_id IS NULL AND oauth_client_id IS NOT NULL)
  )
);

CREATE INDEX mcp_sessions_user ON mcp_sessions (user_id, last_seen_at DESC);

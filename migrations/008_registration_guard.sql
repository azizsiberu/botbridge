-- Stop silent bot registration and silent cross-account reach.
--
-- 1. bot_registration_requests: a client that would have minted a new bot on an
--    OAuth client or API key that already has one now waits here for the
--    account owner (dashboard or CLI) instead.
-- 2. bots.account_links: an approved account-to-account connection used to
--    cover every bot of both accounts, including bots created later. Now it
--    covers bots that existed when it was approved, plus bots flagged here.
--    Every bot that exists today keeps its reach (flag = true). New bots start
--    at false and need a bot connection, or an account connection approved
--    after they were created.

ALTER TABLE bots ADD COLUMN account_links boolean NOT NULL DEFAULT false;
UPDATE bots SET account_links = true;

CREATE TABLE bot_registration_requests (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind text NOT NULL,
  oauth_client_id text,
  api_key_id uuid REFERENCES api_keys (id) ON DELETE CASCADE,
  requested_name text NOT NULL,
  label text,
  reason text,
  status text NOT NULL DEFAULT 'pending',
  bot_id uuid REFERENCES bots (id),
  attempts integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  CONSTRAINT bot_registration_kind CHECK (kind IN ('oauth', 'api_key')),
  CONSTRAINT bot_registration_status CHECK (status IN ('pending', 'approved', 'declined')),
  CONSTRAINT bot_registration_name_len CHECK (char_length(requested_name) BETWEEN 1 AND 63),
  CONSTRAINT bot_registration_shape CHECK (
    (kind = 'oauth' AND oauth_client_id IS NOT NULL AND api_key_id IS NULL)
    OR (kind = 'api_key' AND api_key_id IS NOT NULL AND oauth_client_id IS NULL)
  )
);

CREATE INDEX bot_registration_user ON bot_registration_requests (user_id, status, last_seen_at DESC);

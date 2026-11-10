CREATE TABLE users (
  id uuid PRIMARY KEY,
  clerk_user_id text UNIQUE,
  email text,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_status CHECK (status IN ('active', 'suspended')),
  CONSTRAINT users_email_lower CHECK (email IS NULL OR email = lower(email))
);

CREATE UNIQUE INDEX users_email ON users (email) WHERE email IS NOT NULL;

-- v0.1 bots have no owner until startup assigns them.
INSERT INTO users (id, display_name)
VALUES ('00000000-0000-4000-8000-000000000001', 'Unassigned');

ALTER TABLE bots ADD COLUMN owner_user_id uuid REFERENCES users (id);
UPDATE bots SET owner_user_id = '00000000-0000-4000-8000-000000000001' WHERE owner_user_id IS NULL;
ALTER TABLE bots ALTER COLUMN owner_user_id SET NOT NULL;

DROP INDEX IF EXISTS bots_clerk_user_id;
DROP INDEX IF EXISTS bots_clerk_email;
ALTER TABLE bots DROP COLUMN IF EXISTS clerk_user_id;
ALTER TABLE bots DROP COLUMN IF EXISTS clerk_email;

CREATE INDEX bots_owner ON bots (owner_user_id);

CREATE TABLE connections (
  id uuid PRIMARY KEY,
  kind text NOT NULL,
  from_user_id uuid NOT NULL REFERENCES users (id),
  from_bot_id uuid REFERENCES bots (id),
  to_user_id uuid NOT NULL REFERENCES users (id),
  to_bot_id uuid REFERENCES bots (id),
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT connections_kind CHECK (kind IN ('account', 'bot')),
  CONSTRAINT connections_status CHECK (status IN ('pending', 'active', 'declined', 'revoked')),
  CONSTRAINT connections_shape CHECK (
    (kind = 'account' AND from_bot_id IS NULL AND to_bot_id IS NULL)
    OR (kind = 'bot' AND from_bot_id IS NOT NULL AND to_bot_id IS NOT NULL)
  ),
  CONSTRAINT connections_not_self CHECK (from_user_id <> to_user_id)
);

CREATE INDEX connections_from_user ON connections (from_user_id, status);
CREATE INDEX connections_to_user ON connections (to_user_id, status);

CREATE TABLE oauth_grants (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id),
  bot_id uuid NOT NULL REFERENCES bots (id),
  clerk_client_id text NOT NULL,
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE UNIQUE INDEX oauth_grants_active ON oauth_grants (user_id, clerk_client_id) WHERE revoked_at IS NULL;

CREATE TABLE instance_settings (
  id int PRIMARY KEY CHECK (id = 1),
  signup_mode text NOT NULL DEFAULT 'open',
  signup_locked boolean NOT NULL DEFAULT false,
  legacy_claimed boolean NOT NULL DEFAULT false,
  CONSTRAINT instance_signup CHECK (signup_mode IN ('open', 'invite'))
);

INSERT INTO instance_settings (id) VALUES (1);

CREATE TABLE invites (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz
);

CREATE UNIQUE INDEX invites_email ON invites (email);

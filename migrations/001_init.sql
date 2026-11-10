CREATE TABLE bots (
  id uuid PRIMARY KEY,
  name text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  capabilities text[] NOT NULL DEFAULT '{}',
  token_hash text NOT NULL UNIQUE,
  token_prefix text NOT NULL,
  webhook_url text,
  webhook_secret_enc text,
  webhook_profile text,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT bots_name_format CHECK (name ~ '^[a-z0-9][a-z0-9_-]{0,62}$'),
  CONSTRAINT bots_description_len CHECK (char_length(description) <= 500),
  CONSTRAINT bots_webhook_profile CHECK (
    webhook_profile IS NULL OR webhook_profile IN ('generic', 'openbot', 'grok')
  ),
  CONSTRAINT bots_webhook_pair CHECK (
    (webhook_url IS NULL AND webhook_secret_enc IS NULL AND webhook_profile IS NULL)
    OR (webhook_url IS NOT NULL AND webhook_secret_enc IS NOT NULL AND webhook_profile IS NOT NULL)
  )
);

CREATE TABLE messages (
  id uuid PRIMARY KEY,
  thread_id uuid NOT NULL,
  from_bot_id uuid NOT NULL REFERENCES bots (id),
  to_bot_id uuid NOT NULL REFERENCES bots (id),
  kind text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  CONSTRAINT messages_kind CHECK (kind IN ('direct', 'broadcast')),
  CONSTRAINT messages_body_len CHECK (char_length(body) BETWEEN 1 AND 8000)
);

CREATE INDEX messages_inbox ON messages (to_bot_id, created_at DESC);
CREATE INDEX messages_thread ON messages (thread_id, created_at);

CREATE TABLE tasks (
  id uuid PRIMARY KEY,
  from_bot_id uuid NOT NULL REFERENCES bots (id),
  to_bot_id uuid NOT NULL REFERENCES bots (id),
  instructions text NOT NULL,
  status text NOT NULL,
  result text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT tasks_status CHECK (status IN ('open', 'completed')),
  CONSTRAINT tasks_instructions_len CHECK (char_length(instructions) BETWEEN 1 AND 16000),
  CONSTRAINT tasks_result_len CHECK (result IS NULL OR char_length(result) <= 16000),
  CONSTRAINT tasks_completion CHECK (
    (status = 'open' AND result IS NULL AND completed_at IS NULL)
    OR (status = 'completed' AND result IS NOT NULL AND completed_at IS NOT NULL)
  )
);

CREATE INDEX tasks_assignee ON tasks (to_bot_id, status, created_at DESC);
CREATE INDEX tasks_author ON tasks (from_bot_id, status, created_at DESC);

CREATE TABLE audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_bot_id uuid REFERENCES bots (id),
  action text NOT NULL,
  target_bot_id uuid,
  resource_type text NOT NULL,
  resource_id text,
  detail jsonb NOT NULL DEFAULT '{}'
);

CREATE INDEX audit_log_created ON audit_log (created_at DESC);

CREATE TABLE rate_windows (
  bot_id uuid NOT NULL REFERENCES bots (id) ON DELETE CASCADE,
  window_start timestamptz NOT NULL,
  hits integer NOT NULL,
  PRIMARY KEY (bot_id, window_start)
);

CREATE TABLE doorbell_jobs (
  id uuid PRIMARY KEY,
  bot_id uuid NOT NULL REFERENCES bots (id),
  event text NOT NULL,
  body text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  last_status integer,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX doorbell_due ON doorbell_jobs (next_attempt_at)
  WHERE delivered_at IS NULL;

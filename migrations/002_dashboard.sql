ALTER TABLE bots
  ADD COLUMN clerk_user_id text,
  ADD COLUMN clerk_email text,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX bots_clerk_user_id ON bots (clerk_user_id) WHERE clerk_user_id IS NOT NULL;
CREATE INDEX bots_clerk_email ON bots (lower(clerk_email)) WHERE clerk_email IS NOT NULL;

CREATE INDEX messages_created ON messages (created_at DESC);
CREATE INDEX tasks_created ON tasks (created_at DESC);
CREATE INDEX doorbell_created ON doorbell_jobs (created_at DESC);
CREATE INDEX audit_action ON audit_log (action, created_at DESC);

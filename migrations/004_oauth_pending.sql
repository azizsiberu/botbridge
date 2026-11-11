-- OAuth clients that presented a verified token before a bot was chosen.
-- Removed when a grant is created. The desk lists these so the choice
-- can happen without reading the client's 401 body.
CREATE TABLE oauth_pending_clients (
  user_id uuid NOT NULL REFERENCES users (id),
  clerk_client_id text NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, clerk_client_id),
  CONSTRAINT oauth_pending_client_len CHECK (char_length(clerk_client_id) BETWEEN 1 AND 2048)
);

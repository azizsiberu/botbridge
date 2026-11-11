-- Rooms (group threads), @mentions, and file attachments for messages and room posts.

CREATE TABLE rooms (
  id uuid PRIMARY KEY,
  name text NOT NULL UNIQUE,
  created_by_bot_id uuid NOT NULL REFERENCES bots (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rooms_name_format CHECK (name ~ '^[a-z0-9][a-z0-9_-]{0,62}$')
);

CREATE TABLE room_members (
  room_id uuid NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  bot_id uuid NOT NULL REFERENCES bots (id),
  invited_by_bot_id uuid REFERENCES bots (id),
  joined_at timestamptz NOT NULL DEFAULT now(),
  -- Unread tracking: posts with seq > last_read_seq are unread for this member.
  last_read_seq bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (room_id, bot_id)
);

CREATE INDEX room_members_bot ON room_members (bot_id);

CREATE TABLE room_posts (
  id uuid PRIMARY KEY,
  seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  room_id uuid NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  from_bot_id uuid NOT NULL REFERENCES bots (id),
  body text NOT NULL,
  mentions uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT room_posts_body_len CHECK (char_length(body) BETWEEN 1 AND 8000)
);

CREATE INDEX room_posts_room ON room_posts (room_id, seq);

-- Loop protection: how many mention doorbells a bot received in a room (or DM scope) per minute.
CREATE TABLE mention_windows (
  bot_id uuid NOT NULL REFERENCES bots (id) ON DELETE CASCADE,
  scope text NOT NULL,
  window_start timestamptz NOT NULL,
  hits integer NOT NULL,
  PRIMARY KEY (bot_id, scope, window_start)
);

CREATE TABLE files (
  id uuid PRIMARY KEY,
  owner_bot_id uuid NOT NULL REFERENCES bots (id),
  filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  sha256 text,
  storage text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT files_storage CHECK (storage IN ('db', 's3')),
  CONSTRAINT files_status CHECK (status IN ('pending', 'ready')),
  CONSTRAINT files_size CHECK (size_bytes >= 0),
  CONSTRAINT files_filename_len CHECK (char_length(filename) BETWEEN 1 AND 255)
);

CREATE INDEX files_owner ON files (owner_bot_id, created_at DESC);

-- Blob store for the db storage backend (dev, tests, small installs).
CREATE TABLE file_blobs (
  storage_key text PRIMARY KEY,
  data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE message_attachments (
  message_id uuid NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES files (id),
  position smallint NOT NULL,
  PRIMARY KEY (message_id, file_id)
);

CREATE INDEX message_attachments_file ON message_attachments (file_id);

CREATE TABLE room_post_attachments (
  post_id uuid NOT NULL REFERENCES room_posts (id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES files (id),
  position smallint NOT NULL,
  PRIMARY KEY (post_id, file_id)
);

CREATE INDEX room_post_attachments_file ON room_post_attachments (file_id);

// Idempotent schema. Applied by `npm run db:setup` (Neon) or on first use (PGlite).

export const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS bookings (
  id               text PRIMARY KEY,
  ref_code         text NOT NULL UNIQUE,
  room             text NOT NULL CHECK (room IN ('A', 'B')),
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL,
  customer_name    text NOT NULL,
  customer_email   text NOT NULL,
  duration_minutes integer NOT NULL,
  subtotal_cents   integer NOT NULL,
  discount_cents   integer NOT NULL,
  total_cents      integer NOT NULL,
  status           text NOT NULL DEFAULT 'confirmed',
  source           text NOT NULL DEFAULT 'agent',
  draft_id         text UNIQUE,
  conversation_id  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  -- The database itself refuses overlapping bookings for the same room,
  -- so two customers confirming at the same moment can never both win.
  CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
    room WITH =,
    (tstzrange(starts_at, ends_at, '[)')) WITH &&
  ) WHERE (status = 'confirmed')
);

CREATE TABLE IF NOT EXISTS booking_drafts (
  id                text PRIMARY KEY,
  conversation_id   text NOT NULL,
  room              text NOT NULL CHECK (room IN ('A', 'B')),
  starts_at         timestamptz NOT NULL,
  ends_at           timestamptz NOT NULL,
  customer_name     text NOT NULL,
  customer_email    text NOT NULL,
  duration_minutes  integer NOT NULL,
  subtotal_cents    integer NOT NULL,
  discount_cents    integer NOT NULL,
  total_cents       integer NOT NULL,
  created_user_turn integer NOT NULL,
  expires_at        timestamptz NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_log (
  booking_id  text PRIMARY KEY REFERENCES bookings(id),
  to_email    text NOT NULL,
  subject     text NOT NULL,
  status      text NOT NULL,
  provider_id text,
  error       text,
  attempts    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz
);

-- messages is text, not jsonb: replayed thinking blocks must go back to the
-- API exactly as received, and jsonb would reorder object keys.
CREATE TABLE IF NOT EXISTS conversations (
  id            text PRIMARY KEY,
  system_prompt text NOT NULL,
  messages      text NOT NULL DEFAULT '[]',
  user_turns    integer NOT NULL DEFAULT 0,
  ip            text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS request_log (
  id         bigserial PRIMARY KEY,
  ip         text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS request_log_ip_time ON request_log (ip, created_at);
CREATE INDEX IF NOT EXISTS bookings_room_time ON bookings (room, starts_at);
`;

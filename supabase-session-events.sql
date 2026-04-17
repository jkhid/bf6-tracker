-- Run this in the Supabase SQL Editor before backfilling.
-- The app writes these tables from server-side API routes using the service role key.

CREATE TABLE IF NOT EXISTS game_events (
  id BIGSERIAL PRIMARY KEY,
  player_name TEXT NOT NULL,
  event_time TIMESTAMPTZ NOT NULL,
  before_snapshot_id BIGINT NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  after_snapshot_id BIGINT NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  before_captured_at TIMESTAMPTZ NOT NULL,
  after_captured_at TIMESTAMPTZ NOT NULL,
  matches_delta INT NOT NULL CHECK (matches_delta > 0),
  kills INT NOT NULL DEFAULT 0,
  deaths INT NOT NULL DEFAULT 0,
  wins INT NOT NULL DEFAULT 0,
  losses INT NOT NULL DEFAULT 0,
  headshot_kills INT NOT NULL DEFAULT 0,
  revives INT NOT NULL DEFAULT 0,
  vehicle_kills INT NOT NULL DEFAULT 0,
  damage INT NOT NULL DEFAULT 0,
  avatar TEXT NOT NULL DEFAULT '',
  weapon_deltas JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (player_name, before_snapshot_id, after_snapshot_id)
);

CREATE INDEX IF NOT EXISTS idx_game_events_event_time ON game_events (event_time DESC);
CREATE INDEX IF NOT EXISTS idx_game_events_player_time ON game_events (player_name, event_time DESC);
CREATE INDEX IF NOT EXISTS idx_game_events_after_snapshot ON game_events (after_snapshot_id);

CREATE TABLE IF NOT EXISTS session_summaries (
  id TEXT PRIMARY KEY,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  players TEXT[] NOT NULL DEFAULT '{}',
  games JSONB NOT NULL DEFAULT '[]',
  total_matches INT NOT NULL DEFAULT 0,
  total_kills INT NOT NULL DEFAULT 0,
  total_deaths INT NOT NULL DEFAULT 0,
  total_wins INT NOT NULL DEFAULT 0,
  total_losses INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_summaries_end_time ON session_summaries (end_time DESC);

ALTER TABLE game_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_summaries ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_session_summaries_updated_at ON session_summaries;
CREATE TRIGGER trg_session_summaries_updated_at
  BEFORE UPDATE ON session_summaries
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

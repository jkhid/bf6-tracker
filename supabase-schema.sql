-- Stores a snapshot of each player's stats every 5 minutes
CREATE TABLE snapshots (
  id BIGSERIAL PRIMARY KEY,
  player_name TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  matches_played INT NOT NULL DEFAULT 0,
  kills INT NOT NULL DEFAULT 0,
  deaths INT NOT NULL DEFAULT 0,
  wins INT NOT NULL DEFAULT 0,
  losses INT NOT NULL DEFAULT 0,
  kd REAL NOT NULL DEFAULT 0,
  kpm REAL NOT NULL DEFAULT 0,
  dpm REAL NOT NULL DEFAULT 0,
  headshot_kills INT NOT NULL DEFAULT 0,
  revives INT NOT NULL DEFAULT 0,
  vehicle_kills INT NOT NULL DEFAULT 0,
  intel_pickups INT NOT NULL DEFAULT 0,
  spots INT NOT NULL DEFAULT 0,
  repairs INT NOT NULL DEFAULT 0,
  objectives_armed INT NOT NULL DEFAULT 0,
  objectives_destroyed INT NOT NULL DEFAULT 0,
  weapon_stats JSONB DEFAULT '[]',
  raw_stats JSONB DEFAULT '{}'
);

-- Index for fast lookups by player and time
CREATE INDEX idx_snapshots_player_time ON snapshots (player_name, captured_at DESC);

-- Index for finding recent snapshots quickly
CREATE INDEX idx_snapshots_captured ON snapshots (captured_at DESC);

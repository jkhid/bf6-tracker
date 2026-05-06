-- One-time cleanup: drop snapshots older than 7 days, but keep each player's
-- most recent snapshot regardless of age (so the next cron diff still has a
-- "previous state" to compare against, even for inactive players).
--
-- Run this once in the Supabase SQL Editor to recover space immediately.
-- The /api/prune route handles the ongoing daily maintenance.

-- 1. Relax the foreign key from game_events → snapshots so pruning snapshots
--    no longer cascades into deleting match history. game_events already
--    stores all the per-match data we need (kills, deaths, damage,
--    seconds_delta, weapon_deltas, etc.), so the FK was just lineage.
ALTER TABLE game_events
  DROP CONSTRAINT IF EXISTS game_events_before_snapshot_id_fkey;

ALTER TABLE game_events
  DROP CONSTRAINT IF EXISTS game_events_after_snapshot_id_fkey;

ALTER TABLE game_events
  ADD CONSTRAINT game_events_before_snapshot_id_fkey
  FOREIGN KEY (before_snapshot_id) REFERENCES snapshots(id) ON DELETE SET NULL;

ALTER TABLE game_events
  ADD CONSTRAINT game_events_after_snapshot_id_fkey
  FOREIGN KEY (after_snapshot_id) REFERENCES snapshots(id) ON DELETE SET NULL;

-- The before/after snapshot id columns were NOT NULL — relax that since
-- they will go null after their snapshot rows are pruned.
ALTER TABLE game_events ALTER COLUMN before_snapshot_id DROP NOT NULL;
ALTER TABLE game_events ALTER COLUMN after_snapshot_id DROP NOT NULL;

-- 2. Delete snapshots older than 7 days, keeping each player's most recent.
WITH latest_per_player AS (
  SELECT DISTINCT ON (player_name) id
  FROM snapshots
  ORDER BY player_name, captured_at DESC
)
DELETE FROM snapshots
WHERE captured_at < NOW() - INTERVAL '7 days'
  AND id NOT IN (SELECT id FROM latest_per_player);

-- 3. Postgres MVCC marks rows as dead but doesn't reclaim disk until vacuum.
-- Autovacuum will catch up eventually; run VACUUM FULL once to reclaim space
-- immediately and shrink the on-disk table size.
VACUUM FULL ANALYZE snapshots;

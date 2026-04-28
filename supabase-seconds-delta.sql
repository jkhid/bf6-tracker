-- Adds seconds_delta column to game_events for squad detection.
-- Run in the Supabase SQL Editor.

ALTER TABLE game_events
  ADD COLUMN IF NOT EXISTS seconds_delta INT NOT NULL DEFAULT 0;

-- Backfill from snapshots so existing events get accurate values
UPDATE game_events ge
SET seconds_delta = GREATEST(
  ROUND(
    COALESCE((s_after.raw_stats->>'secondsPlayed')::numeric, 0)
    - COALESCE((s_before.raw_stats->>'secondsPlayed')::numeric, 0)
  )::INT,
  0
)
FROM snapshots s_before, snapshots s_after
WHERE s_before.id = ge.before_snapshot_id
  AND s_after.id = ge.after_snapshot_id
  AND ge.seconds_delta = 0;

-- After running this, the next snapshot tick will regenerate session_summaries
-- with the new squad split (the snapshot route calls refreshSessionSummaries).

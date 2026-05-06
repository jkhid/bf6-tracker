-- Run this in a fresh Supabase SQL Editor tab AFTER supabase-prune-snapshots.sql.
-- VACUUM FULL is non-transactional, so it must run on its own (the SQL Editor
-- wraps every query in a transaction by default).
--
-- This reclaims disk space from the rows the prune just marked as dead.
-- Without it, autovacuum eventually catches up but takes hours-to-days.
--
-- Note: VACUUM FULL takes a brief exclusive lock on the snapshots table.
-- Fine for the free tier with low traffic; just don't run it mid-snapshot.

VACUUM FULL ANALYZE snapshots;

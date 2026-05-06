import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const RETAIN_DAYS = 7;

export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get('secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cutoffIso = new Date(Date.now() - RETAIN_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Find each player's most recent snapshot — these always stay, regardless of age,
  // so the next cron tick still has a "previous" snapshot to diff against.
  const { data: latestRows, error: latestError } = await supabase
    .from('snapshots')
    .select('id, player_name, captured_at')
    .order('captured_at', { ascending: false });

  if (latestError) {
    return NextResponse.json({ error: latestError.message }, { status: 500 });
  }

  const keepIds = new Set<number>();
  const seenPlayers = new Set<string>();
  for (const row of latestRows ?? []) {
    if (!seenPlayers.has(row.player_name)) {
      seenPlayers.add(row.player_name);
      keepIds.add(row.id);
    }
  }

  // Count what we're about to delete (for the response payload)
  const { count: beforeCount } = await supabase
    .from('snapshots')
    .select('*', { count: 'exact', head: true })
    .lt('captured_at', cutoffIso);

  // Delete snapshots older than the cutoff, except the protected latest-per-player IDs.
  // Supabase doesn't support NOT IN with a subquery in the JS client, so we delete
  // in batches by chunking the keep-list into the .not('id', 'in', ...) filter.
  const keepIdList = Array.from(keepIds);
  const { error: deleteError, count: deletedCount } = await supabase
    .from('snapshots')
    .delete({ count: 'exact' })
    .lt('captured_at', cutoffIso)
    .not('id', 'in', `(${keepIdList.join(',') || '0'})`);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({
    cutoff: cutoffIso,
    retainedDays: RETAIN_DAYS,
    eligibleForDeletion: beforeCount ?? null,
    actuallyDeleted: deletedCount ?? null,
    keptLatestPerPlayer: keepIdList.length,
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import {
  buildGameEventRow,
  buildSessionsFromEvents,
  fromSessionSummaryRow,
  SessionSummaryRow,
  Snapshot,
} from '@/lib/session-events';

async function loadFromSnapshotFallback(limit: number, offset: number) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const snapshots: Snapshot[] = [];

  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('snapshots')
      .select(`
        id,
        player_name,
        captured_at,
        matches_played,
        kills,
        deaths,
        wins,
        losses,
        kd,
        kpm,
        dpm,
        headshot_kills,
        revives,
        vehicle_kills,
        intel_pickups,
        spots,
        repairs,
        objectives_armed,
        objectives_destroyed,
        raw_stats
      `)
      .gte('captured_at', since)
      .order('captured_at', { ascending: true })
      .range(from, from + 999);

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    snapshots.push(...(data as Snapshot[]).map((snapshot) => ({ ...snapshot, weapon_stats: [] })));
    if (data.length < 1000) break;
  }

  const byPlayer = new Map<string, Snapshot[]>();
  for (const snapshot of snapshots) {
    const list = byPlayer.get(snapshot.player_name) || [];
    list.push(snapshot);
    byPlayer.set(snapshot.player_name, list);
  }

  const events = [];
  for (const [playerName, playerSnapshots] of byPlayer) {
    for (let i = 1; i < playerSnapshots.length; i++) {
      const event = buildGameEventRow(playerName, playerSnapshots[i - 1], playerSnapshots[i]);
      if (event) events.push(event);
    }
  }

  const sessions = buildSessionsFromEvents(events).reverse();
  return {
    sessions: sessions.slice(offset, offset + limit),
    total: sessions.length,
  };
}

export async function GET(request: NextRequest) {
  const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') || '20'), 100);
  const offset = Math.max(parseInt(request.nextUrl.searchParams.get('offset') || '0'), 0);

  const { data, error, count } = await supabase
    .from('session_summaries')
    .select('*', { count: 'exact' })
    .order('end_time', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    try {
      const fallback = await loadFromSnapshotFallback(limit, offset);
      return NextResponse.json(fallback, {
        headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' },
      });
    } catch (fallbackError) {
      return NextResponse.json(
        { error: (fallbackError as Error).message || error.message },
        { status: 500 }
      );
    }
  }

  if ((!data || data.length === 0) && offset === 0) {
    const fallback = await loadFromSnapshotFallback(limit, offset);
    return NextResponse.json(fallback, {
      headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' },
    });
  }

  return NextResponse.json(
    {
      sessions: ((data || []) as SessionSummaryRow[]).map(fromSessionSummaryRow),
      total: count || 0,
    },
    { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' } }
  );
}

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { PLAYERS } from '@/lib/players';

interface Snapshot {
  id: number;
  player_name: string;
  captured_at: string;
  matches_played: number;
  kills: number;
  deaths: number;
  wins: number;
  losses: number;
  kd: number;
  kpm: number;
  dpm: number;
  headshot_kills: number;
  revives: number;
  vehicle_kills: number;
  intel_pickups: number;
  spots: number;
  repairs: number;
  objectives_armed: number;
  objectives_destroyed: number;
  weapon_stats: { name: string; kills: number; damage: number }[];
  raw_stats: { userName?: string; avatar?: string };
}

interface PlayerMatchDelta {
  playerName: string;
  displayName: string;
  avatar: string;
  matchesDelta: number;
  kills: number;
  deaths: number;
  kd: number;
  wins: number;
  losses: number;
  headshotKills: number;
  revives: number;
  vehicleKills: number;
  weaponDeltas: { name: string; kills: number }[];
}

interface Session {
  id: string;
  startTime: string;
  endTime: string;
  players: PlayerMatchDelta[];
  totalMatches: number;
  totalKills: number;
  totalDeaths: number;
  totalWins: number;
}

// Gap between activity to consider it a new session (30 min)
const SESSION_GAP_MS = 30 * 60 * 1000;

export async function GET(request: NextRequest) {
  const limit = parseInt(request.nextUrl.searchParams.get('limit') || '20');
  const offset = parseInt(request.nextUrl.searchParams.get('offset') || '0');

  // Fetch recent snapshots for all players (last 7 days)
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: snapshots, error } = await supabase
    .from('snapshots')
    .select('*')
    .gte('captured_at', since)
    .order('captured_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!snapshots || snapshots.length < 2) {
    return NextResponse.json({ sessions: [], total: 0 });
  }

  // Group snapshots by player
  const byPlayer = new Map<string, Snapshot[]>();
  for (const snap of snapshots) {
    const list = byPlayer.get(snap.player_name) || [];
    list.push(snap);
    byPlayer.set(snap.player_name, list);
  }

  // Find all "activity events" — moments where a player's match count changed
  interface ActivityEvent {
    playerName: string;
    time: string;
    before: Snapshot;
    after: Snapshot;
  }

  const events: ActivityEvent[] = [];

  for (const [playerName, snaps] of byPlayer) {
    for (let i = 1; i < snaps.length; i++) {
      const before = snaps[i - 1];
      const after = snaps[i];
      if (after.matches_played > before.matches_played) {
        events.push({
          playerName,
          time: after.captured_at,
          before,
          after,
        });
      }
    }
  }

  if (events.length === 0) {
    return NextResponse.json({ sessions: [], total: 0 });
  }

  // Sort events by time
  events.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

  // Group events into sessions based on time proximity
  const sessions: ActivityEvent[][] = [];
  let currentSession: ActivityEvent[] = [events[0]];

  for (let i = 1; i < events.length; i++) {
    const prevTime = new Date(events[i - 1].time).getTime();
    const currTime = new Date(events[i].time).getTime();

    if (currTime - prevTime > SESSION_GAP_MS) {
      sessions.push(currentSession);
      currentSession = [events[i]];
    } else {
      currentSession.push(events[i]);
    }
  }
  sessions.push(currentSession);

  // Build display name lookup
  const displayNames = new Map<string, string>();
  for (const p of PLAYERS) {
    displayNames.set(p.name, p.displayName);
  }

  // Convert sessions to response format
  const formattedSessions: Session[] = sessions.map((sessionEvents, idx) => {
    // Group events by player within this session
    const playerEvents = new Map<string, ActivityEvent[]>();
    for (const evt of sessionEvents) {
      const list = playerEvents.get(evt.playerName) || [];
      list.push(evt);
      playerEvents.set(evt.playerName, list);
    }

    const players: PlayerMatchDelta[] = [];

    for (const [playerName, evts] of playerEvents) {
      const first = evts[0].before;
      const last = evts[evts.length - 1].after;

      const killsDelta = last.kills - first.kills;
      const deathsDelta = last.deaths - first.deaths;

      // Compute weapon deltas
      const weaponsBefore = new Map<string, number>();
      for (const w of first.weapon_stats || []) {
        weaponsBefore.set(w.name, w.kills);
      }

      const weaponDeltas: { name: string; kills: number }[] = [];
      for (const w of last.weapon_stats || []) {
        const beforeKills = weaponsBefore.get(w.name) || 0;
        const delta = w.kills - beforeKills;
        if (delta > 0) {
          weaponDeltas.push({ name: w.name, kills: delta });
        }
      }
      weaponDeltas.sort((a, b) => b.kills - a.kills);

      players.push({
        playerName,
        displayName: displayNames.get(playerName) || playerName,
        avatar: last.raw_stats?.avatar || '',
        matchesDelta: last.matches_played - first.matches_played,
        kills: killsDelta,
        deaths: deathsDelta,
        kd: deathsDelta > 0 ? killsDelta / deathsDelta : killsDelta,
        wins: last.wins - first.wins,
        losses: last.losses - first.losses,
        headshotKills: last.headshot_kills - first.headshot_kills,
        revives: last.revives - first.revives,
        vehicleKills: last.vehicle_kills - first.vehicle_kills,
        weaponDeltas: weaponDeltas.slice(0, 5),
      });
    }

    const totalKills = players.reduce((s, p) => s + p.kills, 0);
    const totalDeaths = players.reduce((s, p) => s + p.deaths, 0);
    const totalWins = players.reduce((s, p) => s + p.wins, 0);
    const totalMatches = Math.max(...players.map((p) => p.matchesDelta));

    return {
      id: `session_${idx}`,
      startTime: sessionEvents[0].before.captured_at,
      endTime: sessionEvents[sessionEvents.length - 1].after.captured_at,
      players,
      totalMatches,
      totalKills,
      totalDeaths,
      totalWins,
    };
  });

  // Reverse so newest sessions are first
  formattedSessions.reverse();

  const total = formattedSessions.length;
  const paginated = formattedSessions.slice(offset, offset + limit);

  return NextResponse.json(
    { sessions: paginated, total },
    { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' } }
  );
}

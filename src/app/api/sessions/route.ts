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
  weapon_stats: { name: string; kills: number; damage: number; image?: string; altImage?: string }[];
  raw_stats: { userName?: string; avatar?: string };
}

interface WeaponDelta {
  name: string;
  kills: number;
  image: string;
  altImage: string;
}

interface PlayerGameDelta {
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
  weaponDeltas: WeaponDelta[];
}

interface Game {
  time: string;
  players: PlayerGameDelta[];
  matchCount: number;
  kills: number;
  deaths: number;
  wins: number;
  losses: number;
}

interface Session {
  id: string;
  startTime: string;
  endTime: string;
  games: Game[];
  players: string[];
  totalMatches: number;
  totalKills: number;
  totalDeaths: number;
  totalWins: number;
  totalLosses: number;
}

// Gap between activity to consider it a new session (30 min)
const SESSION_GAP_MS = 30 * 60 * 1000;

function computeWeaponDeltas(before: Snapshot, after: Snapshot): WeaponDelta[] {
  const weaponsBefore = new Map<string, number>();
  for (const w of before.weapon_stats || []) {
    weaponsBefore.set(w.name, w.kills);
  }

  const deltas: WeaponDelta[] = [];
  for (const w of after.weapon_stats || []) {
    const beforeKills = weaponsBefore.get(w.name) || 0;
    const delta = w.kills - beforeKills;
    if (delta > 0) {
      deltas.push({
        name: w.name,
        kills: delta,
        image: w.image || '',
        altImage: w.altImage || '',
      });
    }
  }
  return deltas.sort((a, b) => b.kills - a.kills);
}

function buildPlayerDelta(
  playerName: string,
  before: Snapshot,
  after: Snapshot
): PlayerGameDelta {
  const displayNames = new Map<string, string>();
  for (const p of PLAYERS) {
    displayNames.set(p.name, p.displayName);
  }

  const killsDelta = after.kills - before.kills;
  const deathsDelta = after.deaths - before.deaths;

  return {
    playerName,
    displayName: displayNames.get(playerName) || playerName,
    avatar: after.raw_stats?.avatar || '',
    matchesDelta: after.matches_played - before.matches_played,
    kills: killsDelta,
    deaths: deathsDelta,
    kd: deathsDelta > 0 ? killsDelta / deathsDelta : killsDelta,
    wins: after.wins - before.wins,
    losses: after.losses - before.losses,
    headshotKills: after.headshot_kills - before.headshot_kills,
    revives: after.revives - before.revives,
    vehicleKills: after.vehicle_kills - before.vehicle_kills,
    weaponDeltas: computeWeaponDeltas(before, after).slice(0, 8),
  };
}

export async function GET(request: NextRequest) {
  const limit = parseInt(request.nextUrl.searchParams.get('limit') || '20');
  const offset = parseInt(request.nextUrl.searchParams.get('offset') || '0');

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

  // Find all "game events" — moments where a player's match count changed
  interface GameEvent {
    playerName: string;
    time: string;
    before: Snapshot;
    after: Snapshot;
    matchesDelta: number;
  }

  const events: GameEvent[] = [];

  for (const [playerName, snaps] of byPlayer) {
    for (let i = 1; i < snaps.length; i++) {
      const before = snaps[i - 1];
      const after = snaps[i];
      const matchesDelta = after.matches_played - before.matches_played;
      if (matchesDelta > 0) {
        events.push({
          playerName,
          time: after.captured_at,
          before,
          after,
          matchesDelta,
        });
      }
    }
  }

  if (events.length === 0) {
    return NextResponse.json({ sessions: [], total: 0 });
  }

  events.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

  // Group events into sessions based on time proximity
  const sessionGroups: GameEvent[][] = [];
  let currentGroup: GameEvent[] = [events[0]];

  for (let i = 1; i < events.length; i++) {
    const prevTime = new Date(events[i - 1].time).getTime();
    const currTime = new Date(events[i].time).getTime();

    if (currTime - prevTime > SESSION_GAP_MS) {
      sessionGroups.push(currentGroup);
      currentGroup = [events[i]];
    } else {
      currentGroup.push(events[i]);
    }
  }
  sessionGroups.push(currentGroup);

  // Build sessions with per-game granularity
  const sessions: Session[] = sessionGroups.map((sessionEvents, idx) => {
    // Group events by timestamp (same capture time = same game)
    const byTime = new Map<string, GameEvent[]>();
    for (const evt of sessionEvents) {
      const list = byTime.get(evt.time) || [];
      list.push(evt);
      byTime.set(evt.time, list);
    }

    // Each unique timestamp group = a game
    const games: Game[] = [];
    for (const [time, gameEvents] of byTime) {
      const players = gameEvents.map((evt) =>
        buildPlayerDelta(evt.playerName, evt.before, evt.after)
      );

      const kills = players.reduce((s, p) => s + p.kills, 0);
      const deaths = players.reduce((s, p) => s + p.deaths, 0);
      // Team win = max of any player's win delta (not sum)
      const wins = Math.max(...players.map((p) => p.wins), 0);
      const losses = Math.max(...players.map((p) => p.losses), 0);
      const matchCount = Math.max(...players.map((p) => p.matchesDelta), 0);

      games.push({ time, players, matchCount, kills, deaths, wins, losses });
    }

    games.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

    // Session totals
    const allPlayers = [...new Set(sessionEvents.map((e) => e.playerName))];
    const displayNames = new Map<string, string>();
    for (const p of PLAYERS) displayNames.set(p.name, p.displayName);

    const totalKills = games.reduce((s, g) => s + g.kills, 0);
    const totalDeaths = games.reduce((s, g) => s + g.deaths, 0);
    const totalWins = games.reduce((s, g) => s + g.wins, 0);
    const totalLosses = games.reduce((s, g) => s + g.losses, 0);
    const totalMatches = games.reduce((s, g) => s + g.matchCount, 0);

    return {
      id: `session_${idx}`,
      startTime: sessionEvents[0].before.captured_at,
      endTime: sessionEvents[sessionEvents.length - 1].after.captured_at,
      games,
      players: allPlayers.map((n) => displayNames.get(n) || n),
      totalMatches,
      totalKills,
      totalDeaths,
      totalWins,
      totalLosses,
    };
  });

  sessions.reverse();

  const total = sessions.length;
  const paginated = sessions.slice(offset, offset + limit);

  return NextResponse.json(
    { sessions: paginated, total },
    { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' } }
  );
}

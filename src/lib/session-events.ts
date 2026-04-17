import { PLAYERS } from './players';
import { supabase } from './supabase';

export interface Snapshot {
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
  raw_stats: { userName?: string; avatar?: string; secondsPlayed?: number };
}

export interface WeaponDelta {
  name: string;
  kills: number;
  damage: number;
  image: string;
  altImage: string;
}

export interface PlayerGameDelta {
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
  damage: number;
  weaponDeltas: WeaponDelta[];
}

export interface Game {
  time: string;
  players: PlayerGameDelta[];
  matchCount: number;
  kills: number;
  deaths: number;
  damage: number;
  wins: number;
  losses: number;
}

export interface Session {
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

export interface GameEventRow {
  id?: number;
  player_name: string;
  event_time: string;
  before_snapshot_id: number;
  after_snapshot_id: number;
  before_captured_at: string;
  after_captured_at: string;
  matches_delta: number;
  kills: number;
  deaths: number;
  wins: number;
  losses: number;
  headshot_kills: number;
  revives: number;
  vehicle_kills: number;
  damage: number;
  avatar: string;
  weapon_deltas: WeaponDelta[];
}

export interface SessionSummaryRow {
  id: string;
  start_time: string;
  end_time: string;
  games: Game[];
  players: string[];
  total_matches: number;
  total_kills: number;
  total_deaths: number;
  total_wins: number;
  total_losses: number;
}

export const SESSION_GAP_MS = 30 * 60 * 1000;
export const GAME_MERGE_MS = 11 * 60 * 1000;
export const MAX_MATCHES_PER_EVENT = 20;
export const MAX_KILLS_PER_MATCH = 150;
export const MAX_DEATHS_PER_MATCH = 150;

const DISPLAY_NAMES = new Map<string, string>();
for (const p of PLAYERS) DISPLAY_NAMES.set(p.name, p.displayName);

export function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, '').replace('%', ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function counterDelta(after: unknown, before: unknown): number {
  return toNumber(after) - toNumber(before);
}

export function positiveCounterDelta(after: unknown, before: unknown): number {
  return Math.max(counterDelta(after, before), 0);
}

export function isPlausibleGameEvent(before: Snapshot, after: Snapshot, matchesDelta: number): boolean {
  if (!Number.isFinite(matchesDelta) || matchesDelta <= 0) return false;
  if (matchesDelta > MAX_MATCHES_PER_EVENT) return false;
  if (toNumber(before.matches_played) === 0 && matchesDelta > 1) return false;

  const beforeTime = new Date(before.captured_at).getTime();
  const afterTime = new Date(after.captured_at).getTime();
  if (!Number.isFinite(beforeTime) || !Number.isFinite(afterTime) || afterTime <= beforeTime) {
    return false;
  }

  const killsDelta = counterDelta(after.kills, before.kills);
  const deathsDelta = counterDelta(after.deaths, before.deaths);
  const winsDelta = counterDelta(after.wins, before.wins);
  const lossesDelta = counterDelta(after.losses, before.losses);
  const revivesDelta = counterDelta(after.revives, before.revives);
  const headshotDelta = counterDelta(after.headshot_kills, before.headshot_kills);
  const vehicleKillsDelta = counterDelta(after.vehicle_kills, before.vehicle_kills);

  const trackedDeltas = [
    killsDelta,
    deathsDelta,
    winsDelta,
    lossesDelta,
    revivesDelta,
    headshotDelta,
    vehicleKillsDelta,
  ];

  if (trackedDeltas.some((delta) => !Number.isFinite(delta) || delta < 0)) {
    return false;
  }

  if (killsDelta > matchesDelta * MAX_KILLS_PER_MATCH) return false;
  if (deathsDelta > matchesDelta * MAX_DEATHS_PER_MATCH) return false;

  return trackedDeltas.some((delta) => delta > 0);
}

export function computeWeaponDeltas(before: Snapshot, after: Snapshot): WeaponDelta[] {
  const weaponsBefore = new Map<string, { kills: number; damage: number }>();
  for (const w of before.weapon_stats || []) {
    weaponsBefore.set(w.name, { kills: toNumber(w.kills), damage: toNumber(w.damage) });
  }

  const deltas: WeaponDelta[] = [];
  for (const w of after.weapon_stats || []) {
    if (!weaponsBefore.has(w.name)) continue;

    const bw = weaponsBefore.get(w.name)!;
    const killDelta = toNumber(w.kills) - bw.kills;
    const damageDelta = toNumber(w.damage) - bw.damage;
    if (killDelta > 0 || damageDelta > 0) {
      deltas.push({
        name: w.name,
        kills: killDelta,
        damage: damageDelta,
        image: w.image || '',
        altImage: w.altImage || '',
      });
    }
  }
  return deltas.sort((a, b) => b.kills - a.kills);
}

export function buildGameEventRow(playerName: string, before: Snapshot, after: Snapshot): GameEventRow | null {
  const matchesDelta = counterDelta(after.matches_played, before.matches_played);
  if (!isPlausibleGameEvent(before, after, matchesDelta)) return null;

  const beforeTotalDmg = toNumber(before.dpm) * (toNumber(before.raw_stats?.secondsPlayed) / 60);
  const afterTotalDmg = toNumber(after.dpm) * (toNumber(after.raw_stats?.secondsPlayed) / 60);
  let damage = Math.round(afterTotalDmg - beforeTotalDmg);
  const weaponDeltas = computeWeaponDeltas(before, after);

  if (damage <= 0 && (before.raw_stats?.secondsPlayed === undefined || after.raw_stats?.secondsPlayed === undefined)) {
    damage = weaponDeltas.reduce((s, w) => s + w.damage, 0);
  }

  return {
    player_name: playerName,
    event_time: after.captured_at,
    before_snapshot_id: before.id,
    after_snapshot_id: after.id,
    before_captured_at: before.captured_at,
    after_captured_at: after.captured_at,
    matches_delta: positiveCounterDelta(after.matches_played, before.matches_played),
    kills: positiveCounterDelta(after.kills, before.kills),
    deaths: positiveCounterDelta(after.deaths, before.deaths),
    wins: positiveCounterDelta(after.wins, before.wins),
    losses: positiveCounterDelta(after.losses, before.losses),
    headshot_kills: positiveCounterDelta(after.headshot_kills, before.headshot_kills),
    revives: positiveCounterDelta(after.revives, before.revives),
    vehicle_kills: positiveCounterDelta(after.vehicle_kills, before.vehicle_kills),
    damage: Math.max(damage, 0),
    avatar: after.raw_stats?.avatar || '',
    weapon_deltas: weaponDeltas.slice(0, 8),
  };
}

function buildPlayerDeltaFromEvent(event: GameEventRow): PlayerGameDelta {
  const kills = toNumber(event.kills);
  const deaths = toNumber(event.deaths);

  return {
    playerName: event.player_name,
    displayName: DISPLAY_NAMES.get(event.player_name) || event.player_name,
    avatar: event.avatar || '',
    matchesDelta: toNumber(event.matches_delta),
    kills,
    deaths,
    kd: deaths > 0 ? kills / deaths : kills,
    wins: toNumber(event.wins),
    losses: toNumber(event.losses),
    headshotKills: toNumber(event.headshot_kills),
    revives: toNumber(event.revives),
    vehicleKills: toNumber(event.vehicle_kills),
    damage: toNumber(event.damage),
    weaponDeltas: Array.isArray(event.weapon_deltas) ? event.weapon_deltas : [],
  };
}

export function buildSessionsFromEvents(rawEvents: GameEventRow[]): Session[] {
  if (rawEvents.length === 0) return [];

  const events = [...rawEvents].sort(
    (a, b) => new Date(a.event_time).getTime() - new Date(b.event_time).getTime()
  );

  const sessionGroups: GameEventRow[][] = [];
  let currentSessionGroup: GameEventRow[] = [events[0]];

  for (let i = 1; i < events.length; i++) {
    const prevTime = new Date(events[i - 1].event_time).getTime();
    const currTime = new Date(events[i].event_time).getTime();

    if (currTime - prevTime > SESSION_GAP_MS) {
      sessionGroups.push(currentSessionGroup);
      currentSessionGroup = [events[i]];
    } else {
      currentSessionGroup.push(events[i]);
    }
  }
  sessionGroups.push(currentSessionGroup);

  return sessionGroups.map((sessionEvents) => {
    const sortedEvents = [...sessionEvents].sort(
      (a, b) => new Date(a.event_time).getTime() - new Date(b.event_time).getTime()
    );

    const gameGroups: GameEventRow[][] = [];
    let currentGame: GameEventRow[] = [sortedEvents[0]];

    for (let i = 1; i < sortedEvents.length; i++) {
      const groupStartTime = new Date(currentGame[0].event_time).getTime();
      const currTime = new Date(sortedEvents[i].event_time).getTime();
      const samePlayerInGroup = currentGame.some(
        (event) => event.player_name === sortedEvents[i].player_name
      );

      if (currTime - groupStartTime > GAME_MERGE_MS || samePlayerInGroup) {
        gameGroups.push(currentGame);
        currentGame = [sortedEvents[i]];
      } else {
        currentGame.push(sortedEvents[i]);
      }
    }
    gameGroups.push(currentGame);

    const games: Game[] = gameGroups.map((gameEvents) => {
      const players = gameEvents.map(buildPlayerDeltaFromEvent);
      const kills = players.reduce((s, p) => s + p.kills, 0);
      const deaths = players.reduce((s, p) => s + p.deaths, 0);
      const damage = players.reduce((s, p) => s + p.damage, 0);
      const wins = Math.max(...players.map((p) => p.wins), 0);
      const losses = Math.max(...players.map((p) => p.losses), 0);
      const matchCount = Math.max(...players.map((p) => p.matchesDelta), 0);
      const time = gameEvents[gameEvents.length - 1].event_time;

      return { time, players, matchCount, kills, deaths, damage, wins, losses };
    });

    const allPlayers = [...new Set(sessionEvents.map((event) => event.player_name))];
    const startMs = new Date(sortedEvents[0].before_captured_at).getTime();

    return {
      id: `session_${startMs}`,
      startTime: sortedEvents[0].before_captured_at,
      endTime: sortedEvents[sortedEvents.length - 1].after_captured_at,
      games,
      players: allPlayers.map((name) => DISPLAY_NAMES.get(name) || name),
      totalMatches: games.reduce((s, g) => s + g.matchCount, 0),
      totalKills: games.reduce((s, g) => s + g.kills, 0),
      totalDeaths: games.reduce((s, g) => s + g.deaths, 0),
      totalWins: games.reduce((s, g) => s + g.wins, 0),
      totalLosses: games.reduce((s, g) => s + g.losses, 0),
    };
  });
}

export function toSessionSummaryRow(session: Session): SessionSummaryRow {
  return {
    id: session.id,
    start_time: session.startTime,
    end_time: session.endTime,
    games: session.games,
    players: session.players,
    total_matches: session.totalMatches,
    total_kills: session.totalKills,
    total_deaths: session.totalDeaths,
    total_wins: session.totalWins,
    total_losses: session.totalLosses,
  };
}

export function fromSessionSummaryRow(row: SessionSummaryRow): Session {
  return {
    id: row.id,
    startTime: row.start_time,
    endTime: row.end_time,
    games: row.games || [],
    players: row.players || [],
    totalMatches: row.total_matches,
    totalKills: row.total_kills,
    totalDeaths: row.total_deaths,
    totalWins: row.total_wins,
    totalLosses: row.total_losses,
  };
}

export async function refreshSessionSummaries(sinceIso?: string): Promise<{ sessions: number; error?: string }> {
  let query = supabase
    .from('game_events')
    .select('*')
    .order('event_time', { ascending: true });

  if (sinceIso) {
    query = query.gte('event_time', sinceIso);
  }

  const { data, error } = await query;
  if (error) return { sessions: 0, error: error.message };

  const sessions = buildSessionsFromEvents((data || []) as GameEventRow[]);
  if (sessions.length === 0) return { sessions: 0 };

  const { error: upsertError } = await supabase
    .from('session_summaries')
    .upsert(sessions.map(toSessionSummaryRow), { onConflict: 'id' });

  if (upsertError) return { sessions: 0, error: upsertError.message };
  return { sessions: sessions.length };
}

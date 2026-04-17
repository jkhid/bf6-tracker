import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split(/\n/)
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, '')];
    })
);

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const SESSION_GAP_MS = 30 * 60 * 1000;
const GAME_MERGE_MS = 11 * 60 * 1000;
const MAX_MATCHES_PER_EVENT = 20;
const MAX_KILLS_PER_MATCH = 150;
const MAX_DEATHS_PER_MATCH = 150;

const DISPLAY_NAMES = new Map([
  ['redFrog40', 'Nic'],
  ['magicpinoy650', 'Jamal'],
  ['JmXxStealth', 'Jai'],
  ['STATnMELO650', 'Adi'],
  ['CastingC0uch945', 'Ryan'],
  ['nmetzger123', 'Metz'],
  ['ra1ca', 'Nathan'],
  ['Coffeesquirts89', 'Poo'],
  ['mrnudebanana', 'MrBanana'],
]);

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, '').replace('%', ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function counterDelta(after, before) {
  return toNumber(after) - toNumber(before);
}

function positiveCounterDelta(after, before) {
  return Math.max(counterDelta(after, before), 0);
}

function isPlausibleGameEvent(before, after, matchesDelta) {
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

  if (trackedDeltas.some((delta) => !Number.isFinite(delta) || delta < 0)) return false;
  if (killsDelta > matchesDelta * MAX_KILLS_PER_MATCH) return false;
  if (deathsDelta > matchesDelta * MAX_DEATHS_PER_MATCH) return false;

  return trackedDeltas.some((delta) => delta > 0);
}

function computeWeaponDeltas(before, after) {
  const weaponsBefore = new Map();
  for (const weapon of before.weapon_stats || []) {
    weaponsBefore.set(weapon.name, {
      kills: toNumber(weapon.kills),
      damage: toNumber(weapon.damage),
    });
  }

  const deltas = [];
  for (const weapon of after.weapon_stats || []) {
    if (!weaponsBefore.has(weapon.name)) continue;

    const beforeWeapon = weaponsBefore.get(weapon.name);
    const killDelta = toNumber(weapon.kills) - beforeWeapon.kills;
    const damageDelta = toNumber(weapon.damage) - beforeWeapon.damage;
    if (killDelta > 0 || damageDelta > 0) {
      deltas.push({
        name: weapon.name,
        kills: killDelta,
        damage: damageDelta,
        image: weapon.image || '',
        altImage: weapon.altImage || '',
      });
    }
  }

  return deltas.sort((a, b) => b.kills - a.kills).slice(0, 8);
}

function buildGameEventRow(playerName, before, after) {
  const matchesDelta = counterDelta(after.matches_played, before.matches_played);
  if (!isPlausibleGameEvent(before, after, matchesDelta)) return null;

  const weaponDeltas = computeWeaponDeltas(before, after);
  const beforeTotalDmg = toNumber(before.dpm) * (toNumber(before.raw_stats?.secondsPlayed) / 60);
  const afterTotalDmg = toNumber(after.dpm) * (toNumber(after.raw_stats?.secondsPlayed) / 60);
  let damage = Math.round(afterTotalDmg - beforeTotalDmg);

  if (damage <= 0 && (before.raw_stats?.secondsPlayed === undefined || after.raw_stats?.secondsPlayed === undefined)) {
    damage = weaponDeltas.reduce((sum, weapon) => sum + weapon.damage, 0);
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
    weapon_deltas: weaponDeltas,
  };
}

function buildPlayerDeltaFromEvent(event) {
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

function buildSessionsFromEvents(rawEvents) {
  if (rawEvents.length === 0) return [];

  const events = [...rawEvents].sort(
    (a, b) => new Date(a.event_time).getTime() - new Date(b.event_time).getTime()
  );

  const sessionGroups = [];
  let currentSessionGroup = [events[0]];

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

    const gameGroups = [];
    let currentGame = [sortedEvents[0]];

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

    const games = gameGroups.map((gameEvents) => {
      const players = gameEvents.map(buildPlayerDeltaFromEvent);
      return {
        time: gameEvents[gameEvents.length - 1].event_time,
        players,
        matchCount: Math.max(...players.map((player) => player.matchesDelta), 0),
        kills: players.reduce((sum, player) => sum + player.kills, 0),
        deaths: players.reduce((sum, player) => sum + player.deaths, 0),
        damage: players.reduce((sum, player) => sum + player.damage, 0),
        wins: Math.max(...players.map((player) => player.wins), 0),
        losses: Math.max(...players.map((player) => player.losses), 0),
      };
    });

    const startMs = new Date(sortedEvents[0].before_captured_at).getTime();
    const players = [...new Set(sessionEvents.map((event) => event.player_name))]
      .map((name) => DISPLAY_NAMES.get(name) || name);

    return {
      id: `session_${startMs}`,
      start_time: sortedEvents[0].before_captured_at,
      end_time: sortedEvents[sortedEvents.length - 1].after_captured_at,
      players,
      games,
      total_matches: games.reduce((sum, game) => sum + game.matchCount, 0),
      total_kills: games.reduce((sum, game) => sum + game.kills, 0),
      total_deaths: games.reduce((sum, game) => sum + game.deaths, 0),
      total_wins: games.reduce((sum, game) => sum + game.wins, 0),
      total_losses: games.reduce((sum, game) => sum + game.losses, 0),
    };
  });
}

async function fetchAll(table, select, orderColumn) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .order(orderColumn, { ascending: true })
      .range(from, from + 999);

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

async function fetchSnapshotsById(ids) {
  const snapshots = new Map();
  const uniqueIds = [...new Set(ids)];

  for (let i = 0; i < uniqueIds.length; i += 500) {
    const chunk = uniqueIds.slice(i, i + 500);
    const { data, error } = await supabase
      .from('snapshots')
      .select('*')
      .in('id', chunk);

    if (error) throw new Error(error.message);
    for (const snapshot of data || []) {
      snapshots.set(snapshot.id, snapshot);
    }
  }

  return snapshots;
}

async function main() {
  const startedAt = Date.now();

  const { error: tableCheckError } = await supabase
    .from('game_events')
    .select('id', { head: true, count: 'exact' })
    .limit(1);

  if (tableCheckError) {
    throw new Error(
      `game_events is not available yet. Run supabase-session-events.sql in Supabase first. ${tableCheckError.message}`
    );
  }

  console.log('Loading lightweight snapshots...');
  const liteSnapshots = await fetchAll(
    'snapshots',
    'id,player_name,captured_at,matches_played,kills,deaths,wins,losses,headshot_kills,revives,vehicle_kills',
    'captured_at'
  );

  const byPlayer = new Map();
  for (const snapshot of liteSnapshots) {
    const list = byPlayer.get(snapshot.player_name) || [];
    list.push(snapshot);
    byPlayer.set(snapshot.player_name, list);
  }

  const pairs = [];
  for (const [playerName, snapshots] of byPlayer) {
    for (let i = 1; i < snapshots.length; i++) {
      const before = snapshots[i - 1];
      const after = snapshots[i];
      const matchesDelta = counterDelta(after.matches_played, before.matches_played);
      if (isPlausibleGameEvent(before, after, matchesDelta)) {
        pairs.push({ playerName, beforeId: before.id, afterId: after.id });
      }
    }
  }

  console.log(`Detected ${pairs.length} plausible event pairs.`);

  const detailIds = pairs.flatMap((pair) => [pair.beforeId, pair.afterId]);
  const snapshotsById = await fetchSnapshotsById(detailIds);
  const gameEvents = pairs
    .map((pair) => buildGameEventRow(
      pair.playerName,
      snapshotsById.get(pair.beforeId),
      snapshotsById.get(pair.afterId)
    ))
    .filter(Boolean);

  console.log(`Built ${gameEvents.length} game_events rows.`);

  for (let i = 0; i < gameEvents.length; i += 500) {
    const chunk = gameEvents.slice(i, i + 500);
    const { error } = await supabase
      .from('game_events')
      .upsert(chunk, { onConflict: 'player_name,before_snapshot_id,after_snapshot_id' });

    if (error) throw new Error(error.message);
  }

  const allEvents = await fetchAll('game_events', '*', 'event_time');
  const sessionRows = buildSessionsFromEvents(allEvents);

  const { error: deleteError } = await supabase
    .from('session_summaries')
    .delete()
    .neq('id', '');

  if (deleteError) throw new Error(deleteError.message);

  for (let i = 0; i < sessionRows.length; i += 200) {
    const chunk = sessionRows.slice(i, i + 200);
    const { error } = await supabase
      .from('session_summaries')
      .upsert(chunk, { onConflict: 'id' });

    if (error) throw new Error(error.message);
  }

  console.log(JSON.stringify({
    snapshots: liteSnapshots.length,
    gameEvents: gameEvents.length,
    sessions: sessionRows.length,
    elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

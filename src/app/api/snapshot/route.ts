import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getTrackedPlayers } from '@/lib/player-store';
import { findGameMode } from '@/lib/utils';
import { buildGameEventRow, refreshSessionSummaries, Snapshot } from '@/lib/session-events';

const GAMETOOLS_BASE = 'https://api.gametools.network/bf6/stats/';
const FETCH_TIMEOUT_MS = 15000;

export const maxDuration = 30;

type WeaponApiStat = {
  weaponName: string;
  type?: string;
  kills: number;
  damage: number;
  headshots?: string | number;
  headshotKills?: number;
  accuracy?: string | number;
  image?: string;
  altImage?: string;
  hipfireKills?: number;
  adsKills?: number;
  multiKills?: number;
  shotsFired?: number;
  shotsHit?: number;
  killsPerMinute?: number;
  damagePerMinute?: number;
  timeEquipped?: string;
};

type NamedApiStat = {
  className?: string;
  vehicleName?: string;
  gadgetName?: string;
  type?: string;
  image?: string;
  kills?: number;
  deaths?: number;
  assists?: number;
  damage?: number;
  damageTo?: number;
  assistDamage?: number;
  score?: number;
  secondsPlayed?: number;
  timeIn?: string;
  timeEquipped?: string;
  uses?: number;
  spawns?: number;
  vehiclesDestroyedWith?: number;
};

function compactNamedStats(items: NamedApiStat[] | undefined, nameKey: 'className' | 'vehicleName' | 'gadgetName') {
  return (items || [])
    .map((item) => ({
      name: item[nameKey] || '',
      type: item.type || '',
      image: item.image || '',
      kills: item.kills || 0,
      deaths: item.deaths || 0,
      assists: item.assists || 0,
      damage: item.damage || 0,
      damageTo: item.damageTo || 0,
      assistDamage: item.assistDamage || 0,
      score: item.score || 0,
      timePlayed: item.secondsPlayed || item.timeIn || item.timeEquipped || 0,
      deployments: item.spawns || 0,
      uses: item.uses || 0,
      vehiclesDestroyedWith: item.vehiclesDestroyedWith || 0,
    }))
    .filter((item) => item.name);
}

/**
 * Check if current time is within play hours (all times in America/Los_Angeles).
 * Mon–Thu: 3 PM – 12 AM
 * Fri–Sun: 8 AM – 1 AM (next day)
 */
function isWithinPlayHours(): boolean {
  const now = new Date();
  const pacific = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const day = pacific.getDay(); // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
  const hour = pacific.getHours();

  // Friday (5), Saturday (6), Sunday (0): 8 AM – 1 AM next day
  if (day === 5 || day === 6 || day === 0) {
    return hour >= 8 || hour < 1;
  }

  // Mon–Thu: 3 PM – 12 AM
  return hour >= 15;
}

async function isOverrideActive(): Promise<boolean> {
  const { data } = await supabase
    .from('tracking_override')
    .select('active_until')
    .eq('id', 1)
    .single();

  if (!data?.active_until) return false;
  return new Date(data.active_until) > new Date();
}

export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get('secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check play hours — skip if outside window and no manual override
  if (!isWithinPlayHours() && !(await isOverrideActive())) {
    return NextResponse.json({ skipped: true, reason: 'Outside play hours' });
  }

  const results: { player: string; status: string; error?: string }[] = [];
  const capturedAt = new Date().toISOString();
  let gameEventsCreated = 0;
  const players = await getTrackedPlayers();

  await Promise.allSettled(
    players.map(async (player) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        const url = `${GAMETOOLS_BASE}?categories=multiplayer&categories=battleroyale&raw=false&format_values=true&seperation=false&name=${encodeURIComponent(player.name)}&platform=${encodeURIComponent(player.platform)}&skip_battlelog=true`;
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);

        if (!res.ok) {
          results.push({ player: player.name, status: 'api_error', error: `HTTP ${res.status}` });
          return;
        }

        const stats = await res.json();

        const redsec = findGameMode(stats.gameModeGroups, 'gm_granitebr')
          || findGameMode(stats.gameModeGroups, 'gm_granite');

        if (!redsec) {
          results.push({ player: player.name, status: 'no_redsec_data' });
          return;
        }

        // Store ALL weapons with kills > 0 (not just top 15)
        // This prevents phantom deltas when weapons rotate in/out of a truncated list
        const weapons = (stats.weapons || [])
          .filter((w: WeaponApiStat) => w.kills > 0)
          .map((w: WeaponApiStat) => ({
            name: w.weaponName,
            type: w.type || '',
            kills: w.kills,
            damage: w.damage,
            headshotKills: w.headshotKills || 0,
            hipfireKills: w.hipfireKills || 0,
            adsKills: w.adsKills || 0,
            multiKills: w.multiKills || 0,
            shotsFired: w.shotsFired || 0,
            shotsHit: w.shotsHit || 0,
            headshots: w.headshots,
            accuracy: w.accuracy,
            killsPerMinute: w.killsPerMinute || 0,
            damagePerMinute: w.damagePerMinute || 0,
            timePlayed: w.timeEquipped || 0,
            image: w.image || '',
            altImage: w.altImage || '',
          }));

        const { data: previousSnapshot } = await supabase
          .from('snapshots')
          .select('*')
          .eq('player_name', player.name)
          .lt('captured_at', capturedAt)
          .order('captured_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const { data: snapshot, error } = await supabase.from('snapshots').insert({
          player_name: player.name,
          captured_at: capturedAt,
          matches_played: redsec.matches || 0,
          kills: redsec.kills || 0,
          deaths: redsec.deaths || 0,
          assists: redsec.assists || 0,
          wins: redsec.wins || 0,
          losses: redsec.losses || 0,
          kd: redsec.killDeath || 0,
          kda: redsec.kdaRatio || 0,
          kpm: redsec.kpm || 0,
          dpm: redsec.dpm || 0,
          score: redsec.score || 0,
          score_per_minute: redsec.scorePerMinute || 0,
          headshot_kills: redsec.headshotKills || 0,
          revives: redsec.revives || 0,
          vehicle_kills: redsec.vehiclesDestroyedWith || 0,
          intel_pickups: redsec.intelPickups || 0,
          spots: redsec.spots || 0,
          repairs: redsec.repairs || 0,
          objectives_armed: redsec.objectivesArmed || 0,
          objectives_destroyed: redsec.objectivesDestroyed || 0,
          weapon_stats: weapons,
          class_stats: compactNamedStats(stats.classes, 'className'),
          vehicle_stats: compactNamedStats(stats.vehicles, 'vehicleName'),
          gadget_stats: compactNamedStats(stats.gadgets, 'gadgetName'),
          raw_stats: {
            userName: stats.userName,
            avatar: stats.avatar,
            timePlayed: stats.timePlayed,
            secondsPlayed: redsec.secondsPlayed || 0,
          },
        }).select('*').single();

        if (error) {
          results.push({ player: player.name, status: 'db_error', error: error.message });
        } else {
          if (previousSnapshot && snapshot) {
            const gameEvent = buildGameEventRow(
              player.name,
              previousSnapshot as Snapshot,
              snapshot as Snapshot
            );

            if (gameEvent) {
              const { error: eventError } = await supabase
                .from('game_events')
                .upsert(gameEvent, {
                  onConflict: 'player_name,before_snapshot_id,after_snapshot_id',
                });

              if (eventError) {
                results.push({
                  player: player.name,
                  status: 'event_error',
                  error: eventError.message,
                });
                return;
              }

              gameEventsCreated += 1;
            }
          }

          results.push({ player: player.name, status: 'ok' });
        }
      } catch (e) {
        results.push({ player: player.name, status: 'error', error: (e as Error).message });
      }
    })
  );

  let sessionRefresh: { sessions: number; error?: string } | null = null;
  if (gameEventsCreated > 0) {
    sessionRefresh = await refreshSessionSummaries();
  }

  return NextResponse.json({ capturedAt, results, gameEventsCreated, sessionRefresh });
}

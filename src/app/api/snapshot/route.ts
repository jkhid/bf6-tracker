import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { PLAYERS } from '@/lib/players';
import { findGameMode } from '@/lib/utils';

const GAMETOOLS_BASE = 'https://api.gametools.network/bf6/stats/';

export async function GET(request: NextRequest) {
  // Protect this endpoint with a secret
  const secret = request.nextUrl.searchParams.get('secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: { player: string; status: string; error?: string }[] = [];
  const capturedAt = new Date().toISOString();

  await Promise.allSettled(
    PLAYERS.map(async (player) => {
      try {
        const url = `${GAMETOOLS_BASE}?categories=multiplayer&categories=battleroyale&raw=false&format_values=true&seperation=false&name=${encodeURIComponent(player.name)}&platform=${encodeURIComponent(player.platform)}&skip_battlelog=true`;
        const res = await fetch(url);

        if (!res.ok) {
          results.push({ player: player.name, status: 'api_error', error: `HTTP ${res.status}` });
          return;
        }

        const stats = await res.json();

        // Get RedSec BR stats
        const redsec = findGameMode(stats.gameModeGroups, 'gm_granitebr')
          || findGameMode(stats.gameModeGroups, 'gm_granite');

        if (!redsec) {
          results.push({ player: player.name, status: 'no_redsec_data' });
          return;
        }

        // Get top weapon stats for delta tracking
        const weapons = (stats.weapons || [])
          .filter((w: { kills: number }) => w.kills > 0)
          .sort((a: { kills: number }, b: { kills: number }) => b.kills - a.kills)
          .slice(0, 15)
          .map((w: { weaponName: string; kills: number; damage: number; headshots: string; accuracy: string }) => ({
            name: w.weaponName,
            kills: w.kills,
            damage: w.damage,
            headshots: w.headshots,
            accuracy: w.accuracy,
          }));

        const { error } = await supabase.from('snapshots').insert({
          player_name: player.name,
          captured_at: capturedAt,
          matches_played: redsec.matches || 0,
          kills: redsec.kills || 0,
          deaths: redsec.deaths || 0,
          wins: redsec.wins || 0,
          losses: redsec.losses || 0,
          kd: redsec.killDeath || 0,
          kpm: redsec.kpm || 0,
          dpm: redsec.dpm || 0,
          headshot_kills: redsec.headshotKills || 0,
          revives: redsec.revives || 0,
          vehicle_kills: redsec.vehiclesDestroyedWith || 0,
          intel_pickups: redsec.intelPickups || 0,
          spots: redsec.spots || 0,
          repairs: redsec.repairs || 0,
          objectives_armed: redsec.objectivesArmed || 0,
          objectives_destroyed: redsec.objectivesDestroyed || 0,
          weapon_stats: weapons,
          raw_stats: {
            userName: stats.userName,
            avatar: stats.avatar,
            timePlayed: stats.timePlayed,
          },
        });

        if (error) {
          results.push({ player: player.name, status: 'db_error', error: error.message });
        } else {
          results.push({ player: player.name, status: 'ok' });
        }
      } catch (e) {
        results.push({ player: player.name, status: 'error', error: (e as Error).message });
      }
    })
  );

  return NextResponse.json({
    capturedAt,
    results,
  });
}

import { Player } from './types';
import { PLAYERS } from './players';
import { supabase } from './supabase';

type PlayerRow = {
  name: string;
  display_name: string;
  platform: Player['platform'];
};

export const PLAYER_PLATFORMS: Player['platform'][] = ['ea', 'steam', 'epic', 'psn', 'xbox'];

export function isPlayerPlatform(value: string): value is Player['platform'] {
  return PLAYER_PLATFORMS.includes(value as Player['platform']);
}

export function toPlayer(row: PlayerRow): Player {
  return {
    name: row.name,
    displayName: row.display_name,
    platform: row.platform,
  };
}

export async function getTrackedPlayers(): Promise<Player[]> {
  const { data, error } = await supabase
    .from('players')
    .select('name, display_name, platform')
    .eq('active', true)
    .order('display_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });

  if (error) {
    console.warn('Falling back to source players:', error.message);
    return PLAYERS;
  }

  return data && data.length > 0 ? data.map(toPlayer) : PLAYERS;
}

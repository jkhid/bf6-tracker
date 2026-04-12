'use client';

import { PLAYERS } from '@/lib/players';

export function usePlayers() {
  return { players: PLAYERS };
}

'use client';

import { useState, useEffect, useCallback } from 'react';
import { Player, PlayerStats, PlayerData } from '@/lib/types';
import { fetchPlayerStats } from '@/lib/api';

export function usePlayerStats(players: Player[]) {
  const [data, setData] = useState<Map<string, PlayerData>>(new Map());

  const playerKey = (p: Player) => `${p.name.toLowerCase()}_${p.platform}`;

  const refresh = useCallback(async () => {
    if (players.length === 0) {
      setData(new Map());
      return;
    }

    // Set loading state for all players
    setData((prev) => {
      const next = new Map(prev);
      players.forEach((p) => {
        const key = playerKey(p);
        next.set(key, { player: p, stats: next.get(key)?.stats ?? null, error: null, loading: true });
      });
      return next;
    });

    // Fetch all in parallel
    await Promise.allSettled(
      players.map(async (p) => {
        const key = playerKey(p);
        try {
          const stats = await fetchPlayerStats(p.name, p.platform);
          setData((prev) => {
            const next = new Map(prev);
            next.set(key, { player: p, stats, error: null, loading: false });
            return next;
          });
        } catch (e) {
          setData((prev) => {
            const next = new Map(prev);
            next.set(key, { player: p, stats: null, error: (e as Error).message, loading: false });
            return next;
          });
        }
      })
    );
  }, [players]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const allPlayerData: PlayerData[] = players.map((p) => {
    const key = playerKey(p);
    return data.get(key) || { player: p, stats: null, error: null, loading: true };
  });

  return { allPlayerData, refresh };
}

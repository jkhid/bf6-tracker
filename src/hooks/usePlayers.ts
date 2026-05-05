'use client';

import { useCallback, useEffect, useState } from 'react';
import { Player } from '@/lib/types';

export function usePlayers() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPlayers = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch('/api/players');
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || 'Failed to load players');
      }

      setPlayers(data.players || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const addPlayer = useCallback(async (player: Player) => {
    const res = await fetch('/api/players', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(player),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error || 'Failed to add player');
    }

    await loadPlayers();
    return data.player as Player;
  }, [loadPlayers]);

  useEffect(() => {
    loadPlayers();
  }, [loadPlayers]);

  return { players, loading, error, reload: loadPlayers, addPlayer };
}

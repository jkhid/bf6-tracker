'use client';

import { useState } from 'react';
import { PlayerData, GameModeStat } from '@/lib/types';
import { parsePercentage, formatNumber, cn, findGameMode } from '@/lib/utils';
import { TableSkeleton } from './LoadingSkeleton';
import Image from 'next/image';

type SortKey =
  | 'killDeath'
  | 'kills'
  | 'deaths'
  | 'wins'
  | 'winPercent'
  | 'matches'
  | 'kpm'
  | 'dpm'
  | 'headshots'
  | 'revives'
  | 'vehiclesDestroyedWith'
  | 'intelPickups';

interface Column {
  key: SortKey;
  label: string;
  format: (v: number) => string;
}

const COLUMNS: Column[] = [
  { key: 'killDeath', label: 'K/D', format: (v) => v.toFixed(2) },
  { key: 'kills', label: 'Kills', format: formatNumber },
  { key: 'deaths', label: 'Deaths', format: formatNumber },
  { key: 'wins', label: 'Wins', format: formatNumber },
  { key: 'winPercent', label: 'Win%', format: (v) => v.toFixed(1) + '%' },
  { key: 'matches', label: 'Matches', format: formatNumber },
  { key: 'kpm', label: 'KPM', format: (v) => v.toFixed(2) },
  { key: 'dpm', label: 'DPM', format: (v) => v.toFixed(1) },
  { key: 'headshots', label: 'HS%', format: (v) => v.toFixed(1) + '%' },
  { key: 'revives', label: 'Revives', format: formatNumber },
  { key: 'vehiclesDestroyedWith', label: 'Veh. Kills', format: formatNumber },
  { key: 'intelPickups', label: 'Intel', format: formatNumber },
];

function getRedSecStats(pd: PlayerData): GameModeStat | null {
  const stats = pd.stats;
  if (!stats) return null;
  return findGameMode(stats.gameModeGroups, 'gm_granitebr')
    || findGameMode(stats.gameModeGroups, 'gm_granite')
    || null;
}

function getValue(gm: GameModeStat, key: SortKey): number {
  if (key === 'winPercent') return parsePercentage(gm.winPercent);
  if (key === 'headshots') return parsePercentage(gm.headshots);
  return (gm[key] as number) || 0;
}

interface LeaderboardProps {
  playerData: PlayerData[];
}

export default function Leaderboard({ playerData }: LeaderboardProps) {
  const [sortKey, setSortKey] = useState<SortKey>('killDeath');
  const [sortAsc, setSortAsc] = useState(false);

  const loading = playerData.some((p) => p.loading);
  if (loading && !playerData.some((p) => p.stats)) {
    return <TableSkeleton rows={playerData.length || 4} />;
  }

  const rows = playerData
    .filter((pd) => pd.stats && getRedSecStats(pd))
    .map((pd) => ({
      pd,
      gm: getRedSecStats(pd)!,
    }));

  rows.sort((a, b) => {
    const va = getValue(a.gm, sortKey);
    const vb = getValue(b.gm, sortKey);
    return sortAsc ? va - vb : vb - va;
  });

  // Find max per column for highlighting
  const maxes: Record<SortKey, number> = {} as Record<SortKey, number>;
  COLUMNS.forEach((col) => {
    maxes[col.key] = Math.max(...rows.map((r) => getValue(r.gm, col.key)), 0);
  });

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  if (rows.length === 0) {
    return (
      <div className="text-center py-12 text-text-muted">
        No RedSec data available. Add players or check back later.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-3 px-2 text-text-muted font-medium text-xs uppercase tracking-wider w-8">
              #
            </th>
            <th className="text-left py-3 px-2 text-text-muted font-medium text-xs uppercase tracking-wider">
              Player
            </th>
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                onClick={() => handleSort(col.key)}
                className="text-right py-3 px-2 text-text-muted font-medium text-xs uppercase tracking-wider cursor-pointer hover:text-text-primary transition-colors whitespace-nowrap"
              >
                {col.label}
                {sortKey === col.key && (
                  <span className="ml-1 text-accent-gold">{sortAsc ? '▲' : '▼'}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ pd, gm }, i) => (
            <tr
              key={pd.player.name}
              className="border-b border-border/50 hover:bg-bg-card-hover transition-colors"
            >
              <td className="py-3 px-2 text-text-muted font-mono text-xs">{i + 1}</td>
              <td className="py-3 px-2">
                <div className="flex items-center gap-2">
                  {pd.stats?.avatar ? (
                    <Image
                      src={pd.stats.avatar}
                      alt={pd.stats.userName}
                      width={28}
                      height={28}
                      className="rounded-full"
                      unoptimized
                    />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-border" />
                  )}
                  <span className="font-medium text-text-primary">{pd.player.displayName}</span>
                  <span className="text-[10px] uppercase text-text-muted bg-bg-primary px-1 py-0.5 rounded">
                    {pd.player.platform === 'xboxseries' ? 'Xbox' : pd.player.platform.toUpperCase()}
                  </span>
                </div>
              </td>
              {COLUMNS.map((col) => {
                const val = getValue(gm, col.key);
                const isMax = val === maxes[col.key] && val > 0 && rows.length > 1;
                return (
                  <td
                    key={col.key}
                    className={cn(
                      'text-right py-3 px-2 font-mono tabular-nums',
                      isMax ? 'text-accent-gold font-bold' : 'text-text-primary'
                    )}
                  >
                    {col.format(val)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

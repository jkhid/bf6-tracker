export function formatSeconds(totalSeconds: number): string {
  if (!totalSeconds || totalSeconds <= 0) return '0m';
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 && days === 0) parts.push(`${minutes}m`);
  return parts.join(' ') || '0m';
}

export function formatNumber(n: number): string {
  if (n == null || isNaN(n)) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

export function parsePercentage(s: string | number): number {
  if (typeof s === 'number') return s;
  if (!s) return 0;
  return parseFloat(String(s).replace('%', '')) || 0;
}

export function formatMeters(m: number): string {
  if (!m || m <= 0) return '0m';
  if (m >= 1000) return (m / 1000).toFixed(1) + 'km';
  return Math.round(m) + 'm';
}

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

import { GameModeStat } from './types';

export function findGameMode(modes: GameModeStat[] | undefined, id: string): GameModeStat | undefined {
  if (!modes || !Array.isArray(modes)) return undefined;
  return modes.find((m) => m.id === id);
}

export function safeNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v) || 0;
  return 0;
}

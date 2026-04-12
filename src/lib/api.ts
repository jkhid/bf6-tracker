import { PlayerStats } from './types';

export async function fetchPlayerStats(
  name: string,
  platform: string
): Promise<PlayerStats> {
  const res = await fetch(
    `/api/player/${encodeURIComponent(name)}?platform=${encodeURIComponent(platform)}`
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Failed to fetch stats for ${name}`);
  }
  return res.json();
}

import { PlayerStats } from './types';

export async function fetchPlayerStats(
  name: string,
  platform: string
): Promise<PlayerStats> {
  const res = await fetch(
    `/api/player/${encodeURIComponent(name)}?platform=${encodeURIComponent(platform)}`
  );
  if (!res.ok) {
    let message = `Failed to fetch stats for ${name} (${res.status})`;
    const text = await res.text();
    if (text) {
      try {
        const data = JSON.parse(text);
        message = data?.error || text;
      } catch {
        message = text;
      }
    }
    throw new Error(message);
  }
  return res.json();
}

import { NextRequest, NextResponse } from 'next/server';

const GAMETOOLS_BASE = 'https://api.gametools.network/bf6/stats/';
const FETCH_TIMEOUT_MS = 15000;
const MAX_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        next: { revalidate: 300 },
      });

      if (res.ok || res.status < 500 || attempt === MAX_ATTEMPTS) {
        return res;
      }
    } catch (e) {
      lastError = e as Error;
      if (attempt === MAX_ATTEMPTS) break;
    } finally {
      clearTimeout(timeout);
    }

    await sleep(250 * attempt);
  }

  throw lastError || new Error('Failed to fetch player data');
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const platform = request.nextUrl.searchParams.get('platform') || 'ea';

  const url = `${GAMETOOLS_BASE}?categories=multiplayer&categories=battleroyale&raw=false&format_values=true&seperation=false&name=${encodeURIComponent(name)}&platform=${encodeURIComponent(platform)}&skip_battlelog=true`;

  try {
    const res = await fetchWithRetry(url);

    if (!res.ok) {
      return NextResponse.json(
        { error: `Gametools API returned ${res.status} for ${name}` },
        { status: res.status >= 500 ? 502 : res.status }
      );
    }

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      return NextResponse.json(
        { error: `Gametools API returned invalid data for ${name}` },
        { status: 502 }
      );
    }

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (e) {
    const message = (e as Error).name === 'AbortError'
      ? `Timed out loading stats for ${name}`
      : (e as Error).message || `Failed to fetch stats for ${name}`;

    return NextResponse.json(
      { error: message },
      { status: 502 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getTrackedPlayers, isPlayerPlatform } from '@/lib/player-store';
import { supabase } from '@/lib/supabase';

export async function GET() {
  const players = await getTrackedPlayers();
  return NextResponse.json({ players }, {
    headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' },
  });
}

export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const body = payload as {
    name?: unknown;
    displayName?: unknown;
    platform?: unknown;
  };

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
  const platform = typeof body.platform === 'string' ? body.platform.trim().toLowerCase() : '';

  if (!name) {
    return NextResponse.json({ error: 'Player username is required' }, { status: 400 });
  }

  if (!displayName) {
    return NextResponse.json({ error: 'Display name is required' }, { status: 400 });
  }

  if (!isPlayerPlatform(platform)) {
    return NextResponse.json({ error: 'Unsupported platform' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('players')
    .upsert(
      {
        name,
        display_name: displayName,
        platform,
        active: true,
      },
      { onConflict: 'name,platform' }
    )
    .select('name, display_name, platform')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    player: {
      name: data.name,
      displayName: data.display_name,
      platform: data.platform,
    },
  }, { status: 201 });
}

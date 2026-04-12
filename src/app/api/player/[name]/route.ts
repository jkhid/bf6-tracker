import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const platform = request.nextUrl.searchParams.get('platform') || 'pc';

  const url = `https://api.gametools.network/bf6/stats/?categories=multiplayer&categories=battleroyale&raw=false&format_values=true&seperation=false&name=${encodeURIComponent(name)}&platform=${encodeURIComponent(platform)}&skip_battlelog=true`;

  try {
    const res = await fetch(url, {
      next: { revalidate: 300 },
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `API returned ${res.status}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || 'Failed to fetch player data' },
      { status: 500 }
    );
  }
}

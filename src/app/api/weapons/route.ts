import { NextResponse } from 'next/server';
import { loadWeaponDataset } from '@/lib/weapon-source';

export async function GET() {
  try {
    const dataset = await loadWeaponDataset();
    return NextResponse.json(
      {
        weapons: dataset.weapons,
        attachmentsByWeapon: dataset.attachmentsByWeapon,
        source: dataset.source,
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800',
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

import { NextResponse } from 'next/server';

const WEAPON_STATS_URL = 'https://api.codmunity.gg/weapon-stats';
const ATTACHMENT_STATS_URL = 'https://api.codmunity.gg/attachment-stats';

interface DamageEntry {
  dropoff?: number;
  base_rpm: number;
  final_rpm: number;
  head: number;
  neck: number;
  chest: number;
  stomach: number;
  upperarm: number;
  lowerarm: number;
  upperleg: number;
  lowerleg: number;
  time_between_shots: number;
  shots_to_kill: number;
  ttk: number;
  enemies_per_magazine: number;
}

interface RawWeapon {
  _id: string;
  game: string;
  gun: string;
  weapon_type: string;
  sourceGame?: string;
  rpm?: number;
  bv?: number;
  mag_size?: number;
  hipfire?: number;
  reload?: number;
  ads?: number;
  control?: number;
  mobility?: number;
  precision?: number;
  hsmultiplier?: number;
  obd?: number;
  simple_damage?: DamageEntry[];
}

interface RawAttachment {
  _id: string;
  attachment: string;
  slot: string;
  gun: string;
  game: string;
  type: string;
  range_mod?: number;
  new_dp?: string | null;
  [key: string]: unknown;
}

export interface Weapon {
  id: string;
  name: string;
  category: string;
  game: 'BF6-BR' | 'BF6';
  rpm: number;
  bv: number;
  magSize: number;
  hipfire: number;
  reload: number;
  ads: number;
  control: number;
  mobility: number;
  precision: number;
  headshotMultiplier: number;
  obd: number;
  damage: DamageEntry[];
}

export interface AttachmentMod {
  id: string;
  name: string;
  slot: string;
  mods: Record<string, number>;
  rangeMod: number | null;
  damageProfile: DamageEntry[] | null;
}

function normalizeDamage(damage: DamageEntry[] | undefined): DamageEntry[] {
  return (damage ?? [])
    .map((d) => ({ ...d, dropoff: d.dropoff ?? 0 }))
    .sort((a, b) => (a.dropoff ?? 0) - (b.dropoff ?? 0));
}

function pruneAttachment(a: RawAttachment): AttachmentMod {
  const mods: Record<string, number> = {};
  for (const [key, value] of Object.entries(a)) {
    if (key.endsWith('_mod') && typeof value === 'number' && value !== 0) {
      mods[key] = value;
    }
  }

  let damageProfile: DamageEntry[] | null = null;
  if (a.new_dp) {
    try {
      const parsed = JSON.parse(a.new_dp);
      if (Array.isArray(parsed)) damageProfile = normalizeDamage(parsed);
    } catch {
      damageProfile = null;
    }
  }

  return {
    id: a._id,
    name: a.attachment,
    slot: a.slot,
    mods,
    rangeMod: typeof a.range_mod === 'number' && a.range_mod !== 1 ? a.range_mod : null,
    damageProfile,
  };
}

function normalize(w: RawWeapon): Weapon {
  return {
    id: w._id,
    name: w.gun,
    category: w.weapon_type,
    game: w.game === 'BF6-BR' ? 'BF6-BR' : 'BF6',
    rpm: w.rpm ?? 0,
    bv: w.bv ?? 0,
    magSize: w.mag_size ?? 0,
    hipfire: w.hipfire ?? 0,
    reload: w.reload ?? 0,
    ads: w.ads ?? 0,
    control: w.control ?? 0,
    mobility: w.mobility ?? 0,
    precision: w.precision ?? 0,
    headshotMultiplier: w.hsmultiplier ?? 1,
    obd: w.obd ?? 0,
    damage: normalizeDamage(w.simple_damage),
  };
}

export async function GET() {
  try {
    const [weaponsRes, attachmentsRes] = await Promise.all([
      fetch(WEAPON_STATS_URL, {
        headers: { Origin: 'https://battlefinity.gg' },
        next: { revalidate: 86400 },
      }),
      fetch(ATTACHMENT_STATS_URL, {
        headers: { Origin: 'https://battlefinity.gg' },
        next: { revalidate: 86400 },
      }),
    ]);

    if (!weaponsRes.ok) throw new Error(`weapon-stats ${weaponsRes.status}`);
    if (!attachmentsRes.ok) throw new Error(`attachment-stats ${attachmentsRes.status}`);

    const rawWeapons: RawWeapon[] = await weaponsRes.json();
    const rawAttachments: RawAttachment[] = await attachmentsRes.json();

    const weapons = rawWeapons
      .filter((w) => w.game === 'BF6-BR')
      .map(normalize)
      .sort((a, b) => a.name.localeCompare(b.name));

    const attachmentsByWeapon: Record<string, AttachmentMod[]> = {};
    for (const a of rawAttachments) {
      if (a.game !== 'BF6-BR') continue;
      const list = attachmentsByWeapon[a.gun] ?? (attachmentsByWeapon[a.gun] = []);
      list.push(pruneAttachment(a));
    }

    return NextResponse.json(
      { weapons, attachmentsByWeapon },
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

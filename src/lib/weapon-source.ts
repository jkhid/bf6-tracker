import { supabase } from './supabase';
import { AttachmentMod, DamageEntry, normalizeDamage, Weapon } from './weapon-math';

export const WEAPON_STATS_URL = 'https://api.codmunity.gg/weapon-stats';
export const ATTACHMENT_STATS_URL = 'https://api.codmunity.gg/attachment-stats';

interface RawWeapon {
  _id: string;
  game: string;
  gun: string;
  weapon_type: string;
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
  range_mod?: number;
  new_dp?: string | null;
  [key: string]: unknown;
}

type WeaponRow = {
  id: string;
  name: string;
  category: string;
  game: 'BF6-BR' | 'BF6';
  rpm: number;
  bv: number;
  mag_size: number;
  hipfire: number;
  reload: number;
  ads: number;
  control: number;
  mobility: number;
  precision: number;
  headshot_multiplier: number;
  obd: number;
  damage_json: DamageEntry[];
};

type AttachmentRow = {
  id: string;
  weapon_name: string;
  name: string;
  slot: string;
  mods_json: Record<string, number>;
  range_mod: number | null;
  damage_profile_json: DamageEntry[] | null;
};

export type WeaponDataset = {
  weapons: Weapon[];
  attachmentsByWeapon: Record<string, AttachmentMod[]>;
  source: 'supabase' | 'codmunity';
};

export function normalizeWeapon(w: RawWeapon): Weapon {
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

export function pruneAttachment(a: RawAttachment): AttachmentMod {
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

function fromWeaponRow(row: WeaponRow): Weapon {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    game: row.game,
    rpm: row.rpm,
    bv: row.bv,
    magSize: row.mag_size,
    hipfire: row.hipfire,
    reload: row.reload,
    ads: row.ads,
    control: row.control,
    mobility: row.mobility,
    precision: row.precision,
    headshotMultiplier: row.headshot_multiplier,
    obd: row.obd,
    damage: normalizeDamage(row.damage_json),
  };
}

function fromAttachmentRow(row: AttachmentRow): AttachmentMod {
  return {
    id: row.id,
    name: row.name,
    slot: row.slot,
    mods: row.mods_json || {},
    rangeMod: row.range_mod,
    damageProfile: row.damage_profile_json ? normalizeDamage(row.damage_profile_json) : null,
  };
}

export async function fetchCodmunityWeaponDataset(): Promise<WeaponDataset> {
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
    .map(normalizeWeapon)
    .sort((a, b) => a.name.localeCompare(b.name));

  const attachmentsByWeapon: Record<string, AttachmentMod[]> = {};
  for (const a of rawAttachments) {
    if (a.game !== 'BF6-BR') continue;
    const list = attachmentsByWeapon[a.gun] ?? (attachmentsByWeapon[a.gun] = []);
    list.push(pruneAttachment(a));
  }

  return { weapons, attachmentsByWeapon, source: 'codmunity' };
}

async function fetchSupabaseWeaponDataset(): Promise<WeaponDataset | null> {
  const [{ data: weapons, error: weaponError }, { data: attachments, error: attachmentError }] = await Promise.all([
    supabase.from('weapon_catalog').select('*').eq('game', 'BF6-BR').order('name', { ascending: true }),
    supabase.from('weapon_attachments').select('*').eq('game', 'BF6-BR').order('weapon_name', { ascending: true }),
  ]);

  if (weaponError || attachmentError || !weapons || weapons.length === 0) return null;

  const attachmentsByWeapon: Record<string, AttachmentMod[]> = {};
  for (const row of (attachments || []) as AttachmentRow[]) {
    const list = attachmentsByWeapon[row.weapon_name] ?? (attachmentsByWeapon[row.weapon_name] = []);
    list.push(fromAttachmentRow(row));
  }

  return {
    weapons: (weapons as WeaponRow[]).map(fromWeaponRow),
    attachmentsByWeapon,
    source: 'supabase',
  };
}

export async function loadWeaponDataset(): Promise<WeaponDataset> {
  const fromSupabase = await fetchSupabaseWeaponDataset();
  return fromSupabase || fetchCodmunityWeaponDataset();
}

export async function importWeaponDatasetToSupabase() {
  const dataset = await fetchCodmunityWeaponDataset();
  const sourceVersion = new Date().toISOString().slice(0, 10);

  const weaponRows = dataset.weapons.map((weapon) => ({
    id: weapon.id,
    name: weapon.name,
    category: weapon.category,
    game: weapon.game,
    rpm: weapon.rpm,
    bv: weapon.bv,
    mag_size: weapon.magSize,
    hipfire: weapon.hipfire,
    reload: weapon.reload,
    ads: weapon.ads,
    control: weapon.control,
    mobility: weapon.mobility,
    precision: weapon.precision,
    headshot_multiplier: weapon.headshotMultiplier,
    obd: weapon.obd,
    damage_json: weapon.damage,
    source: 'codmunity',
    source_version: sourceVersion,
  }));

  const attachmentRows = Object.entries(dataset.attachmentsByWeapon).flatMap(([weaponName, attachments]) =>
    attachments.map((attachment) => ({
      id: attachment.id,
      weapon_name: weaponName,
      name: attachment.name,
      slot: attachment.slot,
      game: 'BF6-BR',
      mods_json: attachment.mods,
      range_mod: attachment.rangeMod,
      damage_profile_json: attachment.damageProfile,
      source: 'codmunity',
      source_version: sourceVersion,
    }))
  );

  const { error: weaponError } = await supabase.from('weapon_catalog').upsert(weaponRows, { onConflict: 'id' });
  if (weaponError) throw new Error(weaponError.message);

  const { error: attachmentError } = await supabase.from('weapon_attachments').upsert(attachmentRows, { onConflict: 'id' });
  if (attachmentError) throw new Error(attachmentError.message);

  return {
    weapons: weaponRows.length,
    attachments: attachmentRows.length,
    sourceVersion,
  };
}

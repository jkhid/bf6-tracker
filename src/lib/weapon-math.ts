export interface DamageEntry {
  dropoff: number;
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

export type RangeBandId = 'cqc' | 'short' | 'mid' | 'long';

export const RANGE_BANDS = [
  { id: 'cqc', label: '0-10m', minDistance: 0, maxDistance: 10 },
  { id: 'short', label: '10m-40m', minDistance: 10, maxDistance: 40 },
  { id: 'mid', label: '40m-80m', minDistance: 40, maxDistance: 80 },
  { id: 'long', label: '80m-120m', minDistance: 80, maxDistance: 120 },
] as const;

export const REDSEC_HEALTH = 200;
export const REDSEC_TICK_RATE = 30;

export const STAT_MOD_FIELD: Record<string, keyof Omit<Weapon, 'id' | 'name' | 'category' | 'game' | 'damage'>> = {
  rpm_mod: 'rpm',
  bv_mod: 'bv',
  mag_size_mod: 'magSize',
  hipfire_mod: 'hipfire',
  reload_mod: 'reload',
  ads_mod: 'ads',
  control_mod: 'control',
  mobility_mod: 'mobility',
  precision_mod: 'precision',
  hsmultiplier_mod: 'headshotMultiplier',
};

export function normalizeDamage(damage: DamageEntry[] | undefined): DamageEntry[] {
  return (damage ?? [])
    .map((d) => ({ ...d, dropoff: d.dropoff ?? 0 }))
    .sort((a, b) => a.dropoff - b.dropoff);
}

export function damageForBody(damage: DamageEntry): number {
  return damage.stomach || damage.chest || damage.neck || damage.head || 0;
}

export function recalculateDamage(damage: DamageEntry[], weapon: Weapon): DamageEntry[] {
  return normalizeDamage(damage).map((d) => {
    const bodyDamage = damageForBody(d);
    const shotsToKill = bodyDamage > 0 ? Math.ceil(REDSEC_HEALTH / bodyDamage) : 0;
    const timeBetweenShots = weapon.rpm > 0 ? 60000 / weapon.rpm : 0;
    const ttk = shotsToKill > 0 ? (shotsToKill - 1) * timeBetweenShots + weapon.obd * 1000 : 0;
    const enemiesPerMagazine = bodyDamage > 0 ? Math.floor(weapon.magSize / bodyDamage) : 0;

    return {
      ...d,
      base_rpm: weapon.rpm,
      final_rpm: weapon.rpm,
      time_between_shots: timeBetweenShots,
      shots_to_kill: shotsToKill,
      ttk,
      enemies_per_magazine: enemiesPerMagazine,
    };
  });
}

export function applyAttachments(weapon: Weapon, attachments: AttachmentMod[]): Weapon {
  const next: Weapon = {
    ...weapon,
    damage: weapon.damage.map((d) => ({ ...d })),
  };

  for (const attachment of attachments) {
    if (attachment.damageProfile?.length) {
      next.damage = attachment.damageProfile.map((d) => ({ ...d }));
    }
  }

  for (const attachment of attachments) {
    for (const [key, value] of Object.entries(attachment.mods)) {
      const field = STAT_MOD_FIELD[key];
      if (!field) continue;
      next[field] = Number((next[field] + value).toFixed(3));
    }

    if (attachment.rangeMod) {
      next.damage = next.damage.map((d) => ({
        ...d,
        dropoff: d.dropoff ? Number((d.dropoff * attachment.rangeMod!).toFixed(2)) : 0,
      }));
    }
  }

  next.damage = recalculateDamage(next.damage, next);
  return next;
}

export function selectedAttachmentsForWeapon(
  attachments: AttachmentMod[],
  equippedBySlot: Record<string, string> | undefined
): AttachmentMod[] {
  if (!equippedBySlot) return [];
  return Object.values(equippedBySlot)
    .map((id) => attachments.find((a) => a.id === id))
    .filter((a): a is AttachmentMod => Boolean(a));
}

export function rangeBandById(id: string | undefined) {
  return RANGE_BANDS.find((range) => range.id === id) || RANGE_BANDS[0];
}

export function rangeBandFromText(value: unknown) {
  const text = typeof value === 'string' ? value.toLowerCase() : '';
  if (text.includes('long')) return RANGE_BANDS[3];
  if (text.includes('mid') || text.includes('medium')) return RANGE_BANDS[2];
  if (text.includes('short')) return RANGE_BANDS[1];
  if (text.includes('close') || text.includes('cqc') || text.includes('near')) return RANGE_BANDS[0];
  const id = typeof value === 'string' ? value : undefined;
  return rangeBandById(id);
}

export function ttkAtDistance(weapon: Weapon, distance: number): number | null {
  if (!weapon.damage || weapon.damage.length === 0) return null;
  let chosen = weapon.damage[0];
  for (const d of weapon.damage) {
    if (d.dropoff <= distance) chosen = d;
    else break;
  }
  const hitscanRange = weapon.bv > 0 ? weapon.bv / REDSEC_TICK_RATE : 0;
  const travelMs = distance > hitscanRange && weapon.bv > 0 ? ((distance - hitscanRange) / weapon.bv) * 1000 : 0;
  return chosen.ttk + travelMs;
}

export function averageTtk(weapon: Weapon, range: typeof RANGE_BANDS[number]): number | null {
  let total = 0;
  let count = 0;
  for (let distance = range.minDistance; distance <= range.maxDistance; distance += 1) {
    const ttk = ttkAtDistance(weapon, distance);
    if (ttk === null) continue;
    total += ttk;
    count += 1;
  }
  return count > 0 ? total / count : null;
}

function normalizeScore(value: number, min: number, max: number, lowerIsBetter = false): number {
  if (!Number.isFinite(value)) return 0;
  if (max === min) return 1;
  const normalized = (value - min) / (max - min);
  return lowerIsBetter ? 1 - normalized : normalized;
}

export function buildScore(weapon: Weapon, range: typeof RANGE_BANDS[number], peers: Weapon[]): number {
  const ttk = averageTtk(weapon, range) ?? Infinity;
  const peerTtks = peers.map((peer) => averageTtk(peer, range)).filter((value): value is number => value !== null);
  const ttkScore = normalizeScore(ttk, Math.min(...peerTtks), Math.max(...peerTtks), true);
  const adsScore = normalizeScore(weapon.ads, Math.min(...peers.map((peer) => peer.ads)), Math.max(...peers.map((peer) => peer.ads)), true);
  const hipfireScore = normalizeScore(weapon.hipfire, Math.min(...peers.map((peer) => peer.hipfire)), Math.max(...peers.map((peer) => peer.hipfire)));
  const controlScore = normalizeScore(weapon.control, Math.min(...peers.map((peer) => peer.control)), Math.max(...peers.map((peer) => peer.control)));
  const mobilityScore = normalizeScore(weapon.mobility, Math.min(...peers.map((peer) => peer.mobility)), Math.max(...peers.map((peer) => peer.mobility)));
  const velocityScore = normalizeScore(weapon.bv, Math.min(...peers.map((peer) => peer.bv)), Math.max(...peers.map((peer) => peer.bv)));

  if (range.id === 'cqc') {
    return ttkScore * 0.38 + adsScore * 0.22 + hipfireScore * 0.2 + mobilityScore * 0.12 + controlScore * 0.08;
  }
  if (range.id === 'short') {
    return ttkScore * 0.4 + controlScore * 0.22 + adsScore * 0.16 + velocityScore * 0.12 + mobilityScore * 0.1;
  }
  if (range.id === 'mid') {
    return ttkScore * 0.38 + controlScore * 0.28 + velocityScore * 0.2 + adsScore * 0.08 + mobilityScore * 0.06;
  }
  return ttkScore * 0.34 + controlScore * 0.3 + velocityScore * 0.26 + adsScore * 0.06 + mobilityScore * 0.04;
}

export function formatMs(value: number | null): string {
  return value === null ? '-' : `${Math.round(value)} ms`;
}

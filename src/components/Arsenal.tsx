'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface DamageEntry {
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

interface Weapon {
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

interface AttachmentMod {
  id: string;
  name: string;
  slot: string;
  mods: Record<string, number>;
  rangeMod: number | null;
  damageProfile: DamageEntry[] | null;
}

const RANGE_BANDS = [
  { id: 'cqc', label: '0–10m', minDistance: 0, maxDistance: 10 },
  { id: 'short', label: '10m–40m', minDistance: 10, maxDistance: 40 },
  { id: 'mid', label: '40m–80m', minDistance: 40, maxDistance: 80 },
  { id: 'long', label: '80m–120m', minDistance: 80, maxDistance: 120 },
] as const;

const CATEGORIES = ['Assault Rifle', 'SMG', 'Carbine', 'DMR', 'LMG', 'Sniper Rifle', 'Pistol', 'Shotgun'];

const COMPARE_PALETTE = ['#ff6b1a', '#f59e0b', '#22d3ee', '#a855f7', '#22c55e'];
const REDSEC_HEALTH = 200;
const REDSEC_TICK_RATE = 30;
const WEAPON_IMAGE_ALIASES: Record<string, string[]> = {
  'KORD 6P67': ['KRD-6P67'],
};

type EquippedBySlot = Record<string, string>;
type EquippedByWeapon = Record<string, EquippedBySlot>;
type CalculatedWeapon = Weapon;
type ComparedWeapon = CalculatedWeapon & { equippedCount: number };
type CompareView = 'chart' | 'table';
type SortMetric = 'ttk' | 'rpm' | 'mag' | 'damage';
type CompareMetric = {
  id: string;
  label: string;
  lowerIsBetter?: boolean;
  getValue: (weapon: ComparedWeapon) => number | null;
  format: (value: number) => string;
};
type CompareSection = {
  title: string;
  metrics: CompareMetric[];
};

const STAT_MOD_FIELD: Record<string, keyof Omit<Weapon, 'id' | 'name' | 'category' | 'game' | 'damage'>> = {
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

function normalizeDamage(damage: DamageEntry[]): DamageEntry[] {
  return damage
    .map((d) => ({ ...d, dropoff: d.dropoff ?? 0 }))
    .sort((a, b) => a.dropoff - b.dropoff);
}

function damageForBody(damage: DamageEntry): number {
  return damage.stomach || damage.chest || damage.neck || damage.head || 0;
}

function recalculateDamage(damage: DamageEntry[], weapon: Weapon): DamageEntry[] {
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

function applyAttachments(weapon: Weapon, attachments: AttachmentMod[]): CalculatedWeapon {
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

function selectedAttachmentsForWeapon(
  attachments: AttachmentMod[],
  equippedBySlot: EquippedBySlot | undefined
): AttachmentMod[] {
  if (!equippedBySlot) return [];
  return Object.values(equippedBySlot)
    .map((id) => attachments.find((a) => a.id === id))
    .filter((a): a is AttachmentMod => Boolean(a));
}

function ttkAtDistance(weapon: CalculatedWeapon, distance: number): number | null {
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

function averageTtk(weapon: CalculatedWeapon, range: typeof RANGE_BANDS[number]): number | null {
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

const formatMs = (value: number) => `${Math.round(value)} ms`;
const formatNumber = (value: number) => String(Math.round(value));
const formatVelocity = (value: number) => `${Math.round(value)} m/s`;
const formatRpm = (value: number) => `${Math.round(value)} rpm`;
const formatSeconds = (value: number) => `${Number(value).toFixed(2)} s`;
const formatMultiplier = (value: number) => `${Number(value).toFixed(2)}x`;

const COMPARE_SECTIONS: CompareSection[] = [
  {
    title: 'Average Time To Kill',
    metrics: RANGE_BANDS.map((band) => ({
      id: `ttk-${band.id}`,
      label: band.label,
      lowerIsBetter: true,
      getValue: (weapon) => averageTtk(weapon, band),
      format: formatMs,
    })),
  },
  {
    title: 'Recoil',
    metrics: [
      { id: 'control', label: 'Control', getValue: (weapon) => weapon.control, format: formatNumber },
      { id: 'precision', label: 'Precision', getValue: (weapon) => weapon.precision, format: formatNumber },
    ],
  },
  {
    title: 'Damage',
    metrics: [
      { id: 'bv', label: 'Bullet Velocity', getValue: (weapon) => weapon.bv, format: formatVelocity },
      { id: 'rpm', label: 'RPM', getValue: (weapon) => weapon.rpm, format: formatRpm },
      { id: 'headshot', label: 'Headshot Multiplier', getValue: (weapon) => weapon.headshotMultiplier, format: formatMultiplier },
    ],
  },
  {
    title: 'Handling',
    metrics: [
      { id: 'ads', label: 'ADS', lowerIsBetter: true, getValue: (weapon) => weapon.ads, format: formatMs },
      { id: 'reload', label: 'Reload Speed', lowerIsBetter: true, getValue: (weapon) => weapon.reload, format: formatSeconds },
      { id: 'mobility', label: 'Mobility', getValue: (weapon) => weapon.mobility, format: formatNumber },
    ],
  },
  {
    title: 'Other',
    metrics: [
      { id: 'hipfire', label: 'Hipfire', getValue: (weapon) => weapon.hipfire, format: formatNumber },
      { id: 'mag', label: 'Magazine Size', getValue: (weapon) => weapon.magSize, format: formatNumber },
    ],
  },
];

function compareMetricValues(metric: CompareMetric, a: ComparedWeapon, b: ComparedWeapon): number {
  const av = metric.getValue(a);
  const bv = metric.getValue(b);
  if (av === null && bv === null) return a.name.localeCompare(b.name);
  if (av === null) return 1;
  if (bv === null) return -1;
  return metric.lowerIsBetter ? av - bv : bv - av;
}

function metricRank(metric: CompareMetric, weapon: ComparedWeapon, weapons: ComparedWeapon[]): number | null {
  const value = metric.getValue(weapon);
  if (value === null) return null;
  const ranked = weapons
    .map((w) => metric.getValue(w))
    .filter((v): v is number => v !== null)
    .sort((a, b) => (metric.lowerIsBetter ? a - b : b - a));
  return ranked.findIndex((v) => v === value);
}

function imageUrlCandidates(name: string): string[] {
  const safe = name.replace(/\s+/g, '-');
  const safeLower = safe.toLowerCase();
  const compact = name.replace(/[\s-]+/g, '');
  const compactLower = compact.toLowerCase();
  const underscored = name.toLowerCase().replace(/[\s-]+/g, '_');
  const loose = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const aliases = WEAPON_IMAGE_ALIASES[name] ?? [];
  return [
    ...aliases.flatMap((alias) => [
      `https://assets.codmunity.gg/optimized/300w-${alias}.webp`,
      `https://assets.codmunity.gg/optimized/300w-${alias}_bf6_icon.webp`,
      `https://assets.codmunity.gg/optimized/${alias}.webp`,
      `https://assets.codmunity.gg/optimized/${alias}_bf6_icon.webp`,
    ]),
    `https://assets.codmunity.gg/optimized/300w-${safe}.webp`,
    `https://assets.codmunity.gg/optimized/300w-${safe}_bf6_icon.webp`,
    `https://assets.codmunity.gg/optimized/300w-${safeLower}.webp`,
    `https://assets.codmunity.gg/optimized/300w-${safeLower}_bf6_icon.webp`,
    `https://assets.codmunity.gg/optimized/300w-${compact}.webp`,
    `https://assets.codmunity.gg/optimized/300w-${compact}_bf6_icon.webp`,
    `https://assets.codmunity.gg/optimized/300w-${compactLower}_bf6_icon.webp`,
    `https://assets.codmunity.gg/optimized/300w-${underscored}_bf6_icon.webp`,
    `https://assets.codmunity.gg/optimized/300w-${loose}.webp`,
    `https://assets.codmunity.gg/optimized/300w-${loose}_bf6_icon.webp`,
    `https://assets.codmunity.gg/optimized/${safe}.webp`,
    `https://assets.codmunity.gg/optimized/${safeLower}.webp`,
    `https://assets.codmunity.gg/optimized/${safeLower}_bf6_icon.webp`,
    `https://assets.codmunity.gg/optimized/${compact}.webp`,
    `https://assets.codmunity.gg/optimized/${compactLower}_bf6_icon.webp`,
    `https://assets.codmunity.gg/optimized/${loose}_bf6_icon.webp`,
  ];
}

function formatModKey(key: string): string {
  return key
    .replace(/_mod$/, '')
    .replace(/_/g, ' ')
    .replace(/\bads\b/i, 'ADS')
    .replace(/\bbv\b/i, 'BV')
    .replace(/\bhsmultiplier\b/i, 'HS')
    .replace(/\brpm\b/i, 'RPM');
}

function formatModValue(value: number): string {
  const formatted = Math.abs(value) < 10 && value % 1 !== 0 ? value.toFixed(2) : String(value);
  return `${value > 0 ? '+' : ''}${formatted}`;
}

function WeaponSilhouette({ name, className }: { name: string; className?: string }) {
  const [idx, setIdx] = useState(0);
  const candidates = useMemo(() => imageUrlCandidates(name), [name]);
  if (idx >= candidates.length) {
    return (
      <div className={`relative flex items-center justify-center text-text-muted/50 ${className ?? ''}`}>
        <svg viewBox="0 0 72 32" fill="none" className="w-full h-full p-1" aria-hidden="true">
          <path d="M5 19H35V13H50V17H66V22H45V25H31V22H5V19Z" stroke="currentColor" strokeWidth="2" />
          <path d="M17 19V15H31" stroke="currentColor" strokeWidth="2" />
          <path d="M50 17V10H61V17" stroke="currentColor" strokeWidth="2" />
        </svg>
        <span className="sr-only">{name} image unavailable</span>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={candidates[idx]}
      alt={name}
      className={className}
      onError={() => setIdx((i) => i + 1)}
      loading="lazy"
    />
  );
}

function Sparkline({
  weapon,
  width = 80,
  height = 22,
  color = 'var(--color-tactical-orange)',
}: {
  weapon: CalculatedWeapon;
  width?: number;
  height?: number;
  color?: string;
}) {
  const points = useMemo(() => {
    const pts: { d: number; ttk: number }[] = [];
    for (let d = 0; d <= 120; d += 4) {
      const ttk = ttkAtDistance(weapon, d);
      if (ttk !== null) pts.push({ d, ttk });
    }
    return pts;
  }, [weapon]);
  if (points.length === 0) return null;
  const minTtk = Math.min(...points.map((p) => p.ttk));
  const maxTtk = Math.max(...points.map((p) => p.ttk));
  const range = maxTtk - minTtk || 1;
  const path = points
    .map((p, i) => {
      const x = (p.d / 120) * width;
      const y = height - ((p.ttk - minTtk) / range) * (height - 4) - 2;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const area = `${path} L${width},${height} L0,${height} Z`;
  return (
    <svg width={width} height={height} className="overflow-visible block" aria-hidden="true">
      <path d={area} fill={color} fillOpacity="0.12" />
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BigSparkline({ weapon }: { weapon: CalculatedWeapon }) {
  const w = 600;
  const h = 80;
  const points = useMemo(() => {
    const pts: { d: number; ttk: number }[] = [];
    for (let d = 0; d <= 120; d += 1) {
      const ttk = ttkAtDistance(weapon, d);
      if (ttk !== null) pts.push({ d, ttk });
    }
    return pts;
  }, [weapon]);
  if (points.length === 0) return null;
  const minTtk = Math.min(...points.map((p) => p.ttk));
  const maxTtk = Math.max(...points.map((p) => p.ttk));
  const range = maxTtk - minTtk || 1;
  const path = points
    .map((p, i) => {
      const x = (p.d / 120) * w;
      const y = h - ((p.ttk - minTtk) / range) * (h - 8) - 4;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const area = `${path} L${w},${h} L0,${h} Z`;
  return (
    <div className="relative w-full h-[80px] bg-bg-primary/60 rounded border border-border overflow-hidden">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-full">
        {[0, 0.25, 0.5, 0.75, 1].map((p, i) => (
          <line key={i} x1={p * w} y1={0} x2={p * w} y2={h} stroke="rgba(148,163,184,0.08)" />
        ))}
        <path d={area} fill="var(--color-tactical-orange)" fillOpacity="0.14" />
        <path d={path} fill="none" stroke="var(--color-tactical-orange)" strokeWidth="1.5" />
      </svg>
      <div className="absolute inset-0 flex justify-between items-end px-2 pb-0.5 pointer-events-none">
        {[0, 30, 60, 90, 120].map((d) => (
          <span key={d} className="text-[9px] text-text-muted font-mono tabular-nums">{d}m</span>
        ))}
      </div>
      <div className="absolute top-1 left-2 text-[9px] font-mono text-text-muted tabular-nums">{Math.round(maxTtk)}ms</div>
      <div className="absolute bottom-3 left-2 text-[9px] font-mono tabular-nums text-tactical-orange">{Math.round(minTtk)}ms</div>
    </div>
  );
}

export default function Arsenal() {
  const [data, setData] = useState<{ weapons: Weapon[]; attachmentsByWeapon: Record<string, AttachmentMod[]> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<string>('Assault Rifle');
  const [rangeId, setRangeId] = useState<typeof RANGE_BANDS[number]['id']>('cqc');
  const [search, setSearch] = useState('');
  const [sortMetric, setSortMetric] = useState<SortMetric>('ttk');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [compare, setCompare] = useState<string[]>([]);
  const [showCompare, setShowCompare] = useState(false);
  const [equipped, setEquipped] = useState<EquippedByWeapon>({});

  useEffect(() => {
    let cancelled = false;
    fetch('/api/weapons')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  const range = RANGE_BANDS.find((r) => r.id === rangeId)!;

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.weapons
      .filter((w) => w.category === category)
      .filter((w) => (search ? w.name.toLowerCase().includes(search.toLowerCase()) : true))
      .filter((w) => w.damage.length > 0)
      .map((w) => {
        const attachments = data.attachmentsByWeapon[w.name] ?? [];
        const selectedAtts = selectedAttachmentsForWeapon(attachments, equipped[w.id]);
        const calculated = applyAttachments(w, selectedAtts);
        const ttk = averageTtk(calculated, range);
        return { weapon: w, calculated, attachments, selectedAtts, ttk };
      })
      .sort((a, b) => {
        switch (sortMetric) {
          case 'rpm':
            return b.calculated.rpm - a.calculated.rpm;
          case 'mag':
            return b.calculated.magSize - a.calculated.magSize;
          case 'damage':
            return (b.calculated.damage[0]?.chest ?? 0) - (a.calculated.damage[0]?.chest ?? 0);
          case 'ttk':
          default:
            return (a.ttk ?? Infinity) - (b.ttk ?? Infinity);
        }
      });
  }, [data, category, search, range, equipped, sortMetric]);

  const compareWeapons = useMemo(() => {
    if (!data) return [];
    return compare
      .map((id) => {
        const weapon = data.weapons.find((w) => w.id === id);
        if (!weapon) return null;
        const attachments = data.attachmentsByWeapon[weapon.name] ?? [];
        const selected = selectedAttachmentsForWeapon(attachments, equipped[id]);
        return { ...applyAttachments(weapon, selected), equippedCount: selected.length };
      })
      .filter((w): w is ComparedWeapon => Boolean(w));
  }, [data, compare, equipped]);

  function setEquippedAttachment(weaponId: string, slot: string, attachmentId: string | null) {
    setEquipped((prev) => {
      const current = { ...(prev[weaponId] ?? {}) };
      if (attachmentId) current[slot] = attachmentId;
      else delete current[slot];
      return { ...prev, [weaponId]: current };
    });
  }

  function resetEquipped(weaponId: string) {
    setEquipped((prev) => {
      const next = { ...prev };
      delete next[weaponId];
      return next;
    });
  }

  function toggleCompare(id: string) {
    setCompare((prev) => {
      if (prev.includes(id)) return prev.filter((p) => p !== id);
      if (prev.length >= 5) return [...prev.slice(1), id];
      return [...prev, id];
    });
  }

  if (error) {
    return (
      <div className="border border-negative/40 bg-negative/5 rounded-lg p-6 text-sm text-negative">
        Failed to load weapons: {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-3">
        <div className="h-12 skeleton rounded-lg" />
        <div className="h-10 skeleton rounded-lg" />
        <div className="h-8 skeleton rounded" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-20 skeleton rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 pb-1">
        <div className="flex items-center gap-3">
          <div className="w-1 h-8 rounded-sm bg-tactical-orange" />
          <div>
            <h2 className="font-display text-[22px] tracking-tight leading-none">WEAPON STATS</h2>
            <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-text-muted mt-1">
              BF6 · {data.weapons.length} weapons cataloged · RedSec ruleset
            </div>
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-2 text-[10px] font-mono text-text-muted">
          <span>SORT</span>
          <span className="text-text-primary uppercase tracking-wider">{sortMetric}</span>
          <span className="opacity-40">·</span>
          <span>{filtered.length} match</span>
        </div>
      </div>

      {/* Search + categories */}
      <div className="flex flex-col lg:flex-row gap-3">
        <div className="flex flex-col sm:flex-row gap-2 lg:w-[420px] flex-shrink-0">
          <div className="relative flex-1">
            <svg
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="7" />
              <line x1="16.5" y1="16.5" x2="21" y2="21" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search weapons…"
              className="w-full pl-10 pr-3 py-2.5 bg-bg-card border border-border rounded-md text-[13px] text-text-primary placeholder:text-text-muted focus:border-tactical-orange/60 focus:outline-none transition-colors"
            />
          </div>
          <select
            value={sortMetric}
            onChange={(e) => setSortMetric(e.target.value as SortMetric)}
            className="px-3 py-2.5 bg-bg-card border border-border rounded-md text-[12px] font-mono uppercase tracking-wider text-text-primary focus:border-tactical-orange/60 focus:outline-none"
          >
            <option value="ttk">TTK</option>
            <option value="rpm">RPM</option>
            <option value="mag">MAG</option>
            <option value="damage">DMG</option>
          </select>
        </div>
        <div className="flex-1 flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
          {CATEGORIES.map((c) => {
            const active = c === category;
            return (
              <button
                key={c}
                onClick={() => {
                  setCategory(c);
                  setExpandedId(null);
                }}
                className={
                  'px-3 py-2 rounded-md border text-[12px] font-medium tracking-tight transition-colors flex-shrink-0 ' +
                  (active
                    ? 'bg-tactical-orange/10 border-tactical-orange text-text-primary'
                    : 'bg-bg-card border-border text-text-secondary hover:text-text-primary hover:border-border-accent')
                }
              >
                {c}
              </button>
            );
          })}
        </div>
      </div>

      {/* Range tabs */}
      <div className="flex border-b border-border overflow-x-auto">
        {RANGE_BANDS.map((b) => {
          const active = b.id === rangeId;
          return (
            <button
              key={b.id}
              onClick={() => setRangeId(b.id)}
              className={
                'flex-1 min-w-[88px] py-2.5 text-center text-[11px] font-mono uppercase tracking-[0.14em] relative transition-colors ' +
                (active ? 'text-tactical-orange' : 'text-text-secondary hover:text-text-primary')
              }
            >
              {b.label}
              {active && <span className="absolute bottom-[-1px] left-0 right-0 h-[2px] bg-tactical-orange" />}
            </button>
          );
        })}
      </div>

      {/* Weapon rows */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="border border-border rounded-lg p-10 text-center text-text-muted text-sm">
            No weapons match.
          </div>
        )}
        {filtered.map(({ weapon, calculated, attachments, selectedAtts, ttk }) => (
          <WeaponRow
            key={weapon.id}
            weapon={weapon}
            calculated={calculated}
            ttk={ttk}
            attachments={attachments}
            equippedCount={selectedAtts.length}
            range={range}
            sortMetric={sortMetric}
            expanded={expandedId === weapon.id}
            onToggle={() => setExpandedId(expandedId === weapon.id ? null : weapon.id)}
            inCompare={compare.includes(weapon.id)}
            onCompare={() => toggleCompare(weapon.id)}
            equippedBySlot={equipped[weapon.id] ?? {}}
            onEquip={(slot, id) => setEquippedAttachment(weapon.id, slot, id)}
            onReset={() => resetEquipped(weapon.id)}
          />
        ))}
      </div>

      <div className="text-[11px] text-text-muted text-center pt-2">
        Weapon data via <a href="https://battlefinity.gg" className="hover:text-tactical-orange" target="_blank" rel="noreferrer">battlefinity.gg</a> · {data.weapons.length} weapons cataloged
      </div>

      {/* Compare dock */}
      {compare.length > 0 && (
        <CompareDock
          weapons={compareWeapons}
          onRemove={(id) => toggleCompare(id)}
          onOpen={() => setShowCompare(true)}
          onClear={() => {
            setCompare([]);
            setShowCompare(false);
          }}
        />
      )}

      {/* Compare overlay */}
      {showCompare && compareWeapons.length > 0 && (
        <CompareOverlay
          weapons={compareWeapons}
          onClose={() => setShowCompare(false)}
          onRemove={(id) => toggleCompare(id)}
        />
      )}
    </div>
  );
}

function WeaponRow({
  weapon,
  calculated,
  ttk,
  attachments,
  equippedCount,
  range,
  sortMetric,
  expanded,
  onToggle,
  inCompare,
  onCompare,
  equippedBySlot,
  onEquip,
  onReset,
}: {
  weapon: Weapon;
  calculated: CalculatedWeapon;
  ttk: number | null;
  attachments: AttachmentMod[];
  equippedCount: number;
  range: typeof RANGE_BANDS[number];
  sortMetric: SortMetric;
  expanded: boolean;
  onToggle: () => void;
  inCompare: boolean;
  onCompare: () => void;
  equippedBySlot: EquippedBySlot;
  onEquip: (slot: string, attachmentId: string | null) => void;
  onReset: () => void;
}) {
  const rightMetric = useMemo(() => {
    switch (sortMetric) {
      case 'rpm':
        return { label: 'RPM', value: formatNumber(calculated.rpm) };
      case 'mag':
        return { label: 'MAG', value: formatNumber(calculated.magSize) };
      case 'damage':
        return { label: 'DMG', value: formatNumber(calculated.damage[0]?.chest ?? 0) };
      case 'ttk':
      default:
        return { label: `${range.label} TTK`, value: ttk !== null ? `${Math.round(ttk)}ms` : '—' };
    }
  }, [sortMetric, calculated, ttk, range]);

  return (
    <div
      className={
        'border rounded-lg overflow-hidden transition-colors bg-bg-card ' +
        (expanded ? 'border-tactical-orange/50' : 'border-border hover:border-border-accent')
      }
    >
      <div className="w-full flex items-stretch">
        {/* Left edge stripe */}
        <div
          className="w-[3px] flex-shrink-0 bg-tactical-orange"
          style={{ opacity: expanded ? 1 : 0.6 }}
        />
        {/* Main button: image + name + chips + sparkline + hero TTK + chevron */}
        <button
          onClick={onToggle}
          className="flex-1 flex items-center gap-3 sm:gap-4 text-left py-3 sm:py-4 px-3 sm:px-4 min-w-0"
        >
          <div className="flex items-center justify-center flex-shrink-0 w-[64px] h-[32px] sm:w-[96px] sm:h-[44px]">
            <WeaponSilhouette name={weapon.name} className="max-w-full max-h-full object-contain" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 min-w-0">
              <span className="font-semibold text-text-primary tracking-tight text-[14px] sm:text-[15px] truncate">{weapon.name}</span>
              <span className="text-[10px] uppercase tracking-[0.14em] text-text-muted font-mono hidden sm:inline">{weapon.category}</span>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] flex-wrap">
              <span className="px-1.5 py-0.5 rounded bg-bg-primary text-text-secondary font-mono tabular-nums">{calculated.rpm} RPM</span>
              <span className="px-1.5 py-0.5 rounded bg-bg-primary text-text-secondary font-mono tabular-nums">{calculated.magSize} MAG</span>
              {equippedCount > 0 && (
                <span className="px-1.5 py-0.5 rounded font-mono bg-tactical-orange/15 text-tactical-orange">{equippedCount} EQUIPPED</span>
              )}
              <span className="text-text-muted font-mono hidden sm:inline">{attachments.length} attachments</span>
            </div>
          </div>
          {/* Sparkline — md+ only */}
          <div className="hidden md:flex flex-col items-end gap-1 flex-shrink-0 pr-1">
            <span className="text-[9px] uppercase tracking-[0.14em] text-text-muted font-mono">TTK · 0–120m</span>
            <Sparkline weapon={calculated} />
          </div>
          {/* Hero metric */}
          <div className="text-right flex-shrink-0 min-w-[64px] sm:min-w-[80px]">
            <div className="text-[9px] uppercase tracking-[0.14em] text-text-muted font-mono">{rightMetric.label}</div>
            <div className="font-display text-[22px] sm:text-[28px] leading-none mt-0.5 tabular-nums text-tactical-orange">
              {rightMetric.value}
            </div>
          </div>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={'text-text-muted transition-transform flex-shrink-0 ' + (expanded ? 'rotate-180' : '')}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        {/* Compare toggle — sibling, not nested in the row button */}
        <button
          type="button"
          onClick={onCompare}
          title={inCompare ? 'Remove from compare' : 'Add to compare'}
          className={
            'flex-shrink-0 w-9 my-3 mr-2 sm:mr-3 ml-1 rounded-md border flex items-center justify-center transition-colors ' +
            (inCompare
              ? 'border-tactical-orange text-tactical-orange bg-tactical-orange/10'
              : 'border-border text-text-muted hover:text-text-primary hover:border-border-accent')
          }
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {inCompare ? (
              <polyline points="20 6 9 17 4 12" />
            ) : (
              <>
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </>
            )}
          </svg>
        </button>
      </div>
      {expanded && (
        <ExpandedDetail
          calculatedWeapon={calculated}
          attachments={attachments}
          equippedBySlot={equippedBySlot}
          activeRange={range}
          onEquip={onEquip}
          onReset={onReset}
          ttk={ttk}
        />
      )}
    </div>
  );
}

function ExpandedDetail({
  calculatedWeapon,
  attachments,
  equippedBySlot,
  activeRange,
  onEquip,
  onReset,
  ttk,
}: {
  calculatedWeapon: CalculatedWeapon;
  attachments: AttachmentMod[];
  equippedBySlot: EquippedBySlot;
  activeRange: typeof RANGE_BANDS[number];
  onEquip: (slot: string, attachmentId: string | null) => void;
  onReset: () => void;
  ttk: number | null;
}) {
  const attachmentsBySlot = useMemo(() => {
    const map: Record<string, AttachmentMod[]> = {};
    for (const a of attachments) {
      const list = map[a.slot] ?? (map[a.slot] = []);
      list.push(a);
    }
    return map;
  }, [attachments]);
  const slots = Object.keys(attachmentsBySlot).sort();
  const [activeSlot, setActiveSlot] = useState<string | null>(null);
  const selectedSlot = activeSlot && slots.includes(activeSlot) ? activeSlot : slots[0];
  const activeOptions = selectedSlot ? attachmentsBySlot[selectedSlot] : [];
  const equippedCount = Object.keys(equippedBySlot).length;

  return (
    <div className="border-t border-border bg-bg-primary/40">
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,360px)] lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)] gap-px bg-border/40">
        {/* Left: stats + damage cards + sparkline */}
        <div className="bg-bg-card p-4 sm:p-5 space-y-5">
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-[10px] uppercase tracking-[0.18em] text-text-muted font-mono">Stats</h4>
              <span className="text-[10px] text-text-muted font-mono">{equippedCount} attachments equipped</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Stat label="RPM" value={calculatedWeapon.rpm} />
              <Stat label="MAG" value={calculatedWeapon.magSize} />
              <Stat label="BV" value={calculatedWeapon.bv} suffix="m/s" />
              <Stat label="ADS" value={calculatedWeapon.ads} suffix="ms" />
              <StatBar label="Mobility" value={calculatedWeapon.mobility} max={100} />
              <StatBar label="Control" value={calculatedWeapon.control} max={100} />
              <StatBar label="Hipfire" value={calculatedWeapon.hipfire} max={100} />
              <StatBar label="Precision" value={calculatedWeapon.precision} max={100} />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2 gap-3">
              <h4 className="text-[10px] uppercase tracking-[0.18em] text-text-muted font-mono">Damage by range</h4>
              <span className="text-[10px] font-mono text-text-muted">
                {activeRange.label} avg{' '}
                <span className="font-semibold tabular-nums text-tactical-orange">
                  {ttk !== null ? `${Math.round(ttk)}ms` : '—'}
                </span>
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-1.5">
              {calculatedWeapon.damage.slice(0, 5).map((d, i) => {
                const next = calculatedWeapon.damage[i + 1];
                const inBand =
                  activeRange.maxDistance >= d.dropoff && activeRange.minDistance < (next?.dropoff ?? Infinity);
                return (
                  <div
                    key={i}
                    className={
                      'p-2.5 rounded-md border ' +
                      (inBand
                        ? 'border-tactical-orange/60 bg-tactical-orange/5'
                        : 'border-border bg-bg-primary/60')
                    }
                  >
                    <div className="text-[10px] text-text-muted font-mono">≥ {d.dropoff}m</div>
                    <div className="text-[16px] font-semibold text-text-primary mt-0.5 tabular-nums">
                      {d.chest}
                      <span className="text-[10px] text-text-muted ml-1 font-normal">dmg</span>
                    </div>
                    <div className="text-[10px] text-text-muted mt-0.5 font-mono tabular-nums">
                      {d.shots_to_kill} STK
                    </div>
                    <div className="text-[10px] mt-0.5 font-mono tabular-nums text-tactical-orange">
                      {Math.round(d.ttk)}ms
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-[10px] uppercase tracking-[0.18em] text-text-muted font-mono">TTK over distance</h4>
              <span className="text-[10px] font-mono text-text-muted">0–120m</span>
            </div>
            <BigSparkline weapon={calculatedWeapon} />
          </div>
        </div>

        {/* Right: gunsmith */}
        <div className="bg-bg-card p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-[10px] uppercase tracking-[0.18em] text-text-muted font-mono">Gunsmith</h4>
            {equippedCount > 0 && (
              <button
                onClick={onReset}
                className="px-2 py-1 text-[10px] font-mono text-text-muted hover:text-negative border border-border rounded transition-colors"
              >
                RESET
              </button>
            )}
          </div>
          {slots.length === 0 ? (
            <div className="text-xs text-text-muted py-6 text-center">No attachments cataloged</div>
          ) : (
            <>
              <div className="flex gap-1.5 overflow-x-auto pb-2 mb-3 -mx-1 px-1">
                {slots.map((slot) => {
                  const active = slot === selectedSlot;
                  const eq = Boolean(equippedBySlot[slot]);
                  return (
                    <button
                      key={slot}
                      type="button"
                      onClick={() => setActiveSlot(slot)}
                      className={
                        'flex-shrink-0 px-3 py-1.5 rounded-md border text-[11px] font-medium font-mono uppercase tracking-wider transition-colors ' +
                        (active
                          ? 'border-tactical-orange text-text-primary bg-tactical-orange/10'
                          : 'border-border text-text-secondary hover:text-text-primary hover:border-border-accent')
                      }
                    >
                      {slot}
                      {eq && <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full align-middle bg-tactical-orange" />}
                    </button>
                  );
                })}
              </div>
              <div className="space-y-1 max-h-[320px] overflow-y-auto pr-1">
                <AttachmentOption
                  active={selectedSlot ? !equippedBySlot[selectedSlot] : true}
                  label="Factory"
                  onClick={() => selectedSlot && onEquip(selectedSlot, null)}
                />
                {activeOptions.map((a) => (
                  <AttachmentOption
                    key={a.id}
                    active={selectedSlot ? equippedBySlot[selectedSlot] === a.id : false}
                    label={a.name}
                    attachment={a}
                    onClick={() => selectedSlot && onEquip(selectedSlot, a.id)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function CompareDock({
  weapons,
  onRemove,
  onOpen,
  onClear,
}: {
  weapons: ComparedWeapon[];
  onRemove: (id: string) => void;
  onOpen: () => void;
  onClear: () => void;
}) {
  return (
    <div className="fixed bottom-3 sm:bottom-4 left-1/2 -translate-x-1/2 z-40 max-w-[calc(100vw-1rem)] sm:max-w-[calc(100vw-2rem)]">
      <div className="bg-bg-card/95 border border-border-accent rounded-lg shadow-2xl flex items-center gap-2 sm:gap-3 p-2 sm:p-2.5 backdrop-blur">
        <span className="hidden sm:inline text-[10px] font-mono uppercase tracking-wider text-text-muted pl-1.5">Compare</span>
        <div className="flex items-center gap-1.5 flex-wrap max-w-[60vw] sm:max-w-md">
          {weapons.map((wp, i) => (
            <button
              key={wp.id}
              onClick={() => onRemove(wp.id)}
              className="group flex items-center gap-1.5 pl-1.5 pr-2 py-1 bg-bg-primary border border-border rounded text-[11px] hover:border-negative/60 transition-colors"
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: COMPARE_PALETTE[i] }} />
              <span className="text-text-primary group-hover:text-negative max-w-[80px] sm:max-w-[120px] truncate">
                {wp.name}
              </span>
              <span className="text-text-muted group-hover:text-negative">×</span>
            </button>
          ))}
        </div>
        <button
          onClick={onOpen}
          className="px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded transition-colors bg-tactical-orange text-bg-primary hover:bg-tactical-orange/90"
        >
          Open
        </button>
        <button
          onClick={onClear}
          className="px-2 py-1.5 text-[11px] font-mono uppercase tracking-wider text-text-muted hover:text-negative transition-colors"
        >
          Clear
        </button>
      </div>
    </div>
  );
}

function CompareOverlay({
  weapons,
  onClose,
  onRemove,
}: {
  weapons: ComparedWeapon[];
  onClose: () => void;
  onRemove: (id: string) => void;
}) {
  const [view, setView] = useState<CompareView>('chart');

  const chartData = useMemo(() => {
    if (weapons.length === 0) return [];
    return Array.from({ length: 121 }, (_, distance) => {
      const row: Record<string, number> = { distance };
      for (const w of weapons) {
        const ttk = ttkAtDistance(w, distance);
        if (ttk !== null) row[w.id] = Math.round(ttk);
      }
      return row;
    });
  }, [weapons]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/70 backdrop-blur-sm p-0 md:p-4"
      onClick={onClose}
    >
      <div
        className="bg-bg-card border border-border-accent rounded-t-xl md:rounded-xl w-full max-w-5xl max-h-[92vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-3 min-w-0">
            <h3 className="font-display text-[20px] tracking-tight text-text-primary">COMPARE</h3>
            <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-text-muted">
              {weapons.length} weapon{weapons.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="inline-flex bg-bg-primary rounded border border-border p-0.5">
              {(['chart', 'table'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={
                    'px-3 py-1 text-[11px] font-mono uppercase tracking-wider rounded transition-colors ' +
                    (view === v ? 'bg-tactical-orange/15 text-tactical-orange' : 'text-text-muted hover:text-text-primary')
                  }
                >
                  {v}
                </button>
              ))}
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded border border-border text-text-muted hover:text-text-primary flex items-center justify-center"
              aria-label="Close"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 px-4 py-3 border-b border-border bg-bg-primary/40">
          {weapons.map((wp, i) => (
            <button
              key={wp.id}
              onClick={() => onRemove(wp.id)}
              className="group flex items-center gap-2 pl-2 pr-2.5 py-1 rounded border border-border bg-bg-card text-[12px] hover:border-negative/60 transition-colors"
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: COMPARE_PALETTE[i] }} />
              <span className="text-text-primary group-hover:text-negative">{wp.name}</span>
              {wp.equippedCount > 0 && (
                <span className="text-text-muted group-hover:text-negative">· {wp.equippedCount}</span>
              )}
              <span className="text-text-muted group-hover:text-negative">×</span>
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {view === 'chart' ? (
            <div className="bg-bg-primary/60 border border-border rounded-lg p-3">
              <div className="text-xs text-text-secondary mb-2">TTK over distance (ms)</div>
              <div className="h-[260px] sm:h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                    <CartesianGrid stroke="rgba(148,163,184,0.1)" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="distance"
                      type="number"
                      domain={[0, 120]}
                      ticks={[0, 10, 20, 35, 50, 75, 100, 120]}
                      stroke="#475569"
                      tick={{ fill: '#94a3b8', fontSize: 11 }}
                      label={{ value: 'distance (m)', position: 'insideBottom', offset: -2, fill: '#64748b', fontSize: 11 }}
                    />
                    <YAxis stroke="#475569" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0a0f1a',
                        border: '1px solid #334155',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      labelStyle={{ color: '#f1f5f9' }}
                      formatter={(value, name) => {
                        const weapon = weapons.find((w) => w.id === name);
                        return [`${value} ms`, weapon?.name ?? String(name)];
                      }}
                      labelFormatter={(v) => `${v} m`}
                    />
                    {weapons.map((w, i) => (
                      <Line
                        key={w.id}
                        type="linear"
                        dataKey={w.id}
                        stroke={COMPARE_PALETTE[i]}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 5 }}
                        isAnimationActive={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <CompareTable weapons={weapons} />
          )}
        </div>
      </div>
    </div>
  );
}

function CompareTable({ weapons }: { weapons: ComparedWeapon[] }) {
  return (
    <div className="space-y-5">
      {COMPARE_SECTIONS.map((section) => {
        const primaryMetric = section.metrics[0];
        const sortedWeapons = [...weapons].sort((a, b) => compareMetricValues(primaryMetric, a, b));
        return (
          <section key={section.title}>
            <div className="flex items-center justify-between gap-3 mb-2">
              <h4 className="text-[10px] uppercase tracking-[0.18em] font-mono text-text-muted">{section.title}</h4>
              <span className="text-[10px] font-mono text-text-muted">sorted by {primaryMetric.label}</span>
            </div>
            <div className="overflow-x-auto rounded border border-border">
              <table className="w-full min-w-[640px] border-collapse text-[12px]">
                <thead>
                  <tr className="bg-bg-primary/70 border-b border-border">
                    <th className="w-[160px] px-3 py-2 text-left font-medium text-text-muted font-mono uppercase tracking-wider text-[10px]">Weapon</th>
                    {section.metrics.map((m) => (
                      <th
                        key={m.id}
                        className="px-3 py-2 text-center font-medium text-text-muted font-mono uppercase tracking-wider text-[10px]"
                      >
                        {m.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedWeapons.map((wp) => (
                    <tr key={wp.id} className="border-b border-border/60 last:border-b-0">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: COMPARE_PALETTE[weapons.findIndex((w) => w.id === wp.id)] }}
                          />
                          <div className="min-w-0">
                            <div className="font-semibold text-text-primary truncate">{wp.name}</div>
                            <div className="text-[10px] text-text-muted truncate">
                              {wp.equippedCount > 0 ? `${wp.equippedCount} equipped` : 'Factory'}
                            </div>
                          </div>
                        </div>
                      </td>
                      {section.metrics.map((m, mi) => {
                        const value = m.getValue(wp);
                        const rank = metricRank(m, wp, weapons);
                        const cls =
                          rank === 0
                            ? mi === 0
                              ? 'bg-tactical-orange/45 text-text-primary font-bold'
                              : 'bg-tactical-orange/20 text-text-primary font-semibold'
                            : rank === 1
                              ? 'bg-tactical-orange/10 text-text-secondary'
                              : 'text-text-secondary';
                        return (
                          <td
                            key={m.id}
                            className={`px-3 py-2 text-center border-l border-border/60 tabular-nums font-mono text-[11px] ${cls}`}
                          >
                            {value === null ? '—' : m.format(value)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Stat({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="px-2.5 py-2 rounded-md bg-bg-primary/60 border border-border">
      <div className="text-[9px] uppercase tracking-[0.14em] text-text-muted font-mono">{label}</div>
      <div className="text-[15px] font-semibold text-text-primary mt-0.5 tabular-nums">
        {value}
        {suffix && <span className="text-[10px] text-text-muted ml-1 font-normal">{suffix}</span>}
      </div>
    </div>
  );
}

function StatBar({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div className="px-2.5 py-2 rounded-md bg-bg-primary/60 border border-border">
      <div className="flex items-baseline justify-between">
        <span className="text-[9px] uppercase tracking-[0.14em] text-text-muted font-mono">{label}</span>
        <span className="text-[11px] text-text-primary font-medium tabular-nums">{value}</span>
      </div>
      <div className="mt-1.5 h-[3px] bg-border rounded-full overflow-hidden">
        <div
          className="h-full bg-tactical-orange rounded-full"
          style={{ width: `${Math.min(100, (value / max) * 100)}%` }}
        />
      </div>
    </div>
  );
}

function AttachmentOption({
  active,
  label,
  attachment,
  onClick,
}: {
  active: boolean;
  label: string;
  attachment?: AttachmentMod;
  onClick: () => void;
}) {
  const modEntries = attachment ? Object.entries(attachment.mods).slice(0, 4) : [];
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'w-full grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-2.5 py-2 rounded-md border text-left transition-colors ' +
        (active
          ? 'border-tactical-orange bg-tactical-orange/10'
          : 'border-transparent bg-bg-primary/60 hover:bg-bg-card-hover hover:border-border-accent')
      }
    >
      <span className={'text-[12px] truncate ' + (active ? 'text-text-primary font-semibold' : 'text-text-secondary')}>
        {label}
      </span>
      {attachment && (
        <div className="flex flex-wrap gap-1 justify-end">
          {attachment.damageProfile && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-info/10 text-info">DMG PROFILE</span>
          )}
          {attachment.rangeMod && (
            <span
              className={
                'px-1.5 py-0.5 rounded text-[9px] font-mono ' +
                (attachment.rangeMod > 1 ? 'bg-positive/10 text-positive' : 'bg-negative/10 text-negative')
              }
            >
              RNG {attachment.rangeMod > 1 ? '+' : ''}{Math.round((attachment.rangeMod - 1) * 100)}%
            </span>
          )}
          {modEntries.map(([k, v]) => (
            <span
              key={k}
              className={
                'px-1.5 py-0.5 rounded text-[9px] font-mono ' +
                (v > 0 ? 'bg-positive/10 text-positive' : 'bg-negative/10 text-negative')
              }
            >
              {formatModKey(k)} {formatModValue(v)}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

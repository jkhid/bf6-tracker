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

// One stripe color per category — left edge accent
const CATEGORY_STRIPE: Record<string, string> = {
  'Assault Rifle': '#f97316',
  'SMG': '#eab308',
  'Carbine': '#84cc16',
  'DMR': '#22d3ee',
  'LMG': '#a855f7',
  'Sniper Rifle': '#ef4444',
  'Pistol': '#94a3b8',
  'Shotgun': '#f59e0b',
};

const COMPARE_PALETTE = ['#f97316', '#eab308', '#22d3ee', '#a855f7', '#22c55e'];
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

function WeaponImage({ name, className }: { name: string; className?: string }) {
  const [idx, setIdx] = useState(0);
  const candidates = useMemo(() => imageUrlCandidates(name), [name]);
  if (idx >= candidates.length) {
    return (
      <div className={`relative flex items-center justify-center text-text-muted/50 ${className ?? ''}`}>
        <svg width="72" height="32" viewBox="0 0 72 32" fill="none" aria-hidden="true">
          <path d="M5 19H35V13H50V17H66V22H45V25H31V22H5V19Z" stroke="currentColor" strokeWidth="2" />
          <path d="M17 19V15H31" stroke="currentColor" strokeWidth="2" />
          <path d="M50 17V10H61V17" stroke="currentColor" strokeWidth="2" />
        </svg>
        <span className="sr-only">{name} image unavailable</span>
      </div>
    );
  }
  return (
    <img
      src={candidates[idx]}
      alt={name}
      className={className}
      onError={() => setIdx((i) => i + 1)}
      loading="lazy"
    />
  );
}

export default function Arsenal() {
  const [data, setData] = useState<{ weapons: Weapon[]; attachmentsByWeapon: Record<string, AttachmentMod[]> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<string>('Assault Rifle');
  const [rangeId, setRangeId] = useState<typeof RANGE_BANDS[number]['id']>('cqc');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [compare, setCompare] = useState<string[]>([]);
  const [showCompare, setShowCompare] = useState(false);
  const [compareView, setCompareView] = useState<CompareView>('chart');
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
      .sort((a, b) => {
        const attachmentsA = data.attachmentsByWeapon[a.name] ?? [];
        const attachmentsB = data.attachmentsByWeapon[b.name] ?? [];
        const calcA = applyAttachments(a, selectedAttachmentsForWeapon(attachmentsA, equipped[a.id]));
        const calcB = applyAttachments(b, selectedAttachmentsForWeapon(attachmentsB, equipped[b.id]));
        const ta = averageTtk(calcA, range) ?? Infinity;
        const tb = averageTtk(calcB, range) ?? Infinity;
        return ta - tb;
      });
  }, [data, category, search, range, equipped]);

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

  const chartData = useMemo(() => {
    if (compareWeapons.length === 0) return [];
    const max = 120;
    return Array.from({ length: max + 1 }, (_, distance) => {
      const row: Record<string, number> = { distance };
      for (const w of compareWeapons) {
        const ttk = ttkAtDistance(w, distance);
        if (ttk !== null) row[w.id] = Math.round(ttk);
      }
      return row;
    });
  }, [compareWeapons]);

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
    <div className="space-y-5">
      {/* Search bar */}
      <div className="relative">
        <svg
          className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
          width="18"
          height="18"
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
          placeholder="Search any weapon..."
          className="w-full pl-11 pr-4 py-3 bg-bg-card border border-border rounded-lg text-text-primary placeholder:text-text-muted focus:border-tactical-orange/60 focus:outline-none transition-colors"
        />
      </div>

      {/* Category pills */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {CATEGORIES.map((c) => {
          const active = c === category;
          return (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={
                'py-2.5 px-3 rounded-lg border text-sm font-medium transition-colors ' +
                (active
                  ? 'bg-bg-card-hover border-tactical-orange/70 text-text-primary'
                  : 'bg-bg-card border-border text-text-secondary hover:border-border-accent hover:text-text-primary')
              }
            >
              {c}
            </button>
          );
        })}
      </div>

      {/* Distance tabs */}
      <div className="flex border-b border-border">
        {RANGE_BANDS.map((b) => {
          const active = b.id === rangeId;
          return (
            <button
              key={b.id}
              onClick={() => setRangeId(b.id)}
              className={
                'flex-1 py-3 text-center text-sm relative transition-colors ' +
                (active ? 'text-tactical-orange' : 'text-text-secondary hover:text-text-primary')
              }
            >
              {b.label}
              {active && <span className="absolute bottom-[-1px] left-0 right-0 h-[2px] bg-tactical-orange" />}
            </button>
          );
        })}
      </div>

      {/* Compare bar */}
      {compare.length > 0 && (
        <div className="border border-tactical-orange/40 bg-tactical-orange/5 rounded-lg overflow-hidden">
          <div className="flex items-center justify-between gap-3 p-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-text-secondary">Comparing</span>
              {compareWeapons.map((w, i) => (
                <button
                  key={w.id}
                  onClick={() => toggleCompare(w.id)}
                  className="flex items-center gap-1.5 pl-1.5 pr-2 py-1 bg-bg-card border border-border rounded-md text-xs hover:border-negative/60 hover:text-negative transition-colors group"
                >
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: COMPARE_PALETTE[i] }} />
                  <span className="text-text-primary group-hover:text-negative">{w.name}</span>
                  {w.equippedCount > 0 && (
                    <span className="text-text-muted group-hover:text-negative">· {w.equippedCount}</span>
                  )}
                  <span className="text-text-muted group-hover:text-negative">×</span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => setShowCompare((v) => !v)}
                className="px-3 py-1.5 text-xs text-text-primary border border-border rounded-md hover:border-tactical-orange/60 transition-colors"
              >
                {showCompare ? 'Hide compare' : 'Open compare'}
              </button>
              <button
                onClick={() => {
                  setCompare([]);
                  setShowCompare(false);
                }}
                className="px-3 py-1.5 text-xs text-text-muted hover:text-negative transition-colors"
              >
                Clear
              </button>
            </div>
          </div>
          {showCompare && compareWeapons.length > 0 && (
            <div className="border-t border-tactical-orange/30 bg-bg-card/40 p-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                <div>
                  <div className="text-xs text-text-secondary">Compare weapons</div>
                  <div className="text-[10px] text-text-muted mt-0.5">
                    Values include currently equipped attachments.
                  </div>
                </div>
                <div className="inline-flex self-start sm:self-auto rounded-md border border-border bg-bg-primary/70 p-0.5">
                  {(['chart', 'table'] as const).map((view) => (
                    <button
                      key={view}
                      type="button"
                      onClick={() => setCompareView(view)}
                      className={
                        'px-3 py-1.5 rounded text-xs font-medium capitalize transition-colors ' +
                        (compareView === view
                          ? 'bg-tactical-orange/15 text-tactical-orange'
                          : 'text-text-secondary hover:text-text-primary')
                      }
                    >
                      {view}
                    </button>
                  ))}
                </div>
              </div>

              {compareView === 'chart' ? (
                <div>
                  <div className="text-xs text-text-secondary mb-2">TTK over distance (ms)</div>
                  <div className="h-[260px]">
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
                            const weapon = compareWeapons.find((w) => w.id === name);
                            return [`${value} ms`, weapon?.name ?? String(name)];
                          }}
                          labelFormatter={(v) => `${v} m`}
                        />
                        {compareWeapons.map((w, i) => (
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
                <CompareTable weapons={compareWeapons} />
              )}
            </div>
          )}
        </div>
      )}

      {/* Weapon rows */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="border border-border rounded-lg p-10 text-center text-text-muted text-sm">
            No weapons match.
          </div>
        )}

        {filtered.map((w) => {
          const expanded = expandedId === w.id;
          const inCompare = compare.includes(w.id);
          const stripe = CATEGORY_STRIPE[w.category] ?? '#f97316';
          const attachments = data.attachmentsByWeapon[w.name] ?? [];
          const selectedAttachments = selectedAttachmentsForWeapon(attachments, equipped[w.id]);
          const calculated = applyAttachments(w, selectedAttachments);
          const ttk = averageTtk(calculated, range);
          return (
            <div
              key={w.id}
              className={
                'border rounded-lg overflow-hidden transition-colors ' +
                (expanded ? 'border-tactical-orange/40 bg-bg-card' : 'border-border bg-bg-card hover:border-border-accent')
              }
            >
              <button
                onClick={() => setExpandedId(expanded ? null : w.id)}
                className="w-full flex items-stretch text-left"
              >
                {/* Left edge stripe */}
                <div className="w-1 flex-shrink-0" style={{ backgroundColor: stripe }} />

                <div className="flex-1 flex items-center gap-4 px-4 py-4">
                  {/* Name + category + chips */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2.5 mb-1.5">
                      <span className="text-base font-semibold text-text-primary tracking-tight">{w.name}</span>
                      <span className="text-xs text-text-muted">{w.category}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="px-2 py-0.5 bg-tactical-orange/15 text-tactical-orange rounded-md font-medium">
                        {attachments.length} Attachments
                      </span>
                      {selectedAttachments.length > 0 && (
                        <span className="px-2 py-0.5 bg-positive/10 text-positive rounded-md font-medium">
                          {selectedAttachments.length} Equipped
                        </span>
                      )}
                      <span className="px-2 py-0.5 bg-bg-primary text-text-secondary rounded-md">
                        {calculated.rpm} RPM
                      </span>
                      <span className="px-2 py-0.5 bg-bg-primary text-text-secondary rounded-md">
                        {calculated.magSize} mag
                      </span>
                    </div>
                  </div>

                  {/* TTK badge */}
                  <div className="px-3 py-2 bg-bg-primary border border-border rounded-md text-right flex-shrink-0">
                    <div className="text-[10px] text-text-muted uppercase tracking-wider">TTK</div>
                    <div className="text-base font-semibold text-tactical-orange leading-none mt-0.5">
                      {ttk !== null ? `${ttk.toFixed(0)}ms` : '—'}
                    </div>
                  </div>

                  {/* Weapon image */}
                  <div className="w-[88px] h-12 flex items-center justify-center flex-shrink-0">
                    <WeaponImage name={w.name} className="max-w-full max-h-full object-contain" />
                  </div>

                  {/* Chevron */}
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className={'text-text-muted transition-transform flex-shrink-0 ' + (expanded ? 'rotate-180' : '')}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
              </button>

              {expanded && (
                <ExpandedDetail
                  calculatedWeapon={calculated}
                  attachments={attachments}
                  equippedBySlot={equipped[w.id] ?? {}}
                  activeRange={range}
                  inCompare={inCompare}
                  onToggleCompare={() => toggleCompare(w.id)}
                  onEquip={(slot, attachmentId) => setEquippedAttachment(w.id, slot, attachmentId)}
                  onReset={() => resetEquipped(w.id)}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="text-[11px] text-text-muted text-center pt-2">
        Weapon data via <a href="https://battlefinity.gg" className="hover:text-tactical-orange" target="_blank" rel="noreferrer">battlefinity.gg</a> · {data.weapons.length} weapons cataloged
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
          <section
            key={section.title}
            className="border-t border-tactical-orange/25 pt-4 first:border-t-0 first:pt-0"
          >
            <div className="flex items-center justify-between gap-3 mb-2">
              <h3 className="text-sm font-semibold text-text-primary">{section.title}</h3>
              <span className="text-[10px] text-text-muted">sorted by {primaryMetric.label}</span>
            </div>
            <div className="overflow-x-auto rounded-lg border border-border bg-bg-primary/40">
              <table className="w-full min-w-[720px] border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border bg-bg-primary/70">
                    <th className="w-[180px] px-3 py-2 text-left font-medium text-text-muted">Gun</th>
                    {section.metrics.map((metric) => (
                      <th key={metric.id} className="px-3 py-2 text-center font-medium text-text-muted">
                        {metric.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedWeapons.map((weapon) => (
                    <tr key={weapon.id} className="border-b border-border/70 last:border-b-0">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: COMPARE_PALETTE[weapons.findIndex((w) => w.id === weapon.id)] }}
                          />
                          <div className="min-w-0">
                            <div className="font-semibold text-text-primary truncate">{weapon.name}</div>
                            <div className="text-[10px] text-text-muted truncate">
                              {weapon.equippedCount > 0 ? `${weapon.equippedCount} equipped` : 'Factory'}
                            </div>
                          </div>
                        </div>
                      </td>
                      {section.metrics.map((metric, metricIndex) => {
                        const value = metric.getValue(weapon);
                        const rank = metricRank(metric, weapon, weapons);
                        const isPrimary = metricIndex === 0;
                        const cellClass =
                          rank === 0
                            ? isPrimary
                              ? 'bg-tactical-orange/45 text-text-primary font-semibold'
                              : 'bg-tactical-orange/25 text-text-primary font-semibold'
                            : rank === 1
                              ? isPrimary
                                ? 'bg-tactical-orange/25 text-text-primary'
                                : 'bg-tactical-orange/10 text-text-secondary'
                              : 'bg-bg-card/35 text-text-secondary';
                        return (
                          <td key={metric.id} className={`px-3 py-2 text-center border-l border-border/60 ${cellClass}`}>
                            {value === null ? '-' : metric.format(value)}
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

function ExpandedDetail({
  calculatedWeapon,
  attachments,
  equippedBySlot,
  activeRange,
  inCompare,
  onToggleCompare,
  onEquip,
  onReset,
}: {
  calculatedWeapon: CalculatedWeapon;
  attachments: AttachmentMod[];
  equippedBySlot: EquippedBySlot;
  activeRange: typeof RANGE_BANDS[number];
  inCompare: boolean;
  onToggleCompare: () => void;
  onEquip: (slot: string, attachmentId: string | null) => void;
  onReset: () => void;
}) {
  const [activeSlot, setActiveSlot] = useState<string | null>(null);
  const attachmentsBySlot = useMemo(() => {
    const map: Record<string, AttachmentMod[]> = {};
    for (const a of attachments) {
      const list = map[a.slot] ?? (map[a.slot] = []);
      list.push(a);
    }
    return map;
  }, [attachments]);
  const slots = Object.keys(attachmentsBySlot).sort((a, b) => a.localeCompare(b));
  const selectedSlot = activeSlot && slots.includes(activeSlot) ? activeSlot : slots[0];
  const activeOptions = selectedSlot ? attachmentsBySlot[selectedSlot] : [];
  const equippedCount = Object.keys(equippedBySlot).length;
  const activeTtk = averageTtk(calculatedWeapon, activeRange);

  return (
    <div className="border-t border-border/60 bg-bg-primary/40">
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_360px] lg:grid-cols-[minmax(0,1fr)_420px] gap-px bg-border/40">
        {/* Stats + damage */}
        <div className="bg-bg-card p-4 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat label="RPM" value={calculatedWeapon.rpm} />
            <Stat label="MAG" value={calculatedWeapon.magSize} />
            <Stat label="BV" value={calculatedWeapon.bv} />
            <Stat label="ADS" value={calculatedWeapon.ads} suffix="ms" />
            <StatBar label="Mobility" value={calculatedWeapon.mobility} max={100} />
            <StatBar label="Control" value={calculatedWeapon.control} max={100} />
            <StatBar label="Hipfire" value={calculatedWeapon.hipfire} max={100} />
            <StatBar label="Precision" value={calculatedWeapon.precision} max={100} />
          </div>

          <div>
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="text-xs text-text-secondary">Damage by range</div>
              <div className="text-xs text-text-muted">
                {activeRange.label} avg <span className="text-tactical-orange font-semibold">{activeTtk !== null ? `${Math.round(activeTtk)}ms` : '-'}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-1.5">
              {calculatedWeapon.damage.slice(0, 5).map((d, i) => {
                const next = calculatedWeapon.damage[i + 1];
                const inBand =
                  activeRange.maxDistance >= d.dropoff && activeRange.minDistance < (next?.dropoff ?? Infinity);
                return (
                  <div
                    key={i}
                    className={
                      'p-2 rounded-md border ' +
                      (inBand
                        ? 'border-tactical-orange/50 bg-tactical-orange/5'
                        : 'border-border bg-bg-primary/60')
                    }
                  >
                    <div className="text-[10px] text-text-muted">≥ {d.dropoff}m</div>
                    <div className="text-sm font-semibold text-text-primary mt-0.5">
                      {d.chest} <span className="text-[10px] text-text-muted font-normal">dmg</span>
                    </div>
                    <div className="text-[10px] text-text-muted mt-0.5">
                      {d.shots_to_kill} shots
                    </div>
                    <div className="text-[10px] text-tactical-orange mt-0.5">
                      {Math.round(d.ttk)}ms
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <button
            onClick={onToggleCompare}
            className={
              'w-full py-2 rounded-md text-sm font-medium transition-colors border ' +
              (inCompare
                ? 'border-tactical-orange/60 bg-tactical-orange/10 text-tactical-orange'
                : 'border-border bg-bg-primary hover:border-tactical-orange/60 text-text-primary')
            }
          >
            {inCompare ? '✓ Added to compare' : 'Add to compare'}
          </button>
        </div>

        {/* Attachments */}
        <div className="bg-bg-card p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <div className="text-xs text-text-secondary">
                Attachment Equipper {attachments.length > 0 && <span className="text-text-muted">· {attachments.length}</span>}
              </div>
              <div className="text-[10px] text-text-muted mt-0.5">
                {equippedCount} equipped across {slots.length} slots
              </div>
            </div>
            {equippedCount > 0 && (
              <button
                onClick={onReset}
                className="px-2.5 py-1.5 text-xs text-text-muted hover:text-negative border border-border rounded-md hover:border-negative/60 transition-colors"
              >
                Reset
              </button>
            )}
          </div>
          {slots.length === 0 && (
            <div className="text-xs text-text-muted py-6 text-center">No attachments cataloged</div>
          )}
          {slots.length > 0 && (
            <div className="space-y-3">
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {slots.map((slot) => {
                  const active = slot === selectedSlot;
                  const equippedSlot = Boolean(equippedBySlot[slot]);
                  return (
                    <button
                      key={slot}
                      type="button"
                      onClick={() => setActiveSlot(slot)}
                      className={
                        'flex-shrink-0 px-3 py-2 rounded-md border text-[11px] font-medium transition-colors ' +
                        (active
                          ? 'border-tactical-orange/70 bg-tactical-orange/10 text-text-primary'
                          : 'border-border bg-bg-primary/60 text-text-secondary hover:text-text-primary hover:border-border-accent')
                      }
                    >
                      {slot}
                      {equippedSlot && <span className="ml-1 text-positive">●</span>}
                    </button>
                  );
                })}
              </div>

              {selectedSlot && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] text-text-muted uppercase tracking-wider">{selectedSlot}</div>
                    <div className="text-[10px] text-text-muted">
                      {equippedBySlot[selectedSlot] ? 'Equipped' : 'Factory'}
                    </div>
                  </div>
                  <div className="space-y-1.5 max-h-[360px] overflow-y-auto pr-1">
                    <AttachmentOption
                      active={!equippedBySlot[selectedSlot]}
                      label="Factory"
                      onClick={() => onEquip(selectedSlot, null)}
                    />
                    {activeOptions.map((a) => (
                      <AttachmentOption
                        key={a.id}
                        active={equippedBySlot[selectedSlot] === a.id}
                        label={a.name}
                        attachment={a}
                        onClick={() => onEquip(selectedSlot, a.id)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="bg-bg-primary/60 rounded-md px-2.5 py-2">
      <div className="text-[10px] text-text-muted uppercase tracking-wider">{label}</div>
      <div className="text-base font-semibold text-text-primary mt-0.5">
        {value}
        {suffix && <span className="text-[10px] text-text-muted ml-1 font-normal">{suffix}</span>}
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
        'w-full min-h-10 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-2.5 py-2 rounded-md border text-left transition-colors ' +
        (active
          ? 'bg-tactical-orange/10 border-tactical-orange/60'
          : 'bg-bg-primary/60 border-transparent hover:border-border-accent hover:bg-bg-card-hover')
      }
    >
      <span className={'text-xs truncate ' + (active ? 'text-text-primary font-semibold' : 'text-text-secondary')}>{label}</span>
      {attachment && (
        <div className="flex flex-wrap gap-1 justify-end">
          {attachment.damageProfile && (
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-info/10 text-info">damage profile</span>
          )}
          {attachment.rangeMod && (
            <span
              className={
                'px-1.5 py-0.5 rounded text-[10px] ' +
                (attachment.rangeMod > 1 ? 'bg-positive/10 text-positive' : 'bg-negative/10 text-negative')
              }
            >
              range {formatModValue(Number(((attachment.rangeMod - 1) * 100).toFixed(1)))}%
            </span>
          )}
          {modEntries.map(([k, v]) => (
            <span
              key={k}
              className={
                'px-1.5 py-0.5 rounded text-[10px] ' +
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

function StatBar({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div className="bg-bg-primary/60 rounded-md px-2.5 py-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] text-text-muted uppercase tracking-wider">{label}</span>
        <span className="text-[11px] text-text-primary font-medium">{value}</span>
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

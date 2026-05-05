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
  damage: DamageEntry[];
}

interface AttachmentMod {
  id: string;
  name: string;
  slot: string;
  mods: Record<string, number>;
}

const RANGE_BANDS = [
  { id: 'cqc', label: '0–10m', maxDistance: 10 },
  { id: 'short', label: '10m–40m', maxDistance: 40 },
  { id: 'mid', label: '40m–80m', maxDistance: 80 },
  { id: 'long', label: '80m–120m', maxDistance: 120 },
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

function ttkAtDistance(weapon: Weapon, distance: number): number | null {
  if (!weapon.damage || weapon.damage.length === 0) return null;
  let chosen = weapon.damage[0];
  for (const d of weapon.damage) {
    if (d.dropoff <= distance) chosen = d;
    else break;
  }
  return chosen.ttk;
}

function imageUrlCandidates(name: string): string[] {
  const safe = name.replace(/\s+/g, '-');
  return [
    `https://assets.codmunity.gg/optimized/300w-${safe}.webp`,
    `https://assets.codmunity.gg/optimized/300w-${safe}_bf6_icon.webp`,
    `https://assets.codmunity.gg/optimized/300w-${name.toLowerCase().replace(/\s+/g, '_')}_bf6_icon.webp`,
  ];
}

function formatModKey(key: string): string {
  return key
    .replace(/_mod$/, '')
    .replace(/_/g, ' ')
    .replace(/\bads\b/i, 'ADS')
    .replace(/\bbv\b/i, 'BV')
    .replace(/\brpm\b/i, 'RPM');
}

function WeaponImage({ name, className }: { name: string; className?: string }) {
  const [idx, setIdx] = useState(0);
  const candidates = useMemo(() => imageUrlCandidates(name), [name]);
  if (idx >= candidates.length) {
    return (
      <div className={`flex items-center justify-center text-text-muted/40 ${className ?? ''}`}>
        <svg width="40" height="20" viewBox="0 0 40 20" fill="none">
          <rect x="2" y="6" width="22" height="6" stroke="currentColor" strokeWidth="1.5" />
          <rect x="24" y="4" width="14" height="10" stroke="currentColor" strokeWidth="1.5" />
          <line x1="0" y1="12" x2="2" y2="12" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
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
        const ta = ttkAtDistance(a, range.maxDistance) ?? Infinity;
        const tb = ttkAtDistance(b, range.maxDistance) ?? Infinity;
        return ta - tb;
      });
  }, [data, category, search, range]);

  const compareWeapons = useMemo(() => {
    if (!data) return [];
    return compare
      .map((id) => data.weapons.find((w) => w.id === id))
      .filter((w): w is Weapon => Boolean(w));
  }, [data, compare]);

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
    const xs = new Set<number>([0, max]);
    for (const w of compareWeapons) {
      for (const d of w.damage) if (d.dropoff <= max) xs.add(d.dropoff);
    }
    return [...xs]
      .sort((a, b) => a - b)
      .map((distance) => {
        const row: Record<string, number> = { distance };
        for (const w of compareWeapons) {
          const ttk = ttkAtDistance(w, distance);
          if (ttk !== null) row[w.name] = Math.round(ttk);
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
                  <span className="text-text-muted group-hover:text-negative">×</span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => setShowCompare((v) => !v)}
                className="px-3 py-1.5 text-xs text-text-primary border border-border rounded-md hover:border-tactical-orange/60 transition-colors"
              >
                {showCompare ? 'Hide chart' : 'View chart'}
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
                      formatter={(value, name) => [`${value} ms`, name as string]}
                      labelFormatter={(v) => `${v} m`}
                    />
                    {compareWeapons.map((w, i) => (
                      <Line
                        key={w.id}
                        type="stepAfter"
                        dataKey={w.name}
                        stroke={COMPARE_PALETTE[i]}
                        strokeWidth={2}
                        dot={{ r: 3, fill: COMPARE_PALETTE[i] }}
                        activeDot={{ r: 5 }}
                        isAnimationActive={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
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
          const ttk = ttkAtDistance(w, range.maxDistance);
          const expanded = expandedId === w.id;
          const inCompare = compare.includes(w.id);
          const stripe = CATEGORY_STRIPE[w.category] ?? '#f97316';
          const attachments = data.attachmentsByWeapon[w.name] ?? [];
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
                      <span className="px-2 py-0.5 bg-bg-primary text-text-secondary rounded-md">
                        {w.rpm} RPM
                      </span>
                      <span className="px-2 py-0.5 bg-bg-primary text-text-secondary rounded-md">
                        {w.magSize} mag
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
                  weapon={w}
                  attachments={attachments}
                  activeRange={range}
                  inCompare={inCompare}
                  onToggleCompare={() => toggleCompare(w.id)}
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

function ExpandedDetail({
  weapon,
  attachments,
  activeRange,
  inCompare,
  onToggleCompare,
}: {
  weapon: Weapon;
  attachments: AttachmentMod[];
  activeRange: typeof RANGE_BANDS[number];
  inCompare: boolean;
  onToggleCompare: () => void;
}) {
  const attachmentsBySlot = useMemo(() => {
    const map: Record<string, AttachmentMod[]> = {};
    for (const a of attachments) {
      const list = map[a.slot] ?? (map[a.slot] = []);
      list.push(a);
    }
    return map;
  }, [attachments]);
  const slots = Object.keys(attachmentsBySlot);

  return (
    <div className="border-t border-border/60 bg-bg-primary/40">
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-px bg-border/40">
        {/* Stats + damage */}
        <div className="bg-bg-card p-4 space-y-4">
          <div className="grid grid-cols-4 gap-2">
            <Stat label="RPM" value={weapon.rpm} />
            <Stat label="MAG" value={weapon.magSize} />
            <Stat label="BV" value={weapon.bv} />
            <Stat label="ADS" value={weapon.ads} suffix="ms" />
            <StatBar label="Mobility" value={weapon.mobility} max={100} />
            <StatBar label="Control" value={weapon.control} max={100} />
            <StatBar label="Hipfire" value={weapon.hipfire} max={100} />
            <StatBar label="Precision" value={weapon.precision} max={100} />
          </div>

          <div>
            <div className="text-xs text-text-secondary mb-2">Damage by range</div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
              {weapon.damage.slice(0, 5).map((d, i) => {
                const next = weapon.damage[i + 1];
                const inBand =
                  activeRange.maxDistance >= d.dropoff && (!next || activeRange.maxDistance < next.dropoff);
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
          <div className="text-xs text-text-secondary mb-2">
            Attachments {attachments.length > 0 && <span className="text-text-muted">· {attachments.length}</span>}
          </div>
          {slots.length === 0 && (
            <div className="text-xs text-text-muted py-6 text-center">No attachments cataloged</div>
          )}
          <div className="space-y-3 max-h-[340px] overflow-y-auto pr-1">
            {slots.map((slot) => (
              <div key={slot}>
                <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1.5">{slot}</div>
                <div className="space-y-1">
                  {attachmentsBySlot[slot].map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-bg-primary/60 rounded-md"
                    >
                      <span className="text-xs text-text-primary truncate">{a.name}</span>
                      <div className="flex flex-wrap gap-1 justify-end">
                        {Object.entries(a.mods).slice(0, 3).map(([k, v]) => {
                          const positive = v > 0;
                          return (
                            <span
                              key={k}
                              className={
                                'px-1.5 py-0.5 rounded text-[10px] ' +
                                (positive ? 'bg-positive/10 text-positive' : 'bg-negative/10 text-negative')
                              }
                            >
                              {formatModKey(k)} {positive ? '+' : ''}
                              {Math.abs(v) < 10 && v % 1 !== 0 ? v.toFixed(2) : v}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
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

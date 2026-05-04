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
  { id: 'cqc', label: '0–10 M', short: 'CQC', maxDistance: 10 },
  { id: 'short', label: '10–40 M', short: 'SHORT', maxDistance: 40 },
  { id: 'mid', label: '40–80 M', short: 'MID', maxDistance: 80 },
  { id: 'long', label: '80–120 M', short: 'LONG', maxDistance: 120 },
] as const;

const CATEGORIES = ['ALL', 'Assault Rifle', 'SMG', 'Carbine', 'DMR', 'LMG', 'Sniper Rifle', 'Pistol', 'Shotgun'];

const COMPARE_PALETTE = ['#ff6b1a', '#d8c8a8', '#8a8f5c', '#3b82f6', '#22c55e'];

type SortKey = 'ttk' | 'rpm' | 'magSize' | 'mobility' | 'control';

function ttkAtDistance(weapon: Weapon, distance: number): number | null {
  if (!weapon.damage || weapon.damage.length === 0) return null;
  // Find the highest dropoff <= distance
  let chosen = weapon.damage[0];
  for (const d of weapon.damage) {
    if (d.dropoff <= distance) chosen = d;
    else break;
  }
  return chosen.ttk;
}

function chartSeriesForWeapon(weapon: Weapon, maxDistance: number) {
  // Build a stepped TTK curve from the dropoff points
  const points: { distance: number; ttk: number }[] = [];
  if (weapon.damage.length === 0) return points;
  for (let i = 0; i < weapon.damage.length; i++) {
    const cur = weapon.damage[i];
    const next = weapon.damage[i + 1];
    const startD = cur.dropoff;
    const endD = next ? next.dropoff : Math.max(maxDistance, startD + 5);
    if (startD > maxDistance) break;
    points.push({ distance: startD, ttk: Math.round(cur.ttk) });
    points.push({ distance: Math.min(endD, maxDistance), ttk: Math.round(cur.ttk) });
  }
  return points;
}

function classCode(category: string): string {
  const map: Record<string, string> = {
    'Assault Rifle': 'AR',
    'SMG': 'SMG',
    'Carbine': 'CBN',
    'DMR': 'DMR',
    'LMG': 'LMG',
    'Sniper Rifle': 'SNR',
    'Pistol': 'PSL',
    'Shotgun': 'SGN',
  };
  return map[category] ?? category.slice(0, 3).toUpperCase();
}

function formatModKey(key: string): string {
  return key
    .replace(/_mod$/, '')
    .replace(/_/g, ' ')
    .replace(/\bads\b/i, 'ADS')
    .replace(/\bbv\b/i, 'BV')
    .replace(/\brpm\b/i, 'RPM')
    .replace(/\bstf\b/i, 'STF')
    .toUpperCase();
}

export default function Arsenal() {
  const [data, setData] = useState<{ weapons: Weapon[]; attachmentsByWeapon: Record<string, AttachmentMod[]> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<string>('ALL');
  const [rangeId, setRangeId] = useState<typeof RANGE_BANDS[number]['id']>('short');
  const [sortKey, setSortKey] = useState<SortKey>('ttk');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [hoverId, setHoverId] = useState<string | null>(null);

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
      .filter((w) => (category === 'ALL' ? true : w.category === category))
      .filter((w) => (search ? w.name.toLowerCase().includes(search.toLowerCase()) : true))
      .filter((w) => w.damage.length > 0)
      .sort((a, b) => {
        if (sortKey === 'ttk') {
          const ta = ttkAtDistance(a, range.maxDistance) ?? Infinity;
          const tb = ttkAtDistance(b, range.maxDistance) ?? Infinity;
          return ta - tb;
        }
        if (sortKey === 'rpm') return b.rpm - a.rpm;
        if (sortKey === 'magSize') return b.magSize - a.magSize;
        if (sortKey === 'mobility') return b.mobility - a.mobility;
        if (sortKey === 'control') return b.control - a.control;
        return 0;
      });
  }, [data, category, search, sortKey, range]);

  const detailWeapon: Weapon | null = useMemo(() => {
    if (!data) return null;
    if (hoverId) return data.weapons.find((w) => w.id === hoverId) ?? null;
    if (selected.length > 0) return data.weapons.find((w) => w.id === selected[0]) ?? null;
    return filtered[0] ?? null;
  }, [data, hoverId, selected, filtered]);

  const selectedWeapons = useMemo(() => {
    if (!data) return [];
    return selected
      .map((id) => data.weapons.find((w) => w.id === id))
      .filter((w): w is Weapon => Boolean(w));
  }, [data, selected]);

  const chartData = useMemo(() => {
    if (selectedWeapons.length === 0) return { points: [], domain: [0, 120] };
    const max = 120;
    // Build a unified set of x-values from all selected weapons' dropoff points
    const xs = new Set<number>();
    xs.add(0);
    xs.add(max);
    for (const w of selectedWeapons) {
      for (const d of w.damage) if (d.dropoff <= max) xs.add(d.dropoff);
    }
    const sortedX = [...xs].sort((a, b) => a - b);
    const points = sortedX.map((distance) => {
      const row: Record<string, number> = { distance };
      for (const w of selectedWeapons) {
        const ttk = ttkAtDistance(w, distance);
        if (ttk !== null) row[w.name] = Math.round(ttk);
      }
      return row;
    });
    return { points, domain: [0, max] as [number, number] };
  }, [selectedWeapons]);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((p) => p !== id);
      if (prev.length >= 5) return [...prev.slice(1), id];
      return [...prev, id];
    });
  }

  if (error) {
    return (
      <div className="border border-tactical-rust/60 bg-tactical-rust/10 p-6 font-mono text-sm text-tactical-rust">
        SIGNAL_LOSS // {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="recon-grid recon-grain border border-border p-8 text-text-muted">
        <div className="font-mono text-xs uppercase tracking-[0.3em]">// loading recon feed</div>
        <div className="mt-4 h-1 w-full skeleton" />
        <div className="mt-3 h-1 w-3/4 skeleton" />
        <div className="mt-3 h-1 w-1/2 skeleton" />
      </div>
    );
  }

  return (
    <div className="recon-reveal">
      {/* Header strip */}
      <div className="flex items-end justify-between mb-6 pb-4 border-b-2 border-tactical-orange/70">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.4em] text-tactical-orange/70">
            // CLASSIFIED INTEL — REDSEC ARSENAL
          </div>
          <h2 className="font-display text-5xl sm:text-6xl text-text-primary leading-none mt-1">
            ARSENAL <span className="text-tactical-orange">/</span> RECON BRIEFING
          </h2>
        </div>
        <div className="hidden sm:flex flex-col items-end gap-1">
          <span className="stamp text-tactical-orange text-[10px]">FOR EYES ONLY</span>
          <span className="font-mono text-[10px] text-text-muted tracking-widest">
            DOC.WPN.{String(filtered.length).padStart(3, '0')} // {data.weapons.length} ENTRIES
          </span>
        </div>
      </div>

      {/* Filters strip */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 mb-6">
        <div className="space-y-3">
          {/* Category buttons */}
          <div className="flex flex-wrap gap-1">
            {CATEGORIES.map((c) => {
              const active = c === category;
              return (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={
                    'px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] font-mono border transition-all ' +
                    (active
                      ? 'bg-tactical-orange text-bg-primary border-tactical-orange'
                      : 'border-border text-text-secondary hover:border-tactical-orange/60 hover:text-tactical-orange')
                  }
                >
                  {c === 'ALL' ? '[ ALL ]' : classCode(c)} <span className="opacity-50">{c !== 'ALL' && c.toLowerCase()}</span>
                </button>
              );
            })}
          </div>

          {/* Range band tabs — styled like an ammo spec gauge */}
          <div className="flex border border-border bg-bg-card/40">
            {RANGE_BANDS.map((b, i) => {
              const active = b.id === rangeId;
              return (
                <button
                  key={b.id}
                  onClick={() => setRangeId(b.id)}
                  className={
                    'flex-1 px-3 py-2 text-left transition-colors border-r border-border last:border-r-0 ' +
                    (active ? 'bg-tactical-orange/10' : 'hover:bg-bg-card-hover')
                  }
                >
                  <div className={'font-mono text-[9px] tracking-widest ' + (active ? 'text-tactical-orange' : 'text-text-muted')}>
                    BAND_{String(i + 1).padStart(2, '0')}
                  </div>
                  <div className={'font-display text-lg leading-none mt-0.5 ' + (active ? 'text-text-primary' : 'text-text-secondary')}>
                    {b.label}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-3 md:items-end">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="QUERY WEAPON ID..."
            className="w-full md:w-64 px-3 py-2 bg-bg-card border border-border focus:border-tactical-orange outline-none font-mono text-xs uppercase tracking-widest text-text-primary placeholder:text-text-muted/60"
          />
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="w-full md:w-64 px-3 py-2 bg-bg-card border border-border focus:border-tactical-orange outline-none font-mono text-xs uppercase tracking-widest text-text-primary"
          >
            <option value="ttk">SORT // TTK ASCENDING</option>
            <option value="rpm">SORT // RPM DESCENDING</option>
            <option value="magSize">SORT // MAG DESCENDING</option>
            <option value="mobility">SORT // MOBILITY</option>
            <option value="control">SORT // CONTROL</option>
          </select>
        </div>
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-6">
        {/* Weapon list */}
        <div className="border border-border bg-bg-card/40 recon-grain">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-bg-card/60">
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-tactical-orange">
              // WEAPONS_TABLE [{range.short}]
            </span>
            <span className="font-mono text-[10px] text-text-muted">{filtered.length} / {data.weapons.length}</span>
          </div>

          <div className="max-h-[640px] overflow-y-auto">
            {filtered.length === 0 && (
              <div className="p-6 text-center text-text-muted font-mono text-xs">// NO MATCHES</div>
            )}
            {filtered.map((w, idx) => {
              const ttk = ttkAtDistance(w, range.maxDistance);
              const isSelected = selected.includes(w.id);
              const isHover = hoverId === w.id;
              const palIdx = selected.indexOf(w.id);
              const swatch = palIdx >= 0 ? COMPARE_PALETTE[palIdx] : null;
              const seq = String(idx + 1).padStart(3, '0');
              return (
                <button
                  key={w.id}
                  onClick={() => toggleSelected(w.id)}
                  onMouseEnter={() => setHoverId(w.id)}
                  onMouseLeave={() => setHoverId(null)}
                  className={
                    'w-full text-left px-3 py-2.5 border-b border-border/60 transition-colors block group ' +
                    (isSelected
                      ? 'bg-tactical-orange/10 hover:bg-tactical-orange/15'
                      : isHover
                      ? 'bg-bg-card-hover'
                      : 'hover:bg-bg-card-hover/60')
                  }
                >
                  <div className="flex items-center gap-3">
                    {/* Sequence + selection swatch */}
                    <div className="flex items-center gap-2 min-w-[58px]">
                      <span className="font-mono text-[10px] text-text-muted">{seq}</span>
                      <span
                        className="w-2 h-2 rounded-full border"
                        style={{
                          backgroundColor: swatch ?? 'transparent',
                          borderColor: swatch ?? 'var(--color-border-accent)',
                        }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="font-display text-lg text-text-primary truncate">{w.name}</span>
                        <span className="font-mono text-[9px] text-text-muted tracking-widest uppercase">
                          [{classCode(w.category)}]
                        </span>
                      </div>
                      <div className="flex items-center gap-3 font-mono text-[10px] text-text-muted uppercase">
                        <span>RPM {w.rpm}</span>
                        <span>·</span>
                        <span>MAG {w.magSize}</span>
                        <span>·</span>
                        <span>BV {w.bv}</span>
                      </div>
                    </div>
                    <div className="text-right min-w-[64px]">
                      <div className="font-display text-2xl leading-none text-tactical-orange">
                        {ttk !== null ? ttk.toFixed(0) : '—'}
                      </div>
                      <div className="font-mono text-[9px] text-text-muted tracking-widest mt-0.5">MS / TTK</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Detail + chart panel */}
        <div className="space-y-6">
          {/* TTK chart */}
          <div className="border border-border bg-bg-card/40 recon-grain">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-bg-card/60">
              <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-tactical-orange">
                // TTK CURVE — DISTANCE VS LETHALITY (MS)
              </span>
              <span className="font-mono text-[10px] text-text-muted">
                COMPARE [{selectedWeapons.length}/5]
              </span>
            </div>
            <div className="p-3">
              {selectedWeapons.length === 0 ? (
                <div className="h-[280px] flex flex-col items-center justify-center font-mono text-xs text-text-muted gap-2">
                  <div className="text-4xl">⌖</div>
                  <div className="tracking-widest uppercase">// SELECT WEAPON ENTRIES TO PLOT</div>
                  <div className="text-[10px] text-text-muted/70">CLICK ROW IN WEAPONS_TABLE</div>
                </div>
              ) : (
                <div className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData.points} margin={{ top: 10, right: 16, left: 4, bottom: 8 }}>
                      <CartesianGrid stroke="rgba(255,107,26,0.08)" strokeDasharray="2 4" />
                      <XAxis
                        dataKey="distance"
                        type="number"
                        domain={chartData.domain}
                        ticks={[0, 10, 20, 35, 50, 75, 100, 120]}
                        stroke="#475569"
                        tick={{ fill: '#94a3b8', fontFamily: 'var(--font-mono)', fontSize: 10 }}
                        label={{
                          value: 'METERS',
                          position: 'insideBottom',
                          offset: -2,
                          fill: '#64748b',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 10,
                        }}
                      />
                      <YAxis
                        stroke="#475569"
                        tick={{ fill: '#94a3b8', fontFamily: 'var(--font-mono)', fontSize: 10 }}
                        label={{
                          value: 'MS',
                          angle: -90,
                          position: 'insideLeft',
                          fill: '#64748b',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 10,
                        }}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#0a0f1a',
                          border: '1px solid #ff6b1a',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 11,
                          textTransform: 'uppercase',
                        }}
                        labelStyle={{ color: '#ff6b1a', letterSpacing: '0.1em' }}
                        formatter={(value, name) => [`${value} ms`, name as string]}
                        labelFormatter={(v) => `RANGE ${v} M`}
                      />
                      {selectedWeapons.map((w, i) => (
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
              )}

              {/* Legend / chips */}
              {selectedWeapons.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-border/60">
                  {selectedWeapons.map((w, i) => (
                    <button
                      key={w.id}
                      onClick={() => toggleSelected(w.id)}
                      className="flex items-center gap-2 px-2 py-1 border border-border hover:border-tactical-rust hover:text-tactical-rust transition-colors group"
                    >
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: COMPARE_PALETTE[i] }} />
                      <span className="font-display text-sm">{w.name}</span>
                      <span className="font-mono text-[10px] text-text-muted group-hover:text-tactical-rust">×</span>
                    </button>
                  ))}
                  {selected.length > 0 && (
                    <button
                      onClick={() => setSelected([])}
                      className="ml-auto px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-text-muted hover:text-tactical-rust"
                    >
                      CLEAR_ALL
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Detail panel */}
          {detailWeapon && (
            <WeaponDetail
              weapon={detailWeapon}
              attachments={data.attachmentsByWeapon[detailWeapon.name] ?? []}
              activeRange={range}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function WeaponDetail({
  weapon,
  attachments,
  activeRange,
}: {
  weapon: Weapon;
  attachments: AttachmentMod[];
  activeRange: typeof RANGE_BANDS[number];
}) {
  const ttkActive = ttkAtDistance(weapon, activeRange.maxDistance);
  const stk = useMemo(() => {
    if (!weapon.damage.length) return null;
    let chosen = weapon.damage[0];
    for (const d of weapon.damage) {
      if (d.dropoff <= activeRange.maxDistance) chosen = d;
      else break;
    }
    return chosen.shots_to_kill;
  }, [weapon, activeRange]);

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
    <div className="border border-border bg-bg-card/40 recon-grain">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-bg-card/60">
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-tactical-orange">
          // DOSSIER — {weapon.name}
        </span>
        <span className="font-mono text-[10px] text-text-muted">[{classCode(weapon.category)}]</span>
      </div>

      <div className="p-4">
        {/* Hero row */}
        <div className="flex items-end justify-between gap-4 pb-4 border-b border-border/60">
          <div>
            <div className="font-mono text-[10px] tracking-widest text-text-muted uppercase">
              {weapon.category} · {weapon.game}
            </div>
            <h3 className="font-display text-4xl text-text-primary leading-none mt-1">{weapon.name}</h3>
          </div>
          <div className="text-right">
            <div className="font-mono text-[10px] tracking-widest text-text-muted uppercase">
              TTK @ {activeRange.label}
            </div>
            <div className="font-display text-5xl text-tactical-orange leading-none">
              {ttkActive !== null ? ttkActive.toFixed(0) : '—'}
              <span className="text-base text-text-muted ml-1 font-mono">MS</span>
            </div>
            <div className="font-mono text-[10px] text-text-muted mt-1 tracking-widest">
              {stk !== null ? `${stk} SHOTS_TO_KILL` : ''}
            </div>
          </div>
        </div>

        {/* Stat grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border/40 mt-4">
          <Stat label="RPM" value={weapon.rpm} />
          <Stat label="MAG" value={weapon.magSize} />
          <Stat label="BV" value={weapon.bv} />
          <Stat label="ADS" value={weapon.ads} suffix="ms" />
          <Stat label="MOBILITY" value={weapon.mobility} max={100} />
          <Stat label="CONTROL" value={weapon.control} max={100} />
          <Stat label="HIPFIRE" value={weapon.hipfire} max={100} />
          <Stat label="PRECISION" value={weapon.precision} max={100} />
        </div>

        {/* Damage profile bands */}
        <div className="mt-5">
          <div className="font-mono text-[10px] uppercase tracking-widest text-text-muted mb-2">
            // DAMAGE PROFILE
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-px bg-border/40">
            {weapon.damage.slice(0, 5).map((d, i) => {
              const active = activeRange.maxDistance >= d.dropoff && (i === weapon.damage.length - 1 || activeRange.maxDistance < (weapon.damage[i + 1]?.dropoff ?? Infinity));
              return (
                <div
                  key={i}
                  className={
                    'p-2 ' + (active ? 'bg-tactical-orange/10 ring-1 ring-tactical-orange/40' : 'bg-bg-card/60')
                  }
                >
                  <div className="font-mono text-[9px] tracking-widest text-text-muted">
                    ≥ {d.dropoff} M
                  </div>
                  <div className="font-display text-xl leading-none text-text-primary mt-0.5">
                    {d.chest}<span className="text-xs text-text-muted ml-0.5">DMG</span>
                  </div>
                  <div className="font-mono text-[10px] text-text-muted mt-1">
                    HEAD {d.head} · STK {d.shots_to_kill}
                  </div>
                  <div className="font-mono text-[10px] text-tactical-orange/80 mt-0.5">
                    TTK {Math.round(d.ttk)} MS
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Attachments */}
        {slots.length > 0 && (
          <div className="mt-5">
            <div className="font-mono text-[10px] uppercase tracking-widest text-text-muted mb-2">
              // FIELD ATTACHMENTS — {attachments.length} CONFIGURED
            </div>
            <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
              {slots.map((slot) => (
                <div key={slot} className="border border-border/60 bg-bg-card/40">
                  <div className="px-2 py-1 border-b border-border/60 flex items-center gap-2">
                    <span className="hatch w-3 h-3 inline-block" />
                    <span className="font-mono text-[10px] uppercase tracking-widest text-tactical-bone">
                      [{slot.toUpperCase()}] · {attachmentsBySlot[slot].length}
                    </span>
                  </div>
                  <div className="divide-y divide-border/40">
                    {attachmentsBySlot[slot].slice(0, 4).map((a) => (
                      <div key={a.id} className="px-2 py-1.5 flex items-center justify-between gap-2">
                        <span className="text-xs text-text-primary truncate">{a.name}</span>
                        <div className="flex flex-wrap gap-1 justify-end">
                          {Object.entries(a.mods).slice(0, 4).map(([k, v]) => {
                            const positive = v > 0;
                            return (
                              <span
                                key={k}
                                className={
                                  'px-1.5 py-0.5 font-mono text-[9px] tracking-wider ' +
                                  (positive ? 'text-positive bg-positive/10' : 'text-tactical-rust bg-tactical-rust/10')
                                }
                              >
                                {formatModKey(k)} {positive ? '+' : ''}
                                {typeof v === 'number' && Math.abs(v) < 10 && v % 1 !== 0 ? v.toFixed(2) : v}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                    {attachmentsBySlot[slot].length > 4 && (
                      <div className="px-2 py-1 font-mono text-[10px] text-text-muted">
                        +{attachmentsBySlot[slot].length - 4} more
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, suffix, max }: { label: string; value: number; suffix?: string; max?: number }) {
  return (
    <div className="bg-bg-card/60 px-3 py-2.5 relative">
      <div className="font-mono text-[9px] tracking-widest text-text-muted uppercase">{label}</div>
      <div className="font-display text-2xl leading-none text-text-primary mt-0.5">
        {value}
        {suffix && <span className="text-sm text-text-muted ml-1 font-mono">{suffix}</span>}
      </div>
      {max !== undefined && (
        <div className="mt-2 h-[2px] bg-border/60 relative overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 bg-tactical-orange"
            style={{ width: `${Math.min(100, (value / max) * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

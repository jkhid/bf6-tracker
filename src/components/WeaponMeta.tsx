'use client';

import { useMemo } from 'react';
import { PlayerData, WeaponStat } from '@/lib/types';
import { formatNumber, parsePercentage } from '@/lib/utils';
import Image from 'next/image';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
} from 'recharts';

interface WeaponMeta {
  weaponName: string;
  type: string;
  image: string;
  altImage: string;
  totalKills: number;
  totalDamage: number;
  avgAccuracy: number;
  avgKpm: number;
  playerCount: number;
  accuracyLeader: { player: string; accuracy: number };
}

const TYPE_COLORS: Record<string, string> = {
  'Assault Rifles': '#ef4444',
  'SMG': '#f59e0b',
  'LMG': '#22c55e',
  'DMR': '#3b82f6',
  'Shotguns': '#a855f7',
  'Snipers': '#ec4899',
  'Pistols': '#64748b',
  'Melee': '#78716c',
};

function getColor(type: string, idx: number): string {
  return TYPE_COLORS[type] || ['#f59e0b', '#3b82f6', '#22c55e', '#ef4444', '#a855f7', '#ec4899'][idx % 6];
}

interface WeaponMetaProps {
  playerData: PlayerData[];
}

export default function WeaponMeta({ playerData }: WeaponMetaProps) {
  const loaded = playerData.filter((p) => p.stats);

  const { weaponMap, typeDistribution } = useMemo(() => {
    const wm = new Map<string, WeaponMeta>();
    const typeDist = new Map<string, number>();

    loaded.forEach((pd) => {
      const weapons = pd.stats?.weapons || [];
      weapons.forEach((w: WeaponStat) => {
        const key = w.weaponName;
        const existing = wm.get(key);
        const acc = parsePercentage(w.accuracy);
        const playerName = pd.player.displayName;

        if (existing) {
          existing.totalKills += w.kills || 0;
          existing.totalDamage += w.damage || 0;
          existing.avgAccuracy = (existing.avgAccuracy * existing.playerCount + acc) / (existing.playerCount + 1);
          existing.avgKpm = (existing.avgKpm * existing.playerCount + (w.killsPerMinute || 0)) / (existing.playerCount + 1);
          existing.playerCount += 1;
          if (acc > existing.accuracyLeader.accuracy) {
            existing.accuracyLeader = { player: playerName, accuracy: acc };
          }
        } else {
          wm.set(key, {
            weaponName: w.weaponName,
            type: w.type,
            image: w.image,
            altImage: w.altImage,
            totalKills: w.kills || 0,
            totalDamage: w.damage || 0,
            avgAccuracy: acc,
            avgKpm: w.killsPerMinute || 0,
            playerCount: 1,
            accuracyLeader: { player: playerName, accuracy: acc },
          });
        }

        const typeKey = w.type || 'Other';
        typeDist.set(typeKey, (typeDist.get(typeKey) || 0) + (w.kills || 0));
      });
    });

    return {
      weaponMap: wm,
      typeDistribution: Array.from(typeDist.entries())
        .map(([name, kills]) => ({ name, kills }))
        .sort((a, b) => b.kills - a.kills),
    };
  }, [loaded]);

  const allWeapons = Array.from(weaponMap.values());
  const mostPopular = [...allWeapons].sort((a, b) => b.totalKills - a.totalKills).slice(0, 10);
  const highestKpm = [...allWeapons]
    .filter((w) => w.totalKills >= 100)
    .sort((a, b) => b.avgKpm - a.avgKpm)
    .slice(0, 10);
  const accuracyLeaders = [...allWeapons]
    .filter((w) => w.totalKills >= 50)
    .sort((a, b) => b.accuracyLeader.accuracy - a.accuracyLeader.accuracy)
    .slice(0, 10);

  if (loaded.length === 0) {
    return <div className="text-center py-12 text-text-muted">Loading weapon data...</div>;
  }

  return (
    <div className="space-y-8">
      {/* Most Popular Weapons */}
      <div className="bg-bg-card border border-border rounded-lg p-5">
        <h3 className="text-sm font-semibold text-accent-gold uppercase tracking-wider mb-4">
          Most Popular Weapons
        </h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={mostPopular} layout="vertical" margin={{ left: 80, right: 20 }}>
              <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <YAxis
                type="category"
                dataKey="weaponName"
                tick={{ fill: '#f1f5f9', fontSize: 11 }}
                width={75}
              />
              <Tooltip
                contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9' }}
                formatter={(value) => [formatNumber(Number(value)), 'Total Kills']}
              />
              <Bar dataKey="totalKills" radius={[0, 4, 4, 0]}>
                {mostPopular.map((entry, i) => (
                  <Cell key={i} fill={getColor(entry.type, i)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Highest KPM & Accuracy side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Highest KPM */}
        <div className="bg-bg-card border border-border rounded-lg p-5">
          <h3 className="text-sm font-semibold text-accent-gold uppercase tracking-wider mb-4">
            Highest KPM (min 100 kills)
          </h3>
          <div className="space-y-2">
            {highestKpm.map((w, i) => (
              <div key={w.weaponName} className="flex items-center gap-3 py-1.5 px-2 rounded hover:bg-bg-card-hover transition-colors">
                <span className="text-xs text-text-muted w-5 font-mono">#{i + 1}</span>
                <div className="w-12 h-6 relative flex-shrink-0">
                  {(w.altImage || w.image) ? (
                    <Image src={w.altImage || w.image} alt={w.weaponName} fill className="object-contain" unoptimized />
                  ) : (
                    <div className="w-full h-full bg-border rounded" />
                  )}
                </div>
                <span className="flex-1 text-sm text-text-primary truncate">{w.weaponName}</span>
                <span className="text-sm font-bold text-accent-gold tabular-nums">{w.avgKpm.toFixed(2)}</span>
              </div>
            ))}
            {highestKpm.length === 0 && <div className="text-xs text-text-muted">Not enough data</div>}
          </div>
        </div>

        {/* Accuracy Leaders */}
        <div className="bg-bg-card border border-border rounded-lg p-5">
          <h3 className="text-sm font-semibold text-accent-gold uppercase tracking-wider mb-4">
            Accuracy Leaders
          </h3>
          <div className="space-y-2">
            {accuracyLeaders.map((w, i) => (
              <div key={w.weaponName} className="flex items-center gap-3 py-1.5 px-2 rounded hover:bg-bg-card-hover transition-colors">
                <span className="text-xs text-text-muted w-5 font-mono">#{i + 1}</span>
                <div className="w-12 h-6 relative flex-shrink-0">
                  {(w.altImage || w.image) ? (
                    <Image src={w.altImage || w.image} alt={w.weaponName} fill className="object-contain" unoptimized />
                  ) : (
                    <div className="w-full h-full bg-border rounded" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-text-primary truncate">{w.weaponName}</div>
                  <div className="text-[10px] text-text-muted">{w.accuracyLeader.player}</div>
                </div>
                <span className="text-sm font-bold text-positive tabular-nums">
                  {w.accuracyLeader.accuracy.toFixed(1)}%
                </span>
              </div>
            ))}
            {accuracyLeaders.length === 0 && <div className="text-xs text-text-muted">Not enough data</div>}
          </div>
        </div>
      </div>

      {/* Weapon Type Distribution */}
      <div className="bg-bg-card border border-border rounded-lg p-5">
        <h3 className="text-sm font-semibold text-accent-gold uppercase tracking-wider mb-4">
          Weapon Type Distribution
        </h3>
        <div className="flex flex-col lg:flex-row items-center gap-6">
          <div className="w-64 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={typeDistribution}
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  innerRadius={50}
                  dataKey="kills"
                  nameKey="name"
                  stroke="#0a0f1a"
                  strokeWidth={2}
                >
                  {typeDistribution.map((entry, i) => (
                    <Cell key={i} fill={getColor(entry.name, i)} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9' }}
                  formatter={(value) => [formatNumber(Number(value)), 'Kills']}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex-1 space-y-2">
            {typeDistribution.map((t, i) => {
              const total = typeDistribution.reduce((s, x) => s + x.kills, 0);
              const pct = total > 0 ? ((t.kills / total) * 100).toFixed(1) : '0';
              return (
                <div key={t.name} className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: getColor(t.name, i) }} />
                  <span className="flex-1 text-sm text-text-primary">{t.name}</span>
                  <span className="text-sm text-text-secondary tabular-nums">{formatNumber(t.kills)}</span>
                  <span className="text-xs text-text-muted tabular-nums w-12 text-right">{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

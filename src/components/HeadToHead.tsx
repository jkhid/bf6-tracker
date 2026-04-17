'use client';

import { useState } from 'react';
import { PlayerData, GameModeStat } from '@/lib/types';
import { parsePercentage, findGameMode } from '@/lib/utils';
import { dicebearUrl } from '@/lib/avatar';
import StatBar from './StatBar';
import ClassChart from './ClassChart';
import Image from 'next/image';

interface HeadToHeadProps {
  playerData: PlayerData[];
}

function getRedSec(pd: PlayerData): GameModeStat | null {
  const stats = pd.stats;
  if (!stats) return null;
  return findGameMode(stats.gameModeGroups, 'gm_granitebr')
    || findGameMode(stats.gameModeGroups, 'gm_granite')
    || null;
}

export default function HeadToHead({ playerData }: HeadToHeadProps) {
  const available = playerData.filter((p) => p.stats && getRedSec(p));
  const [indexA, setIndexA] = useState(0);
  const [indexB, setIndexB] = useState(Math.min(1, available.length - 1));

  if (available.length < 2) {
    return (
      <div className="text-center py-12 text-text-muted">
        Need at least 2 players with RedSec data for comparison.
      </div>
    );
  }

  const playerA = available[indexA];
  const playerB = available[indexB];
  const gmA = getRedSec(playerA)!;
  const gmB = getRedSec(playerB)!;

  const nameA = playerA.player.displayName;
  const nameB = playerB.player.displayName;

  const fmt2 = (v: number) => v.toFixed(2);
  const fmt1 = (v: number) => v.toFixed(1);
  const fmtPct = (v: number) => v.toFixed(1) + '%';
  const fmtInt = (v: number) => Math.round(v).toLocaleString();

  const hsA = parsePercentage(gmA.headshots);
  const hsB = parsePercentage(gmB.headshots);

  const topWeaponA = playerA.stats?.weapons?.length
    ? [...playerA.stats.weapons].sort((a, b) => b.kills - a.kills)[0]
    : null;
  const topWeaponB = playerB.stats?.weapons?.length
    ? [...playerB.stats.weapons].sort((a, b) => b.kills - a.kills)[0]
    : null;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Player selectors */}
      <div className="flex gap-4 items-center justify-center">
        <select
          value={indexA}
          onChange={(e) => setIndexA(Number(e.target.value))}
          className="px-3 py-2 bg-bg-card border border-border rounded-lg text-sm text-text-primary focus:border-accent-gold focus:outline-none"
        >
          {available.map((pd, i) => (
            <option key={i} value={i}>
              {pd.player.displayName}
            </option>
          ))}
        </select>
        <span className="text-accent-gold font-bold text-lg">VS</span>
        <select
          value={indexB}
          onChange={(e) => setIndexB(Number(e.target.value))}
          className="px-3 py-2 bg-bg-card border border-border rounded-lg text-sm text-text-primary focus:border-accent-gold focus:outline-none"
        >
          {available.map((pd, i) => (
            <option key={i} value={i}>
              {pd.player.displayName}
            </option>
          ))}
        </select>
      </div>

      {/* Avatars */}
      <div className="flex justify-between items-center px-8">
        <div className="flex flex-col items-center gap-2">
          <Image src={dicebearUrl(playerA.player.name)} alt={nameA} width={56} height={56} className="rounded-full bg-bg-primary" unoptimized />
          <span className="text-sm font-bold text-text-primary">{nameA}</span>
        </div>
        <div className="flex flex-col items-center gap-2">
          <Image src={dicebearUrl(playerB.player.name)} alt={nameB} width={56} height={56} className="rounded-full bg-bg-primary" unoptimized />
          <span className="text-sm font-bold text-text-primary">{nameB}</span>
        </div>
      </div>

      {/* Core Stats */}
      <div className="bg-bg-card border border-border rounded-lg p-4 divide-y divide-border/50">
        <StatBar label="K/D Ratio" valueA={gmA.killDeath || 0} valueB={gmB.killDeath || 0} nameA={nameA} nameB={nameB} format={fmt2} />
        <StatBar label="KPM" valueA={gmA.kpm || 0} valueB={gmB.kpm || 0} nameA={nameA} nameB={nameB} format={fmt2} />
        <StatBar label="DPM" valueA={gmA.dpm || 0} valueB={gmB.dpm || 0} nameA={nameA} nameB={nameB} format={fmt1} />
        <StatBar label="Win%" valueA={parsePercentage(gmA.winPercent)} valueB={parsePercentage(gmB.winPercent)} nameA={nameA} nameB={nameB} format={fmtPct} />
        <StatBar label="Headshot%" valueA={hsA} valueB={hsB} nameA={nameA} nameB={nameB} format={fmtPct} />
        <StatBar label="Kills" valueA={gmA.kills || 0} valueB={gmB.kills || 0} nameA={nameA} nameB={nameB} format={fmtInt} />
        <StatBar label="Wins" valueA={gmA.wins || 0} valueB={gmB.wins || 0} nameA={nameA} nameB={nameB} format={fmtInt} />
        <StatBar label="Revives" valueA={gmA.revives || 0} valueB={gmB.revives || 0} nameA={nameA} nameB={nameB} format={fmtInt} />
      </div>

      {/* Top Weapon */}
      {(topWeaponA || topWeaponB) && (
        <div className="bg-bg-card border border-border rounded-lg p-4">
          <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3 text-center">
            Top Weapon
          </h4>
          <div className="grid grid-cols-2 gap-4">
            {[topWeaponA, topWeaponB].map((w, i) => (
              <div key={i} className="text-center space-y-2">
                {w ? (
                  <>
                    <div className="w-20 h-10 relative mx-auto">
                      {(w.altImage || w.image) ? (
                        <Image src={w.altImage || w.image} alt={w.weaponName} fill className="object-contain" unoptimized />
                      ) : (
                        <div className="w-full h-full bg-border rounded" />
                      )}
                    </div>
                    <div className="text-sm font-medium text-text-primary">{w.weaponName}</div>
                    <div className="text-xs text-text-secondary">{w.kills.toLocaleString()} kills</div>
                  </>
                ) : (
                  <div className="text-xs text-text-muted">No data</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Class Distribution */}
      <div className="grid grid-cols-2 gap-4">
        {[playerA, playerB].map((pd, i) => (
          <div key={i} className="bg-bg-card border border-border rounded-lg p-4">
            <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2 text-center">
              {i === 0 ? nameA : nameB} Classes
            </h4>
            {pd.stats?.classes ? <ClassChart classes={pd.stats.classes} /> : <div className="text-xs text-text-muted">No data</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

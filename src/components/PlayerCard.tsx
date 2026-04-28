'use client';

import { PlayerData, GameModeStat } from '@/lib/types';
import { parsePercentage, formatNumber, findGameMode } from '@/lib/utils';
import { dicebearUrl } from '@/lib/avatar';
import { CardSkeleton } from './LoadingSkeleton';
import WeaponRow from './WeaponRow';
import VehicleRow from './VehicleRow';
import ClassChart from './ClassChart';
import Image from 'next/image';

function StatItem({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-text-muted uppercase tracking-wider">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${accent ? 'text-accent-gold' : 'text-text-primary'}`}>
        {value}
      </div>
    </div>
  );
}

function ModeRow({ label, mode }: { label: string; mode?: GameModeStat }) {
  if (!mode || !mode.matches) return null;
  return (
    <div className="flex items-center gap-4 text-xs">
      <span className="text-text-muted w-12 font-medium">{label}</span>
      <span className="text-text-primary">K/D: <strong>{mode.killDeath?.toFixed(2)}</strong></span>
      <span className="text-text-primary">Wins: <strong>{mode.wins}</strong></span>
      <span className="text-text-primary">Matches: <strong>{mode.matches}</strong></span>
    </div>
  );
}

interface PlayerCardProps {
  data: PlayerData;
}

export default function PlayerCard({ data }: PlayerCardProps) {
  if (data.loading) return <CardSkeleton />;

  if (data.error || !data.stats) {
    return (
      <div className="bg-bg-card border border-negative/30 rounded-lg p-6">
        <div className="text-negative text-sm font-medium">{data.player.name}</div>
        <div className="text-text-muted text-xs mt-1">{data.error || 'Failed to load stats'}</div>
      </div>
    );
  }

  const stats = data.stats;
  const redsec: GameModeStat | undefined =
    findGameMode(stats.gameModeGroups, 'gm_granitebr')
    || findGameMode(stats.gameModeGroups, 'gm_granite');
  const solo = findGameMode(stats.gameModes, 'gm_graniteSolo');
  const duo = findGameMode(stats.gameModes, 'gm_graniteDuo');
  const squad = findGameMode(stats.gameModes, 'gm_brsquad');

  const topWeapons = [...(stats.weapons || [])]
    .sort((a, b) => (b.kills || 0) - (a.kills || 0))
    .slice(0, 5);

  const topVehicles = [...(stats.vehicles || [])]
    .sort((a, b) => (b.kills || 0) - (a.kills || 0))
    .slice(0, 3);

  const hsPercent = redsec
    ? (redsec.headshots || '0%')
    : stats.headshots || '0%';

  return (
    <div className="bg-bg-card border border-border rounded-lg overflow-hidden hover:border-border-accent transition-colors">
      {/* Header */}
      <div className="p-4 border-b border-border flex items-center gap-3">
        <Image
          src={dicebearUrl(data.player.name)}
          alt={data.player.displayName}
          width={48}
          height={48}
          className="rounded-full bg-bg-primary"
          unoptimized
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold text-text-primary truncate">{data.player.displayName}</h3>
            <span className="text-[10px] uppercase text-text-muted bg-bg-primary px-1.5 py-0.5 rounded flex-shrink-0">
              {data.player.platform === 'xbox' ? 'Xbox' : data.player.platform.toUpperCase()}
            </span>
          </div>
          <div className="flex gap-3 text-xs text-text-secondary">
            <span>{stats.timePlayed}</span>
            <span>Human: {stats.humanPrecentage || 'N/A'}</span>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-5">
        {/* RedSec Overview */}
        {redsec ? (
          <>
            <div>
              <h4 className="text-xs font-semibold text-accent-gold uppercase tracking-wider mb-3">
                RedSec Overview
              </h4>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-x-4 gap-y-3">
                <StatItem label="K/D" value={redsec.killDeath?.toFixed(2)} accent />
                <StatItem label="Kills" value={formatNumber(redsec.kills)} />
                <StatItem label="Deaths" value={formatNumber(redsec.deaths)} />
                <StatItem label="Wins" value={formatNumber(redsec.wins)} />
                <StatItem label="Win%" value={redsec.winPercent || '0%'} />
                <StatItem label="Matches" value={formatNumber(redsec.matches)} />
                <StatItem label="KPM" value={redsec.kpm?.toFixed(2)} />
                <StatItem label="DPM" value={redsec.dpm?.toFixed(1)} />
                <StatItem label="HS%" value={hsPercent} />
                <StatItem label="Revives" value={formatNumber(redsec.revives)} />
                <StatItem label="Repairs" value={formatNumber(redsec.repairs)} />
                <StatItem label="Spots" value={formatNumber(redsec.spots)} />
                <StatItem label="Intel" value={formatNumber(redsec.intelPickups)} />
                <StatItem label="Veh. Destroyed" value={formatNumber(redsec.vehiclesDestroyedWith)} />
                <StatItem label="Obj. Armed" value={formatNumber(redsec.objectivesArmed)} />
                <StatItem label="Obj. Destroyed" value={formatNumber(redsec.objectivesDestroyed)} />
              </div>
            </div>

            {/* Mode Split */}
            {(solo || duo || squad) && (
              <div>
                <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
                  Mode Split
                </h4>
                <div className="space-y-1.5">
                  <ModeRow label="Solo" mode={solo} />
                  <ModeRow label="Duo" mode={duo} />
                  <ModeRow label="Squad" mode={squad} />
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-text-muted text-xs">No RedSec data available</div>
        )}

        {/* Top Weapons */}
        {topWeapons.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
              Top Weapons
            </h4>
            <div className="space-y-1">
              {topWeapons.map((w, i) => (
                <WeaponRow key={w.weaponName} weapon={w} rank={i + 1} />
              ))}
            </div>
          </div>
        )}

        {/* Top Vehicles */}
        {topVehicles.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
              Top Vehicles
            </h4>
            <div className="space-y-1">
              {topVehicles.map((v, i) => (
                <VehicleRow key={v.vehicleName} vehicle={v} rank={i + 1} />
              ))}
            </div>
          </div>
        )}

        {/* Class Breakdown */}
        {stats.classes && stats.classes.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
              Class Breakdown
            </h4>
            <ClassChart classes={stats.classes} />
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

import { WeaponStat } from '@/lib/types';
import { formatNumber, parsePercentage } from '@/lib/utils';
import Image from 'next/image';

interface WeaponRowProps {
  weapon: WeaponStat;
  rank: number;
}

export default function WeaponRow({ weapon, rank }: WeaponRowProps) {
  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded bg-bg-primary/50 hover:bg-bg-card-hover transition-colors">
      <span className="text-xs text-text-muted w-5 text-center font-mono">#{rank}</span>
      <div className="w-14 h-8 relative flex-shrink-0">
        {weapon.altImage || weapon.image ? (
          <Image
            src={weapon.altImage || weapon.image}
            alt={weapon.weaponName}
            fill
            className="object-contain"
            unoptimized
          />
        ) : (
          <div className="w-full h-full bg-border rounded flex items-center justify-center text-[8px] text-text-muted">
            N/A
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-text-primary truncate">{weapon.weaponName}</div>
        <div className="text-[10px] text-text-muted">{weapon.type}</div>
      </div>
      <div className="flex gap-4 text-right text-xs">
        <div>
          <div className="text-text-primary font-semibold">{formatNumber(weapon.kills)}</div>
          <div className="text-text-muted">kills</div>
        </div>
        <div>
          <div className="text-text-primary font-semibold">{weapon.accuracy || '0%'}</div>
          <div className="text-text-muted">acc</div>
        </div>
        <div>
          <div className="text-text-primary font-semibold">
            {parsePercentage(weapon.headshots).toFixed(1)}%
          </div>
          <div className="text-text-muted">hs</div>
        </div>
        <div className="hidden sm:block">
          <div className="text-text-primary font-semibold">{weapon.killsPerMinute?.toFixed(2)}</div>
          <div className="text-text-muted">kpm</div>
        </div>
      </div>
    </div>
  );
}

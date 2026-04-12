'use client';

import { VehicleStat } from '@/lib/types';
import { formatNumber, formatMeters } from '@/lib/utils';
import Image from 'next/image';

interface VehicleRowProps {
  vehicle: VehicleStat;
  rank: number;
}

export default function VehicleRow({ vehicle, rank }: VehicleRowProps) {
  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded bg-bg-primary/50 hover:bg-bg-card-hover transition-colors">
      <span className="text-xs text-text-muted w-5 text-center font-mono">#{rank}</span>
      <div className="w-14 h-8 relative flex-shrink-0">
        {vehicle.image ? (
          <Image
            src={vehicle.image}
            alt={vehicle.vehicleName}
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
        <div className="text-sm font-medium text-text-primary truncate">{vehicle.vehicleName}</div>
        <div className="text-[10px] text-text-muted">{vehicle.type}</div>
      </div>
      <div className="flex gap-4 text-right text-xs">
        <div>
          <div className="text-text-primary font-semibold">{formatNumber(vehicle.kills)}</div>
          <div className="text-text-muted">kills</div>
        </div>
        <div>
          <div className="text-text-primary font-semibold">{formatMeters(vehicle.distanceTraveled)}</div>
          <div className="text-text-muted">dist</div>
        </div>
        <div>
          <div className="text-text-primary font-semibold">{vehicle.timeIn || '0'}</div>
          <div className="text-text-muted">time</div>
        </div>
      </div>
    </div>
  );
}

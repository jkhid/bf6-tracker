'use client';

import { ClassStat } from '@/lib/types';
import { formatSeconds } from '@/lib/utils';

const CLASS_COLORS: Record<string, string> = {
  Assault: '#ef4444',
  Engineer: '#f59e0b',
  Support: '#22c55e',
  Recon: '#3b82f6',
};

interface ClassChartProps {
  classes: ClassStat[];
}

export default function ClassChart({ classes }: ClassChartProps) {
  const filtered = classes.filter((c) => c.className !== 'All');
  const totalSeconds = filtered.reduce((sum, c) => sum + (c.secondsPlayed || 0), 0);
  if (totalSeconds === 0) return <div className="text-text-muted text-xs">No class data</div>;

  return (
    <div className="space-y-2">
      {filtered
        .sort((a, b) => (b.secondsPlayed || 0) - (a.secondsPlayed || 0))
        .map((cls) => {
          const pct = ((cls.secondsPlayed || 0) / totalSeconds) * 100;
          const color = CLASS_COLORS[cls.className] || '#64748b';
          return (
            <div key={cls.className} className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-text-primary font-medium">{cls.className}</span>
                <span className="text-text-secondary">
                  {formatSeconds(cls.secondsPlayed)} ({pct.toFixed(0)}%)
                </span>
              </div>
              <div className="h-2 bg-bg-primary rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, backgroundColor: color }}
                />
              </div>
              <div className="flex gap-3 text-[10px] text-text-muted">
                <span>K/D: {cls.killDeath?.toFixed(2)}</span>
                <span>Kills: {cls.kills}</span>
                <span>KPM: {cls.kpm?.toFixed(2)}</span>
              </div>
            </div>
          );
        })}
    </div>
  );
}

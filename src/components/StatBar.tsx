'use client';

interface StatBarProps {
  label: string;
  valueA: number;
  valueB: number;
  nameA: string;
  nameB: string;
  format?: (v: number) => string;
  higherIsBetter?: boolean;
}

export default function StatBar({
  label,
  valueA,
  valueB,
  nameA,
  nameB,
  format = (v) => v.toFixed(2),
  higherIsBetter = true,
}: StatBarProps) {
  const max = Math.max(valueA, valueB, 0.01);
  const pctA = (valueA / max) * 100;
  const pctB = (valueB / max) * 100;

  const aWins = higherIsBetter ? valueA > valueB : valueA < valueB;
  const bWins = higherIsBetter ? valueB > valueA : valueB < valueA;
  const tie = valueA === valueB;

  return (
    <div className="py-2">
      <div className="text-center text-xs text-text-muted uppercase tracking-wider mb-1">
        {label}
      </div>
      <div className="flex items-center gap-3">
        <div className="flex-1 text-right">
          <span
            className={`text-sm font-bold ${
              aWins ? 'text-accent-gold' : tie ? 'text-text-primary' : 'text-text-secondary'
            }`}
          >
            {format(valueA)}
          </span>
          <div className="flex justify-end mt-1">
            <div
              className={`h-2 rounded-l transition-all ${
                aWins ? 'bg-accent-gold' : 'bg-border-accent'
              }`}
              style={{ width: `${pctA}%` }}
            />
          </div>
        </div>
        <div className="w-px h-8 bg-border" />
        <div className="flex-1 text-left">
          <span
            className={`text-sm font-bold ${
              bWins ? 'text-accent-gold' : tie ? 'text-text-primary' : 'text-text-secondary'
            }`}
          >
            {format(valueB)}
          </span>
          <div className="flex justify-start mt-1">
            <div
              className={`h-2 rounded-r transition-all ${
                bWins ? 'bg-accent-gold' : 'bg-border-accent'
              }`}
              style={{ width: `${pctB}%` }}
            />
          </div>
        </div>
      </div>
      <div className="flex justify-between text-[10px] text-text-muted mt-0.5">
        <span>{nameA}</span>
        <span>{nameB}</span>
      </div>
    </div>
  );
}

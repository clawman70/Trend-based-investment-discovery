import React from 'react';

/**
 * Shared display for returns (Phase D): green/red badge, "+12.3%" or "+4.5 pts", and an
 * italic N/A when the value is missing. Never shows 0 in place of a missing number.
 *
 * unit "pct" = a return in percent. unit "pts" = a difference between two returns
 * (percentage points), e.g. a pick's return minus SPY's.
 */
export function formatSigned(value: number, unit: 'pct' | 'pts' = 'pct'): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${Math.abs(value).toFixed(1)}${unit === 'pct' ? '%' : ' pts'}`;
}

export const ReturnBadge: React.FC<{ value: number | null; unit?: 'pct' | 'pts'; title?: string }> = ({
  value,
  unit = 'pct',
  title,
}) => {
  if (value === null || !Number.isFinite(value)) {
    return (
      <span className="text-zinc-600 italic text-[11px]" title={title}>
        N/A
      </span>
    );
  }
  const tone =
    value > 0
      ? 'text-emerald-400 bg-emerald-950/40 border border-emerald-900/40'
      : value < 0
      ? 'text-rose-400 bg-rose-950/40 border border-rose-900/40'
      : 'text-zinc-300 bg-zinc-900/60 border border-zinc-800';
  return (
    <span className={`px-2 py-0.5 rounded text-[11px] font-bold font-mono whitespace-nowrap ${tone}`} title={title}>
      {formatSigned(value, unit)}
    </span>
  );
};

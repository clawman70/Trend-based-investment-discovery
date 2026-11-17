/**
 * "Show the work" for one company's composite score (Phase C, step 6): what each factor
 * was fed, what it scored, how much weight it carried, and how many points it added.
 * Factors with no data are marked MISSING (they sat at neutral 0.5); convergence with a
 * single thesis is marked OFF (left out of the math).
 */
import React from 'react';
import { FactorContribution, ScoreBreakdown, ScoredCompanyData, ScoreFactorKey } from '../lib/types';
import { FACTOR_KEYS } from '../lib/scoring';

const FACTOR_LABELS: Record<ScoreFactorKey, string> = {
  relevance: 'Trend relevance',
  convergence: 'Multi-thesis overlap',
  valuation: 'Valuation (P/S)',
  health: 'Health (Debt/Equity)',
  growth: 'Revenue growth',
};

/** The raw input behind each factor, as shown to the user. Never invented: N/A when absent. */
function inputLabel(key: ScoreFactorKey, c: ScoredCompanyData): string {
  switch (key) {
    case 'relevance':
      return `${c.relevanceScore || 5}/10 (AI)`;
    case 'convergence':
      return `${c.trendsMatched?.length ?? 0} thesis match${(c.trendsMatched?.length ?? 0) === 1 ? '' : 'es'}`;
    case 'valuation':
      if (typeof c.priceToSales === 'number') return `P/S ${c.priceToSales.toFixed(1)}`;
      return c.preRevenue ? 'No revenue (ranked last)' : 'N/A';
    case 'health':
      if (typeof c.debtToEquity !== 'number') return 'N/A';
      return c.debtToEquity < 0 ? `D/E ${c.debtToEquity.toFixed(2)} (negative equity, ranked last)` : `D/E ${c.debtToEquity.toFixed(2)}`;
    case 'growth':
      return typeof c.revenueGrowthYoY === 'number'
        ? `${c.revenueGrowthYoY >= 0 ? '+' : ''}${c.revenueGrowthYoY.toFixed(1)}% YoY`
        : 'N/A';
  }
}

const STATUS_STYLE: Record<FactorContribution['status'], { label: string; cls: string }> = {
  real: { label: 'REAL DATA', cls: 'text-brand-green border-brand-green/30 bg-brand-green/10' },
  ai: { label: 'AI', cls: 'text-sky-300 border-sky-500/30 bg-sky-500/10' },
  missing: { label: 'MISSING', cls: 'text-brand-yellow border-brand-yellow/30 bg-brand-yellow/10' },
  excluded: { label: 'OFF', cls: 'text-zinc-500 border-zinc-700 bg-zinc-900' },
};

export const CoverageBadge: React.FC<{ coverage: ScoreBreakdown['coverage'] }> = ({ coverage }) => {
  const full = coverage.real === coverage.total;
  const none = coverage.real === 0;
  const cls = full
    ? 'text-brand-green border-brand-green/20 bg-brand-green/5'
    : none
    ? 'text-brand-red border-brand-red/30 bg-brand-red/5'
    : 'text-brand-yellow border-brand-yellow/30 bg-brand-yellow/5';
  return (
    <span
      className={`text-[10px] font-mono font-semibold border px-1.5 py-0.5 rounded ${cls}`}
      title="How many of the three market-data factors (valuation, health, revenue growth) had real data"
    >
      DATA {coverage.real}/{coverage.total}
    </span>
  );
};

export const ScoreBreakdownPanel: React.FC<{ company: ScoredCompanyData }> = ({ company }) => {
  const breakdown = company.scoreBreakdown;
  if (!breakdown) {
    return (
      <div className="text-[11px] text-zinc-500 italic">Score breakdown not available for this row.</div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest font-bold">Score Breakdown:</span>
        <CoverageBadge coverage={breakdown.coverage} />
        <span className="text-[10px] text-zinc-500">
          {breakdown.coverage.real} of {breakdown.coverage.total} market-data factors from real data
        </span>
      </div>
      <table className="text-[11px] font-mono w-full max-w-3xl">
        <thead>
          <tr className="text-zinc-500 text-left">
            <th className="py-1 pr-4 font-semibold">Factor</th>
            <th className="py-1 pr-4 font-semibold">Input</th>
            <th className="py-1 pr-4 font-semibold text-right">Factor score</th>
            <th className="py-1 pr-4 font-semibold text-right">Weight</th>
            <th className="py-1 pr-4 font-semibold text-right">Points</th>
            <th className="py-1 font-semibold">Source</th>
          </tr>
        </thead>
        <tbody>
          {FACTOR_KEYS.map((key) => {
            const f = breakdown.factors[key];
            const style = STATUS_STYLE[f.status];
            return (
              <tr key={key} className={`border-t border-zinc-900 ${f.status === 'excluded' ? 'text-zinc-600' : 'text-zinc-300'}`}>
                <td className="py-1 pr-4">{FACTOR_LABELS[key]}</td>
                <td className="py-1 pr-4">{inputLabel(key, company)}</td>
                <td className="py-1 pr-4 text-right">
                  {f.value === null ? '—' : f.status === 'missing' ? '0.50 (neutral)' : f.value.toFixed(2)}
                </td>
                <td className="py-1 pr-4 text-right">{f.status === 'excluded' ? 'off' : `${f.weightPct.toFixed(0)}%`}</td>
                <td className="py-1 pr-4 text-right">{f.points.toFixed(1)}</td>
                <td className="py-1">
                  <span className={`text-[9px] font-bold border px-1.5 py-0.5 rounded ${style.cls}`}>{style.label}</span>
                </td>
              </tr>
            );
          })}
          <tr className="border-t border-zinc-800 text-brand-green font-bold">
            <td className="py-1 pr-4" colSpan={4}>
              Composite score
            </td>
            <td className="py-1 pr-4 text-right">{company.compositeScore.toFixed(1)}</td>
            <td />
          </tr>
        </tbody>
      </table>
      <p className="text-[10px] text-zinc-500 leading-relaxed max-w-3xl">
        Factor scores run 0 to 1. Valuation, health and revenue growth are ranked against the other companies in this
        result set (best = 1, worst = 0). Missing data sits at a neutral 0.50. The 6-month rally flag is shown for
        context only and is not part of the score.
      </p>
    </div>
  );
};

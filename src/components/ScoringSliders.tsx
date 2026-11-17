import React from 'react';
import { ScoringWeights } from '../lib/types';
import { effectiveWeightShares, isConvergenceActive } from '../lib/scoring';

interface ScoringSlidersProps {
  weights: ScoringWeights;
  onChangeWeights: (weights: ScoringWeights) => void;
  /** Theses that ran this search. With one, convergence is left out of the score (D2). */
  thesesRun: number;
}

const sliders: { key: keyof ScoringWeights; label: string; description: string; color: string }[] = [
  {
    key: 'relevance',
    label: 'Trend Relevance',
    description: "AI's 1-10 fit rating (AI estimate)",
    color: 'accent-emerald-500',
  },
  {
    key: 'convergence',
    label: 'Multi-Thesis Overlap',
    description: 'Share of your theses that found this company',
    color: 'accent-teal-500',
  },
  {
    key: 'growth',
    label: 'Revenue Growth',
    description: 'Revenue YoY, ranked within results (Finnhub)',
    color: 'accent-sky-500',
  },
  {
    key: 'valuation',
    label: 'Valuation (Price/Sales)',
    description: 'Lower P/S ranks higher; no revenue ranks last',
    color: 'accent-amber-500',
  },
  {
    key: 'health',
    label: 'Financial Health (Debt/Equity)',
    description: 'Lower debt ranks higher; negative equity ranks last',
    color: 'accent-indigo-500',
  },
];

export const ScoringSliders: React.FC<ScoringSlidersProps> = ({ weights, onChangeWeights, thesesRun }) => {
  const convergenceActive = isConvergenceActive(thesesRun);
  // The % shown is each factor's real share of the score for this run, so with one thesis
  // the other four visibly absorb convergence's weight.
  const shares = effectiveWeightShares(weights, thesesRun);

  return (
    <div className="bg-brand-secondary/80 backdrop-blur-md border border-brand-border/60 p-6 rounded-xl shadow-2xl relative overflow-hidden transition-all duration-300 hover:border-brand-border">
      <div className="flex items-center justify-between mb-4 border-b border-zinc-900 pb-3">
        <h2 className="text-sm font-bold tracking-wider uppercase text-brand-light flex items-center gap-2">
          <span className="w-1.5 h-3 bg-brand-green rounded-full inline-block animate-pulse" />
          Rank Engine Weights
        </h2>
        <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">Self-Normalizing</span>
      </div>

      <div className="space-y-4">
        {sliders.map((s) => {
          const rawVal = weights[s.key];
          const disabled = s.key === 'convergence' && !convergenceActive;
          const pctVal = Math.round(shares[s.key] * 100);

          return (
            <div key={s.key} className={`space-y-1.5 ${disabled ? 'opacity-40' : ''}`}>
              <div className="flex items-center justify-between text-xs">
                <div>
                  <span className="font-semibold text-zinc-200">{s.label}</span>
                  <span className="block text-[10px] text-zinc-500 leading-none mt-0.5">
                    {disabled ? 'Off: only one thesis ran, so every company would score the same here.' : s.description}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 font-mono">
                  <span className="text-zinc-500 text-[10px]">({rawVal})</span>
                  <span className="text-brand-green font-bold w-10 text-right">{disabled ? 'OFF' : `${pctVal}%`}</span>
                </div>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={rawVal}
                disabled={disabled}
                aria-label={`${s.label} weight`}
                onChange={(e) => onChangeWeights({ ...weights, [s.key]: parseInt(e.target.value) || 0 })}
                className={`w-full h-1 bg-zinc-900 rounded-lg appearance-none ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'} ${s.color}`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

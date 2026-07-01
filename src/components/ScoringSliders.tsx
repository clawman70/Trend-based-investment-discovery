import React from 'react';

interface Weights {
  relevance: number;
  convergence: number;
  valuation: number;
  health: number;
}

interface ScoringSlidersProps {
  weights: Weights;
  onChangeWeights: (weights: Weights) => void;
}

export const ScoringSliders: React.FC<ScoringSlidersProps> = ({
  weights,
  onChangeWeights,
}) => {
  const sum = weights.relevance + weights.convergence + weights.valuation + weights.health || 1;

  const handleSliderChange = (key: keyof Weights, value: number) => {
    onChangeWeights({
      ...weights,
      [key]: value,
    });
  };

  const getPercentage = (val: number) => {
    return Math.round((val / sum) * 100);
  };

  const sliders = [
    {
      key: 'relevance' as const,
      label: 'Trend Relevance',
      description: 'Strength of AI alignment rationale',
      color: 'accent-emerald-500',
    },
    {
      key: 'convergence' as const,
      label: 'Multi-Trend Convergence',
      description: 'Overlap frequency across different theses',
      color: 'accent-teal-500',
    },
    {
      key: 'valuation' as const,
      label: 'Valuation (P/E)',
      description: 'Sensible P/E ratios and pricing tiers',
      color: 'accent-amber-500',
    },
    {
      key: 'health' as const,
      label: 'Data Integrity',
      description: 'Availability of live pricing data',
      color: 'accent-indigo-500',
    },
  ];

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
          const pctVal = getPercentage(rawVal);

          return (
            <div key={s.key} className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <div>
                  <span className="font-semibold text-zinc-200">{s.label}</span>
                  <span className="block text-[10px] text-zinc-500 leading-none mt-0.5">{s.description}</span>
                </div>
                <div className="flex items-center gap-1.5 font-mono">
                  <span className="text-zinc-500 text-[10px]">({rawVal})</span>
                  <span className="text-brand-green font-bold w-10 text-right">{pctVal}%</span>
                </div>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={rawVal}
                onChange={(e) => handleSliderChange(s.key, parseInt(e.target.value) || 0)}
                className={`w-full h-1 bg-zinc-900 rounded-lg appearance-none cursor-pointer ${s.color}`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

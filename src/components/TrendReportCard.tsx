import React from 'react';
import { TrendAnalysis } from '@/lib/types';
import { ShieldAlert, Zap, TrendingUp, Calendar, Layers } from './icons';

interface TrendReportCardProps {
  trend: string;
  analysis: TrendAnalysis;
  onSelectAdjacentTrend: (trend: string) => void;
}

export const TrendReportCard: React.FC<TrendReportCardProps> = ({
  trend,
  analysis,
  onSelectAdjacentTrend,
}) => {
  const getMaturityStyle = (stage: TrendAnalysis['maturityStage']) => {
    switch (stage) {
      case 'Nascent':
        return 'text-sky-400 bg-sky-950/40 border-sky-800/80 shadow-[0_0_10px_rgba(56,189,248,0.1)]';
      case 'Emerging':
        return 'text-teal-400 bg-teal-950/40 border-teal-800/80 shadow-[0_0_10px_rgba(45,212,191,0.1)]';
      case 'Growth':
        return 'text-emerald-400 bg-emerald-950/40 border-emerald-800/80 shadow-[0_0_10px_rgba(52,211,153,0.15)]';
      case 'Established':
        return 'text-blue-400 bg-blue-950/40 border-blue-800/80 shadow-[0_0_10px_rgba(96,165,250,0.1)]';
      case 'Declining':
        return 'text-rose-400 bg-rose-950/40 border-rose-800/80 shadow-[0_0_10px_rgba(251,113,133,0.1)]';
      default:
        return 'text-zinc-400 bg-zinc-900 border-zinc-800';
    }
  };

  return (
    <div className="border border-zinc-800 bg-zinc-950 p-5 rounded-lg shadow-2xl transition-all duration-300 hover:border-zinc-700">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between border-b border-zinc-900 pb-4 mb-4 gap-3">
        <div>
          <span className="text-[10px] uppercase font-mono tracking-widest text-zinc-500">Trend Report Card</span>
          <h3 className="text-lg font-bold text-zinc-100 font-sans tracking-tight">{trend}</h3>
        </div>
        <div className={`px-3 py-1 rounded border text-xs font-mono font-bold uppercase tracking-wider ${getMaturityStyle(analysis.maturityStage)}`}>
          {analysis.maturityStage} Stage
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-5">
        {/* TAM & Timeline */}
        <div className="space-y-4">
          <div className="bg-zinc-900/30 border border-zinc-900 p-3.5 rounded-md hover:bg-zinc-900/50 transition-colors">
            <div className="flex items-center gap-2 text-zinc-400 mb-1.5">
              <TrendingUp className="w-4 h-4 text-emerald-500" />
              <span className="text-xs font-mono uppercase tracking-wider font-semibold">Estimated TAM</span>
            </div>
            <p className="text-sm font-sans font-medium text-zinc-200">{analysis.estimatedTAM}</p>
          </div>

          <div className="bg-zinc-900/30 border border-zinc-900 p-3.5 rounded-md hover:bg-zinc-900/50 transition-colors">
            <div className="flex items-center gap-2 text-zinc-400 mb-1.5">
              <Calendar className="w-4 h-4 text-sky-500" />
              <span className="text-xs font-mono uppercase tracking-wider font-semibold">Time Horizon</span>
            </div>
            <p className="text-sm font-sans font-medium text-zinc-200">{analysis.timeHorizon}</p>
          </div>
        </div>

        {/* Key Catalysts */}
        <div className="bg-zinc-900/30 border border-zinc-900 p-4 rounded-md hover:bg-zinc-900/50 transition-colors">
          <div className="flex items-center gap-2 text-zinc-400 mb-3">
            <Zap className="w-4 h-4 text-amber-500 animate-pulse" />
            <span className="text-xs font-mono uppercase tracking-wider font-semibold">Key Catalysts</span>
          </div>
          <ul className="space-y-2">
            {analysis.catalysts.map((catalyst, idx) => (
              <li key={idx} className="flex items-start gap-2 text-xs text-zinc-300">
                <span className="text-amber-500 font-mono mt-0.5">•</span>
                <span className="font-sans leading-relaxed">{catalyst}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Key Risks */}
        <div className="bg-zinc-900/30 border border-zinc-900 p-4 rounded-md hover:bg-zinc-900/50 transition-colors">
          <div className="flex items-center gap-2 text-zinc-400 mb-3">
            <ShieldAlert className="w-4 h-4 text-rose-500" />
            <span className="text-xs font-mono uppercase tracking-wider font-semibold">Key Risks</span>
          </div>
          <ul className="space-y-2">
            {analysis.risks.map((risk, idx) => (
              <li key={idx} className="flex items-start gap-2 text-xs text-zinc-300">
                <span className="text-rose-500 font-mono mt-0.5">!</span>
                <span className="font-sans leading-relaxed">{risk}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Adjacent Trends */}
      <div className="border-t border-zinc-900 pt-4">
        <div className="flex items-center gap-2 text-zinc-500 mb-2">
          <Layers className="w-3.5 h-3.5" />
          <span className="text-[10px] font-mono uppercase tracking-wider">Explore Adjacent Trends</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {analysis.adjacentTrends.map((adjTrend, idx) => (
            <button
              key={idx}
              onClick={() => onSelectAdjacentTrend(adjTrend)}
              className="px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 text-[11px] font-mono text-zinc-400 hover:text-emerald-400 hover:border-emerald-800/80 hover:bg-emerald-950/20 transition-all cursor-pointer"
            >
              + {adjTrend}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

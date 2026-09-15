import React, { useState } from 'react';
import { TrendResearchReport } from '@/lib/types';

interface ResearchReportProps {
  report: TrendResearchReport & { scanId: string };
  onLoadThesis: (thesis: string) => void;
}

export const ResearchReport: React.FC<ResearchReportProps> = ({ report, onLoadThesis }) => {
  const [expandedTheses, setExpandedTheses] = useState<Record<number, boolean>>({ 0: true }); // Expand first by default
  const [isLoadingLoad, setIsLoadingLoad] = useState<string | null>(null);

  const toggleThesis = (idx: number) => {
    setExpandedTheses(prev => ({
      ...prev,
      [idx]: !prev[idx]
    }));
  };

  const getConvergenceBadgeStyle = (type: string) => {
    switch (type) {
      case 'demand_supply':
        return 'bg-purple-950/40 text-purple-400 border border-purple-900/60';
      case 'parallel_growth':
        return 'bg-cyan-950/40 text-cyan-400 border border-cyan-900/60';
      case 'regulatory_catalyst':
        return 'bg-amber-950/40 text-amber-400 border border-amber-900/60';
      case 'technology_enablement':
        return 'bg-brand-green/10 text-brand-green border border-brand-green/20';
      default:
        return 'bg-zinc-950/40 text-zinc-400 border border-zinc-900/60';
    }
  };

  const getMaturityStyle = (maturity: string) => {
    switch (maturity) {
      case 'Nascent':
        return 'text-rose-400 border border-rose-900/40 bg-rose-950/10';
      case 'Pre-emergence':
        return 'text-amber-400 border border-amber-900/40 bg-amber-950/10';
      case 'Early emergence':
        return 'text-brand-green border border-brand-green/30 bg-brand-green/5';
      default:
        return 'text-zinc-400 border border-zinc-900/40 bg-zinc-950/10';
    }
  };

  const getConfidenceStyle = (conf: string) => {
    switch (conf) {
      case 'High':
        return 'text-brand-green border border-brand-green/30 bg-brand-green/5';
      case 'Medium':
        return 'text-cyan-400 border border-cyan-900/40 bg-cyan-950/10';
      case 'Speculative':
        return 'text-purple-400 border border-purple-900/40 bg-purple-950/10';
      default:
        return 'text-zinc-400 border border-zinc-900/40 bg-zinc-950/10';
    }
  };

  const getSourceTypeStyle = (type: string) => {
    switch (type) {
      case 'research_paper': return 'bg-sky-950/20 text-sky-400 border border-sky-900/30';
      case 'patent': return 'bg-purple-950/20 text-purple-400 border border-purple-900/30';
      case 'government': return 'bg-amber-950/20 text-amber-400 border border-amber-900/30';
      case 'news': return 'bg-zinc-800 text-zinc-300 border border-zinc-700';
      default: return 'bg-zinc-900 text-zinc-400 border border-zinc-800';
    }
  };

  const getMarketCapStyle = (tier: string) => {
    switch (tier) {
      case 'micro': return 'bg-rose-950/30 text-rose-400 border border-rose-900/40';
      case 'small': return 'bg-amber-950/30 text-amber-400 border border-amber-900/40';
      case 'mid': return 'bg-cyan-950/30 text-cyan-400 border border-cyan-900/40';
      case 'large': return 'bg-emerald-950/30 text-emerald-400 border border-emerald-900/40';
      default: return 'bg-zinc-950 text-zinc-400 border border-zinc-900';
    }
  };

  const handleLoadClick = async (thesisStatement: string) => {
    setIsLoadingLoad(thesisStatement);
    try {
      // Log thesis load event to DB
      await fetch('/api/research/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scanId: report.scanId,
          thesis: thesisStatement
        })
      });
      onLoadThesis(thesisStatement);
    } catch (err) {
      console.warn('Failed to log loaded thesis event:', err);
      onLoadThesis(thesisStatement); // Proceed anyway
    } finally {
      setIsLoadingLoad(null);
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto space-y-6">
      {/* Executive Summary Card */}
      <div className="bg-brand-secondary border border-brand-border p-6 rounded-2xl space-y-3">
        <div className="flex justify-between items-center border-b border-zinc-900 pb-3">
          <h3 className="text-xs font-mono font-bold text-zinc-400 tracking-wider">EXECUTIVE CONVERGENCE REPORT</h3>
          <span className="text-[10px] font-mono text-zinc-500">SCAN DATE: {report.scanDate}</span>
        </div>
        <div className="text-xs text-zinc-300 leading-relaxed font-sans whitespace-pre-line">
          {report.executiveSummary}
        </div>
        <div className="flex flex-wrap gap-1.5 pt-2">
          <span className="text-[10px] font-mono text-zinc-500 py-0.5 mr-1.5">Domains Scanned:</span>
          {report.domainsScanned.map((dom, i) => (
            <span key={i} className="text-[10px] font-mono bg-zinc-950 text-zinc-400 px-2 py-0.5 rounded border border-zinc-900">
              {dom}
            </span>
          ))}
        </div>
      </div>

      {/* Main Theses Layout */}
      <div className="space-y-4">
        <h4 className="text-xs font-mono font-bold text-brand-green tracking-wider uppercase pl-2">
          Candidate Convergence Theses
        </h4>

        {report.candidateTheses.map((thesis, idx) => {
          const isExpanded = !!expandedTheses[idx];
          const isL = isLoadingLoad === thesis.thesisStatement;

          return (
            <div
              key={idx}
              className="bg-brand-secondary border border-brand-border rounded-2xl overflow-hidden transition-all duration-200"
            >
              {/* Header/Summary Line */}
              <div
                onClick={() => toggleThesis(idx)}
                className="p-5 flex justify-between items-center gap-4 hover:bg-zinc-900/10 cursor-pointer select-none"
              >
                <div className="space-y-2 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-[9px] font-mono px-2 py-0.5 rounded uppercase font-bold tracking-wider ${getConvergenceBadgeStyle(thesis.convergenceType)}`}>
                      {thesis.convergenceType.replace('_', ' ')}
                    </span>
                    <span className={`text-[9px] font-mono px-2 py-0.5 rounded border ${getMaturityStyle(thesis.maturity)}`}>
                      {thesis.maturity}
                    </span>
                    <span className={`text-[9px] font-mono px-2 py-0.5 rounded border ${getConfidenceStyle(thesis.confidence)}`}>
                      CONF: {thesis.confidence}
                    </span>
                  </div>
                  <h5 className="text-sm font-bold text-brand-text font-sans tracking-wide leading-relaxed">
                    {thesis.thesisStatement}
                  </h5>
                </div>
                <div className="shrink-0 flex items-center gap-4">
                  <span className="text-xs font-mono text-zinc-500 transition-transform">
                    {isExpanded ? '[COLLAPSE -]' : '[EXPAND +]'}
                  </span>
                </div>
              </div>

              {/* Expandable Details Container */}
              {isExpanded && (
                <div className="border-t border-zinc-900/60 p-5 bg-zinc-950/20 space-y-4">
                  {/* Rationale Block */}
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest font-bold block">
                      Thesis Rationale
                    </span>
                    <p className="text-xs text-zinc-300 font-sans leading-relaxed">
                      {thesis.rationale}
                    </p>
                  </div>

                  {/* Recency Signal & Domains Involved Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                    <div className="space-y-1">
                      <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest font-bold block">
                        Recency Catalyst (Last 30 Days)
                      </span>
                      <p className="text-xs text-zinc-300 font-mono">
                        {thesis.recencySignal}
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest font-bold block">
                        Domains Mapped
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {thesis.domainsInvolved.map((dom, i) => (
                          <span key={i} className="text-[10px] font-mono bg-zinc-950 text-zinc-400 px-2.5 py-0.5 rounded border border-zinc-900">
                            {dom}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Sources List */}
                  <div className="space-y-2 border-t border-zinc-900/40 pt-4">
                    <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest font-bold block">
                      Grounded Source Citations
                    </span>
                    <div className="space-y-2">
                      {thesis.sources.map((src, i) => (
                        <div key={i} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 rounded-lg bg-zinc-950 border border-zinc-900 font-mono text-[11px]">
                          <div className="flex items-start sm:items-center gap-2">
                            <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase font-bold ${getSourceTypeStyle(src.sourceType)}`}>
                              {src.sourceType.replace('_', ' ')}
                            </span>
                            <a
                              href={src.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-zinc-200 hover:text-brand-green hover:underline line-clamp-1 leading-normal font-sans"
                            >
                              {src.title}
                            </a>
                          </div>
                          <span className="text-zinc-500 text-[10px] shrink-0 font-mono pl-6 sm:pl-0">
                            📅 {src.date}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Action Bar */}
                  <div className="flex justify-end border-t border-zinc-900/40 pt-4">
                    <button
                      onClick={() => handleLoadClick(thesis.thesisStatement)}
                      disabled={isL}
                      className={`font-mono text-xs font-bold py-2 px-4 rounded border transition cursor-pointer ${
                        isL
                          ? 'bg-zinc-900 border-zinc-800 text-zinc-500 cursor-not-allowed'
                          : 'bg-brand-green/10 border-brand-green/20 hover:bg-brand-green/20 text-brand-green hover:border-brand-green/30'
                      }`}
                    >
                      {isL ? 'LOADING THESIS...' : 'LOAD INTO DISCOVERY →'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Mentioned Companies & Adjacent Signals Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Companies Mentioned */}
        <div className="lg:col-span-2 bg-brand-secondary border border-brand-border p-6 rounded-2xl space-y-4">
          <h4 className="text-xs font-mono font-bold text-zinc-400 tracking-wider uppercase border-b border-zinc-900 pb-3">
            Public Companies Mentioned
          </h4>

          {report.companiesMentioned.length === 0 ? (
            <p className="text-xs text-zinc-500 font-mono">No specific public tickers referenced in source material.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-[11px] border-collapse">
                <thead>
                  <tr className="border-b border-zinc-900/60 text-zinc-500">
                    <th className="py-2 font-bold uppercase tracking-wider">Company</th>
                    <th className="py-2 font-bold uppercase tracking-wider">Market Cap</th>
                    <th className="py-2 font-bold uppercase tracking-wider text-center">6M Rally &gt;30%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-900/40">
                  {report.companiesMentioned.map((comp, idx) => (
                    <tr key={idx} className="group hover:bg-zinc-950/20">
                      <td className="py-3 pr-4">
                        <div className="font-bold text-zinc-200">{comp.name}</div>
                        <div className="text-[10px] text-zinc-500 mt-0.5">{comp.ticker}</div>
                        <p className="text-[10px] text-zinc-400 leading-relaxed font-sans mt-1">
                          {comp.context}
                        </p>
                      </td>
                      <td className="py-3 align-top whitespace-nowrap">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${getMarketCapStyle(comp.marketCapTier)}`}>
                          {comp.marketCapTier}
                        </span>
                      </td>
                      <td className="py-3 align-top text-center whitespace-nowrap">
                        {comp.recentRally === null ? (
                          <span className="inline-block text-zinc-500 font-bold bg-zinc-950/40 border border-zinc-800 rounded px-1.5 py-0.5 text-[9px] tracking-wide">
                            N/A
                          </span>
                        ) : comp.recentRally ? (
                          <span className="inline-block text-rose-500 font-bold bg-rose-950/20 border border-rose-900/40 rounded px-1.5 py-0.5 text-[9px] tracking-wide">
                            ⚠️ YES (Priced In?)
                          </span>
                        ) : (
                          <span className="inline-block text-brand-green font-bold bg-brand-green/5 border border-brand-green/20 rounded px-1.5 py-0.5 text-[9px] tracking-wide">
                            ✓ NO (Undervalued)
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Adjacent Weak Signals */}
        <div className="bg-brand-secondary border border-brand-border p-6 rounded-2xl space-y-4">
          <h4 className="text-xs font-mono font-bold text-zinc-400 tracking-wider uppercase border-b border-zinc-900 pb-3">
            Adjacent Weak Signals
          </h4>
          <ul className="space-y-3 font-sans text-xs text-zinc-300 leading-relaxed">
            {report.adjacentSignals.map((signal, idx) => (
              <li key={idx} className="flex gap-2.5 items-start p-2.5 rounded-lg bg-zinc-950/40 border border-zinc-900/40">
                <span className="text-brand-green font-mono text-[10px] pt-0.5 shrink-0">⚡</span>
                <span>{signal}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};

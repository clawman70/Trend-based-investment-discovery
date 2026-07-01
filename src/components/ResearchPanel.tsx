import React, { useState, useEffect } from 'react';
import { TrendResearchReport } from '@/lib/types';

interface DomainConfig {
  id: string;
  name: string;
  description: string;
  icon: string;
}

const RESEARCH_DOMAINS: DomainConfig[] = [
  { id: 'biotech', name: 'Biotech & Life Sciences', description: 'Gene therapy, synthetic biology, personalized medicine', icon: '🧬' },
  { id: 'energy', name: 'Energy & Power Systems', description: 'SMRs, fusion, grid storage, hydrogen, geothermal', icon: '⚡' },
  { id: 'materials', name: 'Materials & Manufacturing', description: 'Metamaterials, 3D printing, nanotechnology, composites', icon: '🏗️' },
  { id: 'quantum', name: 'Quantum Technologies', description: 'Quantum computing, sensing, post-quantum crypto', icon: '⚛️' },
  { id: 'ai', name: 'Artificial Intelligence', description: 'Foundation models, agentic AI, embodied physical systems', icon: '🧠' },
  { id: 'semiconductors', name: 'Semiconductors & Compute', description: 'Advanced packaging, custom silicon, RISC-V, chiplets', icon: '💾' },
  { id: 'robotics', name: 'Robotics & Physical AI', description: 'Humanoid robotics, autonomous vehicles, drone swarms', icon: '🤖' },
  { id: 'space', name: 'Space & Satellites', description: 'Low-earth orbit mega-constellations, space manufacturing', icon: '🛰️' },
  { id: 'defense', name: 'Defense & National Security', description: 'Autonomous defense, dual-use technology, directed energy', icon: '🛡️' },
  { id: 'climate', name: 'Climate & Sustainability', description: 'Carbon capture, industrial decarbonization, circular platforms', icon: '🌱' },
  { id: 'connectivity', name: 'Edge & Connectivity', description: '5G/6G, satellite-terrestrial networks, edge computing', icon: '📡' },
  { id: 'medtech', name: 'Digital Health & Medtech', description: 'Wearable diagnostics, remote monitoring, surgical robots', icon: '🩺' },
  { id: 'fintech', name: 'Fintech & Digital Assets', description: 'Tokenization of real-world assets, DeFi infrastructure', icon: '💳' },
  { id: 'agtech', name: 'Water & Agriculture Tech', description: 'Precision agriculture, soil health, water purification', icon: '🌾' }
];

const PROGRESS_MESSAGES = [
  "Scanning patent databases & research publications...",
  "Extracting cross-domain intersections...",
  "Running 30-day recency filters & 180-day consensus exclusions...",
  "Checking for Dual-Use crossovers and demand multipliers...",
  "Synthesizing investment theses and source citations...",
  "Formatting structural convergence reports..."
];

interface ResearchPanelProps {
  onReportGenerated: (report: TrendResearchReport & { scanId: string }) => void;
}

export const ResearchPanel: React.FC<ResearchPanelProps> = ({ onReportGenerated }) => {
  const [mode, setMode] = useState<'guided' | 'open'>('guided');
  const [selectedDomains, setSelectedDomains] = useState<string[]>([]);
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [progressIdx, setProgressIdx] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isLoading) {
      setProgressIdx(0);
      interval = setInterval(() => {
        setProgressIdx((prev) => (prev < PROGRESS_MESSAGES.length - 1 ? prev + 1 : prev));
      }, 3500);
    }
    return () => clearInterval(interval);
  }, [isLoading]);

  const handleToggleDomain = (domainName: string) => {
    setSelectedDomains(prev => {
      if (prev.includes(domainName)) {
        return prev.filter(d => d !== domainName);
      }
      if (prev.length >= 3) {
        return [...prev.slice(1), domainName]; // Keep to max 3
      }
      return [...prev, domainName];
    });
  };

  const handleRunScan = async () => {
    if (mode === 'guided' && selectedDomains.length < 2) {
      setError('Please select at least 2 research domains for a convergence scan.');
      return;
    }
    if (mode === 'open' && !customPrompt.trim()) {
      setError('Please enter a research prompt.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domains: mode === 'guided' ? selectedDomains : [],
          mode,
          customPrompt: mode === 'open' ? customPrompt : null
        })
      });

      if (!res.ok) {
        throw new Error('Research scan failed. Please check connection and keys.');
      }

      const report = await res.json();
      onReportGenerated(report);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown research scan error';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto space-y-6">
      {/* Header Panel */}
      <div className="bg-brand-secondary border border-brand-border p-6 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-lg font-bold text-brand-text">Research Scan Console</h2>
          <p className="text-xs text-brand-light mt-1">
            Analyze emerging technology intersections to discover novel investment theses before consensus.
          </p>
        </div>
        <div className="flex bg-zinc-950 p-1 rounded-lg border border-zinc-900 shrink-0 font-mono text-xs">
          <button
            onClick={() => { setMode('guided'); setError(null); }}
            className={`px-3 py-1.5 rounded transition ${
              mode === 'guided'
                ? 'bg-brand-green/20 text-brand-green font-bold border border-brand-green/30'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            [1] GUIDED SCAN
          </button>
          <button
            onClick={() => { setMode('open'); setError(null); }}
            className={`px-3 py-1.5 rounded transition ${
              mode === 'open'
                ? 'bg-brand-green/20 text-brand-green font-bold border border-brand-green/30'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            [2] OPEN PROMPT
          </button>
        </div>
      </div>

      {/* Mode Content */}
      <div className="bg-brand-secondary border border-brand-border p-6 rounded-2xl space-y-6">
        {mode === 'guided' ? (
          <div className="space-y-4">
            <div className="flex justify-between items-center border-b border-zinc-900 pb-3">
              <span className="text-xs font-mono font-bold text-zinc-400">
                SELECT 2-3 RESEARCH DOMAINS ({selectedDomains.length}/3 SELECTED)
              </span>
              {selectedDomains.length > 0 && (
                <button
                  onClick={() => setSelectedDomains([])}
                  className="text-[10px] font-mono text-zinc-500 hover:text-brand-green transition"
                >
                  [CLEAR ALL]
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {RESEARCH_DOMAINS.map((domain) => {
                const isSelected = selectedDomains.includes(domain.name);
                return (
                  <button
                    key={domain.id}
                    onClick={() => handleToggleDomain(domain.name)}
                    disabled={isLoading}
                    className={`flex items-start gap-3 p-4 rounded-xl text-left border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-brand-green/5 border-brand-green/40 shadow-sm'
                        : 'bg-zinc-950/20 border-zinc-900 hover:border-zinc-800 hover:bg-zinc-900/10'
                    }`}
                  >
                    <span className="text-xl pt-0.5">{domain.icon}</span>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-bold font-mono transition-colors ${isSelected ? 'text-brand-green' : 'text-zinc-200'}`}>
                          {domain.name}
                        </span>
                        {isSelected && (
                          <span className="w-1.5 h-1.5 rounded-full bg-brand-green animate-pulse" />
                        )}
                      </div>
                      <p className="text-[10px] text-zinc-400 leading-normal font-sans">
                        {domain.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="space-y-3 font-mono">
            <label className="text-xs font-bold text-zinc-400 block">CUSTOM CONVERGENCE PROMPT</label>
            <textarea
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="e.g., What emerging technology interfaces are developing at the convergence of humanoid robotics and smart grid-scale battery systems?"
              rows={4}
              disabled={isLoading}
              className="w-full bg-zinc-950 text-xs text-brand-text p-4 rounded-xl border border-zinc-900 focus:outline-none focus:border-brand-green placeholder-zinc-700 leading-relaxed font-sans resize-none"
            />
          </div>
        )}

        {/* Console Action Bar */}
        {error && (
          <div className="bg-rose-950/20 border border-rose-900/40 p-4 rounded-xl text-rose-400 text-xs font-mono leading-normal">
            ⚠️ Scan Error: {error}
          </div>
        )}

        <div className="flex justify-between items-center border-t border-zinc-900/60 pt-4">
          <div className="text-[10px] font-mono text-zinc-500 max-w-sm leading-relaxed">
            *Grounds response with real-time Google Search. Excludes consensus trends &gt;180 days and filters for 30-day emerging indicators.
          </div>

          <button
            onClick={handleRunScan}
            disabled={isLoading}
            className={`font-mono text-xs font-bold py-2.5 px-6 rounded-lg transition-all flex items-center gap-2 cursor-pointer ${
              isLoading
                ? 'bg-zinc-900 border border-zinc-800 text-zinc-500 cursor-not-allowed'
                : 'bg-brand-green border border-brand-green/40 hover:bg-brand-green-hover text-brand-primary'
            }`}
          >
            {isLoading ? (
              <>
                <span className="inline-block animate-spin font-sans text-xs">⚙</span>
                SCANNING...
              </>
            ) : (
              '⚡ RUN CONVERGENCE SCAN'
            )}
          </button>
        </div>
      </div>

      {/* Loading Progress overlay */}
      {isLoading && (
        <div className="bg-brand-secondary border border-brand-border p-8 rounded-2xl text-center space-y-4">
          <div className="flex justify-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-brand-green animate-bounce delay-0" />
            <span className="w-2.5 h-2.5 rounded-full bg-brand-green animate-bounce delay-150" />
            <span className="w-2.5 h-2.5 rounded-full bg-brand-green animate-bounce delay-300" />
          </div>
          <p className="text-xs font-mono text-zinc-200 uppercase tracking-widest font-bold">
            Convergence Scan in Progress
          </p>
          <p className="text-xs font-mono text-brand-green max-w-md mx-auto animate-pulse">
            &gt; {PROGRESS_MESSAGES[progressIdx]}
          </p>
        </div>
      )}
    </div>
  );
};

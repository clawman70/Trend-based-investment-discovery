import React from 'react';
import { BrainCircuitIcon } from './icons';

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const Header: React.FC<HeaderProps> = ({ activeTab, setActiveTab }) => {
  const tabs = [
    { id: 'research', label: 'RESEARCH' },
    { id: 'discover', label: 'DISCOVER' },
    { id: 'history', label: 'HISTORY LOGS' },
    { id: 'watchlist', label: 'WATCHLIST' },
    { id: 'portfolios', label: 'PORTFOLIOS' },
  ];

  return (
    <header className="bg-brand-secondary/80 backdrop-blur-md border-b border-brand-border/40 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="bg-brand-green/10 p-2 rounded-xl border border-brand-green/20">
            <BrainCircuitIcon className="h-6 w-6 text-brand-green animate-pulse" />
          </div>
          <div>
            <h1 className="text-lg md:text-xl font-black text-brand-text tracking-wide uppercase flex items-center gap-1.5">
              Trend-Discovery <span className="text-xs bg-brand-green/15 text-brand-green border border-brand-green/30 px-1.5 py-0.5 rounded-full font-mono font-medium lowercase">v2.0</span>
            </h1>
            <p className="text-[10px] text-brand-light uppercase tracking-widest font-mono">Emerging Market Investment Engine</p>
          </div>
        </div>

        {/* Tab Navigation */}
        <nav className="flex items-center space-x-2 bg-black/40 border border-zinc-900 p-1.5 rounded-lg shrink-0">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1.5 font-mono text-xs uppercase transition-all cursor-pointer rounded ${
                  isActive
                    ? 'text-brand-green bg-brand-green/10 border border-brand-green/30 font-bold'
                    : 'text-zinc-500 hover:text-zinc-300 border border-transparent'
                }`}
              >
                [{tab.label}]
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
};

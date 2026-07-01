import React, { useState } from 'react';
import { Filters } from '../lib/types';

interface InputPanelProps {
  trends: string[];
  setTrends: (trends: string[]) => void;
  filters: Filters;
  setFilters: (filters: Filters) => void;
  onAnalyze: () => void;
  onDiscover: () => void;
  isAnalyzing: boolean;
  isDiscovering: boolean;
  showDiscoverButton: boolean;
}

const marketCapOptions = [
  { value: 'MICRO', label: 'Micro-cap (<$300M)' },
  { value: 'SMALL', label: 'Small-cap ($300M-$2B)' },
  { value: 'MID', label: 'Mid-cap ($2B-$10B)' },
  { value: 'LARGE', label: 'Large-cap (>$10B)' },
];

const exchangeOptions = [
  { value: 'NASDAQ', label: 'NASDAQ' },
  { value: 'NYSE', label: 'NYSE' },
];

const priceOptions = [
  { value: '5', label: 'Less than $5' },
  { value: '10', label: 'Less than $10' },
  { value: '20', label: 'Less than $20' },
  { value: '50', label: 'Less than $50' },
  { value: 'ALL', label: 'Show all prices' },
];

const quickExamples = [
  "Edge AI inference on custom silicon",
  "Solid-state battery materials and anode technology",
  "Generative AI for drug discovery and molecular design",
  "Decentralized smart grids and utility-scale energy storage",
  "Satellite-based IoT connectivity and space technology",
];

export const InputPanel: React.FC<InputPanelProps> = ({
  trends,
  setTrends,
  filters,
  setFilters,
  onAnalyze,
  onDiscover,
  isAnalyzing,
  isDiscovering,
  showDiscoverButton,
}) => {
  const [showExamples, setShowExamples] = useState(false);
  const [activeInputIdx, setActiveInputIdx] = useState(0);

  const handleCheckboxFilterChange = (filterType: 'marketCap' | 'exchange', value: string) => {
    const currentValues = filters[filterType];
    const newValues = currentValues.includes(value)
      ? currentValues.filter((v) => v !== value)
      : [...currentValues, value];
    setFilters({ ...filters, [filterType]: newValues });
  };

  const handleCurrentPriceChange = (value: string) => {
    setFilters({ ...filters, currentPrice: value === 'ALL' ? null : value });
  };

  const selectExample = (ex: string) => {
    const updated = [...trends];
    updated[activeInputIdx] = ex;
    setTrends(updated);
    setShowExamples(false);
  };

  const addTrendField = () => {
    if (trends.length < 3) {
      setTrends([...trends, '']);
      setActiveInputIdx(trends.length);
    }
  };

  const removeTrendField = (index: number) => {
    if (trends.length > 1) {
      const updated = trends.filter((_, idx) => idx !== index);
      setTrends(updated);
      setActiveInputIdx(Math.max(0, updated.length - 1));
    }
  };

  const updateTrendValue = (index: number, val: string) => {
    const updated = [...trends];
    updated[index] = val;
    setTrends(updated);
  };

  const isLoading = isAnalyzing || isDiscovering;
  const hasValidTrend = trends.some((t) => t.trim().length > 0);

  return (
    <div className="bg-brand-secondary/80 backdrop-blur-md border border-brand-border/60 p-6 rounded-xl shadow-2xl relative overflow-hidden transition-all duration-300 hover:border-brand-border">
      <div className="absolute -right-24 -top-24 w-48 h-48 bg-brand-green/5 blur-3xl pointer-events-none rounded-full" />
      
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 gap-2">
        <h2 className="text-lg font-bold tracking-wide uppercase text-brand-light flex items-center gap-2">
          <span className="w-1.5 h-4 bg-brand-green rounded-full inline-block animate-pulse" />
          1. Define Investment Thesis
        </h2>
        <div className="relative">
          <button
            onClick={() => setShowExamples(!showExamples)}
            className="text-xs font-semibold text-brand-green border border-brand-green/30 hover:border-brand-green bg-brand-green/5 hover:bg-brand-green/10 px-3 py-1.5 rounded-lg transition duration-200 cursor-pointer"
          >
            Thesis Library ▾
          </button>
          {showExamples && (
            <div className="absolute right-0 mt-2 w-72 bg-brand-secondary border border-brand-border rounded-xl shadow-2xl z-50 overflow-hidden divide-y divide-brand-border/60">
              {quickExamples.map((ex, idx) => (
                <button
                  key={idx}
                  onClick={() => selectExample(ex)}
                  className="w-full text-left px-4 py-3 text-xs text-brand-light hover:text-brand-text hover:bg-brand-accent transition-colors cursor-pointer"
                >
                  {ex}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4">
        {trends.map((t, idx) => (
          <div key={idx} className="flex gap-2 items-start">
            <div className="flex-1 relative">
              <span className="absolute left-3 top-2.5 text-[10px] font-mono text-zinc-500 bg-zinc-950 px-1 border border-zinc-800 rounded">
                THESIS {idx + 1}
              </span>
              <textarea
                value={t}
                onChange={(e) => updateTrendValue(idx, e.target.value)}
                onFocus={() => setActiveInputIdx(idx)}
                placeholder="Describe an emerging investment trend, e.g., 'Companies specializing in solid-state batteries or energy density tech'..."
                className="w-full h-24 pt-7 px-4 pb-3 bg-brand-primary/60 border border-brand-border rounded-xl focus:ring-2 focus:ring-brand-green/50 focus:border-brand-green focus:outline-none transition duration-200 text-sm font-mono placeholder:text-brand-light/30 leading-relaxed resize-none"
                disabled={isLoading}
              />
            </div>
            {trends.length > 1 && (
              <button
                type="button"
                onClick={() => removeTrendField(idx)}
                className="px-3 py-2 bg-rose-950/20 border border-rose-900/40 text-rose-400 hover:bg-rose-950/40 rounded-xl text-xs font-mono font-bold transition duration-200 cursor-pointer mt-1"
                title="Remove this thesis"
              >
                [-]
              </button>
            )}
          </div>
        ))}
      </div>

      {trends.length < 3 && (
        <div className="mt-3 flex justify-start">
          <button
            type="button"
            onClick={addTrendField}
            className="text-xs font-mono font-semibold text-emerald-400 hover:text-emerald-300 bg-emerald-950/20 hover:bg-emerald-950/40 border border-emerald-900/40 px-3 py-1.5 rounded-lg transition duration-200 cursor-pointer"
            disabled={isLoading}
          >
            [+] Add Conforming Thesis
          </button>
        </div>
      )}

      <h2 className="text-lg font-bold tracking-wide uppercase mt-6 mb-4 text-brand-light flex items-center gap-2">
        <span className="w-1.5 h-4 bg-brand-green rounded-full inline-block" />
        2. Set Parameters
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
        {/* Market Capitalization */}
        <div className="bg-brand-primary/40 border border-brand-border/40 p-4 rounded-xl">
          <h3 className="font-semibold text-brand-light mb-3 text-xs uppercase tracking-wider">Market Cap Tier</h3>
          <div className="space-y-2.5">
            {marketCapOptions.map((option) => (
              <label key={option.value} className="flex items-center space-x-3 cursor-pointer group">
                <input
                  type="checkbox"
                  className="w-4 h-4 bg-brand-primary border-brand-border rounded text-brand-green focus:ring-offset-brand-primary focus:ring-brand-green transition"
                  checked={filters.marketCap.includes(option.value)}
                  onChange={() => handleCheckboxFilterChange('marketCap', option.value)}
                  disabled={isLoading}
                />
                <span className="text-brand-light group-hover:text-brand-text transition text-xs">{option.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Exchange */}
        <div className="bg-brand-primary/40 border border-brand-border/40 p-4 rounded-xl">
          <h3 className="font-semibold text-brand-light mb-3 text-xs uppercase tracking-wider">Stock Exchange</h3>
          <div className="space-y-2.5">
            {exchangeOptions.map((option) => (
              <label key={option.value} className="flex items-center space-x-3 cursor-pointer group">
                <input
                  type="checkbox"
                  className="w-4 h-4 bg-brand-primary border-brand-border rounded text-brand-green focus:ring-offset-brand-primary focus:ring-brand-green transition"
                  checked={filters.exchange.includes(option.value)}
                  onChange={() => handleCheckboxFilterChange('exchange', option.value)}
                  disabled={isLoading}
                />
                <span className="text-brand-light group-hover:text-brand-text transition text-xs">{option.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Current Price */}
        <div className="bg-brand-primary/40 border border-brand-border/40 p-4 rounded-xl">
          <h3 className="font-semibold text-brand-light mb-3 text-xs uppercase tracking-wider">Target Stock Price</h3>
          <div className="space-y-2.5">
            {priceOptions.map((option) => (
              <label key={option.value} className="flex items-center space-x-3 cursor-pointer group">
                <input
                  type="radio"
                  name="currentPrice"
                  className="w-4 h-4 bg-brand-primary border-brand-border text-brand-green focus:ring-offset-brand-primary focus:ring-brand-green transition"
                  value={option.value}
                  checked={
                    option.value === 'ALL'
                      ? filters.currentPrice === null
                      : filters.currentPrice === option.value
                  }
                  onChange={() => handleCurrentPriceChange(option.value)}
                  disabled={isLoading}
                />
                <span className="text-brand-light group-hover:text-brand-text transition text-xs">{option.label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
      
      <div className="mt-8 flex flex-col sm:flex-row justify-center gap-4">
        <button
          onClick={onAnalyze}
          disabled={isLoading || !hasValidTrend}
          className="w-full sm:w-auto bg-zinc-900 border border-zinc-700 text-zinc-300 hover:text-emerald-400 hover:border-emerald-500 font-mono font-bold py-3 px-8 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed transition duration-300 transform active:scale-98 cursor-pointer flex items-center justify-center gap-2"
        >
          {isAnalyzing ? (
            <>
              <svg className="animate-spin h-4 w-4 text-emerald-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>Analyzing Trends...</span>
            </>
          ) : 'Analyze Trends'}
        </button>

        {showDiscoverButton && (
          <button
            onClick={onDiscover}
            disabled={isLoading || !hasValidTrend}
            className="w-full sm:w-auto bg-brand-green text-brand-primary font-bold py-3 px-12 rounded-xl hover:shadow-[0_0_20px_var(--color-brand-glow)] hover:bg-opacity-95 disabled:bg-brand-accent/50 disabled:text-brand-light/30 disabled:border-transparent disabled:cursor-not-allowed transition duration-300 transform active:scale-98 border border-brand-green/20 cursor-pointer flex items-center justify-center gap-2 animate-bounce"
          >
            {isDiscovering ? (
              <>
                <svg className="animate-spin h-4 w-4 text-brand-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>Discovering Companies...</span>
              </>
            ) : 'Discover Companies'}
          </button>
        )}
      </div>
    </div>
  );
};

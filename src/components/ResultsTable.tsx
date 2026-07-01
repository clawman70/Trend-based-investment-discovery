import React, { useState } from 'react';
import { ScoredCompanyData } from '../lib/types';
import { useSortableData } from '../hooks/useSortableData';
import { exportToCSV } from '../lib/csvExporter';
import { ArrowUpIcon, ArrowDownIcon, ExportIcon } from './icons';
import { PeersComparison } from './PeersComparison';

interface ResultsTableProps {
  data: ScoredCompanyData[];
  watchlistTickers?: Set<string>;
  onToggleWatchlist?: (company: ScoredCompanyData) => void;
}

const formatCurrency = (num: number, decimals = 2) => {
  if (num === 0) return 'N/A';
  return `$${new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(num)}`;
};

const formatMarketCap = (mc: number) => {
  if (mc === 0) return 'N/A';
  if (mc >= 1e12) return `$${(mc / 1e12).toFixed(2)}T`;
  if (mc >= 1e9) return `$${(mc / 1e9).toFixed(2)}B`;
  if (mc >= 1e6) return `$${(mc / 1e6).toFixed(2)}M`;
  return `$${new Intl.NumberFormat('en-US').format(mc)}`;
};

export const ResultsTable: React.FC<ResultsTableProps> = ({ data, watchlistTickers = new Set(), onToggleWatchlist }) => {
  const { items, requestSort, sortConfig } = useSortableData(data);
  const [expandedTickers, setExpandedTickers] = useState<Record<string, boolean>>({});
  const [peersViewTicker, setPeersViewTicker] = useState<string | null>(null);

  const toggleExpand = (ticker: string) => {
    setExpandedTickers((prev) => ({
      ...prev,
      [ticker]: !prev[ticker],
    }));
  };

  const getSortIndicator = (key: keyof ScoredCompanyData) => {
    if (!sortConfig || sortConfig.key !== key) {
      return <span className="text-brand-light/20 group-hover:text-brand-light/50 transition">↕</span>;
    }
    return sortConfig.direction === 'ascending' ? (
      <ArrowUpIcon className="text-brand-green w-3 h-3" />
    ) : (
      <ArrowDownIcon className="text-brand-green w-3 h-3" />
    );
  };

  const handleExport = () => {
    exportToCSV(items, 'investment_discovery_results.csv');
  };

  const getConvergenceBadgeStyle = (score: number) => {
    if (score >= 0.99) {
      return 'text-emerald-400 bg-emerald-950/40 border-emerald-800 shadow-[0_0_8px_rgba(52,211,153,0.15)]';
    }
    if (score >= 0.49) {
      return 'text-teal-400 bg-teal-950/40 border-teal-800 shadow-[0_0_8px_rgba(45,212,191,0.1)]';
    }
    return 'text-zinc-400 bg-zinc-900 border-zinc-800';
  };

  return (
    <div className="mt-8 bg-brand-secondary/80 backdrop-blur-md border border-brand-border/60 p-6 rounded-xl shadow-2xl transition-all duration-300">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center mb-6 gap-4">
        <div>
          <h2 className="text-lg font-bold tracking-wide uppercase text-brand-text flex items-center gap-2">
            <span className="w-1.5 h-4 bg-brand-green rounded-full inline-block animate-pulse" />
            Investment Candidate Convergence Matrix
          </h2>
          <p className="text-xs text-brand-light mt-1">
            Candidates mapped across multiple theses, dynamically ranked by score parameters
          </p>
        </div>
        
        <button
          onClick={handleExport}
          className="flex items-center justify-center space-x-2 bg-brand-accent border border-brand-border/80 text-brand-text font-semibold py-2 px-5 rounded-lg hover:bg-brand-primary hover:border-brand-green/30 transition duration-200 text-xs cursor-pointer"
        >
          <ExportIcon className="w-4 h-4 text-brand-green" />
          <span>Export CSV</span>
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-brand-border/40 bg-zinc-950/20">
        <table className="min-w-full divide-y divide-brand-border/40">
          <thead className="bg-brand-primary/60">
            <tr>
              <th scope="col" className="w-8 px-2 py-3.5 text-center text-xs font-bold text-brand-light">
                {/* Expand Header */}
              </th>
              {tableHeaders.map((header) => (
                <th
                  key={header.key}
                  scope="col"
                  onClick={() => requestSort(header.key)}
                  className="px-4 py-3.5 text-left text-xs font-bold text-brand-light uppercase tracking-wider cursor-pointer select-none group hover:bg-brand-accent/30 transition-colors"
                >
                  <div className="flex items-center space-x-1.5">
                    <span>{header.label}</span>
                    {getSortIndicator(header.key)}
                  </div>
                </th>
              ))}
              <th scope="col" className="px-4 py-3.5 text-left text-xs font-bold text-brand-light uppercase tracking-wider">
                Data Quality
              </th>
              {onToggleWatchlist && (
                <th scope="col" className="w-12 px-4 py-3.5 text-center text-xs font-bold text-brand-light uppercase tracking-wider">
                  Watch
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-border/30 bg-brand-secondary/30">
            {items.map((item) => {
              const isUnavailable = item.dataQuality.priceSource === 'unavailable';
              const isExpanded = !!expandedTickers[item.ticker];
              const matchCount = item.trendsMatched?.length || 1;

              return (
                <React.Fragment key={item.ticker}>
                  <tr 
                    className={`hover:bg-brand-accent/40 transition-colors duration-150 cursor-pointer ${
                      isUnavailable ? 'border-l-2 border-l-brand-yellow/60 bg-brand-yellow/[0.01]' : 'border-l-2 border-l-transparent'
                    } ${isExpanded ? 'bg-zinc-900/10' : ''}`}
                    onClick={() => toggleExpand(item.ticker)}
                  >
                    {/* Collapsible Row Toggle */}
                    <td className="px-2 py-4.5 text-center">
                      <button 
                        type="button"
                        className="text-zinc-500 hover:text-zinc-300 font-mono text-[10px] focus:outline-none"
                      >
                        {isExpanded ? '▼' : '▶'}
                      </button>
                    </td>

                    {/* Composite Score */}
                    <td className="px-4 py-4.5 font-mono text-sm font-extrabold text-brand-green">
                      {item.compositeScore.toFixed(1)}
                    </td>

                    {/* Company Name & Ticker */}
                    <td className="px-4 py-4.5">
                      <div className="font-bold text-brand-text text-sm">{item.companyName}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <a
                          href={`https://www.google.com/finance?q=${item.exchange}:${item.ticker}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()} // Prevent expand toggle when clicking link
                          className="text-xs font-mono text-brand-green hover:underline hover:text-brand-green/80 flex items-center gap-1 w-fit"
                          aria-label={`View ${item.companyName} on Google Finance`}
                        >
                          {item.ticker}
                          <span className="text-[10px] text-brand-light/50">↗</span>
                        </a>
                        <a
                          href={`https://finance.yahoo.com/quote/${item.ticker}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] font-mono text-brand-light/60 hover:text-brand-green border border-zinc-800 hover:border-brand-green bg-zinc-950/40 px-1.5 py-0.5 rounded inline-block"
                        >
                          [YAHOO DETAILS] ↗
                        </a>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            // Toggle peers view and auto-expand the row
                            setPeersViewTicker(peersViewTicker === item.ticker ? null : item.ticker);
                            if (peersViewTicker !== item.ticker) {
                              // If showing peers, make sure row is expanded
                              setExpandedTickers((prev) => ({
                                ...prev,
                                [item.ticker]: true,
                              }));
                            }
                          }}
                          className="ml-1.5 text-[10px] font-mono text-brand-light/60 hover:text-brand-green border border-zinc-800 hover:border-brand-green bg-zinc-950/40 px-1.5 py-0.5 rounded cursor-pointer transition"
                        >
                          [PEERS]
                        </button>
                      </div>
                    </td>

                    {/* Convergence / Overlap Badge */}
                    <td className="px-4 py-4.5">
                      <span className={`px-2 py-0.5 rounded border text-[11px] font-mono font-semibold ${getConvergenceBadgeStyle(item.convergenceScore)}`}>
                        {matchCount} Thesis
                      </span>
                    </td>

                    {/* P/E Ratio */}
                    <td className="px-4 py-4.5 font-mono text-xs text-zinc-300">
                      {item.peRatio !== null && item.peRatio !== undefined
                        ? item.peRatio.toFixed(1)
                        : <span className="text-zinc-600 italic">N/A</span>}
                    </td>

                    {/* Current Price */}
                    <td className={`px-4 py-4.5 font-mono text-xs ${isUnavailable ? 'text-brand-yellow/60 italic' : 'text-brand-text'}`}>
                      {isUnavailable ? 'N/A' : formatCurrency(item.stockPrice)}
                    </td>

                    {/* Market Cap */}
                    <td className={`px-4 py-4.5 font-mono text-xs ${isUnavailable ? 'text-brand-yellow/60 italic' : 'text-brand-text'}`}>
                      {isUnavailable ? 'N/A' : formatMarketCap(item.marketCap)}
                    </td>

                    {/* Data Quality Badge */}
                    <td className="px-4 py-4.5 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      {item.dataQuality.priceSource === 'live' ? (
                        <span className="text-[10px] font-semibold text-brand-green bg-brand-green/10 border border-brand-green/20 px-2 py-0.5 rounded-full inline-block text-center">
                          Live
                        </span>
                      ) : (
                        <span className="text-[10px] font-semibold text-brand-yellow bg-brand-yellow/10 border border-brand-yellow/20 px-2 py-0.5 rounded-full inline-block text-center animate-pulse">
                          No Price
                        </span>
                      )}
                    </td>

                    {/* Star / Watchlist Button */}
                    {onToggleWatchlist && (
                      <td className="px-4 py-4.5 text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => onToggleWatchlist(item)}
                          className={`text-sm focus:outline-none transition hover:scale-125 cursor-pointer ${
                            watchlistTickers.has(item.ticker.toUpperCase())
                              ? 'text-amber-400'
                              : 'text-zinc-600 hover:text-amber-400'
                          }`}
                          title={watchlistTickers.has(item.ticker.toUpperCase()) ? "Remove from watchlist" : "Add to watchlist"}
                        >
                          {watchlistTickers.has(item.ticker.toUpperCase()) ? '★' : '☆'}
                        </button>
                      </td>
                    )}
                  </tr>

                  {/* Collapsible Detail Panel */}
                  {isExpanded && (
                    <tr className="bg-zinc-950/40">
                      <td colSpan={tableHeaders.length + (onToggleWatchlist ? 3 : 2)} className="px-6 py-4 border-t border-brand-border/20">
                        <div className="space-y-6 pl-8">
                          <div className="space-y-3">
                            <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest font-bold">
                              Convergence Rationales:
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {Object.entries(item.rationales).map(([trend, rationale]) => (
                                <div key={trend} className="bg-zinc-950 border border-zinc-900 p-3 rounded-lg hover:border-zinc-800 transition-colors">
                                  <span className="text-[9px] font-mono text-brand-green font-bold uppercase tracking-wider block mb-1">
                                    Thesis: {trend}
                                  </span>
                                  <p className="text-zinc-300 text-xs leading-relaxed italic">&quot;{rationale}&quot;</p>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Peers Comparison */}
                          {peersViewTicker === item.ticker && (
                            <div className="border-t border-zinc-900 pt-4">
                              <PeersComparison
                                ticker={item.ticker}
                                stockPrice={item.stockPrice}
                                marketCap={item.marketCap}
                                peRatio={item.peRatio || null}
                              />
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const tableHeaders: { key: keyof ScoredCompanyData; label: string }[] = [
  { key: 'compositeScore', label: 'Score' },
  { key: 'companyName', label: 'Company' },
  { key: 'convergenceScore', label: 'Overlap' },
  { key: 'peRatio', label: 'P/E' },
  { key: 'stockPrice', label: 'Price' },
  { key: 'marketCap', label: 'Mkt Cap' },
];

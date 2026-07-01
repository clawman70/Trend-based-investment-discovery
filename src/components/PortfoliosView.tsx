import React, { useEffect, useState } from 'react';

interface PortfolioItem {
  id: string;
  ticker: string;
  companyName: string;
  priceAtAdd: number;
  currentPrice: number;
  gainLossPercent: number;
  notes: string | null;
  tags: string[];
}

interface Portfolio {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  totalCostBasis: number;
  totalCurrentValue: number;
  gainLossPercent: number;
  items: PortfolioItem[];
}

interface PortfoliosViewProps {
  isActive: boolean;
  onInspect?: (ticker: string) => void;
}

export const PortfoliosView: React.FC<PortfoliosViewProps> = ({ isActive, onInspect }) => {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New portfolio form state
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);

  // Collapsed states per portfolio ID
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchPortfolios = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/portfolios');
      if (!res.ok) throw new Error('Failed to fetch portfolios');
      const data = await res.json();
      setPortfolios(data);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'An error occurred loading portfolios';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isActive) {
      fetchPortfolios();
    }
  }, [isActive]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    setCreating(true);
    try {
      const res = await fetch('/api/portfolios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDesc.trim(),
        }),
      });

      if (!res.ok) throw new Error('Creation failed');

      setNewName('');
      setNewDesc('');
      fetchPortfolios();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Could not create portfolio';
      alert(errorMessage);
    } finally {
      setCreating(false);
    }
  };

  const handleDeletePortfolio = async (id: string) => {
    if (!confirm('Are you sure you want to delete this portfolio? Constituent watchlist entries will NOT be deleted.')) {
      return;
    }
    try {
      const res = await fetch(`/api/portfolios?id=${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setPortfolios((prev) => prev.filter((p) => p.id !== id));
      } else {
        throw new Error('Delete failed');
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Could not delete portfolio';
      alert(errorMessage);
    }
  };

  const handleRemoveItem = async (portfolioId: string, watchlistId: string) => {
    if (!confirm('Remove this asset from the portfolio?')) {
      return;
    }
    try {
      const res = await fetch(
        `/api/portfolios?action=remove_item&portfolioId=${portfolioId}&watchlistId=${watchlistId}`,
        {
          method: 'DELETE',
        }
      );
      if (res.ok) {
        // Optimistically update state
        setPortfolios((prev) =>
          prev.map((p) => {
            if (p.id === portfolioId) {
              const updatedItems = p.items.filter((item) => item.id !== watchlistId); // Wait, watchlistId might be stored as item's mapping id or watchlist reference id. In our API, the payload uses watchlistItem link ID. Let's trigger a full refresh to ensure all math updates correctly.
              return { ...p, items: updatedItems };
            }
            return p;
          })
        );
        fetchPortfolios();
      } else {
        throw new Error('Remove failed');
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Could not remove item';
      alert(errorMessage);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  if (!isActive) return null;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 transition-all duration-300">
      {/* Create Portfolio Section */}
      <div className="bg-brand-secondary/80 backdrop-blur-md border border-brand-border/60 p-6 rounded-xl shadow-2xl h-fit">
        <h3 className="text-sm font-bold tracking-wide uppercase text-brand-text flex items-center gap-2 mb-4">
          <span className="w-1.5 h-3 bg-brand-green rounded-full inline-block" />
          Create Trend Portfolio
        </h3>

        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-[10px] font-mono text-zinc-400 uppercase tracking-wider mb-1">
              Portfolio Name *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. AI Hardware, Genomex Leads"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 p-2.5 rounded text-xs text-zinc-300 focus:outline-none focus:border-brand-green font-mono"
            />
          </div>

          <div>
            <label className="block text-[10px] font-mono text-zinc-400 uppercase tracking-wider mb-1">
              Description / Investment Thesis
            </label>
            <textarea
              placeholder="e.g. High conviction components scaling compute networks"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              className="w-full h-24 bg-zinc-950 border border-zinc-800 p-2.5 rounded text-xs text-zinc-300 focus:outline-none focus:border-brand-green font-mono resize-none"
            />
          </div>

          <button
            type="submit"
            disabled={creating}
            className="w-full py-2.5 bg-emerald-950 border border-emerald-800 text-xs font-mono text-emerald-400 hover:text-emerald-200 hover:bg-emerald-900 transition-colors uppercase font-bold rounded cursor-pointer flex justify-center items-center"
          >
            {creating ? 'Creating Portfolio...' : '[CREATE PORTFOLIO]'}
          </button>
        </form>
      </div>

      {/* Portfolios Display List */}
      <div className="xl:col-span-2 bg-brand-secondary/80 backdrop-blur-md border border-brand-border/60 p-6 rounded-xl shadow-2xl space-y-6">
        <div className="border-b border-zinc-900 pb-3 flex justify-between items-center">
          <div>
            <h2 className="text-lg font-bold tracking-wide uppercase text-brand-text flex items-center gap-2">
              <span className="w-1.5 h-4 bg-brand-green rounded-full inline-block animate-pulse" />
              Thesis Portfolios
            </h2>
            <p className="text-xs text-brand-light mt-1">
              Grouped thematic holdings tracking compound yields
            </p>
          </div>
          <button
            onClick={fetchPortfolios}
            className="px-3 py-1 bg-zinc-900 border border-zinc-800 text-[11px] font-mono text-zinc-400 hover:text-brand-green hover:border-brand-green transition-colors cursor-pointer"
          >
            [REFRESH DATA]
          </button>
        </div>

        {loading && portfolios.length === 0 && (
          <div className="py-12 text-center text-xs font-mono text-zinc-500">
            <span className="inline-block animate-spin mr-2">⚙</span> Syncing portfolio assets...
          </div>
        )}

        {error && (
          <div className="bg-rose-950/20 border border-rose-900/40 p-4 rounded-lg text-rose-400 text-xs font-mono">
            Error: {error}
          </div>
        )}

        {!loading && !error && portfolios.length === 0 && (
          <div className="py-16 text-center border border-zinc-900/60 border-dashed rounded-lg">
            <p className="text-sm font-semibold text-zinc-400 font-sans">No portfolios created yet</p>
            <p className="text-xs text-zinc-600 mt-2 max-w-sm mx-auto leading-relaxed">
              Create a named portfolio in the left panel, then go to the Watchlist tab to link starred assets to it.
            </p>
          </div>
        )}

        {!loading && portfolios.length > 0 && (
          <div className="space-y-4">
            {portfolios.map((port) => {
              const isExpanded = expandedId === port.id;
              const hasItems = port.items.length > 0;

              return (
                <div
                  key={port.id}
                  className="border border-zinc-900 bg-zinc-950/40 rounded-lg overflow-hidden transition-all duration-200"
                >
                  {/* Portfolio Header */}
                  <div
                    onClick={() => toggleExpand(port.id)}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 cursor-pointer hover:bg-zinc-900/40 transition-colors"
                  >
                    <div className="space-y-1">
                      <h4 className="text-base font-bold font-mono text-zinc-200 flex items-center gap-2">
                        {port.name}
                        <span className="text-[10px] font-normal font-sans text-zinc-500 bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 rounded">
                          {port.items.length} Assets
                        </span>
                      </h4>
                      {port.description && (
                        <p className="text-xs text-zinc-500 max-w-md italic">{port.description}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-6 shrink-0">
                      {/* Cost basis and Return summary */}
                      <div className="text-right space-y-1">
                        <div className="text-[10px] font-mono text-zinc-500 uppercase">Return Summary</div>
                        <div className="flex items-center gap-2 justify-end">
                          <span className="text-xs font-mono text-zinc-400">
                            ${port.totalCostBasis.toFixed(2)} → ${port.totalCurrentValue.toFixed(2)}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-bold font-mono ${
                              port.gainLossPercent >= 0
                                ? 'text-emerald-400 bg-emerald-950/40 border border-emerald-900/40'
                                : 'text-rose-400 bg-rose-950/40 border border-rose-900/40'
                            }`}
                          >
                            {port.gainLossPercent >= 0 ? '+' : ''}
                            {port.gainLossPercent.toFixed(1)}%
                          </span>
                        </div>
                      </div>

                      {/* Expand indicator and delete button */}
                      <div className="flex items-center gap-3">
                        <span className="text-zinc-600 group-hover:text-zinc-400 transition-colors text-xs font-mono">
                          {isExpanded ? '[COLLAPSE]' : '[EXPAND]'}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeletePortfolio(port.id);
                          }}
                          className="p-1.5 bg-rose-950/10 border border-rose-900/30 hover:border-rose-600 hover:bg-rose-950/30 text-rose-400 hover:text-rose-200 rounded transition-all cursor-pointer font-mono text-[10px] font-bold"
                        >
                          DELETE
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Portfolio constituent items (Collapsible) */}
                  {isExpanded && (
                    <div className="border-t border-zinc-900 bg-zinc-950 p-4 space-y-3">
                      {!hasItems ? (
                        <p className="text-center text-xs font-mono text-zinc-600 py-6">
                          No constituent assets linked to this portfolio yet.
                          <br />
                          Add tags or link bookmarks on the Watchlist tab.
                        </p>
                      ) : (
                        <div className="overflow-x-auto rounded border border-zinc-900">
                          <table className="min-w-full divide-y divide-zinc-900">
                            <thead className="bg-zinc-900/40">
                              <tr>
                                <th scope="col" className="px-3 py-2 text-left text-[10px] font-bold text-zinc-400 uppercase font-mono">
                                  Asset Ticker
                                </th>
                                <th scope="col" className="px-3 py-2 text-left text-[10px] font-bold text-zinc-400 uppercase font-mono">
                                  Company Name
                                </th>
                                <th scope="col" className="px-3 py-2 text-left text-[10px] font-bold text-zinc-400 uppercase font-mono">
                                  Cost Basis
                                </th>
                                <th scope="col" className="px-3 py-2 text-left text-[10px] font-bold text-zinc-400 uppercase font-mono">
                                  Current Price
                                </th>
                                <th scope="col" className="px-3 py-2 text-left text-[10px] font-bold text-zinc-400 uppercase font-mono">
                                  Gain/Loss
                                </th>
                                <th scope="col" className="px-3 py-2 text-center text-[10px] font-bold text-zinc-400 uppercase font-mono">
                                  Actions
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-900 bg-zinc-950/20 text-[11px] font-mono">
                              {port.items.map((item) => (
                                <tr key={item.id} className="hover:bg-zinc-900/20">
                                  <td className="px-3 py-2 text-brand-green font-bold">
                                    <div className="flex items-center gap-2">
                                      <a
                                        href={`https://www.google.com/finance?q=${item.ticker}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="hover:underline text-xs"
                                      >
                                        {item.ticker} ↗
                                      </a>
                                      {onInspect && (
                                        <button
                                          type="button"
                                          onClick={() => onInspect(item.ticker)}
                                          className="text-[9px] font-mono text-zinc-500 hover:text-brand-green border border-zinc-800 hover:border-brand-green bg-zinc-950/40 px-1 py-0.5 rounded cursor-pointer"
                                        >
                                          [INSPECT]
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-3 py-2 text-zinc-300">{item.companyName}</td>
                                  <td className="px-3 py-2 text-zinc-400">${item.priceAtAdd.toFixed(2)}</td>
                                  <td className="px-3 py-2 text-zinc-300">${item.currentPrice.toFixed(2)}</td>
                                  <td className="px-3 py-2">
                                    <span
                                      className={
                                        item.gainLossPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'
                                      }
                                    >
                                      {item.gainLossPercent >= 0 ? '+' : ''}
                                      {item.gainLossPercent.toFixed(1)}%
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-center">
                                    {/* Item ID is passed to remove_item as watchlistId mapping reference */}
                                    <button
                                      onClick={() => handleRemoveItem(port.id, item.id)}
                                      className="px-1.5 py-0.5 bg-rose-950/15 border border-rose-900/40 hover:border-rose-600 text-[9px] text-rose-400 rounded transition-colors cursor-pointer"
                                    >
                                      UNLINK
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

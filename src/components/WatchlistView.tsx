import React, { useEffect, useState } from 'react';

interface WatchlistItem {
  id: string;
  ticker: string;
  companyName: string;
  addedAt: string;
  priceAtAdd: number;
  currentPrice: number | null; // null = live price unavailable
  gainLossPercent: number | null;
  notes: string | null;
  tags: string[];
}

interface PortfolioRecord {
  id: string;
  name: string;
}

interface WatchlistViewProps {
  isActive: boolean;
  onInspect?: (ticker: string) => void;
}

export const WatchlistView: React.FC<WatchlistViewProps> = ({ isActive, onInspect }) => {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [portfolios, setPortfolios] = useState<PortfolioRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Notes/tags editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNotes, setEditNotes] = useState('');
  const [editTags, setEditTags] = useState('');
  const [selectedPortfolioMap, setSelectedPortfolioMap] = useState<Record<string, string>>({});

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const watchRes = await fetch('/api/watchlist');
      if (!watchRes.ok) throw new Error('Failed to load watchlist');
      const watchData = await watchRes.json();
      setItems(watchData);

      const portRes = await fetch('/api/portfolios');
      if (portRes.ok) {
        const portData = await portRes.json();
        setPortfolios(portData);
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'An error occurred fetching watchlist';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isActive) {
      fetchData();
    }
  }, [isActive]);

  const handleRemove = async (id: string) => {
    if (!confirm('Are you sure you want to remove this company from your watchlist?')) {
      return;
    }
    try {
      const res = await fetch(`/api/watchlist?id=${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setItems((prev) => prev.filter((item) => item.id !== id));
      } else {
        throw new Error('Remove failed');
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Could not remove watchlist item';
      alert(errorMessage);
    }
  };

  const startEditing = (item: WatchlistItem) => {
    setEditingId(item.id);
    setEditNotes(item.notes || '');
    setEditTags(item.tags.join(', '));
  };

  const saveEdits = async (id: string) => {
    try {
      const processedTags = editTags
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      const res = await fetch('/api/watchlist', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          notes: editNotes,
          tags: processedTags,
        }),
      });

      if (!res.ok) throw new Error('Failed to save updates');

      const updated = await res.json();
      setItems((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, notes: updated.notes, tags: updated.tags } : item
        )
      );
      setEditingId(null);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Could not save updates';
      alert(errorMessage);
    }
  };

  const addToPortfolio = async (watchlistId: string) => {
    const portfolioId = selectedPortfolioMap[watchlistId];
    if (!portfolioId) return;

    try {
      const res = await fetch('/api/portfolios?action=add_item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portfolioId, watchlistId }),
      });

      if (!res.ok) throw new Error('Failed to add to portfolio');
      alert('Company added to portfolio successfully!');
      
      // Reset selected portfolio in dropdown
      setSelectedPortfolioMap((prev) => ({ ...prev, [watchlistId]: '' }));
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Could not add to portfolio';
      alert(errorMessage);
    }
  };

  if (!isActive) return null;

  return (
    <div className="bg-brand-secondary/80 backdrop-blur-md border border-brand-border/60 p-6 rounded-xl shadow-2xl transition-all duration-300">
      <div className="border-b border-zinc-900 pb-3 mb-6 flex justify-between items-center">
        <div>
          <h2 className="text-lg font-bold tracking-wide uppercase text-brand-text flex items-center gap-2">
            <span className="w-1.5 h-4 bg-brand-green rounded-full inline-block animate-pulse" />
            Starred Asset Watchlist
          </h2>
          <p className="text-xs text-brand-light mt-1">
            Core bookmarked securities. Yields recalculate dynamically against live quotes.
          </p>
        </div>
        <button
          onClick={fetchData}
          className="px-3 py-1 bg-zinc-900 border border-zinc-800 text-[11px] font-mono text-zinc-400 hover:text-brand-green hover:border-brand-green transition-colors cursor-pointer"
        >
          [REFRESH QUOTES]
        </button>
      </div>

      {loading && (
        <div className="py-12 text-center text-xs font-mono text-zinc-500">
          <span className="inline-block animate-spin mr-2">⚙</span> Syncing live stock metrics...
        </div>
      )}

      {error && (
        <div className="bg-rose-950/20 border border-rose-900/40 p-4 rounded-lg text-rose-400 text-xs font-mono mb-4">
          Error: {error}
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="py-16 text-center border border-zinc-900/60 border-dashed rounded-lg">
          <p className="text-sm font-semibold text-zinc-400 font-sans">Your watchlist is empty</p>
          <p className="text-xs text-zinc-600 mt-2 max-w-sm mx-auto leading-relaxed">
            Star companies from candidate search results to track their cost basis, tag them, or bundle them into thematic portfolios.
          </p>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-brand-border/40">
          <table className="min-w-full divide-y divide-brand-border/40">
            <thead className="bg-brand-primary/60">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-xs font-bold text-brand-light uppercase tracking-wider">
                  Asset
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-bold text-brand-light uppercase tracking-wider">
                  Date Added
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-bold text-brand-light uppercase tracking-wider">
                  Cost Basis
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-bold text-brand-light uppercase tracking-wider">
                  Current Price
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-bold text-brand-light uppercase tracking-wider">
                  Return
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-bold text-brand-light uppercase tracking-wider">
                  Tags & Portfolio Links
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-bold text-brand-light uppercase tracking-wider">
                  Notes
                </th>
                <th scope="col" className="px-4 py-3 text-center text-xs font-bold text-brand-light uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border/30 bg-brand-secondary/30 text-xs">
              {items.map((item) => {
                const isEditing = editingId === item.id;
                const formattedDate = new Date(item.addedAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                });

                return (
                  <tr key={item.id} className="hover:bg-brand-accent/40 transition-colors duration-150">
                    {/* Ticker & Name */}
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div className="font-bold text-brand-text text-sm">{item.companyName}</div>
                      <a
                        href={`https://www.google.com/finance?q=${item.ticker}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-mono text-brand-green hover:underline flex items-center gap-1 mt-0.5"
                      >
                        {item.ticker} ↗
                      </a>
                    </td>

                    {/* Added Date */}
                    <td className="px-4 py-4 whitespace-nowrap font-mono text-zinc-400">
                      {formattedDate}
                    </td>

                    {/* Cost Basis */}
                    <td className="px-4 py-4 whitespace-nowrap font-mono text-zinc-300">
                      ${item.priceAtAdd.toFixed(2)}
                    </td>

                    {/* Current Price */}
                    <td className="px-4 py-4 whitespace-nowrap font-mono text-zinc-200">
                      {item.currentPrice !== null ? (
                        `$${item.currentPrice.toFixed(2)}`
                      ) : (
                        <span className="text-zinc-600 italic">N/A</span>
                      )}
                    </td>

                    {/* Return Yield */}
                    <td className="px-4 py-4 whitespace-nowrap font-mono">
                      {item.gainLossPercent !== null ? (
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                            item.gainLossPercent >= 0
                              ? 'text-emerald-400 bg-emerald-950/40 border border-emerald-900/40'
                              : 'text-rose-400 bg-rose-950/40 border border-rose-900/40'
                          }`}
                        >
                          {item.gainLossPercent >= 0 ? '+' : ''}
                          {item.gainLossPercent.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-zinc-600 italic text-[11px]">N/A</span>
                      )}
                    </td>

                    {/* Tags & Portfolio linkage */}
                    <td className="px-4 py-4 min-w-[200px]">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editTags}
                          onChange={(e) => setEditTags(e.target.value)}
                          placeholder="comma-separated tags"
                          className="w-full bg-zinc-950 border border-zinc-800 p-1 rounded font-mono text-xs text-zinc-300 focus:outline-none focus:border-brand-green"
                        />
                      ) : (
                        <div className="space-y-2">
                          {/* Render tags */}
                          <div className="flex flex-wrap gap-1">
                            {item.tags.length > 0 ? (
                              item.tags.map((t, idx) => (
                                <span
                                  key={idx}
                                  className="text-[9px] font-mono text-sky-400 bg-sky-950/30 border border-sky-900/40 px-1.5 py-0.5 rounded"
                                >
                                  {t}
                                </span>
                              ))
                            ) : (
                              <span className="text-[10px] text-zinc-600 italic">No tags</span>
                            )}
                          </div>

                          {/* Portfolio Dropdown Linkage */}
                          {portfolios.length > 0 && (
                            <div className="flex gap-1.5 items-center">
                              <select
                                value={selectedPortfolioMap[item.id] || ''}
                                onChange={(e) =>
                                  setSelectedPortfolioMap((prev) => ({
                                    ...prev,
                                    [item.id]: e.target.value,
                                  }))
                                }
                                className="bg-zinc-950 border border-zinc-900 text-[10px] p-0.5 rounded font-mono text-zinc-400 focus:outline-none focus:border-brand-green cursor-pointer"
                              >
                                <option value="">[Link to Portfolio]</option>
                                {portfolios.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name}
                                  </option>
                                ))}
                              </select>
                              {selectedPortfolioMap[item.id] && (
                                <button
                                  onClick={() => addToPortfolio(item.id)}
                                  className="px-1.5 py-0.5 bg-emerald-950/40 border border-emerald-900/50 hover:bg-emerald-950/80 text-[10px] font-mono text-emerald-400 rounded cursor-pointer"
                                >
                                  Link
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Notes */}
                    <td className="px-4 py-4 max-w-xs">
                      {isEditing ? (
                        <textarea
                          value={editNotes}
                          onChange={(e) => setEditNotes(e.target.value)}
                          placeholder="Research thesis notes..."
                          className="w-full h-16 bg-zinc-950 border border-zinc-800 p-1.5 rounded font-mono text-xs text-zinc-300 focus:outline-none focus:border-brand-green resize-none"
                        />
                      ) : (
                        <p className="text-zinc-400 italic leading-relaxed text-[11px] truncate max-w-xs" title={item.notes || ''}>
                          {item.notes || <span className="text-zinc-700 font-normal">Click Edit to add notes...</span>}
                        </p>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-4 whitespace-nowrap text-center">
                      <div className="flex gap-2 justify-center">
                        {isEditing ? (
                          <>
                            <button
                              onClick={() => saveEdits(item.id)}
                              className="px-2 py-1 bg-emerald-950/20 border border-emerald-900/60 hover:bg-emerald-950/40 text-emerald-400 font-mono text-[10px] rounded cursor-pointer font-bold"
                            >
                              [SAVE]
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="px-2 py-1 bg-zinc-900 border border-zinc-800 text-zinc-400 font-mono text-[10px] rounded cursor-pointer"
                            >
                              [CANCEL]
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => onInspect?.(item.ticker)}
                              className="px-2 py-1 bg-brand-green/10 border border-brand-green/30 hover:border-brand-green hover:bg-brand-green/20 text-brand-green font-mono text-[10px] rounded cursor-pointer"
                            >
                              INSPECT
                            </button>
                            <button
                              onClick={() => startEditing(item)}
                              className="px-2 py-1 bg-zinc-900 border border-zinc-800 hover:border-zinc-600 text-zinc-300 font-mono text-[10px] rounded cursor-pointer"
                            >
                              EDIT
                            </button>
                            <button
                              onClick={() => handleRemove(item.id)}
                              className="px-2 py-1 bg-rose-950/10 border border-rose-900/30 hover:border-rose-600 hover:bg-rose-950/30 text-rose-400 rounded font-mono text-[10px] cursor-pointer"
                            >
                              UNSTAR
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

import React, { useEffect, useState } from 'react';

interface SearchRecord {
  id: string;
  createdAt: string;
  trends: string[];
  filters: {
    marketCap: string[];
    exchange: string[];
    currentPrice: string | null;
  };
}

interface HistoryViewProps {
  onRestoreSearch: (id: string) => void;
  isActive: boolean;
}

export const HistoryView: React.FC<HistoryViewProps> = ({ onRestoreSearch, isActive }) => {
  const [searches, setSearches] = useState<SearchRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/history');
      if (!res.ok) {
        throw new Error('Failed to load search history');
      }
      const data = await res.json();
      setSearches(data);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'An error occurred loading history';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isActive) {
      fetchHistory();
    }
  }, [isActive]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this search history snapshot?')) {
      return;
    }
    try {
      const res = await fetch(`/api/history?id=${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setSearches((prev) => prev.filter((s) => s.id !== id));
      } else {
        throw new Error('Delete failed');
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Could not delete history item';
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
            Research History Logs
          </h2>
          <p className="text-xs text-brand-light mt-1">Snapshot audit trail of previously run intelligence runs</p>
        </div>
        <button
          onClick={fetchHistory}
          className="px-3 py-1 bg-zinc-900 border border-zinc-800 text-[11px] font-mono text-zinc-400 hover:text-brand-green hover:border-brand-green transition-colors cursor-pointer"
        >
          [REFRESH]
        </button>
      </div>

      {loading && (
        <div className="py-12 text-center text-xs font-mono text-zinc-500">
          <span className="inline-block animate-spin mr-2">⚙</span> Fetching historical log traces...
        </div>
      )}

      {error && (
        <div className="bg-rose-950/20 border border-rose-900/40 p-4 rounded-lg text-rose-400 text-xs font-mono mb-4">
          Error: {error}
        </div>
      )}

      {!loading && !error && searches.length === 0 && (
        <div className="py-16 text-center border border-zinc-900/60 border-dashed rounded-lg">
          <p className="text-sm font-semibold text-zinc-400 font-sans">No search history logs found</p>
          <p className="text-xs text-zinc-600 mt-2 max-w-sm mx-auto leading-relaxed">
            Run a company discovery candidate sweep on the Discover tab to save a persistent research record.
          </p>
        </div>
      )}

      {!loading && searches.length > 0 && (
        <div className="space-y-4">
          {searches.map((search) => {
            const formattedDate = new Date(search.createdAt).toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            });

            return (
              <div
                key={search.id}
                onClick={() => onRestoreSearch(search.id)}
                className="group border border-zinc-900 bg-zinc-950/40 p-4.5 rounded-lg hover:border-emerald-900/60 hover:bg-emerald-950/5 transition-all duration-200 cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-mono text-zinc-500 bg-zinc-950 px-1.5 py-0.5 border border-zinc-900 rounded">
                      {formattedDate}
                    </span>
                    <span className="text-[10px] font-mono text-emerald-400/80 uppercase">
                      {search.trends.length} Thesis Match
                    </span>
                  </div>

                  <div className="space-y-1">
                    {search.trends.map((t, idx) => (
                      <div key={idx} className="text-sm font-mono text-zinc-200 font-medium">
                        <span className="text-zinc-600 mr-2">#0{idx + 1}</span> {t}
                      </div>
                    ))}
                  </div>

                  {/* Filter tags summary */}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {search.filters.exchange.length > 0 && (
                      <span className="text-[9px] font-mono text-sky-400 bg-sky-950/40 border border-sky-900/40 px-1.5 rounded">
                        Exchange: {search.filters.exchange.join(', ')}
                      </span>
                    )}
                    {search.filters.marketCap.length > 0 && (
                      <span className="text-[9px] font-mono text-teal-400 bg-teal-950/40 border border-teal-900/40 px-1.5 rounded">
                        Cap: {search.filters.marketCap.join(', ')}
                      </span>
                    )}
                    {search.filters.currentPrice && (
                      <span className="text-[9px] font-mono text-amber-400 bg-amber-950/40 border border-amber-900/40 px-1.5 rounded">
                        Price: &lt; ${search.filters.currentPrice}
                      </span>
                    )}
                    {search.filters.exchange.length === 0 && search.filters.marketCap.length === 0 && !search.filters.currentPrice && (
                      <span className="text-[9px] font-mono text-zinc-600 bg-zinc-950 border border-zinc-900 px-1.5 rounded">
                        No Filters Applied
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0 self-end md:self-center">
                  <span className="text-xs font-mono text-zinc-500 group-hover:text-emerald-400 transition-colors uppercase font-bold">
                    [Load Snapshot]
                  </span>
                  <button
                    onClick={(e) => handleDelete(e, search.id)}
                    className="p-1.5 bg-rose-950/10 border border-rose-900/30 hover:border-rose-600 hover:bg-rose-950/30 text-rose-400 hover:text-rose-200 rounded transition-all cursor-pointer font-mono text-[10px] font-bold"
                    title="Delete log"
                  >
                    DELETE
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

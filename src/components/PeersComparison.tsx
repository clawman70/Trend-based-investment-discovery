import React, { useState, useEffect } from 'react';

interface PeerCompany {
  ticker: string;
  companyName: string;
  stockPrice: number;
  marketCap: number;
  peRatio: number | null;
  growth1Y: number;
}

interface PeersComparisonProps {
  ticker: string;
  stockPrice: number;
  marketCap: number;
  peRatio: number | null;
}

export const PeersComparison: React.FC<PeersComparisonProps> = ({
  ticker,
  stockPrice,
  marketCap,
  peRatio,
}) => {
  const [peers, setPeers] = useState<PeerCompany[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPeers = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/peers?ticker=${ticker}`);
        if (!res.ok) throw new Error('Failed to fetch peers');
        const data = await res.json();
        setPeers(data || []);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error fetching peers';
        setError(msg);
      } finally {
        setLoading(false);
      }
    };

    if (ticker) fetchPeers();
  }, [ticker]);

  const formatCurrency = (num: number) => {
    if (num === 0) return 'N/A';
    return `$${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num)}`;
  };

  const formatMarketCap = (mc: number) => {
    if (mc === 0) return 'N/A';
    if (mc >= 1e12) return `$${(mc / 1e12).toFixed(2)}T`;
    if (mc >= 1e9) return `$${(mc / 1e9).toFixed(2)}B`;
    if (mc >= 1e6) return `$${(mc / 1e6).toFixed(2)}M`;
    return `$${new Intl.NumberFormat('en-US').format(mc)}`;
  };

  if (loading) {
    return (
      <div className="text-center py-8 text-xs font-mono text-zinc-500">
        <span className="inline-block animate-spin mr-2">⚙</span> Fetching peer competitors...
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-rose-950/20 border border-rose-900/40 p-4 rounded-lg text-rose-400 text-xs font-mono">
        Error: {error}
      </div>
    );
  }

  const allCompanies = [
    { ticker, companyName: `${ticker}`, stockPrice, marketCap, peRatio, isMain: true },
    ...peers,
  ];

  return (
    <div className="space-y-4">
      <h4 className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest font-bold">
        Industry Peer Comparison ({peers.length} competitors)
      </h4>

      {peers.length === 0 ? (
        <div className="py-6 text-center border border-zinc-900 border-dashed rounded-lg">
          <p className="text-xs font-mono text-zinc-600">No competitor data available for {ticker}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-900">
          <table className="min-w-full divide-y divide-zinc-900 text-xs font-mono">
            <thead className="bg-zinc-900/40">
              <tr className="text-zinc-500 text-left">
                <th className="py-3 px-4 uppercase font-semibold">Symbol</th>
                <th className="py-3 px-4 uppercase font-semibold text-right">Price</th>
                <th className="py-3 px-4 uppercase font-semibold text-right">Market Cap</th>
                <th className="py-3 px-4 uppercase font-semibold text-right">P/E Ratio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900 bg-zinc-950/20 text-zinc-300">
              {allCompanies.map((company, idx) => (
                <tr
                  key={idx}
                  className={
                    company.isMain
                      ? 'bg-brand-green/5 font-semibold text-brand-green'
                      : 'hover:bg-zinc-900/20'
                  }
                >
                  <td className="py-3 px-4 font-bold">
                    {company.ticker}
                    {company.isMain && ' (Active)'}
                  </td>
                  <td className="py-3 px-4 text-right">{formatCurrency(company.stockPrice)}</td>
                  <td className="py-3 px-4 text-right">{formatMarketCap(company.marketCap)}</td>
                  <td className="py-3 px-4 text-right">
                    {company.peRatio !== null && company.peRatio > 0
                      ? `${company.peRatio.toFixed(1)}x`
                      : 'N/A'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {peers.length > 0 && (
        <div className="text-[10px] font-mono text-zinc-600 p-3 bg-zinc-950/40 border border-zinc-900 rounded">
          <span className="text-brand-green">💡</span> Competitors sorted by market cap. Use this to gauge
          valuation vs peers in the same industry.
        </div>
      )}
    </div>
  );
};

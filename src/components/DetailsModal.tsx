import React, { useState, useEffect } from 'react';

/** Mirrors /api/company-details. Every field is real data or null — nothing is invented. */
interface CompanyDetails {
  isDemo?: boolean;
  ticker: string;
  companyName: string;
  description: string | null;
  sector: string | null;
  industry: string | null;
  ceo: string | null;
  website: string | null;
  stockPrice: number; // 0 = unavailable
  marketCap: number; // 0 = unavailable
  peRatio: number | null;
  yoyRevenueGrowth: number | null;
  debtToEquity: number | null;
  freeCashFlow: number | null; // derived from market cap / (price-to-FCF)
  valueChainPosition?: string | null;
}

interface NewsItem {
  title: string;
  url: string;
  publishedDate: string;
  text: string;
  site: string;
}

interface NewsSentiment {
  sentiment: 'Bullish' | 'Bearish' | 'Neutral';
  sentimentScore: number;
  summary: string;
}

interface NewsResponse {
  isDemo?: boolean;
  news: NewsItem[];
  sentiment: NewsSentiment | null; // null = AI sentiment unavailable
}

/** Mirrors PeerCompany from /api/peers. */
interface PeerData {
  ticker: string;
  companyName: string;
  stockPrice: number;
  marketCap: number;
  peRatio: number | null;
}

interface DetailsModalProps {
  ticker: string | null;
  trend?: string | null;
  onClose: () => void;
}

const readError = async (res: Response, fallback: string) => {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error || fallback;
};

const formatCurrency = (num: number, decimals = 2) => {
  if (!num) return 'N/A';
  return `$${new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(num)}`;
};

const formatLargeAmount = (num: number | null) => {
  if (num === null || num === 0) return 'N/A';
  const sign = num < 0 ? '-' : '';
  const abs = Math.abs(num);
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  return `${sign}$${new Intl.NumberFormat('en-US').format(abs)}`;
};

const NotAvailable = () => <span className="text-zinc-600 italic">N/A</span>;

export const DetailsModal: React.FC<DetailsModalProps> = ({ ticker, trend, onClose }) => {
  const [activeTab, setActiveTab] = useState<'fundamentals' | 'news' | 'competitors'>('fundamentals');
  const [details, setDetails] = useState<CompanyDetails | null>(null);
  const [newsData, setNewsData] = useState<NewsResponse | null>(null);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [peers, setPeers] = useState<PeerData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ticker) return;

    const fetchAllData = async () => {
      setLoading(true);
      setError(null);
      setNewsError(null);
      setDetails(null);
      setNewsData(null);
      setPeers([]);

      try {
        const trendParam = trend ? `&trend=${encodeURIComponent(trend)}` : '';
        const [detailsRes, newsRes, peersRes] = await Promise.all([
          fetch(`/api/company-details?ticker=${encodeURIComponent(ticker)}${trendParam}`),
          fetch(`/api/news?ticker=${encodeURIComponent(ticker)}`),
          fetch(`/api/peers?ticker=${encodeURIComponent(ticker)}`),
        ]);

        if (!detailsRes.ok) {
          throw new Error(await readError(detailsRes, 'Failed to load company details'));
        }
        setDetails(await detailsRes.json());

        if (newsRes.ok) {
          setNewsData(await newsRes.json());
        } else {
          setNewsError(await readError(newsRes, 'News is unavailable.'));
        }

        if (peersRes.ok) {
          setPeers(await peersRes.json());
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Error retrieving stock details';
        setError(msg);
      } finally {
        setLoading(false);
      }
    };

    fetchAllData();
  }, [ticker, trend]);

  if (!ticker) return null;

  const getSentimentColor = (sentiment: string) => {
    if (sentiment === 'Bullish') return 'text-emerald-400 bg-emerald-950/40 border-emerald-900/50';
    if (sentiment === 'Bearish') return 'text-rose-400 bg-rose-950/40 border-rose-900/50';
    return 'text-zinc-400 bg-zinc-900 border-zinc-800';
  };

  // Maps score (-1.0 to 1.0) to percentage (0% to 100%)
  const getScorePercentage = (score: number) => ((score + 1) / 2) * 100;

  const isDemo = !!details?.isDemo || !!newsData?.isDemo;
  const sectorLine = details ? [details.sector, details.industry].filter(Boolean).join(' • ') : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/80 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-4xl bg-brand-secondary border border-brand-border rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] transition-all">
        {/* Header */}
        <div className="p-6 border-b border-zinc-900 flex justify-between items-start bg-brand-primary/60">
          <div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs font-bold px-2 py-0.5 bg-brand-green/20 border border-brand-green/30 text-brand-green rounded">
                {ticker}
              </span>
              <h2 className="text-xl font-bold tracking-tight text-brand-text">
                {details?.companyName || 'Loading Company Info...'}
              </h2>
            </div>
            {sectorLine && <p className="text-xs text-brand-light mt-1 font-mono">{sectorLine}</p>}
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-brand-text font-mono text-sm border border-zinc-800 hover:border-zinc-700 bg-zinc-950/40 p-1 px-2.5 rounded transition cursor-pointer"
          >
            [ESC] CLOSE
          </button>
        </div>

        {isDemo && (
          <div className="px-6 py-2 bg-brand-yellow/10 border-b border-brand-yellow/30 text-[11px] font-mono font-bold text-brand-yellow">
            DEMO MODE — the data in this window is placeholder content, not real market data.
          </div>
        )}

        {/* Loading / Error States */}
        {loading && (
          <div className="flex-1 py-32 text-center text-xs font-mono text-zinc-500">
            <span className="inline-block animate-spin mr-2">⚙</span> Fetching fundamentals, news & AI sentiment...
          </div>
        )}

        {error && (
          <div className="flex-1 p-8">
            <div className="bg-rose-950/20 border border-rose-900/40 p-6 rounded-lg text-rose-400 text-xs font-mono">
              Error fetching ticker details: {error}
            </div>
          </div>
        )}

        {/* Content */}
        {!loading && !error && details && (
          <>
            {/* Tabs Selector */}
            <div className="bg-zinc-950/40 border-b border-zinc-900 px-6 flex gap-2">
              {([
                ['fundamentals', '[01] DEEP METRICS'],
                ['news', '[02] NEWS & AI SENTIMENT'],
                ['competitors', `[03] PEERS COMPARISON (${peers.length})`],
              ] as const).map(([tab, label]) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`py-3 px-4 font-mono text-xs border-b-2 font-semibold transition-all cursor-pointer ${
                    activeTab === tab
                      ? 'border-brand-green text-brand-green'
                      : 'border-transparent text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Scrollable Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Tab 1: Deep Fundamentals */}
              {activeTab === 'fundamentals' && (
                <div className="space-y-6">
                  {/* Company Description */}
                  <div className="bg-zinc-950/40 border border-zinc-900 p-4 rounded-lg">
                    <h4 className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest font-bold mb-2">Company Overview</h4>
                    {details.description ? (
                      <p className="text-xs text-zinc-300 leading-relaxed font-sans">{details.description}</p>
                    ) : (
                      <p className="text-xs text-zinc-600 italic font-sans">Company description unavailable.</p>
                    )}
                    {details.valueChainPosition && (
                      <div className="mt-3 p-3 bg-brand-green/5 border border-brand-green/10 rounded font-mono text-[11px] text-zinc-300">
                        <span className="text-brand-green font-bold uppercase tracking-wider block mb-1">
                          Trend Value Chain Position (AI)
                        </span>
                        {details.valueChainPosition}
                      </div>
                    )}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 pt-4 border-t border-zinc-900/60 font-mono text-[11px]">
                      <div>
                        <span className="text-zinc-500 block">CEO</span>
                        <span className="text-zinc-200 font-semibold">{details.ceo ?? <NotAvailable />}</span>
                      </div>
                      <div>
                        <span className="text-zinc-500 block">Website</span>
                        {details.website ? (
                          <a
                            href={details.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-brand-green hover:underline break-all"
                          >
                            {details.website.replace(/^https?:\/\//, '').replace('www.', '').replace(/\/$/, '')} ↗
                          </a>
                        ) : (
                          <NotAvailable />
                        )}
                      </div>
                      <div>
                        <span className="text-zinc-500 block">Price</span>
                        <span className="text-zinc-200 font-semibold">{formatCurrency(details.stockPrice)}</span>
                      </div>
                      <div>
                        <span className="text-zinc-500 block">Market Cap</span>
                        <span className="text-zinc-200 font-semibold">{formatLargeAmount(details.marketCap)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Financial Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Growth */}
                    <div className="bg-zinc-950/40 border border-zinc-900 p-4 rounded-lg flex flex-col justify-between">
                      <div>
                        <h4 className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest font-bold mb-1">Growth Metric</h4>
                        <span className="text-xs text-zinc-400">Revenue Growth (TTM, YoY)</span>
                      </div>
                      <div className="mt-4 font-mono">
                        {details.yoyRevenueGrowth !== null ? (
                          <span className={`text-2xl font-bold ${details.yoyRevenueGrowth >= 0 ? 'text-brand-green' : 'text-brand-red'}`}>
                            {details.yoyRevenueGrowth >= 0 ? '+' : ''}
                            {details.yoyRevenueGrowth.toFixed(1)}%
                          </span>
                        ) : (
                          <NotAvailable />
                        )}
                      </div>
                    </div>

                    {/* Valuation */}
                    <div className="bg-zinc-950/40 border border-zinc-900 p-4 rounded-lg flex flex-col justify-between">
                      <div>
                        <h4 className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest font-bold mb-1">Valuation</h4>
                        <span className="text-xs text-zinc-400">Trailing P/E Ratio</span>
                      </div>
                      <div className="mt-4 font-mono text-2xl font-bold text-zinc-200">
                        {details.peRatio !== null ? <span>{details.peRatio.toFixed(1)}x</span> : <NotAvailable />}
                      </div>
                    </div>

                    {/* Leverage */}
                    <div className="bg-zinc-950/40 border border-zinc-900 p-4 rounded-lg flex flex-col justify-between">
                      <div>
                        <h4 className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest font-bold mb-1">Financial Leverage</h4>
                        <span className="text-xs text-zinc-400">Total Debt-to-Equity</span>
                      </div>
                      <div className="mt-4 font-mono text-2xl font-bold text-zinc-200">
                        {details.debtToEquity !== null ? (
                          <span className={details.debtToEquity > 1.5 ? 'text-brand-yellow' : 'text-zinc-200'}>
                            {details.debtToEquity.toFixed(2)}
                          </span>
                        ) : (
                          <NotAvailable />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Cash Flow Card */}
                  <div className="bg-zinc-950/40 border border-zinc-900 p-4 rounded-lg flex items-center justify-between font-mono">
                    <div>
                      <h4 className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold mb-1">Free Cash Flow (TTM, est.)</h4>
                      <span className="text-xs text-zinc-400 font-sans">Derived from market cap ÷ price-to-free-cash-flow</span>
                    </div>
                    <div className="text-xl font-bold text-zinc-200">
                      {details.freeCashFlow !== null ? (
                        <span className={details.freeCashFlow >= 0 ? 'text-brand-green' : 'text-brand-red'}>
                          {formatLargeAmount(details.freeCashFlow)}
                        </span>
                      ) : (
                        <NotAvailable />
                      )}
                    </div>
                  </div>

                  <p className="text-[10px] font-mono text-zinc-600">
                    Sources: Finnhub (price, fundamentals, news, peers) · Yahoo Finance (company profile)
                  </p>
                </div>
              )}

              {/* Tab 2: News & AI Sentiment */}
              {activeTab === 'news' && (
                <div className="space-y-6">
                  {newsData ? (
                    <>
                      {/* Sentiment Executive Card */}
                      <div className="bg-zinc-950/40 border border-zinc-900 p-4 rounded-lg space-y-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <h4 className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest font-bold mb-1">AI News Sentiment Scorecard</h4>
                            <span className="text-xs text-zinc-400">Claude evaluation of recent headlines</span>
                          </div>
                          {newsData.sentiment && (
                            <span className={`px-3 py-1 rounded text-xs font-bold border font-mono ${getSentimentColor(newsData.sentiment.sentiment)}`}>
                              {newsData.sentiment.sentiment}
                            </span>
                          )}
                        </div>

                        {newsData.sentiment ? (
                          <>
                            {/* Sentiment Scale Bar */}
                            <div className="space-y-1.5 font-mono">
                              <div className="h-2 w-full bg-zinc-900 border border-zinc-800 rounded-full overflow-hidden relative">
                                <div
                                  className={`h-full absolute top-0 transition-all duration-500 ${
                                    newsData.sentiment.sentiment === 'Bullish'
                                      ? 'bg-emerald-500'
                                      : newsData.sentiment.sentiment === 'Bearish'
                                      ? 'bg-rose-500'
                                      : 'bg-zinc-500'
                                  }`}
                                  style={{ width: `${getScorePercentage(newsData.sentiment.sentimentScore)}%` }}
                                />
                              </div>
                              <div className="flex justify-between text-[9px] text-zinc-500">
                                <span>BEARISH (-1.0)</span>
                                <span className="text-zinc-300 font-bold">SCORE: {newsData.sentiment.sentimentScore.toFixed(2)}</span>
                                <span>BULLISH (+1.0)</span>
                              </div>
                            </div>

                            {/* Executive Summary */}
                            <div className="pt-2 border-t border-zinc-900/60">
                              <span className="text-[9px] font-mono text-brand-green font-bold uppercase tracking-wider block mb-1">AI EXECUTIVE SUMMARY</span>
                              <p className="text-xs text-zinc-300 leading-relaxed italic">&quot;{newsData.sentiment.summary}&quot;</p>
                            </div>
                          </>
                        ) : (
                          <p className="text-xs font-mono text-zinc-600 italic">
                            {newsData.news.length === 0
                              ? 'No recent headlines to analyze.'
                              : 'AI sentiment unavailable (check ANTHROPIC_API_KEY or try again later).'}
                          </p>
                        )}
                      </div>

                      {/* News List */}
                      <div className="space-y-4">
                        <h4 className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest font-bold">Related Headlines (last 14 days)</h4>
                        {newsData.news.length === 0 ? (
                          <div className="text-center font-mono text-xs text-zinc-600 py-6">No news articles found.</div>
                        ) : (
                          <div className="space-y-3">
                            {newsData.news.map((item, idx) => (
                              <div
                                key={idx}
                                className="bg-zinc-950 border border-zinc-900 p-4 rounded-lg hover:border-zinc-800 transition-all group"
                              >
                                <div className="flex justify-between items-start gap-4">
                                  <a
                                    href={item.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs font-bold text-zinc-200 group-hover:text-brand-green transition-colors leading-normal"
                                  >
                                    {item.title} ↗
                                  </a>
                                  <span className="text-[9px] font-mono text-zinc-500 shrink-0 bg-zinc-900 border border-zinc-900 px-2 py-0.5 rounded">
                                    {item.site}
                                  </span>
                                </div>
                                {item.text && <p className="text-zinc-400 text-xs mt-2 leading-relaxed font-sans">{item.text}</p>}
                                <div className="text-[9px] font-mono text-zinc-600 mt-2">
                                  {new Date(item.publishedDate).toLocaleString()}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="text-center font-mono text-xs text-zinc-600 py-12">{newsError || 'News is unavailable.'}</div>
                  )}
                </div>
              )}

              {/* Tab 3: Competitors & Peers */}
              {activeTab === 'competitors' && (
                <div className="space-y-4">
                  <h4 className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest font-bold mb-3">Industry Direct Peers Comparison</h4>
                  {peers.length === 0 ? (
                    <div className="py-12 text-center border border-zinc-900 border-dashed rounded-lg">
                      <p className="text-xs font-mono text-zinc-600">No peer data available for {ticker}.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-zinc-900">
                      <table className="min-w-full divide-y divide-zinc-900 text-xs font-mono">
                        <thead className="bg-zinc-900/40">
                          <tr className="text-zinc-500 text-left">
                            <th className="py-3 px-4 uppercase font-semibold">Symbol</th>
                            <th className="py-3 px-4 uppercase font-semibold">Competitor Name</th>
                            <th className="py-3 px-4 uppercase font-semibold text-right">Price</th>
                            <th className="py-3 px-4 uppercase font-semibold text-right">Market Cap</th>
                            <th className="py-3 px-4 uppercase font-semibold text-right">P/E</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-900 bg-zinc-950/20 text-zinc-300">
                          {/* Anchor Company */}
                          <tr className="bg-brand-green/5 font-semibold text-brand-green">
                            <td className="py-3.5 px-4 font-bold">{ticker} (Active)</td>
                            <td className="py-3.5 px-4">{details.companyName}</td>
                            <td className="py-3.5 px-4 text-right">{formatCurrency(details.stockPrice)}</td>
                            <td className="py-3.5 px-4 text-right">{formatLargeAmount(details.marketCap)}</td>
                            <td className="py-3.5 px-4 text-right">{details.peRatio !== null ? `${details.peRatio.toFixed(1)}x` : 'N/A'}</td>
                          </tr>
                          {/* Peers */}
                          {peers.map((peer) => (
                            <tr key={peer.ticker} className="hover:bg-zinc-900/20">
                              <td className="py-3 px-4 font-bold">{peer.ticker}</td>
                              <td className="py-3 px-4 text-zinc-400">{peer.companyName}</td>
                              <td className="py-3 px-4 text-right">{formatCurrency(peer.stockPrice)}</td>
                              <td className="py-3 px-4 text-right">{formatLargeAmount(peer.marketCap)}</td>
                              <td className="py-3 px-4 text-right">{peer.peRatio !== null ? `${peer.peRatio.toFixed(1)}x` : 'N/A'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

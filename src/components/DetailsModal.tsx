import React, { useState, useEffect } from 'react';

interface CompanyDetails {
  ticker: string;
  companyName: string;
  description: string;
  sector: string;
  industry: string;
  ceo: string;
  website: string;
  stockPrice: number;
  marketCap: number;
  peRatio: number | null;
  yoyRevenueGrowth: number | null;
  debtToEquity: number | null;
  freeCashFlow: number | null;
  valueChainPosition?: string;
  recentFinancials: {
    revenue: number;
    netIncome: number;
    operatingCashFlow: number;
    capitalExpenditure: number;
    totalDebt: number;
    totalEquity: number;
    date: string;
  } | null;
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
  news: NewsItem[];
  sentiment: NewsSentiment;
}

interface PeerData {
  symbol: string;
  name: string;
  price: number;
  marketCap: number;
}

interface DetailsModalProps {
  ticker: string | null;
  trend?: string | null;
  onClose: () => void;
}

export const DetailsModal: React.FC<DetailsModalProps> = ({ ticker, trend, onClose }) => {
  const [activeTab, setActiveTab] = useState<'fundamentals' | 'news' | 'competitors'>('fundamentals');
  const [details, setDetails] = useState<CompanyDetails | null>(null);
  const [newsData, setNewsData] = useState<NewsResponse | null>(null);
  const [peers, setPeers] = useState<PeerData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ticker) return;

    const fetchAllData = async () => {
      setLoading(true);
      setError(null);
      setDetails(null);
      setNewsData(null);
      setPeers([]);

      try {
        const trendParam = trend ? `&trend=${encodeURIComponent(trend)}` : '';
        const [detailsRes, newsRes, peersRes] = await Promise.all([
          fetch(`/api/company-details?ticker=${ticker}${trendParam}`),
          fetch(`/api/news?ticker=${ticker}`),
          fetch(`/api/peers?ticker=${ticker}`)
        ]);

        if (!detailsRes.ok) throw new Error('Failed to load company details');
        const detailsData = await detailsRes.json();
        setDetails(detailsData);

        if (newsRes.ok) {
          const nData = await newsRes.json();
          setNewsData(nData);
        }

        if (peersRes.ok) {
          const pData = await peersRes.json();
          setPeers(pData);
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

  const formatCurrency = (num: number, decimals = 2) => {
    if (!num || num === 0) return 'N/A';
    return `$${new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(num)}`;
  };

  const formatLargeAmount = (num: number) => {
    if (!num || num === 0) return 'N/A';
    if (num >= 1e12) return `$${(num / 1e12).toFixed(2)}T`;
    if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
    if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
    return `$${new Intl.NumberFormat('en-US').format(num)}`;
  };

  const getSentimentColor = (sentiment: string) => {
    if (sentiment === 'Bullish') return 'text-emerald-400 bg-emerald-950/40 border-emerald-900/50';
    if (sentiment === 'Bearish') return 'text-rose-400 bg-rose-950/40 border-rose-900/50';
    return 'text-zinc-400 bg-zinc-900 border-zinc-800';
  };

  const getScorePercentage = (score: number) => {
    // Maps score (-1.0 to 1.0) to percentage (0% to 100%)
    return ((score + 1) / 2) * 100;
  };

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
            {details && (
              <p className="text-xs text-brand-light mt-1 font-mono">
                {details.sector} • {details.industry}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-brand-text font-mono text-sm border border-zinc-800 hover:border-zinc-700 bg-zinc-950/40 p-1 px-2.5 rounded transition cursor-pointer"
          >
            [ESC] CLOSE
          </button>
        </div>

        {/* Loading / Error States */}
        {loading && (
          <div className="flex-1 py-32 text-center text-xs font-mono text-zinc-500">
            <span className="inline-block animate-spin mr-2">⚙</span> Fetching deep fundamentals & AI sentiment scorecards...
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
              <button
                onClick={() => setActiveTab('fundamentals')}
                className={`py-3 px-4 font-mono text-xs border-b-2 font-semibold transition-all cursor-pointer ${
                  activeTab === 'fundamentals'
                    ? 'border-brand-green text-brand-green'
                    : 'border-transparent text-zinc-400 hover:text-zinc-200'
                }`}
              >
                [01] DEEP METRICS
              </button>
              <button
                onClick={() => setActiveTab('news')}
                className={`py-3 px-4 font-mono text-xs border-b-2 font-semibold transition-all cursor-pointer ${
                  activeTab === 'news'
                    ? 'border-brand-green text-brand-green'
                    : 'border-transparent text-zinc-400 hover:text-zinc-200'
                }`}
              >
                [02] NEWS & AI SENTIMENT
              </button>
              <button
                onClick={() => setActiveTab('competitors')}
                className={`py-3 px-4 font-mono text-xs border-b-2 font-semibold transition-all cursor-pointer ${
                  activeTab === 'competitors'
                    ? 'border-brand-green text-brand-green'
                    : 'border-transparent text-zinc-400 hover:text-zinc-200'
                }`}
              >
                [03] PEERS COMPARISON ({peers.length})
              </button>
            </div>

            {/* Scrollable Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Tab 1: Deep Fundamentals */}
              {activeTab === 'fundamentals' && (
                <div className="space-y-6">
                  {/* Company Description */}
                  <div className="bg-zinc-950/40 border border-zinc-900 p-4 rounded-lg">
                    <h4 className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest font-bold mb-2">Company Overview</h4>
                    <p className="text-xs text-zinc-300 leading-relaxed font-sans">{details.description}</p>
                    {details.valueChainPosition && (
                      <div className="mt-3 p-3 bg-brand-green/5 border border-brand-green/10 rounded font-mono text-[11px] text-zinc-300">
                        <span className="text-brand-green font-bold uppercase tracking-wider block mb-1">
                          Trend Value Chain Position
                        </span>
                        {details.valueChainPosition}
                      </div>
                    )}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 pt-4 border-t border-zinc-900/60 font-mono text-[11px]">
                      <div>
                        <span className="text-zinc-500 block">CEO</span>
                        <span className="text-zinc-200 font-semibold">{details.ceo}</span>
                      </div>
                      <div>
                        <span className="text-zinc-500 block">Website</span>
                        <a
                          href={details.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-brand-green hover:underline"
                        >
                          {details.website.replace('https://', '').replace('www.', '')} ↗
                        </a>
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
                        <span className="text-xs text-zinc-400">YoY Revenue Growth</span>
                      </div>
                      <div className="mt-4 font-mono">
                        {details.yoyRevenueGrowth !== null ? (
                          <span className={`text-2xl font-bold ${details.yoyRevenueGrowth >= 0 ? 'text-brand-green' : 'text-brand-red'}`}>
                            {details.yoyRevenueGrowth >= 0 ? '+' : ''}
                            {details.yoyRevenueGrowth.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-zinc-600 italic">N/A</span>
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
                        {details.peRatio !== null ? (
                          <span>{details.peRatio.toFixed(1)}x</span>
                        ) : (
                          <span className="text-zinc-600 italic">N/A</span>
                        )}
                      </div>
                    </div>

                    {/* Leverage */}
                    <div className="bg-zinc-950/40 border border-zinc-900 p-4 rounded-lg flex flex-col justify-between">
                      <div>
                        <h4 className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest font-bold mb-1">Financial Leverage</h4>
                        <span className="text-xs text-zinc-400">Debt-to-Equity Ratio</span>
                      </div>
                      <div className="mt-4 font-mono text-2xl font-bold text-zinc-200">
                        {details.debtToEquity !== null ? (
                          <span className={details.debtToEquity > 1.5 ? 'text-brand-yellow' : 'text-zinc-200'}>
                            {details.debtToEquity.toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-zinc-600 italic">N/A</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Cash Flow Card */}
                  <div className="bg-zinc-950/40 border border-zinc-900 p-4 rounded-lg flex items-center justify-between font-mono">
                    <div>
                      <h4 className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold mb-1">Free Cash Flow (FCF)</h4>
                      <span className="text-xs text-zinc-400 font-sans">Cash generated after operational reinvestment</span>
                    </div>
                    <div className="text-xl font-bold text-zinc-200">
                      {details.freeCashFlow !== null ? (
                        <span className={details.freeCashFlow >= 0 ? 'text-brand-green' : 'text-brand-red'}>
                          {formatLargeAmount(details.freeCashFlow)}
                        </span>
                      ) : (
                        <span className="text-zinc-600 italic">N/A</span>
                      )}
                    </div>
                  </div>

                  {/* Financial Statement Summary */}
                  {details.recentFinancials && (
                    <div className="bg-zinc-950/40 border border-zinc-900 p-4 rounded-lg">
                      <h4 className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest font-bold mb-3">
                        Recent Annual Statements Summary (Period Ending: {details.recentFinancials.date})
                      </h4>
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-zinc-900 text-xs font-mono">
                          <thead>
                            <tr className="text-zinc-500 text-left">
                              <th className="py-2 pr-4 font-normal">Income Statement</th>
                              <th className="py-2 px-4 font-normal">Balance Sheet</th>
                              <th className="py-2 pl-4 font-normal">Cash Flow</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-900/60 text-zinc-300">
                            <tr>
                              <td className="py-2.5 pr-4 space-y-1">
                                <div className="flex justify-between">
                                  <span className="text-zinc-500">Revenue:</span>
                                  <span>{formatLargeAmount(details.recentFinancials.revenue)}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-zinc-500">Net Income:</span>
                                  <span className={details.recentFinancials.netIncome >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                                    {formatLargeAmount(details.recentFinancials.netIncome)}
                                  </span>
                                </div>
                              </td>
                              <td className="py-2.5 px-4 space-y-1">
                                <div className="flex justify-between">
                                  <span className="text-zinc-500">Total Debt:</span>
                                  <span>{formatLargeAmount(details.recentFinancials.totalDebt)}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-zinc-500">Total Equity:</span>
                                  <span>{formatLargeAmount(details.recentFinancials.totalEquity)}</span>
                                </div>
                              </td>
                              <td className="py-2.5 pl-4 space-y-1">
                                <div className="flex justify-between">
                                  <span className="text-zinc-500">Operating Cash:</span>
                                  <span>{formatLargeAmount(details.recentFinancials.operatingCashFlow)}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-zinc-500">Capex:</span>
                                  <span>{formatLargeAmount(details.recentFinancials.capitalExpenditure)}</span>
                                </div>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
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
                            <span className="text-xs text-zinc-400">Gemini news-momentum consensus evaluation</span>
                          </div>
                          <span className={`px-3 py-1 rounded text-xs font-bold border font-mono ${getSentimentColor(newsData.sentiment.sentiment)}`}>
                            {newsData.sentiment.sentiment}
                          </span>
                        </div>

                        {/* Sentiment Scale Bar */}
                        <div className="space-y-1.5 font-mono">
                          <div className="h-2 w-full bg-zinc-900 border border-zinc-800 rounded-full overflow-hidden relative">
                            {/* Marker */}
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
                      </div>

                      {/* News List */}
                      <div className="space-y-4">
                        <h4 className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest font-bold">Related Headlines</h4>
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
                                <div className="text-[9px] font-mono text-zinc-600 mt-2">{item.publishedDate}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="text-center font-mono text-xs text-zinc-600 py-12">Failed to load news scorecard.</div>
                  )}
                </div>
              )}

              {/* Tab 3: Competitors & Peers */}
              {activeTab === 'competitors' && (
                <div className="space-y-4">
                  <h4 className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest font-bold mb-3">Industry Direct Peers Comparison</h4>
                  {peers.length === 0 ? (
                    <div className="py-12 text-center border border-zinc-900 border-dashed rounded-lg">
                      <p className="text-xs font-mono text-zinc-600">No peers found for this asset class on the FMP database.</p>
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
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-900 bg-zinc-950/20 text-zinc-300">
                          {/* Anchor Company */}
                          <tr className="bg-brand-green/5 font-semibold text-brand-green">
                            <td className="py-3.5 px-4 font-bold">{ticker} (Active)</td>
                            <td className="py-3.5 px-4">{details.companyName}</td>
                            <td className="py-3.5 px-4 text-right">{formatCurrency(details.stockPrice)}</td>
                            <td className="py-3.5 px-4 text-right">{formatLargeAmount(details.marketCap)}</td>
                          </tr>
                          {/* Peers */}
                          {peers.map((peer) => (
                            <tr key={peer.symbol} className="hover:bg-zinc-900/20">
                              <td className="py-3 px-4 font-bold">{peer.symbol}</td>
                              <td className="py-3 px-4 text-zinc-400">{peer.name}</td>
                              <td className="py-3 px-4 text-right">{formatCurrency(peer.price)}</td>
                              <td className="py-3 px-4 text-right">{formatLargeAmount(peer.marketCap)}</td>
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

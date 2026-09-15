'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Header } from '@/components/Header';
import { InputPanel } from '@/components/InputPanel';
import { ResultsTable } from '@/components/ResultsTable';
import { ValidationAlerts } from '@/components/ValidationAlerts';
import { TrendReportCard } from '@/components/TrendReportCard';
import { ScoringSliders } from '@/components/ScoringSliders';
import { HistoryView } from '@/components/HistoryView';
import { WatchlistView } from '@/components/WatchlistView';
import { PortfoliosView } from '@/components/PortfoliosView';
import { DetailsModal } from '@/components/DetailsModal';
import { ResearchPanel } from '@/components/ResearchPanel';
import { ResearchReport } from '@/components/ResearchReport';
import { ScoredCompanyData, Filters, TrendAnalysis, TrendResearchReport } from '@/lib/types';
import { calculateCompanyScores } from '@/lib/scoring';

export default function Home() {
  const [activeTab, setActiveTab] = useState<string>('research');
  const [inspectedTicker, setInspectedTicker] = useState<string | null>(null);
  const [researchReport, setResearchReport] = useState<(TrendResearchReport & { scanId: string }) | null>(null);
  
  const [filters, setFilters] = useState<Filters>({
    marketCap: [],
    exchange: [],
    currentPrice: null,
  });
  
  const [trends, setTrends] = useState<string[]>(['']);
  const [trendAnalyses, setTrendAnalyses] = useState<Record<string, TrendAnalysis>>({});
  const [showDiscoverButton, setShowDiscoverButton] = useState<boolean>(false);
  const [weights, setWeights] = useState({
    relevance: 30,
    convergence: 30,
    valuation: 20,
    health: 20,
  });

  const [results, setResults] = useState<ScoredCompanyData[]>([]);
  const [invalidTickers, setInvalidTickers] = useState<string[]>([]);
  const [validationBypassed, setValidationBypassed] = useState<boolean>(false);
  
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [isDiscovering, setIsDiscovering] = useState<boolean>(false);
  const [loadingStep, setLoadingStep] = useState<'idle' | 'analyzing' | 'discovering' | 'enriching' | 'completed'>('idle');
  const [error, setError] = useState<string | null>(null);

  // Watchlist tracker
  const [watchlistTickers, setWatchlistTickers] = useState<Set<string>>(new Set());

  const fetchWatchlist = async () => {
    try {
      const res = await fetch('/api/watchlist');
      if (res.ok) {
        const data = (await res.json()) as { ticker: string }[];
        const tickers = new Set<string>(data.map((item) => item.ticker.toUpperCase()));
        setWatchlistTickers(tickers);
      }
    } catch (err) {
      console.error('Failed to sync watchlist tickers:', err);
    }
  };

  useEffect(() => {
    fetchWatchlist();
  }, []);

  const handleToggleWatchlist = useCallback(async (company: ScoredCompanyData) => {
    const upperTicker = company.ticker.toUpperCase();
    const isStarred = watchlistTickers.has(upperTicker);

    try {
      if (isStarred) {
        const res = await fetch(`/api/watchlist?ticker=${upperTicker}`, {
          method: 'DELETE',
        });
        if (res.ok) {
          setWatchlistTickers((prev) => {
            const next = new Set(prev);
            next.delete(upperTicker);
            return next;
          });
        }
      } else {
        const res = await fetch('/api/watchlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ticker: company.ticker,
            companyName: company.companyName,
            priceAtAdd: company.stockPrice || 0,
            notes: company.rationale,
            tags: company.trendsMatched || [],
          }),
        });
        if (res.ok) {
          setWatchlistTickers((prev) => {
            const next = new Set(prev);
            next.add(upperTicker);
            return next;
          });
        }
      }
    } catch (err) {
      console.error('Failed to toggle watchlist ticker status:', err);
    }
  }, [watchlistTickers]);

  const handleRestoreSearch = useCallback(async (id: string) => {
    setError(null);
    setLoadingStep('idle');
    try {
      const res = await fetch(`/api/history?id=${id}`);
      if (!res.ok) {
        throw new Error('Failed to restore search snapshot');
      }
      const data = await res.json();
      
      setTrends(data.search.trends);
      setFilters(data.search.filters);
      setTrendAnalyses(data.search.trendAnalysis || {});
      setResults(data.companies || []);
      setInvalidTickers([]);
      setValidationBypassed(false);
      setShowDiscoverButton(true);
      setLoadingStep('completed');
      setActiveTab('discover');
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Could not load search history snapshot';
      setError(errorMessage);
    }
  }, []);

  const handleAnalyzeTrends = useCallback(async () => {
    const activeTrends = trends.filter((t) => t.trim().length > 0);
    if (activeTrends.length === 0) {
      setError('Please enter at least one investment thesis to analyze.');
      return;
    }

    setIsAnalyzing(true);
    setLoadingStep('analyzing');
    setError(null);
    setTrendAnalyses({});
    setShowDiscoverButton(false);
    setResults([]);
    setInvalidTickers([]);

    try {
      const analyses: Record<string, TrendAnalysis> = {};
      for (const trendText of activeTrends) {
        const response = await fetch('/api/analyze-trend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trend: trendText.trim() }),
        });

        if (!response.ok) {
          const errJson = (await response.json()) as { error?: string };
          throw new Error(errJson.error || `Failed to analyze thesis: "${trendText}"`);
        }

        const data = (await response.json()) as { analysis: TrendAnalysis };
        analyses[trendText] = data.analysis;
      }

      setTrendAnalyses(analyses);
      setShowDiscoverButton(true);
      setLoadingStep('idle');
    } catch (e: unknown) {
      console.error(e);
      const errorMessage = e instanceof Error ? e.message : 'An unexpected error occurred during trend analysis.';
      setError(errorMessage);
      setLoadingStep('idle');
    } finally {
      setIsAnalyzing(false);
    }
  }, [trends]);

  const handleDiscoverCandidates = useCallback(async () => {
    const activeTrends = trends.filter((t) => t.trim().length > 0);
    if (activeTrends.length === 0) {
      setError('Please enter at least one investment thesis.');
      return;
    }

    setIsDiscovering(true);
    setLoadingStep('discovering');
    setError(null);
    setResults([]);
    setInvalidTickers([]);

    try {
      // 1. Scan market for companies matching active trends
      const discoverResponse = await fetch('/api/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trends: activeTrends, filters }),
      });

      if (!discoverResponse.ok) {
        const errJson = (await discoverResponse.json()) as { error?: string };
        throw new Error(errJson.error || 'Failed to discover companies matching your theses.');
      }

      const discoverData = (await discoverResponse.json()) as {
        companies: ScoredCompanyData[];
        invalidTickers: string[];
        validationMetrics?: { validationBypassed?: boolean };
      };
      
      const discovered = discoverData.companies || [];
      const droppedTickers = discoverData.invalidTickers || [];
      
      setInvalidTickers(droppedTickers);
      setValidationBypassed(!!discoverData.validationMetrics?.validationBypassed);

      if (discovered.length === 0) {
        setError('No valid companies matched your filters. Try broadening your criteria or revising your theses.');
        setLoadingStep('idle');
        setIsDiscovering(false);
        return;
      }

      // 2. Fetch financial metrics and P/E ratios for all candidates
      setLoadingStep('enriching');
      const tickers = discovered.map((c) => c.ticker);

      const enrichResponse = await fetch('/api/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers }),
      });

      if (!enrichResponse.ok) {
        const errJson = (await enrichResponse.json()) as { error?: string };
        throw new Error(errJson.error || 'Failed to enrich companies with fundamental financials.');
      }

      const enrichedData = (await enrichResponse.json()) as ScoredCompanyData[];
      const enrichedMap = new Map<string, ScoredCompanyData>(
        enrichedData.map((e) => [e.ticker.toUpperCase(), e])
      );

      // 3. Combine discovery metadata with enriched pricing
      const mergedResults: ScoredCompanyData[] = discovered.map((c) => {
        const enrichInfo = enrichedMap.get(c.ticker.toUpperCase());
        return {
          ...c,
          stockPrice: enrichInfo?.stockPrice ?? 0,
          marketCap: enrichInfo?.marketCap ?? 0,
          exchange: enrichInfo?.exchange ?? null,
          peRatio: enrichInfo?.peRatio ?? null,
          debtToEquity: enrichInfo?.debtToEquity ?? null,
          growth1Y: enrichInfo?.growth1Y ?? null,
          growth5Y: enrichInfo?.growth5Y ?? null,
          dataQuality: enrichInfo?.dataQuality ?? {
            priceSource: 'unavailable',
          },
        };
      });

      // 4. Calculate weighted composite scores client-side
      const scoredResults = calculateCompanyScores(mergedResults, weights);
      
      // Sort primarily by composite score
      scoredResults.sort((a, b) => b.compositeScore - a.compositeScore);

      setResults(scoredResults);
      setLoadingStep('completed');

      // 5. Auto-save completed research snapshot to DB History
      try {
        await fetch('/api/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trends: activeTrends,
            filters: {
              marketCap: filters.marketCap,
              exchange: filters.exchange,
              currentPrice: filters.currentPrice,
            },
            trendAnalysis: trendAnalyses,
            results: scoredResults,
          }),
        });
      } catch (hErr) {
        console.error('Failed to log search snapshot to history database:', hErr);
      }
    } catch (e: unknown) {
      console.error(e);
      const errorMessage = e instanceof Error ? e.message : 'An unexpected error occurred during company discovery.';
      setError(errorMessage);
      setLoadingStep('idle');
    } finally {
      setIsDiscovering(false);
    }
  }, [trends, filters, weights, trendAnalyses]);

  const handleSelectAdjacentTrend = useCallback((adjTrend: string) => {
    setTrends((prev) => {
      const emptyIdx = prev.findIndex((t) => !t.trim());
      if (emptyIdx !== -1) {
        const updated = [...prev];
        updated[emptyIdx] = adjTrend;
        return updated;
      }
      if (prev.length < 3) {
        return [...prev, adjTrend];
      }
      const updated = [...prev];
      updated[2] = adjTrend;
      return updated;
    });
  }, []);

  const handleWeightsChange = useCallback((newWeights: typeof weights) => {
    setWeights(newWeights);
    setResults((prev) => {
      if (prev.length === 0) return prev;
      const reCalculated = calculateCompanyScores(prev, newWeights);
      reCalculated.sort((a, b) => b.compositeScore - a.compositeScore);
      return reCalculated;
    });
  }, []);

  // Client-side stock price threshold filtering
  let filteredResults = results;
  if (filters.currentPrice) {
    const priceLimit = parseFloat(filters.currentPrice);
    filteredResults = results.filter(
      (company) => company.stockPrice > 0 && company.stockPrice < priceLimit
    );
  }

  const activeAnalyses = Object.entries(trendAnalyses);
  const isLoading = isAnalyzing || isDiscovering;

  return (
    <div className="min-h-screen bg-brand-primary text-brand-text font-sans terminal-grid pb-16">
      <Header activeTab={activeTab} setActiveTab={(tab) => {
        setActiveTab(tab);
        if (tab === 'watchlist') fetchWatchlist();
      }} />
      
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8">
        {/* Terminal Header Info */}
        <div className="bg-brand-secondary/40 border border-brand-border/40 px-5 py-3 rounded-lg mb-6 flex flex-wrap justify-between items-center text-xs font-mono text-brand-light gap-2">
          <div className="flex items-center space-x-2">
            <span className="w-2.5 h-2.5 bg-brand-green rounded-full inline-block animate-ping" />
            <span>TERMINAL STATUS: ONLINE</span>
          </div>
          <div className="flex items-center space-x-4">
            <span>AI: CLAUDE + GEMINI (RESEARCH)</span>
            <span>DATA: FINNHUB + YAHOO FINANCE</span>
          </div>
        </div>

        {/* Tab Content Router */}
        {activeTab === 'research' && (
          <div className="space-y-8">
            <ResearchPanel onReportGenerated={setResearchReport} />
            {researchReport && (
              <ResearchReport
                report={researchReport}
                onLoadThesis={(thesis) => {
                  setTrends([thesis]);
                  setActiveTab('discover');
                }}
              />
            )}
          </div>
        )}

        {activeTab === 'discover' && (
          <div className="space-y-8">
            <InputPanel
              trends={trends}
              setTrends={setTrends}
              filters={filters}
              setFilters={setFilters}
              onAnalyze={handleAnalyzeTrends}
              onDiscover={handleDiscoverCandidates}
              isAnalyzing={isAnalyzing}
              isDiscovering={isDiscovering}
              showDiscoverButton={showDiscoverButton}
            />

            {/* Trend Report Cards */}
            {activeAnalyses.length > 0 && (
              <div className="space-y-6">
                <h2 className="text-sm font-bold font-mono uppercase tracking-widest text-zinc-400">
                  Generated Trend Diagnostics
                </h2>
                <div className="grid grid-cols-1 gap-6">
                  {activeAnalyses.map(([trendText, analysis]) => (
                    <TrendReportCard
                      key={trendText}
                      trend={trendText}
                      analysis={analysis}
                      onSelectAdjacentTrend={handleSelectAdjacentTrend}
                    />
                  ))}
                </div>
              </div>
            )}

            {isLoading && (
              <div className="bg-brand-secondary/50 border border-brand-border/60 p-8 rounded-xl flex flex-col items-center justify-center text-center shadow-lg">
                <svg className="animate-spin h-10 w-10 text-brand-green mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <p className="text-sm font-semibold tracking-wide text-brand-text uppercase font-mono">
                  {loadingStep === 'analyzing'
                    ? 'AI Diagnostics compiling trend maturity stage and Catalysts...'
                    : loadingStep === 'discovering'
                    ? 'AI Model scanning market for candidates matching theses intersection...'
                    : 'Fetching live prices, fundamentals & price history...'}
                </p>
                <p className="text-xs text-brand-light mt-1.5 font-mono">
                  {loadingStep === 'analyzing'
                    ? 'Assessing estimated TAM size, triggers, and macro risks'
                    : loadingStep === 'discovering'
                    ? 'Claude is examining product convergence and relevance alignment'
                    : 'Calculating 1-year and 5-year growth fundamentals and parsing P/E valuations'}
                </p>
              </div>
            )}

            {error && (
              <div className="bg-brand-red/5 border border-brand-red/30 p-5 rounded-xl flex items-start space-x-3.5 shadow-lg">
                <div className="bg-brand-red/10 p-2 rounded-lg text-brand-red shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h4 className="text-sm font-bold text-brand-red uppercase tracking-wider">Discovery Failure</h4>
                  <p className="text-xs text-brand-light mt-1.5 leading-relaxed">{error}</p>
                </div>
              </div>
            )}

            {/* Invalid Ticker Alerts */}
            {!isLoading && (invalidTickers.length > 0 || validationBypassed) && (
              <ValidationAlerts invalidTickers={invalidTickers} bypassed={validationBypassed} />
            )}

            {/* Matrix Result & Weight Slider Dashboard */}
            {!isLoading && results.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                <div className="lg:col-span-9 order-2 lg:order-1">
                  {filteredResults.length === 0 ? (
                    <div className="bg-brand-secondary/40 border border-brand-border/40 p-8 rounded-xl text-center shadow-lg">
                      <p className="text-sm font-semibold text-brand-light">
                        No companies matched your current stock price limits.
                      </p>
                      <p className="text-xs text-brand-light/60 mt-1">
                        Try toggling to &quot;Show all prices&quot; or selecting a higher limit.
                      </p>
                    </div>
                  ) : (
                    <ResultsTable
                      data={filteredResults}
                      watchlistTickers={watchlistTickers}
                      onToggleWatchlist={handleToggleWatchlist}
                    />
                  )}
                </div>

                <div className="lg:col-span-3 order-1 lg:order-2">
                  <ScoringSliders weights={weights} onChangeWeights={handleWeightsChange} />
                </div>
              </div>
            )}

            {/* Empty State Prompt */}
            {!isLoading && !error && results.length === 0 && (
              <div className="text-center max-w-lg mx-auto bg-brand-secondary/20 border border-brand-border/20 p-8 rounded-2xl shadow-xl">
                <div className="bg-brand-accent/30 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 border border-brand-border/40">
                  <span className="text-brand-green font-mono text-xl animate-pulse">⚡</span>
                </div>
                <p className="text-sm font-semibold text-brand-text">Describe an emerging trend to search</p>
                <p className="text-xs text-brand-light mt-2 leading-relaxed">
                  Describe technology shifts, consumer behavior changes, or macro catalysts in the text fields above. 
                  Click <strong>Analyze Trends</strong> to generate diagnostics and then <strong>Discover Companies</strong>.
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <HistoryView onRestoreSearch={handleRestoreSearch} isActive={activeTab === 'history'} />
        )}

        {activeTab === 'watchlist' && (
          <WatchlistView isActive={activeTab === 'watchlist'} onInspect={setInspectedTicker} />
        )}

        {activeTab === 'portfolios' && (
          <PortfoliosView isActive={activeTab === 'portfolios'} onInspect={setInspectedTicker} />
        )}
      </main>

      {inspectedTicker && (
        <DetailsModal 
          ticker={inspectedTicker} 
          trend={trends.find(t => t.trim() !== '') || null}
          onClose={() => setInspectedTicker(null)} 
        />
      )}
    </div>
  );
}

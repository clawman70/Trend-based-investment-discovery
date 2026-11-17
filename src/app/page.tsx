'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Header } from '@/components/Header';
import { InputPanel } from '@/components/InputPanel';
import { ResultsTable } from '@/components/ResultsTable';
import { ValidationAlerts } from '@/components/ValidationAlerts';
import { TrendReportCard } from '@/components/TrendReportCard';
import { ScoringSliders } from '@/components/ScoringSliders';
import { HistoryView } from '@/components/HistoryView';
import { ScorecardView } from '@/components/ScorecardView';
import { WatchlistView } from '@/components/WatchlistView';
import { PortfoliosView } from '@/components/PortfoliosView';
import { DetailsModal } from '@/components/DetailsModal';
import { ResearchPanel } from '@/components/ResearchPanel';
import { ResearchReport } from '@/components/ResearchReport';
import { SpendCapBanner } from '@/components/SpendCapBanner';
import { ScoredCompanyData, Filters, ScoringWeights, TrendAnalysis, TrendResearchReport } from '@/lib/types';
import { buildScoringConfig, DEFAULT_WEIGHTS, parseScoringConfig, scoreAndRank } from '@/lib/scoring';
import { applyRealDataFilters } from '@/lib/resultFilters';
import { buildRationaleNote } from '@/lib/rationale';

export default function Home() {
  const [activeTab, setActiveTab] = useState<string>('research');
  const [inspectedTicker, setInspectedTicker] = useState<string | null>(null);
  const [researchReport, setResearchReport] = useState<(TrendResearchReport & { scanId: string }) | null>(null);
  // Bug B9 (the track-record chain). currentSearchId = the saved history snapshot the
  // results on screen came from (a fresh run once its auto-save finishes, or a restored
  // one). Starring a company stores it as the watchlist item's sourceSearchId.
  const [currentSearchId, setCurrentSearchId] = useState<string | null>(null);
  // A Research-tab thesis loaded into Discovery: its audit record id, so the search it
  // leads to can be written back to that record.
  const [pendingLoadedThesis, setPendingLoadedThesis] = useState<{ id: string; thesis: string } | null>(null);
  // True when the results on screen were restored from History. Their prices are from the
  // search date, so they must not become a watchlist cost basis dated today (found during
  // the Phase D live check: it made gain/loss and "vs SPY" compare mismatched windows).
  const [resultsFromHistory, setResultsFromHistory] = useState<boolean>(false);

  const [filters, setFilters] = useState<Filters>({
    marketCap: [],
    exchange: [],
    currentPrice: null,
  });
  
  const [trends, setTrends] = useState<string[]>(['']);
  const [trendAnalyses, setTrendAnalyses] = useState<Record<string, TrendAnalysis>>({});
  const [showDiscoverButton, setShowDiscoverButton] = useState<boolean>(false);
  const [weights, setWeights] = useState<ScoringWeights>(DEFAULT_WEIGHTS);
  // Theses that actually returned results in the current run. 1 = convergence is left out
  // of the score and its slider is greyed out (decision D2).
  const [thesesRun, setThesesRun] = useState<number>(1);

  const [results, setResults] = useState<ScoredCompanyData[]>([]);
  const [invalidTickers, setInvalidTickers] = useState<string[]>([]);
  const [validationBypassed, setValidationBypassed] = useState<boolean>(false);
  // Theses whose discovery call failed in a multi-thesis run (bug B4) — shown as a warning
  const [failedTrends, setFailedTrends] = useState<string[]>([]);
  
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
            // Only send a real price. If it's missing (0), the watchlist route fetches a
            // live quote itself, and stores N/A if that also fails (bug B8).
            // A restored snapshot's price is from the search date, so send none and let the
            // server fetch today's quote: the cost basis is the price on the day you star it.
            priceAtAdd: !resultsFromHistory && company.stockPrice > 0 ? company.stockPrice : null,
            // The saved search this pick came from (bug B9). Null if the auto-save hasn't
            // finished yet or failed; the star still works, it just isn't linked.
            sourceSearchId: currentSearchId ?? undefined,
            // Built from the per-thesis rationale map (bug B1: used to read a field that was never set)
            notes: buildRationaleNote(company.rationales),
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
  }, [watchlistTickers, currentSearchId, resultsFromHistory]);

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

      // Re-score with the weights and theses-run count saved with the snapshot, so it
      // ranks exactly as it did when saved. Snapshots from before Phase C have no saved
      // config: they're re-scored with the current weights, and any data they didn't
      // store (P/S, revenue growth) shows as missing.
      const savedConfig = parseScoringConfig(data.search.scoringConfig);
      const restoredThesesRun = savedConfig?.thesesRun ?? (data.search.trends?.length || 1);
      const restoredWeights = savedConfig?.weights ?? weights;
      setWeights(restoredWeights);
      setThesesRun(restoredThesesRun);
      setResults(scoreAndRank(data.companies || [], restoredWeights, { thesesRun: restoredThesesRun }));
      setInvalidTickers([]);
      setValidationBypassed(false);
      setFailedTrends([]);
      setCurrentSearchId(id); // stars from a restored search link back to it (B9)
      setResultsFromHistory(true);
      setShowDiscoverButton(true);
      setLoadingStep('completed');
      setActiveTab('discover');
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Could not load search history snapshot';
      setError(errorMessage);
    }
  }, [weights]);

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
      // Run all theses in parallel instead of one at a time — was the slowest part of
      // a multi-thesis run for no reason, since each call is independent.
      const results = await Promise.all(
        activeTrends.map(async (trendText) => {
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
          return [trendText, data.analysis] as const;
        })
      );

      const analyses: Record<string, TrendAnalysis> = Object.fromEntries(results);
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
    setFailedTrends([]);
    setCurrentSearchId(null); // set again once this run's snapshot is saved
    setResultsFromHistory(false);

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
        failedTrends?: string[];
        thesesRun?: number;
        validationMetrics?: { validationBypassed?: boolean };
      };
      // Server counts only theses that succeeded (bug B4); fall back to what was submitted
      const runThesesCount = discoverData.thesesRun ?? activeTrends.length;
      setThesesRun(runThesesCount);
      
      const discovered = discoverData.companies || [];
      const droppedTickers = discoverData.invalidTickers || [];
      
      setInvalidTickers(droppedTickers);
      setValidationBypassed(!!discoverData.validationMetrics?.validationBypassed);
      setFailedTrends(discoverData.failedTrends || []);

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
          priceToSales: enrichInfo?.priceToSales ?? null,
          preRevenue: enrichInfo?.preRevenue ?? null,
          lossMaking: enrichInfo?.lossMaking ?? null,
          revenueGrowthYoY: enrichInfo?.revenueGrowthYoY ?? null,
          change6M: enrichInfo?.change6M ?? null,
          rallied6M: enrichInfo?.rallied6M ?? null,
          dataQuality: enrichInfo?.dataQuality ?? {
            priceSource: 'unavailable',
          },
        };
      });

      // 3b. Enforce the market-cap AND exchange filters against real (enriched) data — the
      // AI only sees them as text hints, so a company whose actual market cap or listing
      // exchange doesn't fit gets dropped here rather than trusted from the model's answer.
      // Unknown values are kept (see src/lib/resultFilters.ts).
      const capFilteredResults = applyRealDataFilters(mergedResults, filters);

      if (capFilteredResults.length === 0) {
        setError('No companies matched your filters after checking real market cap and exchange data. Try broadening your market-cap or exchange selection.');
        setLoadingStep('idle');
        setIsDiscovering(false);
        return;
      }

      // 4. Calculate weighted composite scores client-side, best first (src/lib/scoring.ts)
      const scoredResults = scoreAndRank(capFilteredResults, weights, { thesesRun: runThesesCount });

      setResults(scoredResults);
      setLoadingStep('completed');

      // 5. Auto-save completed research snapshot to DB History
      try {
        const historyRes = await fetch('/api/history', {
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
            // Saved so a restored search re-scores the same way (and for the Phase D track record)
            scoringConfig: buildScoringConfig(weights, runThesesCount),
            results: scoredResults,
          }),
        });

        // B9: keep the saved search's id so stars link to it, and write it back to the
        // Research-tab thesis that led here. Only linked when that exact thesis text was
        // part of this run: an edited thesis is a different thesis.
        const saved = historyRes.ok ? ((await historyRes.json()) as { id?: string }) : null;
        if (saved?.id) {
          setCurrentSearchId(saved.id);
          if (pendingLoadedThesis && activeTrends.some((t) => t.trim() === pendingLoadedThesis.thesis.trim())) {
            await fetch('/api/research/load', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: pendingLoadedThesis.id, searchId: saved.id }),
            }).catch((linkErr) => console.error('Failed to link the loaded thesis to its search:', linkErr));
            setPendingLoadedThesis(null);
          }
        }
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
  }, [trends, filters, weights, trendAnalyses, pendingLoadedThesis]);

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

  const handleWeightsChange = useCallback((newWeights: ScoringWeights) => {
    setWeights(newWeights);
    setResults((prev) => (prev.length === 0 ? prev : scoreAndRank(prev, newWeights, { thesesRun })));
  }, [thesesRun]);

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

        <SpendCapBanner />

        {/* Tab Content Router */}
        {activeTab === 'research' && (
          <div className="space-y-8">
            <ResearchPanel onReportGenerated={setResearchReport} />
            {researchReport && (
              <ResearchReport
                report={researchReport}
                onLoadThesis={(thesis, loadedId) => {
                  setPendingLoadedThesis(loadedId ? { id: loadedId, thesis } : null);
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
            {!isLoading && (invalidTickers.length > 0 || validationBypassed || failedTrends.length > 0) && (
              <ValidationAlerts invalidTickers={invalidTickers} bypassed={validationBypassed} failedTrends={failedTrends} />
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
                      thesesRun={thesesRun}
                      watchlistTickers={watchlistTickers}
                      onToggleWatchlist={handleToggleWatchlist}
                    />
                  )}
                </div>

                <div className="lg:col-span-3 order-1 lg:order-2">
                  <ScoringSliders weights={weights} onChangeWeights={handleWeightsChange} thesesRun={thesesRun} />
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

        {activeTab === 'scorecard' && <ScorecardView isActive={activeTab === 'scorecard'} />}

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

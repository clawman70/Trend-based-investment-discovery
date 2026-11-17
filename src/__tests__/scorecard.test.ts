import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import type { FinnhubQuote } from '../lib/finnhubService';

// In-memory stand-in for the Postgres cache, so caching behavior is observable
const { cache } = vi.hoisted(() => ({ cache: new Map<string, unknown>() }));

vi.mock('../lib/dbHelper', () => ({
  isDbAvailable: vi.fn().mockResolvedValue(false),
  getCachedData: vi.fn(async (key: string) => cache.get(key) ?? null),
  setCachedData: vi.fn(async (key: string, _type: string, data: unknown) => {
    cache.set(key, data);
  }),
}));

vi.mock('../lib/finnhubService', () => ({
  isFinnhubConfigured: vi.fn(() => true),
  fetchQuote: vi.fn(),
}));

vi.mock('../lib/yahooService', () => ({
  fetchDailyCloses: vi.fn(),
  fetchSplitEvents: vi.fn(),
}));

import { GET as scorecardGET } from '../app/api/scorecard/route';
import * as dbHelper from '../lib/dbHelper';
import * as finnhubService from '../lib/finnhubService';
import * as yahooService from '../lib/yahooService';
import { benchmarkCloseCacheKey, PERMANENT_CACHE_MS } from '../lib/benchmark';
import { memorySearches, memorySearchResults } from '../lib/memoryStore';

const NOW = new Date('2026-11-17T22:00:00Z'); // 17:00 EST, after the close

const QUOTES: Record<string, number> = { AAA: 130, BBB: 40, CCC: 12, SPY: 732.44 }; // GONE: delisted

function seedSearch(id: string, createdAt: string, picks: { ticker: string; price: number; score: number }[]) {
  memorySearches.push({ id, createdAt: new Date(createdAt), trends: [`thesis ${id}`], filters: {}, trendAnalysis: {}, scoringConfig: null });
  for (const p of picks) {
    memorySearchResults.push({
      id: crypto.randomUUID(),
      searchId: id,
      ticker: p.ticker,
      companyName: p.ticker,
      rationale: '',
      trendMatched: [],
      financialData: { stockPrice: p.price },
      dataQuality: {},
      compositeScore: p.score,
      convergenceScore: null,
    });
  }
}

const load = async () => {
  const res = await scorecardGET();
  expect(res.status).toBe(200);
  return res.json();
};

describe('GET /api/scorecard (Phase D)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    cache.clear();
    memorySearches.length = 0;
    memorySearchResults.length = 0;
    vi.mocked(finnhubService.isFinnhubConfigured).mockReturnValue(true);
    vi.mocked(finnhubService.fetchQuote).mockReset().mockImplementation(async (symbol: string) =>
      QUOTES[symbol] ? ({ c: QUOTES[symbol] } as FinnhubQuote) : null
    );
    vi.mocked(yahooService.fetchDailyCloses).mockReset().mockResolvedValue([
      { date: new Date('2026-09-15T13:30:00Z'), close: 757.39 },
      { date: new Date('2026-11-13T14:30:00Z'), close: 740 }, // Friday
    ]);
    vi.mocked(yahooService.fetchSplitEvents).mockReset().mockResolvedValue([]);

    // September search (Tuesday, 15:09 ET) and a Saturday search; AAA is in both
    seedSearch('sept', '2026-09-15T19:09:50Z', [
      { ticker: 'AAA', price: 100, score: 90 },
      { ticker: 'BBB', price: 50, score: 80 },
      { ticker: 'NOPX', price: 0, score: 70 }, // no stored price
      { ticker: 'GONE', price: 10, score: 60 }, // delisted: no quote today
    ]);
    seedSearch('sat', '2026-11-14T15:00:00Z', [
      { ticker: 'AAA', price: 120, score: 70 },
      { ticker: 'CCC', price: 10, score: 60 },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('makes at most one Finnhub quote call per unique ticker, and none for picks with no saved price', async () => {
    await load();
    const symbols = vi.mocked(finnhubService.fetchQuote).mock.calls.map((c) => c[0]).sort();
    expect(symbols).toEqual(['AAA', 'BBB', 'CCC', 'GONE', 'SPY']);
  });

  it('computes the September row: pick returns, SPY over the same window, difference, hit rate, exclusions', async () => {
    const data = await load();
    const sept = data.searches.find((s: { searchId: string }) => s.searchId === 'sept');

    expect(sept.daysElapsed).toBe(63);
    expect(sept.picksTotal).toBe(4);
    expect(sept.excluded).toEqual({ noStoredPrice: 1, noCurrentPrice: 1 });
    expect(sept.benchmark.startDate).toBe('2026-09-15');
    expect(sept.benchmark.usedPriorClose).toBe(false);
    const spy = ((732.44 - 757.39) / 757.39) * 100; // about -3.29%
    expect(sept.benchmark.return).toBeCloseTo(spy, 6);

    expect(sept.figure.avgPickReturn).toBeCloseTo(5); // AAA +30, BBB -20
    expect(sept.figure.avgExcessReturn).toBeCloseTo(5 - spy, 6);
    expect(sept.figure.hitRate).toBeCloseTo(0.5);
    expect(sept.figure.tooEarly).toBe(true); // 2 picks
    expect(sept.countsInOverall).toBe(true);
  });

  it('a Saturday search is measured from Friday’s SPY close and stays out of the overall figures', async () => {
    const data = await load();
    const sat = data.searches.find((s: { searchId: string }) => s.searchId === 'sat');
    expect(sat.benchmark.startDate).toBe('2026-11-13');
    expect(sat.benchmark.usedPriorClose).toBe(true);
    expect(sat.countsInOverall).toBe(false);
    expect(data.overall.searchesCounted).toBe(1);
    expect(data.overall.searchesTooYoung).toBe(1);
    expect(data.overall.figure.picks).toBe(2);
  });

  it('caches SPY’s past closes permanently; a second load re-asks only the ticker that had no quote', async () => {
    await load();
    expect(yahooService.fetchDailyCloses).toHaveBeenCalledTimes(1); // both dates in one request
    expect(dbHelper.setCachedData).toHaveBeenCalledWith(
      benchmarkCloseCacheKey('2026-09-15'),
      'benchmark',
      { date: '2026-09-15', close: 757.39 },
      PERMANENT_CACHE_MS
    );

    vi.mocked(finnhubService.fetchQuote).mockClear();
    vi.mocked(yahooService.fetchDailyCloses).mockClear();
    await load(); // within 5 minutes: quotes come from the cache
    // An empty answer is never cached (same rule as /api/enrich), so only the delisted
    // ticker is asked again: still at most one call per ticker per load
    expect(vi.mocked(finnhubService.fetchQuote).mock.calls.map((c) => c[0])).toEqual(['GONE']);
    expect(yahooService.fetchDailyCloses).not.toHaveBeenCalled();
  });

  it('when Yahoo history fails, SPY is N/A (nothing cached) and pick returns still show', async () => {
    vi.mocked(yahooService.fetchDailyCloses).mockResolvedValue(null);
    const data = await load();
    const sept = data.searches.find((s: { searchId: string }) => s.searchId === 'sept');
    expect(sept.benchmark.return).toBeNull();
    expect(sept.figure.avgPickReturn).toBeCloseTo(5);
    expect(sept.figure.avgExcessReturn).toBeNull();
    expect(cache.has(benchmarkCloseCacheKey('2026-09-15'))).toBe(false);
  });

  it('adjusts for a split after the search date', async () => {
    vi.mocked(yahooService.fetchSplitEvents).mockImplementation(async (symbol: string) =>
      symbol === 'BBB' ? [{ date: new Date('2026-10-01T13:30:00Z'), numerator: 1, denominator: 10 }] : []
    );
    const data = await load();
    const sept = data.searches.find((s: { searchId: string }) => s.searchId === 'sept');
    const bbb = sept.picks.find((p: { ticker: string }) => p.ticker === 'BBB');
    // 1-for-10 reverse split: $50 then = $500 in today's shares; $40 now is -92%, not -20%
    expect(bbb.startPrice).toBeCloseTo(500);
    expect(bbb.pickReturn).toBeCloseTo(-92);
    expect(sept.splitAdjusted).toBe(1);
  });

  it('without a Finnhub key no quotes are fetched and every pick is excluded as unpriced', async () => {
    vi.mocked(finnhubService.isFinnhubConfigured).mockReturnValue(false);
    const data = await load();
    expect(data.finnhubConfigured).toBe(false);
    expect(finnhubService.fetchQuote).not.toHaveBeenCalled();
    const sept = data.searches.find((s: { searchId: string }) => s.searchId === 'sept');
    expect(sept.figure.picks).toBe(0);
    expect(sept.figure.avgPickReturn).toBeNull();
  });

  it('returns an empty scorecard when there are no saved searches', async () => {
    memorySearches.length = 0;
    memorySearchResults.length = 0;
    const data = await load();
    expect(data.searches).toEqual([]);
    expect(data.overall.searchesTotal).toBe(0);
    expect(finnhubService.fetchQuote).not.toHaveBeenCalled();
  });
});

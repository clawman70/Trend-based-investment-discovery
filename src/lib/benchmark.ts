/**
 * Market data for the track record (Phase D): current quotes, SPY's historical close and
 * split events, each fetched as few times as possible and cached.
 *
 * - Current quotes: Finnhub, one call per UNIQUE ticker per load, through the shared
 *   rate limiter in finnhubService. Same cache key (`quote:TICKER`) and 5-minute rule as
 *   /api/enrich, so a scorecard load right after a discovery run reuses those quotes.
 * - SPY's close on a past date: Yahoo daily history, cached PERMANENTLY (the past doesn't
 *   change). Only final closes are ever cached; see findCloseOnOrBefore().
 * - Split events: Yahoo, cached 24 hours per ticker (a new split can happen any day).
 *
 * The pure math lives in src/lib/trackRecord.ts.
 */
import { getCachedData, setCachedData } from './dbHelper';
import { fetchQuote, FinnhubQuote } from './finnhubService';
import { fetchDailyCloses, fetchSplitEvents } from './yahooService';
import {
  addDays,
  BENCHMARK_TICKER,
  findCloseOnOrBefore,
  ResolvedClose,
  SplitEvent,
  splitFactorAfter,
  splitKey,
} from './trackRecord';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Matches QUOTE_CACHE_MS in /api/enrich: prices go stale fast. */
export const QUOTE_CACHE_MS = 5 * 60 * 1000;
/** "Permanent" for a past close: ten years. */
export const PERMANENT_CACHE_MS = 10 * 365 * MS_PER_DAY;
const SPLITS_CACHE_MS = 24 * 60 * 60 * 1000;
/** How far before the earliest as-of date to request SPY history (covers weekends + holidays). */
const HISTORY_LOOKBACK_DAYS = 10;

export const benchmarkCloseCacheKey = (asOfDate: string) => `benchmark-close:v1:${BENCHMARK_TICKER}:${asOfDate}`;
const splitsCacheKey = (ticker: string) => `splits:v1:${ticker}`;

const isPositive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * Current price for each ticker (uppercase keys). Tickers are de-duplicated first, so each
 * unique ticker costs at most one Finnhub /quote call. A ticker with no quote (delisted,
 * unknown, Finnhub error) is simply missing from the map; callers show it as excluded/N/A.
 */
export async function getCurrentPrices(tickers: string[]): Promise<Map<string, number>> {
  const unique = Array.from(new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean)));
  const prices = new Map<string, number>();

  await Promise.all(
    unique.map(async (ticker) => {
      const key = `quote:${ticker}`;
      const hit = (await getCachedData(key)) as FinnhubQuote | null;
      if (hit && isPositive(hit.c)) {
        prices.set(ticker, hit.c);
        return;
      }
      try {
        const quote = await fetchQuote(ticker); // rate-limited inside finnhubService
        if (quote && isPositive(quote.c)) {
          prices.set(ticker, quote.c);
          await setCachedData(key, 'financial', quote, QUOTE_CACHE_MS);
        }
      } catch (err) {
        console.warn(`[Scorecard] No quote for ${ticker}:`, err instanceof Error ? err.message : err);
      }
    })
  );
  return prices;
}

/**
 * SPY's close for each as-of date (YYYY-MM-DD), or null where it isn't available.
 * Weekend/holiday dates resolve to the nearest PRIOR trading close (see trackRecord.ts).
 * Cached dates cost nothing; all uncached dates share ONE Yahoo history request.
 */
export async function getBenchmarkStartCloses(
  asOfDates: string[],
  now: Date = new Date()
): Promise<Map<string, ResolvedClose | null>> {
  const unique = Array.from(new Set(asOfDates));
  const result = new Map<string, ResolvedClose | null>();
  const misses: string[] = [];

  for (const asOf of unique) {
    const hit = (await getCachedData(benchmarkCloseCacheKey(asOf))) as ResolvedClose | null;
    if (hit && typeof hit.date === 'string' && isPositive(hit.close)) result.set(asOf, hit);
    else misses.push(asOf);
  }
  if (misses.length === 0) return result;

  const earliest = misses.reduce((a, b) => (a < b ? a : b));
  const from = new Date(`${addDays(earliest, -HISTORY_LOOKBACK_DAYS)}T00:00:00Z`);
  const closes = await fetchDailyCloses(BENCHMARK_TICKER, from, now);

  for (const asOf of misses) {
    const resolved = closes ? findCloseOnOrBefore(asOf, closes, now) : null;
    result.set(asOf, resolved);
    // Only real, final closes are stored; a failure or an unfinished day is retried next load
    if (resolved) await setCachedData(benchmarkCloseCacheKey(asOf), 'benchmark', resolved, PERMANENT_CACHE_MS);
  }
  return result;
}

interface CachedSplits {
  /** Earliest date the cached list covers (YYYY-MM-DD). */
  since: string;
  events: { date: string; numerator: number; denominator: number }[];
}

/**
 * Split adjustment factor for each (ticker, as-of date) request, keyed by splitKey().
 * One Yahoo call per unique ticker (covering its earliest as-of date), cached 24 hours.
 * null = the split check failed for that ticker.
 */
export async function getSplitFactors(
  requests: { ticker: string; asOfDate: string }[]
): Promise<Map<string, number | null>> {
  const earliestByTicker = new Map<string, string>();
  for (const r of requests) {
    const t = r.ticker.toUpperCase();
    const prev = earliestByTicker.get(t);
    if (!prev || r.asOfDate < prev) earliestByTicker.set(t, r.asOfDate);
  }

  const eventsByTicker = new Map<string, SplitEvent[] | null>();
  await Promise.all(
    Array.from(earliestByTicker.entries()).map(async ([ticker, earliest]) => {
      const hit = (await getCachedData(splitsCacheKey(ticker))) as CachedSplits | null;
      if (hit && typeof hit.since === 'string' && hit.since <= earliest && Array.isArray(hit.events)) {
        eventsByTicker.set(ticker, hit.events.map((e) => ({ ...e, date: new Date(e.date) })));
        return;
      }
      const events = await fetchSplitEvents(ticker, new Date(`${addDays(earliest, -1)}T00:00:00Z`));
      eventsByTicker.set(ticker, events);
      if (events) {
        const toCache: CachedSplits = {
          since: earliest,
          events: events.map((e) => ({ date: e.date.toISOString(), numerator: e.numerator, denominator: e.denominator })),
        };
        await setCachedData(splitsCacheKey(ticker), 'financial', toCache, SPLITS_CACHE_MS);
      }
    })
  );

  const factors = new Map<string, number | null>();
  for (const r of requests) {
    const events = eventsByTicker.get(r.ticker.toUpperCase());
    factors.set(splitKey(r.ticker, r.asOfDate), events ? splitFactorAfter(r.asOfDate, events) : null);
  }
  return factors;
}

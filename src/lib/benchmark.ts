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
  excessReturn,
  pctChange,
  priceAsOfDate,
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
/**
 * A split list fetched less than this long after a session's open is not trusted to include
 * a split that took effect at that open (Yahoo can be slow to post it), so it's refetched.
 */
const SPLIT_POSTING_LAG_MS = 60 * 60 * 1000;
/** How far before the earliest as-of date to request SPY history (covers weekends + holidays). */
const HISTORY_LOOKBACK_DAYS = 10;

export const benchmarkCloseCacheKey = (asOfDate: string) => `benchmark-close:v1:${BENCHMARK_TICKER}:${asOfDate}`;
// v2 adds coveredThrough (review fix); v1 entries can't prove what they cover, so they're ignored
const splitsCacheKey = (ticker: string) => `splits:v2:${ticker}`;

const isPositive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

export interface CurrentPrice {
  price: number;
  /**
   * Trading day the price belongs to (priceAsOfDate of the quote's own timestamp): before the
   * open it's still the previous session's close. Used so a split is only applied once it's
   * actually in the price. Falls back to now when Finnhub sends no timestamp.
   */
  tradingDate: string;
}

function toCurrentPrice(quote: FinnhubQuote, now: Date): CurrentPrice {
  const at = isPositive(quote.t) ? new Date(quote.t * 1000) : now;
  return { price: quote.c, tradingDate: priceAsOfDate(at) };
}

/**
 * Current price for each ticker (uppercase keys). Tickers are de-duplicated first, so each
 * unique ticker costs at most one Finnhub /quote call. A ticker with no quote (delisted,
 * unknown, Finnhub error) is simply missing from the map; callers show it as excluded/N/A.
 */
export async function getCurrentPrices(tickers: string[], now: Date = new Date()): Promise<Map<string, CurrentPrice>> {
  const unique = Array.from(new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean)));
  const prices = new Map<string, CurrentPrice>();

  await Promise.all(
    unique.map(async (ticker) => {
      const key = `quote:${ticker}`;
      const hit = (await getCachedData(key)) as FinnhubQuote | null;
      if (hit && isPositive(hit.c)) {
        prices.set(ticker, toCurrentPrice(hit, now));
        return;
      }
      try {
        const quote = await fetchQuote(ticker); // rate-limited inside finnhubService
        if (quote && isPositive(quote.c)) {
          prices.set(ticker, toCurrentPrice(quote, now));
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
  /**
   * Latest trading day whose splits the list is trusted to include: the session that had
   * been open for SPLIT_POSTING_LAG_MS when it was fetched.
   */
  coveredThrough: string;
  events: { date: string; numerator: number; denominator: number }[];
}

/**
 * Split adjustment factor for each (ticker, as-of date) request, keyed by splitKey().
 * One Yahoo call per unique ticker (covering its earliest as-of date), cached up to 24 hours.
 * null = the split check failed for that ticker.
 *
 * Review fix: quotes are cached 5 minutes but split lists 24 hours, so a split taking effect
 * the morning after the list was cached used to be paired with a post-split quote at factor
 * 1 (a 10-for-1 split looked like -90%). Now:
 * - a cached list is only reused if it covers the quote's trading day (coveredThrough),
 *   otherwise it's refetched; and
 * - only splits on or before the quote's trading day are applied (splitFactorAfter's
 *   throughDate), so a pre-open, pre-split quote isn't adjusted for a split starting today.
 */
export async function getSplitFactors(
  requests: { ticker: string; asOfDate: string; quoteDate: string }[],
  now: Date = new Date()
): Promise<Map<string, number | null>> {
  const rangeByTicker = new Map<string, { earliest: string; latestQuote: string }>();
  for (const r of requests) {
    const t = r.ticker.toUpperCase();
    const prev = rangeByTicker.get(t);
    rangeByTicker.set(t, {
      earliest: !prev || r.asOfDate < prev.earliest ? r.asOfDate : prev.earliest,
      latestQuote: !prev || r.quoteDate > prev.latestQuote ? r.quoteDate : prev.latestQuote,
    });
  }

  const eventsByTicker = new Map<string, SplitEvent[] | null>();
  await Promise.all(
    Array.from(rangeByTicker.entries()).map(async ([ticker, { earliest, latestQuote }]) => {
      const hit = (await getCachedData(splitsCacheKey(ticker))) as CachedSplits | null;
      if (
        hit &&
        typeof hit.since === 'string' &&
        hit.since <= earliest &&
        typeof hit.coveredThrough === 'string' &&
        hit.coveredThrough >= latestQuote &&
        Array.isArray(hit.events)
      ) {
        eventsByTicker.set(ticker, hit.events.map((e) => ({ ...e, date: new Date(e.date) })));
        return;
      }
      const events = await fetchSplitEvents(ticker, new Date(`${addDays(earliest, -1)}T00:00:00Z`));
      eventsByTicker.set(ticker, events);
      if (events) {
        const toCache: CachedSplits = {
          since: earliest,
          coveredThrough: priceAsOfDate(new Date(now.getTime() - SPLIT_POSTING_LAG_MS)),
          events: events.map((e) => ({ date: e.date.toISOString(), numerator: e.numerator, denominator: e.denominator })),
        };
        await setCachedData(splitsCacheKey(ticker), 'financial', toCache, SPLITS_CACHE_MS);
      }
    })
  );

  const factors = new Map<string, number | null>();
  for (const r of requests) {
    const events = eventsByTicker.get(r.ticker.toUpperCase());
    factors.set(splitKey(r.ticker, r.asOfDate), events ? splitFactorAfter(r.asOfDate, events, r.quoteDate) : null);
  }
  return factors;
}

export interface BenchmarkComparison {
  /** SPY's price return from the as-of close to now, in percent; null = N/A. */
  benchmarkReturnPercent: number | null;
  /** The item's return minus SPY's, in percentage points; null = N/A. */
  vsBenchmarkPercent: number | null;
  /** Trading day whose SPY close was used (YYYY-MM-DD); null = unavailable. */
  benchmarkStartDate: string | null;
}

/**
 * SPY-relative return for Watchlist and Portfolio items (Phase D step 5), using the same
 * rules as the Scorecard: SPY's close on the day the item was starred (nearest prior
 * trading close on a weekend/holiday or before the open) to SPY's current price.
 * `items[i].returnPercent` is the item's own gain/loss as already shown in that view.
 * Never throws: on any failure every comparison is N/A.
 */
export async function compareWithBenchmark(
  items: { since: Date; returnPercent: number | null }[],
  benchmarkCurrent: number | null,
  now: Date = new Date()
): Promise<BenchmarkComparison[]> {
  const na: BenchmarkComparison = { benchmarkReturnPercent: null, vsBenchmarkPercent: null, benchmarkStartDate: null };
  if (items.length === 0) return [];
  if (benchmarkCurrent === null) return items.map(() => na);

  try {
    const asOfDates = items.map((item) => priceAsOfDate(item.since));
    const starts = await getBenchmarkStartCloses(asOfDates, now);
    return items.map((item, i) => {
      const start = starts.get(asOfDates[i]) ?? null;
      const benchmarkReturnPercent = pctChange(start?.close, benchmarkCurrent);
      return {
        benchmarkReturnPercent,
        vsBenchmarkPercent: excessReturn(item.returnPercent, benchmarkReturnPercent),
        benchmarkStartDate: start?.date ?? null,
      };
    });
  } catch (err) {
    console.warn('[Benchmark] SPY comparison unavailable:', err instanceof Error ? err.message : err);
    return items.map(() => na);
  }
}

/**
 * Finnhub data client (free tier).
 *
 * Single source for live quotes, fundamentals, company profiles, news, peers and the
 * US symbol directory. Every request goes through one serialized rate limiter so that
 * parallel callers (enrich, peers, details modal) can never burst past the free-tier
 * limit of 60 calls/minute.
 *
 * Endpoint shapes were verified against live responses on 2026-09-15.
 */

const BASE_URL = 'https://finnhub.io/api/v1';
const RATE_LIMIT = 55; // stay under the 60/min free-tier ceiling
const RATE_WINDOW_MS = 60_000;

export class FinnhubNotConfiguredError extends Error {
  constructor() {
    super('FINNHUB_API_KEY is not configured in .env.local');
    this.name = 'FinnhubNotConfiguredError';
  }
}

export function isFinnhubConfigured(): boolean {
  const key = process.env.FINNHUB_API_KEY;
  return !!key && key !== 'PLACEHOLDER_API_KEY';
}

// ---------------------------------------------------------------------------
// Rate limiter: a promise chain guarantees slots are claimed one at a time.
// ---------------------------------------------------------------------------
const callTimestamps: number[] = [];
let limiterChain: Promise<void> = Promise.resolve();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function acquireSlot(): Promise<void> {
  const slot = limiterChain.then(async () => {
    for (;;) {
      const now = Date.now();
      while (callTimestamps.length > 0 && now - callTimestamps[0] >= RATE_WINDOW_MS) {
        callTimestamps.shift();
      }
      if (callTimestamps.length < RATE_LIMIT) {
        callTimestamps.push(now);
        return;
      }
      const waitMs = RATE_WINDOW_MS - (now - callTimestamps[0]) + 50;
      console.log(`[Finnhub] Rate limit reached, waiting ${waitMs}ms`);
      await sleep(waitMs);
    }
  });
  limiterChain = slot.catch(() => undefined);
  return slot;
}

/** Test helper: clears limiter state between test cases. */
export function resetFinnhubRateLimiter(): void {
  callTimestamps.length = 0;
  limiterChain = Promise.resolve();
}

async function finnhubGet<T>(path: string, params: Record<string, string>): Promise<T> {
  if (!isFinnhubConfigured()) {
    throw new FinnhubNotConfiguredError();
  }

  const url = `${BASE_URL}${path}?${new URLSearchParams(params).toString()}`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    await acquireSlot();
    // Token goes in a header so it never appears in URLs or logs
    const response = await fetch(url, {
      headers: { 'X-Finnhub-Token': process.env.FINNHUB_API_KEY as string },
    });

    if (response.status === 429 && attempt === 1) {
      console.warn(`[Finnhub] 429 on ${path}, retrying once`);
      await sleep(2000);
      continue;
    }
    if (!response.ok) {
      throw new Error(`Finnhub ${path} failed with status ${response.status}`);
    }
    return (await response.json()) as T;
  }
  throw new Error(`Finnhub ${path} failed after retry`);
}

// ---------------------------------------------------------------------------
// Typed endpoint helpers
// ---------------------------------------------------------------------------

export interface FinnhubQuote {
  c: number; // current price
  d: number | null; // change
  dp: number | null; // percent change
  h: number;
  l: number;
  o: number;
  pc: number; // previous close
  t: number; // unix seconds
}

export interface FinnhubSymbol {
  symbol: string;
  description: string;
  displaySymbol: string;
  mic: string; // exchange MIC, e.g. XNAS, XNYS, OOTC
  type: string; // e.g. "Common Stock", "ADR", "ETP"
  currency: string;
}

export interface FinnhubProfile {
  ticker?: string;
  name?: string;
  country?: string;
  currency?: string;
  exchange?: string;
  ipo?: string;
  marketCapitalization?: number; // in millions
  shareOutstanding?: number;
  logo?: string;
  weburl?: string;
  finnhubIndustry?: string;
}

/** Subset of /stock/metric?metric=all fields this app uses. */
export interface FinnhubMetrics {
  peTTM?: number | null;
  marketCapitalization?: number | null; // in millions
  revenueGrowthTTMYoy?: number | null; // percent
  'totalDebt/totalEquityQuarterly'?: number | null;
  'totalDebt/totalEquityAnnual'?: number | null;
  pfcfShareTTM?: number | null; // price / free-cash-flow per share
  '52WeekPriceReturnDaily'?: number | null; // percent
  '26WeekPriceReturnDaily'?: number | null; // percent
}

export interface FinnhubNewsItem {
  category: string;
  datetime: number; // unix seconds
  headline: string;
  id: number;
  image: string;
  related: string;
  source: string;
  summary: string;
  url: string;
}

/** Returns null when Finnhub has no price for the symbol (c === 0). */
export async function fetchQuote(symbol: string): Promise<FinnhubQuote | null> {
  const quote = await finnhubGet<FinnhubQuote>('/quote', { symbol: symbol.toUpperCase() });
  return quote && quote.c > 0 ? quote : null;
}

/** Fetches quotes for many symbols; individual failures are logged and omitted. */
export async function fetchQuotes(symbols: string[]): Promise<Map<string, FinnhubQuote>> {
  const results = new Map<string, FinnhubQuote>();
  const unique = Array.from(new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)));

  await Promise.all(
    unique.map(async (symbol) => {
      try {
        const quote = await fetchQuote(symbol);
        if (quote) results.set(symbol, quote);
      } catch (err) {
        if (err instanceof FinnhubNotConfiguredError) throw err;
        console.warn(`[Finnhub] Quote failed for ${symbol}:`, err instanceof Error ? err.message : err);
      }
    })
  );
  return results;
}

/** Returns null when Finnhub has no metrics for the symbol. */
export async function fetchMetrics(symbol: string): Promise<FinnhubMetrics | null> {
  const data = await finnhubGet<{ metric?: FinnhubMetrics }>('/stock/metric', {
    symbol: symbol.toUpperCase(),
    metric: 'all',
  });
  return data?.metric && Object.keys(data.metric).length > 0 ? data.metric : null;
}

/** Returns null when Finnhub has no profile (it responds with an empty object). */
export async function fetchProfile(symbol: string): Promise<FinnhubProfile | null> {
  const profile = await finnhubGet<FinnhubProfile>('/stock/profile2', { symbol: symbol.toUpperCase() });
  return profile && profile.name ? profile : null;
}

export async function fetchCompanyNews(symbol: string, from: string, to: string): Promise<FinnhubNewsItem[]> {
  const news = await finnhubGet<FinnhubNewsItem[]>('/company-news', {
    symbol: symbol.toUpperCase(),
    from,
    to,
  });
  return Array.isArray(news) ? news : [];
}

export async function fetchPeers(symbol: string): Promise<string[]> {
  const peers = await finnhubGet<string[]>('/stock/peers', { symbol: symbol.toUpperCase() });
  return Array.isArray(peers) ? peers : [];
}

/** Full US symbol directory (~31K rows incl. OTC and ETPs). Callers should cache it. */
export async function fetchUsSymbols(): Promise<FinnhubSymbol[]> {
  const symbols = await finnhubGet<FinnhubSymbol[]>('/stock/symbol', { exchange: 'US' });
  return Array.isArray(symbols) ? symbols : [];
}

// ---------------------------------------------------------------------------
// Derived values
// ---------------------------------------------------------------------------

const positiveOrNull = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

const finiteOrNull = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Normalizes raw Finnhub metrics into the units the app displays. */
export function normalizeMetrics(metrics: FinnhubMetrics | null) {
  const marketCapMillions = positiveOrNull(metrics?.marketCapitalization);
  const marketCap = marketCapMillions !== null ? marketCapMillions * 1_000_000 : null;
  const priceToFcf = positiveOrNull(metrics?.pfcfShareTTM);

  return {
    marketCap,
    // Negative P/E (loss-making companies) is not meaningful for valuation scoring
    peRatio: positiveOrNull(metrics?.peTTM),
    revenueGrowthYoY: finiteOrNull(metrics?.revenueGrowthTTMYoy),
    debtToEquity:
      finiteOrNull(metrics?.['totalDebt/totalEquityQuarterly']) ??
      finiteOrNull(metrics?.['totalDebt/totalEquityAnnual']),
    // Finnhub has no absolute FCF on the free tier; derive it from market cap / (P/FCF)
    freeCashFlowDerived: marketCap !== null && priceToFcf !== null ? marketCap / priceToFcf : null,
    priceReturn52Week: finiteOrNull(metrics?.['52WeekPriceReturnDaily']),
  };
}

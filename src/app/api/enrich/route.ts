import { NextRequest, NextResponse } from 'next/server';
import { getCachedData, setCachedData } from '@/lib/dbHelper';
import {
  fetchMetrics,
  fetchQuote,
  FinnhubMetrics,
  FinnhubQuote,
  isFinnhubConfigured,
  normalizeMetrics,
} from '@/lib/finnhubService';
import { fetchPriceGrowth, PriceHistoryGrowth, RALLY_THRESHOLD_PCT } from '@/lib/yahooService';
import { getListing, normalizeTicker } from '@/lib/tickerValidator';
import { DataQuality, Exchange } from '@/lib/types';
import { MAX_TICKERS_PER_ENRICH } from '@/lib/inputLimits';

// Prices go stale fast; fundamentals and multi-year growth don't
const QUOTE_CACHE_MS = 5 * 60 * 1000;
const FUNDAMENTALS_CACHE_MS = 24 * 60 * 60 * 1000;

export interface EnrichedData {
  ticker: string;
  stockPrice: number; // 0 = unavailable
  marketCap: number; // 0 = unavailable
  exchange: Exchange | null;
  peRatio: number | null;
  debtToEquity: number | null;
  growth1Y: number | null;
  growth5Y: number | null;
  // Phase C scoring inputs (see src/lib/scoring.ts)
  priceToSales: number | null;
  preRevenue: boolean | null;
  lossMaking: boolean | null;
  revenueGrowthYoY: number | null;
  // Display-only "already priced in" flag (decision D4: never part of the score)
  change6M: number | null;
  rallied6M: boolean | null;
  dataQuality: DataQuality;
}

/** Runs a fetcher with read-through caching. Failures and empty results are never cached. */
async function cached<T>(key: string, type: string, ttlMs: number, fetcher: () => Promise<T | null>): Promise<T | null> {
  const hit = (await getCachedData(key)) as T | null;
  if (hit) return hit;
  try {
    const value = await fetcher();
    if (value) await setCachedData(key, type, value, ttlMs);
    return value;
  } catch (err) {
    console.warn(`[Enrich] ${key} failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

async function enrichTicker(ticker: string): Promise<EnrichedData> {
  const [quote, metrics, listing] = await Promise.all([
    cached<FinnhubQuote>(`quote:${ticker}`, 'financial', QUOTE_CACHE_MS, () => fetchQuote(ticker)),
    cached<FinnhubMetrics>(`metrics:${ticker}`, 'financial', FUNDAMENTALS_CACHE_MS, () => fetchMetrics(ticker)),
    getListing(ticker),
  ]);

  const stockPrice = quote?.c ?? 0;
  const fundamentals = normalizeMetrics(metrics);

  let growth: PriceHistoryGrowth | null = null;
  if (stockPrice > 0) {
    // v2 key: entries cached before Phase C have no change6M, so they're skipped, not trusted
    growth = await cached<PriceHistoryGrowth>(`growth:v2:${ticker}`, 'financial', FUNDAMENTALS_CACHE_MS, async () => {
      const result = await fetchPriceGrowth(ticker, stockPrice);
      return result.growthSource === 'calculated' ? result : null;
    });
  }

  // If Yahoo history is unavailable, fall back to Finnhub's 52-week price return for 1Y
  const growth1Y = growth?.growth1Y ?? fundamentals.priceReturn52Week;
  const growth5Y = growth?.growth5Y ?? null;
  // 6-month change comes from the same Yahoo weekly history; if that's unavailable, fall
  // back to Finnhub's own 26-week price return (already in the metrics response).
  const change6M = growth?.change6M ?? fundamentals.priceReturn26Week;

  return {
    ticker,
    stockPrice,
    marketCap: fundamentals.marketCap ?? 0,
    exchange: listing?.exchange ?? null,
    peRatio: fundamentals.peRatio,
    debtToEquity: fundamentals.debtToEquity,
    growth1Y,
    growth5Y,
    priceToSales: fundamentals.priceToSales,
    preRevenue: fundamentals.preRevenue,
    lossMaking: fundamentals.lossMaking,
    revenueGrowthYoY: fundamentals.revenueGrowthYoY,
    change6M,
    rallied6M: change6M === null ? null : change6M > RALLY_THRESHOLD_PCT,
    dataQuality: {
      priceSource: stockPrice > 0 ? 'live' : 'unavailable',
      growthSource: growth1Y !== null ? 'calculated' : stockPrice > 0 ? 'insufficient_history' : 'unavailable',
      fundamentalsSource: metrics ? 'live' : 'unavailable',
    },
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tickers } = body as { tickers: string[] };

    if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
      return NextResponse.json({ error: 'Tickers array is required' }, { status: 400 });
    }

    if (tickers.some((t) => typeof t !== 'string' || t.trim() === '')) {
      return NextResponse.json({ error: 'Each ticker must be a non-empty string.' }, { status: 400 });
    }

    // Input limit (Phase E): each ticker costs several Finnhub/Yahoo calls
    const uniqueCount = new Set(tickers.map(normalizeTicker)).size;
    if (uniqueCount > MAX_TICKERS_PER_ENRICH) {
      return NextResponse.json(
        { error: `Too many tickers: ${uniqueCount} sent, the limit is ${MAX_TICKERS_PER_ENRICH} per request.` },
        { status: 400 }
      );
    }

    if (!isFinnhubConfigured()) {
      return NextResponse.json(
        { error: 'FINNHUB_API_KEY is not configured in .env.local — live prices and fundamentals are unavailable.' },
        { status: 503 }
      );
    }

    const normalized = tickers.map(normalizeTicker);
    const unique = Array.from(new Set(normalized));
    const enriched = await Promise.all(unique.map(enrichTicker));
    const byTicker = new Map(enriched.map((e) => [e.ticker, e]));

    // Preserve the caller's order
    return NextResponse.json(normalized.map((t) => byTicker.get(t)!));
  } catch (error: unknown) {
    console.error('Error in enrich route:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

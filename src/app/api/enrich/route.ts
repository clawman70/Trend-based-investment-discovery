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
import { fetchPriceGrowth, PriceHistoryGrowth } from '@/lib/yahooService';
import { getListing, normalizeTicker } from '@/lib/tickerValidator';
import { DataQuality, Exchange } from '@/lib/types';

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
    growth = await cached<PriceHistoryGrowth>(`growth:${ticker}`, 'financial', FUNDAMENTALS_CACHE_MS, async () => {
      const result = await fetchPriceGrowth(ticker, stockPrice);
      return result.growthSource === 'calculated' ? result : null;
    });
  }

  // If Yahoo history is unavailable, fall back to Finnhub's 52-week price return for 1Y
  const growth1Y = growth?.growth1Y ?? fundamentals.priceReturn52Week;
  const growth5Y = growth?.growth5Y ?? null;

  return {
    ticker,
    stockPrice,
    marketCap: fundamentals.marketCap ?? 0,
    exchange: listing?.exchange ?? null,
    peRatio: fundamentals.peRatio,
    debtToEquity: fundamentals.debtToEquity,
    growth1Y,
    growth5Y,
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

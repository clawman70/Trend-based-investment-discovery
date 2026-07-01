import { NextRequest, NextResponse } from 'next/server';
import { getCachedData, setCachedData } from '@/lib/dbHelper';
import { getFinnhubService } from '@/lib/finnhubService';
import { getYFinanceService } from '@/lib/yfinanceService';

const CACHE_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface EnrichedData {
  ticker: string;
  companyName: string;
  stockPrice: number;
  marketCap: number;
  exchange: 'NASDAQ' | 'NYSE';
  growth1Y: number;
  growth5Y: number;
  dataQuality: {
    priceSource: 'live' | 'unavailable';
    growthSource: 'calculated' | 'insufficient_history' | 'unavailable';
  };
  peRatio: number | null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tickers } = body as { tickers: string[] };

    if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
      return NextResponse.json({ error: 'Tickers array is required' }, { status: 400 });
    }

    const resultsMap = new Map<string, EnrichedData>();
    const uncachedTickers: string[] = [];

    // 1. Check cache first
    for (const ticker of tickers) {
      const upperTicker = ticker.trim().toUpperCase();
      const cached = (await getCachedData(`financial:${upperTicker}`)) as EnrichedData | null;
      if (cached) {
        resultsMap.set(upperTicker, cached);
      } else {
        uncachedTickers.push(upperTicker);
      }
    }

    // 2. Fetch real-time quotes from Finnhub (respects 60 calls/min rate limit)
    if (uncachedTickers.length > 0) {
      try {
        const finnhubService = getFinnhubService();
        const finnhubQuotes = await finnhubService.fetchBatchQuotes(uncachedTickers);

        if (finnhubQuotes.size > 0) {
          // 3. Fetch historical growth data from yfinance
          const yfinanceService = getYFinanceService();
          const tickersForHistory = Array.from(finnhubQuotes.values()).map((q) => ({
            ticker: q.ticker,
            currentPrice: q.stockPrice,
          }));

          const historicalData = await yfinanceService.fetchBatchHistoricalData(tickersForHistory);

          // 4. Merge Finnhub quotes with yfinance historical data
          for (const [ticker, finnhubQuote] of finnhubQuotes) {
            const historical = historicalData.get(ticker);

            const enrichedRecord: EnrichedData = {
              ticker,
              companyName: ticker, // Finnhub doesn't provide company name in quote endpoint
              stockPrice: finnhubQuote.stockPrice,
              marketCap: finnhubQuote.marketCap, // Will be 0 for now (would need separate Finnhub call)
              exchange: finnhubQuote.exchange,
              growth1Y: historical?.growth1Y ?? 0,
              growth5Y: historical?.growth5Y ?? 0,
              dataQuality: {
                priceSource: finnhubQuote.stockPrice > 0 ? 'live' : 'unavailable',
                growthSource: historical?.growthSource ?? 'unavailable',
              },
              peRatio: finnhubQuote.peRatio,
            };

            resultsMap.set(ticker, enrichedRecord);
            await setCachedData(`financial:${ticker}`, 'financial', enrichedRecord, CACHE_DURATION_MS);
          }
        }
      } catch (err) {
        console.error('Finnhub/yfinance enrichment failed:', err);
      }
    }

    // 5. Mark any remaining tickers as unavailable
    for (const ticker of uncachedTickers) {
      if (!resultsMap.has(ticker)) {
        resultsMap.set(ticker, {
          ticker,
          companyName: ticker,
          stockPrice: 0,
          marketCap: 0,
          exchange: 'NASDAQ',
          growth1Y: 0,
          growth5Y: 0,
          dataQuality: {
            priceSource: 'unavailable',
            growthSource: 'unavailable',
          },
          peRatio: null,
        });
      }
    }

    // Assemble results in the original requested order
    const orderedResults = tickers.map((t) => resultsMap.get(t.trim().toUpperCase())!);

    return NextResponse.json(orderedResults);
  } catch (error: unknown) {
    console.error('Error in enrich route:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

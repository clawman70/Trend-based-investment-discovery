import { NextRequest, NextResponse } from 'next/server';
import { getCachedData, setCachedData } from '@/lib/dbHelper';

const CACHE_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_DATE_DIFF_MS = 30 * 24 * 60 * 60 * 1000; // 30 days maximum difference for growth price matching

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

interface FMPQuote {
  symbol?: string;
  price?: number;
  marketCap?: number;
  exchange?: string;
  name?: string;
  pe?: number | null;
}

const findClosestPrice = (targetDate: Date, historicalPrices: { date: string; close: number }[]): number | null => {
  if (!historicalPrices || historicalPrices.length === 0) return null;

  const targetTime = targetDate.getTime();
  let closestRecord: { date: string; close: number } | null = null;
  let minDiff = Infinity;

  for (const record of historicalPrices) {
    const recordTime = new Date(record.date).getTime();
    const diff = Math.abs(targetTime - recordTime);
    if (diff < minDiff && diff < MAX_DATE_DIFF_MS) {
      minDiff = diff;
      closestRecord = record;
    }
  }

  return closestRecord ? closestRecord.close : null;
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tickers } = body as { tickers: string[] };

    if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
      return NextResponse.json({ error: 'Tickers array is required' }, { status: 400 });
    }

    const apiKey = process.env.FMP_API_KEY;
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

    // 2. Fetch uncached tickers from FMP
    if (uncachedTickers.length > 0 && apiKey && apiKey !== 'PLACEHOLDER_API_KEY') {
      try {
        const batchTickersStr = uncachedTickers.join(',');
        const quoteUrl = `https://financialmodelingprep.com/api/v3/quote/${batchTickersStr}?apikey=${apiKey}`;
        const quoteResponse = await fetch(quoteUrl);

        if (quoteResponse.ok) {
          const quotes = (await quoteResponse.json()) as FMPQuote[];
          
          if (Array.isArray(quotes)) {
            for (const q of quotes) {
              if (!q.symbol) continue;
              const ticker = String(q.symbol).toUpperCase();
              
              const stockPrice = Number(q.price || 0);
              const marketCap = Number(q.marketCap || 0);
              const exchangeRaw = String(q.exchange || '').toUpperCase();
              const exchange: 'NASDAQ' | 'NYSE' = exchangeRaw.includes('NYSE') ? 'NYSE' : 'NASDAQ';
              const peRatio = q.pe !== null && q.pe !== undefined ? Number(q.pe) : null;

              // Fetch historical prices for growth calculations
              let growth1Y = 0;
              let growth5Y = 0;
              let growthSource: 'calculated' | 'insufficient_history' | 'unavailable' = 'unavailable';

              try {
                const historyUrl = `https://financialmodelingprep.com/api/v3/historical-price-full/${ticker}?apikey=${apiKey}`;
                const historyResponse = await fetch(historyUrl);

                if (historyResponse.ok) {
                  const historyData = await historyResponse.json();
                  const historical = (historyData.historical || []) as { date: string; close: number }[];

                  if (historical.length > 0) {
                    const nowTime = new Date();
                    
                    const oneYearAgo = new Date();
                    oneYearAgo.setFullYear(nowTime.getFullYear() - 1);
                    
                    const fiveYearsAgo = new Date();
                    fiveYearsAgo.setFullYear(nowTime.getFullYear() - 5);

                    const priceToday = stockPrice;
                    const price1Y = findClosestPrice(oneYearAgo, historical);
                    const price5Y = findClosestPrice(fiveYearsAgo, historical);

                    if (price1Y !== null && price5Y !== null && price1Y > 0 && price5Y > 0) {
                      growth1Y = ((priceToday - price1Y) / price1Y) * 100;
                      growth5Y = ((priceToday - price5Y) / price5Y) * 100;
                      growthSource = 'calculated';
                    } else {
                      growthSource = 'insufficient_history';
                    }
                  } else {
                    growthSource = 'insufficient_history';
                  }
                }
              } catch (histErr) {
                console.error(`Failed to fetch history for ${ticker}:`, histErr);
              }

              const enrichedRecord: EnrichedData = {
                ticker,
                companyName: q.name || ticker,
                stockPrice,
                marketCap,
                exchange,
                growth1Y,
                growth5Y,
                dataQuality: {
                  priceSource: stockPrice > 0 ? 'live' : 'unavailable',
                  growthSource,
                },
                peRatio
              };

              resultsMap.set(ticker, enrichedRecord);
              await setCachedData(`financial:${ticker}`, 'financial', enrichedRecord, CACHE_DURATION_MS);
            }
          }
        } else {
          console.error(`FMP quote batch returned status ${quoteResponse.status}`);
        }
      } catch (err) {
        console.error("FMP enrichment request failed:", err);
      }
    }

    // 3. Mark any remaining tickers as unavailable
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
          peRatio: null
        });
      }
    }

    // Assemble results in the original requested order
    const orderedResults = tickers.map(t => resultsMap.get(t.trim().toUpperCase())!);

    return NextResponse.json(orderedResults);
  } catch (error: unknown) {
    console.error("Error in enrich route:", error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

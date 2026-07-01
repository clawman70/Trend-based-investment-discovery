/**
 * Finnhub Real-Time Quote Service
 *
 * Respects the free tier rate limit (60 calls/minute) by batching requests
 * and implementing a sliding-window rate limiter. Each quote request counts as 1 call.
 *
 * Rate Limit: 60 calls/minute
 * - Batch all tickers in parallel within the rate window
 * - Track call timestamps and delay if we exceed 60 calls/min
 */

import axios, { AxiosInstance } from 'axios';

interface FinnhubQuote {
  symbol: string;
  c: number; // Current price
  h: number; // High price of the day
  l: number; // Low price of the day
  o: number; // Open price of the day
  pc: number; // Previous close price
  t: number; // Timestamp
}

interface EnrichedQuote {
  ticker: string;
  stockPrice: number;
  marketCap: number;
  exchange: string;
  peRatio: number | null;
}

class FinnhubService {
  private client: AxiosInstance;
  private apiKey: string;
  private callTimestamps: number[] = []; // Track call times for rate limiting
  private readonly RATE_LIMIT = 60; // calls per minute
  private readonly RATE_WINDOW = 60 * 1000; // 1 minute in ms

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.client = axios.create({
      baseURL: 'https://finnhub.io/api/v1',
      timeout: 10000,
    });
  }

  /**
   * Check if we're within rate limits and wait if necessary
   */
  private async respectRateLimit() {
    const now = Date.now();
    // Remove calls older than 1 minute
    this.callTimestamps = this.callTimestamps.filter((t) => now - t < this.RATE_WINDOW);

    if (this.callTimestamps.length >= this.RATE_LIMIT) {
      // Calculate how long to wait
      const oldestCall = this.callTimestamps[0];
      const waitTime = this.RATE_WINDOW - (now - oldestCall) + 100; // +100ms buffer
      if (waitTime > 0) {
        console.log(`[Finnhub Rate Limit] Waiting ${waitTime}ms to respect 60 calls/min limit`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }
    this.callTimestamps.push(Date.now());
  }

  /**
   * Fetch quote for a single ticker
   */
  private async fetchQuote(ticker: string): Promise<FinnhubQuote | null> {
    try {
      await this.respectRateLimit();
      const response = await this.client.get<FinnhubQuote>('/quote', {
        params: {
          symbol: ticker.toUpperCase(),
          token: this.apiKey,
        },
      });
      return response.data;
    } catch (error) {
      console.warn(`[Finnhub] Failed to fetch quote for ${ticker}:`, error);
      return null;
    }
  }

  /**
   * Batch fetch quotes for multiple tickers
   * Respects rate limiting automatically
   */
  async fetchBatchQuotes(tickers: string[]): Promise<Map<string, EnrichedQuote>> {
    const results = new Map<string, EnrichedQuote>();

    if (!tickers || tickers.length === 0) {
      return results;
    }

    console.log(`[Finnhub] Fetching real-time quotes for ${tickers.length} tickers...`);

    // Fetch all quotes in parallel (rate limiter handles throttling)
    const quotePromises = tickers.map((ticker) => this.fetchQuote(ticker));
    const quotes = await Promise.all(quotePromises);

    for (let i = 0; i < tickers.length; i++) {
      const ticker = tickers[i].toUpperCase();
      const quote = quotes[i];

      if (quote && quote.c && quote.c > 0) {
        // Finnhub doesn't provide market cap in quote endpoint, would need separate call
        // For now, we'll fetch it from yfinance in the enrichment flow
        results.set(ticker, {
          ticker,
          stockPrice: quote.c,
          marketCap: 0, // Will be filled by yfinance
          exchange: 'NASDAQ', // Default; yfinance will provide actual
          peRatio: null, // Finnhub doesn't include PE in quote endpoint
        });
      } else {
        console.warn(`[Finnhub] No valid quote data for ${ticker}`);
      }
    }

    return results;
  }
}

let finnhubInstance: FinnhubService | null = null;

export function initializeFinnhub(apiKey: string): FinnhubService {
  if (!finnhubInstance) {
    finnhubInstance = new FinnhubService(apiKey);
  }
  return finnhubInstance;
}

export function getFinnhubService(): FinnhubService {
  if (!finnhubInstance) {
    const apiKey = process.env.FINNHUB_API_KEY;
    if (!apiKey || apiKey === 'PLACEHOLDER_API_KEY') {
      throw new Error('FINNHUB_API_KEY is not configured');
    }
    finnhubInstance = new FinnhubService(apiKey);
  }
  return finnhubInstance;
}

export { FinnhubService, EnrichedQuote, FinnhubQuote };

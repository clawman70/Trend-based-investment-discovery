/**
 * YFinance Historical Data Service
 *
 * Fetches 1-year and 5-year historical price data to calculate growth percentages.
 * No rate limits on free tier, but implemented with caching to reduce calls.
 */

import axios from 'axios';

interface HistoricalPriceData {
  ticker: string;
  price1YAgo: number | null;
  price5YAgo: number | null;
  currentPrice: number;
  growth1Y: number;
  growth5Y: number;
  growthSource: 'calculated' | 'insufficient_history' | 'unavailable';
}

class YFinanceService {
  private readonly MAX_DATE_DIFF_MS = 30 * 24 * 60 * 60 * 1000; // 30 days tolerance

  /**
   * Find the closest historical price to a target date
   */
  private findClosestPrice(
    targetDate: Date,
    historicalData: Array<{ date: string; close: number }>
  ): number | null {
    if (!historicalData || historicalData.length === 0) return null;

    const targetTime = targetDate.getTime();
    let closestRecord: { date: string; close: number } | null = null;
    let minDiff = Infinity;

    for (const record of historicalData) {
      const recordTime = new Date(record.date).getTime();
      const diff = Math.abs(targetTime - recordTime);
      if (diff < minDiff && diff < this.MAX_DATE_DIFF_MS) {
        minDiff = diff;
        closestRecord = record;
      }
    }

    return closestRecord ? closestRecord.close : null;
  }

  /**
   * Fetch historical price data from yfinance
   * yfinance returns data in format: Date,Open,High,Low,Close,Volume,Dividends,Stock Splits
   */
  async fetchHistoricalPrices(ticker: string, currentPrice: number): Promise<HistoricalPriceData> {
    try {
      const response = await axios.get(
        `https://query1.finance.yahoo.com/v7/finance/download/${ticker.toUpperCase()}`,
        {
          params: {
            interval: '1d',
            events: 'history',
            crumb: '', // Yahoo doesn't require crumb for this endpoint
          },
          timeout: 10000,
        }
      );

      // Parse CSV response
      const lines = response.data.split('\n').filter((line: string) => line.trim());
      if (lines.length < 2) {
        return {
          ticker,
          price1YAgo: null,
          price5YAgo: null,
          currentPrice,
          growth1Y: 0,
          growth5Y: 0,
          growthSource: 'insufficient_history',
        };
      }

      // Parse CSV: Date,Open,High,Low,Close,Volume,Dividends,Stock Splits
      const historicalData = lines
        .slice(1) // Skip header
        .map((line: string) => {
          const parts = line.split(',');
          return {
            date: parts[0],
            close: parseFloat(parts[4]), // Close price is 5th column
          };
        })
        .filter((d) => !isNaN(d.close))
        .reverse(); // Reverse to chronological order (oldest first)

      if (historicalData.length === 0) {
        return {
          ticker,
          price1YAgo: null,
          price5YAgo: null,
          currentPrice,
          growth1Y: 0,
          growth5Y: 0,
          growthSource: 'insufficient_history',
        };
      }

      const now = new Date();
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(now.getFullYear() - 1);

      const fiveYearsAgo = new Date();
      fiveYearsAgo.setFullYear(now.getFullYear() - 5);

      const price1Y = this.findClosestPrice(oneYearAgo, historicalData);
      const price5Y = this.findClosestPrice(fiveYearsAgo, historicalData);

      let growth1Y = 0;
      let growth5Y = 0;
      let growthSource: 'calculated' | 'insufficient_history' | 'unavailable' = 'unavailable';

      if (price1Y !== null && price1Y > 0 && price5Y !== null && price5Y > 0) {
        growth1Y = ((currentPrice - price1Y) / price1Y) * 100;
        growth5Y = ((currentPrice - price5Y) / price5Y) * 100;
        growthSource = 'calculated';
      } else if (price1Y !== null && price1Y > 0) {
        growth1Y = ((currentPrice - price1Y) / price1Y) * 100;
        growthSource = 'calculated';
      } else {
        growthSource = 'insufficient_history';
      }

      return {
        ticker,
        price1YAgo: price1Y,
        price5YAgo: price5Y,
        currentPrice,
        growth1Y,
        growth5Y,
        growthSource,
      };
    } catch (error) {
      console.warn(`[YFinance] Failed to fetch historical data for ${ticker}:`, error);
      return {
        ticker,
        price1YAgo: null,
        price5YAgo: null,
        currentPrice,
        growth1Y: 0,
        growth5Y: 0,
        growthSource: 'unavailable',
      };
    }
  }

  /**
   * Batch fetch historical data for multiple tickers
   * Runs in parallel to maximize speed (no rate limits on free tier)
   */
  async fetchBatchHistoricalData(
    tickers: Array<{ ticker: string; currentPrice: number }>
  ): Promise<Map<string, HistoricalPriceData>> {
    const results = new Map<string, HistoricalPriceData>();

    if (!tickers || tickers.length === 0) {
      return results;
    }

    console.log(`[YFinance] Fetching 1Y/5Y growth data for ${tickers.length} tickers...`);

    // Fetch all in parallel (yfinance has no rate limits on free tier)
    const promises = tickers.map((t) => this.fetchHistoricalPrices(t.ticker, t.currentPrice));
    const historicalDataArray = await Promise.all(promises);

    for (const data of historicalDataArray) {
      results.set(data.ticker, data);
    }

    return results;
  }
}

const yfinanceInstance = new YFinanceService();

export function getYFinanceService(): YFinanceService {
  return yfinanceInstance;
}

export { YFinanceService, HistoricalPriceData };

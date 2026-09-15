/**
 * Yahoo Finance service (via the maintained `yahoo-finance2` package).
 *
 * - Price history: replaces the old raw `v7/finance/download` CSV call, which Yahoo now
 *   rejects with 401. Pulls ~5 years of weekly closes and computes 1Y / 5Y price growth.
 *   Growth is null (never 0) when history is missing, so the UI can show "N/A".
 * - Company profile: description, sector, industry, CEO.
 *
 * Yahoo is unofficial and can break; every function degrades to null instead of throwing.
 */

import YahooFinance from 'yahoo-finance2';

export type GrowthSource = 'calculated' | 'insufficient_history' | 'unavailable';

export interface PriceHistoryGrowth {
  ticker: string;
  growth1Y: number | null;
  growth5Y: number | null;
  growthSource: GrowthSource;
}

interface WeeklyClose {
  date: Date;
  close: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
// Weekly bars: accept the closest bar within 2 weeks of the target date
const MAX_DATE_DIFF_MS = 14 * MS_PER_DAY;

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

/** Closest close to targetDate within tolerance, or null. Input order does not matter. */
export function findClosestClose(targetDate: Date, closes: WeeklyClose[]): number | null {
  const target = targetDate.getTime();
  let best: WeeklyClose | null = null;
  let bestDiff = Infinity;

  for (const bar of closes) {
    const diff = Math.abs(bar.date.getTime() - target);
    if (diff < bestDiff && diff <= MAX_DATE_DIFF_MS) {
      best = bar;
      bestDiff = diff;
    }
  }
  return best ? best.close : null;
}

/** Pure growth calculation, exported for unit tests. */
export function calculateGrowth(
  ticker: string,
  currentPrice: number,
  closes: WeeklyClose[],
  now: Date = new Date()
): PriceHistoryGrowth {
  if (!(currentPrice > 0) || closes.length === 0) {
    return { ticker, growth1Y: null, growth5Y: null, growthSource: 'insufficient_history' };
  }

  const oneYearAgo = new Date(now);
  oneYearAgo.setFullYear(now.getFullYear() - 1);
  const fiveYearsAgo = new Date(now);
  fiveYearsAgo.setFullYear(now.getFullYear() - 5);

  const price1Y = findClosestClose(oneYearAgo, closes);
  const price5Y = findClosestClose(fiveYearsAgo, closes);

  const pct = (from: number | null) => (from !== null && from > 0 ? ((currentPrice - from) / from) * 100 : null);
  const growth1Y = pct(price1Y);
  const growth5Y = pct(price5Y);

  return {
    ticker,
    growth1Y,
    growth5Y,
    growthSource: growth1Y !== null ? 'calculated' : 'insufficient_history',
  };
}

/** Yahoo uses dashes for share classes (BRK-B); Finnhub uses dots (BRK.B). */
const toYahooSymbol = (ticker: string) => ticker.toUpperCase().replace(/\./g, '-');

export interface CompanyProfile {
  description: string | null;
  sector: string | null;
  industry: string | null;
  website: string | null;
  ceo: string | null;
}

/** Company description, sector, industry and CEO (not available on Finnhub's free tier). */
export async function fetchCompanyProfile(ticker: string): Promise<CompanyProfile | null> {
  try {
    const result = await yahooFinance.quoteSummary(toYahooSymbol(ticker), { modules: ['assetProfile'] });
    const profile = result.assetProfile;
    if (!profile) return null;

    const ceo = (profile.companyOfficers ?? []).find((officer) =>
      /chief executive|\bceo\b/i.test(String(officer.title ?? ''))
    );

    return {
      description: profile.longBusinessSummary ?? null,
      sector: profile.sector ?? null,
      industry: profile.industry ?? null,
      website: profile.website ?? null,
      ceo: ceo?.name ?? null,
    };
  } catch (error) {
    console.warn(`[Yahoo] Profile failed for ${ticker}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

export async function fetchPriceGrowth(ticker: string, currentPrice: number): Promise<PriceHistoryGrowth> {
  const symbol = ticker.toUpperCase();
  try {
    const period1 = new Date(Date.now() - (5 * 365 + 21) * MS_PER_DAY);
    const result = await yahooFinance.chart(toYahooSymbol(symbol), { period1, interval: '1wk' });

    const closes: WeeklyClose[] = result.quotes
      .filter((q) => typeof q.close === 'number' && q.close > 0)
      .map((q) => ({ date: q.date, close: q.close as number }));

    return calculateGrowth(symbol, currentPrice, closes);
  } catch (error) {
    console.warn(`[History] Yahoo chart failed for ${symbol}:`, error instanceof Error ? error.message : error);
    return { ticker: symbol, growth1Y: null, growth5Y: null, growthSource: 'unavailable' };
  }
}

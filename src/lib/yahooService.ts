/**
 * Yahoo Finance service (via the maintained `yahoo-finance2` package).
 *
 * - Price history: replaces the old raw `v7/finance/download` CSV call, which Yahoo now
 *   rejects with 401. Pulls ~5 years of weekly closes and computes 1Y / 5Y price growth.
 *   Growth is null (never 0) when history is missing, so the UI can show "N/A".
 * - Company profile: description, sector, industry, CEO.
 * - Track record (Phase D): SPY daily closes and per-ticker split events.
 *
 * Yahoo is unofficial and can break; every function degrades to null instead of throwing.
 */

import YahooFinance from 'yahoo-finance2';
import type { DailyClose, SplitEvent } from './trackRecord';

export type GrowthSource = 'calculated' | 'insufficient_history' | 'unavailable';

export interface PriceHistoryGrowth {
  ticker: string;
  growth1Y: number | null;
  growth5Y: number | null;
  /**
   * 6-month price change in percent, from the SAME weekly history as growth1Y/5Y (no
   * second Yahoo call). Used only for the Discovery "6M rally >30%" flag, never in the
   * score. Optional because growth results cached before Phase C don't have it.
   */
  change6M?: number | null;
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
    return { ticker, growth1Y: null, growth5Y: null, change6M: null, growthSource: 'insufficient_history' };
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

  // Same rule as the Research tab's rally check, applied to the weekly bars already in hand
  const change6M = calculateSixMonthRally(ticker, currentPrice, closes, now).changePercent;

  return {
    ticker,
    growth1Y,
    growth5Y,
    change6M,
    growthSource: growth1Y !== null ? 'calculated' : 'insufficient_history',
  };
}

/** Yahoo uses dashes for share classes (BRK-B); Finnhub uses dots (BRK.B). */
const toYahooSymbol = (ticker: string) => ticker.toUpperCase().replace(/\./g, '-');

/** "Already priced in" rule shared by the Research tab and the Discovery flag: >30% in 6 months. */
export const RALLY_THRESHOLD_PCT = 30;

export interface SixMonthRally {
  ticker: string;
  rallied: boolean | null; // null = couldn't verify (insufficient price history)
  changePercent: number | null;
}

/** Pure calculation, exported for unit tests. */
export function calculateSixMonthRally(
  ticker: string,
  currentPrice: number,
  closes: WeeklyClose[],
  now: Date = new Date()
): SixMonthRally {
  if (!(currentPrice > 0) || closes.length === 0) {
    return { ticker, rallied: null, changePercent: null };
  }

  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setMonth(now.getMonth() - 6);
  const priceThen = findClosestClose(sixMonthsAgo, closes);
  if (priceThen === null || priceThen <= 0) {
    return { ticker, rallied: null, changePercent: null };
  }

  const changePercent = ((currentPrice - priceThen) / priceThen) * 100;
  return { ticker, rallied: changePercent > RALLY_THRESHOLD_PCT, changePercent };
}

/** Whether a stock has rallied >30% over the last 6 months, computed from real price history — never an AI guess. */
export async function fetchSixMonthRally(ticker: string, currentPrice: number): Promise<SixMonthRally> {
  const symbol = ticker.toUpperCase();
  try {
    const period1 = new Date(Date.now() - (6 * 31 + 21) * MS_PER_DAY); // ~6 months plus a buffer for weekly-bar tolerance
    const result = await yahooFinance.chart(toYahooSymbol(symbol), { period1, interval: '1wk' });

    const closes: WeeklyClose[] = result.quotes
      .filter((q) => typeof q.close === 'number' && q.close > 0)
      .map((q) => ({ date: q.date, close: q.close as number }));

    return calculateSixMonthRally(symbol, currentPrice, closes);
  } catch (error) {
    console.warn(`[History] Yahoo chart failed for 6-month rally on ${symbol}:`, error instanceof Error ? error.message : error);
    return { ticker: symbol, rallied: null, changePercent: null };
  }
}

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
    return { ticker: symbol, growth1Y: null, growth5Y: null, change6M: null, growthSource: 'unavailable' };
  }
}

/**
 * Daily closes for a symbol between two dates (track record: SPY's close on a search date).
 *
 * Checked against yahoo-finance2 4.0.2's chart() on 2026-11-17: `interval: '1d'` returns one
 * bar per trading day, stamped at that day's 9:30 ET open (13:30 UTC in summer), with
 * `close` = that day's close, not dividend-adjusted (price-only, which is what we want;
 * `adjclose` would fold dividends in). Weekends and holidays simply have no bar.
 * Returns null on failure so callers show N/A.
 */
export async function fetchDailyCloses(symbol: string, from: Date, to: Date = new Date()): Promise<DailyClose[] | null> {
  try {
    const result = await yahooFinance.chart(toYahooSymbol(symbol), { period1: from, period2: to, interval: '1d' });
    return result.quotes
      .filter((q) => typeof q.close === 'number' && q.close > 0)
      // Yahoo sends single-precision floats (732.44 arrives as 732.4400024414062). Rounding
      // to 4 decimals restores the quoted price, so it matches Finnhub's 732.44 exactly.
      .map((q) => ({ date: q.date, close: Math.round((q.close as number) * 10_000) / 10_000 }));
  } catch (error) {
    console.warn(`[Yahoo] Daily closes failed for ${symbol}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Stock splits since `from` (track record: so a split doesn't show as a fake gain or loss).
 * chart() includes split events by default; a monthly interval keeps the payload tiny and
 * still returns each split's exact ex-date (checked live on NVDA's 2024-06-10 10:1 split).
 * [] = checked, no splits. null = the check failed (Yahoo throws "No data found" for a
 * delisted or unknown symbol); the caller then counts the pick as "split check unavailable".
 */
export async function fetchSplitEvents(symbol: string, from: Date): Promise<SplitEvent[] | null> {
  try {
    const result = await yahooFinance.chart(toYahooSymbol(symbol), { period1: from, interval: '1mo', events: 'split' });
    return (result.events?.splits ?? []).map((s) => ({ date: s.date, numerator: s.numerator, denominator: s.denominator }));
  } catch (error) {
    console.warn(`[Yahoo] Split check failed for ${symbol}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

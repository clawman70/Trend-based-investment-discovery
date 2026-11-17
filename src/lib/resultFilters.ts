/**
 * Real-data filter enforcement, applied in the browser AFTER enrichment.
 *
 * Discovery passes the market-cap and exchange filters to Claude only as text hints in
 * the prompt, and nothing checked the answer. Both are re-checked here against real
 * data: market cap from Finnhub, exchange from the Finnhub US listing directory.
 *
 * Shared rule for both filters: a company whose value is UNKNOWN is kept. We can't verify
 * it, and dropping it would hide real companies just because a data source had a gap.
 */
import type { Exchange } from './types';

export type MarketCapTier = 'MICRO' | 'SMALL' | 'MID' | 'LARGE';

export function marketCapTier(marketCap: number): MarketCapTier {
  if (marketCap < 300_000_000) return 'MICRO';
  if (marketCap < 2_000_000_000) return 'SMALL';
  if (marketCap < 10_000_000_000) return 'MID';
  return 'LARGE';
}

/**
 * True if a company should stay in the results: no filter selected, its real market
 * cap matches a selected tier, or its market cap is unknown (0/unavailable).
 */
export function passesMarketCapFilter(marketCap: number, selectedTiers: string[]): boolean {
  if (selectedTiers.length === 0) return true;
  if (!(marketCap > 0)) return true;
  return selectedTiers.includes(marketCapTier(marketCap));
}

/**
 * True if a company should stay in the results: no exchange selected, its real listing
 * exchange is one of the selected ones, or its exchange is unknown (null).
 *
 * Matching is exact: selecting "NYSE" keeps NYSE listings only, not NYSE American or
 * NYSE Arca, which are separate exchanges (bug B2 fix — the filter used to be a prompt
 * hint only, so "NASDAQ only" could return NYSE companies).
 */
export function passesExchangeFilter(exchange: Exchange | null | undefined, selectedExchanges: string[]): boolean {
  if (selectedExchanges.length === 0) return true;
  if (!exchange) return true;
  return selectedExchanges.includes(exchange);
}

/** Applies both real-data filters. Generic so callers keep their full row type. */
export function applyRealDataFilters<T extends { marketCap: number; exchange: Exchange | null }>(
  companies: T[],
  filters: { marketCap: string[]; exchange: string[] }
): T[] {
  return companies.filter(
    (c) => passesMarketCapFilter(c.marketCap, filters.marketCap) && passesExchangeFilter(c.exchange, filters.exchange)
  );
}

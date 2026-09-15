/**
 * Real market-cap enforcement, applied after enrichment. Discovery used to pass the
 * market-cap filter to the AI as a text hint only — nothing dropped a company whose
 * real (Finnhub) market cap didn't actually match. This checks against real data.
 */

export type MarketCapTier = 'MICRO' | 'SMALL' | 'MID' | 'LARGE';

export function marketCapTier(marketCap: number): MarketCapTier {
  if (marketCap < 300_000_000) return 'MICRO';
  if (marketCap < 2_000_000_000) return 'SMALL';
  if (marketCap < 10_000_000_000) return 'MID';
  return 'LARGE';
}

/**
 * True if a company should stay in the results: no filter selected, its real market
 * cap matches a selected tier, or its market cap is unknown (0/unavailable) — we don't
 * drop what we can't verify, since that would hide real companies just because Finnhub
 * lacks data for them.
 */
export function passesMarketCapFilter(marketCap: number, selectedTiers: string[]): boolean {
  if (selectedTiers.length === 0) return true;
  if (!(marketCap > 0)) return true;
  return selectedTiers.includes(marketCapTier(marketCap));
}

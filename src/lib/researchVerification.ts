/**
 * Ticker check for companies named in a Research report (bug B5).
 *
 * Gemini types the ticker for each company it mentions. That ticker used to be trusted
 * as-is to fetch a quote and the 6-month rally — so a wrong ticker that happened to
 * belong to ANOTHER real company showed that company's rally under the wrong name.
 *
 * Now every mentioned company goes through the same Finnhub listing directory the
 * Discovery hallucination gate uses:
 *   1. Not a listed major-US-exchange security → UNVERIFIED ('not_listed'), no rally.
 *   2. Listed, but the directory's official name clearly doesn't match the name Gemini
 *      gave → UNVERIFIED ('name_mismatch'), no rally.
 *   3. Directory couldn't be loaded → UNVERIFIED ('directory_unavailable'), no rally.
 *   4. Otherwise VERIFIED: rally computed from real prices, and the market-cap tier is
 *      recomputed from the real Finnhub market cap. If Finnhub has no market cap, the
 *      tier stays Gemini's and is labeled an AI estimate.
 * Unverified companies always keep Gemini's tier, labeled as an AI estimate.
 */
import { getCachedData, setCachedData } from './dbHelper';
import { fetchMetrics, fetchQuote, FinnhubMetrics, FinnhubQuote, isFinnhubConfigured, normalizeMetrics } from './finnhubService';
import { getListingDirectory, normalizeTicker } from './tickerValidator';
import { fetchSixMonthRally } from './yahooService';
import { marketCapTier } from './resultFilters';
import type { MentionedCompany, MentionedMarketCapTier } from './types';

// Same cache keys and lifetimes as /api/enrich, so Research and Discovery share cached data.
const QUOTE_CACHE_MS = 5 * 60 * 1000;
const FUNDAMENTALS_CACHE_MS = 24 * 60 * 60 * 1000;

async function cached<T>(key: string, ttlMs: number, fetcher: () => Promise<T | null>): Promise<T | null> {
  const hit = (await getCachedData(key)) as T | null;
  if (hit) return hit;
  const value = await fetcher();
  if (value) await setCachedData(key, 'financial', value, ttlMs);
  return value;
}

/**
 * Words that say nothing about WHICH company it is: legal suffixes, share-class labels,
 * and filler. Removed before comparing names.
 */
const NAME_NOISE = new Set([
  'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'ltd', 'limited', 'plc', 'llc', 'lp', 'sa', 'nv', 'ag', 'se',
  'holdings', 'holding', 'group', 'the', 'and', 'of', 'cl', 'class', 'a', 'b', 'c', 'adr', 'ads', 'sp', 'spon', 'sponsored',
  'ord', 'shs', 'new', 'common', 'stock',
]);

function significantTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0 && !NAME_NOISE.has(t));
}

/**
 * True unless the two names CLEARLY refer to different companies. Lenient on purpose:
 * directory names are things like "ALPHABET INC-CL A" or "TAIWAN SEMICONDUCTOR-SP ADR".
 *
 * Match if either name's first meaningful word appears in the other (so "Rocket Lab"
 * matches "ROCKET LAB USA INC"), or the names are the same once spaces are removed
 * ("IonQ" vs "ION Q"). A shared generic word alone ("Power", "Energy") is NOT enough —
 * "Plug Power" vs "XYZ POWER INC" is a mismatch. Exported for tests.
 */
export function namesMatch(aiName: string, listingName: string): boolean {
  const a = significantTokens(aiName);
  const b = significantTokens(listingName);
  if (a.length === 0 || b.length === 0) return false;
  if (b.includes(a[0]) || a.includes(b[0])) return true;
  const compactA = a.join('');
  const compactB = b.join('');
  return compactA.length >= 3 && compactB.length >= 3 && (compactA.startsWith(compactB) || compactB.startsWith(compactA));
}

function toMentionedTier(marketCap: number): MentionedMarketCapTier {
  return marketCapTier(marketCap).toLowerCase() as MentionedMarketCapTier;
}

async function verifyOne(
  company: MentionedCompany,
  directory: Awaited<ReturnType<typeof getListingDirectory>>
): Promise<MentionedCompany> {
  const unverified = (reason: MentionedCompany['unverifiedReason'], listingName: string | null = null): MentionedCompany => ({
    ...company,
    recentRally: null,
    tickerStatus: 'unverified',
    unverifiedReason: reason,
    listingName,
    marketCapTierSource: 'ai_estimate',
  });

  if (!directory) return unverified('directory_unavailable');

  const ticker = normalizeTicker(company.ticker || '');
  const listing = ticker ? directory[ticker] : undefined;
  if (!listing) return unverified('not_listed');
  if (!namesMatch(company.name, listing.name)) return unverified('name_mismatch', listing.name);

  // Verified: compute real values. Any failure leaves that one value as N/A / AI estimate.
  let recentRally: boolean | null = null;
  let tier = company.marketCapTier;
  let tierSource: MentionedCompany['marketCapTierSource'] = 'ai_estimate';

  try {
    const metrics = await cached<FinnhubMetrics>(`metrics:${ticker}`, FUNDAMENTALS_CACHE_MS, () => fetchMetrics(ticker));
    const marketCap = normalizeMetrics(metrics).marketCap;
    if (marketCap !== null && marketCap > 0) {
      tier = toMentionedTier(marketCap);
      tierSource = 'finnhub';
    }
  } catch (err) {
    console.warn(`[Research] Market cap lookup failed for ${ticker}:`, err instanceof Error ? err.message : err);
  }

  try {
    const quote = await cached<FinnhubQuote>(`quote:${ticker}`, QUOTE_CACHE_MS, () => fetchQuote(ticker));
    if (quote && quote.c > 0) {
      recentRally = (await fetchSixMonthRally(ticker, quote.c)).rallied;
    }
  } catch (err) {
    console.warn(`[Research] Rally check failed for ${ticker}:`, err instanceof Error ? err.message : err);
  }

  return {
    ...company,
    recentRally,
    marketCapTier: tier,
    marketCapTierSource: tierSource,
    tickerStatus: 'verified',
    listingName: listing.name,
  };
}

/** Runs the ticker check on every company in a report. Never throws. */
export async function verifyMentionedCompanies(companies: MentionedCompany[]): Promise<MentionedCompany[]> {
  if (companies.length === 0) return companies;
  const directory = isFinnhubConfigured() ? await getListingDirectory() : null;
  return Promise.all(companies.map((c) => verifyOne(c, directory)));
}

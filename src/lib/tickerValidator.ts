import { getCachedData, setCachedData } from './dbHelper';
import { fetchUsSymbols, isFinnhubConfigured, FinnhubSymbol } from './finnhubService';
import { Exchange } from './types';

/**
 * HALLUCINATION GATE: validates AI-suggested tickers against Finnhub's US symbol directory.
 *
 * Only listings on major US exchanges count as valid. OTC listings, ETFs/ETPs, funds,
 * warrants, rights and units are rejected, because the app only researches listed
 * operating companies. Catches made-up symbols, typos, delisted names and merged SPACs.
 *
 * The directory is cached for 24 hours (one Finnhub call per day).
 */

const DIRECTORY_CACHE_KEY = 'validation:us_listings';
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000;

/** Finnhub MIC code -> Google Finance exchange code used across the UI. */
const MIC_TO_EXCHANGE: Record<string, Exchange> = {
  XNAS: 'NASDAQ',
  XNYS: 'NYSE',
  XASE: 'NYSEAMERICAN',
  ARCX: 'NYSEARCA',
  BATS: 'BATS',
};

const EXCLUDED_TYPE_PATTERN = /ETP|Fund|WRT|Warrant|Right|Unit|Preferred|Preference|Bond|Note|Structured/i;

export interface Listing {
  symbol: string;
  name: string;
  exchange: Exchange;
  type: string;
}

type ListingDirectory = Record<string, Listing>;

/** AI models often write class shares as BRK-B or BRK/B; Finnhub uses BRK.B. */
export function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase().replace(/[-/]/g, '.');
}

export function buildListingDirectory(symbols: FinnhubSymbol[]): ListingDirectory {
  const directory: ListingDirectory = {};
  for (const s of symbols) {
    const exchange = MIC_TO_EXCHANGE[s.mic];
    if (!exchange || !s.symbol) continue;
    if (EXCLUDED_TYPE_PATTERN.test(s.type || '')) continue;
    const symbol = s.symbol.toUpperCase();
    directory[symbol] = { symbol, name: s.description || symbol, exchange, type: s.type || '' };
  }
  return directory;
}

/** Returns the cached listing directory, or null if it cannot be loaded. */
export async function getListingDirectory(): Promise<ListingDirectory | null> {
  const cached = (await getCachedData(DIRECTORY_CACHE_KEY)) as ListingDirectory | null;
  if (cached && Object.keys(cached).length > 0) {
    return cached;
  }

  if (!isFinnhubConfigured()) {
    console.warn('[Validation Gate] FINNHUB_API_KEY not configured — ticker validation bypassed.');
    return null;
  }

  try {
    const directory = buildListingDirectory(await fetchUsSymbols());
    if (Object.keys(directory).length === 0) {
      console.warn('[Validation Gate] Finnhub returned an empty symbol directory — validation bypassed.');
      return null;
    }
    await setCachedData(DIRECTORY_CACHE_KEY, 'validation', directory, CACHE_DURATION_MS);
    return directory;
  } catch (error) {
    console.error('[Validation Gate] Failed to load Finnhub symbol directory — validation bypassed:', error);
    return null;
  }
}

/** Looks up one listing (exchange + official name). Null if unknown or directory unavailable. */
export async function getListing(ticker: string): Promise<Listing | null> {
  const directory = await getListingDirectory();
  return directory?.[normalizeTicker(ticker)] ?? null;
}

export async function validateTickers(tickers: string[]): Promise<{
  valid: string[];
  invalid: string[];
  bypassed: boolean;
}> {
  const normalized = tickers.map(normalizeTicker);
  const directory = await getListingDirectory();

  // Fail open (but flagged) so a Finnhub outage doesn't block discovery entirely.
  // The UI shows a visible warning whenever bypassed === true.
  if (!directory) {
    return { valid: normalized, invalid: [], bypassed: true };
  }

  const valid: string[] = [];
  const invalid: string[] = [];
  for (const ticker of normalized) {
    (directory[ticker] ? valid : invalid).push(ticker);
  }
  return { valid, invalid, bypassed: false };
}

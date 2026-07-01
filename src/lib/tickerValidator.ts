import { getCachedData, setCachedData } from './dbHelper';

const STOCK_LIST_CACHE_KEY = 'validation:stock_list';
const CACHE_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days cache for stock list

/**
 * HALLUCINATION GATE: Validates tickers against FMP's live NYSE/NASDAQ directory.
 *
 * This prevents wasting API calls enriching dead/fake tickers that Gemini may hallucinate.
 * Catches: legacy tickers, delisted companies, SPACs that have merged, typos, made-up symbols.
 *
 * Caching strategy: Stock list is cached for 30 days (updates quarterly), maximizing
 * the FMP free tier budget (250 req/day) by never re-fetching static exchange data.
 */

export async function getValidSymbols(): Promise<{ symbols: Set<string>; loaded: boolean }> {
  try {
    const cachedSymbols = await getCachedData(STOCK_LIST_CACHE_KEY);
    if (cachedSymbols && Array.isArray(cachedSymbols)) {
      return { symbols: new Set(cachedSymbols), loaded: true };
    }
  } catch (error) {
    console.warn("Failed to retrieve cached stock list:", error);
  }

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey || apiKey === 'PLACEHOLDER_API_KEY') {
    console.warn("FMP_API_KEY is not configured or is a placeholder. Ticker validation will be bypassed.");
    return { symbols: new Set<string>(), loaded: false };
  }

  try {
    const url = `https://financialmodelingprep.com/api/v3/stock/list?apikey=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`FMP API stock list request failed with status ${response.status}. Validation will be bypassed.`);
      return { symbols: new Set<string>(), loaded: false };
    }

    const data = await response.json();
    if (Array.isArray(data)) {
      const symbolsList = data.map((item: unknown) => 
        String((item as { symbol?: string }).symbol || '').toUpperCase()
      ).filter(Boolean);
      
      // Save cache
      await setCachedData(STOCK_LIST_CACHE_KEY, 'validation', symbolsList, CACHE_DURATION_MS);
      return { symbols: new Set(symbolsList), loaded: true };
    }
  } catch (error) {
    console.error("Error fetching stock list from FMP, validation will be bypassed:", error);
  }

  return { symbols: new Set<string>(), loaded: false };
}

export async function validateTickers(tickers: string[]): Promise<{
  valid: string[];
  invalid: string[];
  bypassed: boolean;
}> {
  const { symbols, loaded } = await getValidSymbols();

  // If the list could not be loaded, bypass validation so the app doesn't break.
  if (!loaded || symbols.size === 0) {
    return {
      valid: tickers,
      invalid: [],
      bypassed: true
    };
  }

  const valid: string[] = [];
  const invalid: string[] = [];

  for (const ticker of tickers) {
    const upperTicker = ticker.trim().toUpperCase();
    if (symbols.has(upperTicker)) {
      valid.push(upperTicker);
    } else {
      invalid.push(upperTicker);
    }
  }

  return {
    valid,
    invalid,
    bypassed: false
  };
}

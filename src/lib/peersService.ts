/**
 * Finnhub Peers Service
 *
 * Fetches competitor/peer companies for a given ticker using Finnhub's
 * free tier peers endpoint, then enriches with real-time quote data.
 */

import { getFinnhubService } from './finnhubService';

export interface PeerCompany {
  ticker: string;
  companyName: string;
  stockPrice: number;
  marketCap: number;
  peRatio: number | null;
  growth1Y: number;
}

/**
 * Fetch peer/competitor companies for a given ticker
 * Includes up to 10 direct competitors with quote data
 */
export async function getPeersForTicker(ticker: string): Promise<PeerCompany[]> {
  try {
    const finnhub = getFinnhubService();

    // Fetch list of peer tickers from Finnhub
    const apiKey = process.env.FINNHUB_API_KEY;
    if (!apiKey || apiKey === 'PLACEHOLDER_API_KEY') {
      console.warn('[Peers] Finnhub API key not configured');
      return [];
    }

    const peersUrl = `https://finnhub.io/api/v1/stock/peers?symbol=${ticker.toUpperCase()}&token=${apiKey}`;
    const peersResponse = await fetch(peersUrl);

    if (!peersResponse.ok) {
      console.warn(`[Peers] Failed to fetch peers for ${ticker}: ${peersResponse.status}`);
      return [];
    }

    const peerTickers = (await peersResponse.json()) as string[];

    if (!peerTickers || peerTickers.length === 0) {
      console.log(`[Peers] No peers found for ${ticker}`);
      return [];
    }

    console.log(`[Peers] Found ${peerTickers.length} peers for ${ticker}: ${peerTickers.slice(0, 5).join(', ')}...`);

    // Fetch quotes for all peer tickers (respects rate limiting)
    const peerQuotes = await finnhub.fetchBatchQuotes(peerTickers);

    // Transform quotes to PeerCompany format
    const peers: PeerCompany[] = Array.from(peerQuotes.entries()).map(([peerTicker, quote]) => ({
      ticker: peerTicker,
      companyName: peerTicker, // Finnhub doesn't provide name in quote endpoint
      stockPrice: quote.stockPrice,
      marketCap: quote.marketCap,
      peRatio: quote.peRatio,
      growth1Y: 0, // Would need separate yfinance call for growth
    }));

    return peers.sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0)); // Sort by market cap
  } catch (error) {
    console.error(`[Peers] Error fetching peers for ${ticker}:`, error);
    return [];
  }
}

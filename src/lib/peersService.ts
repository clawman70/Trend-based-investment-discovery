/**
 * Peer companies via Finnhub.
 *
 * Finnhub's /stock/peers returns same-industry tickers. Each peer is enriched with a live
 * quote, market cap and P/E (from /stock/metric), and its official name from the cached
 * symbol directory. Capped at MAX_PEERS to keep the free-tier call budget reasonable.
 */

import { fetchMetrics, fetchPeers, fetchQuote, isFinnhubConfigured, normalizeMetrics } from './finnhubService';
import { getListing } from './tickerValidator';

const MAX_PEERS = 8;

export interface PeerCompany {
  ticker: string;
  companyName: string;
  stockPrice: number; // 0 = unavailable
  marketCap: number; // 0 = unavailable
  peRatio: number | null;
}

export async function getPeersForTicker(ticker: string): Promise<PeerCompany[]> {
  const upperTicker = ticker.toUpperCase();

  if (!isFinnhubConfigured()) {
    console.warn('[Peers] FINNHUB_API_KEY not configured');
    return [];
  }

  try {
    const peerTickers = (await fetchPeers(upperTicker))
      .map((p) => p.toUpperCase())
      .filter((p) => p !== upperTicker)
      .slice(0, MAX_PEERS);

    const peers = await Promise.all(
      peerTickers.map(async (peer): Promise<PeerCompany | null> => {
        const [quote, metrics, listing] = await Promise.all([
          fetchQuote(peer).catch(() => null),
          fetchMetrics(peer).catch(() => null),
          getListing(peer),
        ]);
        if (!quote && !metrics) return null; // nothing real to show

        const fundamentals = normalizeMetrics(metrics);
        return {
          ticker: peer,
          companyName: listing?.name ?? peer,
          stockPrice: quote?.c ?? 0,
          marketCap: fundamentals.marketCap ?? 0,
          peRatio: fundamentals.peRatio,
        };
      })
    );

    return peers
      .filter((p): p is PeerCompany => p !== null)
      .sort((a, b) => b.marketCap - a.marketCap);
  } catch (error) {
    console.error(`[Peers] Error fetching peers for ${upperTicker}:`, error);
    return [];
  }
}

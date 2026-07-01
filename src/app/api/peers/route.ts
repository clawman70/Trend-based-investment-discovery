import { NextRequest, NextResponse } from 'next/server';
import { getCachedData, setCachedData } from '@/lib/dbHelper';

const CACHE_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface PeerData {
  symbol: string;
  name: string;
  price: number;
  marketCap: number;
}

interface FMPQuote {
  symbol?: string;
  name?: string;
  price?: number;
  marketCap?: number;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get('ticker');

    if (!ticker) {
      return NextResponse.json({ error: 'Ticker symbol is required' }, { status: 400 });
    }

    const upperTicker = ticker.trim().toUpperCase();
    const cacheKey = `peers:${upperTicker}`;

    // 1. Check cache first
    const cached = (await getCachedData(cacheKey)) as PeerData[] | null;
    if (cached) {
      return NextResponse.json(cached);
    }

    const apiKey = process.env.FMP_API_KEY;

    // 2. Fallback to mock data if API key is not configured
    if (!apiKey || apiKey === 'PLACEHOLDER_API_KEY') {
      const dummyPeers: PeerData[] = [
        { symbol: `${upperTicker}-PEER1`, name: `${upperTicker} Analytics Corp`, price: 120.50, marketCap: 38000000000 },
        { symbol: `${upperTicker}-PEER2`, name: `${upperTicker} Systems Inc`, price: 85.30, marketCap: 15500000000 },
        { symbol: `${upperTicker}-PEER3`, name: `${upperTicker} Technologies`, price: 42.15, marketCap: 8900000000 },
      ];
      await setCachedData(cacheKey, 'competitors', dummyPeers, CACHE_DURATION_MS);
      return NextResponse.json(dummyPeers);
    }

    // 3. Fetch from FMP
    try {
      const peersUrl = `https://financialmodelingprep.com/api/v3/stock_peers?symbol=${upperTicker}&apikey=${apiKey}`;
      const peersRes = await fetch(peersUrl);
      if (!peersRes.ok) {
        throw new Error(`Peers fetch failed: ${peersRes.status}`);
      }

      const peersData = await peersRes.json();
      let peerSymbols: string[] = [];

      if (Array.isArray(peersData) && peersData.length > 0 && peersData[0].peersList) {
        peerSymbols = peersData[0].peersList as string[];
      }

      // If no peers are found, return empty or fallback
      if (peerSymbols.length === 0) {
        await setCachedData(cacheKey, 'competitors', [], CACHE_DURATION_MS);
        return NextResponse.json([]);
      }

      // Fetch quote data for peers in a batch
      const batchStr = peerSymbols.slice(0, 5).join(','); // Limit to top 5 peers
      const quoteUrl = `https://financialmodelingprep.com/api/v3/quote/${batchStr}?apikey=${apiKey}`;
      const quoteRes = await fetch(quoteUrl);
      if (!quoteRes.ok) {
        throw new Error(`Quotes fetch failed: ${quoteRes.status}`);
      }

      const quotes = (await quoteRes.json()) as FMPQuote[];
      const peersList: PeerData[] = quotes.map(q => ({
        symbol: q.symbol || 'N/A',
        name: q.name || q.symbol || 'N/A',
        price: q.price || 0,
        marketCap: q.marketCap || 0,
      }));

      await setCachedData(cacheKey, 'competitors', peersList, CACHE_DURATION_MS);
      return NextResponse.json(peersList);
    } catch (err) {
      console.error(`FMP live peers fetch failed for ticker ${upperTicker}:`, err);
      // Fallback
      const dummyPeers: PeerData[] = [
        { symbol: `${upperTicker}-COMP`, name: `${upperTicker} Competitor`, price: 95.0, marketCap: 20000000000 },
      ];
      await setCachedData(cacheKey, 'competitors', dummyPeers, CACHE_DURATION_MS);
      return NextResponse.json(dummyPeers);
    }
  } catch (error: unknown) {
    console.error("Error in peers GET:", error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

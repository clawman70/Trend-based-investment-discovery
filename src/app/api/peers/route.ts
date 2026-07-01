import { NextRequest, NextResponse } from 'next/server';
import { getCachedData, setCachedData } from '@/lib/dbHelper';
import { getPeersForTicker, PeerCompany } from '@/lib/peersService';

const CACHE_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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
    const cached = (await getCachedData(cacheKey)) as PeerCompany[] | null;
    if (cached) {
      return NextResponse.json(cached);
    }

    // 2. Fetch from Finnhub
    const peers = await getPeersForTicker(upperTicker);

    // 3. Cache results (even if empty)
    await setCachedData(cacheKey, 'competitors', peers, CACHE_DURATION_MS);

    return NextResponse.json(peers);
  } catch (error: unknown) {
    console.error('Error in peers GET:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

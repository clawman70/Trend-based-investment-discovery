import { NextRequest, NextResponse } from 'next/server';
import { deleteWatchlistItem, listWatchlistItems, updateWatchlistItem, upsertWatchlistItem } from '@/lib/stores/watchlistStore';
import { fetchQuote, fetchQuotes, isFinnhubConfigured } from '@/lib/finnhubService';
import { compareWithBenchmark } from '@/lib/benchmark';
import { BENCHMARK_TICKER } from '@/lib/trackRecord';

/**
 * Cost basis for a newly starred ticker (bug B8). Uses the browser's price when it's a
 * real positive number. Otherwise fetches a live quote here. If that also fails, returns
 * null — stored as "no cost basis" and shown as N/A, never 0 (0 used to blank the
 * gain/loss forever).
 */
async function resolveCostBasis(ticker: string, clientPrice: unknown): Promise<number | null> {
  if (typeof clientPrice === 'number' && Number.isFinite(clientPrice) && clientPrice > 0) {
    return clientPrice;
  }
  if (!isFinnhubConfigured()) return null;
  try {
    const quote = await fetchQuote(ticker);
    return quote && quote.c > 0 ? quote.c : null;
  } catch (err) {
    console.warn(`[Watchlist] Could not fetch a price for ${ticker}; cost basis stored as N/A:`, err instanceof Error ? err.message : err);
    return null;
  }
}

export async function GET() {
  try {
    const items = await listWatchlistItems();

    if (items.length === 0) {
      return NextResponse.json([]);
    }

    // Live current prices from Finnhub. A missing price stays null — never fall back to cost basis.
    const tickers = items.map((item) => item.ticker.trim().toUpperCase());
    const priceMap = new Map<string, number>();

    if (isFinnhubConfigured()) {
      try {
        // SPY rides along in the same batch (fetchQuotes de-duplicates) for the "vs SPY" column
        const quotes = await fetchQuotes([...tickers, BENCHMARK_TICKER]);
        quotes.forEach((quote, symbol) => priceMap.set(symbol, quote.c));
      } catch (err) {
        console.error('Failed to fetch live prices for watchlist:', err);
      }
    }

    // Assemble watchlist results with gain/loss % calculations
    const withReturns = items.map((item) => {
      const currentPrice = priceMap.get(item.ticker.toUpperCase()) ?? null;
      const gainLossPercent = currentPrice !== null && item.priceAtAdd !== null && item.priceAtAdd > 0
        ? ((currentPrice - item.priceAtAdd) / item.priceAtAdd) * 100
        : null;

      return {
        ...item,
        currentPrice,
        gainLossPercent,
      };
    });

    // Phase D: the same gain/loss compared with SPY from the day each item was starred
    // (same helper and rules as the Scorecard; N/A when either side is missing)
    const comparisons = await compareWithBenchmark(
      withReturns.map((item) => ({ since: new Date(item.addedAt), returnPercent: item.gainLossPercent })),
      priceMap.get(BENCHMARK_TICKER) ?? null
    );
    const enrichedWatchlist = withReturns.map((item, i) => ({ ...item, ...comparisons[i] }));

    return NextResponse.json(enrichedWatchlist);
  } catch (error: unknown) {
    console.error("Error in watchlist GET:", error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ticker, companyName, priceAtAdd, sourceSearchId, notes, tags } = body as {
      ticker: string;
      companyName: string;
      priceAtAdd?: number | null; // optional: missing/0 triggers a server-side quote
      sourceSearchId?: string;
      notes?: string;
      tags?: string[];
    };

    if (!ticker || !companyName) {
      return NextResponse.json({ error: 'Ticker and Company Name are required' }, { status: 400 });
    }

    const cleanTicker = ticker.trim().toUpperCase();
    const newItem = await upsertWatchlistItem({
      ticker: cleanTicker,
      companyName,
      priceAtAdd: await resolveCostBasis(cleanTicker, priceAtAdd),
      sourceSearchId: sourceSearchId || null,
      notes: notes || null,
      tags: tags || [],
    });

    return NextResponse.json(newItem);
  } catch (error: unknown) {
    console.error("Error in watchlist POST:", error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, notes, tags } = body as {
      id: string;
      notes?: string;
      tags?: string[];
    };

    if (!id) {
      return NextResponse.json({ error: 'Watchlist Item ID is required' }, { status: 400 });
    }

    const updated = await updateWatchlistItem(id, { notes, tags });
    if (!updated) {
      return NextResponse.json({ error: 'Watchlist Item not found' }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (error: unknown) {
    console.error("Error in watchlist PUT:", error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const ticker = searchParams.get('ticker');

    if (!id && !ticker) {
      return NextResponse.json({ error: 'Watchlist ID or Ticker is required' }, { status: 400 });
    }

    const deleted = await deleteWatchlistItem({ id: id ?? undefined, ticker: ticker ? ticker.toUpperCase() : undefined });
    if (!deleted) {
      return NextResponse.json({ error: 'Watchlist Item not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Error in watchlist DELETE:", error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

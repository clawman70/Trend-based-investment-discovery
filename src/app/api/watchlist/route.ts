import { NextRequest, NextResponse } from 'next/server';
import { deleteWatchlistItem, listWatchlistItems, updateWatchlistItem, upsertWatchlistItem } from '@/lib/stores/watchlistStore';
import { fetchQuotes, isFinnhubConfigured } from '@/lib/finnhubService';

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
        const quotes = await fetchQuotes(tickers);
        quotes.forEach((quote, symbol) => priceMap.set(symbol, quote.c));
      } catch (err) {
        console.error('Failed to fetch live prices for watchlist:', err);
      }
    }

    // Assemble watchlist results with gain/loss % calculations
    const enrichedWatchlist = items.map((item) => {
      const currentPrice = priceMap.get(item.ticker.toUpperCase()) ?? null;
      const gainLossPercent = currentPrice !== null && item.priceAtAdd > 0
        ? ((currentPrice - item.priceAtAdd) / item.priceAtAdd) * 100
        : null;

      return {
        ...item,
        currentPrice,
        gainLossPercent,
      };
    });

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
      priceAtAdd: number;
      sourceSearchId?: string;
      notes?: string;
      tags?: string[];
    };

    if (!ticker || !companyName) {
      return NextResponse.json({ error: 'Ticker and Company Name are required' }, { status: 400 });
    }

    const newItem = await upsertWatchlistItem({
      ticker: ticker.trim().toUpperCase(),
      companyName,
      priceAtAdd,
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

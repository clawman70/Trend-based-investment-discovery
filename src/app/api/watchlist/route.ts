import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import {
  memoryWatchlistItems,
  MemoryWatchlistItem,
} from '@/lib/memoryStore';
import { fetchQuotes, isFinnhubConfigured } from '@/lib/finnhubService';

export async function GET() {
  try {
    const items = [...memoryWatchlistItems].sort(
      (a, b) => b.addedAt.getTime() - a.addedAt.getTime()
    );

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

    const upperTicker = ticker.trim().toUpperCase();

    // Memory write
    const existingIdx = memoryWatchlistItems.findIndex((item) => item.ticker === upperTicker);
    const newItem: MemoryWatchlistItem = {
      id: existingIdx !== -1 ? memoryWatchlistItems[existingIdx].id : crypto.randomUUID(),
      ticker: upperTicker,
      companyName,
      addedAt: existingIdx !== -1 ? memoryWatchlistItems[existingIdx].addedAt : new Date(),
      priceAtAdd,
      sourceSearchId: sourceSearchId || null,
      notes: notes || null,
      tags: tags || [],
    };

    if (existingIdx !== -1) {
      memoryWatchlistItems[existingIdx] = newItem;
    } else {
      memoryWatchlistItems.push(newItem);
    }

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

    const existing = memoryWatchlistItems.find((item) => item.id === id);
    if (!existing) {
      return NextResponse.json({ error: 'Watchlist Item not found' }, { status: 404 });
    }

    if (notes !== undefined) existing.notes = notes;
    if (tags !== undefined) existing.tags = tags;

    return NextResponse.json(existing);
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

    const index = id
      ? memoryWatchlistItems.findIndex((item) => item.id === id)
      : memoryWatchlistItems.findIndex((item) => item.ticker === ticker?.toUpperCase());

    if (index === -1) {
      return NextResponse.json({ error: 'Watchlist Item not found' }, { status: 404 });
    }

    memoryWatchlistItems.splice(index, 1);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Error in watchlist DELETE:", error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

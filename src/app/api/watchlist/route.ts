import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { isDbAvailable } from '@/lib/dbHelper';
import { prisma } from '@/lib/prisma';
import {
  memoryWatchlistItems,
  MemoryWatchlistItem,
} from '@/lib/memoryStore';

interface FMPQuote {
  symbol?: string;
  price?: number;
}

export async function GET() {
  try {
    const dbActive = await isDbAvailable();
    let items: {
      id: string;
      ticker: string;
      companyName: string;
      addedAt: Date;
      priceAtAdd: number;
      sourceSearchId: string | null;
      notes: string | null;
      tags: string[];
    }[] = [];

    if (dbActive) {
      items = await prisma.watchlistItem.findMany({
        orderBy: { addedAt: 'desc' },
      });
    } else {
      items = [...memoryWatchlistItems].sort(
        (a, b) => b.addedAt.getTime() - a.addedAt.getTime()
      );
    }

    if (items.length === 0) {
      return NextResponse.json([]);
    }

    // Dynamic current price lookup using FMP batch quotes
    const tickers = items.map((item) => item.ticker.trim().toUpperCase());
    const apiKey = process.env.FMP_API_KEY;
    const priceMap = new Map<string, number>();

    if (apiKey && apiKey !== 'PLACEHOLDER_API_KEY' && tickers.length > 0) {
      try {
        const batchTickersStr = tickers.join(',');
        const quoteUrl = `https://financialmodelingprep.com/api/v3/quote/${batchTickersStr}?apikey=${apiKey}`;
        const quoteResponse = await fetch(quoteUrl);
        
        if (quoteResponse.ok) {
          const quotes = (await quoteResponse.json()) as FMPQuote[];
          if (Array.isArray(quotes)) {
            for (const q of quotes) {
              if (q.symbol && q.price !== undefined) {
                priceMap.set(q.symbol.toUpperCase(), Number(q.price));
              }
            }
          }
        }
      } catch (err) {
        console.error("Failed to fetch live prices for watchlist, using fallbacks:", err);
      }
    }

    // Assemble watchlist results with gain/loss % calculations
    const enrichedWatchlist = items.map((item) => {
      const currentPrice = priceMap.get(item.ticker.toUpperCase()) || item.priceAtAdd;
      const gainLossPercent = item.priceAtAdd > 0
        ? ((currentPrice - item.priceAtAdd) / item.priceAtAdd) * 100
        : 0;

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
    const dbActive = await isDbAvailable();

    if (dbActive) {
      const newItem = await prisma.watchlistItem.upsert({
        where: { ticker: upperTicker },
        update: {
          companyName,
          priceAtAdd,
          sourceSearchId: sourceSearchId || null,
          notes: notes || null,
          tags: tags || [],
        },
        create: {
          ticker: upperTicker,
          companyName,
          priceAtAdd,
          sourceSearchId: sourceSearchId || null,
          notes: notes || null,
          tags: tags || [],
        },
      });
      return NextResponse.json(newItem);
    } else {
      // Memory fallback write
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
    }
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

    const dbActive = await isDbAvailable();

    if (dbActive) {
      const updated = await prisma.watchlistItem.update({
        where: { id },
        data: {
          notes: notes !== undefined ? notes : undefined,
          tags: tags !== undefined ? tags : undefined,
        },
      });
      return NextResponse.json(updated);
    } else {
      // Memory fallback update
      const existing = memoryWatchlistItems.find((item) => item.id === id);
      if (!existing) {
        return NextResponse.json({ error: 'Watchlist Item not found' }, { status: 404 });
      }

      if (notes !== undefined) existing.notes = notes;
      if (tags !== undefined) existing.tags = tags;

      return NextResponse.json(existing);
    }
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

    const dbActive = await isDbAvailable();

    if (dbActive) {
      if (id) {
        await prisma.watchlistItem.delete({ where: { id } });
      } else if (ticker) {
        await prisma.watchlistItem.delete({ where: { ticker: ticker.toUpperCase() } });
      }
      return NextResponse.json({ success: true });
    } else {
      // Memory fallback delete
      const index = id 
        ? memoryWatchlistItems.findIndex((item) => item.id === id)
        : memoryWatchlistItems.findIndex((item) => item.ticker === ticker?.toUpperCase());

      if (index === -1) {
        return NextResponse.json({ error: 'Watchlist Item not found' }, { status: 404 });
      }

      memoryWatchlistItems.splice(index, 1);
      return NextResponse.json({ success: true });
    }
  } catch (error: unknown) {
    console.error("Error in watchlist DELETE:", error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

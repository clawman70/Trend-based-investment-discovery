import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import {
  memoryTrendPortfolios,
  memoryPortfolioItems,
  memoryWatchlistItems,
  MemoryTrendPortfolio,
  MemoryPortfolioItem,
} from '@/lib/memoryStore';
import { fetchQuotes, isFinnhubConfigured } from '@/lib/finnhubService';

export async function GET() {
  try {
    const rawPortfolios = memoryTrendPortfolios.map((p) => {
      const items = memoryPortfolioItems.filter((i) => i.portfolioId === p.id);
      const resolvedItems = items
        .map((item) => {
          const wl = memoryWatchlistItems.find((w) => w.id === item.watchlistId);
          return wl ? { id: item.id, watchlist: wl } : null;
        })
        .filter((x): x is { id: string; watchlist: typeof memoryWatchlistItems[0] } => x !== null);

      return {
        id: p.id,
        name: p.name,
        description: p.description,
        createdAt: p.createdAt,
        items: resolvedItems,
      };
    });

    const allTickers = new Set<string>();
    for (const port of rawPortfolios) {
      for (const item of port.items) {
        if (item.watchlist?.ticker) {
          allTickers.add(item.watchlist.ticker.toUpperCase());
        }
      }
    }

    // Live current prices from Finnhub. A missing price stays null — never fall back to cost basis.
    const priceMap = new Map<string, number>();
    const tickersArr = Array.from(allTickers);

    if (isFinnhubConfigured() && tickersArr.length > 0) {
      try {
        const quotes = await fetchQuotes(tickersArr);
        quotes.forEach((quote, symbol) => priceMap.set(symbol, quote.c));
      } catch (err) {
        console.error('Failed to fetch live prices for portfolios:', err);
      }
    }

    const portfolios = rawPortfolios.map((port) => {
      // Totals only include items that have both a cost basis and a live price
      let totalCostBasis = 0;
      let totalCurrentValue = 0;
      let unpricedCount = 0;

      const itemsList = port.items.map((item) => {
        const wl = item.watchlist;
        const currentPrice = priceMap.get(wl.ticker.toUpperCase()) ?? null;
        const gainLossPercent = currentPrice !== null && wl.priceAtAdd > 0
          ? ((currentPrice - wl.priceAtAdd) / wl.priceAtAdd) * 100
          : null;

        if (currentPrice !== null && wl.priceAtAdd > 0) {
          totalCostBasis += wl.priceAtAdd;
          totalCurrentValue += currentPrice;
        } else {
          unpricedCount += 1;
        }

        return {
          id: item.id,
          ticker: wl.ticker,
          companyName: wl.companyName,
          priceAtAdd: wl.priceAtAdd,
          currentPrice,
          gainLossPercent,
          notes: wl.notes,
          tags: wl.tags,
        };
      });

      const portfolioGainLossPercent = totalCostBasis > 0
        ? ((totalCurrentValue - totalCostBasis) / totalCostBasis) * 100
        : 0;

      return {
        id: port.id,
        name: port.name,
        description: port.description,
        createdAt: port.createdAt,
        totalCostBasis,
        totalCurrentValue,
        unpricedCount,
        gainLossPercent: portfolioGainLossPercent,
        items: itemsList,
      };
    });

    return NextResponse.json(portfolios);
  } catch (error: unknown) {
    console.error("Error in portfolios GET:", error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    if (action === 'add_item') {
      const body = await request.json();
      const { portfolioId, watchlistId } = body as {
        portfolioId: string;
        watchlistId: string;
      };

      if (!portfolioId || !watchlistId) {
        return NextResponse.json({ error: 'portfolioId and watchlistId are required' }, { status: 400 });
      }

      const existing = memoryPortfolioItems.find(
        (i) => i.portfolioId === portfolioId && i.watchlistId === watchlistId
      );

      if (existing) {
        return NextResponse.json(existing);
      }

      const newItem: MemoryPortfolioItem = {
        id: crypto.randomUUID(),
        portfolioId,
        watchlistId,
      };
      memoryPortfolioItems.push(newItem);
      return NextResponse.json(newItem);
    }

    const body = await request.json();
    const { name, description } = body as { name: string; description?: string };

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Portfolio name is required' }, { status: 400 });
    }

    const newPortfolio: MemoryTrendPortfolio = {
      id: crypto.randomUUID(),
      name: name.trim(),
      description: description || null,
      createdAt: new Date(),
    };
    memoryTrendPortfolios.push(newPortfolio);
    return NextResponse.json(newPortfolio);
  } catch (error: unknown) {
    console.error("Error in portfolios POST:", error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    if (action === 'remove_item') {
      const portfolioId = searchParams.get('portfolioId');
      const watchlistId = searchParams.get('watchlistId');

      if (!portfolioId || !watchlistId) {
        return NextResponse.json({ error: 'portfolioId and watchlistId are required' }, { status: 400 });
      }

      const index = memoryPortfolioItems.findIndex(
        (i) => i.portfolioId === portfolioId && i.watchlistId === watchlistId
      );
      if (index === -1) {
        return NextResponse.json({ error: 'Portfolio item connection not found' }, { status: 404 });
      }
      memoryPortfolioItems.splice(index, 1);
      return NextResponse.json({ success: true });
    }

    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Portfolio ID is required' }, { status: 400 });
    }

    const idx = memoryTrendPortfolios.findIndex((p) => p.id === id);
    if (idx === -1) {
      return NextResponse.json({ error: 'Portfolio not found' }, { status: 404 });
    }
    memoryTrendPortfolios.splice(idx, 1);

    const indexesToRemove = memoryPortfolioItems
      .map((item, index) => (item.portfolioId === id ? index : -1))
      .filter((index) => index !== -1)
      .reverse();

    for (const index of indexesToRemove) {
      memoryPortfolioItems.splice(index, 1);
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Error in portfolios DELETE:", error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

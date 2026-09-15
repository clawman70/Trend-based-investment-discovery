import { NextRequest, NextResponse } from 'next/server';
import {
  addPortfolioItem,
  createPortfolio,
  deletePortfolio,
  listPortfoliosWithItems,
  removePortfolioItem,
} from '@/lib/stores/portfolioStore';
import { fetchQuotes, isFinnhubConfigured } from '@/lib/finnhubService';

export async function GET() {
  try {
    const rawPortfolios = await listPortfoliosWithItems();

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

      const newItem = await addPortfolioItem({ portfolioId, watchlistId });
      if (!newItem) {
        return NextResponse.json({ error: 'Portfolio not found' }, { status: 404 });
      }
      return NextResponse.json(newItem);
    }

    const body = await request.json();
    const { name, description } = body as { name: string; description?: string };

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Portfolio name is required' }, { status: 400 });
    }

    const newPortfolio = await createPortfolio({ name: name.trim(), description: description || null });
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

      const removed = await removePortfolioItem({ portfolioId, watchlistId });
      if (!removed) {
        return NextResponse.json({ error: 'Portfolio item connection not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true });
    }

    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Portfolio ID is required' }, { status: 400 });
    }

    const deleted = await deletePortfolio(id);
    if (!deleted) {
      return NextResponse.json({ error: 'Portfolio not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Error in portfolios DELETE:", error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

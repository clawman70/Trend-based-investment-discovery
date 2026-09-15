/**
 * Trend portfolios ("Portfolios" tab). Postgres-backed with an in-memory fallback —
 * see src/lib/dbHelper.ts for how the fallback decision is made.
 *
 * Note: portfolioId -> watchlistId links use a real foreign key on the portfolio side
 * (deleting a portfolio cascades its links) but NOT on the watchlist side, so removing
 * a watchlist item never fails a portfolio row — a dangling link is simply filtered out
 * on read, in both storage backends.
 */
import crypto from 'crypto';
import { isDbAvailable } from '../dbHelper';
import { prisma } from '../prisma';
import {
  memoryPortfolioItems,
  memoryTrendPortfolios,
  memoryWatchlistItems,
  MemoryPortfolioItem,
  MemoryTrendPortfolio,
  MemoryWatchlistItem,
} from '../memoryStore';

export interface PortfolioWithItems {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  items: { id: string; watchlist: MemoryWatchlistItem }[];
}

export async function listPortfoliosWithItems(): Promise<PortfolioWithItems[]> {
  if (await isDbAvailable()) {
    const portfolios = await prisma.trendPortfolio.findMany({ include: { items: true }, orderBy: { createdAt: 'asc' } });
    const watchlistIds = Array.from(new Set(portfolios.flatMap((p) => p.items.map((i) => i.watchlistId))));
    const watchlistRows = watchlistIds.length > 0 ? await prisma.watchlistItem.findMany({ where: { id: { in: watchlistIds } } }) : [];
    const watchlistById = new Map(watchlistRows.map((w) => [w.id, w]));

    return portfolios.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      createdAt: p.createdAt,
      items: p.items
        .map((item) => {
          const watchlist = watchlistById.get(item.watchlistId);
          return watchlist ? { id: item.id, watchlist } : null;
        })
        .filter((x): x is { id: string; watchlist: MemoryWatchlistItem } => x !== null),
    }));
  }

  return memoryTrendPortfolios.map((p) => {
    const items = memoryPortfolioItems.filter((i) => i.portfolioId === p.id);
    const resolvedItems = items
      .map((item) => {
        const wl = memoryWatchlistItems.find((w) => w.id === item.watchlistId);
        return wl ? { id: item.id, watchlist: wl } : null;
      })
      .filter((x): x is { id: string; watchlist: MemoryWatchlistItem } => x !== null);
    return { id: p.id, name: p.name, description: p.description, createdAt: p.createdAt, items: resolvedItems };
  });
}

export async function createPortfolio(input: { name: string; description?: string | null }): Promise<MemoryTrendPortfolio> {
  if (await isDbAvailable()) {
    return prisma.trendPortfolio.create({ data: { name: input.name, description: input.description ?? null } });
  }
  const newPortfolio: MemoryTrendPortfolio = {
    id: crypto.randomUUID(),
    name: input.name,
    description: input.description ?? null,
    createdAt: new Date(),
  };
  memoryTrendPortfolios.push(newPortfolio);
  return newPortfolio;
}

export async function deletePortfolio(id: string): Promise<boolean> {
  if (await isDbAvailable()) {
    try {
      await prisma.trendPortfolio.delete({ where: { id } }); // cascades items
      return true;
    } catch {
      return false;
    }
  }

  const idx = memoryTrendPortfolios.findIndex((p) => p.id === id);
  if (idx === -1) return false;
  memoryTrendPortfolios.splice(idx, 1);

  const toRemove = memoryPortfolioItems
    .map((item, i) => (item.portfolioId === id ? i : -1))
    .filter((i) => i !== -1)
    .reverse();
  for (const i of toRemove) memoryPortfolioItems.splice(i, 1);
  return true;
}

/** Links a watchlist item into a portfolio. Idempotent: linking an already-linked pair returns the existing link. */
export async function addPortfolioItem(input: { portfolioId: string; watchlistId: string }): Promise<MemoryPortfolioItem | null> {
  if (await isDbAvailable()) {
    try {
      return await prisma.portfolioItem.upsert({
        where: { portfolioId_watchlistId: { portfolioId: input.portfolioId, watchlistId: input.watchlistId } },
        create: { portfolioId: input.portfolioId, watchlistId: input.watchlistId },
        update: {},
      });
    } catch (error) {
      // Most likely a foreign key violation: portfolioId doesn't exist
      console.warn('[DB] addPortfolioItem failed:', error instanceof Error ? error.message : error);
      return null;
    }
  }

  const existing = memoryPortfolioItems.find((i) => i.portfolioId === input.portfolioId && i.watchlistId === input.watchlistId);
  if (existing) return existing;
  const newItem: MemoryPortfolioItem = { id: crypto.randomUUID(), portfolioId: input.portfolioId, watchlistId: input.watchlistId };
  memoryPortfolioItems.push(newItem);
  return newItem;
}

export async function removePortfolioItem(input: { portfolioId: string; watchlistId: string }): Promise<boolean> {
  if (await isDbAvailable()) {
    try {
      await prisma.portfolioItem.delete({
        where: { portfolioId_watchlistId: { portfolioId: input.portfolioId, watchlistId: input.watchlistId } },
      });
      return true;
    } catch {
      return false;
    }
  }

  const index = memoryPortfolioItems.findIndex((i) => i.portfolioId === input.portfolioId && i.watchlistId === input.watchlistId);
  if (index === -1) return false;
  memoryPortfolioItems.splice(index, 1);
  return true;
}

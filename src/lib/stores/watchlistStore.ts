/**
 * Starred tickers ("Watchlist" tab). Postgres-backed with an in-memory fallback — see
 * src/lib/dbHelper.ts for how the fallback decision is made.
 */
import crypto from 'crypto';
import { isDbAvailable } from '../dbHelper';
import { prisma } from '../prisma';
import { memoryWatchlistItems, MemoryWatchlistItem } from '../memoryStore';

export async function listWatchlistItems(): Promise<MemoryWatchlistItem[]> {
  if (await isDbAvailable()) {
    return prisma.watchlistItem.findMany({ orderBy: { addedAt: 'desc' } });
  }
  return [...memoryWatchlistItems].sort((a, b) => b.addedAt.getTime() - a.addedAt.getTime());
}

/**
 * Adds a ticker, or overwrites the existing entry for that ticker (company name, cost
 * basis, notes and tags are replaced; id and the original addedAt date are kept).
 */
export async function upsertWatchlistItem(input: {
  ticker: string;
  companyName: string;
  priceAtAdd: number;
  sourceSearchId?: string | null;
  notes?: string | null;
  tags?: string[];
}): Promise<MemoryWatchlistItem> {
  const { ticker } = input; // caller is expected to have uppercased/trimmed already
  const fields = {
    companyName: input.companyName,
    priceAtAdd: input.priceAtAdd,
    sourceSearchId: input.sourceSearchId ?? null,
    notes: input.notes ?? null,
    tags: input.tags ?? [],
  };

  if (await isDbAvailable()) {
    return prisma.watchlistItem.upsert({
      where: { ticker },
      create: { ticker, ...fields },
      update: fields,
    });
  }

  const existingIdx = memoryWatchlistItems.findIndex((item) => item.ticker === ticker);
  const newItem: MemoryWatchlistItem = {
    id: existingIdx !== -1 ? memoryWatchlistItems[existingIdx].id : crypto.randomUUID(),
    ticker,
    addedAt: existingIdx !== -1 ? memoryWatchlistItems[existingIdx].addedAt : new Date(),
    ...fields,
  };
  if (existingIdx !== -1) memoryWatchlistItems[existingIdx] = newItem;
  else memoryWatchlistItems.push(newItem);
  return newItem;
}

export async function updateWatchlistItem(
  id: string,
  patch: { notes?: string; tags?: string[] }
): Promise<MemoryWatchlistItem | null> {
  if (await isDbAvailable()) {
    try {
      return await prisma.watchlistItem.update({
        where: { id },
        data: {
          ...(patch.notes !== undefined && { notes: patch.notes }),
          ...(patch.tags !== undefined && { tags: patch.tags }),
        },
      });
    } catch {
      return null; // not found
    }
  }

  const existing = memoryWatchlistItems.find((item) => item.id === id);
  if (!existing) return null;
  if (patch.notes !== undefined) existing.notes = patch.notes;
  if (patch.tags !== undefined) existing.tags = patch.tags;
  return existing;
}

export async function deleteWatchlistItem(selector: { id?: string; ticker?: string }): Promise<boolean> {
  if (await isDbAvailable()) {
    try {
      if (selector.id) await prisma.watchlistItem.delete({ where: { id: selector.id } });
      else if (selector.ticker) await prisma.watchlistItem.delete({ where: { ticker: selector.ticker } });
      else return false;
      return true;
    } catch {
      return false; // not found
    }
  }

  const index = selector.id
    ? memoryWatchlistItems.findIndex((item) => item.id === selector.id)
    : memoryWatchlistItems.findIndex((item) => item.ticker === selector.ticker);
  if (index === -1) return false;
  memoryWatchlistItems.splice(index, 1);
  return true;
}

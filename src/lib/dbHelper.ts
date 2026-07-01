import { prisma } from './prisma';

// Simple in-memory fallback cache
const memoryCache = new Map<string, { data: unknown; expiresAt: Date }>();

export async function isDbAvailable(): Promise<boolean> {
  const url = process.env.POSTGRES_PRISMA_URL;
  if (!url || url.includes('dummy')) {
    return false;
  }
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export async function getCachedData(key: string): Promise<unknown | null> {
  const now = new Date();
  
  if (process.env.POSTGRES_PRISMA_URL) {
    try {
      const cacheEntry = await prisma.apiCache.findUnique({
        where: { cacheKey: key },
      });
      if (cacheEntry) {
        if (cacheEntry.expiresAt > now) {
          return cacheEntry.data;
        } else {
          // Clean up expired cache entry in background
          prisma.apiCache.delete({ where: { cacheKey: key } }).catch(() => {});
        }
      }
    } catch (e) {
      console.warn(`Database cache read failed for key ${key}. Falling back to memory cache.`, e);
    }
  }

  // Memory fallback
  const memEntry = memoryCache.get(key);
  if (memEntry) {
    if (memEntry.expiresAt > now) {
      return memEntry.data;
    } else {
      memoryCache.delete(key);
    }
  }

  return null;
}

export async function setCachedData(key: string, type: string, data: unknown, durationMs: number): Promise<void> {
  const expiresAt = new Date(Date.now() + durationMs);

  if (process.env.POSTGRES_PRISMA_URL) {
    try {
      await prisma.apiCache.upsert({
        where: { cacheKey: key },
        update: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: data as any,
          expiresAt,
          cacheType: type,
          fetchedAt: new Date(),
        },
        create: {
          cacheKey: key,
          cacheType: type,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: data as any,
          expiresAt,
        },
      });
    } catch (e) {
      console.warn(`Database cache write failed for key ${key}. Saving to memory cache only.`, e);
    }
  }

  // Always save to memory cache as well for speedy local lookups
  memoryCache.set(key, { data, expiresAt });
}

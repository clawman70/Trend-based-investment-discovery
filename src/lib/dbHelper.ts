/**
 * Database availability check + TTL cache, with an automatic in-memory fallback.
 *
 * If POSTGRES_PRISMA_URL isn't set, or Postgres can't be reached, every store module in
 * src/lib/stores/ falls back to the in-memory arrays in memoryStore.ts. That keeps local
 * dev working without a database, and keeps the app alive through a brief DB outage —
 * at the cost of that data not surviving a restart until the DB comes back.
 */
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';

const AVAILABILITY_RECHECK_MS = 30_000;

let cachedAvailability: { value: boolean; checkedAt: number } | null = null;

/**
 * Prisma's own `.message` on a driver-adapter connection failure is often just
 * "Invalid `prisma.$queryRaw()` invocation:" with no detail — the useful part (e.g.
 * "ECONNREFUSED") is a `.code` property node-postgres attaches to the underlying error.
 */
function describeDbError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const code = (error as { code?: string }).code;
  const message = error.message.trim() || error.name;
  return code ? `${message} (${code})` : message;
}

function hasPostgresUrl(): boolean {
  const url = process.env.POSTGRES_PRISMA_URL;
  return !!url && url.trim() !== '';
}

/**
 * True if Postgres is configured and reachable right now. Result is memoized for
 * AVAILABILITY_RECHECK_MS so a request that touches several stores doesn't re-ping the
 * DB for each one, while still recovering automatically once the DB comes back.
 */
export async function isDbAvailable(): Promise<boolean> {
  if (!hasPostgresUrl()) {
    return false;
  }

  const now = Date.now();
  if (cachedAvailability && now - cachedAvailability.checkedAt < AVAILABILITY_RECHECK_MS) {
    return cachedAvailability.value;
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    cachedAvailability = { value: true, checkedAt: now };
    return true;
  } catch (error) {
    console.warn('[DB] Postgres unavailable, falling back to in-memory store:', describeDbError(error));
    cachedAvailability = { value: false, checkedAt: now };
    return false;
  }
}

// ---------------------------------------------------------------------------
// TTL cache (used for AI responses and market-data caching across the app)
// ---------------------------------------------------------------------------

const memoryCache = new Map<string, { data: unknown; expiresAt: Date }>();

export async function getCachedData(key: string): Promise<unknown | null> {
  if (await isDbAvailable()) {
    try {
      const entry = await prisma.cacheEntry.findUnique({ where: { key } });
      if (!entry) return null;
      if (entry.expiresAt > new Date()) return entry.data;
      // Expired: best-effort delete, don't let it fail the read
      await prisma.cacheEntry.delete({ where: { key } }).catch(() => undefined);
      return null;
    } catch (error) {
      console.warn(`[DB] Cache read failed for "${key}", falling back to memory:`, error instanceof Error ? error.message : error);
    }
  }

  const memEntry = memoryCache.get(key);
  if (memEntry) {
    if (memEntry.expiresAt > new Date()) return memEntry.data;
    memoryCache.delete(key);
  }
  return null;
}

export async function setCachedData(key: string, type: string, data: unknown, durationMs: number): Promise<void> {
  const expiresAt = new Date(Date.now() + durationMs);

  if (await isDbAvailable()) {
    try {
      await prisma.cacheEntry.upsert({
        where: { key },
        create: { key, type, data: data as Prisma.InputJsonValue, expiresAt },
        update: { type, data: data as Prisma.InputJsonValue, expiresAt },
      });
      return;
    } catch (error) {
      console.warn(`[DB] Cache write failed for "${key}", falling back to memory:`, error instanceof Error ? error.message : error);
    }
  }

  memoryCache.set(key, { data, expiresAt });
}

/** Test helper: clears the in-memory cache and the availability memoization between tests. */
export function resetDbHelperState(): void {
  memoryCache.clear();
  cachedAvailability = null;
}

// Simple in-memory cache for API responses
const memoryCache = new Map<string, { data: unknown; expiresAt: Date }>();

export async function getCachedData(key: string): Promise<unknown | null> {
  const now = new Date();
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

export async function setCachedData(key: string, _type: string, data: unknown, durationMs: number): Promise<void> {
  const expiresAt = new Date(Date.now() + durationMs);
  memoryCache.set(key, { data, expiresAt });
}

/**
 * Plain-English age of a cached result, for the "cached N days ago" label on Discovery
 * and Research (Phase E). Uses the real time the cached result was produced; if that
 * isn't known (entries saved before Phase E), it says so instead of guessing.
 */
export function describeCacheAge(cachedAt: string | null | undefined, now: Date = new Date()): string {
  if (!cachedAt) return 'cached earlier (age unknown)';
  const then = new Date(cachedAt).getTime();
  if (!Number.isFinite(then)) return 'cached earlier (age unknown)';

  const ms = Math.max(0, now.getTime() - then);
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'cached less than an hour ago';
  if (hours < 24) return `cached ${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `cached ${days} day${days === 1 ? '' : 's'} ago`;
}

/** m:ss for the elapsed-time counter shown while an AI run is in progress. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

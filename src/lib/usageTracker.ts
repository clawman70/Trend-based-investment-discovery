/**
 * Rough daily spend estimate, used only to trigger a warning banner — not a billing-
 * grade ledger. Reuses the existing generic TTL cache (dbHelper.ts) instead of a new
 * Prisma model: one running-total entry per UTC calendar day.
 */
import { getCachedData, setCachedData } from './dbHelper';

// $ per 1M tokens. Rough estimates from Documents/Improvement-Plan-2026-09.md's pricing
// table (Sept 2026 rates) — will drift from actual billing over time, and Gemini's rate
// is scheduled to roughly double after Dec 31, 2026. Good enough for a warning banner.
const PRICING_PER_MILLION_TOKENS = {
  claude: { input: 2.0, output: 10.0 },
  gemini: { input: 0.75, output: 3.75 },
} as const;

export type UsageProvider = keyof typeof PRICING_PER_MILLION_TOKENS;

const SPEND_TTL_MS = 2 * 24 * 60 * 60 * 1000; // 2 days — comfortably outlives "today" in any timezone

function todayCacheKey(): string {
  return `usage:spend:${new Date().toISOString().slice(0, 10)}`; // YYYY-MM-DD (UTC)
}

/** Estimated cost in USD for one call's token usage. Exported for tests. */
export function estimateCostUsd(provider: UsageProvider, inputTokens: number, outputTokens: number): number {
  const rates = PRICING_PER_MILLION_TOKENS[provider];
  return (inputTokens / 1_000_000) * rates.input + (outputTokens / 1_000_000) * rates.output;
}

/**
 * Adds one call's estimated cost to today's running total. Never throws — a failure
 * here must never block or fail the actual AI response it's tracking.
 */
export async function recordUsage(provider: UsageProvider, inputTokens: number, outputTokens: number): Promise<void> {
  try {
    const cost = estimateCostUsd(provider, inputTokens, outputTokens);
    const key = todayCacheKey();
    const existing = ((await getCachedData(key)) as number | null) ?? 0;
    await setCachedData(key, 'usage', existing + cost, SPEND_TTL_MS);
  } catch (error) {
    console.warn('[Usage] Failed to record usage estimate:', error instanceof Error ? error.message : error);
  }
}

/** Today's estimated spend in USD, 0 if nothing recorded yet. */
export async function getTodaysSpend(): Promise<number> {
  const value = (await getCachedData(todayCacheKey())) as number | null;
  return value ?? 0;
}

/** Daily spend cap in USD, configurable via DAILY_SPEND_CAP_USD, defaults to $5. */
export function getDailySpendCapUsd(): number {
  const raw = process.env.DAILY_SPEND_CAP_USD;
  const parsed = raw ? parseFloat(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

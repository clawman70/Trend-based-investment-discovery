/**
 * Daily AI spend ESTIMATE, used only to trigger a warning banner — not a billing-grade
 * ledger. It's an estimate computed from the token counts each API response reports,
 * times the published per-model rates below.
 *
 * Phase E changes (bugs B6 and B7 in Documents/Improvement-Plan-2026-11.md):
 * - B6: the running total lives in its own `daily_spend` table and each call adds to it
 *   with one atomic database increment. The old version read the total, added, and
 *   wrote it back, so concurrent AI calls (discovery fires several) overwrote each other.
 *   If Postgres is unreachable, calls are added to an in-memory total instead (lost on
 *   restart), and today's figure is database + memory.
 * - B7: the estimate now also counts Gemini thinking tokens and tool-use prompt tokens,
 *   Claude web-search requests and Claude prompt-cache tokens, and Gemini search
 *   grounding requests. Prices are looked up per model name, with a clearly marked
 *   (deliberately expensive) default for models not in the table.
 */
import { Prisma } from '@prisma/client';
import { isDbAvailable } from './dbHelper';
import { prisma } from './prisma';

// ---------------------------------------------------------------------------
// Price table
// ---------------------------------------------------------------------------
//
// All rates re-checked on 2026-11-17 against the providers' own pricing pages:
//   Anthropic: https://platform.claude.com/docs/en/about-claude/pricing
//     ("Model pricing" table; web search "$10 per 1,000 searches, plus standard token
//     costs"; Claude 4.6+ except Haiku 5.5 bill the full context window at the standard
//     rate; Sonnet 5's $2/$10 is now the standard price, the planned rise to $3/$15 was
//     cancelled). Prompt-cache writes bill at 1.25x input and reads at 0.1x input
//     (5-minute cache). Not modelled: the 1.1x multiplier for US-only inference_geo.
//   Google: https://ai.google.dev/gemini-api/docs/pricing (now redirects to
//     https://aistudio.google.com/docs/pricing). Output prices include thinking tokens.
//     Gemini 3.8 Flash is $0.75/$3.75 through 2026-12-31 and $1.50/$7.50 from
//     2027-01-01. Grounding with Google Search: 5,000 free requests/month, then $14 per
//     1,000. We can't see how much of the free allowance is left, so every grounded
//     request is counted at $14/1,000 — this over-counts by at most ~$0.014 per scan.
//
// Rates are USD per 1M tokens. Update this table (and the date above) when prices change.

interface TokenRates {
  input: number;
  output: number;
}

interface ModelPrice extends TokenRates {
  /** Higher rates once one prompt's input exceeds `thresholdInputTokens` (long-context tier). */
  longContext?: TokenRates & { thresholdInputTokens: number };
  /** Rates that apply from `from` onward (scheduled price change). */
  changesTo?: { from: Date; rates: TokenRates };
}

// Google's dates are taken as midnight US Pacific (Google's billing timezone).
const GEMINI_FLASH_PRICE_CHANGE = new Date('2027-01-01T00:00:00-08:00');

const CLAUDE_PRICES: Record<string, ModelPrice> = {
  'claude-fable-5-2': { input: 8, output: 40 },
  'claude-fable-5-1': { input: 10, output: 50 },
  'claude-fable-5': { input: 10, output: 50 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-opus-4-5': { input: 5, output: 25 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-sonnet-5': { input: 2, output: 10 }, // the app's default CLAUDE_MODEL
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, longContext: { thresholdInputTokens: 100_000, input: 0.5, output: 2.5 } },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

const GEMINI_PRICES: Record<string, ModelPrice> = {
  // the app's default GEMINI_MODEL
  'gemini-3.8-flash': { input: 0.75, output: 3.75, changesTo: { from: GEMINI_FLASH_PRICE_CHANGE, rates: { input: 1.5, output: 7.5 } } },
  'gemini-3.6-flash': { input: 0.75, output: 3.75, changesTo: { from: GEMINI_FLASH_PRICE_CHANGE, rates: { input: 1.5, output: 7.5 } } },
  'gemini-3.5-flash-lite': { input: 0.3, output: 2.5 },
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.5 },
  'gemini-3.1-pro-preview': { input: 2, output: 12, longContext: { thresholdInputTokens: 200_000, input: 4, output: 18 } },
};

/**
 * DEFAULT RATES for a model name not in the tables above (e.g. a new CLAUDE_MODEL or
 * GEMINI_MODEL set in .env.local). Deliberately set to the most expensive listed rate
 * for that provider, so an unknown model over-reports rather than under-reports. Add the
 * model to the table above to get an accurate figure.
 */
const DEFAULT_PRICES: Record<UsageProvider, ModelPrice> = {
  claude: { input: 10, output: 50 }, // = Fable 5 / 5.1, the highest Claude rate listed
  gemini: { input: 4, output: 18 }, // = Gemini 3.1 Pro long-context, the highest Gemini rate listed
};

const CLAUDE_WEB_SEARCH_USD_PER_REQUEST = 10 / 1000;
const GEMINI_GROUNDING_USD_PER_REQUEST = 14 / 1000;
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

export type UsageProvider = 'claude' | 'gemini';

/** Everything one API call reports that costs money. All counts default to 0. */
export interface UsageComponents {
  inputTokens: number;
  outputTokens: number;
  /** Gemini only: thinking tokens, billed at the output rate but NOT in candidatesTokenCount. */
  thinkingTokens?: number;
  /** Claude only: prompt-cache writes and reads, billed at 1.25x and 0.1x input. */
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
  /** Claude web_search tool requests ($10 / 1,000). */
  webSearchRequests?: number;
  /** Gemini requests grounded with Google Search ($14 / 1,000 past the free allowance). */
  groundedRequests?: number;
}

/**
 * Finds the price for a model name. Exact match first, then the longest table key that
 * the name extends with "-" (so a dated snapshot like "claude-sonnet-5-20261001" prices
 * as "claude-sonnet-5"). Unknown names get the marked default.
 */
export function lookupModelPrice(provider: UsageProvider, model: string): { price: ModelPrice; matched: string | null } {
  const table = provider === 'claude' ? CLAUDE_PRICES : GEMINI_PRICES;
  const name = model.trim().toLowerCase();
  if (table[name]) return { price: table[name], matched: name };

  const prefix = Object.keys(table)
    .filter((key) => name.startsWith(`${key}-`))
    .sort((a, b) => b.length - a.length)[0];
  if (prefix) return { price: table[prefix], matched: prefix };

  return { price: DEFAULT_PRICES[provider], matched: null };
}

/** The token rates that apply to one call, given its input size and date. */
function ratesFor(price: ModelPrice, promptInputTokens: number, at: Date): TokenRates {
  if (price.changesTo && at >= price.changesTo.from) return price.changesTo.rates;
  if (price.longContext && promptInputTokens > price.longContext.thresholdInputTokens) return price.longContext;
  return price;
}

const warnedUnknownModels = new Set<string>();

/** Estimated cost in USD for one API call. Exported for tests. */
export function estimateCostUsd(provider: UsageProvider, model: string, usage: UsageComponents, at: Date = new Date()): number {
  const { price, matched } = lookupModelPrice(provider, model);
  if (!matched && !warnedUnknownModels.has(model)) {
    warnedUnknownModels.add(model);
    console.warn(`[Usage] No price listed for ${provider} model "${model}" — using the high default rate. Add it to src/lib/usageTracker.ts.`);
  }

  const input = usage.inputTokens || 0;
  const cacheWrite = usage.cacheWriteTokens || 0;
  const cacheRead = usage.cacheReadTokens || 0;
  // The long-context tier counts every input token in the prompt, cached ones included
  const rates = ratesFor(price, input + cacheWrite + cacheRead, at);
  const perToken = (ratePerMillion: number) => ratePerMillion / 1_000_000;

  const tokenCost =
    input * perToken(rates.input) +
    cacheWrite * perToken(rates.input) * CACHE_WRITE_MULTIPLIER +
    cacheRead * perToken(rates.input) * CACHE_READ_MULTIPLIER +
    ((usage.outputTokens || 0) + (usage.thinkingTokens || 0)) * perToken(rates.output);

  const toolCost =
    (usage.webSearchRequests || 0) * CLAUDE_WEB_SEARCH_USD_PER_REQUEST +
    (usage.groundedRequests || 0) * GEMINI_GROUNDING_USD_PER_REQUEST;

  return tokenCost + toolCost;
}

// ---------------------------------------------------------------------------
// Pulling the billable counts out of each SDK's response
// ---------------------------------------------------------------------------
//
// Field names confirmed against the installed SDK type definitions (the pinned versions):
//   @anthropic-ai/sdk 0.126.0, `Usage` in resources/messages/messages.d.ts:
//     input_tokens, output_tokens (inclusive of thinking — "the inclusive, authoritative
//     total used for billing"), cache_creation_input_tokens, cache_read_input_tokens,
//     server_tool_use.web_search_requests.
//   @google/genai 2.22.0, `GenerateContentResponseUsageMetadata` in dist/genai.d.ts:
//     promptTokenCount, candidatesTokenCount (excludes thinking), thoughtsTokenCount,
//     toolUsePromptTokenCount (tool-use prompt input, e.g. search results fed back in).

/** Structural subset of the Anthropic SDK's `Usage` (kept loose so tests can pass plain objects). */
export interface ClaudeUsageLike {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
}

export function claudeUsageComponents(usage: ClaudeUsageLike | null | undefined): UsageComponents {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
    webSearchRequests: usage?.server_tool_use?.web_search_requests ?? 0,
  };
}

/** Structural subset of @google/genai's `GenerateContentResponseUsageMetadata`. */
export interface GeminiUsageLike {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  toolUsePromptTokenCount?: number;
}

export function geminiUsageComponents(meta: GeminiUsageLike | null | undefined, opts: { grounded: boolean }): UsageComponents {
  return {
    inputTokens: (meta?.promptTokenCount ?? 0) + (meta?.toolUsePromptTokenCount ?? 0),
    outputTokens: meta?.candidatesTokenCount ?? 0,
    thinkingTokens: meta?.thoughtsTokenCount ?? 0,
    groundedRequests: opts.grounded ? 1 : 0,
  };
}

// ---------------------------------------------------------------------------
// Running daily total
// ---------------------------------------------------------------------------

/** Whole micro-dollars per USD. Per-call rounding error is under $0.0000005. */
const MICRO_PER_USD = 1_000_000;

/** Today's total accumulated while Postgres was unreachable, keyed by UTC day. */
const memoryTotals = new Map<string, number>();

function todayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Atomically adds to one day's row. Prisma turns `increment` into
 * `SET "costMicroUsd" = "costMicroUsd" + n`, so concurrent calls can't overwrite each
 * other. If two calls race to create the day's very first row, one gets a unique-key
 * error; it retries once, and by then the row exists so it takes the increment path.
 */
async function incrementDbTotal(day: string, micro: number): Promise<void> {
  const args = {
    where: { day },
    create: { day, costMicroUsd: BigInt(micro) },
    update: { costMicroUsd: { increment: BigInt(micro) } },
  };
  try {
    await prisma.dailySpend.upsert(args);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    await prisma.dailySpend.upsert(args);
  }
}

/**
 * Adds one call's estimated cost to today's running total. Never throws — a failure
 * here must never block or fail the actual AI response it's tracking.
 */
export async function recordUsage(provider: UsageProvider, model: string, usage: UsageComponents): Promise<void> {
  try {
    const micro = Math.round(estimateCostUsd(provider, model, usage) * MICRO_PER_USD);
    if (micro <= 0) return;
    const day = todayKey();

    if (await isDbAvailable()) {
      try {
        await incrementDbTotal(day, micro);
        return;
      } catch (error) {
        console.warn('[Usage] Database increment failed, adding to the in-memory total:', error instanceof Error ? error.message : error);
      }
    }
    // Synchronous read-and-set with no await in between: atomic within this process
    memoryTotals.set(day, (memoryTotals.get(day) ?? 0) + micro);
  } catch (error) {
    console.warn('[Usage] Failed to record usage estimate:', error instanceof Error ? error.message : error);
  }
}

/**
 * Today's estimated spend in USD: the database total plus anything recorded in memory
 * while the database was down. 0 if nothing has been recorded today.
 */
export async function getTodaysSpend(): Promise<number> {
  const day = todayKey();
  let dbMicro = 0;
  if (await isDbAvailable()) {
    try {
      const row = await prisma.dailySpend.findUnique({ where: { day } });
      dbMicro = row ? Number(row.costMicroUsd) : 0;
    } catch (error) {
      console.warn('[Usage] Could not read today\'s total from the database:', error instanceof Error ? error.message : error);
    }
  }
  return (dbMicro + (memoryTotals.get(day) ?? 0)) / MICRO_PER_USD;
}

/** Daily spend cap in USD, configurable via DAILY_SPEND_CAP_USD, defaults to $5. */
export function getDailySpendCapUsd(): number {
  const raw = process.env.DAILY_SPEND_CAP_USD;
  const parsed = raw ? parseFloat(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

/** Test helper: clears the in-memory total and the unknown-model warning memo. */
export function resetUsageTrackerState(): void {
  memoryTotals.clear();
  warnedUnknownModels.clear();
}

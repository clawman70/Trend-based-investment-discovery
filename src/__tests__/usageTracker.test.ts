import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Prisma } from '@prisma/client';

// A fake `daily_spend` table. upsert applies `increment` the way Postgres does (one
// atomic step), after a random delay so concurrent calls genuinely interleave.
const { isDbAvailableMock, rows, upsertMock, findUniqueMock } = vi.hoisted(() => {
  const rows = new Map<string, bigint>();
  type UpsertArgs = {
    where: { day: string };
    create: { day: string; costMicroUsd: bigint };
    update: { costMicroUsd: { increment: bigint } };
  };
  return {
    rows,
    isDbAvailableMock: vi.fn(),
    upsertMock: vi.fn(async (args: UpsertArgs) => {
      await new Promise((r) => setTimeout(r, Math.random() * 5));
      const current = rows.get(args.where.day);
      rows.set(args.where.day, current === undefined ? args.create.costMicroUsd : current + args.update.costMicroUsd.increment);
    }),
    findUniqueMock: vi.fn(async ({ where }: { where: { day: string } }) => {
      const v = rows.get(where.day);
      return v === undefined ? null : { day: where.day, costMicroUsd: v };
    }),
  };
});

vi.mock('../lib/dbHelper', () => ({ isDbAvailable: isDbAvailableMock }));
vi.mock('../lib/prisma', () => ({ prisma: { dailySpend: { upsert: upsertMock, findUnique: findUniqueMock } } }));

import {
  claudeUsageComponents,
  estimateCostUsd,
  geminiUsageComponents,
  getDailySpendCapUsd,
  getTodaysSpend,
  lookupModelPrice,
  recordUsage,
  resetUsageTrackerState,
} from '../lib/usageTracker';

const NOV_2026 = new Date('2026-11-17T12:00:00Z');
const JAN_2027 = new Date('2027-01-01T12:00:00Z');

describe('usageTracker', () => {
  beforeEach(() => {
    rows.clear();
    resetUsageTrackerState();
    isDbAvailableMock.mockReset().mockResolvedValue(true);
    upsertMock.mockClear();
    findUniqueMock.mockClear();
    delete process.env.DAILY_SPEND_CAP_USD;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('price lookup', () => {
    it('prices the default models from the table', () => {
      expect(lookupModelPrice('claude', 'claude-sonnet-5')).toMatchObject({ matched: 'claude-sonnet-5', price: { input: 2, output: 10 } });
      expect(lookupModelPrice('gemini', 'gemini-3.8-flash').matched).toBe('gemini-3.8-flash');
    });

    it('matches a dated snapshot to its base model, preferring the longest key', () => {
      expect(lookupModelPrice('claude', 'claude-sonnet-5-20261001').matched).toBe('claude-sonnet-5');
      expect(lookupModelPrice('claude', 'claude-sonnet-5-5').matched).toBe('claude-sonnet-5-5');
      expect(lookupModelPrice('claude', 'claude-opus-5-5').price).toMatchObject({ input: 4, output: 20 });
    });

    it('falls back to the marked (expensive) default for an unknown model', () => {
      const { matched, price } = lookupModelPrice('claude', 'claude-mystery-9');
      expect(matched).toBeNull();
      expect(price).toMatchObject({ input: 10, output: 50 });
      // Unknown models never price below the app's default model
      expect(estimateCostUsd('gemini', 'gemini-unknown', { inputTokens: 1e6, outputTokens: 1e6 }, NOV_2026)).toBeGreaterThan(
        estimateCostUsd('gemini', 'gemini-3.8-flash', { inputTokens: 1e6, outputTokens: 1e6 }, NOV_2026)
      );
    });
  });

  describe('estimateCostUsd', () => {
    it('computes token cost from the per-model rates', () => {
      expect(estimateCostUsd('claude', 'claude-sonnet-5', { inputTokens: 1e6, outputTokens: 1e6 }, NOV_2026)).toBeCloseTo(12.0);
      expect(estimateCostUsd('gemini', 'gemini-3.8-flash', { inputTokens: 1e6, outputTokens: 1e6 }, NOV_2026)).toBeCloseTo(4.5);
    });

    it('switches Gemini 3.8 Flash to the post-2026-12-31 rate', () => {
      expect(estimateCostUsd('gemini', 'gemini-3.8-flash', { inputTokens: 1e6, outputTokens: 1e6 }, JAN_2027)).toBeCloseTo(9.0);
      // Still the old rate on New Year's Eve, US Pacific
      expect(
        estimateCostUsd('gemini', 'gemini-3.8-flash', { inputTokens: 1e6, outputTokens: 0 }, new Date('2027-01-01T07:59:00Z'))
      ).toBeCloseTo(0.75);
    });

    it('bills Gemini thinking tokens at the output rate', () => {
      expect(
        estimateCostUsd('gemini', 'gemini-3.8-flash', { inputTokens: 0, outputTokens: 0, thinkingTokens: 1e6 }, NOV_2026)
      ).toBeCloseTo(3.75);
    });

    it('adds $10 per 1,000 Claude web searches and $14 per 1,000 grounded Gemini requests', () => {
      expect(estimateCostUsd('claude', 'claude-sonnet-5', { inputTokens: 0, outputTokens: 0, webSearchRequests: 5 }, NOV_2026)).toBeCloseTo(0.05);
      expect(estimateCostUsd('gemini', 'gemini-3.8-flash', { inputTokens: 0, outputTokens: 0, groundedRequests: 1 }, NOV_2026)).toBeCloseTo(0.014);
    });

    it('prices prompt-cache writes at 1.25x and reads at 0.1x input', () => {
      expect(
        estimateCostUsd('claude', 'claude-sonnet-5', { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 1e6, cacheReadTokens: 1e6 }, NOV_2026)
      ).toBeCloseTo(2 * 1.25 + 2 * 0.1);
    });

    it('applies the long-context tier above the threshold', () => {
      expect(estimateCostUsd('claude', 'claude-haiku-5-5', { inputTokens: 100_000, outputTokens: 0 }, NOV_2026)).toBeCloseTo(0.01);
      expect(estimateCostUsd('claude', 'claude-haiku-5-5', { inputTokens: 200_000, outputTokens: 0 }, NOV_2026)).toBeCloseTo(0.1);
    });

    it('returns 0 for zero usage', () => {
      expect(estimateCostUsd('claude', 'claude-sonnet-5', { inputTokens: 0, outputTokens: 0 })).toBe(0);
    });
  });

  describe('SDK usage extraction', () => {
    it('reads Claude input/output, cache and web-search counts', () => {
      expect(
        claudeUsageComponents({
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: null,
          cache_read_input_tokens: 7,
          server_tool_use: { web_search_requests: 3 },
        })
      ).toEqual({ inputTokens: 100, outputTokens: 50, cacheWriteTokens: 0, cacheReadTokens: 7, webSearchRequests: 3 });
      expect(claudeUsageComponents({ input_tokens: 1, output_tokens: 2, server_tool_use: null }).webSearchRequests).toBe(0);
    });

    it('reads Gemini thinking and tool-use prompt tokens', () => {
      expect(
        geminiUsageComponents(
          { promptTokenCount: 100, candidatesTokenCount: 40, thoughtsTokenCount: 900, toolUsePromptTokenCount: 25 },
          { grounded: true }
        )
      ).toEqual({ inputTokens: 125, outputTokens: 40, thinkingTokens: 900, groundedRequests: 1 });
      expect(geminiUsageComponents(undefined, { grounded: false })).toEqual({ inputTokens: 0, outputTokens: 0, thinkingTokens: 0, groundedRequests: 0 });
    });
  });

  describe('recordUsage', () => {
    // Each call: 1,234 input + 567 output tokens on Sonnet 5 = $0.008138 = 8,138 micro-dollars
    const CALL = { inputTokens: 1234, outputTokens: 567 };
    const CALL_MICRO = 8138;

    it('20 concurrent calls produce the exact sum in the database (bug B6)', async () => {
      await Promise.all(Array.from({ length: 20 }, () => recordUsage('claude', 'claude-sonnet-5', CALL)));
      expect([...rows.values()]).toEqual([BigInt(20 * CALL_MICRO)]);
      expect(await getTodaysSpend()).toBe((20 * CALL_MICRO) / 1e6);
    });

    it('20 concurrent calls produce the exact sum in the memory fallback', async () => {
      isDbAvailableMock.mockResolvedValue(false);
      await Promise.all(Array.from({ length: 20 }, () => recordUsage('claude', 'claude-sonnet-5', CALL)));
      expect(upsertMock).not.toHaveBeenCalled();
      expect(await getTodaysSpend()).toBe((20 * CALL_MICRO) / 1e6);
    });

    it('uses an atomic increment, never a read-then-write', async () => {
      await recordUsage('claude', 'claude-sonnet-5', CALL);
      expect(findUniqueMock).not.toHaveBeenCalled();
      expect(upsertMock.mock.calls[0][0]).toMatchObject({ update: { costMicroUsd: { increment: BigInt(CALL_MICRO) } } });
    });

    it('retries once when two calls race to create the first row of the day', async () => {
      upsertMock.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' }));
      await recordUsage('claude', 'claude-sonnet-5', CALL);
      expect(upsertMock).toHaveBeenCalledTimes(2);
      expect(await getTodaysSpend()).toBe(CALL_MICRO / 1e6);
    });

    it('falls back to memory when the database write fails, and counts both', async () => {
      await recordUsage('claude', 'claude-sonnet-5', CALL); // lands in DB
      upsertMock.mockRejectedValueOnce(new Error('connection reset'));
      await recordUsage('claude', 'claude-sonnet-5', CALL); // lands in memory
      expect(await getTodaysSpend()).toBe((2 * CALL_MICRO) / 1e6);
    });

    it('never throws, even if the database check itself fails', async () => {
      isDbAvailableMock.mockRejectedValue(new Error('db check exploded'));
      await expect(recordUsage('claude', 'claude-sonnet-5', CALL)).resolves.toBeUndefined();
    });

    it('records nothing for a zero-cost call', async () => {
      await recordUsage('claude', 'claude-sonnet-5', { inputTokens: 0, outputTokens: 0 });
      expect(upsertMock).not.toHaveBeenCalled();
    });
  });

  describe('getTodaysSpend', () => {
    it('returns 0 when nothing has been recorded today', async () => {
      expect(await getTodaysSpend()).toBe(0);
    });
  });

  describe('getDailySpendCapUsd', () => {
    it('defaults to $5 when unset', () => {
      expect(getDailySpendCapUsd()).toBe(5);
    });

    it('reads DAILY_SPEND_CAP_USD when set to a valid positive number', () => {
      process.env.DAILY_SPEND_CAP_USD = '2.5';
      expect(getDailySpendCapUsd()).toBe(2.5);
    });

    it('falls back to the default for garbage or non-positive values', () => {
      process.env.DAILY_SPEND_CAP_USD = 'not-a-number';
      expect(getDailySpendCapUsd()).toBe(5);
      process.env.DAILY_SPEND_CAP_USD = '-3';
      expect(getDailySpendCapUsd()).toBe(5);
    });
  });
});

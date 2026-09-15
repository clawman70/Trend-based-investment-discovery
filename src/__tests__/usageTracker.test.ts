import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { getCachedDataMock, setCachedDataMock } = vi.hoisted(() => ({
  getCachedDataMock: vi.fn(),
  setCachedDataMock: vi.fn(),
}));

vi.mock('../lib/dbHelper', () => ({
  getCachedData: getCachedDataMock,
  setCachedData: setCachedDataMock,
}));

import { estimateCostUsd, getDailySpendCapUsd, getTodaysSpend, recordUsage } from '../lib/usageTracker';

describe('usageTracker', () => {
  beforeEach(() => {
    getCachedDataMock.mockReset().mockResolvedValue(null);
    setCachedDataMock.mockReset().mockResolvedValue(undefined);
    delete process.env.DAILY_SPEND_CAP_USD;
  });

  describe('estimateCostUsd', () => {
    it('computes cost from input/output token rates', () => {
      // Claude: $2/1M input, $10/1M output
      expect(estimateCostUsd('claude', 1_000_000, 1_000_000)).toBeCloseTo(12.0);
      // Gemini: $0.75/1M input, $3.75/1M output
      expect(estimateCostUsd('gemini', 1_000_000, 1_000_000)).toBeCloseTo(4.5);
    });

    it('returns 0 for zero tokens', () => {
      expect(estimateCostUsd('claude', 0, 0)).toBe(0);
    });
  });

  describe('recordUsage', () => {
    it('adds this call\'s cost to an existing running total', async () => {
      getCachedDataMock.mockResolvedValue(1.5);
      await recordUsage('claude', 1_000_000, 0); // $2 for this call

      expect(setCachedDataMock).toHaveBeenCalledTimes(1);
      const [key, type, value] = setCachedDataMock.mock.calls[0];
      expect(key).toMatch(/^usage:spend:\d{4}-\d{2}-\d{2}$/);
      expect(type).toBe('usage');
      expect(value).toBeCloseTo(3.5);
    });

    it('starts from 0 when nothing is cached yet', async () => {
      getCachedDataMock.mockResolvedValue(null);
      await recordUsage('gemini', 1_000_000, 0); // $0.75

      const value = setCachedDataMock.mock.calls[0][2];
      expect(value).toBeCloseTo(0.75);
    });

    it('never throws, even if the cache read/write fails — must not break the AI call it tracks', async () => {
      getCachedDataMock.mockRejectedValue(new Error('cache down'));
      await expect(recordUsage('claude', 1000, 1000)).resolves.toBeUndefined();
    });
  });

  describe('getTodaysSpend', () => {
    it('returns 0 when nothing has been recorded today', async () => {
      getCachedDataMock.mockResolvedValue(null);
      expect(await getTodaysSpend()).toBe(0);
    });

    it('returns the cached running total', async () => {
      getCachedDataMock.mockResolvedValue(4.2);
      expect(await getTodaysSpend()).toBe(4.2);
    });
  });

  describe('getDailySpendCapUsd', () => {
    afterEach(() => {
      delete process.env.DAILY_SPEND_CAP_USD;
    });

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

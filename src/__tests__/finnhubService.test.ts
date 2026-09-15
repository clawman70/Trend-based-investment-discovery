import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchQuote,
  fetchProfile,
  FinnhubNotConfiguredError,
  normalizeMetrics,
  resetFinnhubRateLimiter,
} from '../lib/finnhubService';

const okResponse = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

describe('Finnhub service', () => {
  beforeEach(() => {
    resetFinnhubRateLimiter();
    process.env.FINNHUB_API_KEY = 'TEST_KEY';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('normalizeMetrics', () => {
    it('converts market cap from millions and derives free cash flow', () => {
      const result = normalizeMetrics({
        marketCapitalization: 4_800_000,
        peTTM: 37.6,
        revenueGrowthTTMYoy: 14.24,
        'totalDebt/totalEquityQuarterly': 0.78,
        pfcfShareTTM: 32,
        '52WeekPriceReturnDaily': 44.4,
      });
      expect(result.marketCap).toBe(4_800_000_000_000);
      expect(result.peRatio).toBe(37.6);
      expect(result.revenueGrowthYoY).toBe(14.24);
      expect(result.debtToEquity).toBe(0.78);
      expect(result.freeCashFlowDerived).toBe(150_000_000_000);
      expect(result.priceReturn52Week).toBe(44.4);
    });

    it('treats negative P/E and missing values as null, and falls back to annual debt/equity', () => {
      const result = normalizeMetrics({ peTTM: -12, 'totalDebt/totalEquityAnnual': 1.5 });
      expect(result.peRatio).toBeNull();
      expect(result.marketCap).toBeNull();
      expect(result.freeCashFlowDerived).toBeNull();
      expect(result.debtToEquity).toBe(1.5);
    });

    it('handles null metrics', () => {
      expect(normalizeMetrics(null)).toEqual({
        marketCap: null,
        peRatio: null,
        revenueGrowthYoY: null,
        debtToEquity: null,
        freeCashFlowDerived: null,
        priceReturn52Week: null,
      });
    });
  });

  describe('HTTP client', () => {
    it('sends the API key as a header, never in the URL', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(okResponse({ c: 329.66, pc: 333.08 }));

      const quote = await fetchQuote('aapl');
      expect(quote?.c).toBe(329.66);

      const [url, init] = fetchSpy.mock.calls[0];
      expect(String(url)).toBe('https://finnhub.io/api/v1/quote?symbol=AAPL');
      expect((init?.headers as Record<string, string>)['X-Finnhub-Token']).toBe('TEST_KEY');
    });

    it('returns null for a zero-price quote and an empty profile', async () => {
      vi.spyOn(global, 'fetch')
        .mockResolvedValueOnce(okResponse({ c: 0, pc: 0 }))
        .mockResolvedValueOnce(okResponse({}));

      expect(await fetchQuote('ZZZQ')).toBeNull();
      expect(await fetchProfile('ZZZQ')).toBeNull();
    });

    it('retries once after a 429', async () => {
      vi.useFakeTimers();
      const fetchSpy = vi
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce({ ok: false, status: 429 } as Response)
        .mockResolvedValueOnce(okResponse({ c: 10 }));

      const pending = fetchQuote('AAPL');
      await vi.advanceTimersByTimeAsync(2500);
      expect((await pending)?.c).toBe(10);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('throws a clear error when the key is not configured', async () => {
      delete process.env.FINNHUB_API_KEY;
      await expect(fetchQuote('AAPL')).rejects.toBeInstanceOf(FinnhubNotConfiguredError);
    });
  });
});

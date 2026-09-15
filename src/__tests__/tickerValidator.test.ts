import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildListingDirectory, getListing, normalizeTicker, validateTickers } from '../lib/tickerValidator';
import { resetFinnhubRateLimiter } from '../lib/finnhubService';
import type { FinnhubSymbol } from '../lib/finnhubService';
import * as dbHelper from '../lib/dbHelper';

vi.mock('../lib/dbHelper', () => ({
  getCachedData: vi.fn(),
  setCachedData: vi.fn(),
}));

const listing = (symbol: string, mic: string, type = 'Common Stock'): FinnhubSymbol => ({
  symbol,
  description: `${symbol} CORP`,
  displaySymbol: symbol,
  mic,
  type,
  currency: 'USD',
});

// Shaped like Finnhub's /stock/symbol?exchange=US response
const mockDirectory: FinnhubSymbol[] = [
  listing('AAPL', 'XNAS'),
  listing('TSLA', 'XNAS'),
  listing('BRK.B', 'XNYS'),
  listing('TSM', 'XNYS', 'ADR'),
  listing('SPY', 'ARCX', 'ETP'), // ETF -> rejected
  listing('TOYOF', 'OOTC'), // OTC -> rejected
  listing('ABCDW', 'XNAS', 'Equity WRT'), // warrant -> rejected
];

const okResponse = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

describe('Ticker Validation Pipeline (Finnhub symbol directory)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetFinnhubRateLimiter();
    process.env.FINNHUB_API_KEY = 'TEST_KEY';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts major-exchange stocks and ADRs; rejects fakes, OTC, ETFs and warrants', async () => {
    vi.mocked(dbHelper.getCachedData).mockResolvedValue(null);
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(okResponse(mockDirectory));

    const result = await validateTickers(['AAPL', 'tsla', 'TSM', 'SPY', 'TOYOF', 'ABCDW', 'ZZZQ']);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/stock/symbol?exchange=US');
    expect(String(fetchSpy.mock.calls[0][0])).not.toContain('TEST_KEY'); // token sent as header, not in URL
    expect(result.valid).toEqual(['AAPL', 'TSLA', 'TSM']);
    expect(result.invalid).toEqual(['SPY', 'TOYOF', 'ABCDW', 'ZZZQ']);
    expect(result.bypassed).toBe(false);
    expect(dbHelper.setCachedData).toHaveBeenCalled();
  });

  it('normalizes share-class separators (BRK-B and BRK/B -> BRK.B)', async () => {
    vi.mocked(dbHelper.getCachedData).mockResolvedValue(null);
    vi.spyOn(global, 'fetch').mockResolvedValue(okResponse(mockDirectory));

    expect(normalizeTicker(' brk-b ')).toBe('BRK.B');
    const result = await validateTickers(['BRK-B', 'BRK/B']);
    expect(result.valid).toEqual(['BRK.B', 'BRK.B']);
  });

  it('uses the cached directory without calling Finnhub', async () => {
    vi.mocked(dbHelper.getCachedData).mockResolvedValue(buildListingDirectory(mockDirectory));
    const fetchSpy = vi.spyOn(global, 'fetch');

    const result = await validateTickers(['AAPL', 'FAKE']);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ valid: ['AAPL'], invalid: ['FAKE'], bypassed: false });
  });

  it('bypasses (flagged) if the Finnhub request fails', async () => {
    vi.mocked(dbHelper.getCachedData).mockResolvedValue(null);
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 500 } as Response);

    const result = await validateTickers(['AAPL', 'XYZ_FAKE']);
    expect(result).toEqual({ valid: ['AAPL', 'XYZ_FAKE'], invalid: [], bypassed: true });
  });

  it('bypasses (flagged) without calling Finnhub if the API key is not configured', async () => {
    delete process.env.FINNHUB_API_KEY;
    vi.mocked(dbHelper.getCachedData).mockResolvedValue(null);
    const fetchSpy = vi.spyOn(global, 'fetch');

    const result = await validateTickers(['AAPL', 'XYZ_FAKE']);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.bypassed).toBe(true);
  });

  it('maps exchange MIC codes to display exchanges via getListing', async () => {
    vi.mocked(dbHelper.getCachedData).mockResolvedValue(buildListingDirectory(mockDirectory));

    expect((await getListing('AAPL'))?.exchange).toBe('NASDAQ');
    expect((await getListing('brk-b'))?.exchange).toBe('NYSE');
    expect(await getListing('SPY')).toBeNull();
  });
});

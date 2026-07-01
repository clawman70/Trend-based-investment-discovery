import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateTickers } from '../lib/tickerValidator';
import * as dbHelper from '../lib/dbHelper';

// Mock DB helpers
vi.mock('../lib/dbHelper', () => ({
  getCachedData: vi.fn(),
  setCachedData: vi.fn(),
}));

describe('Ticker Validation Pipeline', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.FMP_API_KEY = 'TEST_KEY';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should successfully validate tickers against FMP stock list when fetched', async () => {
    // Mock cache miss
    vi.mocked(dbHelper.getCachedData).mockResolvedValue(null);

    // Mock successful fetch from FMP
    const mockStockList = [
      { symbol: 'AAPL', name: 'Apple Inc.' },
      { symbol: 'MSFT', name: 'Microsoft Corporation' },
      { symbol: 'TSLA', name: 'Tesla Inc.' }
    ];
    
    const globalFetch = vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return {
        ok: true,
        json: async () => mockStockList
      } as Response;
    });

    const result = await validateTickers(['AAPL', 'INVALID', 'tsla']);

    expect(globalFetch).toHaveBeenCalled();
    expect(result.valid).toContain('AAPL');
    expect(result.valid).toContain('TSLA'); // Case insensitive check
    expect(result.invalid).toContain('INVALID');
    expect(result.bypassed).toBe(false);
  });

  it('should bypass validation if FMP API fails', async () => {
    // Mock cache miss
    vi.mocked(dbHelper.getCachedData).mockResolvedValue(null);

    // Mock FMP request error
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return {
        ok: false,
        status: 500
      } as Response;
    });

    const tickers = ['AAPL', 'MSFT', 'XYZ_FAKE'];
    const result = await validateTickers(tickers);

    // Should return all tickers as valid, bypassing the drop behavior
    expect(result.valid).toEqual(tickers.map(t => t.toUpperCase()));
    expect(result.invalid).toEqual([]);
    expect(result.bypassed).toBe(true);
  });

  it('should bypass validation if API Key is not configured', async () => {
    // Set API key to placeholder
    process.env.FMP_API_KEY = 'PLACEHOLDER_API_KEY';

    const tickers = ['AAPL', 'MSFT', 'XYZ_FAKE'];
    const result = await validateTickers(tickers);

    // Should bypass validation
    expect(result.valid).toEqual(tickers.map(t => t.toUpperCase()));
    expect(result.invalid).toEqual([]);
    expect(result.bypassed).toBe(true);
  });
});

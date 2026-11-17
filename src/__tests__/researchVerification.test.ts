import { describe, it, expect, vi, beforeEach } from 'vitest';
import { namesMatch, verifyMentionedCompanies } from '../lib/researchVerification';
import * as tickerValidator from '../lib/tickerValidator';
import * as finnhubService from '../lib/finnhubService';
import * as yahooService from '../lib/yahooService';
import type { MentionedCompany } from '../lib/types';

/** Bug B5: Research-tab tickers are checked against the real listing directory before use. */

vi.mock('../lib/dbHelper', () => ({
  getCachedData: vi.fn().mockResolvedValue(null),
  setCachedData: vi.fn(),
}));

vi.mock('../lib/tickerValidator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/tickerValidator')>();
  return { ...actual, getListingDirectory: vi.fn() };
});

vi.mock('../lib/finnhubService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/finnhubService')>();
  return { ...actual, isFinnhubConfigured: vi.fn(() => true), fetchQuote: vi.fn(), fetchMetrics: vi.fn() };
});

vi.mock('../lib/yahooService', () => ({ fetchSixMonthRally: vi.fn() }));

const directory = {
  FLNC: { symbol: 'FLNC', name: 'FLUENCE ENERGY INC-A', exchange: 'NASDAQ' as const, type: 'Common Stock' },
  AAPL: { symbol: 'AAPL', name: 'APPLE INC', exchange: 'NASDAQ' as const, type: 'Common Stock' },
};

const company = (patch: Partial<MentionedCompany>): MentionedCompany => ({
  name: 'Fluence Energy',
  ticker: 'FLNC',
  marketCapTier: 'large', // Gemini's guess, deliberately wrong
  context: 'Battery integrator',
  recentRally: null,
  ...patch,
});

describe('namesMatch', () => {
  it('matches the same company despite legal suffixes and share-class labels', () => {
    expect(namesMatch('Fluence Energy', 'FLUENCE ENERGY INC-A')).toBe(true);
    expect(namesMatch('Alphabet', 'ALPHABET INC-CL A')).toBe(true);
    expect(namesMatch('Rocket Lab', 'ROCKET LAB USA INC')).toBe(true);
    expect(namesMatch('Taiwan Semiconductor Manufacturing', 'TAIWAN SEMICONDUCTOR-SP ADR')).toBe(true);
    expect(namesMatch('IonQ', 'ION Q INC')).toBe(true);
  });

  it('flags a clear mismatch, even when the names share a generic word', () => {
    expect(namesMatch('Apple', 'FLUENCE ENERGY INC-A')).toBe(false);
    expect(namesMatch('Plug Power', 'XYZ POWER INC')).toBe(false);
  });
});

describe('verifyMentionedCompanies (bug B5)', () => {
  beforeEach(() => {
    vi.mocked(tickerValidator.getListingDirectory).mockReset().mockResolvedValue(directory);
    vi.mocked(finnhubService.isFinnhubConfigured).mockReturnValue(true);
    vi.mocked(finnhubService.fetchQuote).mockReset().mockResolvedValue({ c: 20 } as finnhubService.FinnhubQuote);
    vi.mocked(finnhubService.fetchMetrics).mockReset().mockResolvedValue({ marketCapitalization: 2500 }); // $2.5B, in millions
    vi.mocked(yahooService.fetchSixMonthRally).mockReset().mockResolvedValue({ ticker: 'FLNC', rallied: true, changePercent: 45 });
  });

  it('a company with a fake ticker shows as unverified and has no rally value', async () => {
    const [result] = await verifyMentionedCompanies([company({ name: 'Imaginary Fusion Co', ticker: 'ZZZQ' })]);
    expect(result.tickerStatus).toBe('unverified');
    expect(result.unverifiedReason).toBe('not_listed');
    expect(result.recentRally).toBeNull();
    expect(result.marketCapTierSource).toBe('ai_estimate');
    expect(finnhubService.fetchQuote).not.toHaveBeenCalled();
    expect(yahooService.fetchSixMonthRally).not.toHaveBeenCalled();
  });

  it("a real ticker that belongs to a DIFFERENT company is unverified and does not get that company's rally", async () => {
    const [result] = await verifyMentionedCompanies([company({ name: 'Apple', ticker: 'FLNC' })]);
    expect(result.tickerStatus).toBe('unverified');
    expect(result.unverifiedReason).toBe('name_mismatch');
    expect(result.listingName).toBe('FLUENCE ENERGY INC-A');
    expect(result.recentRally).toBeNull();
    expect(yahooService.fetchSixMonthRally).not.toHaveBeenCalled();
  });

  it('a verified company gets a real rally value and a market-cap tier computed from real Finnhub data', async () => {
    const [result] = await verifyMentionedCompanies([company({})]);
    expect(result.tickerStatus).toBe('verified');
    expect(result.recentRally).toBe(true);
    expect(result.marketCapTier).toBe('mid'); // $2.5B real, not Gemini's 'large'
    expect(result.marketCapTierSource).toBe('finnhub');
  });

  it("keeps Gemini's tier labeled as an AI estimate when Finnhub has no market cap", async () => {
    vi.mocked(finnhubService.fetchMetrics).mockResolvedValue(null);
    const [result] = await verifyMentionedCompanies([company({})]);
    expect(result.tickerStatus).toBe('verified');
    expect(result.marketCapTier).toBe('large');
    expect(result.marketCapTierSource).toBe('ai_estimate');
  });

  it('marks every company unverified (no rally) when the listing directory cannot be loaded', async () => {
    vi.mocked(tickerValidator.getListingDirectory).mockResolvedValue(null);
    const [result] = await verifyMentionedCompanies([company({})]);
    expect(result.tickerStatus).toBe('unverified');
    expect(result.unverifiedReason).toBe('directory_unavailable');
    expect(result.recentRally).toBeNull();
  });

  it('normalizes class-share tickers before the lookup and treats an empty ticker as not listed', async () => {
    vi.mocked(tickerValidator.getListingDirectory).mockResolvedValue({
      'BRK.B': { symbol: 'BRK.B', name: 'BERKSHIRE HATHAWAY INC-CL B', exchange: 'NYSE', type: 'Common Stock' },
    });
    const [brk, blank] = await verifyMentionedCompanies([
      company({ name: 'Berkshire Hathaway', ticker: 'BRK-B' }),
      company({ name: 'Private Startup', ticker: '' }),
    ]);
    expect(brk.tickerStatus).toBe('verified');
    expect(blank.unverifiedReason).toBe('not_listed');
  });

  it('a failed quote leaves the rally as N/A without failing the company', async () => {
    vi.mocked(finnhubService.fetchQuote).mockRejectedValue(new Error('Finnhub down'));
    const [result] = await verifyMentionedCompanies([company({})]);
    expect(result.tickerStatus).toBe('verified');
    expect(result.recentRally).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { marketCapTier, passesMarketCapFilter, passesExchangeFilter, applyRealDataFilters } from '../lib/resultFilters';

describe('marketCapFilter', () => {
  describe('marketCapTier', () => {
    it('buckets by real market cap thresholds', () => {
      expect(marketCapTier(100_000_000)).toBe('MICRO');
      expect(marketCapTier(1_000_000_000)).toBe('SMALL');
      expect(marketCapTier(5_000_000_000)).toBe('MID');
      expect(marketCapTier(50_000_000_000)).toBe('LARGE');
    });
  });

  describe('passesMarketCapFilter', () => {
    it('keeps everything when no tier is selected', () => {
      expect(passesMarketCapFilter(100, [])).toBe(true);
      expect(passesMarketCapFilter(0, [])).toBe(true);
    });

    it('drops a company whose real market cap does not match the selected tier', () => {
      // Large-cap company (Apple-sized), but the user only wants micro-caps.
      expect(passesMarketCapFilter(3_000_000_000_000, ['MICRO'])).toBe(false);
    });

    it('keeps a company whose real market cap matches a selected tier', () => {
      expect(passesMarketCapFilter(1_000_000_000, ['SMALL', 'MID'])).toBe(true);
    });

    it('never drops a company whose market cap is unknown — cannot verify, so do not filter it out', () => {
      expect(passesMarketCapFilter(0, ['LARGE'])).toBe(true);
    });
  });
});

describe('passesExchangeFilter (bug B2)', () => {
  it('keeps everything when no exchange is selected', () => {
    expect(passesExchangeFilter('NYSE', [])).toBe(true);
    expect(passesExchangeFilter(null, [])).toBe(true);
  });

  it('drops a NYSE company when only NASDAQ is selected', () => {
    expect(passesExchangeFilter('NYSE', ['NASDAQ'])).toBe(false);
  });

  it('keeps a company listed on a selected exchange', () => {
    expect(passesExchangeFilter('NASDAQ', ['NASDAQ'])).toBe(true);
    expect(passesExchangeFilter('NYSE', ['NASDAQ', 'NYSE'])).toBe(true);
  });

  it('matches exactly — NYSE American is not NYSE', () => {
    expect(passesExchangeFilter('NYSEAMERICAN', ['NYSE'])).toBe(false);
  });

  it('never drops a company whose exchange is unknown', () => {
    expect(passesExchangeFilter(null, ['NASDAQ'])).toBe(true);
    expect(passesExchangeFilter(undefined, ['NASDAQ'])).toBe(true);
  });
});

describe('applyRealDataFilters', () => {
  const rows = [
    { ticker: 'AAA', marketCap: 1_000_000_000, exchange: 'NASDAQ' as const },
    { ticker: 'BBB', marketCap: 1_000_000_000, exchange: 'NYSE' as const },
    { ticker: 'CCC', marketCap: 50_000_000_000, exchange: 'NASDAQ' as const },
    { ticker: 'DDD', marketCap: 0, exchange: null },
  ];

  it('applies market cap and exchange together and keeps unknowns', () => {
    const kept = applyRealDataFilters(rows, { marketCap: ['SMALL'], exchange: ['NASDAQ'] }).map((r) => r.ticker);
    expect(kept).toEqual(['AAA', 'DDD']);
  });

  it('with NASDAQ selected, every row with a known exchange is NASDAQ', () => {
    const kept = applyRealDataFilters(rows, { marketCap: [], exchange: ['NASDAQ'] });
    expect(kept.filter((r) => r.exchange !== null).every((r) => r.exchange === 'NASDAQ')).toBe(true);
  });
});

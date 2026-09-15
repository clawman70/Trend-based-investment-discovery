import { describe, it, expect } from 'vitest';
import { marketCapTier, passesMarketCapFilter } from '../lib/marketCapFilter';

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

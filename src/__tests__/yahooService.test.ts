import { describe, it, expect, vi, beforeEach } from 'vitest';

const { chartMock, quoteSummaryMock } = vi.hoisted(() => ({
  chartMock: vi.fn(),
  quoteSummaryMock: vi.fn(),
}));

vi.mock('yahoo-finance2', () => ({
  default: class {
    chart = chartMock;
    quoteSummary = quoteSummaryMock;
  },
}));

import { calculateGrowth, fetchCompanyProfile, fetchPriceGrowth } from '../lib/yahooService';

const NOW = new Date('2026-09-15T00:00:00Z');

describe('Yahoo service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('calculateGrowth', () => {
    it('computes 1Y and 5Y growth from the closest weekly closes', () => {
      const closes = [
        { date: new Date('2021-09-17'), close: 50 }, // ~5 years ago
        { date: new Date('2025-09-12'), close: 100 }, // ~1 year ago
        { date: new Date('2026-09-11'), close: 148 },
      ];
      const result = calculateGrowth('AAPL', 150, closes, NOW);
      expect(result.growth1Y).toBeCloseTo(50);
      expect(result.growth5Y).toBeCloseTo(200);
      expect(result.growthSource).toBe('calculated');
    });

    it('returns null growth (not 0) when history does not reach back far enough', () => {
      const closes = [{ date: new Date('2026-06-01'), close: 90 }]; // recent IPO
      const result = calculateGrowth('NEWCO', 100, closes, NOW);
      expect(result.growth1Y).toBeNull();
      expect(result.growth5Y).toBeNull();
      expect(result.growthSource).toBe('insufficient_history');
    });

    it('returns 1Y growth only for companies listed less than 5 years', () => {
      const closes = [{ date: new Date('2025-09-19'), close: 80 }];
      const result = calculateGrowth('YOUNG', 100, closes, NOW);
      expect(result.growth1Y).toBeCloseTo(25);
      expect(result.growth5Y).toBeNull();
    });
  });

  describe('fetchPriceGrowth', () => {
    it('queries Yahoo with dash share-class symbols and weekly bars', async () => {
      chartMock.mockResolvedValue({ meta: {}, quotes: [] });
      await fetchPriceGrowth('BRK.B', 500);
      expect(chartMock).toHaveBeenCalledWith('BRK-B', expect.objectContaining({ interval: '1wk' }));
    });

    it('returns unavailable instead of throwing when Yahoo fails', async () => {
      chartMock.mockRejectedValue(new Error('No data found, symbol may be delisted'));
      const result = await fetchPriceGrowth('ZZZQ', 10);
      expect(result).toEqual({ ticker: 'ZZZQ', growth1Y: null, growth5Y: null, growthSource: 'unavailable' });
    });
  });

  describe('fetchCompanyProfile', () => {
    it('extracts description, sector, industry, website and the CEO', async () => {
      quoteSummaryMock.mockResolvedValue({
        assetProfile: {
          longBusinessSummary: 'Designs smartphones.',
          sector: 'Technology',
          industry: 'Consumer Electronics',
          website: 'https://www.apple.com',
          companyOfficers: [
            { name: 'Pat Chair', title: 'Executive Chairman' },
            { name: 'Jane Doe', title: 'CEO & Director' },
          ],
        },
      });

      expect(await fetchCompanyProfile('AAPL')).toEqual({
        description: 'Designs smartphones.',
        sector: 'Technology',
        industry: 'Consumer Electronics',
        website: 'https://www.apple.com',
        ceo: 'Jane Doe',
      });
    });

    it('returns null when Yahoo fails', async () => {
      quoteSummaryMock.mockRejectedValue(new Error('Quote not found'));
      expect(await fetchCompanyProfile('ZZZQ')).toBeNull();
    });
  });
});

/**
 * Exercises the Postgres branch of every store module (src/lib/stores/*.ts) with a
 * mocked Prisma client. The memory-fallback branch already has full coverage via
 * apiRoutes.test.ts / persistence.test.ts / research.test.ts (dbHelper mocked to
 * isDbAvailable: false); this file is what proves the DB code path itself is correct
 * without requiring a live Postgres connection in CI.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/dbHelper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/dbHelper')>();
  return { ...actual, isDbAvailable: vi.fn().mockResolvedValue(true) };
});

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    search: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), delete: vi.fn() },
    watchlistItem: { findMany: vi.fn(), upsert: vi.fn(), update: vi.fn(), delete: vi.fn() },
    trendPortfolio: { findMany: vi.fn(), create: vi.fn(), delete: vi.fn() },
    portfolioItem: { upsert: vi.fn(), delete: vi.fn() },
    researchScan: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    researchLoadedThesis: { create: vi.fn() },
  },
}));

vi.mock('../lib/prisma', () => ({ prisma: prismaMock }));

import { createSearch, deleteSearch, getSearchWithResults, listSearches } from '../lib/stores/historyStore';
import { deleteWatchlistItem, listWatchlistItems, updateWatchlistItem, upsertWatchlistItem } from '../lib/stores/watchlistStore';
import { addPortfolioItem, createPortfolio, deletePortfolio, listPortfoliosWithItems, removePortfolioItem } from '../lib/stores/portfolioStore';
import { createScan, findCachedScan, logLoadedThesis } from '../lib/stores/researchStore';
import { ScoredCompanyData, TrendResearchReport } from '../lib/types';

const mockCompany: ScoredCompanyData = {
  ticker: 'AAPL',
  companyName: 'Apple Inc.',
  rationale: 'Direct',
  relevanceScore: 9,
  trendsMatched: ['AI Tools'],
  convergenceScore: 1,
  rationales: { 'AI Tools': 'Direct' },
  stockPrice: 330,
  marketCap: 4_800_000_000_000,
  exchange: 'NASDAQ',
  peRatio: 37.6,
  growth1Y: 34.5,
  growth5Y: 126,
  debtToEquity: 0.78,
  dataQuality: { priceSource: 'live', growthSource: 'calculated' },
  compositeScore: 85,
};

const mockReport: TrendResearchReport = {
  isDemo: false,
  executiveSummary: 'Summary',
  scanDate: '2026-09-15',
  domainsScanned: ['Energy & Power Systems'],
  candidateTheses: [],
  companiesMentioned: [],
  adjacentSignals: [],
};

describe('Store modules — Postgres branch (mocked Prisma)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('historyStore', () => {
    it('listSearches queries Prisma sorted by createdAt desc', async () => {
      prismaMock.search.findMany.mockResolvedValue([{ id: 's1', createdAt: new Date(), trends: ['AI'], filters: {}, trendAnalysis: {} }]);
      const result = await listSearches();
      expect(prismaMock.search.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: 'desc' } });
      expect(result[0].id).toBe('s1');
    });

    it('createSearch nests result rows inside one Prisma create call', async () => {
      prismaMock.search.create.mockResolvedValue({ id: 's1', createdAt: new Date(), trends: ['AI'], filters: {}, trendAnalysis: {} });
      await createSearch({ trends: ['AI'], filters: {}, trendAnalysis: {}, results: [mockCompany] });

      const call = prismaMock.search.create.mock.calls[0][0];
      expect(call.data.trends).toEqual(['AI']);
      expect(call.data.results.create).toHaveLength(1);
      expect(call.data.results.create[0].ticker).toBe('AAPL');
      expect(call.data.results.create[0].financialData.stockPrice).toBe(330);
    });

    it('getSearchWithResults reassembles ScoredCompanyData from a joined Prisma row', async () => {
      prismaMock.search.findUnique.mockResolvedValue({
        id: 's1',
        createdAt: new Date(),
        trends: ['AI'],
        filters: {},
        trendAnalysis: {},
        results: [
          {
            ticker: 'AAPL',
            companyName: 'Apple Inc.',
            rationale: 'Direct',
            trendMatched: ['AI'],
            financialData: { stockPrice: 330, marketCap: 4.8e12, exchange: 'NASDAQ', peRatio: 37.6, relevanceScore: 9, rationales: {} },
            dataQuality: { priceSource: 'live' },
            compositeScore: 85,
            convergenceScore: 1,
          },
        ],
      });

      const result = await getSearchWithResults('s1');
      expect(prismaMock.search.findUnique).toHaveBeenCalledWith({ where: { id: 's1' }, include: { results: true } });
      expect(result?.companies[0].ticker).toBe('AAPL');
      expect(result?.companies[0].stockPrice).toBe(330);
      expect(result?.companies[0].dataQuality.priceSource).toBe('live');
    });

    it('getSearchWithResults returns null for a missing search', async () => {
      prismaMock.search.findUnique.mockResolvedValue(null);
      expect(await getSearchWithResults('missing')).toBeNull();
    });

    it('deleteSearch returns false (not throw) when the row does not exist', async () => {
      prismaMock.search.delete.mockRejectedValue(new Error('Record to delete does not exist'));
      expect(await deleteSearch('missing')).toBe(false);
    });
  });

  describe('watchlistStore', () => {
    it('upsertWatchlistItem calls Prisma upsert keyed on ticker', async () => {
      prismaMock.watchlistItem.upsert.mockResolvedValue({ id: 'w1', ticker: 'AAPL', companyName: 'Apple Inc.', addedAt: new Date(), priceAtAdd: 100, sourceSearchId: null, notes: null, tags: [] });
      await upsertWatchlistItem({ ticker: 'AAPL', companyName: 'Apple Inc.', priceAtAdd: 100 });

      const call = prismaMock.watchlistItem.upsert.mock.calls[0][0];
      expect(call.where).toEqual({ ticker: 'AAPL' });
      expect(call.create.priceAtAdd).toBe(100);
      // addedAt must not be in the update payload, so re-adding an existing ticker keeps its original date
      expect(call.update.addedAt).toBeUndefined();
    });

    it('listWatchlistItems sorts by addedAt desc', async () => {
      prismaMock.watchlistItem.findMany.mockResolvedValue([]);
      await listWatchlistItems();
      expect(prismaMock.watchlistItem.findMany).toHaveBeenCalledWith({ orderBy: { addedAt: 'desc' } });
    });

    it('updateWatchlistItem returns null (not throw) for an unknown id', async () => {
      prismaMock.watchlistItem.update.mockRejectedValue(new Error('Record to update not found'));
      expect(await updateWatchlistItem('missing', { notes: 'x' })).toBeNull();
    });

    it('deleteWatchlistItem deletes by ticker when no id is given', async () => {
      prismaMock.watchlistItem.delete.mockResolvedValue({});
      expect(await deleteWatchlistItem({ ticker: 'AAPL' })).toBe(true);
      expect(prismaMock.watchlistItem.delete).toHaveBeenCalledWith({ where: { ticker: 'AAPL' } });
    });
  });

  describe('portfolioStore', () => {
    it('listPortfoliosWithItems resolves watchlist links and drops dangling ones', async () => {
      prismaMock.trendPortfolio.findMany.mockResolvedValue([
        { id: 'p1', name: 'Bundle', description: null, createdAt: new Date(), items: [{ id: 'pi1', watchlistId: 'w1' }, { id: 'pi2', watchlistId: 'missing' }] },
      ]);
      prismaMock.watchlistItem.findMany.mockResolvedValue([{ id: 'w1', ticker: 'AAPL', companyName: 'Apple Inc.', addedAt: new Date(), priceAtAdd: 100, sourceSearchId: null, notes: null, tags: [] }]);

      const result = await listPortfoliosWithItems();
      expect(result[0].items).toHaveLength(1); // the dangling "missing" link is filtered out
      expect(result[0].items[0].watchlist.ticker).toBe('AAPL');
    });

    it('addPortfolioItem is idempotent via upsert', async () => {
      prismaMock.portfolioItem.upsert.mockResolvedValue({ id: 'pi1', portfolioId: 'p1', watchlistId: 'w1' });
      await addPortfolioItem({ portfolioId: 'p1', watchlistId: 'w1' });
      expect(prismaMock.portfolioItem.upsert).toHaveBeenCalledWith({
        where: { portfolioId_watchlistId: { portfolioId: 'p1', watchlistId: 'w1' } },
        create: { portfolioId: 'p1', watchlistId: 'w1' },
        update: {},
      });
    });

    it('addPortfolioItem returns null (not throw) on a foreign key violation', async () => {
      prismaMock.portfolioItem.upsert.mockRejectedValue(new Error('Foreign key constraint violated'));
      expect(await addPortfolioItem({ portfolioId: 'missing', watchlistId: 'w1' })).toBeNull();
    });

    it('deletePortfolio cascades via a single Prisma delete', async () => {
      prismaMock.trendPortfolio.delete.mockResolvedValue({});
      expect(await deletePortfolio('p1')).toBe(true);
      expect(prismaMock.trendPortfolio.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
    });

    it('removePortfolioItem returns false (not throw) for a missing link', async () => {
      prismaMock.portfolioItem.delete.mockRejectedValue(new Error('Record to delete does not exist'));
      expect(await removePortfolioItem({ portfolioId: 'p1', watchlistId: 'missing' })).toBe(false);
    });

    it('createPortfolio creates via Prisma', async () => {
      prismaMock.trendPortfolio.create.mockResolvedValue({ id: 'p1', name: 'Bundle', description: null, createdAt: new Date() });
      const result = await createPortfolio({ name: 'Bundle' });
      expect(result.id).toBe('p1');
    });
  });

  describe('researchStore', () => {
    it('findCachedScan (open mode) matches on exact prompt text', async () => {
      prismaMock.researchScan.findFirst.mockResolvedValue({ id: 'r1', createdAt: new Date(), domains: [], customPrompt: 'fusion energy', report: mockReport, cachedUntil: new Date(Date.now() + 1000) });
      const result = await findCachedScan({ mode: 'open', sortedDomains: [], customPrompt: 'fusion energy' });
      expect(prismaMock.researchScan.findFirst).toHaveBeenCalledWith({
        where: { customPrompt: 'fusion energy', cachedUntil: { gt: expect.any(Date) } },
        orderBy: { createdAt: 'desc' },
      });
      expect(result?.id).toBe('r1');
    });

    it('findCachedScan (guided mode) matches domain sets regardless of order', async () => {
      prismaMock.researchScan.findMany.mockResolvedValue([
        { id: 'r1', createdAt: new Date(), domains: ['Energy & Power Systems', 'Artificial Intelligence'], customPrompt: null, report: mockReport, cachedUntil: new Date(Date.now() + 1000) },
      ]);
      const result = await findCachedScan({ mode: 'guided', sortedDomains: ['Artificial Intelligence', 'Energy & Power Systems'], customPrompt: null });
      expect(result?.id).toBe('r1');
    });

    it('findCachedScan returns null when nothing matches', async () => {
      prismaMock.researchScan.findMany.mockResolvedValue([]);
      expect(await findCachedScan({ mode: 'guided', sortedDomains: ['AI'], customPrompt: null })).toBeNull();
    });

    it('createScan sets cachedUntil from the given TTL', async () => {
      prismaMock.researchScan.create.mockImplementation(async ({ data }) => ({ id: 'r1', createdAt: new Date(), ...data }));
      const before = Date.now();
      const result = await createScan({ domains: ['AI'], customPrompt: null, report: mockReport, ttlMs: 60_000 });
      expect(result.cachedUntil.getTime()).toBeGreaterThanOrEqual(before + 60_000 - 100);
    });

    it('logLoadedThesis creates a row without requiring the scan to exist', async () => {
      prismaMock.researchLoadedThesis.create.mockResolvedValue({ id: 'lt1', scanId: 'scan-that-may-not-exist', thesis: 'x', loadedAt: new Date(), searchId: null });
      const result = await logLoadedThesis({ scanId: 'scan-that-may-not-exist', thesis: 'x' });
      expect(result.id).toBe('lt1');
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as historyGET, POST as historyPOST, DELETE as historyDELETE } from '../app/api/history/route';
import { GET as watchlistGET, POST as watchlistPOST, PUT as watchlistPUT, DELETE as watchlistDELETE } from '../app/api/watchlist/route';
import { GET as portfoliosGET, POST as portfoliosPOST, DELETE as portfoliosDELETE } from '../app/api/portfolios/route';
import { ScoredCompanyData } from '../lib/types';
import * as finnhubService from '../lib/finnhubService';
import type { FinnhubQuote } from '../lib/finnhubService';
import {
  memorySearches,
  memorySearchResults,
  memoryWatchlistItems,
  memoryTrendPortfolios,
  memoryPortfolioItems,
} from '../lib/memoryStore';

// Ensure database availability check always returns false for tests to exercise the fallback memory store.
vi.mock('../lib/dbHelper', () => ({
  isDbAvailable: vi.fn().mockResolvedValue(false),
}));

vi.mock('../lib/finnhubService', () => ({
  isFinnhubConfigured: vi.fn(() => true),
  fetchQuotes: vi.fn(),
}));

const quotes = (prices: Record<string, number>) =>
  new Map(Object.entries(prices).map(([symbol, c]) => [symbol, { c } as FinnhubQuote]));

describe('Phase 3 — Persistence Layer Tests', () => {
  beforeEach(() => {
    // Clear global memory stores before each test run
    memorySearches.length = 0;
    memorySearchResults.length = 0;
    memoryWatchlistItems.length = 0;
    memoryTrendPortfolios.length = 0;
    memoryPortfolioItems.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Search History API (POST & GET & DELETE /api/history)', () => {
    it('should save a search snapshot and allow retrieving or deleting it', async () => {
      const mockResult: ScoredCompanyData = {
        ticker: 'MSFT',
        companyName: 'Microsoft Corp.',
        rationale: 'Office AI integration',
        relevanceScore: 9,
        trendsMatched: ['AI Tools'],
        convergenceScore: 1.0,
        rationales: { 'AI Tools': 'Office AI integration' },
        stockPrice: 400.0,
        marketCap: 3000000000000,
        growth1Y: 20,
        growth5Y: 150,
        exchange: 'NASDAQ',
        peRatio: 35,
        dataQuality: { priceSource: 'live', growthSource: 'calculated' },
        compositeScore: 85,
      };

      // 1. Post a new search
      const postRequest = new NextRequest('http://localhost:3000/api/history', {
        method: 'POST',
        body: JSON.stringify({
          trends: ['AI Tools'],
          filters: { exchange: ['NASDAQ'], marketCap: [] },
          trendAnalysis: { 'AI Tools': { maturityStage: 'Growth' } },
          results: [mockResult],
        }),
      });

      const postResponse = await historyPOST(postRequest);
      expect(postResponse.status).toBe(200);
      const postJson = await postResponse.json();
      expect(postJson.id).toBeDefined();
      const savedSearchId = postJson.id;

      // Verify stored in memory fallback
      expect(memorySearches.length).toBe(1);
      expect(memorySearchResults.length).toBe(1);

      // 2. Fetch list of searches
      const listRequest = new NextRequest('http://localhost:3000/api/history');
      const listResponse = await historyGET(listRequest);
      expect(listResponse.status).toBe(200);
      const listJson = await listResponse.json();
      expect(listJson.length).toBe(1);
      expect(listJson[0].id).toBe(savedSearchId);

      // 3. Fetch specific search details and results
      const getSingleRequest = new NextRequest(`http://localhost:3000/api/history?id=${savedSearchId}`);
      const getSingleResponse = await historyGET(getSingleRequest);
      expect(getSingleResponse.status).toBe(200);
      const getSingleJson = await getSingleResponse.json();
      expect(getSingleJson.search.id).toBe(savedSearchId);
      expect(getSingleJson.companies.length).toBe(1);
      expect(getSingleJson.companies[0].ticker).toBe('MSFT');

      // 4. Delete the search
      const deleteRequest = new NextRequest(`http://localhost:3000/api/history?id=${savedSearchId}`, {
        method: 'DELETE',
      });
      const deleteResponse = await historyDELETE(deleteRequest);
      expect(deleteResponse.status).toBe(200);
      expect(memorySearches.length).toBe(0);
      expect(memorySearchResults.length).toBe(0);
    });
  });

  describe('Watchlist API (POST & GET & PUT & DELETE /api/watchlist)', () => {
    it('should CRUD watchlisted tickers and evaluate gains relative to cost', async () => {
      // Mock Finnhub live quotes
      vi.mocked(finnhubService.fetchQuotes).mockResolvedValue(quotes({ AAPL: 180.0 }));

      // 1. Add asset to watchlist (cost basis $100.0)
      const postRequest = new NextRequest('http://localhost:3000/api/watchlist', {
        method: 'POST',
        body: JSON.stringify({
          ticker: 'AAPL',
          companyName: 'Apple Inc.',
          priceAtAdd: 100.0,
          notes: 'Init rationale',
          tags: ['Hardware'],
        }),
      });

      const postResponse = await watchlistPOST(postRequest);
      expect(postResponse.status).toBe(200);
      const postJson = await postResponse.json();
      expect(postJson.ticker).toBe('AAPL');
      expect(memoryWatchlistItems.length).toBe(1);

      // 2. Fetch watchlist (evaluates live quote 180.0 against cost $100.0)
      const getResponse = await watchlistGET();
      expect(getResponse.status).toBe(200);
      const getJson = await getResponse.json();
      expect(getJson.length).toBe(1);
      expect(getJson[0].currentPrice).toBe(180.0);
      expect(getJson[0].gainLossPercent).toBeCloseTo(80.0); // ((180 - 100) / 100) * 100

      // 3. Edit notes and tags
      const savedItemId = getJson[0].id;
      const putRequest = new NextRequest('http://localhost:3000/api/watchlist', {
        method: 'PUT',
        body: JSON.stringify({
          id: savedItemId,
          notes: 'Updated thesis',
          tags: ['Hardware', 'Consumer Devices'],
        }),
      });

      const putResponse = await watchlistPUT(putRequest);
      expect(putResponse.status).toBe(200);
      expect(memoryWatchlistItems[0].notes).toBe('Updated thesis');
      expect(memoryWatchlistItems[0].tags).toContain('Consumer Devices');

      // 4. Delete from watchlist
      const deleteRequest = new NextRequest(`http://localhost:3000/api/watchlist?id=${savedItemId}`, {
        method: 'DELETE',
      });
      const deleteResponse = await watchlistDELETE(deleteRequest);
      expect(deleteResponse.status).toBe(200);
      expect(memoryWatchlistItems.length).toBe(0);
    });
  });

  describe('Trend Portfolios API (POST & GET & DELETE /api/portfolios)', () => {
    it('should create portfolios, add constituent links, and calculate aggregates', async () => {
      // Mock Finnhub live quotes: AAPL cost $100 -> $150, MSFT cost $300 -> $300
      vi.mocked(finnhubService.fetchQuotes).mockResolvedValue(quotes({ AAPL: 150.0, MSFT: 300.0 }));

      // 1. Pre-seed two items in watchlist
      memoryWatchlistItems.push(
        {
          id: 'wl-1',
          ticker: 'AAPL',
          companyName: 'Apple Inc.',
          addedAt: new Date(),
          priceAtAdd: 100.0,
          sourceSearchId: null,
          notes: null,
          tags: [],
        },
        {
          id: 'wl-2',
          ticker: 'MSFT',
          companyName: 'Microsoft Corp.',
          addedAt: new Date(),
          priceAtAdd: 300.0,
          sourceSearchId: null,
          notes: null,
          tags: [],
        }
      );

      // 2. Create a Portfolio "Tech Giant Bundle"
      const createRequest = new NextRequest('http://localhost:3000/api/portfolios', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Tech Giant Bundle',
          description: 'Hedge portfolio',
        }),
      });

      const createResponse = await portfoliosPOST(createRequest);
      expect(createResponse.status).toBe(200);
      const portfolioJson = await createResponse.json();
      const portfolioId = portfolioJson.id;
      expect(memoryTrendPortfolios.length).toBe(1);

      // 3. Link watchlist items to this portfolio
      const link1Request = new NextRequest('http://localhost:3000/api/portfolios?action=add_item', {
        method: 'POST',
        body: JSON.stringify({ portfolioId, watchlistId: 'wl-1' }),
      });
      await portfoliosPOST(link1Request);

      const link2Request = new NextRequest('http://localhost:3000/api/portfolios?action=add_item', {
        method: 'POST',
        body: JSON.stringify({ portfolioId, watchlistId: 'wl-2' }),
      });
      await portfoliosPOST(link2Request);

      expect(memoryPortfolioItems.length).toBe(2);

      // 4. Fetch portfolios and check aggregates
      // Cost: 100 + 300 = 400. Value: 150 + 300 = 450. Return: ((450-400)/400)*100 = 12.5%
      const getResponse = await portfoliosGET();
      expect(getResponse.status).toBe(200);
      const getJson = await getResponse.json();
      expect(getJson.length).toBe(1);
      expect(getJson[0].totalCostBasis).toBe(400.0);
      expect(getJson[0].totalCurrentValue).toBe(450.0);
      expect(getJson[0].gainLossPercent).toBeCloseTo(12.5);
      expect(getJson[0].items.length).toBe(2);

      // 5. Remove an item linkage from portfolio
      const removeRequest = new NextRequest(
        `http://localhost:3000/api/portfolios?action=remove_item&portfolioId=${portfolioId}&watchlistId=wl-1`,
        {
          method: 'DELETE',
        }
      );
      const removeResponse = await portfoliosDELETE(removeRequest);
      expect(removeResponse.status).toBe(200);
      expect(memoryPortfolioItems.length).toBe(1); // Only MSFT link remains
    });
  });

  describe('Missing live prices', () => {
    it('shows N/A (null) instead of silently reusing the cost basis', async () => {
      vi.mocked(finnhubService.fetchQuotes).mockResolvedValue(quotes({ AAPL: 150.0 })); // no MSFT price

      memoryWatchlistItems.push(
        { id: 'wl-1', ticker: 'AAPL', companyName: 'Apple Inc.', addedAt: new Date(), priceAtAdd: 100, sourceSearchId: null, notes: null, tags: [] },
        { id: 'wl-2', ticker: 'MSFT', companyName: 'Microsoft Corp.', addedAt: new Date(), priceAtAdd: 300, sourceSearchId: null, notes: null, tags: [] }
      );
      memoryTrendPortfolios.push({ id: 'p-1', name: 'Mixed', description: null, createdAt: new Date() });
      memoryPortfolioItems.push({ id: 'pi-1', portfolioId: 'p-1', watchlistId: 'wl-1' }, { id: 'pi-2', portfolioId: 'p-1', watchlistId: 'wl-2' });

      const watchlist = await (await watchlistGET()).json();
      const msft = watchlist.find((i: { ticker: string }) => i.ticker === 'MSFT');
      expect(msft.currentPrice).toBeNull();
      expect(msft.gainLossPercent).toBeNull();

      const [portfolio] = await (await portfoliosGET()).json();
      // Totals only cover the priced item (AAPL): $100 -> $150
      expect(portfolio.totalCostBasis).toBe(100);
      expect(portfolio.totalCurrentValue).toBe(150);
      expect(portfolio.unpricedCount).toBe(1);
      expect(portfolio.gainLossPercent).toBeCloseTo(50);
    });
  });
});

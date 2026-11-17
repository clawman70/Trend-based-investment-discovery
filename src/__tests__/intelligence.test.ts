import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as analyzeTrendPOST } from '../app/api/analyze-trend/route';
import { POST as discoverPOST } from '../app/api/discover/route';
import * as claudeService from '../lib/claudeService';
import * as tickerValidator from '../lib/tickerValidator';
import { ScoredCompanyData } from '../lib/types';

vi.mock('../lib/tickerValidator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/tickerValidator')>();
  return { ...actual, validateTickers: vi.fn() };
});

vi.mock('../lib/claudeService', () => ({
  discoverCompaniesFromAI: vi.fn(),
  analyzeTrendFromAI: vi.fn(),
}));

vi.mock('../lib/dbHelper', () => ({
  getCachedData: vi.fn().mockResolvedValue(null),
  setCachedData: vi.fn(),
}));

describe('Phase 2 — Intelligence Layer Tests', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.ANTHROPIC_API_KEY = 'TEST_KEY';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('POST /api/analyze-trend', () => {
    it('should call Claude and return trend report card', async () => {
      const mockReport = {
        maturityStage: 'Growth' as const,
        estimatedTAM: '$10 Billion',
        catalysts: ['Catalyst A', 'Catalyst B', 'Catalyst C'],
        risks: ['Risk A', 'Risk B', 'Risk C'],
        timeHorizon: '3-5 years',
        adjacentTrends: ['Adj 1', 'Adj 2'],
      };

      vi.mocked(claudeService.analyzeTrendFromAI).mockResolvedValue(mockReport);

      const request = new NextRequest('http://localhost:3000/api/analyze-trend', {
        method: 'POST',
        body: JSON.stringify({ trend: 'Autonomous Flying Cars' }),
      });

      const response = await analyzeTrendPOST(request);
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.analysis.maturityStage).toBe('Growth');
      expect(json.analysis.estimatedTAM).toBe('$10 Billion');
      expect(json.analysis.catalysts).toContain('Catalyst A');
      expect(json.cached).toBe(false);
    });
  });

  describe('Multi-trend Convergence in POST /api/discover', () => {
    it('should find intersecting tickers, set convergence scores, and merge rationales', async () => {
      // Mock discovery for Trend 1
      vi.mocked(claudeService.discoverCompaniesFromAI)
        .mockImplementationOnce(async () => {
          return [
            { ticker: 'AAPL', companyName: 'Apple Inc.', rationale: 'Fits trend 1', relevanceScore: 8 },
            { ticker: 'MSFT', companyName: 'Microsoft Corp.', rationale: 'Fits trend 1 only', relevanceScore: 7 },
          ];
        })
        // Mock discovery for Trend 2
        .mockImplementationOnce(async () => {
          return [
            { ticker: 'AAPL', companyName: 'Apple Inc.', rationale: 'Fits trend 2', relevanceScore: 10 },
            { ticker: 'NVDA', companyName: 'NVIDIA Corp.', rationale: 'Fits trend 2 only', relevanceScore: 9 },
          ];
        });

      vi.mocked(tickerValidator.validateTickers).mockResolvedValue({
        valid: ['AAPL', 'MSFT', 'NVDA'],
        invalid: [],
        bypassed: false,
      });

      const request = new NextRequest('http://localhost:3000/api/discover', {
        method: 'POST',
        body: JSON.stringify({
          trends: ['Trend One', 'Trend Two'],
          filters: { exchange: [], marketCap: [] },
        }),
      });

      const response = await discoverPOST(request);
      expect(response.status).toBe(200);

      const json = await response.json();
      const companies = json.companies as ScoredCompanyData[];

      // AAPL appears in both trends, so its convergenceScore should be 2/2 = 1.0
      const aapl = companies.find((c) => c.ticker === 'AAPL');
      expect(aapl).toBeDefined();
      expect(aapl?.convergenceScore).toBe(1.0);
      expect(aapl?.trendsMatched).toContain('Trend One');
      expect(aapl?.trendsMatched).toContain('Trend Two');
      expect(aapl?.rationales['Trend One']).toBe('Fits trend 1');
      expect(aapl?.rationales['Trend Two']).toBe('Fits trend 2');
      // Relevance score averaged: (8 + 10) / 2 = 9
      expect(aapl?.relevanceScore).toBe(9);

      // MSFT appears in only 1 trend, convergenceScore should be 1/2 = 0.5
      const msft = companies.find((c) => c.ticker === 'MSFT');
      expect(msft).toBeDefined();
      expect(msft?.convergenceScore).toBe(0.5);
      expect(msft?.trendsMatched).toContain('Trend One');
      expect(msft?.trendsMatched).not.toContain('Trend Two');

      // The sorted output should list AAPL first (higher convergence score)
      expect(companies[0].ticker).toBe('AAPL');
      // Both theses ran, so the browser keeps convergence in the score (D2)
      expect(json.thesesRun).toBe(2);
    });
  });

  describe('Single-thesis run in POST /api/discover (decision D2)', () => {
    it('reports thesesRun = 1 so the browser leaves convergence out of the score', async () => {
      vi.mocked(claudeService.discoverCompaniesFromAI).mockResolvedValueOnce([
        { ticker: 'IONQ', companyName: 'IonQ', rationale: 'Quantum', relevanceScore: 8 },
      ]);
      vi.mocked(tickerValidator.validateTickers).mockResolvedValue({ valid: ['IONQ'], invalid: [], bypassed: false });
      const response = await discoverPOST(
        new NextRequest('http://localhost:3000/api/discover', {
          method: 'POST',
          body: JSON.stringify({ trends: ['Quantum computing'], filters: { exchange: [], marketCap: [] } }),
        })
      );
      const json = await response.json();
      expect(json.thesesRun).toBe(1);
      expect(json.companies[0].convergenceScore).toBe(1); // still reported, just not scored
    });
  });

  describe('Partial thesis failure in POST /api/discover (bug B4)', () => {
    it('reports the failed thesis and computes convergence over the theses that succeeded', async () => {
      vi.mocked(claudeService.discoverCompaniesFromAI)
        .mockImplementationOnce(async () => [
          { ticker: 'AAPL', companyName: 'Apple Inc.', rationale: 'Fits 1', relevanceScore: 8 },
        ])
        .mockImplementationOnce(async () => [
          { ticker: 'AAPL', companyName: 'Apple Inc.', rationale: 'Fits 2', relevanceScore: 8 },
          { ticker: 'MSFT', companyName: 'Microsoft Corp.', rationale: 'Fits 2 only', relevanceScore: 7 },
        ])
        .mockImplementationOnce(async () => {
          throw new Error('Claude overloaded');
        });
      vi.mocked(tickerValidator.validateTickers).mockResolvedValue({ valid: ['AAPL', 'MSFT'], invalid: [], bypassed: false });

      const response = await discoverPOST(
        new NextRequest('http://localhost:3000/api/discover', {
          method: 'POST',
          body: JSON.stringify({ trends: ['One', 'Two', 'Three'], filters: { exchange: [], marketCap: [] } }),
        })
      );
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.failedTrends).toEqual(['Three']);
      const companies = json.companies as ScoredCompanyData[];
      // AAPL matched both theses that ran: 2 of 2, not 2 of 3
      expect(companies.find((c) => c.ticker === 'AAPL')?.convergenceScore).toBe(1);
      expect(companies.find((c) => c.ticker === 'MSFT')?.convergenceScore).toBe(0.5);
      // thesesRun counts only the theses that succeeded
      expect(json.thesesRun).toBe(2);
    });

    it('returns an empty failedTrends list when every thesis succeeds', async () => {
      vi.mocked(claudeService.discoverCompaniesFromAI).mockResolvedValue([
        { ticker: 'AAPL', companyName: 'Apple Inc.', rationale: 'Fits', relevanceScore: 8 },
      ]);
      vi.mocked(tickerValidator.validateTickers).mockResolvedValue({ valid: ['AAPL'], invalid: [], bypassed: false });
      const response = await discoverPOST(
        new NextRequest('http://localhost:3000/api/discover', {
          method: 'POST',
          body: JSON.stringify({ trends: ['One', 'Two'], filters: { exchange: [], marketCap: [] } }),
        })
      );
      const json = await response.json();
      expect(json.failedTrends).toEqual([]);
      expect(json.thesesRun).toBe(2);
    });

    it('fails the request with a clear error naming the theses when all of them fail', async () => {
      vi.mocked(claudeService.discoverCompaniesFromAI).mockRejectedValue(new Error('down'));
      const response = await discoverPOST(
        new NextRequest('http://localhost:3000/api/discover', {
          method: 'POST',
          body: JSON.stringify({ trends: ['One', 'Two'], filters: { exchange: [], marketCap: [] } }),
        })
      );
      expect(response.status).toBe(502);
      const json = await response.json();
      expect(json.error).toContain('"One"');
      expect(json.error).toContain('"Two"');
      expect(json.failedTrends).toEqual(['One', 'Two']);
    });
  });
  // Composite scoring tests live in scoring.test.ts (Phase C rewrite).
});

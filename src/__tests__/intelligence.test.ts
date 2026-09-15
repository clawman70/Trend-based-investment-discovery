import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as analyzeTrendPOST } from '../app/api/analyze-trend/route';
import { POST as discoverPOST } from '../app/api/discover/route';
import { POST as scorePOST } from '../app/api/score/route';
import * as claudeService from '../lib/claudeService';
import * as tickerValidator from '../lib/tickerValidator';
import { calculateCompanyScores } from '../lib/scoring';
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
    });
  });

  describe('Composite Scoring (calculateCompanyScores)', () => {
    const mockCompanies: ScoredCompanyData[] = [
      {
        ticker: 'GROW',
        companyName: 'Growth Play',
        rationale: 'R1',
        relevanceScore: 10,
        trendsMatched: ['T1', 'T2'],
        convergenceScore: 1.0,
        rationales: {},
        stockPrice: 100,
        marketCap: 5000000000,
        growth1Y: 50,
        growth5Y: 60,
        exchange: 'NASDAQ',
        peRatio: 40, // High PE
        dataQuality: {
          priceSource: 'live',
          growthSource: 'calculated',
        },
        compositeScore: 0,
      },
      {
        ticker: 'VALU',
        companyName: 'Value Play',
        rationale: 'R2',
        relevanceScore: 7,
        trendsMatched: ['T1'],
        convergenceScore: 0.5,
        rationales: {},
        stockPrice: 20,
        marketCap: 1000000000,
        growth1Y: 5,
        growth5Y: 10,
        exchange: 'NYSE',
        peRatio: 12, // Low PE (great valuation)
        dataQuality: {
          priceSource: 'live',
          growthSource: 'calculated',
        },
        compositeScore: 0,
      },
    ];

    it('should adjust composite scores when changing weights', () => {
      // Growth-heavy weights
      const growthWeights = { relevance: 10, convergence: 10, growth: 70, valuation: 5, health: 5 };
      const growthScored = calculateCompanyScores(mockCompanies, growthWeights);

      // Value-heavy weights
      const valueWeights = { relevance: 10, convergence: 10, growth: 5, valuation: 70, health: 5 };
      const valueScored = calculateCompanyScores(mockCompanies, valueWeights);

      const growthGrowScore = growthScored.find((c) => c.ticker === 'GROW')?.compositeScore || 0;
      const growthValuScore = growthScored.find((c) => c.ticker === 'VALU')?.compositeScore || 0;

      const valueGrowScore = valueScored.find((c) => c.ticker === 'GROW')?.compositeScore || 0;
      const valueValuScore = valueScored.find((c) => c.ticker === 'VALU')?.compositeScore || 0;

      // GROW has 50%/60% growth vs VALU's 5%/10%.
      // In growth-heavy scoring, GROW should score higher than VALU.
      expect(growthGrowScore).toBeGreaterThan(growthValuScore);

      // VALU has a PE of 12 (valuationScore = 10) vs GROW's 40 (valuationScore = 6).
      // In valuation-heavy scoring, VALU's score relative standing should increase significantly.
      expect(valueValuScore).toBeGreaterThan(valueGrowScore);
    });

    it('should support the POST /api/score endpoint', async () => {
      const request = new NextRequest('http://localhost:3000/api/score', {
        method: 'POST',
        body: JSON.stringify({
          companies: mockCompanies,
          weights: { relevance: 20, convergence: 20, growth: 20, valuation: 20, health: 20 },
        }),
      });

      const response = await scorePOST(request);
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.length).toBe(2);
      expect(json[0].compositeScore).toBeGreaterThan(0);
    });

    it('health score no longer rewards "data loaded" over real debt-to-equity (Phase 3 reweight)', () => {
      const healthOnlyWeights = { relevance: 0, convergence: 0, valuation: 0, health: 100 };
      const base: ScoredCompanyData = {
        ...mockCompanies[0],
        ticker: 'DTE1',
        debtToEquity: 0.5,
        dataQuality: { priceSource: 'live', growthSource: 'calculated' },
      };
      // Same debt-to-equity, but price data failed to load for this one.
      const sameDebtNoPrice: ScoredCompanyData = {
        ...base,
        ticker: 'DTE2',
        dataQuality: { priceSource: 'unavailable' },
      };

      const scored = calculateCompanyScores([base, sameDebtNoPrice], healthOnlyWeights);
      const a = scored.find((c) => c.ticker === 'DTE1')!.compositeScore;
      const b = scored.find((c) => c.ticker === 'DTE2')!.compositeScore;

      // Identical real debt-to-equity should score identically regardless of whether
      // the price happened to load — that's exactly what "removing data quality from
      // the health factor" means.
      expect(a).toBe(b);
    });
  });
});

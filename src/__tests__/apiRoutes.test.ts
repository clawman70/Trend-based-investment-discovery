import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as validateTickerGET } from '../app/api/validate-ticker/route';
import { POST as discoverPOST } from '../app/api/discover/route';
import { POST as enrichPOST } from '../app/api/enrich/route';
import { GET as companyDetailsGET } from '../app/api/company-details/route';
import { GET as newsGET } from '../app/api/news/route';
import { GET as peersGET } from '../app/api/peers/route';
import * as tickerValidator from '../lib/tickerValidator';
import * as geminiService from '../lib/geminiService';

// Mock dependecies
vi.mock('../lib/tickerValidator', () => ({
  validateTickers: vi.fn(),
}));

vi.mock('../lib/geminiService', () => ({
  discoverCompaniesFromAI: vi.fn(),
}));

vi.mock('../lib/dbHelper', () => ({
  getCachedData: vi.fn().mockResolvedValue(null),
  setCachedData: vi.fn(),
}));

describe('API Route Handlers', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.FMP_API_KEY = 'TEST_KEY';
    process.env.GOOGLE_GENAI_API_KEY = 'TEST_KEY';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /api/validate-ticker', () => {
    it('should return 400 if symbol param is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/validate-ticker');
      const response = await validateTickerGET(request);
      
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toContain('Missing symbol');
    });

    it('should validate single ticker', async () => {
      vi.mocked(tickerValidator.validateTickers).mockResolvedValue({
        valid: ['AAPL'],
        invalid: [],
        bypassed: false
      });

      const request = new NextRequest('http://localhost:3000/api/validate-ticker?symbol=AAPL');
      const response = await validateTickerGET(request);
      
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.symbol).toBe('AAPL');
      expect(json.valid).toBe(true);
    });
  });

  describe('POST /api/discover', () => {
    it('should return discovered companies and drop invalid tickers', async () => {
      vi.mocked(geminiService.discoverCompaniesFromAI).mockResolvedValue([
        { ticker: 'AAPL', companyName: 'Apple Inc.', rationale: 'Direct' },
        { ticker: 'XYZ_FAKE', companyName: 'Fake Corp', rationale: 'Adjacent' }
      ]);

      vi.mocked(tickerValidator.validateTickers).mockResolvedValue({
        valid: ['AAPL'],
        invalid: ['XYZ_FAKE'],
        bypassed: false
      });

      const request = new NextRequest('http://localhost:3000/api/discover', {
        method: 'POST',
        body: JSON.stringify({
          trend: 'Edge AI',
          filters: { exchange: [], marketCap: [] }
        })
      });

      const response = await discoverPOST(request);
      expect(response.status).toBe(200);
      
      const json = await response.json();
      expect(json.companies.length).toBe(1);
      expect(json.companies[0].ticker).toBe('AAPL');
      expect(json.invalidTickers).toContain('XYZ_FAKE');
    });
  });

  describe('POST /api/enrich', () => {
    it('should enrich tickers and apply data quality flags', async () => {
      // Mock quote endpoint
      const mockQuoteResponse = [
        { symbol: 'AAPL', price: 150.0, marketCap: 2500000000000, exchange: 'Nasdaq Global Select' }
      ];
      // Mock history endpoint
      const mockHistoryResponse = {
        symbol: 'AAPL',
        historical: [
          { date: '2026-05-19', close: 150.0 },
          { date: '2025-05-19', close: 100.0 }, // 1Y Ago
          { date: '2021-05-19', close: 50.0 }   // 5Y Ago
        ]
      };

      vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('/quote/')) {
          return { ok: true, json: async () => mockQuoteResponse } as Response;
        } else if (urlStr.includes('/historical-price-full/')) {
          return { ok: true, json: async () => mockHistoryResponse } as Response;
        }
        return { ok: false } as Response;
      });

      const request = new NextRequest('http://localhost:3000/api/enrich', {
        method: 'POST',
        body: JSON.stringify({ tickers: ['AAPL'] })
      });

      const response = await enrichPOST(request);
      expect(response.status).toBe(200);
      
      const json = await response.json();
      expect(json.length).toBe(1);
      expect(json[0].ticker).toBe('AAPL');
      expect(json[0].stockPrice).toBe(150.0);
      expect(json[0].growth1Y).toBeCloseTo(50.0); // ((150-100)/100)*100
      expect(json[0].growth5Y).toBeCloseTo(200.0); // ((150-50)/50)*100
      expect(json[0].dataQuality.priceSource).toBe('live');
      expect(json[0].dataQuality.growthSource).toBe('calculated');
    });
  });

  describe('GET /api/company-details', () => {
    it('should return 400 if ticker param is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/company-details');
      const response = await companyDetailsGET(request);
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toContain('Ticker symbol is required');
    });

    it('should return mock details if offline/placeholder', async () => {
      process.env.FMP_API_KEY = 'PLACEHOLDER_API_KEY';
      const request = new NextRequest('http://localhost:3000/api/company-details?ticker=AAPL');
      const response = await companyDetailsGET(request);
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.ticker).toBe('AAPL');
      expect(json.companyName).toBe('AAPL Corp');
    });
  });

  describe('GET /api/news', () => {
    it('should return 400 if ticker param is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/news');
      const response = await newsGET(request);
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toContain('Ticker symbol is required');
    });

    it('should return mock news and sentiment if offline/placeholder', async () => {
      process.env.FMP_API_KEY = 'PLACEHOLDER_API_KEY';
      const request = new NextRequest('http://localhost:3000/api/news?ticker=AAPL');
      const response = await newsGET(request);
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.news).toBeDefined();
      expect(json.sentiment).toBeDefined();
      expect(json.sentiment.sentiment).toBe('Bullish');
    });
  });

  describe('GET /api/peers', () => {
    it('should return 400 if ticker param is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/peers');
      const response = await peersGET(request);
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toContain('Ticker symbol is required');
    });

    it('should return mock peers if offline/placeholder', async () => {
      process.env.FMP_API_KEY = 'PLACEHOLDER_API_KEY';
      const request = new NextRequest('http://localhost:3000/api/peers?ticker=AAPL');
      const response = await peersGET(request);
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.length).toBeGreaterThan(0);
      expect(json[0].symbol).toContain('AAPL');
    });
  });
});

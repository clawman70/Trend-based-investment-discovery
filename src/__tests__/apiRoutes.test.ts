import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as validateTickerGET } from '../app/api/validate-ticker/route';
import { POST as discoverPOST } from '../app/api/discover/route';
import { POST as enrichPOST } from '../app/api/enrich/route';
import { GET as companyDetailsGET } from '../app/api/company-details/route';
import { GET as newsGET } from '../app/api/news/route';
import { GET as peersGET } from '../app/api/peers/route';
import * as tickerValidator from '../lib/tickerValidator';
import * as claudeService from '../lib/claudeService';
import * as finnhubService from '../lib/finnhubService';
import * as yahooService from '../lib/yahooService';
import type { FinnhubQuote, FinnhubNewsItem } from '../lib/finnhubService';

// Keep pure helpers (normalizeTicker, normalizeMetrics, isFinnhubConfigured) real; mock all network calls
vi.mock('../lib/tickerValidator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/tickerValidator')>();
  return { ...actual, validateTickers: vi.fn(), getListing: vi.fn() };
});

vi.mock('../lib/finnhubService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/finnhubService')>();
  return {
    ...actual,
    fetchQuote: vi.fn(),
    fetchMetrics: vi.fn(),
    fetchProfile: vi.fn(),
    fetchCompanyNews: vi.fn(),
    fetchPeers: vi.fn(),
  };
});

vi.mock('../lib/yahooService', () => ({
  fetchPriceGrowth: vi.fn(),
  fetchCompanyProfile: vi.fn(),
}));

vi.mock('../lib/claudeService', () => ({
  discoverCompaniesFromAI: vi.fn(),
  analyzeNewsSentimentFromAI: vi.fn(),
  getValueChainPositionFromAI: vi.fn(),
}));

vi.mock('../lib/dbHelper', () => ({
  getCachedData: vi.fn(),
  setCachedData: vi.fn(),
}));

const quote = (price: number) => ({ c: price, d: 0, dp: 0, h: price, l: price, o: price, pc: price, t: 0 }) as FinnhubQuote;

describe('API Route Handlers', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.FINNHUB_API_KEY = 'TEST_KEY';
    process.env.ANTHROPIC_API_KEY = 'TEST_KEY';
    delete process.env.DEMO_MODE;
  });

  afterEach(() => {
    delete process.env.DEMO_MODE;
  });

  describe('GET /api/validate-ticker', () => {
    it('should return 400 if symbol param is missing', async () => {
      const response = await validateTickerGET(new NextRequest('http://localhost:3000/api/validate-ticker'));
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toContain('Missing symbol');
    });

    it('should validate single ticker', async () => {
      vi.mocked(tickerValidator.validateTickers).mockResolvedValue({ valid: ['AAPL'], invalid: [], bypassed: false });

      const response = await validateTickerGET(new NextRequest('http://localhost:3000/api/validate-ticker?symbol=AAPL'));
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.symbol).toBe('AAPL');
      expect(json.valid).toBe(true);
    });
  });

  describe('POST /api/discover', () => {
    const discover = (trend: string) =>
      discoverPOST(
        new NextRequest('http://localhost:3000/api/discover', {
          method: 'POST',
          body: JSON.stringify({ trend, filters: { exchange: [], marketCap: [] } }),
        })
      );

    it('should return discovered companies and drop invalid tickers', async () => {
      vi.mocked(claudeService.discoverCompaniesFromAI).mockResolvedValue([
        { ticker: 'AAPL', companyName: 'Apple Inc.', rationale: 'Direct', relevanceScore: 8 },
        { ticker: 'XYZ_FAKE', companyName: 'Fake Corp', rationale: 'Adjacent', relevanceScore: 5 },
      ]);
      vi.mocked(tickerValidator.validateTickers).mockResolvedValue({
        valid: ['AAPL'],
        invalid: ['XYZ_FAKE'],
        bypassed: false,
      });

      const response = await discover('Edge AI');
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.companies.length).toBe(1);
      expect(json.companies[0].ticker).toBe('AAPL');
      expect(json.companies[0].exchange).toBeNull();
      expect(json.invalidTickers).toContain('XYZ_FAKE');
    });

    it('should normalize share-class tickers so they match the validator (BRK-B -> BRK.B)', async () => {
      vi.mocked(claudeService.discoverCompaniesFromAI).mockResolvedValue([
        { ticker: 'brk-b', companyName: 'Berkshire Hathaway', rationale: 'Adjacent', relevanceScore: 6 },
      ]);
      vi.mocked(tickerValidator.validateTickers).mockResolvedValue({ valid: ['BRK.B'], invalid: [], bypassed: false });

      const json = await (await discover('Insurance float')).json();
      expect(json.companies.map((c: { ticker: string }) => c.ticker)).toEqual(['BRK.B']);
    });

    it('should report when validation was bypassed', async () => {
      vi.mocked(claudeService.discoverCompaniesFromAI).mockResolvedValue([
        { ticker: 'AAPL', companyName: 'Apple Inc.', rationale: 'Direct', relevanceScore: 8 },
      ]);
      vi.mocked(tickerValidator.validateTickers).mockResolvedValue({ valid: ['AAPL'], invalid: [], bypassed: true });

      const json = await (await discover('Edge AI')).json();
      expect(json.validationMetrics.validationBypassed).toBe(true);
    });
  });

  describe('POST /api/enrich', () => {
    const enrich = (tickers: string[]) =>
      enrichPOST(
        new NextRequest('http://localhost:3000/api/enrich', { method: 'POST', body: JSON.stringify({ tickers }) })
      );

    it('should return 503 when FINNHUB_API_KEY is missing', async () => {
      delete process.env.FINNHUB_API_KEY;
      const response = await enrich(['AAPL']);
      expect(response.status).toBe(503);
      expect((await response.json()).error).toContain('FINNHUB_API_KEY');
    });

    it('should merge live quote, fundamentals, growth and exchange', async () => {
      vi.mocked(finnhubService.fetchQuote).mockResolvedValue(quote(150));
      vi.mocked(finnhubService.fetchMetrics).mockResolvedValue({
        peTTM: 30,
        marketCapitalization: 2_500_000, // millions
        'totalDebt/totalEquityQuarterly': 1.2,
        '52WeekPriceReturnDaily': 40,
      });
      vi.mocked(yahooService.fetchPriceGrowth).mockResolvedValue({
        ticker: 'AAPL',
        growth1Y: 50,
        growth5Y: 200,
        growthSource: 'calculated',
      });
      vi.mocked(tickerValidator.getListing).mockResolvedValue({
        symbol: 'AAPL',
        name: 'APPLE INC',
        exchange: 'NASDAQ',
        type: 'Common Stock',
      });

      const response = await enrich(['aapl']);
      expect(response.status).toBe(200);

      const [row] = await response.json();
      expect(row.ticker).toBe('AAPL');
      expect(row.stockPrice).toBe(150);
      expect(row.marketCap).toBe(2_500_000_000_000);
      expect(row.peRatio).toBe(30);
      expect(row.debtToEquity).toBe(1.2);
      expect(row.growth1Y).toBe(50); // Yahoo history wins over Finnhub 52-week return
      expect(row.growth5Y).toBe(200);
      expect(row.exchange).toBe('NASDAQ');
      expect(row.dataQuality).toEqual({ priceSource: 'live', growthSource: 'calculated', fundamentalsSource: 'live' });
    });

    it('should mark everything unavailable (never zero-filled growth) when data is missing', async () => {
      vi.mocked(finnhubService.fetchQuote).mockResolvedValue(null);
      vi.mocked(finnhubService.fetchMetrics).mockResolvedValue(null);
      vi.mocked(tickerValidator.getListing).mockResolvedValue(null);

      const [row] = await (await enrich(['ZZZQ'])).json();
      expect(row.stockPrice).toBe(0);
      expect(row.marketCap).toBe(0);
      expect(row.peRatio).toBeNull();
      expect(row.growth1Y).toBeNull();
      expect(row.growth5Y).toBeNull();
      expect(row.exchange).toBeNull();
      expect(row.dataQuality).toEqual({ priceSource: 'unavailable', growthSource: 'unavailable', fundamentalsSource: 'unavailable' });
      expect(yahooService.fetchPriceGrowth).not.toHaveBeenCalled();
    });

    it('should fall back to Finnhub 52-week return when Yahoo history is unavailable', async () => {
      vi.mocked(finnhubService.fetchQuote).mockResolvedValue(quote(120));
      vi.mocked(finnhubService.fetchMetrics).mockResolvedValue({ '52WeekPriceReturnDaily': 12.5 });
      vi.mocked(yahooService.fetchPriceGrowth).mockResolvedValue({
        ticker: 'MSFT',
        growth1Y: null,
        growth5Y: null,
        growthSource: 'unavailable',
      });
      vi.mocked(tickerValidator.getListing).mockResolvedValue(null);

      const [row] = await (await enrich(['MSFT'])).json();
      expect(row.growth1Y).toBe(12.5);
      expect(row.growth5Y).toBeNull();
      expect(row.dataQuality.growthSource).toBe('calculated');
    });

    it('should survive a failing upstream call without inventing data', async () => {
      vi.mocked(finnhubService.fetchQuote).mockRejectedValue(new Error('network down'));
      vi.mocked(finnhubService.fetchMetrics).mockRejectedValue(new Error('network down'));
      vi.mocked(tickerValidator.getListing).mockResolvedValue(null);

      const response = await enrich(['NVDA']);
      expect(response.status).toBe(200);
      const [row] = await response.json();
      expect(row.dataQuality.priceSource).toBe('unavailable');
      expect(row.peRatio).toBeNull();
    });
  });

  describe('GET /api/company-details', () => {
    const details = (query: string) =>
      companyDetailsGET(new NextRequest(`http://localhost:3000/api/company-details${query}`));

    it('should return 400 if ticker param is missing', async () => {
      const response = await details('');
      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain('Ticker symbol is required');
    });

    it('should return 503 (not fake data) when FINNHUB_API_KEY is missing', async () => {
      delete process.env.FINNHUB_API_KEY;
      const response = await details('?ticker=AAPL');
      expect(response.status).toBe(503);
      const json = await response.json();
      expect(json.companyName).toBeUndefined();
    });

    it('should return clearly-labeled placeholder data only in DEMO_MODE', async () => {
      process.env.DEMO_MODE = 'true';
      const json = await (await details('?ticker=AAPL')).json();
      expect(json.isDemo).toBe(true);
      expect(json.companyName).toContain('DEMO');
    });

    it('should combine Finnhub and Yahoo data, leaving unknown fields null', async () => {
      vi.mocked(finnhubService.fetchProfile).mockResolvedValue({
        name: 'Apple Inc',
        finnhubIndustry: 'Technology',
        weburl: 'https://www.apple.com/',
        marketCapitalization: 4_000_000,
        logo: 'https://logo',
      });
      vi.mocked(finnhubService.fetchMetrics).mockResolvedValue({
        peTTM: 37.6,
        marketCapitalization: 4_800_000,
        revenueGrowthTTMYoy: 14.2,
        'totalDebt/totalEquityQuarterly': 0.78,
        pfcfShareTTM: 36,
      });
      vi.mocked(finnhubService.fetchQuote).mockResolvedValue(quote(330));
      vi.mocked(yahooService.fetchCompanyProfile).mockResolvedValue(null);
      vi.mocked(claudeService.getValueChainPositionFromAI).mockResolvedValue(null);

      const response = await details('?ticker=AAPL&trend=Edge%20AI');
      expect(response.status).toBe(200);
      const json = await response.json();

      expect(json.isDemo).toBe(false);
      expect(json.companyName).toBe('Apple Inc');
      expect(json.stockPrice).toBe(330);
      expect(json.marketCap).toBe(4_800_000_000_000);
      expect(json.peRatio).toBe(37.6);
      expect(json.yoyRevenueGrowth).toBe(14.2);
      expect(json.debtToEquity).toBe(0.78);
      expect(json.freeCashFlow).toBeCloseTo(4_800_000_000_000 / 36);
      expect(json.sector).toBe('Technology'); // Finnhub fallback when Yahoo is unavailable
      expect(json.website).toBe('https://www.apple.com/');
      expect(json.description).toBeNull();
      expect(json.ceo).toBeNull();
      expect(json.valueChainPosition).toBeNull();
    });

    it('should prefer Yahoo profile fields when available', async () => {
      vi.mocked(finnhubService.fetchProfile).mockResolvedValue({ name: 'Apple Inc', finnhubIndustry: 'Technology' });
      vi.mocked(finnhubService.fetchMetrics).mockResolvedValue(null);
      vi.mocked(finnhubService.fetchQuote).mockResolvedValue(quote(330));
      vi.mocked(yahooService.fetchCompanyProfile).mockResolvedValue({
        description: 'Apple designs smartphones.',
        sector: 'Technology',
        industry: 'Consumer Electronics',
        website: 'https://www.apple.com',
        ceo: 'Jane Doe',
      });

      const json = await (await details('?ticker=AAPL')).json();
      expect(json.description).toBe('Apple designs smartphones.');
      expect(json.industry).toBe('Consumer Electronics');
      expect(json.ceo).toBe('Jane Doe');
      expect(claudeService.getValueChainPositionFromAI).not.toHaveBeenCalled(); // no trend supplied
    });

    it('should return 404 when neither a profile nor a quote exists', async () => {
      vi.mocked(finnhubService.fetchProfile).mockResolvedValue(null);
      vi.mocked(finnhubService.fetchMetrics).mockResolvedValue(null);
      vi.mocked(finnhubService.fetchQuote).mockResolvedValue(null);
      vi.mocked(yahooService.fetchCompanyProfile).mockResolvedValue(null);

      const response = await details('?ticker=ZZZQ');
      expect(response.status).toBe(404);
    });
  });

  describe('GET /api/news', () => {
    const news = (query: string) => newsGET(new NextRequest(`http://localhost:3000/api/news${query}`));
    const article = (headline: string, datetime: number) =>
      ({ headline, datetime, url: `https://news/${datetime}`, source: 'Reuters', summary: 'Summary', category: 'company', id: datetime, image: '', related: 'AAPL' }) as FinnhubNewsItem;

    it('should return 400 if ticker param is missing', async () => {
      const response = await news('');
      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain('Ticker symbol is required');
    });

    it('should return 503 (not fake headlines) when FINNHUB_API_KEY is missing', async () => {
      delete process.env.FINNHUB_API_KEY;
      const response = await news('?ticker=AAPL');
      expect(response.status).toBe(503);
    });

    it('should return real headlines newest-first with AI sentiment', async () => {
      vi.mocked(finnhubService.fetchCompanyNews).mockResolvedValue([article('Older', 1000), article('Newer', 2000)]);
      vi.mocked(claudeService.analyzeNewsSentimentFromAI).mockResolvedValue({
        sentiment: 'Bullish',
        sentimentScore: 0.6,
        summary: 'Positive momentum.',
      });

      const json = await (await news('?ticker=AAPL')).json();
      expect(json.isDemo).toBe(false);
      expect(json.news.map((n: { title: string }) => n.title)).toEqual(['Newer', 'Older']);
      expect(json.news[0].publishedDate).toBe(new Date(2000 * 1000).toISOString());
      expect(json.sentiment.sentiment).toBe('Bullish');
    });

    it('should return sentiment null (not a made-up verdict) when AI sentiment is unavailable', async () => {
      vi.mocked(finnhubService.fetchCompanyNews).mockResolvedValue([article('Headline', 1000)]);
      vi.mocked(claudeService.analyzeNewsSentimentFromAI).mockResolvedValue(null);

      const json = await (await news('?ticker=AAPL')).json();
      expect(json.news.length).toBe(1);
      expect(json.sentiment).toBeNull();
    });
  });

  describe('GET /api/peers', () => {
    const peers = (query: string) => peersGET(new NextRequest(`http://localhost:3000/api/peers${query}`));

    it('should return 400 if ticker param is missing', async () => {
      const response = await peers('');
      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain('Ticker symbol is required');
    });

    it('should return an empty list (not mock peers) when FINNHUB_API_KEY is missing', async () => {
      delete process.env.FINNHUB_API_KEY;
      const response = await peers('?ticker=AAPL');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([]);
    });

    it('should return real peers with names, excluding the anchor ticker, sorted by market cap', async () => {
      vi.mocked(finnhubService.fetchPeers).mockResolvedValue(['AAPL', 'HPQ', 'DELL']);
      vi.mocked(finnhubService.fetchQuote).mockImplementation(async (s) => quote(s === 'DELL' ? 110 : 30));
      vi.mocked(finnhubService.fetchMetrics).mockImplementation(async (s) =>
        s === 'DELL' ? { marketCapitalization: 80_000, peTTM: 18 } : { marketCapitalization: 30_000, peTTM: 10 }
      );
      vi.mocked(tickerValidator.getListing).mockImplementation(async (s) => ({
        symbol: s,
        name: s === 'DELL' ? 'DELL TECHNOLOGIES' : 'HP INC',
        exchange: 'NYSE',
        type: 'Common Stock',
      }));

      const json = await (await peers('?ticker=AAPL')).json();
      expect(json.map((p: { ticker: string }) => p.ticker)).toEqual(['DELL', 'HPQ']);
      expect(json[0]).toEqual({
        ticker: 'DELL',
        companyName: 'DELL TECHNOLOGIES',
        stockPrice: 110,
        marketCap: 80_000_000_000,
        peRatio: 18,
      });
    });
  });
});

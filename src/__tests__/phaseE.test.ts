/**
 * Phase E: status endpoint, discovery refresh + cache age, research refresh, input limits.
 * Every external API is mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('../lib/dbHelper', () => ({
  getCachedData: vi.fn(),
  setCachedData: vi.fn(),
  getStorageStatus: vi.fn(),
  isDbAvailable: vi.fn(),
}));
vi.mock('../lib/claudeService', () => ({
  discoverCompaniesFromAI: vi.fn(),
  analyzeTrendFromAI: vi.fn(),
  isClaudeConfigured: vi.fn(),
}));
vi.mock('../lib/geminiService', () => ({
  generateTrendResearchReport: vi.fn(),
  isGeminiConfigured: vi.fn(),
}));
vi.mock('../lib/tickerValidator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/tickerValidator')>();
  return { ...actual, validateTickers: vi.fn(), getListing: vi.fn(), peekListingDirectorySize: vi.fn() };
});
vi.mock('../lib/usageTracker', () => ({ getTodaysSpend: vi.fn(), getDailySpendCapUsd: vi.fn(() => 5) }));
vi.mock('../lib/stores/researchStore', () => ({ findCachedScan: vi.fn(), createScan: vi.fn() }));
vi.mock('../lib/researchVerification', () => ({ verifyMentionedCompanies: vi.fn(async (c: unknown) => c) }));

import { GET as statusGET } from '../app/api/status/route';
import { POST as discoverPOST } from '../app/api/discover/route';
import { POST as enrichPOST } from '../app/api/enrich/route';
import { POST as analyzePOST } from '../app/api/analyze-trend/route';
import { POST as researchPOST } from '../app/api/research/route';
import * as dbHelper from '../lib/dbHelper';
import * as claudeService from '../lib/claudeService';
import * as geminiService from '../lib/geminiService';
import * as tickerValidator from '../lib/tickerValidator';
import * as usageTracker from '../lib/usageTracker';
import * as researchStore from '../lib/stores/researchStore';
import { checkThesisLimits, MAX_THESIS_CHARS } from '../lib/inputLimits';
import { describeCacheAge, formatElapsed } from '../lib/cacheAge';

const post = (url: string, body: unknown) => new NextRequest(`http://localhost:3000${url}`, { method: 'POST', body: JSON.stringify(body) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(usageTracker.getDailySpendCapUsd).mockReturnValue(5);
  vi.mocked(tickerValidator.validateTickers).mockImplementation(async (t: string[]) => ({ valid: t, invalid: [], bypassed: false }));
  process.env.FINNHUB_API_KEY = 'TEST_KEY';
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('GET /api/status', () => {
  it('reports Postgres, configured keys, a loaded directory and today\'s spend', async () => {
    vi.mocked(dbHelper.getStorageStatus).mockResolvedValue({ mode: 'postgres', reason: null });
    vi.mocked(claudeService.isClaudeConfigured).mockReturnValue(true);
    vi.mocked(geminiService.isGeminiConfigured).mockReturnValue(true);
    vi.mocked(tickerValidator.peekListingDirectorySize).mockResolvedValue(28412);
    vi.mocked(usageTracker.getTodaysSpend).mockResolvedValue(0.42);

    const json = await (await statusGET()).json();
    expect(json.storage).toEqual({ mode: 'postgres', reason: null });
    expect(json.keys).toEqual({ anthropic: true, gemini: true, finnhub: true });
    expect(json.tickerDirectory).toEqual({ loaded: true, symbolCount: 28412 });
    expect(json.spend).toEqual({ spentUsd: 0.42, capUsd: 5 });
  });

  it('reports memory mode, a missing key and an unloaded directory honestly', async () => {
    vi.mocked(dbHelper.getStorageStatus).mockResolvedValue({ mode: 'memory', reason: 'unreachable' });
    vi.mocked(claudeService.isClaudeConfigured).mockReturnValue(true);
    vi.mocked(geminiService.isGeminiConfigured).mockReturnValue(false);
    vi.mocked(tickerValidator.peekListingDirectorySize).mockResolvedValue(null);
    vi.mocked(usageTracker.getTodaysSpend).mockRejectedValue(new Error('boom'));

    const json = await (await statusGET()).json();
    expect(json.storage).toEqual({ mode: 'memory', reason: 'unreachable' });
    expect(json.keys.gemini).toBe(false);
    expect(json.tickerDirectory).toEqual({ loaded: false, symbolCount: null });
    expect(json.spend.spentUsd).toBeNull(); // N/A, never a guessed 0
  });

  it('never leaks the key values', async () => {
    vi.mocked(dbHelper.getStorageStatus).mockResolvedValue({ mode: 'postgres', reason: null });
    vi.mocked(claudeService.isClaudeConfigured).mockReturnValue(true);
    vi.mocked(geminiService.isGeminiConfigured).mockReturnValue(true);
    const text = await (await statusGET()).text();
    expect(text).not.toContain('TEST_KEY');
  });
});

describe('POST /api/discover — refresh and cache age', () => {
  const companies = [{ ticker: 'QS', companyName: 'QuantumScape', rationale: 'Solid-state', relevanceScore: 8 }];

  it('serves a cached result and reports when it was cached', async () => {
    vi.mocked(dbHelper.getCachedData).mockResolvedValue({ companies, cachedAt: '2026-11-14T10:00:00.000Z' });
    const json = await (await discoverPOST(post('/api/discover', { trends: ['batteries'] }))).json();
    expect(claudeService.discoverCompaniesFromAI).not.toHaveBeenCalled();
    expect(json.cache).toEqual([{ trend: 'batteries', fromCache: true, cachedAt: '2026-11-14T10:00:00.000Z' }]);
    expect(json.companies).toHaveLength(1);
  });

  it('says the age is unknown for an entry saved before Phase E', async () => {
    vi.mocked(dbHelper.getCachedData).mockResolvedValue({ companies });
    const json = await (await discoverPOST(post('/api/discover', { trends: ['batteries'] }))).json();
    expect(json.cache[0]).toEqual({ trend: 'batteries', fromCache: true, cachedAt: null });
  });

  it('forceRefresh skips the cache, runs the AI and overwrites the entry with a timestamp', async () => {
    vi.mocked(dbHelper.getCachedData).mockResolvedValue({ companies: [], cachedAt: '2026-11-01T00:00:00.000Z' });
    vi.mocked(claudeService.discoverCompaniesFromAI).mockResolvedValue(companies);

    const json = await (await discoverPOST(post('/api/discover', { trends: ['batteries'], forceRefresh: true }))).json();
    expect(dbHelper.getCachedData).not.toHaveBeenCalled();
    expect(claudeService.discoverCompaniesFromAI).toHaveBeenCalledTimes(1);
    expect(json.cache[0].fromCache).toBe(false);
    const [, type, payload] = vi.mocked(dbHelper.setCachedData).mock.calls[0];
    expect(type).toBe('discovery');
    expect(payload).toMatchObject({ companies, cachedAt: json.cache[0].cachedAt });
  });
});

describe('Input limits', () => {
  it('rejects more than 3 theses with a 400 and a clear message', async () => {
    const res = await discoverPOST(post('/api/discover', { trends: ['a', 'b', 'c', 'd'] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/limit is 3/);
    expect(claudeService.discoverCompaniesFromAI).not.toHaveBeenCalled();
  });

  it('ignores blank thesis boxes when counting', () => {
    expect(checkThesisLimits(['a', '', '  ', 'b', 'c'])).toBeNull();
  });

  it('rejects a thesis over 500 characters on discover and analyze-trend', async () => {
    const long = 'x'.repeat(MAX_THESIS_CHARS + 1);
    const d = await discoverPOST(post('/api/discover', { trends: ['ok', long] }));
    expect(d.status).toBe(400);
    expect((await d.json()).error).toMatch(/Thesis 2 is 501 characters; the limit is 500/);

    const a = await analyzePOST(post('/api/analyze-trend', { trend: long }));
    expect(a.status).toBe(400);
    expect(claudeService.analyzeTrendFromAI).not.toHaveBeenCalled();
  });

  it('accepts a thesis of exactly 500 characters', () => {
    expect(checkThesisLimits(['x'.repeat(MAX_THESIS_CHARS)])).toBeNull();
  });

  it('rejects non-text theses', async () => {
    const res = await discoverPOST(post('/api/discover', { trends: [42] }));
    expect(res.status).toBe(400);
  });

  it('rejects more than 50 tickers per enrich call, counting duplicates once', async () => {
    const tickers = Array.from({ length: 51 }, (_, i) => `T${i}`);
    const res = await enrichPOST(post('/api/enrich', { tickers }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Too many tickers: 51 sent, the limit is 50 per request.');

    // 60 entries but only 50 distinct tickers: allowed past the limit check (then 503: Finnhub mocked as unconfigured)
    delete process.env.FINNHUB_API_KEY;
    const dupes = [...Array.from({ length: 50 }, (_, i) => `T${i}`), ...Array.from({ length: 10 }, () => 'T0')];
    expect((await enrichPOST(post('/api/enrich', { tickers: dupes }))).status).toBe(503);
  });
});

describe('POST /api/research — refresh', () => {
  const report = { companiesMentioned: [], isDemo: false };

  it('marks a cached scan with its age', async () => {
    vi.mocked(researchStore.findCachedScan).mockResolvedValue({
      id: 'scan1',
      createdAt: new Date('2026-11-15T09:00:00Z'),
      domains: ['A', 'B'],
      customPrompt: null,
      report: report as never,
      cachedUntil: new Date('2026-11-22T09:00:00Z'),
    });
    const json = await (await researchPOST(post('/api/research', { domains: ['A', 'B'] }))).json();
    expect(json).toMatchObject({ scanId: 'scan1', fromCache: true, cachedAt: '2026-11-15T09:00:00.000Z' });
  });

  it('forceRefresh skips the cache and runs a new scan', async () => {
    vi.mocked(geminiService.generateTrendResearchReport).mockResolvedValue(report as never);
    vi.mocked(researchStore.createScan).mockResolvedValue({ id: 'scan2' } as never);
    const json = await (await researchPOST(post('/api/research', { domains: ['A', 'B'], forceRefresh: true }))).json();
    expect(researchStore.findCachedScan).not.toHaveBeenCalled();
    expect(json).toMatchObject({ scanId: 'scan2', fromCache: false });
  });
});

describe('describeCacheAge / formatElapsed', () => {
  const now = new Date('2026-11-17T12:00:00Z');
  it('describes real ages in plain English', () => {
    expect(describeCacheAge('2026-11-17T11:30:00Z', now)).toBe('cached less than an hour ago');
    expect(describeCacheAge('2026-11-17T07:00:00Z', now)).toBe('cached 5 hours ago');
    expect(describeCacheAge('2026-11-16T11:00:00Z', now)).toBe('cached 1 day ago');
    expect(describeCacheAge('2026-11-13T12:00:00Z', now)).toBe('cached 4 days ago');
  });
  it('says unknown instead of guessing', () => {
    expect(describeCacheAge(null, now)).toBe('cached earlier (age unknown)');
    expect(describeCacheAge('garbage', now)).toBe('cached earlier (age unknown)');
  });
  it('formats elapsed time as m:ss', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(485_000)).toBe('8:05');
  });
});

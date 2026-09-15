import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as researchPOST } from '../app/api/research/route';
import { POST as loadPOST } from '../app/api/research/load/route';
import { memoryResearchScans, memoryResearchLoadedTheses } from '../lib/memoryStore';
import * as geminiService from '../lib/geminiService';

vi.mock('../lib/dbHelper', () => ({
  getCachedData: vi.fn().mockResolvedValue(null),
  setCachedData: vi.fn(),
}));

vi.mock('../lib/geminiService', () => ({
  generateTrendResearchReport: vi.fn(),
}));

const scan = (body: object) =>
  researchPOST(new NextRequest('http://localhost:3000/api/research', { method: 'POST', body: JSON.stringify(body) }));

describe('Phase 5 — Automated Research Engine Tests', () => {
  beforeEach(() => {
    memoryResearchScans.length = 0;
    memoryResearchLoadedTheses.length = 0;
    vi.mocked(geminiService.generateTrendResearchReport).mockReset();
    delete process.env.DEMO_MODE;
  });

  afterEach(() => {
    delete process.env.DEMO_MODE;
  });

  describe('Research Scan API (POST /api/research)', () => {
    it('should return a clearly-labeled placeholder report in DEMO_MODE', async () => {
      process.env.DEMO_MODE = 'true';

      const response = await scan({ domains: ['Artificial Intelligence', 'Robotics & Physical AI'], mode: 'guided', customPrompt: null });
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.scanId).toBeDefined();
      expect(json.isDemo).toBe(true);
      expect(json.executiveSummary).toContain('[DEMO]');
      expect(json.candidateTheses[0].thesisStatement).toContain('converging with');
      expect(geminiService.generateTrendResearchReport).not.toHaveBeenCalled();
      expect(memoryResearchScans.length).toBe(1);
    });

    it('should return 503 (not a mock report) when the Gemini key is not configured', async () => {
      vi.mocked(geminiService.generateTrendResearchReport).mockRejectedValue(
        new Error('GOOGLE_GENAI_API_KEY is not configured in .env.local')
      );

      const response = await scan({ domains: ['Energy & Power Systems'], mode: 'guided', customPrompt: null });
      expect(response.status).toBe(503);
      const json = await response.json();
      expect(json.error).toContain('not configured');
      expect(json.executiveSummary).toBeUndefined();
      expect(memoryResearchScans.length).toBe(0);
    });

    it('should return 502 (not a mock report) when the AI call fails', async () => {
      vi.mocked(geminiService.generateTrendResearchReport).mockRejectedValue(new Error('Gemini 500'));

      const response = await scan({ domains: ['Energy & Power Systems'], mode: 'guided', customPrompt: null });
      expect(response.status).toBe(502);
      expect(memoryResearchScans.length).toBe(0);
    });

    it('should load report from cache on second identical query', async () => {
      process.env.DEMO_MODE = 'true';
      const body = { domains: ['Artificial Intelligence', 'Energy & Power Systems'], mode: 'guided', customPrompt: null };

      await scan(body);
      expect(memoryResearchScans.length).toBe(1);
      const firstScanId = memoryResearchScans[0].id;

      const json2 = await (await scan(body)).json();
      expect(json2.scanId).toBe(firstScanId);
      expect(memoryResearchScans.length).toBe(1);
    });

    it('should generate report for open prompts', async () => {
      vi.mocked(geminiService.generateTrendResearchReport).mockResolvedValue({
        isDemo: false,
        executiveSummary: 'Real summary',
        scanDate: '2026-09-15',
        domainsScanned: [],
        candidateTheses: [],
        companiesMentioned: [],
        adjacentSignals: [],
      });

      const response = await scan({ domains: [], mode: 'open', customPrompt: 'Tell me about fusion energy compute systems' });
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.scanId).toBeDefined();
      expect(json.executiveSummary).toBe('Real summary');
      expect(memoryResearchScans[0].customPrompt).toBe('Tell me about fusion energy compute systems');
    });
  });

  describe('Loaded Theses Audit API (POST /api/research/load)', () => {
    it('should log when a thesis is loaded into discovery', async () => {
      const loadRequest = new NextRequest('http://localhost:3000/api/research/load', {
        method: 'POST',
        body: JSON.stringify({
          scanId: 'test-scan-uuid',
          thesis: 'Edge computing converging with drone swarms',
        }),
      });

      const response = await loadPOST(loadRequest);
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.success).toBe(true);

      expect(memoryResearchLoadedTheses.length).toBe(1);
      expect(memoryResearchLoadedTheses[0].scanId).toBe('test-scan-uuid');
      expect(memoryResearchLoadedTheses[0].thesis).toBe('Edge computing converging with drone swarms');
    });
  });
});

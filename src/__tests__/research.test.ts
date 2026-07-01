import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as researchPOST } from '../app/api/research/route';
import { POST as loadPOST } from '../app/api/research/load/route';
import { memoryResearchScans, memoryResearchLoadedTheses } from '../lib/memoryStore';

// Ensure database check returns false to force memory store fallback
vi.mock('../lib/dbHelper', () => ({
  isDbAvailable: vi.fn().mockResolvedValue(false),
  getCachedData: vi.fn().mockResolvedValue(null),
  setCachedData: vi.fn(),
}));

describe('Phase 5 — Automated Research Engine Tests', () => {
  beforeEach(() => {
    // Clear global memory stores
    memoryResearchScans.length = 0;
    memoryResearchLoadedTheses.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Research Scan API (POST /api/research)', () => {
    it('should generate a research report for guided domain scans', async () => {
      const request = new NextRequest('http://localhost:3000/api/research', {
        method: 'POST',
        body: JSON.stringify({
          domains: ['Artificial Intelligence', 'Robotics & Physical AI'],
          mode: 'guided',
          customPrompt: null
        }),
      });

      const response = await researchPOST(request);
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.scanId).toBeDefined();
      expect(json.executiveSummary).toContain('Offline Scan completed');
      expect(json.candidateTheses.length).toBeGreaterThan(0);
      expect(json.candidateTheses[0].thesisStatement).toContain('converging with');
      expect(json.companiesMentioned.length).toBeGreaterThan(0);

      // Verify stored in memory fallback
      expect(memoryResearchScans.length).toBe(1);
    });

    it('should load report from cache on second identical query', async () => {
      const domains = ['Artificial Intelligence', 'Energy & Power Systems'];

      const run1 = new NextRequest('http://localhost:3000/api/research', {
        method: 'POST',
        body: JSON.stringify({
          domains,
          mode: 'guided',
          customPrompt: null
        }),
      });
      await researchPOST(run1);
      expect(memoryResearchScans.length).toBe(1);
      const firstScanId = memoryResearchScans[0].id;

      // Run identical scan
      const run2 = new NextRequest('http://localhost:3000/api/research', {
        method: 'POST',
        body: JSON.stringify({
          domains,
          mode: 'guided',
          customPrompt: null
        }),
      });
      const response2 = await researchPOST(run2);
      const json2 = await response2.json();

      // Should return cached result with same scanId
      expect(json2.scanId).toBe(firstScanId);
      expect(memoryResearchScans.length).toBe(1);
    });

    it('should generate report for open prompts', async () => {
      const request = new NextRequest('http://localhost:3000/api/research', {
        method: 'POST',
        body: JSON.stringify({
          domains: [],
          mode: 'open',
          customPrompt: 'Tell me about fusion energy compute systems'
        }),
      });

      const response = await researchPOST(request);
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.scanId).toBeDefined();
      expect(memoryResearchScans.length).toBe(1);
      expect(memoryResearchScans[0].customPrompt).toBe('Tell me about fusion energy compute systems');
    });
  });

  describe('Loaded Theses Audit API (POST /api/research/load)', () => {
    it('should log when a thesis is loaded into discovery', async () => {
      const loadRequest = new NextRequest('http://localhost:3000/api/research/load', {
        method: 'POST',
        body: JSON.stringify({
          scanId: 'test-scan-uuid',
          thesis: 'Edge computing converging with drone swarms'
        }),
      });

      const response = await loadPOST(loadRequest);
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.success).toBe(true);

      // Verify stored in memory
      expect(memoryResearchLoadedTheses.length).toBe(1);
      expect(memoryResearchLoadedTheses[0].scanId).toBe('test-scan-uuid');
      expect(memoryResearchLoadedTheses[0].thesis).toBe('Edge computing converging with drone swarms');
    });
  });
});

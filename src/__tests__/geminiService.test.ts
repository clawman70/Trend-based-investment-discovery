import { describe, it, expect } from 'vitest';
import type { GenerateContentResponse } from '@google/genai';
import { collectGroundingResults, reconcileSources } from '../lib/geminiService';
import { CandidateThesis } from '../lib/types';

/**
 * Covers the anti-hallucination mechanism for research citations: a cited source only
 * survives if its URL is among the real groundingChunks Google Search returned this
 * turn, and its displayed title always comes from the tool's own result — never from
 * what the model wrote.
 */

const responseWithChunks = (chunks: Array<{ uri: string; title: string }>): GenerateContentResponse =>
  ({
    candidates: [{ groundingMetadata: { groundingChunks: chunks.map((c) => ({ web: { uri: c.uri, title: c.title } })) } }],
  }) as unknown as GenerateContentResponse;

const thesis = (sources: CandidateThesis['sources']): CandidateThesis => ({
  thesisStatement: 'Test thesis',
  convergenceType: 'technology_enablement',
  domainsInvolved: ['AI'],
  recencySignal: 'Emerged this week',
  maturity: 'Nascent',
  confidence: 'Medium',
  rationale: 'Because reasons',
  sources,
});

describe('geminiService — research grounding', () => {
  describe('collectGroundingResults', () => {
    it('collects real grounding chunks from the response', () => {
      const response = responseWithChunks([{ uri: 'https://real1.com/a', title: 'Real One' }, { uri: 'https://real2.com/b', title: 'Real Two' }]);
      const results = collectGroundingResults(response);
      expect(results.size).toBe(2);
      expect(results.get('https://real1.com/a')).toEqual({ title: 'Real One' });
    });

    it('returns an empty map when there is no grounding metadata (e.g. the model never searched)', () => {
      const response = { candidates: [{}] } as unknown as GenerateContentResponse;
      expect(collectGroundingResults(response).size).toBe(0);
    });

    it('returns an empty map when there are no candidates at all', () => {
      const response = {} as GenerateContentResponse;
      expect(collectGroundingResults(response).size).toBe(0);
    });

    it('falls back to the URL as the title when a chunk has no title', () => {
      const response = {
        candidates: [{ groundingMetadata: { groundingChunks: [{ web: { uri: 'https://real.com/x' } }] } }],
      } as unknown as GenerateContentResponse;
      expect(collectGroundingResults(response).get('https://real.com/x')).toEqual({ title: 'https://real.com/x' });
    });
  });

  describe('reconcileSources', () => {
    it('keeps a source whose URL was actually returned by grounding', () => {
      const realResults = new Map([['https://real.com/x', { title: 'Real Title' }]]);
      const theses = [thesis([{ title: 'Model-written title', url: 'https://real.com/x', date: '2026-09-01', sourceType: 'news' }])];

      const result = reconcileSources(theses, realResults);
      expect(result[0].sources).toHaveLength(1);
    });

    it('drops a source whose URL the model invented (never returned by grounding)', () => {
      const realResults = new Map([['https://real.com/x', { title: 'Real Title' }]]);
      const theses = [
        thesis([
          { title: 'Real Title', url: 'https://real.com/x', date: '2026-09-10', sourceType: 'news' },
          { title: 'Fabricated Source', url: 'https://made-up-domain.example/fake', date: '2026-09-01', sourceType: 'research_paper' },
        ]),
      ];

      const result = reconcileSources(theses, realResults);
      expect(result[0].sources).toHaveLength(1);
      expect(result[0].sources[0].url).toBe('https://real.com/x');
    });

    it('overwrites the title from the real grounding chunk, even when the model mistyped it', () => {
      const realResults = new Map([['https://real.com/x', { title: 'Actual Article Title' }]]);
      const theses = [thesis([{ title: 'A Title The Model Made Up', url: 'https://real.com/x', date: '2026-09-10', sourceType: 'news' }])];

      const result = reconcileSources(theses, realResults);
      expect(result[0].sources[0].title).toBe('Actual Article Title');
    });

    it('keeps the model-supplied date as-is (Google grounding metadata has no per-source date)', () => {
      const realResults = new Map([['https://real.com/x', { title: 'Actual Title' }]]);
      const theses = [thesis([{ title: 'x', url: 'https://real.com/x', date: '2026-09-01', sourceType: 'news' }])];

      const result = reconcileSources(theses, realResults);
      expect(result[0].sources[0].date).toBe('2026-09-01');
    });

    it('drops every source and leaves the thesis otherwise intact when none are real (a fully fabricated thesis)', () => {
      const realResults = new Map<string, { title: string }>();
      const theses = [thesis([{ title: 'Fake', url: 'https://not-real.example/x', date: '2026-01-01', sourceType: 'news' }])];

      const result = reconcileSources(theses, realResults);
      expect(result[0].sources).toHaveLength(0);
      expect(result[0].thesisStatement).toBe('Test thesis');
    });
  });
});

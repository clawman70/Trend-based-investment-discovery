import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { collectSearchResults, reconcileSources } from '../lib/claudeService';
import { CandidateThesis } from '../lib/types';

/**
 * Covers the anti-hallucination mechanism for research citations: a cited source only
 * survives if its URL was actually returned by web_search this turn, and its displayed
 * title/date always comes from the tool's own result — never from what the model wrote.
 */

const searchResultBlock = (results: Array<{ url: string; title: string; page_age: string | null }>): Anthropic.ContentBlock =>
  ({
    type: 'web_search_tool_result',
    tool_use_id: 'tu_1',
    content: results.map((r) => ({ type: 'web_search_result' as const, url: r.url, title: r.title, page_age: r.page_age, encrypted_content: 'x' })),
  }) as Anthropic.ContentBlock;

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

describe('claudeService — research grounding', () => {
  describe('collectSearchResults', () => {
    it('collects real results across multiple search tool calls in a turn', () => {
      const content = [
        searchResultBlock([{ url: 'https://real1.com/a', title: 'Real One', page_age: '2026-09-01' }]),
        { type: 'text', text: 'some analysis' } as Anthropic.ContentBlock,
        searchResultBlock([{ url: 'https://real2.com/b', title: 'Real Two', page_age: null }]),
      ];
      const results = collectSearchResults(content);
      expect(results.size).toBe(2);
      expect(results.get('https://real1.com/a')).toEqual({ title: 'Real One', date: '2026-09-01' });
      expect(results.get('https://real2.com/b')).toEqual({ title: 'Real Two', date: '' });
    });

    it('returns an empty map when no web_search_tool_result blocks are present (e.g. the model never searched)', () => {
      const content = [{ type: 'text', text: 'no search happened' } as Anthropic.ContentBlock];
      expect(collectSearchResults(content).size).toBe(0);
    });

    it('handles a web_search_tool_result error block without throwing (content is an object, not an array)', () => {
      const content = [{ type: 'web_search_tool_result', tool_use_id: 'tu_1', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } } as Anthropic.ContentBlock];
      expect(collectSearchResults(content).size).toBe(0);
    });
  });

  describe('reconcileSources', () => {
    it('keeps a source whose URL was actually returned by web_search', () => {
      const realResults = new Map([['https://real.com/x', { title: 'Real Title', date: '2026-09-10' }]]);
      const theses = [thesis([{ title: 'Model-written title', url: 'https://real.com/x', date: '2026-01-01', sourceType: 'news' }])];

      const result = reconcileSources(theses, realResults);
      expect(result[0].sources).toHaveLength(1);
    });

    it('drops a source whose URL the model invented (never returned by web_search)', () => {
      const realResults = new Map([['https://real.com/x', { title: 'Real Title', date: '2026-09-10' }]]);
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

    it('overwrites title and date from the real search result, even when they were real and the model mistyped them', () => {
      const realResults = new Map([['https://real.com/x', { title: 'Actual Article Title', date: '2026-09-10' }]]);
      const theses = [thesis([{ title: 'A Title The Model Made Up', url: 'https://real.com/x', date: '2020-01-01', sourceType: 'news' }])];

      const result = reconcileSources(theses, realResults);
      expect(result[0].sources[0].title).toBe('Actual Article Title');
      expect(result[0].sources[0].date).toBe('2026-09-10');
    });

    it('falls back to the model-supplied date only when the real result has no page_age', () => {
      const realResults = new Map([['https://real.com/x', { title: 'Actual Title', date: '' }]]);
      const theses = [thesis([{ title: 'x', url: 'https://real.com/x', date: '2026-09-01', sourceType: 'news' }])];

      const result = reconcileSources(theses, realResults);
      expect(result[0].sources[0].date).toBe('2026-09-01');
    });

    it('drops every source and leaves the thesis otherwise intact when none are real (a fully fabricated thesis)', () => {
      const realResults = new Map<string, { title: string; date: string }>();
      const theses = [thesis([{ title: 'Fake', url: 'https://not-real.example/x', date: '2026-01-01', sourceType: 'news' }])];

      const result = reconcileSources(theses, realResults);
      expect(result[0].sources).toHaveLength(0);
      expect(result[0].thesisStatement).toBe('Test thesis');
    });
  });
});

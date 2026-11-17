import { describe, it, expect } from 'vitest';
import { parseResearchOutput } from '../lib/researchSchema';

/** Bug B10: Gemini's structured JSON is validated, not trusted. */

const validReport = {
  executiveSummary: 'Summary of the scan.',
  candidateTheses: [
    {
      thesisStatement: 'Grid batteries meet AI data centers',
      convergenceType: 'demand_supply',
      domainsInvolved: ['Energy', 'AI'],
      recencySignal: 'Announced this month',
      maturity: 'Nascent',
      confidence: 'Medium',
      rationale: 'Because demand is spiking.',
      sources: [{ title: 'A', url: 'https://real.com/a', date: '2026-11-01', sourceType: 'news' }],
    },
  ],
  companiesMentioned: [{ name: 'Fluence Energy', ticker: 'FLNC', marketCapTier: 'small', context: 'Battery integrator' }],
  adjacentSignals: ['Weak signal'],
};

const withThesis = (patch: Record<string, unknown>) =>
  JSON.stringify({ ...validReport, candidateTheses: [{ ...validReport.candidateTheses[0], ...patch }] });

describe('parseResearchOutput (bug B10)', () => {
  it('accepts a well-formed report unchanged', () => {
    const parsed = parseResearchOutput(JSON.stringify(validReport));
    expect(parsed.candidateTheses[0].maturity).toBe('Nascent');
    expect(parsed.companiesMentioned[0].marketCapTier).toBe('small');
  });

  it("coerces off-list values in fixed-list fields to 'unknown' instead of failing the scan", () => {
    const parsed = parseResearchOutput(withThesis({ maturity: 'Mature', confidence: 'Very High', convergenceType: 'synergy' }));
    expect(parsed.candidateTheses[0].maturity).toBe('unknown');
    expect(parsed.candidateTheses[0].confidence).toBe('unknown');
    expect(parsed.candidateTheses[0].convergenceType).toBe('unknown');
  });

  it("coerces an off-list source type and market-cap tier to 'unknown', and normalizes tier case", () => {
    const parsed = parseResearchOutput(
      JSON.stringify({
        ...validReport,
        candidateTheses: [
          { ...validReport.candidateTheses[0], sources: [{ title: 'A', url: 'https://real.com/a', date: 'x', sourceType: 'blog' }] },
        ],
        companiesMentioned: [
          { name: 'One', ticker: 'ONE', marketCapTier: 'mega', context: '' },
          { name: 'Two', ticker: 'TWO', marketCapTier: 'Small', context: '' },
        ],
      })
    );
    expect(parsed.candidateTheses[0].sources[0].sourceType).toBe('unknown');
    expect(parsed.companiesMentioned[0].marketCapTier).toBe('unknown');
    expect(parsed.companiesMentioned[1].marketCapTier).toBe('small');
  });

  it('drops a citation with no URL but keeps the thesis and its other citations', () => {
    const parsed = parseResearchOutput(
      withThesis({
        sources: [
          { title: 'No URL', date: 'x', sourceType: 'news' },
          { title: 'Good', url: 'https://real.com/b', date: 'x', sourceType: 'news' },
        ],
      })
    );
    expect(parsed.candidateTheses[0].sources.map((s) => s.url)).toEqual(['https://real.com/b']);
  });

  it('fills small gaps with empty values rather than crashing or inventing content', () => {
    const parsed = parseResearchOutput(withThesis({ domainsInvolved: undefined, recencySignal: 42 }));
    expect(parsed.candidateTheses[0].domainsInvolved).toEqual([]);
    expect(parsed.candidateTheses[0].recencySignal).toBe('');
  });

  it('fails the scan with a clear error when the response is not JSON', () => {
    expect(() => parseResearchOutput('not json {')).toThrow(/Research scan failed: .*not valid JSON/);
  });

  it('fails the scan when the executive summary is missing', () => {
    const rest: Record<string, unknown> = { ...validReport };
    delete rest.executiveSummary;
    expect(() => parseResearchOutput(JSON.stringify(rest))).toThrow(/Research scan failed: .*executiveSummary/);
  });

  it('fails the scan when the theses are not a list or a thesis has no statement', () => {
    expect(() => parseResearchOutput(JSON.stringify({ ...validReport, candidateTheses: 'none' }))).toThrow(/candidateTheses/);
    expect(() => parseResearchOutput(withThesis({ thesisStatement: '' }))).toThrow(/thesisStatement/);
  });
});

import { describe, it, expect } from 'vitest';
import { buildRationaleNote } from '../lib/rationale';

describe('buildRationaleNote (bug B1)', () => {
  it('returns the plain rationale for a single thesis', () => {
    expect(buildRationaleNote({ 'AI chips': 'Makes inference accelerators.' })).toBe('Makes inference accelerators.');
  });

  it('labels each paragraph with its thesis when several theses matched', () => {
    const note = buildRationaleNote({ 'AI chips': 'Makes accelerators.', 'Grid storage': 'Sells batteries.' });
    expect(note).toBe('[AI chips] Makes accelerators.\n\n[Grid storage] Sells batteries.');
  });

  it('returns an empty string for an empty or missing map, and skips blank entries', () => {
    expect(buildRationaleNote({})).toBe('');
    expect(buildRationaleNote(undefined)).toBe('');
    expect(buildRationaleNote({ a: '  ', b: 'Real reason.' })).toBe('Real reason.');
  });
});

/**
 * Builds one readable note from the per-thesis rationale map that discovery returns
 * (`rationales`: thesis text -> why this company fits it).
 *
 * - One thesis: just the rationale text.
 * - Several theses: one paragraph per thesis, each prefixed with the thesis it explains.
 * - Empty map: empty string (the caller decides how to show "no note").
 *
 * Used for the watchlist note when starring a company and for the `rationale` column of a
 * saved history row (bug B1 fix).
 */
export function buildRationaleNote(rationales: Record<string, string> | null | undefined): string {
  const entries = Object.entries(rationales ?? {}).filter(([, text]) => typeof text === 'string' && text.trim() !== '');
  if (entries.length === 0) return '';
  if (entries.length === 1) return entries[0][1].trim();
  return entries.map(([thesis, text]) => `[${thesis.trim()}] ${text.trim()}`).join('\n\n');
}

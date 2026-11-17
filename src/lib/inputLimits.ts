/**
 * Request size limits (Phase E). Shared by the API routes (which reject anything over
 * the limit with a 400 and a plain-English message) and the UI (which stops you typing
 * past them), so the two can't drift apart.
 */
export const MAX_THESES_PER_RUN = 3; // matches the three thesis boxes on the Discover tab
export const MAX_THESIS_CHARS = 500;
export const MAX_TICKERS_PER_ENRICH = 50; // a 3-thesis discovery run returns well under this

/**
 * Checks a list of thesis strings. Returns an error message for the first problem, or
 * null if the list is within limits. Blank entries are ignored (the UI sends empty boxes).
 */
export function checkThesisLimits(theses: unknown[]): string | null {
  if (theses.some((t) => typeof t !== 'string')) {
    return 'Each thesis must be text.';
  }
  const nonBlank = (theses as string[]).map((t) => t.trim()).filter(Boolean);
  if (nonBlank.length > MAX_THESES_PER_RUN) {
    return `Too many theses: ${nonBlank.length} sent, the limit is ${MAX_THESES_PER_RUN} per run.`;
  }
  const tooLong = nonBlank.findIndex((t) => t.length > MAX_THESIS_CHARS);
  if (tooLong !== -1) {
    return `Thesis ${tooLong + 1} is ${nonBlank[tooLong].length} characters; the limit is ${MAX_THESIS_CHARS}. Please shorten it.`;
  }
  return null;
}

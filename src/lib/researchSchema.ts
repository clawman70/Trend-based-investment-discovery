/**
 * Validates the structured Research report JSON that Gemini returns (bug B10).
 *
 * It used to be `JSON.parse(...) as ParsedResearchOutput` — trusted blindly. Gemini's
 * response schema only describes the fixed-list fields (maturity, confidence, convergence
 * type, source type, market-cap tier) as plain strings, so an off-list value could reach
 * the UI and render a broken badge, and a missing field could crash it.
 *
 * Policy (chosen deliberately — see the README "Research tab" notes):
 * - **Off-list values in fixed-list fields are coerced to 'unknown'.** A scan costs real
 *   money and an odd badge label doesn't make the research wrong, so throwing the whole
 *   scan away for it would be the worse trade. 'unknown' renders as a neutral grey badge.
 * - **Broken structure fails the scan** with a clear error: the response isn't JSON, the
 *   executive summary is missing, the theses aren't a list, a thesis has no statement, or
 *   a company has no name. Those mean the report itself is unusable, and we never patch
 *   content we don't have.
 * - Small gaps in descriptive text/list fields become '' or [] so they render as empty
 *   rather than crashing. Nothing is invented.
 */
import { z } from 'zod';
import type { CandidateThesis, MentionedCompany, Source } from './types';

const text = z.string().catch('');
const textList = z.array(z.string()).catch([]);

const sourceSchema = z.object({
  title: text,
  url: z.string(), // required: a citation without a URL is dropped (see sourcesList below)
  date: text,
  sourceType: z.enum(['research_paper', 'news', 'social', 'video', 'patent', 'government']).catch('unknown' as never),
});

/** Keeps each well-formed citation and drops malformed ones individually (they're reconciled against real search results later anyway). */
const sourcesList = z
  .array(z.unknown())
  .catch([])
  .transform((items) =>
    items.flatMap((item) => {
      const parsed = sourceSchema.safeParse(item);
      return parsed.success ? [parsed.data as Source] : [];
    })
  );

const thesisSchema = z.object({
  thesisStatement: z.string().min(1),
  convergenceType: z
    .enum(['demand_supply', 'parallel_growth', 'regulatory_catalyst', 'technology_enablement'])
    .catch('unknown' as never),
  domainsInvolved: textList,
  recencySignal: text,
  maturity: z.enum(['Nascent', 'Pre-emergence', 'Early emergence']).catch('unknown' as never),
  confidence: z.enum(['High', 'Medium', 'Speculative']).catch('unknown' as never),
  rationale: text,
  sources: sourcesList,
});

const companySchema = z.object({
  name: z.string().min(1),
  // An empty/missing ticker is allowed; the research route marks it unverified.
  ticker: text,
  marketCapTier: z
    .preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.enum(['micro', 'small', 'mid', 'large']))
    .catch('unknown' as never),
  context: text,
});

export const researchOutputSchema = z.object({
  executiveSummary: z.string().min(1),
  candidateTheses: z.array(thesisSchema),
  companiesMentioned: z.array(companySchema).catch([]),
  adjacentSignals: textList,
});

export interface ParsedResearchOutput {
  executiveSummary: string;
  candidateTheses: CandidateThesis[];
  // recentRally and the ticker-verification fields are deliberately not asked of the
  // model — the research route computes them from real data.
  companiesMentioned: Pick<MentionedCompany, 'name' | 'ticker' | 'marketCapTier' | 'context'>[];
  adjacentSignals: string[];
}

/**
 * Parses and validates Gemini's JSON text. Throws an Error whose message starts with
 * "Research scan failed:" when the structure is unusable (see policy above).
 */
export function parseResearchOutput(jsonString: string): ParsedResearchOutput {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonString);
  } catch {
    throw new Error('Research scan failed: Gemini returned a report that is not valid JSON. Please run the scan again.');
  }

  const result = researchOutputSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.length ? issue.path.join('.') : 'report';
    throw new Error(
      `Research scan failed: Gemini returned a report in an unexpected format (${where}: ${issue?.message ?? 'invalid'}). Please run the scan again.`
    );
  }
  return result.data as ParsedResearchOutput;
}

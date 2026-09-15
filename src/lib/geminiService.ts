/**
 * Gemini (Google) client — used for exactly one thing: the Research tab's grounded
 * trend scan. Every other AI call in this app runs on Claude (see claudeService.ts).
 *
 * Why Gemini here and Claude everywhere else: the Research tab's whole premise is
 * finding trends that emerged in the last 30 days, which depends on the freshness and
 * breadth of the underlying web search — not on reasoning quality. Gemini's grounding
 * runs on Google's own search index; that's a real advantage for a recency- and
 * breadth-critical task (patents, government filings, niche technical sources) that
 * doesn't carry over to general reasoning tasks, which is why the rest of the app
 * stays on Claude.
 *
 * Two-call design (not one): live testing against the real API showed that when a
 * single call combines Google Search grounding with a large structured-output schema,
 * the model frequently skips the actual search and instead writes plausible-looking
 * fabricated citations (same URL format as real grounding redirects) — same prompt,
 * same schema, inconsistent search behavior from call to call. So this is split into
 * two calls: (1) a freeform search call with no schema, so the model's full attention
 * goes to actually searching, retried if grounding never fires; (2) a schema-only
 * reformat call (no search tool) that converts that narrative into structured JSON,
 * restricted to citing only the real URLs collected in step 1. Costs roughly 2x the
 * tokens of a single call — accepted tradeoff for citation reliability.
 *
 * Citation integrity: even after that, every source the model cites in step 2 is
 * cross-checked again against the real `groundingChunks` from step 1 before it's shown
 * — a URL that isn't in there is dropped, not trusted. Mirrors the same check
 * claudeService.ts does against Claude's web_search results.
 */
import { GoogleGenAI, Type, GenerateContentResponse } from '@google/genai';
import { CandidateThesis, MentionedCompany, Source, TrendResearchReport } from './types';
import { recordUsage } from './usageTracker';

const apiKey = process.env.GOOGLE_GENAI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

const ai = new GoogleGenAI({ apiKey: apiKey || 'PLACEHOLDER_API_KEY' });

export function isGeminiConfigured(): boolean {
  return !!apiKey && apiKey !== 'PLACEHOLDER_API_KEY';
}

/**
 * Retry helper with exponential backoff for rate-limited Gemini calls.
 * Retries up to 3 times with delays: 1s, 2s, 4s.
 */
async function retryWithBackoff<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      const isRateLimitError =
        error instanceof Error &&
        (error.message.includes('429') ||
          error.message.includes('503') ||
          error.message.includes('RESOURCE_EXHAUSTED') ||
          error.message.includes('high demand'));

      if (!isRateLimitError || attempt === maxRetries) {
        throw error;
      }

      const delayMs = Math.pow(2, attempt - 1) * 1000;
      console.log(`[Gemini Retry] Rate limited. Attempt ${attempt}/${maxRetries}, waiting ${delayMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError || new Error('Max retries exceeded');
}

const structuredReportSchema = {
  type: Type.OBJECT,
  properties: {
    executiveSummary: {
      type: Type.STRING,
      description: 'A 2-3 paragraph synthesis of emerging technologies and their convergence across the scanned domains.',
    },
    candidateTheses: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          thesisStatement: { type: Type.STRING, description: 'A clear, concise, actionable thesis statement suitable for discovery.' },
          convergenceType: {
            type: Type.STRING,
            description: "The nature of the convergence between domains. Must be one of: 'demand_supply', 'parallel_growth', 'regulatory_catalyst', 'technology_enablement'.",
          },
          domainsInvolved: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Which research domains intersect in this thesis.' },
          recencySignal: { type: Type.STRING, description: 'When this trend started emerging (must indicate a shift within the last 30 days).' },
          maturity: { type: Type.STRING, description: "The estimated maturity stage. Must be one of: 'Nascent', 'Pre-emergence', 'Early emergence'." },
          confidence: { type: Type.STRING, description: "Confidence level in the validity of this thesis. Must be one of: 'High', 'Medium', 'Speculative'." },
          rationale: { type: Type.STRING, description: 'Why this convergence matters and what opportunity it presents.' },
          sources: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                url: { type: Type.STRING, description: 'Must be copied exactly from the verified source list provided — never a URL you did not see in that list.' },
                date: { type: Type.STRING },
                sourceType: {
                  type: Type.STRING,
                  description: "Grounded source citation type. Must be one of: 'research_paper', 'news', 'social', 'video', 'patent', 'government'.",
                },
              },
              required: ['title', 'url', 'date', 'sourceType'],
            },
            description: 'Citations for this thesis, drawn only from the verified source list. Leave empty if no verified source supports this thesis — never invent one.',
          },
        },
        required: ['thesisStatement', 'convergenceType', 'domainsInvolved', 'recencySignal', 'maturity', 'confidence', 'rationale', 'sources'],
      },
    },
    companiesMentioned: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          ticker: { type: Type.STRING },
          marketCapTier: { type: Type.STRING, description: "Market capitalization category. Must be one of: 'micro', 'small', 'mid', 'large'." },
          context: { type: Type.STRING, description: 'Why the company is relevant to the convergence trend.' },
        },
        required: ['name', 'ticker', 'marketCapTier', 'context'],
      },
    },
    adjacentSignals: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Weak or early-stage signals that are not complete theses yet.' },
  },
  required: ['executiveSummary', 'candidateTheses', 'companiesMentioned', 'adjacentSignals'],
};

interface ParsedResearchOutput {
  executiveSummary: string;
  candidateTheses: CandidateThesis[];
  // recentRally is deliberately not asked of the model — it's computed from real price
  // history in the research route instead. See MentionedCompany in types.ts.
  companiesMentioned: Omit<MentionedCompany, 'recentRally'>[];
  adjacentSignals: string[];
}

/** Real grounding sources Google Search actually returned this turn, keyed by URL. Exported for tests. */
export function collectGroundingResults(response: GenerateContentResponse): Map<string, { title: string }> {
  const results = new Map<string, { title: string }>();
  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  for (const chunk of chunks) {
    if (chunk.web?.uri) {
      results.set(chunk.web.uri, { title: chunk.web.title || chunk.web.uri });
    }
  }
  return results;
}

/**
 * Drops any cited source whose URL isn't among the real grounding chunks Google Search
 * returned this turn, and overwrites the title from that real chunk — never from what
 * the model re-typed — so a hallucinated citation can't survive even if the URL happens
 * to be real. (Google's grounding metadata doesn't include a per-source date, so the
 * model-provided date is kept as-is for sources that pass the URL check.) Exported for
 * tests.
 */
export function reconcileSources(theses: CandidateThesis[], realResults: Map<string, { title: string }>): CandidateThesis[] {
  return theses.map((thesis) => ({
    ...thesis,
    sources: thesis.sources
      .filter((source) => realResults.has(source.url))
      .map((source): Source => ({ ...source, title: realResults.get(source.url)!.title })),
  }));
}

const ANALYST_ROLE_AND_CONSTRAINTS = `Role: You are a research analyst specializing in identifying emerging technology convergence trends for investment purposes. You focus on finding where demand signals in one industry intersect with supply capabilities in another.
Constraints:
- Only surface trends that have emerged or significantly accelerated in the past 30 days.
- Exclude any trend that has been widely covered for more than 180 days — if it is already consensus, it's priced in.
- Prioritize cross-domain convergence over single-domain trends.
- For any companies mentioned, flag their market cap tier (micro < $300M, small $300M-$2B, mid $2B-$10B, large > $10B).
- Source from: research papers, patent filings, government funding announcements, credible technology news, technical YouTube content, patent databases.`;

const MIN_GROUNDING_CHUNKS = 1;

/**
 * Step 1: a freeform (no response schema) search call. Keeping the schema out of this
 * call is deliberate — it's what makes the model reliably invoke Google Search instead
 * of sometimes skipping it. Retries if the model still doesn't search this attempt.
 */
async function runGroundedSearch(searchPrompt: string, maxAttempts = 3): Promise<GenerateContentResponse> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await retryWithBackoff(() =>
      ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: searchPrompt,
        config: {
          tools: [{ googleSearch: {} }],
          temperature: 0.2,
        } as unknown as Record<string, unknown>,
      })
    );

    await recordUsage('gemini', response.usageMetadata?.promptTokenCount ?? 0, response.usageMetadata?.candidatesTokenCount ?? 0);

    const chunkCount = response.candidates?.[0]?.groundingMetadata?.groundingChunks?.length ?? 0;
    if (chunkCount >= MIN_GROUNDING_CHUNKS) {
      return response;
    }

    console.log(`[Gemini Research] Search attempt ${attempt}/${maxAttempts} returned no real grounding results, ${attempt < maxAttempts ? 'retrying' : 'giving up'}...`);
  }

  throw new Error(
    'Research scan failed: Google Search grounding did not return any real results after multiple attempts. This means Gemini did not actually search the web this time — try again rather than trust an ungrounded report.'
  );
}

/** Step 2: reformat the grounded narrative into the app's structured schema, restricted to citing only real sources. */
async function structureResearchOutput(narrative: string, realResults: Map<string, { title: string }>): Promise<ParsedResearchOutput> {
  const verifiedSourceList =
    realResults.size > 0
      ? Array.from(realResults.entries())
          .map(([url, { title }]) => `- ${title}: ${url}`)
          .join('\n')
      : '(none found this search)';

  const structurePrompt = `${ANALYST_ROLE_AND_CONSTRAINTS}

Below is a research narrative you (or another analyst) wrote after live Google Search. Convert it into the structured JSON format described by the response schema.

Verified source list — these are the ONLY URLs you may put in any "sources" field, copied exactly as shown. If a claim in the narrative doesn't have a matching verified source, leave that thesis's sources array empty rather than inventing one:
${verifiedSourceList}

Research narrative to structure:
${narrative}`;

  const response = await retryWithBackoff(() =>
    ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: structurePrompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: structuredReportSchema,
        temperature: 0.1,
      } as unknown as Record<string, unknown>,
    })
  );

  await recordUsage('gemini', response.usageMetadata?.promptTokenCount ?? 0, response.usageMetadata?.candidatesTokenCount ?? 0);

  const jsonString = response.text?.trim();
  if (!jsonString) {
    throw new Error('Research scan failed: Gemini returned an empty response while structuring the report.');
  }

  return JSON.parse(jsonString) as ParsedResearchOutput;
}

export const generateTrendResearchReport = async (
  domains: string[],
  mode: 'guided' | 'open',
  customPrompt: string | null
): Promise<TrendResearchReport> => {
  // No mock fallback: failures propagate so the UI shows a real error instead of fake research.
  // Placeholder reports are only served by the route when DEMO_MODE=true.
  if (!isGeminiConfigured()) {
    throw new Error('GOOGLE_GENAI_API_KEY is not configured in .env.local');
  }

  const domainsStr = domains.join(', ');
  const scanDateIso = new Date().toISOString().split('T')[0];

  const researchTask =
    mode === 'open' && customPrompt
      ? `What emerging convergence technology trends connect with: "${customPrompt}"?\nFocus on finding where demand signals in one industry intersect with supply capabilities in another.`
      : `Perform an emerging technology scan for cross-domain convergence trends among the following research domains: [${domainsStr}].\nFocus on finding where demand signals in one domain intersect with supply capabilities in another, creating investment opportunities before the broader market recognizes them.`;

  const searchPrompt = `${ANALYST_ROLE_AND_CONSTRAINTS}

You must use Google Search for this task — your training data is not sufficient, since this task specifically requires information from the last 30 days. Perform several distinct searches covering the domains and angles below before writing anything.

Search Context & Scanned Domains: [${domainsStr}]
Task: ${researchTask}

After searching, write a detailed narrative covering: an executive summary; 2-4 candidate convergence theses (each with a thesis statement, convergence type, domains involved, recency signal, maturity stage, confidence level, and rationale); notable companies mentioned (name, ticker, market cap tier, why relevant); and any weaker adjacent signals. Cite the specific real source for every factual claim as you go.`;

  const searchResponse = await runGroundedSearch(searchPrompt);
  const narrative = searchResponse.text?.trim();
  if (!narrative) {
    throw new Error('Research scan failed: Gemini returned an empty response during the search step.');
  }

  const realGroundingResults = collectGroundingResults(searchResponse);
  const parsed = await structureResearchOutput(narrative, realGroundingResults);

  return {
    isDemo: false,
    executiveSummary: parsed.executiveSummary,
    scanDate: scanDateIso,
    domainsScanned: domains,
    candidateTheses: reconcileSources(parsed.candidateTheses, realGroundingResults),
    // recentRally: null here — the research route fills in the real, price-history-based
    // value for each company before this report reaches the client.
    companiesMentioned: parsed.companiesMentioned.map((c) => ({ ...c, recentRally: null })),
    adjacentSignals: parsed.adjacentSignals,
  };
};

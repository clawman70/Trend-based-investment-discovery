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
 * Citation integrity: every source the model cites is cross-checked against
 * `groundingMetadata.groundingChunks` — the real pages Google Search actually
 * returned this turn — before it's shown. A source whose URL isn't in there is
 * dropped, not trusted. Mirrors the same check claudeService.ts does against
 * Claude's web_search results.
 */
import { GoogleGenAI, Type, GenerateContentResponse } from '@google/genai';
import { CandidateThesis, MentionedCompany, Source, TrendResearchReport } from './types';

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

// scanDate/domainsScanned/isDemo are set programmatically after the call, not asked of the model
const trendResearchReportSchema = {
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
                url: { type: Type.STRING, description: 'Must be a URL from your web search results this turn — never a URL you did not actually see.' },
                date: { type: Type.STRING },
                sourceType: {
                  type: Type.STRING,
                  description: "Grounded source citation type. Must be one of: 'research_paper', 'news', 'social', 'video', 'patent', 'government'.",
                },
              },
              required: ['title', 'url', 'date', 'sourceType'],
            },
            description: 'Grounded source citations validating the thesis.',
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
          recentRally: { type: Type.BOOLEAN, description: 'Whether the stock has rallied >30% in the last 6 months.' },
        },
        required: ['name', 'ticker', 'marketCapTier', 'context', 'recentRally'],
      },
    },
    adjacentSignals: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Weak or early-stage signals that are not complete theses yet.' },
  },
  required: ['executiveSummary', 'candidateTheses', 'companiesMentioned', 'adjacentSignals'],
};

interface ParsedResearchOutput {
  executiveSummary: string;
  candidateTheses: CandidateThesis[];
  companiesMentioned: MentionedCompany[];
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

const RESEARCH_SYSTEM_INSTRUCTION = `Role: You are a research analyst specializing in identifying emerging technology convergence trends for investment purposes. You focus on finding where demand signals in one industry intersect with supply capabilities in another.
Constraints:
- Only surface trends that have emerged or significantly accelerated in the past 30 days.
- Exclude any trend that has been widely covered for more than 180 days — if it is already consensus, it's priced in.
- Prioritize cross-domain convergence over single-domain trends.
- For any companies mentioned, flag their market cap tier (micro < $300M, small $300M-$2B, mid $2B-$10B, large > $10B) and check if they have rallied significantly (>30%) in the past 6 months.
- Source from: research papers, patent filings, government funding announcements, credible technology news, technical YouTube content, patent databases.
- Every source you cite must be a page you actually found via search this turn. Never invent a source, a URL, or a publication date.
- Output Format: Return a structured JSON object matching the TrendResearchReport schema.`;

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

  const prompt =
    mode === 'open' && customPrompt
      ? `What emerging convergence technology trends connect with: "${customPrompt}"?\nFocus on finding where demand signals in one industry intersect with supply capabilities in another.`
      : `Perform an emerging technology scan for cross-domain convergence trends among the following research domains: [${domainsStr}].\nFocus on finding where demand signals in one domain intersect with supply capabilities in another, creating investment opportunities before the broader market recognizes them.`;

  const fullPrompt = `${RESEARCH_SYSTEM_INSTRUCTION}\n\nSearch Context & Scanned Domains: [${domainsStr}]\nInput Prompt: ${prompt}`;

  const response = await retryWithBackoff(() =>
    ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: fullPrompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: trendResearchReportSchema,
        tools: [{ googleSearch: {} }],
        temperature: 0.2,
      } as unknown as Record<string, unknown>,
    })
  );

  const jsonString = response.text?.trim();
  if (!jsonString) {
    throw new Error('Research scan failed: Gemini returned an empty response.');
  }

  const parsed = JSON.parse(jsonString) as ParsedResearchOutput;
  const realGroundingResults = collectGroundingResults(response);

  return {
    isDemo: false,
    executiveSummary: parsed.executiveSummary,
    scanDate: scanDateIso,
    domainsScanned: domains,
    candidateTheses: reconcileSources(parsed.candidateTheses, realGroundingResults),
    companiesMentioned: parsed.companiesMentioned,
    adjacentSignals: parsed.adjacentSignals,
  };
};

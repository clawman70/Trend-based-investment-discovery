/**
 * Claude (Anthropic) client — powers trend analysis, company discovery, research scans,
 * news sentiment, and value-chain summaries.
 *
 * Structured JSON responses use Claude's native structured outputs (Zod schema ->
 * `output_config.format` via `client.messages.parse()`), so there's no manual JSON
 * parsing/validation to get wrong. The SDK itself retries rate limits and transient
 * server errors (`maxRetries` below), so there's no hand-rolled backoff loop here.
 *
 * Research grounding: Claude has no built-in knowledge of anything after its training
 * cutoff, so `generateTrendResearchReport` uses the `web_search` server tool and then
 * cross-checks every cited URL against what the tool actually returned this turn —
 * a source whose URL wasn't in a real search result is dropped rather than trusted,
 * closing off the model just inventing a citation.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import {
  CandidateThesis,
  DiscoveredCompany,
  MentionedCompany,
  Source,
  TrendAnalysis,
  TrendResearchReport,
} from './types';

const apiKey = process.env.ANTHROPIC_API_KEY;
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';

const client = new Anthropic({ apiKey: apiKey || 'PLACEHOLDER_API_KEY', maxRetries: 3 });

export function isClaudeConfigured(): boolean {
  return !!apiKey && apiKey !== 'PLACEHOLDER_API_KEY';
}

function describeApiError(error: unknown): string {
  if (error instanceof Anthropic.RateLimitError) return `rate limited: ${error.message}`;
  if (error instanceof Anthropic.AuthenticationError) return `invalid API key: ${error.message}`;
  if (error instanceof Anthropic.APIError) return `API error (${error.status}): ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Structured output schemas
// ---------------------------------------------------------------------------

const discoveredCompanySchema = z.object({
  ticker: z.string().describe("The stock ticker symbol, e.g. 'AAPL'. Must be a real, publicly traded ticker."),
  companyName: z.string().describe("The full company name, e.g. 'Apple Inc.'."),
  rationale: z
    .string()
    .describe('A concise, one-sentence explanation of why this company fits the trend, specifying if its involvement is direct or adjacent.'),
  relevanceScore: z
    .number()
    .int()
    .min(1)
    .max(10)
    .describe('1-10: how relevant this company is to the trend (10 = highly aligned/critical, 1 = minor/distant).'),
});

const discoveryOutputSchema = z.object({ companies: z.array(discoveredCompanySchema) });

const trendAnalysisSchema = z.object({
  maturityStage: z.enum(['Nascent', 'Emerging', 'Growth', 'Established', 'Declining']),
  estimatedTAM: z.string().describe("Order-of-magnitude total addressable market, e.g. '$50 Billion by 2030'."),
  catalysts: z.array(z.string()).describe('3 key drivers accelerating this trend (regulatory, technological, or market).'),
  risks: z.array(z.string()).describe('3 key risks or inhibitors that could stall or kill this trend.'),
  timeHorizon: z.string().describe('Estimated timeframe when this trend hits mainstream adoption.'),
  adjacentTrends: z.array(z.string()).describe('3 related emerging themes/trends.'),
});

const newsSentimentSchema = z.object({
  sentiment: z.enum(['Bullish', 'Bearish', 'Neutral']),
  sentimentScore: z.number().min(-1).max(1).describe('-1.0 (extreme bearish) to 1.0 (extreme bullish).'),
  summary: z.string().describe('A concise 1-2 sentence executive summary of the positive and negative news momentum.'),
});

// scanDate/domainsScanned/isDemo are set programmatically after the call, not asked of the model
const researchReportSchema = z.object({
  executiveSummary: z.string().describe('2-3 paragraph synthesis of emerging technologies and their convergence across the scanned domains.'),
  candidateTheses: z.array(
    z.object({
      thesisStatement: z.string().describe('A clear, concise, actionable thesis statement suitable for discovery.'),
      convergenceType: z.enum(['demand_supply', 'parallel_growth', 'regulatory_catalyst', 'technology_enablement']),
      domainsInvolved: z.array(z.string()).describe('Which research domains intersect in this thesis.'),
      recencySignal: z.string().describe('When this trend started emerging — must indicate a shift within the last 30 days.'),
      maturity: z.enum(['Nascent', 'Pre-emergence', 'Early emergence']),
      confidence: z.enum(['High', 'Medium', 'Speculative']),
      rationale: z.string().describe('Why this convergence matters and what opportunity it presents.'),
      sources: z.array(
        z.object({
          title: z.string(),
          url: z.string().describe('Must be a URL returned by a web_search result this turn — never a URL you did not actually see.'),
          date: z.string(),
          sourceType: z.enum(['research_paper', 'news', 'social', 'video', 'patent', 'government']),
        })
      ),
    })
  ),
  companiesMentioned: z.array(
    z.object({
      name: z.string(),
      ticker: z.string(),
      marketCapTier: z.enum(['micro', 'small', 'mid', 'large']).describe('micro < $300M, small $300M-$2B, mid $2B-$10B, large > $10B.'),
      context: z.string().describe('Why the company is relevant to the convergence trend.'),
      recentRally: z.boolean().describe('Whether the stock has rallied >30% in the last 6 months.'),
    })
  ),
  adjacentSignals: z.array(z.string()).describe('Weak or early-stage signals that are not complete theses yet.'),
});

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

const buildDiscoveryPrompt = (trend: string, filters: { exchange: string[]; marketCap: string[] }): string => {
  let prompt = `Based on the following emerging, cross-industry investment trend: "${trend}", identify up to 15 relevant, publicly traded companies.

Your analysis should include companies that are:
1. Directly operating within this trend.
2. Adjacent to the trend and uniquely positioned to benefit from its growth.

Only include companies that are actively traded and have valid tickers.`;

  if (filters.exchange && filters.exchange.length > 0) {
    prompt += `\nThe companies must be listed on one of the following exchanges: ${filters.exchange.join(', ')}.`;
  }

  if (filters.marketCap && filters.marketCap.length > 0) {
    const capDescriptions = filters.marketCap
      .map((cap) => {
        if (cap === 'MICRO') return 'Micro-cap (under $300 million)';
        if (cap === 'SMALL') return 'Small-cap ($300 million to $2 billion)';
        if (cap === 'MID') return 'Mid-cap ($2 billion to $10 billion)';
        if (cap === 'LARGE') return 'Large-cap (over $10 billion)';
        return '';
      })
      .filter(Boolean);
    prompt += `\nFocus on companies within these market capitalization ranges: ${capDescriptions.join(', ')}.`;
  }

  return prompt;
};

export const discoverCompaniesFromAI = async (
  trend: string,
  filters: { exchange: string[]; marketCap: string[] }
): Promise<DiscoveredCompany[]> => {
  if (!isClaudeConfigured()) {
    throw new Error('ANTHROPIC_API_KEY is not configured in .env.local');
  }

  try {
    const response = await client.messages.parse({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      output_config: { format: zodOutputFormat(discoveryOutputSchema), effort: 'low' },
      messages: [{ role: 'user', content: buildDiscoveryPrompt(trend, filters) }],
    });

    if (!response.parsed_output) {
      throw new Error('Claude returned a response that did not match the expected schema.');
    }
    return response.parsed_output.companies;
  } catch (error) {
    console.error('Error calling Claude for discovery:', describeApiError(error));
    throw error;
  }
};

// ---------------------------------------------------------------------------
// Trend analysis
// ---------------------------------------------------------------------------

export const analyzeTrendFromAI = async (trend: string): Promise<TrendAnalysis> => {
  if (!isClaudeConfigured()) {
    throw new Error('ANTHROPIC_API_KEY is not configured in .env.local');
  }

  const prompt = `Perform a comprehensive market analysis on the following investment trend: "${trend}".
Analyze its maturity stage, addressable market size (TAM), key drivers/catalysts, primary risks/challenges, adoption time horizon, and adjacent industry trends.`;

  try {
    const response = await client.messages.parse({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      output_config: { format: zodOutputFormat(trendAnalysisSchema), effort: 'low' },
      messages: [{ role: 'user', content: prompt }],
    });

    if (!response.parsed_output) {
      throw new Error('Claude returned a response that did not match the expected schema.');
    }
    return response.parsed_output;
  } catch (error) {
    console.error('Error calling Claude for trend analysis:', describeApiError(error));
    throw new Error('Failed to get trend analysis from AI.');
  }
};

// ---------------------------------------------------------------------------
// News sentiment
// ---------------------------------------------------------------------------

export interface NewsSentiment {
  sentiment: 'Bullish' | 'Bearish' | 'Neutral';
  sentimentScore: number;
  summary: string;
}

export const analyzeNewsSentimentFromAI = async (ticker: string, headlines: string[]): Promise<NewsSentiment | null> => {
  // null means "no sentiment available" — never invent a neutral or bullish verdict
  if (!isClaudeConfigured() || headlines.length === 0) {
    return null;
  }

  const prompt = `Analyze the following stock news headlines for ticker "${ticker}". Assign an overall sentiment, a sentiment score, and write a concise 1-2 sentence executive summary of the positive and negative news momentum.
Headlines:
${headlines.map((h, i) => `${i + 1}. ${h}`).join('\n')}`;

  try {
    const response = await client.messages.parse({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      output_config: { format: zodOutputFormat(newsSentimentSchema), effort: 'low' },
      messages: [{ role: 'user', content: prompt }],
    });
    return response.parsed_output ?? null;
  } catch (error) {
    console.error(`Error calling Claude for news sentiment on ${ticker}:`, describeApiError(error));
    return null;
  }
};

// ---------------------------------------------------------------------------
// Value chain position (plain text, no schema needed)
// ---------------------------------------------------------------------------

export const getValueChainPositionFromAI = async (
  ticker: string,
  companyName: string,
  sector: string,
  industry: string,
  trend: string
): Promise<string | null> => {
  if (!isClaudeConfigured()) {
    return null;
  }

  const prompt = `Identify where the company "${companyName}" (ticker: ${ticker}, sector: ${sector}, industry: ${industry}) sits in the industry value chain for the following market trend: "${trend}".
Give a concise, professional 1-sentence description (e.g., 'Upstream provider of specialized silicon architecture' or 'Downstream software integrator for commercial fleets'). Respond with only that sentence, nothing else.`;

  try {
    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 300,
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: prompt }],
    });
    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
    return textBlock?.text.trim() || null;
  } catch (error) {
    console.error(`Error fetching value chain for ${ticker}:`, describeApiError(error));
    return null;
  }
};

// ---------------------------------------------------------------------------
// Research report (grounded via the web_search server tool)
// ---------------------------------------------------------------------------

const RESEARCH_SYSTEM_PROMPT = `Role: You are a research analyst specializing in identifying emerging technology convergence trends for investment purposes. You focus on finding where demand signals in one industry intersect with supply capabilities in another.
Constraints:
- Only surface trends that have emerged or significantly accelerated in the past 30 days. Use web_search to check — your training data is not current.
- Exclude any trend that has been widely covered for more than 180 days — if it is already consensus, it's priced in.
- Prioritize cross-domain convergence over single-domain trends.
- For any companies mentioned, flag their market cap tier (micro < $300M, small $300M-$2B, mid $2B-$10B, large > $10B) and check if they have rallied significantly (>30%) in the past 6 months.
- Every source you cite must be a page you actually retrieved with web_search this turn. Never invent a source, a URL, or a publication date.`;

/** Real web_search_result blocks seen anywhere in this turn, keyed by URL. Exported for tests. */
export function collectSearchResults(content: Anthropic.ContentBlock[]): Map<string, { title: string; date: string }> {
  const results = new Map<string, { title: string; date: string }>();
  for (const block of content) {
    if (block.type !== 'web_search_tool_result' || !Array.isArray(block.content)) continue;
    for (const result of block.content) {
      results.set(result.url, { title: result.title, date: result.page_age || '' });
    }
  }
  return results;
}

/**
 * Drops any cited source whose URL wasn't actually returned by web_search this turn, and
 * overwrites title/date from the tool's own result — never from what the model re-typed —
 * so a hallucinated citation can't survive even if the URL happens to be real. Exported
 * for tests.
 */
export function reconcileSources(theses: CandidateThesis[], realResults: Map<string, { title: string; date: string }>): CandidateThesis[] {
  return theses.map((thesis) => ({
    ...thesis,
    sources: thesis.sources
      .filter((source) => realResults.has(source.url))
      .map((source): Source => {
        const real = realResults.get(source.url)!;
        return { ...source, title: real.title, date: real.date || source.date };
      }),
  }));
}

export const generateTrendResearchReport = async (
  domains: string[],
  mode: 'guided' | 'open',
  customPrompt: string | null
): Promise<TrendResearchReport> => {
  // No mock fallback: failures propagate so the UI shows a real error instead of fake research.
  // Placeholder reports are only served by the route when DEMO_MODE=true.
  if (!isClaudeConfigured()) {
    throw new Error('ANTHROPIC_API_KEY is not configured in .env.local');
  }

  const domainsStr = domains.join(', ');
  const scanDateIso = new Date().toISOString().split('T')[0];

  const prompt =
    mode === 'open' && customPrompt
      ? `What emerging convergence technology trends connect with: "${customPrompt}"?\nFocus on finding where demand signals in one industry intersect with supply capabilities in another.\n\nUse web_search to find sources from the last 30 days before answering.`
      : `Perform an emerging technology scan for cross-domain convergence trends among the following research domains: [${domainsStr}].\nFocus on finding where demand signals in one domain intersect with supply capabilities in another, creating investment opportunities before the broader market recognizes them.\n\nUse web_search to find sources from the last 30 days before answering.`;

  let response;
  try {
    response = await client.messages.parse({
      model: CLAUDE_MODEL,
      max_tokens: 8000,
      system: RESEARCH_SYSTEM_PROMPT,
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 8 }],
      output_config: { format: zodOutputFormat(researchReportSchema), effort: 'high' },
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (error) {
    console.error('Error generating trend research report:', describeApiError(error));
    throw new Error(`Research scan failed: ${describeApiError(error)}`);
  }

  if (!response.parsed_output) {
    throw new Error('Research scan failed: Claude returned a response that did not match the expected schema.');
  }

  const realSearchResults = collectSearchResults(response.content);
  const result = response.parsed_output;

  const report: TrendResearchReport = {
    isDemo: false,
    executiveSummary: result.executiveSummary,
    scanDate: scanDateIso,
    domainsScanned: domains,
    candidateTheses: reconcileSources(result.candidateTheses, realSearchResults),
    companiesMentioned: result.companiesMentioned as MentionedCompany[],
    adjacentSignals: result.adjacentSignals,
  };
  return report;
};

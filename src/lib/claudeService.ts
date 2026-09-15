/**
 * Claude (Anthropic) client — powers trend analysis, company discovery, news sentiment,
 * and value-chain summaries. Everything *except* the Research tab's grounded trend scan,
 * which runs on Gemini instead (see geminiService.ts) — that task hinges on live web
 * search freshness/breadth more than reasoning quality, and Gemini's grounding runs on
 * Google's own search index.
 *
 * Structured JSON responses use Claude's native structured outputs (Zod schema ->
 * `output_config.format` via `client.messages.parse()`), so there's no manual JSON
 * parsing/validation to get wrong. The SDK itself retries rate limits and transient
 * server errors (`maxRetries` below), so there's no hand-rolled backoff loop here.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { DiscoveredCompany, TrendAnalysis } from './types';
import { recordUsage } from './usageTracker';

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

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

const buildDiscoveryPrompt = (trend: string, filters: { exchange: string[]; marketCap: string[] }): string => {
  let prompt = `Based on the following emerging, cross-industry investment trend: "${trend}", identify up to 15 relevant, publicly traded companies.

Search the web before answering — your training data can miss companies that IPO'd, completed a SPAC merger, or were spun off recently. Include any such recent listings that fit this trend; don't rely on training data alone for this.

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
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }],
      output_config: { format: zodOutputFormat(discoveryOutputSchema), effort: 'low' },
      messages: [{ role: 'user', content: buildDiscoveryPrompt(trend, filters) }],
    });

    if (!response.parsed_output) {
      throw new Error('Claude returned a response that did not match the expected schema.');
    }
    await recordUsage('claude', response.usage.input_tokens ?? 0, response.usage.output_tokens);

    const searched = response.content.some((b) => b.type === 'server_tool_use' || b.type === 'web_search_tool_result');
    if (!searched) {
      console.warn(`[Discovery] Claude did not search the web for trend "${trend}" — results rely on training data only this time.`);
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
    await recordUsage('claude', response.usage.input_tokens ?? 0, response.usage.output_tokens);
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
    await recordUsage('claude', response.usage.input_tokens ?? 0, response.usage.output_tokens);
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
    await recordUsage('claude', response.usage.input_tokens ?? 0, response.usage.output_tokens);
    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
    return textBlock?.text.trim() || null;
  } catch (error) {
    console.error(`Error fetching value chain for ${ticker}:`, describeApiError(error));
    return null;
  }
};

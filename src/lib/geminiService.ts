import { GoogleGenAI, Type } from "@google/genai";
import { DiscoveredCompany, TrendAnalysis, TrendResearchReport } from "./types";

const apiKey = process.env.GOOGLE_GENAI_API_KEY;

const ai = new GoogleGenAI({ apiKey: apiKey || 'PLACEHOLDER_API_KEY' });

// Model is configurable so it can be swapped without code changes (see .env.example)
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

export function isGeminiConfigured(): boolean {
  return !!apiKey && apiKey !== 'PLACEHOLDER_API_KEY';
}

/**
 * Retry helper with exponential backoff for rate-limited Gemini calls
 * Retries up to 3 times with delays: 1s, 2s, 4s
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
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
        throw error; // Not a rate limit or last attempt, throw immediately
      }

      const delayMs = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
      console.log(`[Gemini Retry] Rate limited. Attempt ${attempt}/${maxRetries}, waiting ${delayMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError || new Error('Max retries exceeded');
}

const companySchema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      ticker: {
        type: Type.STRING,
        description: "The stock ticker symbol for the company, e.g., 'AAPL'. Must be a real, publicly traded ticker.",
      },
      companyName: {
        type: Type.STRING,
        description: "The full name of the company, e.g., 'Apple Inc.'.",
      },
      rationale: {
        type: Type.STRING,
        description: "A concise, one-sentence explanation of why this company fits the trend, specifying if its involvement is direct or adjacent.",
      },
      relevanceScore: {
        type: Type.INTEGER,
        description: "An integer between 1 and 10 indicating how relevant this company is to the trend (10 being highly aligned/critical, 1 being minor/distant).",
      },
    },
    required: ["ticker", "companyName", "rationale", "relevanceScore"],
  },
};

const trendAnalysisSchema = {
  type: Type.OBJECT,
  properties: {
    maturityStage: {
      type: Type.STRING,
      enum: ["Nascent", "Emerging", "Growth", "Established", "Declining"],
      description: "The stage of maturity of this market trend.",
    },
    estimatedTAM: {
      type: Type.STRING,
      description: "Order-of-magnitude total addressable market size (e.g., '$50 Billion by 2030').",
    },
    catalysts: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "List of 3 key drivers accelerating this trend (regulatory, technological, or market).",
    },
    risks: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "List of 3 key risks or inhibitors that could stall or kill this trend.",
    },
    timeHorizon: {
      type: Type.STRING,
      description: "Estimated timeframe when this trend hits mainstream adoption.",
    },
    adjacentTrends: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "List of 3 related emerging themes/trends.",
    },
  },
  required: ["maturityStage", "estimatedTAM", "catalysts", "risks", "timeHorizon", "adjacentTrends"],
};

const newsSentimentSchema = {
  type: Type.OBJECT,
  properties: {
    sentiment: {
      type: Type.STRING,
      enum: ["Bullish", "Bearish", "Neutral"],
      description: "Overall sentiment of the combined news headlines.",
    },
    sentimentScore: {
      type: Type.NUMBER,
      description: "A sentiment score between -1.0 (extreme bearish) and 1.0 (extreme bullish).",
    },
    summary: {
      type: Type.STRING,
      description: "A concise 1-2 sentence executive summary of the positive and negative news momentum.",
    },
  },
  required: ["sentiment", "sentimentScore", "summary"],
};

const buildPrompt = (trend: string, filters: { exchange: string[]; marketCap: string[] }): string => {
  let prompt = `Based on the following emerging, cross-industry investment trend: "${trend}", identify up to 15 relevant, publicly traded companies.
 
Your analysis should include companies that are:
1. Directly operating within this trend.
2. Adjacent to the trend and uniquely positioned to benefit from its growth.
 
Return a JSON array of objects, where each object represents a company and contains a 'ticker', 'companyName', 'rationale', and 'relevanceScore'.
The rationale should be a single, concise sentence explaining why the company is a good fit for the trend, specifying if its involvement is direct or adjacent.
Only include companies that are actively traded and have valid tickers.
`;

  if (filters.exchange && filters.exchange.length > 0) {
    prompt += `\nThe companies must be listed on one of the following exchanges: ${filters.exchange.join(', ')}.`;
  }

  if (filters.marketCap && filters.marketCap.length > 0) {
    const capDescriptions = filters.marketCap.map(cap => {
      if (cap === 'MICRO') return 'Micro-cap (under $300 million)';
      if (cap === 'SMALL') return 'Small-cap ($300 million to $2 billion)';
      if (cap === 'MID') return 'Mid-cap ($2 billion to $10 billion)';
      if (cap === 'LARGE') return 'Large-cap (over $10 billion)';
      return '';
    }).filter(Boolean);
    prompt += `\nFocus on companies within these market capitalization ranges: ${capDescriptions.join(', ')}.`;
  }

  return prompt;
};

export const discoverCompaniesFromAI = async (
  trend: string,
  filters: { exchange: string[]; marketCap: string[] }
): Promise<DiscoveredCompany[]> => {
  if (!apiKey || apiKey === 'PLACEHOLDER_API_KEY') {
    throw new Error("GOOGLE_GENAI_API_KEY is not configured in .env.local");
  }

  const prompt = buildPrompt(trend, filters);

  return retryWithBackoff(async () => {
    try {
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: companySchema,
          temperature: 0.2,
          // TODO: thinkingConfig not yet typed in @google/genai SDK — remove cast when SDK catches up to 3.5 Flash
          thinkingConfig: {
            thinkingLevel: "medium",
          },
        } as unknown as Record<string, unknown>,
      });

      const jsonString = response.text?.trim() || "[]";
      const result = JSON.parse(jsonString);
      if (!Array.isArray(result)) {
        throw new Error("Invalid output format: Expected array of companies");
      }
      return result as DiscoveredCompany[];
    } catch (error) {
      console.error("Error calling Gemini API for discovery:", error);
      throw error; // Let retry logic handle it
    }
  });
};

export const analyzeTrendFromAI = async (trend: string): Promise<TrendAnalysis> => {
  if (!apiKey || apiKey === 'PLACEHOLDER_API_KEY') {
    throw new Error("GOOGLE_GENAI_API_KEY is not configured in .env.local");
  }

  const prompt = `Perform a comprehensive market analysis on the following investment trend: "${trend}".
Analyze its maturity stage, addressable market size (TAM), key drivers/catalysts, primary risks/challenges, adoption time horizon, and adjacent industry trends.
Return a structured JSON object according to the schema.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: trendAnalysisSchema,
        temperature: 0.2,
        // TODO: thinkingConfig not yet typed in @google/genai SDK — remove cast when SDK catches up to 3.5 Flash
        thinkingConfig: {
          thinkingLevel: "medium",
        },
      } as unknown as Record<string, unknown>,
    });

    const jsonString = response.text?.trim() || "{}";
    const result = JSON.parse(jsonString);
    return result as TrendAnalysis;
  } catch (error) {
    console.error("Error calling Gemini API for trend analysis:", error);
    throw new Error("Failed to get trend analysis from AI.");
  }
};

export interface NewsSentiment {
  sentiment: 'Bullish' | 'Bearish' | 'Neutral';
  sentimentScore: number;
  summary: string;
}

export const analyzeNewsSentimentFromAI = async (
  ticker: string,
  headlines: string[]
): Promise<NewsSentiment | null> => {
  // null means "no sentiment available" — never invent a neutral or bullish verdict
  if (!isGeminiConfigured() || headlines.length === 0) {
    return null;
  }

  const prompt = `Analyze the following stock news headlines for ticker "${ticker}". Assign an overall sentiment (one of: 'Bullish', 'Bearish', 'Neutral'), a sentiment score between -1.0 (extreme bearish) and 1.0 (extreme bullish), and write a concise 1-2 sentence executive summary of the positive and negative news momentum.
Headlines:
${headlines.map((h, i) => `${i + 1}. ${h}`).join('\n')}
`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: newsSentimentSchema,
        temperature: 0.2,
      } as unknown as Record<string, unknown>,
    });

    const jsonString = response.text?.trim() || "{}";
    const result = JSON.parse(jsonString);
    return result as NewsSentiment;
  } catch (error) {
    console.error(`Error calling Gemini API for news sentiment on ${ticker}:`, error);
    return null;
  }
};

export const getValueChainPositionFromAI = async (
  ticker: string,
  companyName: string,
  sector: string,
  industry: string,
  trend: string
): Promise<string | null> => {
  if (!isGeminiConfigured()) {
    return null;
  }
  
  const prompt = `Identify where the company "${companyName}" (ticker: ${ticker}, sector: ${sector}, industry: ${industry}) sits in the industry value chain for the following market trend: "${trend}".
Give a concise, professional 1-sentence description (e.g., 'Upstream provider of specialized silicon architecture' or 'Downstream software integrator for commercial fleets').`;
  
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        temperature: 0.2,
      } as unknown as Record<string, unknown>,
    });
    return response.text?.trim() || null;
  } catch (err) {
    console.error(`Error fetching value chain for ${ticker}:`, err);
    return null;
  }
};

const trendResearchReportSchema = {
  type: Type.OBJECT,
  properties: {
    executiveSummary: {
      type: Type.STRING,
      description: "A 2-3 paragraph synthesis of emerging technologies and their convergence across the scanned domains.",
    },
    scanDate: {
      type: Type.STRING,
      description: "ISO date of the scan.",
    },
    domainsScanned: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "The list of domains selected for scanning.",
    },
    candidateTheses: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          thesisStatement: {
            type: Type.STRING,
            description: "A clear, concise, actionable thesis statement suitable for discovery.",
          },
          convergenceType: {
            type: Type.STRING,
            description: "The nature of the convergence between domains. Must be one of: 'demand_supply', 'parallel_growth', 'regulatory_catalyst', 'technology_enablement'.",
          },
          domainsInvolved: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Which research domains intersect in this thesis.",
          },
          recencySignal: {
            type: Type.STRING,
            description: "When this trend started emerging (must indicate a shift within the last 30 days).",
          },
          maturity: {
            type: Type.STRING,
            description: "The estimated maturity stage. Must be one of: 'Nascent', 'Pre-emergence', 'Early emergence'.",
          },
          confidence: {
            type: Type.STRING,
            description: "Confidence level in the validity of this thesis. Must be one of: 'High', 'Medium', 'Speculative'.",
          },
          rationale: {
            type: Type.STRING,
            description: "Why this convergence matters and what opportunity it presents.",
          },
          sources: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                url: { type: Type.STRING },
                date: { type: Type.STRING },
                sourceType: {
                  type: Type.STRING,
                  description: "Grounded source citation type. Must be one of: 'research_paper', 'news', 'social', 'video', 'patent', 'government'.",
                },
              },
              required: ["title", "url", "date", "sourceType"],
            },
            description: "Grounded source citations validating the thesis.",
          },
        },
        required: [
          "thesisStatement",
          "convergenceType",
          "domainsInvolved",
          "recencySignal",
          "maturity",
          "confidence",
          "rationale",
          "sources",
        ],
      },
    },
    companiesMentioned: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          ticker: { type: Type.STRING },
          marketCapTier: {
            type: Type.STRING,
            description: "Market capitalization category. Must be one of: 'micro', 'small', 'mid', 'large'.",
          },
          context: { type: Type.STRING, description: "Why the company is relevant to the convergence trend." },
          recentRally: { type: Type.BOOLEAN, description: "Whether the stock has rallied >30% in the last 6 months." },
        },
        required: ["name", "ticker", "marketCapTier", "context", "recentRally"],
      },
    },
    adjacentSignals: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Weak or early-stage signals that are not complete theses yet.",
    },
  },
  required: [
    "executiveSummary",
    "scanDate",
    "domainsScanned",
    "candidateTheses",
    "companiesMentioned",
    "adjacentSignals",
  ],
};

export const generateTrendResearchReport = async (
  domains: string[],
  mode: 'guided' | 'open',
  customPrompt: string | null
): Promise<TrendResearchReport> => {
  // No mock fallback: failures propagate so the UI shows a real error instead of fake research.
  // Placeholder reports are only served by the route when DEMO_MODE=true.
  if (!isGeminiConfigured()) {
    throw new Error("GOOGLE_GENAI_API_KEY is not configured in .env.local");
  }

  const domainsStr = domains.join(", ");
  const scanDateIso = new Date().toISOString().split('T')[0];

  let prompt = "";
  if (mode === 'open' && customPrompt) {
    prompt = `What emerging convergence technology trends connect with: "${customPrompt}"?
Focus on finding where demand signals in one industry intersect with supply capabilities in another.`;
  } else {
    prompt = `Perform an emerging technology scan for cross-domain convergence trends among the following research domains: [${domainsStr}].
Focus on finding where demand signals in one domain intersect with supply capabilities in another, creating investment opportunities before the broader market recognizes them.`;
  }

  const systemInstruction = `Role: You are a research analyst specializing in identifying emerging technology convergence trends for investment purposes. You focus on finding where demand signals in one industry intersect with supply capabilities in another.
Constraints:
- Only surface trends that have emerged or significantly accelerated in the past 30 days.
- Exclude any trend that has been widely covered for more than 180 days — if it is already consensus, it's priced in.
- Prioritize cross-domain convergence over single-domain trends.
- For any companies mentioned, flag their market cap tier (micro < $300M, small $300M-$2B, mid $2B-$10B, large > $10B) and check if they have rallied significantly (>30%) in the past 6 months.
- Source from: research papers, patent filings, government funding announcements, credible technology news, technical YouTube content, patent databases.
- Output Format: Return a structured JSON object matching the TrendResearchReport schema.`;

  const fullPrompt = `${systemInstruction}\n\nSearch Context & Scanned Domains: [${domainsStr}]\nInput Prompt: ${prompt}`;

  const response = await retryWithBackoff(() =>
    ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: fullPrompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: trendResearchReportSchema,
        tools: [{ googleSearch: {} }],
        temperature: 0.2,
      } as unknown as Record<string, unknown>,
    })
  );

  const jsonString = response.text?.trim();
  if (!jsonString) {
    throw new Error("Research scan failed: Gemini returned an empty response.");
  }

  const result = JSON.parse(jsonString) as TrendResearchReport;
  result.scanDate = scanDateIso;
  result.domainsScanned = domains;
  result.isDemo = false;
  return result;
};

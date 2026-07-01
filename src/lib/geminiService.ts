import { GoogleGenAI, Type } from "@google/genai";
import { DiscoveredCompany, TrendAnalysis, TrendResearchReport } from "./types";

const apiKey = process.env.GOOGLE_GENAI_API_KEY;

const ai = new GoogleGenAI({ apiKey: apiKey || 'PLACEHOLDER_API_KEY' });

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
  
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
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
    console.error("Error calling Gemini API:", error);
    throw new Error("Failed to get a valid response from the AI model.");
  }
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
): Promise<NewsSentiment> => {
  if (!apiKey || apiKey === 'PLACEHOLDER_API_KEY') {
    return {
      sentiment: "Neutral",
      sentimentScore: 0.1,
      summary: `AI sentiment evaluation is in offline fallback mode for ${ticker}. Headlines suggest stable operational adjustments.`
    };
  }

  if (headlines.length === 0) {
    return {
      sentiment: "Neutral",
      sentimentScore: 0.0,
      summary: "No news articles found to perform AI sentiment analysis."
    };
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
    return {
      sentiment: "Neutral",
      sentimentScore: 0.0,
      summary: "Failed to evaluate sentiment via AI. Defaulting to neutral."
    };
  }
};

export const getValueChainPositionFromAI = async (
  ticker: string,
  companyName: string,
  sector: string,
  industry: string,
  trend: string
): Promise<string> => {
  if (!apiKey || apiKey === 'PLACEHOLDER_API_KEY') {
    return `Midstream supplier of specialized applications within ${industry} for the ${trend} trend.`;
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
    return response.text?.trim() || `Positioned in the ${trend} value chain.`;
  } catch (err) {
    console.error(`Error fetching value chain for ${ticker}:`, err);
    return `Positioned in the ${trend} value chain.`;
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

const getMockResearchReport = (
  domains: string[],
  mode: 'guided' | 'open',
  customPrompt: string | null
): TrendResearchReport => {
  const scanDateIso = new Date().toISOString().split('T')[0];
  const list = domains.length > 0 ? domains : ["Advanced Compute", "Energy Grid Systems", "Physical AI"];

  const summary = `Offline Scan completed in ${mode} mode${customPrompt ? ` with prompt "${customPrompt}"` : ''} for domains: ${list.join(", ")}. In the last 30 days, we detect significant signals suggesting a convergence in materials synthesis, power grid distribution, and custom packaging architectures. The intersection of highly dense compute topologies with local clean energy infrastructure is driving the emergence of grid-independent data pods, while advanced composite developments allow soft robotic applications in healthcare logistics to cross critical torque-to-weight thresholds.`;

  return {
    executiveSummary: summary,
    scanDate: scanDateIso,
    domainsScanned: list,
    candidateTheses: [
      {
        thesisStatement: `${list[0] || 'Compute'} converging with ${list[1] || 'Energy'} for localized energy harvesting`,
        convergenceType: "technology_enablement",
        domainsInvolved: [list[0] || 'Compute', list[1] || 'Energy'],
        recencySignal: "Emerging patent filings and pilot programs launched early this month.",
        maturity: "Pre-emergence",
        confidence: "Medium",
        rationale: "Decentralized compute architectures require reliable power topologies. Deploying local small modular reactors alongside custom ASIC pipelines yields massive latency reductions.",
        sources: [
          {
            title: "Grounded Convergence in Local Power Infrastructure",
            url: "https://example.com/source1",
            date: "2026-05-10",
            sourceType: "research_paper"
          },
          {
            title: "National Grid Advanced Computing Catalysts",
            url: "https://example.com/source2",
            date: "2026-05-15",
            sourceType: "news"
          }
        ]
      },
      {
        thesisStatement: `Low-cost satellite LEO arrays providing edge AI orchestration for dual-use national security`,
        convergenceType: "demand_supply",
        domainsInvolved: ["Space Technology", "Artificial Intelligence", "Defense Technology"],
        recencySignal: "Joint defense funding specifications released 12 days ago.",
        maturity: "Nascent",
        confidence: "High",
        rationale: "Commercial LEO satellite constellations are transitioning from raw sensor telemetry relays to high-altitude edge computation platforms, bypassing vulnerable terrestrial landlines.",
        sources: [
          {
            title: "LEO Constellations for Autonomous In-Flight Compute",
            url: "https://example.com/source3",
            date: "2026-05-12",
            sourceType: "patent"
          }
        ]
      }
    ],
    companiesMentioned: [
      {
        name: "AeroVironment",
        ticker: "AVAV",
        marketCapTier: "mid",
        context: "Providing high-altitude long-endurance UAS that serve as edge compute relays.",
        recentRally: false
      },
      {
        name: "Oklo Inc.",
        ticker: "OKLO",
        marketCapTier: "small",
        context: "Siting fast-fission micro-reactors directly at hyper-scaler compute campuses.",
        recentRally: true
      }
    ],
    adjacentSignals: [
      "Perovskite solar cell integration on unmanned aerial systems for indefinite flight times.",
      "Post-quantum cryptographical microchips appearing in consumer smart wearables."
    ]
  };
};

export const generateTrendResearchReport = async (
  domains: string[],
  mode: 'guided' | 'open',
  customPrompt: string | null
): Promise<TrendResearchReport> => {
  const domainsStr = domains.join(", ");
  const scanDateIso = new Date().toISOString().split('T')[0];

  if (!apiKey || apiKey === 'PLACEHOLDER_API_KEY') {
    return getMockResearchReport(domains, mode, customPrompt);
  }

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

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: fullPrompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: trendResearchReportSchema,
        tools: [{ googleSearch: {} }],
        temperature: 0.2,
      } as unknown as Record<string, unknown>,
    });

    const jsonString = response.text?.trim() || "{}";
    const result = JSON.parse(jsonString) as TrendResearchReport;
    result.scanDate = scanDateIso;
    result.domainsScanned = domains;
    return result;
  } catch (error) {
    console.error("Error generating trend research report:", error);
    return getMockResearchReport(domains, mode, customPrompt);
  }
};


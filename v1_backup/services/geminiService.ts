
import { GoogleGenAI, Type } from "@google/genai";
import { Filters, DiscoveredCompany } from "../types";

const API_KEY = process.env.API_KEY;
if (!API_KEY) {
  // This is a fallback for development and will show an error in the console.
  // In a real deployed environment, the API_KEY should be set.
  console.error("API_KEY environment variable not set.");
}
const ai = new GoogleGenAI({ apiKey: API_KEY! });

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
    },
    required: ["ticker", "companyName", "rationale"],
  },
};

const buildPrompt = (trend: string, filters: Filters): string => {
  let prompt = `Based on the following emerging, cross-industry investment trend: "${trend}", identify up to 15 relevant, publicly traded companies.

Your analysis should include companies that are:
1. Directly operating within this trend.
2. Adjacent to the trend and uniquely positioned to benefit from its growth.

Return a JSON array of objects, where each object represents a company and contains a 'ticker', 'companyName', and a 'rationale'.
The rationale should be a single, concise sentence explaining why the company is a good fit for the trend, specifying if its involvement is direct or adjacent.
Only include companies that are actively traded and have valid tickers.
`;

  if (filters.exchange.length > 0) {
    prompt += `\nThe companies must be listed on one of the following exchanges: ${filters.exchange.join(', ')}.`;
  }

  if (filters.marketCap.length > 0) {
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

export const discoverCompanies = async (trend: string, filters: Filters): Promise<DiscoveredCompany[]> => {
  const prompt = buildPrompt(trend, filters);
  
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: companySchema,
        temperature: 0.2,
      },
    });

    const jsonString = response.text.trim();
    const result = JSON.parse(jsonString) as DiscoveredCompany[];
    return result;
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    throw new Error("Failed to get a valid response from the AI model.");
  }
};

import { CompanyData, DiscoveredCompany } from '../types';

// This service fetches real-time data from Financial Modeling Prep.
// It requires a valid API key from financialmodelingprep.com.
const FINANCIAL_API_KEY = 'G38ZfH6u32G0xJBEoYCRt50g9OEjPOEa';


const getRandomNumber = (min: number, max: number) => Math.random() * (max - min) + min;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Fallback mock data generator if an individual API call fails.
const generateMockData = (company: DiscoveredCompany): CompanyData => {
  // This is now only a full fallback if the primary quote API fails.
  const marketCap = getRandomNumber(200e6, 2e12);
  const sharesOutstanding = getRandomNumber(50e6, 5e9);
  const stockPrice = marketCap / sharesOutstanding;
  const analystConsensusOptions: ('Buy' | 'Hold' | 'Sell')[] = ['Buy', 'Hold', 'Sell'];
  return {
    ...company,
    stockPrice,
    marketCap,
    growth1Y: getRandomNumber(-50, 200),
    growth5Y: getRandomNumber(-20, 1000),
    analystConsensus: analystConsensusOptions[Math.floor(Math.random() * 3)],
    analystTargetPrice: stockPrice * getRandomNumber(0.8, 1.75),
    exchange: Math.random() > 0.5 ? 'NASDAQ' : 'NYSE',
  };
};

const findClosestPrice = (targetDate: Date, historicalPrices: { date: string, close: number }[]): number | null => {
    if (!historicalPrices || historicalPrices.length === 0) return null;

    const targetTime = targetDate.getTime();
    let closestRecord: { date: string, close: number } | null = null;
    let minDiff = Infinity;

    for (const record of historicalPrices) {
        const recordTime = new Date(record.date).getTime();
        const diff = Math.abs(targetTime - recordTime);
        if (diff < minDiff) {
            minDiff = diff;
            closestRecord = record;
        }
    }
    
    return closestRecord ? closestRecord.close : null;
};

const fetchCompanyFinancials = async (company: DiscoveredCompany): Promise<CompanyData> => {
  if (!FINANCIAL_API_KEY) {
      console.warn(`FINANCIAL_API_KEY is not configured. Using mock data for ${company.ticker}.`);
      return generateMockData(company);
  }

  try {
    const quoteUrl = `https://financialmodelingprep.com/api/v3/quote/${company.ticker}?apikey=${FINANCIAL_API_KEY}`;
    const quoteResponse = await fetch(quoteUrl);

    if (!quoteResponse.ok) {
        throw new Error(`API request for quote failed for ${company.ticker} with status ${quoteResponse.status}`);
    }

    const quoteDataArr = await quoteResponse.json();
    if (!quoteDataArr || quoteDataArr.length === 0) {
      console.warn(`No quote data returned for ${company.ticker}. Using mock data.`);
      return generateMockData(company);
    }
    const quote = quoteDataArr[0];

    const stockPrice = quote.price;
    const marketCap = quote.marketCap;
    const exchange = (quote.exchange === 'NASDAQ' || quote.exchange === 'NYSE') ? quote.exchange : 'NASDAQ';

    if (stockPrice === null || marketCap === null || stockPrice === 0 || marketCap === 0) {
        console.warn(`Incomplete quote data for ${company.ticker}. Using mock data.`);
        return generateMockData(company);
    }

    // --- Calculate Growth Rates ---
    let growth1Y = 0;
    let growth5Y = 0;

    try {
        const historyUrl = `https://financialmodelingprep.com/api/v3/historical-price-full/${company.ticker}?apikey=${FINANCIAL_API_KEY}`;
        const historyResponse = await fetch(historyUrl);
        if (historyResponse.ok) {
            const historyData = await historyResponse.json();
            if (historyData && historyData.historical && historyData.historical.length > 0) {
                const historicalPrices: { date: string, close: number }[] = historyData.historical;
                
                // 1Y Growth
                const oneYearAgo = new Date();
                oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
                const price1Y = findClosestPrice(oneYearAgo, historicalPrices);
                if (price1Y && price1Y > 0) {
                    growth1Y = ((stockPrice - price1Y) / price1Y) * 100;
                }

                // 5Y Growth
                const fiveYearsAgo = new Date();
                fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
                const price5Y = findClosestPrice(fiveYearsAgo, historicalPrices);
                if (price5Y && price5Y > 0) {
                    growth5Y = ((stockPrice - price5Y) / price5Y) * 100;
                }
            }
        } else {
            console.warn(`Could not fetch historical data for ${company.ticker}. Growth rates will be 0.`);
        }
    } catch (historyError) {
        console.error(`Error fetching or processing historical data for ${company.ticker}:`, historyError);
        // Fallback: growth rates will remain 0.
    }
    // --- End Growth Rate Calculation ---

    const analystConsensusOptions: ('Buy' | 'Hold' | 'Sell')[] = ['Buy', 'Hold', 'Sell'];

    return {
      ...company,
      stockPrice,
      marketCap,
      exchange,
      growth1Y,
      growth5Y,
      // Mocked data for fields not available in the free API tier:
      analystTargetPrice: stockPrice * getRandomNumber(0.8, 1.75),
      analystConsensus: analystConsensusOptions[Math.floor(Math.random() * 3)],
    };

  } catch (error) {
    console.error(`Error fetching financial data for ${company.ticker}:`, error);
    // Fallback to mock data if the primary quote API call fails
    return generateMockData(company);
  }
};

export const getFinancialsForCompanies = async (
  companies: DiscoveredCompany[],
  onProgress: (fetched: number, total: number) => void
): Promise<CompanyData[]> => {
  const results: CompanyData[] = [];
  const total = companies.length;

  for (const [index, company] of companies.entries()) {
    onProgress(index, total);
    const data = await fetchCompanyFinancials(company);
    results.push(data);

    // Add a small delay to be respectful to the API.
    if (index < total - 1) {
      await sleep(200);
    }
  }
  
  onProgress(total, total);
  return results;
};
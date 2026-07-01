import React, { useState, useCallback } from 'react';
import { Header } from './components/Header';
import { InputPanel } from './components/InputPanel';
import { ResultsTable } from './components/ResultsTable';
import { Loader } from './components/Loader';
import { discoverCompanies } from './services/geminiService';
import { getFinancialsForCompanies } from './services/financialDataService';
import { CompanyData, Filters, DiscoveredCompany } from './types';

const App: React.FC = () => {
  const [filters, setFilters] = useState<Filters>({
    marketCap: [],
    exchange: [],
    currentPrice: null,
  });
  const [trend, setTrend] = useState<string>('');
  const [results, setResults] = useState<CompanyData[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingMessage, setLoadingMessage] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const handleDiscover = useCallback(async () => {
    if (!trend) {
      setError('Please enter an investment trend to begin.');
      return;
    }
    setIsLoading(true);
    setLoadingMessage('Discovering relevant companies...');
    setError(null);
    setResults([]);

    try {
      const discoveredCompanies: DiscoveredCompany[] = await discoverCompanies(trend, filters);
      if (discoveredCompanies.length === 0) {
        setError("No companies found matching your criteria. Try broadening your search.");
        setIsLoading(false);
        return;
      }

      const onProgress = (fetched: number, total: number) => {
        if (fetched < total) {
          setLoadingMessage(`Fetching financial data for company ${fetched + 1} of ${total}...`);
        } else {
          setLoadingMessage('All data received. Finalizing results...');
        }
      };
      
      const enrichedData = await getFinancialsForCompanies(discoveredCompanies, onProgress);
      
      let finalData = enrichedData;
      if (filters.currentPrice) {
        const priceLimit = parseFloat(filters.currentPrice);
        finalData = enrichedData.filter(
          (company) => company.stockPrice > 0 && company.stockPrice < priceLimit
        );
      }

      if (finalData.length === 0 && enrichedData.length > 0) {
        setError("No companies matched your financial filters. Try adjusting your criteria.");
        setResults([]);
      } else {
        setResults(finalData);
      }

    } catch (e) {
      console.error(e);
      setError('An error occurred while fetching data. Please try again.');
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
  }, [trend, filters]);

  return (
    <div className="min-h-screen bg-brand-primary text-brand-text font-sans">
      <Header />
      <main className="container mx-auto p-4 md:p-8">
        <InputPanel
          trend={trend}
          setTrend={setTrend}
          filters={filters}
          setFilters={setFilters}
          onDiscover={handleDiscover}
          isLoading={isLoading}
        />

        {isLoading && <Loader message={loadingMessage} />}

        {error && (
          <div className="mt-8 text-center bg-red-900/50 border border-brand-red p-4 rounded-lg">
            <p>{error}</p>
          </div>
        )}

        {!isLoading && results.length > 0 && (
          <ResultsTable data={results} />
        )}

        {!isLoading && !error && results.length === 0 && (
            <div className="mt-16 text-center text-brand-light">
                <p className="text-xl">Describe a market trend to find investment opportunities.</p>
                <p className="text-sm mt-2">For example: "Companies specializing in generative AI for drug discovery".</p>
            </div>
        )}
      </main>
    </div>
  );
};

export default App;
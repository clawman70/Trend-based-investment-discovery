import React from 'react';
import { Filters } from '../types';

interface InputPanelProps {
  trend: string;
  setTrend: (trend: string) => void;
  filters: Filters;
  setFilters: (filters: Filters) => void;
  onDiscover: () => void;
  isLoading: boolean;
}

const marketCapOptions = [
  { value: 'MICRO', label: 'Micro-cap (<$300M)' },
  { value: 'SMALL', label: 'Small-cap ($300M-$2B)' },
  { value: 'MID', label: 'Mid-cap ($2B-$10B)' },
  { value: 'LARGE', label: 'Large-cap (>$10B)' },
];

const exchangeOptions = [
  { value: 'NASDAQ', label: 'NASDAQ' },
  { value: 'NYSE', label: 'NYSE' },
];

const priceOptions = [
  { value: '5', label: 'Less than $5' },
  { value: '10', label: 'Less than $10' },
  { value: '20', label: 'Less than $20' },
  { value: '50', label: 'Less than $50' },
  { value: 'ALL', label: 'Show me all prices' },
];

export const InputPanel: React.FC<InputPanelProps> = ({ trend, setTrend, filters, setFilters, onDiscover, isLoading }) => {
    
  const handleCheckboxFilterChange = (filterType: 'marketCap' | 'exchange', value: string) => {
    const currentValues = filters[filterType];
    const newValues = currentValues.includes(value)
      ? currentValues.filter((v) => v !== value)
      : [...currentValues, value];
    setFilters({ ...filters, [filterType]: newValues });
  };
    
  const handleCurrentPriceChange = (value: string) => {
    setFilters({ ...filters, currentPrice: value === 'ALL' ? null : value });
  };
    
  return (
    <div className="bg-brand-secondary p-6 rounded-lg shadow-lg">
      <h2 className="text-xl font-semibold mb-4 text-brand-light">1. Define Your Investment Thesis</h2>
      <textarea
        value={trend}
        onChange={(e) => setTrend(e.target.value)}
        placeholder="e.g., Companies enabling AI inference on edge devices, advancements in solid-state battery technology..."
        className="w-full h-24 p-3 bg-brand-primary border border-brand-accent rounded-md focus:ring-2 focus:ring-brand-green focus:outline-none transition duration-200"
        disabled={isLoading}
      />

      <h2 className="text-xl font-semibold mt-6 mb-4 text-brand-light">2. Apply Filters</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div>
          <h3 className="font-medium mb-2">Market Capitalization</h3>
          <div className="space-y-2">
            {marketCapOptions.map((option) => (
              <label key={option.value} className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="form-checkbox h-5 w-5 bg-brand-primary border-brand-accent rounded text-brand-green focus:ring-brand-green"
                  checked={filters.marketCap.includes(option.value)}
                  onChange={() => handleCheckboxFilterChange('marketCap', option.value)}
                  disabled={isLoading}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </div>
        <div>
          <h3 className="font-medium mb-2">Stock Exchange</h3>
          <div className="space-y-2">
            {exchangeOptions.map((option) => (
              <label key={option.value} className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="form-checkbox h-5 w-5 bg-brand-primary border-brand-accent rounded text-brand-green focus:ring-brand-green"
                  checked={filters.exchange.includes(option.value)}
                  onChange={() => handleCheckboxFilterChange('exchange', option.value)}
                  disabled={isLoading}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </div>
        <div>
          <h3 className="font-medium mb-2">Current Stock Price</h3>
          <div className="space-y-2">
            {priceOptions.map((option) => (
              <label key={option.value} className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name="currentPrice"
                  className="form-radio h-5 w-5 bg-brand-primary border-brand-accent rounded-full text-brand-green focus:ring-brand-green"
                  value={option.value}
                  checked={
                    option.value === 'ALL'
                      ? filters.currentPrice === null
                      : filters.currentPrice === option.value
                  }
                  onChange={() => handleCurrentPriceChange(option.value)}
                  disabled={isLoading}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
      
      <div className="mt-8 text-center">
        <button
          onClick={onDiscover}
          disabled={isLoading || !trend}
          className="w-full md:w-auto bg-brand-green text-brand-primary font-bold py-3 px-12 rounded-lg hover:bg-opacity-90 disabled:bg-brand-accent disabled:cursor-not-allowed transition duration-300 transform hover:scale-105 disabled:scale-100"
        >
          {isLoading ? 'Discovering...' : 'Discover Companies'}
        </button>
      </div>
    </div>
  );
};
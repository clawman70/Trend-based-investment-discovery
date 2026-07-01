
import React from 'react';
import { CompanyData } from '../types';
import { useSortableData } from '../hooks/useSortableData';
import { exportToCSV } from '../utils/csvExporter';
import { ArrowUpIcon, ArrowDownIcon, ExportIcon } from './icons';

interface ResultsTableProps {
  data: CompanyData[];
}

const formatNumber = (num: number) => new Intl.NumberFormat('en-US').format(num);
const formatCurrency = (num: number, decimals = 2) => `$${new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(num)}`;
const formatMarketCap = (mc: number) => {
    if (mc >= 1e12) return `${formatCurrency(mc / 1e12, 2)}T`;
    if (mc >= 1e9) return `${formatCurrency(mc / 1e9, 2)}B`;
    if (mc >= 1e6) return `${formatCurrency(mc / 1e6, 2)}M`;
    return formatCurrency(mc, 0);
};

const GrowthCell: React.FC<{ value: number }> = ({ value }) => (
    <span className={value >= 0 ? 'text-brand-green' : 'text-brand-red'}>
        {value >= 0 ? '+' : ''}{value.toFixed(2)}%
    </span>
);

export const ResultsTable: React.FC<ResultsTableProps> = ({ data }) => {
  const { items, requestSort, sortConfig } = useSortableData(data);

  const getSortIndicator = (key: keyof CompanyData) => {
    if (!sortConfig || sortConfig.key !== key) {
      return null;
    }
    return sortConfig.direction === 'ascending' ? <ArrowUpIcon /> : <ArrowDownIcon />;
  };

  const handleExport = () => {
    exportToCSV(items, 'investment_discovery_results.csv');
  };

  return (
    <div className="mt-8 bg-brand-secondary p-4 sm:p-6 rounded-lg shadow-lg">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold text-brand-light">Discovered Companies</h2>
        <button
          onClick={handleExport}
          className="flex items-center space-x-2 bg-brand-accent text-brand-text font-bold py-2 px-4 rounded-lg hover:bg-brand-light hover:text-brand-primary transition duration-300"
        >
          <ExportIcon />
          <span>Export to CSV</span>
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-brand-accent">
          <thead className="bg-brand-secondary">
            <tr>
              {tableHeaders.map((header) => (
                <th
                  key={header.key}
                  scope="col"
                  onClick={() => requestSort(header.key)}
                  className="px-4 py-3 text-left text-xs font-medium text-brand-light uppercase tracking-wider cursor-pointer select-none"
                >
                  <div className="flex items-center space-x-1">
                    <span>{header.label}</span>
                    {getSortIndicator(header.key)}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-brand-secondary divide-y divide-brand-accent">
            {items.map((item) => (
              <tr key={item.ticker} className="hover:bg-brand-accent/50">
                <td className="px-4 py-4 whitespace-nowrap">
                    <div className="font-bold">{item.companyName}</div>
                    <a
                      href={`https://www.google.com/finance?q=${item.exchange}:${item.ticker}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-brand-green hover:underline transition-colors"
                      aria-label={`View ${item.companyName} (${item.ticker}) on Google Finance`}
                    >
                      {item.ticker}
                    </a>
                </td>
                <td className="px-4 py-4 text-sm text-brand-light max-w-sm"><p className="whitespace-normal">{item.rationale}</p></td>
                <td className="px-4 py-4 whitespace-nowrap font-mono">{formatCurrency(item.stockPrice)}</td>
                <td className="px-4 py-4 whitespace-nowrap font-mono">{formatMarketCap(item.marketCap)}</td>
                <td className="px-4 py-4 whitespace-nowrap font-mono"><GrowthCell value={item.growth1Y} /></td>
                <td className="px-4 py-4 whitespace-nowrap font-mono"><GrowthCell value={item.growth5Y} /></td>
                <td className="px-4 py-4 whitespace-nowrap">{item.analystConsensus}</td>
                <td className="px-4 py-4 whitespace-nowrap font-mono">{formatCurrency(item.analystTargetPrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const tableHeaders: { key: keyof CompanyData, label: string }[] = [
    { key: 'companyName', label: 'Company' },
    { key: 'rationale', label: 'Rationale' },
    { key: 'stockPrice', label: 'Price' },
    { key: 'marketCap', label: 'Market Cap' },
    { key: 'growth1Y', label: '1Y Growth' },
    { key: 'growth5Y', label: '5Y Growth' },
    { key: 'analystConsensus', label: 'Consensus' },
    { key: 'analystTargetPrice', label: 'Target Price' },
];

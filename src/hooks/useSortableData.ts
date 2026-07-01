import { useState, useMemo } from 'react';
import { ScoredCompanyData, SortConfig, SortableKeys } from '../lib/types';

export const useSortableData = (items: ScoredCompanyData[], config: SortConfig | null = null) => {
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(config);

  const sortedItems = useMemo(() => {
    const sortableItems = [...items];
    if (sortConfig !== null) {
      sortableItems.sort((a, b) => {
        const aValue = a[sortConfig.key];
        const bValue = b[sortConfig.key];

        // Handle case where one of the values is null or undefined
        if (aValue === null || aValue === undefined) return 1;
        if (bValue === null || bValue === undefined) return -1;

        if (typeof aValue === 'number' && typeof bValue === 'number') {
           if (aValue < bValue) {
             return sortConfig.direction === 'ascending' ? -1 : 1;
           }
           if (aValue > bValue) {
             return sortConfig.direction === 'ascending' ? 1 : -1;
           }
           return 0;
        } else if (typeof aValue === 'string' && typeof bValue === 'string') {
            return sortConfig.direction === 'ascending'
              ? aValue.localeCompare(bValue)
              : bValue.localeCompare(aValue);
        } else if (Array.isArray(aValue) && Array.isArray(bValue)) {
            // Compare length of arrays (e.g. trendsMatched)
            if (aValue.length < bValue.length) {
              return sortConfig.direction === 'ascending' ? -1 : 1;
            }
            if (aValue.length > bValue.length) {
              return sortConfig.direction === 'ascending' ? 1 : -1;
            }
            return 0;
        }
        return 0;
      });
    }
    return sortableItems;
  }, [items, sortConfig]);

  const requestSort = (key: SortableKeys) => {
    let direction: 'ascending' | 'descending' = 'ascending';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'ascending') {
      direction = 'descending';
    }
    setSortConfig({ key, direction });
  };

  return { items: sortedItems, requestSort, sortConfig };
};

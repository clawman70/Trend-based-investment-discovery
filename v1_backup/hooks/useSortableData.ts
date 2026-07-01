
import { useState, useMemo } from 'react';
import { CompanyData, SortConfig, SortableKeys } from '../types';

export const useSortableData = (items: CompanyData[], config: SortConfig | null = null) => {
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(config);

  const sortedItems = useMemo(() => {
    let sortableItems = [...items];
    if (sortConfig !== null) {
      sortableItems.sort((a, b) => {
        const aValue = a[sortConfig.key];
        const bValue = b[sortConfig.key];

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

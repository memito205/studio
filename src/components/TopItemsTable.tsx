import React from 'react';
import { formatCurrency, formatNumber, formatPercentage } from '../services/formatters';
import { ClipboardIcon } from './icons';
import { FilterCategory, Filters } from '../types';

interface TableItem {
  name: string;
  quantity: number;
  value: number;
}

interface TopItemsTableProps {
  title: string;
  data: TableItem[];
  totalValue: number;
  filterCategory: FilterCategory;
  onFilterChange: (category: FilterCategory, value: string) => void;
  activeFilters: Filters;
  isPrinting?: boolean;
}

export const TopItemsTable: React.FC<TopItemsTableProps> = ({ title, data, totalValue, filterCategory, onFilterChange, activeFilters, isPrinting }) => {
  
  const tableContent = (
    <table className="w-full text-sm">
      <thead className={!isPrinting ? "sticky top-0 bg-white dark:bg-slate-800 z-10" : "bg-slate-50 dark:bg-slate-700"}>
        <tr className="text-slate-500 dark:text-slate-400 font-medium">
          <th className="py-2 px-4 text-left">Categoría</th>
          <th className="py-2 px-4 text-right">Cantidad</th>
          <th className="py-2 px-4 text-right">Valor</th>
          <th className="py-2 px-4 text-right">% Part.</th>
        </tr>
      </thead>
      <tbody>
        {data.map((item, index) => {
          const isActive = activeFilters[filterCategory]?.includes(item.name);
          return (
            <tr 
              key={index} 
              className={`border-b border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 ${!isPrinting ? `hover:bg-slate-100 dark:hover:bg-slate-700/50 cursor-pointer ${isActive ? 'bg-indigo-100 dark:bg-indigo-900/50' : ''}` : ''}`}
              onClick={() => !isPrinting && onFilterChange(filterCategory, item.name)}
            >
              <td className="py-3 px-4 text-left font-medium text-slate-800 dark:text-slate-200">{item.name}</td>
              <td className="py-3 px-4 text-right">{formatNumber(item.quantity)}</td>
              <td className="py-3 px-4 text-right">{formatCurrency(item.value)}</td>
              <td className="py-3 px-4 text-right">{totalValue > 0 ? formatPercentage(item.value / totalValue) : '0.00%'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  // Simplified structure for printing that expands to show all content
  if (isPrinting) {
    return (
      <div className="top-items-table bg-white p-6 rounded-lg print-no-shadow">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h3>
        </div>
        {tableContent}
      </div>
    );
  }

  // Original structure for screen with fixed height and scroll
  return (
    <div className="top-items-table bg-white dark:bg-slate-800 p-6 rounded-lg shadow-md flex flex-col h-[450px] print-no-shadow">
      <div className="flex justify-between items-center mb-4 flex-shrink-0">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h3>
        <button className="p-1.5 bg-slate-100 dark:bg-slate-700/50 rounded-md text-slate-500 dark:text-slate-400 screen-only">
          <ClipboardIcon className="w-5 h-5" />
        </button>
      </div>
      <div className="overflow-y-auto min-h-0">
        {tableContent}
      </div>
    </div>
  );
};
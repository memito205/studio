import React from 'react';
import { formatCurrency } from '../utils/formatters';

interface MetricTableProps {
  title: string;
  data: { name: string; total: number; percentage: number }[];
  headers: [string, string, string];
  onRowClick?: (name: string) => void;
  selectedItems?: string[];
}

const formatPercentage = (value: number) => {
    return `${(value * 100).toFixed(2)}%`;
}

// FIX: Update default value of onRowClick to match function signature with one argument.
const MetricTable: React.FC<MetricTableProps> = ({ title, data, headers, onRowClick = (name: string) => {}, selectedItems = [] }) => {
    const totalSum = data.reduce((sum, item) => sum + item.total, 0);

    return (
        <div className="bg-white p-6 rounded-xl shadow-lg flex flex-col h-full">
            <h3 className="text-xl font-bold text-slate-800 mb-4">{title}</h3>
            <div className="flex-grow overflow-y-auto pr-2" style={{maxHeight: '400px'}}>
                <table className="min-w-full">
                    <thead className="bg-slate-50 sticky top-0 z-10">
                        <tr>
                            <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{headers[0]}</th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">{headers[1]}</th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">{headers[2]}</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-200">
                        {data.map((item) => {
                            const isSelected = selectedItems.includes(item.name);
                            return (
                                <tr 
                                  key={item.name} 
                                  onClick={() => onRowClick(item.name)}
                                  className={`transition-colors duration-150 ${isSelected ? 'bg-blue-100' : 'hover:bg-slate-50'} cursor-pointer`}
                                >
                                    <td className={`px-4 py-2 whitespace-nowrap text-sm font-medium truncate max-w-xs ${isSelected ? 'text-blue-800' : 'text-slate-900'}`}>{item.name}</td>
                                    <td className={`px-4 py-2 whitespace-nowrap text-sm text-right ${isSelected ? 'text-blue-700' : 'text-slate-600'}`}>{formatCurrency(item.total)}</td>
                                    <td className={`px-4 py-2 whitespace-nowrap text-sm text-right ${isSelected ? 'text-blue-700' : 'text-slate-600'}`}>{formatPercentage(item.percentage)}</td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
            <div className="mt-auto pt-2 border-t border-slate-200">
                <div className="flex justify-between font-bold text-sm text-slate-800 px-4 py-1">
                    <span>Total (Mostrado)</span>
                    <div className="flex">
                        <span className="w-28 text-right">{formatCurrency(totalSum)}</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MetricTable;
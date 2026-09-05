

import React from 'react';
import { formatCurrency } from '../utils/formatters';

interface ComparativeData {
    name: string;
    current: number;
    previous: number;
}

interface ComparativeBreakdownProps {
  title: string;
  data: ComparativeData[];
  onRowClick?: (name: string) => void;
  selectedItems?: string[];
  fullHeight?: boolean;
}

const formatChange = (current: number, previous: number) => {
    if (previous === 0) {
        return current > 0 ? <span className="text-green-600">Nuevo</span> : '-';
    }
    const change = ((current - previous) / previous) * 100;
    const color = change > 0 ? 'text-green-600' : 'text-red-600';
    return <span className={color}>{change.toFixed(1)}%</span>
}

// FIX: Update default value of onRowClick to match function signature with one argument.
const ComparativeBreakdown: React.FC<ComparativeBreakdownProps> = ({ title, data, onRowClick = (name: string) => {}, selectedItems = [], fullHeight = false }) => {
    return (
        <div className={`bg-white p-6 rounded-xl shadow-lg flex flex-col ${fullHeight ? '' : 'h-full'}`}>
            <h3 className="text-xl font-bold text-slate-800 mb-4">{title}</h3>
            <div 
                className="flex-grow overflow-y-auto pr-2"
                style={fullHeight ? {} : {maxHeight: '400px'}}
            >
                <table className="min-w-full">
                    <thead className="bg-slate-50 sticky top-0 z-10">
                        <tr>
                            <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Nombre</th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Actual</th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Anterior</th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">% Cambio</th>
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
                                    <td className={`px-4 py-2 whitespace-nowrap text-sm text-right ${isSelected ? 'text-blue-700' : 'text-slate-600'}`}>{formatCurrency(item.current)}</td>
                                    <td className={`px-4 py-2 whitespace-nowrap text-sm text-right ${isSelected ? 'text-blue-700' : 'text-slate-600'}`}>{formatCurrency(item.previous)}</td>
                                    <td className={`px-4 py-2 whitespace-nowrap text-sm text-right font-medium`}>{formatChange(item.current, item.previous)}</td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default ComparativeBreakdown;
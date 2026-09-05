import React from 'react';
import { ActiveFilters, FilterCategory } from '../types';

interface FilterSummaryProps {
    activeFilters: ActiveFilters;
    onClear: (category: FilterCategory, value: string) => void;
    onClearAll: () => void;
}

const categoryLabels: { [key in FilterCategory]: string } = {
    carriers: 'Transportadora',
    concepts: 'Concepto',
    destinations: 'Destino',
    months: 'Mes'
};

const formatMonth = (monthKey: string) => {
    const [year, month] = monthKey.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1);
    return date.toLocaleString('es-CO', { month: 'long', year: 'numeric' });
};

const FilterTag: React.FC<{
    category: FilterCategory;
    value: string;
    onClear: (category: FilterCategory, value: string) => void;
}> = ({ category, value, onClear }) => (
    <span className="flex items-center bg-blue-100 text-blue-800 text-sm font-medium px-2.5 py-1 rounded-full">
        <span className="font-semibold mr-1">{categoryLabels[category]}:</span>
        {category === 'months' ? formatMonth(value) : value}
        <button onClick={() => onClear(category, value)} className="ml-2 text-blue-500 hover:text-blue-700">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
        </button>
    </span>
);

const FilterSummary: React.FC<FilterSummaryProps> = ({ activeFilters, onClear, onClearAll }) => {
    // FIX: Cast `values` to string[] to ensure TypeScript correctly infers its type.
    const allFilters = Object.entries(activeFilters).flatMap(([category, values]) => 
        (values as string[]).map(value => ({ category: category as FilterCategory, value }))
    );

    if (allFilters.length === 0) {
        return null;
    }

    return (
        <div className="bg-white p-4 rounded-xl shadow-lg flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center flex-wrap gap-2">
                <span className="text-sm font-medium text-slate-700 mr-2">Filtros Activos:</span>
                {allFilters.map(({ category, value }) => (
                    <FilterTag key={`${category}-${value}`} category={category} value={value} onClear={onClear} />
                ))}
            </div>
            <button
                onClick={onClearAll}
                className="text-sm font-medium text-red-600 hover:text-red-800 transition-colors"
            >
                Limpiar todo
            </button>
        </div>
    );
};

export default FilterSummary;

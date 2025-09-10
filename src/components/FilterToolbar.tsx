
"use client";

import React from 'react';
import { Button } from './ui/button';
import { Filter, FileDown } from 'lucide-react';
import type { FilterType99Minutos, FilterTypeLogicuartas } from '@/types';

type FilterType = FilterType99Minutos | FilterTypeLogicuartas;

interface FilterDefinition {
    type: FilterType;
    label: string;
}

interface FilterToolbarProps {
    activeFilters: Set<FilterType>;
    onFilterChange: (filter: FilterType) => void;
    filteredDataCount: number;
    totalDataCount: number;
    onDownload: () => void;
    filterDefinitions: FilterDefinition[];
}

export const FilterToolbar: React.FC<FilterToolbarProps> = ({ 
    activeFilters, 
    onFilterChange, 
    filteredDataCount, 
    totalDataCount,
    onDownload,
    filterDefinitions
}) => {
    
    const FilterButton: React.FC<{ filterType: FilterType; label: string }> = ({ filterType, label }) => (
        <Button
            variant={activeFilters.has(filterType) ? 'default' : 'outline'}
            onClick={() => onFilterChange(filterType)}
            className="h-8"
        >
            {label}
        </Button>
    );

    return (
        <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2 font-semibold text-slate-200">
                <Filter className="w-5 h-5"/>
                <span>Filtrar Novedades:</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                {filterDefinitions.map(def => (
                    <FilterButton key={def.type} filterType={def.type} label={def.label} />
                ))}
            </div>
            <div className="flex-grow" />
            <div className="flex items-center gap-4">
                <div className="text-sm text-slate-400">
                    Mostrando {filteredDataCount.toLocaleString()} de {totalDataCount.toLocaleString()} filas
                </div>
                <Button onClick={onDownload} variant="secondary" size="sm">
                    <FileDown className="mr-2 h-4 w-4" />
                    Exportar Excel
                </Button>
            </div>
        </div>
    );
};

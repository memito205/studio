import React, { useMemo, useState, useEffect } from 'react';
import type { Allocation } from '../types';
import { generatePivotData } from '../services/exportService';

interface DistributionPivotTableProps {
  allocations: Allocation | null;
}

const DistributionPivotTable: React.FC<DistributionPivotTableProps> = ({ allocations }) => {
    const [selectedReference, setSelectedReference] = useState<string>('all');

    const fullPivotData = useMemo(() => {
        return generatePivotData(allocations);
    }, [allocations]);

    const uniqueReferences = useMemo(() => {
        return [...new Set(fullPivotData.data.map(d => d['Referencia'] as string))].sort();
    }, [fullPivotData.data]);

    useEffect(() => {
        if (uniqueReferences.length > 0 && !uniqueReferences.includes(selectedReference) && selectedReference !== 'all') {
            setSelectedReference('all');
        }
    }, [uniqueReferences, selectedReference]);

    const { headers, data: filteredData } = useMemo(() => {
        if (selectedReference === 'all' || !fullPivotData.data) {
            return fullPivotData;
        }
        const data = fullPivotData.data.filter(d => d['Referencia'] === selectedReference);
        return { headers: fullPivotData.headers, data };
    }, [fullPivotData, selectedReference]);

    if (!fullPivotData.data || fullPivotData.data.length === 0) {
        return null;
    }

    return (
        <div className="my-10 bg-white p-6 sm:p-8 rounded-2xl shadow-lg border border-gray-200">
            <div className="flex flex-col sm:flex-row justify-between items-center mb-6 gap-4">
                <h3 className="text-2xl font-bold text-gray-800 text-center sm:text-left whitespace-nowrap">Resumen de Reparto</h3>
                <div className="w-full sm:w-auto sm:min-w-[250px] sm:max-w-xs">
                    <label htmlFor="ref-filter" className="block text-sm font-medium text-gray-700 mb-1">
                        Filtrar por Referencia
                    </label>
                    <select
                        id="ref-filter"
                        name="ref-filter"
                        className="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-ring focus:border-ring sm:text-sm rounded-md shadow-sm"
                        value={selectedReference}
                        onChange={(e) => setSelectedReference(e.target.value)}
                        aria-label="Filtrar reparto por referencia"
                    >
                        <option value="all">-- Todas las Referencias --</option>
                        {uniqueReferences.map(ref => (
                            <option key={ref} value={ref}>{ref}</option>
                        ))}
                    </select>
                </div>
            </div>
            <div className="overflow-x-auto rounded-lg border max-h-[600px]">
                <table className="min-w-full text-sm divide-y divide-gray-200 border-collapse">
                    <thead className="bg-gray-100">
                        <tr>
                            {headers.map((header, index) => (
                                <th key={header} scope="col" className={`
                                    px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider
                                    sticky top-0 bg-gray-100 z-10
                                    ${index === 0 ? 'left-0 z-20 min-w-[180px]' : ''}
                                    ${index === 1 ? 'left-[180px] z-20 min-w-[80px]' : ''}
                                `}>
                                    {header}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {filteredData.length > 0 ? (
                            filteredData.map((row, rowIndex) => (
                                <tr key={rowIndex} className="hover:bg-gray-50 transition-colors">
                                    {headers.map((header, colIndex) => (
                                        <td key={`${rowIndex}-${header}`} className={`
                                            px-4 py-2 whitespace-nowrap
                                            ${colIndex < 2 ? 'font-medium text-gray-800 sticky bg-white hover:bg-gray-50' : 'text-center text-gray-600'}
                                            ${colIndex === 0 ? 'left-0 min-w-[180px]' : ''}
                                            ${colIndex === 1 ? 'left-[180px] min-w-[80px]' : ''}
                                        `}>
                                            {String(row[header as keyof typeof row] ?? 0)}
                                        </td>
                                    ))}
                                </tr>
                            ))
                        ) : (
                            <tr>
                                <td colSpan={headers.length || 1} className="text-center py-10 px-4 text-gray-500">
                                    No hay datos de reparto para la referencia seleccionada.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
            <p className="text-xs text-gray-500 mt-4 text-center">Las celdas con '0' indican que no se asignaron unidades de esa talla a esa bodega.</p>
        </div>
    );
};

export default DistributionPivotTable;

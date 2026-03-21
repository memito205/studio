import React, { useMemo } from 'react';
import type { Allocation, StockItem, DistributionRule } from '../types';
import { generateSummaryData } from '../services/exportService';

interface SummaryTableProps {
  allocations: Allocation | null;
  stock: StockItem[] | null;
  plan: DistributionRule[] | null;
}

const SummaryTable: React.FC<SummaryTableProps> = ({ allocations, stock, plan }) => {
    const summaryData = useMemo(() => {
        return generateSummaryData(stock, plan, allocations);
    }, [allocations, stock, plan]);

    if (!summaryData || summaryData.length === 0) {
        return null;
    }

    const headers = Object.keys(summaryData[0]);

    return (
        <div className="mb-10 bg-white p-6 sm:p-8 rounded-2xl shadow-lg border border-gray-200">
            <h3 className="text-2xl font-bold text-gray-800 text-center mb-6">Tabla de Resumen por Referencia</h3>
            <div className="overflow-x-auto rounded-lg border">
                <table className="min-w-full text-sm divide-y divide-gray-200">
                    <thead className="bg-gray-100">
                        <tr>
                            {headers.map(key => (
                                <th key={key} scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">{key}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {summaryData.map((row, index) => (
                            <tr key={index} className="hover:bg-gray-50 transition-colors">
                                {headers.map(header => (
                                    <td key={`${index}-${header}`} className="px-6 py-4 whitespace-nowrap text-gray-800 font-medium">
                                        {String(row[header as keyof typeof row])}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default SummaryTable;

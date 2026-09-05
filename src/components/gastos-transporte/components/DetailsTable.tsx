import React, { useState, useMemo } from 'react';
import { ExpenseRecord } from '../types';
import { formatCurrency } from '../utils/formatters';

// The record type passed from Dashboard.tsx
type DetailedExpenseRecord = ExpenseRecord & { carrierName: string };

interface DetailsTableProps {
  records: DetailedExpenseRecord[];
}

// Constants
const RECORDS_PER_PAGE = 15;

// Sort Arrow component
const SortArrow: React.FC<{ direction?: 'ascending' | 'descending' }> = ({ direction }) => {
    if (!direction) return null;
    return <span className="ml-1">{direction === 'ascending' ? '▲' : '▼'}</span>;
};

const DetailsTable: React.FC<DetailsTableProps> = ({ records }) => {
    const [currentPage, setCurrentPage] = useState(1);
    const [sortConfig, setSortConfig] = useState<{ key: keyof DetailedExpenseRecord, direction: 'ascending' | 'descending' } | null>({ key: 'fecha', direction: 'descending' });

    const sortedRecords = useMemo(() => {
        let sortableRecords = [...records];
        if (sortConfig !== null) {
            sortableRecords.sort((a, b) => {
                const valA = a[sortConfig.key];
                const valB = b[sortConfig.key];

                if (valA === undefined || valB === undefined) return 0;
                
                if (valA < valB) {
                    return sortConfig.direction === 'ascending' ? -1 : 1;
                }
                if (valA > valB) {
                    return sortConfig.direction === 'ascending' ? 1 : -1;
                }
                return 0;
            });
        }
        return sortableRecords;
    }, [records, sortConfig]);

    const totalPages = Math.ceil(sortedRecords.length / RECORDS_PER_PAGE);

    const paginatedRecords = useMemo(() => {
        const startIndex = (currentPage - 1) * RECORDS_PER_PAGE;
        return sortedRecords.slice(startIndex, startIndex + RECORDS_PER_PAGE);
    }, [sortedRecords, currentPage]);

    const requestSort = (key: keyof DetailedExpenseRecord) => {
        let direction: 'ascending' | 'descending' = 'ascending';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'ascending') {
            direction = 'descending';
        }
        setSortConfig({ key, direction });
        setCurrentPage(1); // Reset to first page on sort
    };

    const handlePageChange = (page: number) => {
        if (page > 0 && page <= totalPages) {
            setCurrentPage(page);
        }
    };
    
    const headers: { key: keyof DetailedExpenseRecord, label: string }[] = [
        { key: 'fecha', label: 'Fecha' },
        { key: 'carrierName', label: 'Transportadora' },
        { key: 'contable', label: 'Factura / Guía' },
        { key: 'concepto', label: 'Concepto' },
        { key: 'destino', label: 'Destino' },
        { key: 'costo', label: 'Costo' }
    ];

    if (records.length === 0) {
        return null; // Don't render if no filtered records exist
    }

    return (
        <div className="bg-white p-6 rounded-xl shadow-lg">
            <h3 className="text-xl font-bold text-slate-800 mb-4">Detalle de Registros Filtrados</h3>
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-slate-50">
                        <tr>
                            {headers.map(({ key, label }) => (
                                <th 
                                    key={key} 
                                    className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer select-none"
                                    onClick={() => requestSort(key)}
                                >
                                    <div className="flex items-center">
                                        {label}
                                        <SortArrow direction={sortConfig?.key === key ? sortConfig.direction : undefined} />
                                    </div>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-200">
                        {paginatedRecords.map((record, index) => (
                            <tr key={`${record.contable}-${index}`} className="hover:bg-slate-50">
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">{record.fecha}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">{record.carrierName}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">
                                    <div>
                                        <span>{record.contable}</span>
                                        {record.modificacionNC && (
                                            <span className="block text-blue-600 italic text-xs">{record.modificacionNC}</span>
                                        )}
                                    </div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700 truncate max-w-xs">{record.concepto}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700 truncate max-w-xs">{record.destino}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700 text-right">{formatCurrency(record.costo)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            
            {totalPages > 1 && (
                 <div className="flex items-center justify-between pt-4 border-t border-slate-200 mt-4">
                    <span className="text-sm text-slate-600">
                        Mostrando {paginatedRecords.length} de {records.length} registros
                    </span>
                    <div className="flex items-center space-x-2">
                         <button onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1} className="px-3 py-1 border border-slate-300 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50">
                            Anterior
                         </button>
                         <span className="text-sm text-slate-700">
                            Página {currentPage} de {totalPages}
                         </span>
                         <button onClick={() => handlePageChange(currentPage + 1)} disabled={currentPage === totalPages} className="px-3 py-1 border border-slate-300 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50">
                            Siguiente
                         </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DetailsTable;
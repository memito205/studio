
"use client";

import React from 'react';
import type { ProcessedData } from '../types';
import { InfoIcon } from './bag-distribution/icons/InfoIcon'; // Reusing icon
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EditableCell } from './EditableCell'; // Reusable component
import { cn } from '@/lib/utils';
import { findCaseInsensitiveKey } from '@/lib/parsingUtils';

interface ResultsTableProps {
  results: ProcessedData;
  onDataChange?: (rowIndex: number, columnId: string, value: any) => void;
  isEditable?: boolean;
}

const ResultsTable: React.FC<ResultsTableProps> = ({ results, onDataChange, isEditable = false }) => {
  const { headers, data } = results;

  return (
    <div className="w-full mt-2 bg-slate-800/50 rounded-b-lg shadow-xl border border-t-0 border-slate-700">
        <ScrollArea className="w-full whitespace-nowrap">
            <div className="overflow-x-auto">
            <Table>
                <TableHeader>
                <TableRow>
                    {headers.map((header) => (
                    <TableHead key={header} className="px-6 py-3 whitespace-nowrap bg-slate-700 text-slate-300 sticky top-0 z-10">
                        {header}
                    </TableHead>
                    ))}
                </TableRow>
                </TableHeader>
                <TableBody>
                {data.length > 0 ? (
                    data.map((row) => {
                        const difFleteKey = findCaseInsensitiveKey(row, 'DIF FLETE');
                        const cobroDobleKey = findCaseInsensitiveKey(row, 'COBRO DOBLE');
                        const cargarAKey = findCaseInsensitiveKey(row, 'CARGAR A');
                        
                        return (
                        <TableRow key={row.originalIndex} className="border-b border-slate-700 even:bg-slate-900/50 odd:bg-slate-800/50 hover:bg-slate-700/50">
                            {headers.map((header) => {
                                // Determine cell styling based on content
                                const difFleteValue = difFleteKey ? Math.abs(parseFloat(String(row[difFleteKey]))) : 0;
                                const isDifFleteColumn = difFleteKey && header.toLowerCase() === difFleteKey.toLowerCase();
                                const isCobroDobleColumn = cobroDobleKey && header.toLowerCase() === cobroDobleKey.toLowerCase();
                                const isNoEncontradoColumn = cargarAKey && header.toLowerCase() === cargarAKey.toLowerCase();
                                const cobroDobleValue = cobroDobleKey ? row[cobroDobleKey] : '';
                                const noEncontradoValue = cargarAKey ? row[cargarAKey] : '';

                                const cellClassName = cn(
                                    (isDifFleteColumn && difFleteValue > 1) && 'text-red-400 font-bold',
                                    (isCobroDobleColumn && cobroDobleValue !== 'UN SOLO COBRO') && 'text-amber-400 font-bold',
                                    (isNoEncontradoColumn && noEncontradoValue === 'NO ENCONTRADO') && 'text-yellow-400'
                                );

                                return (
                                <TableCell key={`${row.originalIndex}-${header}`} className="px-2 py-1 whitespace-nowrap">
                                    {isEditable && onDataChange ? (
                                        <EditableCell
                                            value={row[header] ?? ''}
                                            onSave={(newValue) => onDataChange(row.originalIndex, header, newValue)}
                                            className={cellClassName}
                                        />
                                    ) : (
                                        <div className={`min-h-[32px] p-1 ${cellClassName}`}>
                                            {row[header] instanceof Date ? row[header].toLocaleDateString() : String(row[header] ?? '')}
                                        </div>
                                    )}
                                </TableCell>
                            )})}
                        </TableRow>
                    )})
                ) : (
                    <TableRow>
                        <TableCell colSpan={headers.length} className="text-center py-8">
                            <div className="flex flex-col items-center justify-center text-gray-500">
                                <InfoIcon />
                                <p className="mt-2">No hay datos para mostrar.</p>
                                <p>Verifica los errores o los archivos subidos.</p>
                            </div>
                        </TableCell>
                    </TableRow>
                )}
                </TableBody>
            </Table>
            </div>
            <ScrollBar orientation="horizontal" />
        </ScrollArea>
    </div>
  );
};

export default ResultsTable;

    
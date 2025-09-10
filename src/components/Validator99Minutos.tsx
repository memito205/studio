
"use client";

import React, { useState, useMemo, useCallback } from 'react';
import FileUpload from './FileUpload';
import ResultsTable from './ResultsTable';
import { useFileProcessor } from '../hooks/useFileProcessor';
import { Button } from './ui/button';
import { ArrowLeft, Download } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { FilterToolbar } from './FilterToolbar'; // Reusable component
import type { CsvRow, FilterType99Minutos } from '@/types';
import { exportToXlsx } from '@/services/export';
import { findCaseInsensitiveKey } from '@/lib/parsingUtils';
import Papa from 'papaparse';

const recalculateRow = (row: CsvRow): CsvRow => {
    let newRow = { ...row };
    
    // Header names (case-insensitive keys)
    const CARGAR_A_COL = findCaseInsensitiveKey(newRow, 'CARGAR A');
    const VTA_CON_NAC_COL = findCaseInsensitiveKey(newRow, 'vta con nac');
    const VALOR_NEGOCIADO_COL = findCaseInsensitiveKey(newRow, 'VALOR A COBRAR NEGOCIADO');
    const DIF_FLETE_COL = findCaseInsensitiveKey(newRow, 'DIF FLETE');
    const NOTES_COL = findCaseInsensitiveKey(newRow, 'NOTAS DEL ENVIO');
    const CLASIFICACION_ORIGINAL_COL = findCaseInsensitiveKey(newRow, 'CLASIFICACION');
    const CLASIFICACION_FINAL_COL = findCaseInsensitiveKey(newRow, 'CLASIFICACION FINAL');
    const OBSERVACIONES_COL = findCaseInsensitiveKey(newRow, 'OBSERVACIONES');
    const ACCION_COL = findCaseInsensitiveKey(newRow, 'ACCION');
    const CONTABLE_COL = findCaseInsensitiveKey(newRow, 'CONTABLE');
    const COBRO_DOBLE_COL = findCaseInsensitiveKey(newRow, 'COBRO DOBLE');

    // Recalculate DIF FLETE
    if (VTA_CON_NAC_COL && VALOR_NEGOCIADO_COL && DIF_FLETE_COL) {
        const vtaConNac = parseFloat(String(newRow[VTA_CON_NAC_COL] || '0'));
        const valorNegociado = parseFloat(String(newRow[VALOR_NEGOCIADO_COL] || '0'));
        if (!isNaN(vtaConNac) && !isNaN(valorNegociado)) {
            newRow[DIF_FLETE_COL] = String(vtaConNac - valorNegociado);
        }
    }
    
    // Set initial values based on 'CARGAR A' if OBSERVACIONES is empty or not manually edited
    if (CARGAR_A_COL && OBSERVACIONES_COL && (!newRow[OBSERVACIONES_COL] || newRow.observationManuallyEdited === undefined)) {
        const cargarAValue = newRow[CARGAR_A_COL];
        if (cargarAValue === 'UNOEE' && CONTABLE_COL) {
            newRow[OBSERVACIONES_COL] = 'CAMBIOS, GARANTIAS Y DEVOLUCIONES';
            newRow[CONTABLE_COL] = 'CAMBIOS, GARANTIAS Y DEVOLUCIONES';
        } else if (cargarAValue && cargarAValue !== 'NO ENCONTRADO' && CONTABLE_COL) {
            newRow[OBSERVACIONES_COL] = 'ENVIO NORMAL ECOMMERCE';
            newRow[CONTABLE_COL] = 'TRANSPORTE ECOMMERCE';
        }
    }

    // Set final classification based on notes
    if (NOTES_COL && CLASIFICACION_FINAL_COL) {
        const notesValue = String(newRow[NOTES_COL] || '');
        const match = notesValue.match(/cobro:\s*(si|no)/i);
        if (match) {
            newRow[CLASIFICACION_FINAL_COL] = match[1].toLowerCase() === 'si' ? 'CONTRAENTREGA' : 'ENVIO NORMAL';
        }
    }

    // Handle "devolucion" logic override
    if (CLASIFICACION_ORIGINAL_COL && String(newRow[CLASIFICACION_ORIGINAL_COL]).trim() === '6.DEVOLUCION') {
        const finalClassification = CLASIFICACION_FINAL_COL ? newRow[CLASIFICACION_FINAL_COL] : '';
        if (finalClassification === 'CONTRAENTREGA' && OBSERVACIONES_COL && CONTABLE_COL) {
            newRow[OBSERVACIONES_COL] = 'DEVOLUCION LOGISTICA DE COBRO';
            newRow[CONTABLE_COL] = 'DEV LOGISTICA COBRO';
        } else if (finalClassification === 'ENVIO NORMAL' && OBSERVACIONES_COL && CONTABLE_COL) {
            newRow[OBSERVACIONES_COL] = 'DEVOLUCION PAQUETE NO ENTREGADO EN PRIMER DESPACHO';
            newRow[CONTABLE_COL] = 'DEVOLUCION';
        }
    }

    // Set ACTION based on DIF FLETE and OBSERVACIONES
    if (DIF_FLETE_COL && ACCION_COL && (!newRow[ACCION_COL] || newRow.actionManuallyEdited === undefined)) {
        if (String(newRow[DIF_FLETE_COL]) === '0') {
            newRow[ACCION_COL] = 'OK VALOR';
        } else if (OBSERVACIONES_COL && newRow[OBSERVACIONES_COL] === 'CAMBIOS, GARANTIAS Y DEVOLUCIONES') {
            newRow[ACCION_COL] = 'ASUMIR FLETE MAYOR VALOR';
        }
    }
    
    return newRow;
}


interface Validator99MinutosProps {
  onReturn: () => void;
}

const Validator99Minutos: React.FC<Validator99MinutosProps> = ({ onReturn }) => {
  const [minutosFile, setMinutosFile] = useState<File | null>(null);
  const [siopFile, setSiopFile] = useState<File | null>(null);
  const [historicalFiles, setHistoricalFiles] = useState<File[]>([]);
  const { isLoading, error, results, processFiles, setResults } = useFileProcessor();
  const [activeFilters, setActiveFilters] = useState(new Set<FilterType99Minutos>());
  const { toast } = useToast();

  const handleDataChange = useCallback((rowIndex: number, columnId: string, value: any) => {
    if (!results) return;

    setResults(prevResults => {
        if (!prevResults) return null;
        
        const newData = [...prevResults.data];
        const arrayIndex = newData.findIndex(row => row.originalIndex === rowIndex);
        
        if (arrayIndex !== -1) {
            const rowToUpdate = { ...newData[arrayIndex] };
            rowToUpdate[columnId] = value;
            
            // Flag manual edits
            if (columnId.toLowerCase() === 'observaciones') {
                rowToUpdate.observationManuallyEdited = true;
            }
             if (columnId.toLowerCase() === 'accion') {
                rowToUpdate.actionManuallyEdited = true;
            }

            const recalculatedRow = recalculateRow(rowToUpdate);
            newData[arrayIndex] = recalculatedRow;
        }

        return { ...prevResults, data: newData };
    });
  }, [results, setResults]);


  const handleFilterChange = (filter: FilterType99Minutos) => {
    setActiveFilters(prev => {
        const newFilters = new Set(prev);
        if (newFilters.has(filter)) {
            newFilters.delete(filter);
        } else {
            newFilters.add(filter);
        }
        return newFilters;
    });
  };

  const handleProcess = () => {
    if (minutosFile && siopFile && historicalFiles.length > 0) {
      processFiles(minutosFile, siopFile, historicalFiles);
    } else {
      toast({
        variant: "destructive",
        title: "Archivos Faltantes",
        description: "Por favor, asegúrese de cargar todos los archivos requeridos."
      })
    }
  };
  
  const handleReset = () => {
    setMinutosFile(null);
    setSiopFile(null);
    setHistoricalFiles([]);
    processFiles(null, null, []); 
  };
  
   const getFilteredDataForExport = () => {
    if (!results) return [];
    if (activeFilters.size > 0) {
        return filteredData;
    }
    return results.data;
  }

  const handleDownloadXlsx = () => {
    if (!results) return;

    const dataToExport = getFilteredDataForExport();

    if (dataToExport.length === 0) {
       toast({ variant: "destructive", title: "No hay datos para exportar", description: "El filtro actual no produce ningún resultado." });
       return;
    }

    const finalData = dataToExport.map(row => {
        const orderedRow: CsvRow = {};
        results.headers.forEach(header => {
            orderedRow[header] = row[header];
        });
        return orderedRow;
    });

    exportToXlsx(finalData, `Conciliacion_99Minutos_Filtrada`);
  };

  const handleDownloadCsv = () => {
      if (!results) return;
      
      const dataToExport = getFilteredDataForExport();

      if (dataToExport.length === 0) {
         toast({ variant: "destructive", title: "No hay datos para exportar", description: "El filtro actual no produce ningún resultado." });
         return;
      }
      
      const csv = Papa.unparse(dataToExport);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", "Conciliacion_99Minutos_Filtrada.csv");
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  }

  const filteredData = useMemo(() => {
    if (!results) return [];
    if (activeFilters.size === 0) {
        return results.data;
    }
    return results.data.filter(row => {
        if (activeFilters.has('no_siop') && findCaseInsensitiveKey(row, 'CARGAR A') && row[findCaseInsensitiveKey(row, 'CARGAR A')!] === 'NO ENCONTRADO') return true;
        if (activeFilters.has('diferencias') && findCaseInsensitiveKey(row, 'DIF FLETE') && Math.abs(parseFloat(row[findCaseInsensitiveKey(row, 'DIF FLETE')!] || '0')) > 1) return true;
        if (activeFilters.has('dobles') && findCaseInsensitiveKey(row, 'COBRO DOBLE') && row[findCaseInsensitiveKey(row, 'COBRO DOBLE')!] !== 'UN SOLO COBRO') return true;
        return false;
    });
  }, [results, activeFilters]);

  const canProcess = minutosFile && siopFile && historicalFiles.length > 0 && !isLoading;

  return (
    <div className="min-h-screen bg-slate-900 text-gray-200 flex flex-col items-center p-4 sm:p-6 lg:p-8 rounded-lg">
      <div className="w-full max-w-7xl mx-auto">
        <header className="text-center mb-10 relative">
          <Button onClick={onReturn} variant="ghost" className="absolute top-0 left-0 text-slate-300 hover:bg-slate-700 hover:text-white">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver
          </Button>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-300">
            Validador de Facturación
          </h1>
          <p className="mt-2 text-lg text-slate-400">
            Cruza los datos de <span className="font-semibold text-white">99 Minutos</span> con <span className="font-semibold text-white">SIOP</span> y <span className="font-semibold text-white">Archivos Históricos</span> para validar la facturación.
          </p>
        </header>

        <main>
          {!results && (
            <>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <FileUpload
                  onFileSelect={(files) => setMinutosFile(files[0] || null)}
                  title="1. Subir Archivo 99 Minutos"
                  id="minutos-file-input"
                />
                <FileUpload
                  onFileSelect={(files) => setSiopFile(files[0] || null)}
                  title="2. Subir Archivo SIOP"
                  id="siop-file-input"
                />
                 <FileUpload
                  onFileSelect={setHistoricalFiles}
                  title="3. Subir Archivos Históricos"
                  id="historical-files-input"
                  multiple={true}
                  allowDirectory={true}
                />
              </div>

              <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
                <button
                  onClick={handleProcess}
                  disabled={!canProcess}
                  className="w-full sm:w-auto flex items-center justify-center px-8 py-3 bg-blue-600 text-white font-bold rounded-lg shadow-lg hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed disabled:text-slate-400 transition-all duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-75"
                >
                  {isLoading ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Procesando...
                    </>
                  ) : (
                    'Procesar Archivos'
                  )}
                </button>
              </div>
            </>
          )}

          {error && (
            <div className="mt-8 p-4 bg-red-900/50 border border-red-700 text-red-300 rounded-lg text-center">
              <strong>Error:</strong> {error}
            </div>
          )}

          {results && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-slate-800/50 rounded-t-lg border-b border-slate-700">
                <FilterToolbar
                    activeFilters={activeFilters}
                    onFilterChange={handleFilterChange}
                    filteredDataCount={filteredData.length}
                    totalDataCount={results.data.length}
                    onDownload={handleDownloadXlsx} // The toolbar button will handle XLSX export
                    filterDefinitions={[
                        { type: 'no_siop', label: 'Sin Cruce SIOP' },
                        { type: 'diferencias', label: 'Con Diferencias de Flete' },
                        { type: 'dobles', label: 'Cobros Múltiples' },
                    ]}
                />
                <Button onClick={handleDownloadCsv} variant="secondary" size="sm">
                    <Download className="mr-2 h-4 w-4" />
                    Exportar CSV
                </Button>
              </div>
              <ResultsTable 
                results={{...results, data: filteredData}}
                onDataChange={handleDataChange}
                isEditable={true}
              />
              <div className="mt-8 flex items-center justify-center">
                 <button
                    onClick={handleReset}
                    className="text-sm text-slate-400 hover:text-white transition-colors"
                  >
                      Limpiar y empezar de nuevo
                  </button>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
};

export default Validator99Minutos;

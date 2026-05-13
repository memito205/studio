
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import type { 
    BodegaInventory, 
    DistributionResult, 
    ProcessedRow, 
    ItemForecast 
} from '@/types';
import { parseBodegaInventoryFile, calculateDistribution } from '@/services/distributionEngine';
import { FileUpload } from './FileUpload';
import { Spinner } from './common/Spinner';
import { DownloadIcon } from './icons/DownloadIcon';
import { UploadIcon } from './icons/UploadIcon';
import { InfoIcon } from './icons/InfoIcon';
import { DistributionExplanationModal } from './DistributionExplanationModal';
import * as XLSX from 'xlsx';
import { DISTRIBUTION_COVERAGE_DAYS, SPECIAL_COVERAGE_BODEGAS, MIN_MONTHS_FOR_DIRECT_FORECAST, MAX_CV_FOR_DIRECT_FORECAST } from './constants';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';


interface DistributionDashboardProps {
  allProcessedRows: ProcessedRow[];
  itemForecasts: ItemForecast[];
  /** Notifica a la vista padre cuando cambian los resultados de distribución (para historial Firestore). */
  onDistributionResultsChange?: (results: DistributionResult[]) => void;
}

const DistributionDashboard: React.FC<DistributionDashboardProps> = ({
  allProcessedRows,
  itemForecasts,
  onDistributionResultsChange,
}) => {
  const [bodegaInventories, setBodegaInventories] = useState<BodegaInventory[]>([]);
  const [distributionResults, setDistributionResults] = useState<DistributionResult[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [diagnosticLogs, setDiagnosticLogs] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [selectedResultForModal, setSelectedResultForModal] = useState<DistributionResult | null>(null);
  const [bodegaCoverageConfig, setBodegaCoverageConfig] = useState<Record<string, number>>({});
  
  // State for new sensitivity parameters
  const [minMonths, setMinMonths] = useState<number>(MIN_MONTHS_FOR_DIRECT_FORECAST);
  const [maxCv, setMaxCv] = useState<number>(MAX_CV_FOR_DIRECT_FORECAST);


  const uniqueBodegas = useMemo(() => {
    const bodegasFromInventory = new Set(bodegaInventories.map(inv => inv.bodega));
    const bodegasFromHistory = new Set(allProcessedRows.map(row => row.bodega).filter(Boolean) as string[]);
    return Array.from(new Set([...bodegasFromInventory, ...bodegasFromHistory])).sort();
  }, [bodegaInventories, allProcessedRows]);

  useEffect(() => {
    if (uniqueBodegas.length > 0) {
      const initialConfig: Record<string, number> = {};
      uniqueBodegas.forEach(bodega => {
        initialConfig[bodega] = SPECIAL_COVERAGE_BODEGAS[bodega] || DISTRIBUTION_COVERAGE_DAYS;
      });
      setBodegaCoverageConfig(initialConfig);
    }
  }, [uniqueBodegas]);

  const handleCoverageChange = (bodega: string, value: string) => {
    const numericValue = parseInt(value, 10);
    if (!isNaN(numericValue) && numericValue > 0) {
      setBodegaCoverageConfig(prev => ({ ...prev, [bodega]: numericValue }));
    }
  };

  const handleApplyToAll = () => {
    const firstValue = Object.values(bodegaCoverageConfig)[0] || DISTRIBUTION_COVERAGE_DAYS;
    const newConfig: Record<string, number> = {};
    uniqueBodegas.forEach(bodega => {
      newConfig[bodega] = firstValue;
    });
    setBodegaCoverageConfig(newConfig);
  };


  const handleOpenExplanationModal = (result: DistributionResult) => {
    setSelectedResultForModal(result);
    setIsModalOpen(true);
  };

  const itemSummary = useMemo(() => {
    if (distributionResults.length === 0) return null;

    const summaryMap = new Map<string, number>();
    distributionResults.forEach(result => {
        if (result.quantityToSend > 0) {
            const currentTotal = summaryMap.get(result.itemCode) || 0;
            summaryMap.set(result.itemCode, currentTotal + result.quantityToSend);
        }
    });

    if (summaryMap.size === 0) return null;

    return Array.from(summaryMap.entries())
        .map(([itemCode, totalQuantity]) => ({ itemCode, totalQuantity }))
        .sort((a, b) => a.itemCode.localeCompare(b.itemCode));
  }, [distributionResults]);

  const handleBodegaInventoryFile = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const file = files[0];
    setFileName(file.name);
    setIsLoading(true);
    setError(null);
    setDiagnosticLogs([]);
    setDistributionResults([]);
    onDistributionResultsChange?.([]);

    try {
      const content = await file.text();
      const parsedInventories = parseBodegaInventoryFile(content);
      if (parsedInventories.length === 0) {
          throw new Error("El archivo de inventario por bodega está vacío o no tiene el formato esperado (Bodega,Item,Cantidad).");
      }
      setBodegaInventories(parsedInventories);
      setError(null); 
    } catch (e) {
      setError(`Error al procesar el archivo de inventario por bodega: ${(e as Error).message}`);
      setBodegaInventories([]);
    } finally {
      setIsLoading(false);
    }
  }, [onDistributionResultsChange]);

  const handleCalculateDistribution = useCallback(() => {
    if (bodegaInventories.length === 0) {
      setError("Por favor, cargue primero un archivo de inventario por bodega.");
      return;
    }
    if (itemForecasts.length === 0) {
        setError("No hay pronósticos de item generales disponibles. Por favor, genere pronósticos en la pestaña 'Pronósticos y Compras' primero.");
        return;
    }
    if (allProcessedRows.length === 0) {
        setError("No hay datos históricos procesados disponibles, necesarios para calcular participaciones y AJS por bodega.");
        return;
    }

    setIsLoading(true);
    setError(null);
    setDiagnosticLogs([]);
    try {
      const { results, logs } = calculateDistribution(
        allProcessedRows,
        bodegaInventories,
        itemForecasts,
        bodegaCoverageConfig,
        minMonths,
        maxCv
      );
      
      setDistributionResults(results);
      setDiagnosticLogs(logs);
      onDistributionResultsChange?.(results);

      if (results.length === 0) {
        setError("No se generaron resultados de distribución. Revise los registros de diagnóstico a continuación para ver los detalles del cálculo.");
      }
    } catch (e) {
      setError(`Error al calcular la distribución: ${(e as Error).message}`);
      setDiagnosticLogs(prev => [...prev, `ERROR CRÍTICO: ${(e as Error).message}`]);
      setDistributionResults([]);
      onDistributionResultsChange?.([]);
    } finally {
      setIsLoading(false);
    }
  }, [allProcessedRows, bodegaInventories, itemForecasts, bodegaCoverageConfig, minMonths, maxCv, onDistributionResultsChange]);

  const handleExportCSV = useCallback(() => {
    if (distributionResults.length === 0) return;

    const headers = [
      "Bodega", "Ítem", "Inv. Actual (Bodega)", "Cobertura Inv. Actual (Días)",
      "Demanda Diaria (Ajustada)", "Inv. Objetivo", "Cantidad a Enviar"
    ];

    const rows = distributionResults.map(dr => [
      dr.bodega,
      dr.itemCode,
      dr.currentBodegaInventory.toLocaleString('es-CO'),
      dr.currentInventoryCoverageDays !== null && dr.currentInventoryCoverageDays < 999 ? dr.currentInventoryCoverageDays.toFixed(1) : (dr.currentInventoryCoverageDays === 0 ? '0.0' : '999+'),
      dr.calculationTrace?.effectiveBodegaDailyForecast_AjsAdjusted !== null && dr.calculationTrace?.effectiveBodegaDailyForecast_AjsAdjusted !== undefined ? dr.calculationTrace?.effectiveBodegaDailyForecast_AjsAdjusted.toLocaleString('es-CO', {maximumFractionDigits: 2}) : 'N/D',
      dr.targetInventoryForCoverage?.toLocaleString('es-CO') ?? 'N/D',
      dr.quantityToSend.toLocaleString('es-CO'),
    ].map(String));

    let csvContent = "data:text/csv;charset=utf-8," 
      + headers.join(",") + "\n"
      + rows.map(e => e.map(cell => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\n");
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "distribucion_bodegas.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [distributionResults]);

  const handleExportRequisitionExcel = useCallback(() => {
    if (distributionResults.length === 0) return;

    const bodegasWithShipments = new Map<string, { num_docto: number }>();
    let docCounter = 1;
    distributionResults.forEach(dr => {
        if (dr.quantityToSend > 0 && !bodegasWithShipments.has(dr.bodega)) {
            bodegasWithShipments.set(dr.bodega, { num_docto: docCounter++ });
        }
    });

    if (bodegasWithShipments.size === 0) {
        alert("No hay cantidades a enviar, por lo que no se puede generar el archivo de requisición.");
        return;
    }
    
    const formatDateYYYYMMDD = (date: Date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}${month}${day}`;
    };

    const today = new Date();
    const deliveryDate = new Date();
    deliveryDate.setDate(today.getDate() + 2);

    const formattedToday = formatDateYYYYMMDD(today);
    const formattedDeliveryDate = formatDateYYYYMMDD(deliveryDate);

    const documentosData = Array.from(bodegasWithShipments.entries()).map(([bodega, data]) => {
        const co = bodega.endsWith('01') ? bodega.slice(0, -2) : bodega;
        return {
            CO: co,
            NUM_DOCTO: data.num_docto.toString(),
            FECHA: formattedToday,
            SOLICITANTE: '042',
            FECHA_ENTREGA: formattedDeliveryDate,
            NOTAS: 'REPOSICION BOLSAS',
            BOD_SALIDA: 'BDBOL',
            BOD_ENT: bodega,
            REF: 'REPOSICION BOLSAS',
        };
    });

    const movimientosData = [];
    let regCounter = 1;
    for (const dr of distributionResults) {
        if (dr.quantityToSend > 0) {
            const docInfo = bodegasWithShipments.get(dr.bodega);
            if (docInfo) {
                const itemCodeWithoutZeros = parseInt(dr.itemCode, 10).toString();
                const docData = documentosData.find(d => d.NUM_DOCTO === docInfo.num_docto.toString());
                movimientosData.push({
                    CO: docData ? docData.CO : '',
                    NUM_DOCTO: docInfo.num_docto.toString(),
                    NUM_REG: regCounter++,
                    ITEM: itemCodeWithoutZeros,
                    EXTE: '',
                    BODEGA: 'BDBOL',
                    CANT: dr.quantityToSend,
                    FECHA_ENTREGA: formattedDeliveryDate,
                    CO_MOV: '999',
                });
            }
        }
    }

    const workbook = XLSX.utils.book_new();

    const ws_docs = XLSX.utils.json_to_sheet(documentosData, { header: ["CO", "NUM_DOCTO", "FECHA", "SOLICITANTE", "FECHA_ENTREGA", "NOTAS", "BOD_SALIDA", "BOD_ENT", "REF"] });
    
    const headers_docs = Object.keys(documentosData[0] || {});
    const solicitanteColIndex = headers_docs.indexOf('SOLICITANTE');
    if (solicitanteColIndex !== -1) {
        const colLetter = XLSX.utils.encode_col(solicitanteColIndex);
        for (let i = 0; i < documentosData.length; i++) {
            const cellAddress = `${colLetter}${i + 2}`;
            const cell = ws_docs[cellAddress];
            if (cell) {
                cell.t = 's';
                cell.v = '042';
                cell.w = '042';
            }
        }
    }

    const colWidths_docs = Object.keys(documentosData[0] || {}).map(key => ({
        wch: Math.max(key.length, ...documentosData.map(row => String(row[key as keyof typeof row]).length)) + 2
    }));
    ws_docs['!cols'] = colWidths_docs;
    XLSX.utils.book_append_sheet(workbook, ws_docs, "Documentos");
    
    if (movimientosData.length > 0) {
        const ws_movs = XLSX.utils.json_to_sheet(movimientosData, { header: ["CO", "NUM_DOCTO", "NUM_REG", "ITEM", "EXTE", "BODEGA", "CANT", "FECHA_ENTREGA", "CO_MOV"] });
        
        const movsHeaders = ["CO", "NUM_DOCTO", "NUM_REG", "ITEM", "EXTE", "BODEGA", "CANT", "FECHA_ENTREGA", "CO_MOV"];
        const colWidths_movs = movsHeaders.map(key => ({
             wch: Math.max(key.length, ...movimientosData.map(row => String(row[key as keyof typeof row] || '').length)) + 2
        }));
        
        ws_movs['!cols'] = colWidths_movs;
        XLSX.utils.book_append_sheet(workbook, ws_movs, "Movimientos");
    }

    XLSX.writeFile(workbook, "plano_requisicion_documentos.xlsx");

  }, [distributionResults]);

  return (
    <div className="space-y-6">
      <div className="bg-slate-800 shadow-2xl rounded-xl p-6">
        <h2 className="text-3xl font-bold mb-6 text-sky-400 border-b-2 border-sky-500 pb-2">
          1. Cargar Inventario Actual por Bodega
        </h2>
        <p className="text-sm text-slate-300 mb-4">
          Cargue un archivo CSV con las columnas: <code className="bg-slate-700 px-1 rounded">Bodega</code>, <code className="bg-slate-700 px-1 rounded">Código Ítem</code>, <code className="bg-slate-700 px-1 rounded">Cantidad Actual</code>.
          No incluir encabezados en el archivo.
        </p>
        <FileUpload 
          onFilesUploaded={handleBodegaInventoryFile} 
          isLoading={isLoading}
          accept=".csv"
          fileTypeDescription="Archivo CSV (inventario por bodega)"
          idSuffix="bodega"
        />
        {fileName && !isLoading && (
          <p className="mt-2 text-green-400">
            Archivo cargado: {fileName}. {bodegaInventories.length} registros de inventario por bodega procesados.
          </p>
        )}
      </div>

      {error && (
        <div className="bg-red-900/50 border border-red-700 text-red-300 p-4 rounded-md shadow-lg" role="alert">
          <p className="font-semibold text-lg mb-2">Error al Calcular:</p>
          <p className="whitespace-pre-wrap">{error}</p>
        </div>
      )}

      {diagnosticLogs.length > 0 && distributionResults.length === 0 && (
         <div className="bg-amber-900/50 border border-amber-700 text-amber-200 p-4 rounded-md shadow-lg">
           <p className="font-semibold text-lg mb-2">Registros de Diagnóstico:</p>
           <pre className="text-xs whitespace-pre-wrap max-h-96 overflow-y-auto bg-slate-900/50 p-3 rounded-md">{diagnosticLogs.join('\n')}</pre>
         </div>
      )}


      {bodegaInventories.length > 0 && (
        <div className="bg-slate-800 shadow-2xl rounded-xl p-6">
          <h2 className="text-3xl font-bold mb-6 text-sky-400 border-b-2 border-sky-500 pb-2">
            2. Configuración de Cobertura y Cálculo
          </h2>

          <div className="mb-6 p-4 border border-slate-700 rounded-lg space-y-4">
            <div>
              <h4 className="text-lg font-semibold text-slate-200 mb-2">Parámetros de Sensibilidad del Pronóstico</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                      <label htmlFor="min-months" className="block text-sm font-medium text-slate-300 mb-1">Meses Mínimos para Pronóstico Directo</label>
                      <Input
                          id="min-months"
                          type="number"
                          value={minMonths}
                          onChange={(e) => setMinMonths(parseInt(e.target.value, 10) || 0)}
                          className="w-full bg-slate-700 border-slate-600 px-2 py-1"
                      />
                      <p className="text-xs text-slate-500 mt-1">Define el historial mínimo para confiar en los datos de una bodega.</p>
                  </div>
                  <div>
                      <label htmlFor="max-cv" className="block text-sm font-medium text-slate-300 mb-1">Coef. Variación Máximo (CV)</label>
                      <Input
                          id="max-cv"
                          type="number"
                          step="0.1"
                          value={maxCv}
                          onChange={(e) => setMaxCv(parseFloat(e.target.value) || 0)}
                          className="w-full bg-slate-700 border-slate-600 px-2 py-1"
                      />
                      <p className="text-xs text-slate-500 mt-1">Define la estabilidad máxima del consumo. Menor es más estricto.</p>
                  </div>
              </div>
            </div>
            
            <div className="border-t border-slate-700 pt-4">
              <h4 className="text-lg font-semibold text-slate-200 mb-2">Días de Cobertura por Bodega</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 max-h-60 overflow-y-auto">
                {uniqueBodegas.map(bodega => (
                  <div key={bodega} className="flex items-center gap-2">
                    <label htmlFor={`cov-${bodega}`} className="text-sm text-slate-300 whitespace-nowrap">{bodega}:</label>
                    <Input
                      id={`cov-${bodega}`}
                      type="number"
                      value={bodegaCoverageConfig[bodega] || ''}
                      onChange={(e) => handleCoverageChange(bodega, e.target.value)}
                      className="w-20 bg-slate-700 border-slate-600 px-2 py-1 h-8"
                    />
                  </div>
                ))}
              </div>
              {uniqueBodegas.length > 0 && (
                <Button onClick={handleApplyToAll} variant="link" className="text-sky-400 mt-2 px-0">Aplicar a todo</Button>
              )}
            </div>
          </div>
          
          <button
            onClick={handleCalculateDistribution}
            disabled={isLoading || bodegaInventories.length === 0}
            className="bg-sky-500 hover:bg-sky-600 text-white font-semibold py-3 px-6 rounded-lg shadow-md transition duration-150 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
          >
            <UploadIcon className="h-5 w-5 transform rotate-90" />
            <span>Calcular y Mostrar Distribución</span>
          </button>
        </div>
      )}

      {isLoading && (
        <div className="flex justify-center items-center p-8">
          <Spinner />
          <p className="ml-3 text-sky-300">Calculando distribución...</p>
        </div>
      )}

      {distributionResults.length > 0 && !isLoading && (
        <div className="bg-slate-850 p-4 rounded-lg shadow-md space-y-6">
          {itemSummary && (
            <div className="bg-slate-900 p-4 rounded-lg shadow-inner">
              <h4 className="text-lg font-semibold text-sky-300 mb-3 border-b border-slate-700 pb-2">
                Resumen de Cantidades a Enviar por Ítem
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-6 gap-y-2 text-sm">
                {itemSummary.map(({ itemCode, totalQuantity }) => (
                  <div key={itemCode} className="flex justify-between items-baseline">
                    <span className="font-medium text-slate-200">{itemCode}:</span>
                    <span className="font-semibold text-teal-300 ml-2">
                      {totalQuantity.toLocaleString('es-CO')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
              <h3 className="text-xl font-semibold text-sky-400">Resultados de Distribución por Bodega</h3>
              <div className="flex gap-2">
                  <button
                      onClick={handleExportRequisitionExcel}
                      className="bg-purple-600 hover:bg-purple-700 text-white font-semibold py-2 px-4 rounded-lg shadow-md transition duration-150 ease-in-out flex items-center space-x-2"
                  >
                      <DownloadIcon className="w-5 h-5" />
                      <span>Plano Requisición</span>
                  </button>
                  <button
                      onClick={handleExportCSV}
                      className="bg-teal-600 hover:bg-teal-700 text-white font-semibold py-2 px-4 rounded-lg shadow-md transition duration-150 ease-in-out flex items-center space-x-2"
                  >
                      <DownloadIcon className="w-5 h-5" />
                      <span>Exportar Detalle</span>
                  </button>
              </div>
            </div>
            <div className="overflow-x-auto max-h-[70vh]">
              <table className="w-full min-w-[1200px] text-left text-base">
                <thead className="bg-slate-700 text-sky-300 sticky top-0 z-10">
                  <tr>
                    <th className="px-4 py-3">Bodega</th>
                    <th className="px-4 py-3">Ítem</th>
                    <th className="px-4 py-3 text-right">Inv. Actual</th>
                    <th className="px-4 py-3 text-right">Cobertura Inv. Actual (Días)</th>
                    <th className="px-4 py-3 text-right">Inv. Objetivo</th>
                    <th className="px-4 py-3 text-right font-semibold text-teal-300">Cantidad a Enviar</th>
                    <th className="px-4 py-3">Notas</th>
                    <th className="px-4 py-3 text-center">Info</th>
                  </tr>
                </thead>
                <tbody className="text-slate-100">
                  {distributionResults.map((dr, index) => (
                    <tr 
                      key={`${dr.itemCode}-${dr.bodega}-${index}`} 
                      className={`border-b border-slate-700 transition-colors duration-150 ease-in-out 
                                  ${index % 2 === 0 ? 'bg-slate-800/80' : 'bg-transparent'} hover:bg-sky-800/60`}
                    >
                      <td className="px-4 py-3">{dr.bodega}</td>
                      <td className="px-4 py-3 font-medium">{dr.itemCode}</td>
                      <td className="px-4 py-3 text-right">{dr.currentBodegaInventory.toLocaleString('es-CO')}</td>
                       <td className={`px-4 py-3 text-right font-medium ${dr.currentInventoryCoverageDays !== null && dr.currentInventoryCoverageDays < (dr.calculationTrace?.coverageDays || DISTRIBUTION_COVERAGE_DAYS) ? 'text-amber-400' : 'text-slate-300'}`}>
                          {dr.currentInventoryCoverageDays !== null && dr.currentInventoryCoverageDays < 999 ? dr.currentInventoryCoverageDays.toFixed(1) : (dr.currentInventoryCoverageDays === 0 ? '0.0' : '999+')}
                       </td>
                      <td className="px-4 py-3 text-right">{dr.targetInventoryForCoverage?.toLocaleString('es-CO') ?? 'N/D'}</td>
                      <td className={`px-4 py-3 text-right font-semibold ${dr.quantityToSend > 0 ? 'text-teal-400' : 'text-slate-300'}`}>
                        {dr.quantityToSend.toLocaleString('es-CO')}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-300">{dr.notes}</td>
                      <td className="px-4 py-3 text-center">
                        <button 
                          onClick={() => handleOpenExplanationModal(dr)} 
                          className="text-sky-400 hover:text-sky-300 disabled:opacity-50 disabled:cursor-not-allowed"
                          disabled={!dr.calculationTrace}
                          aria-label={`Ver detalle del cálculo para ${dr.itemCode} en ${dr.bodega}`}
                        >
                          <InfoIcon className="w-5 h-5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-slate-300 mt-3">* N/D: No Disponible. 'Cantidad a Enviar' considera el inventario actual de la bodega y el objetivo de cobertura basado en la demanda pronosticada y ajustada por AJS de la bodega.</p>
          </div>
        </div>
      )}
       {selectedResultForModal && (
        <DistributionExplanationModal 
          isOpen={isModalOpen} 
          onClose={() => setIsModalOpen(false)} 
          result={selectedResultForModal} 
        />
      )}
    </div>
  );
};

export default DistributionDashboard;

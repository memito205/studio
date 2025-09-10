


import React, { useState, useCallback, useMemo } from 'react';
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


interface DistributionDashboardProps {
  allProcessedRows: ProcessedRow[];
  itemForecasts: ItemForecast[];
}

const DistributionDashboard: React.FC<DistributionDashboardProps> = ({
  allProcessedRows,
  itemForecasts,
}) => {
  const [bodegaInventories, setBodegaInventories] = useState<BodegaInventory[]>([]);
  const [distributionResults, setDistributionResults] = useState<DistributionResult[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [diagnosticLogs, setDiagnosticLogs] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [selectedResultForModal, setSelectedResultForModal] = useState<DistributionResult | null>(null);


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
  }, []);

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
        itemForecasts
      );
      
      setDistributionResults(results);
      setDiagnosticLogs(logs);

      if (results.length === 0) {
        setError("No se generaron resultados de distribución. Revise los registros de diagnóstico a continuación para ver los detalles del cálculo.");
      }
    } catch (e) {
      setError(`Error al calcular la distribución: ${(e as Error).message}`);
      setDiagnosticLogs(prev => [...prev, `ERROR CRÍTICO: ${(e as Error).message}`]);
      setDistributionResults([]);
    } finally {
      setIsLoading(false);
    }
  }, [allProcessedRows, bodegaInventories, itemForecasts]);

  const handleExportCSV = useCallback(() => {
    if (distributionResults.length === 0) return;

    const headers = [
      "Bodega", "Ítem", "Inv. Actual (Bodega)", 
      "Demanda Diaria (Ajustada)", "Inv. Objetivo", "Cantidad a Enviar"
    ];

    const rows = distributionResults.map(dr => [
      dr.bodega,
      dr.itemCode,
      dr.calculationTrace.currentBodegaInventory.toLocaleString(),
      dr.calculationTrace.effectiveBodegaDailyForecast_AjsAdjusted !== null ? dr.calculationTrace.effectiveBodegaDailyForecast_AjsAdjusted.toLocaleString() : 'N/D',
      dr.calculationTrace.targetInventory !== null ? dr.calculationTrace.targetInventory.toLocaleString() : 'N/D',
      dr.quantityToSend.toLocaleString(),
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
            2. Calcular Distribución
          </h2>
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
                      {totalQuantity.toLocaleString()}
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
                    <th className="px-4 py-3 text-right">Inv. Actual (Bodega)</th>
                    <th className="px-4 py-3 text-right">Demanda Pron. Cobertura</th>
                    <th className="px-4 py-3 text-right">Inv. Objetivo Cobertura</th>
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
                      <td className="px-4 py-3 text-right">{dr.currentBodegaInventory.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right">{dr.forecastedDemandForCoverage?.toLocaleString() ?? 'N/D'}</td>
                      <td className="px-4 py-3 text-right">{dr.targetInventoryForCoverage?.toLocaleString() ?? 'N/D'}</td>
                      <td className={`px-4 py-3 text-right font-semibold ${dr.quantityToSend > 0 ? 'text-teal-400' : 'text-slate-300'}`}>
                        {dr.quantityToSend.toLocaleString()}
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

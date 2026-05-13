
"use client";

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { FileUpload } from './bag-distribution/FileUpload';
import ItemDashboard from './bag-distribution/ItemDashboard';
import AnalyticsDashboard from './bag-distribution/AnalyticsDashboard';
import DistributionDashboard from './bag-distribution/DistributionDashboard';
import { ForecastRunsHistoryPanel } from './bag-distribution/ForecastRunsHistoryPanel';
import ComparisonDashboard from './bag-distribution/ComparisonDashboard';
import { Spinner } from './bag-distribution/common/Spinner';
import { processSingleFile, aggregateData } from '@/services/fileProcessor';
import { generateAllForecasts } from '@/services/forecastingEngine';
import type { RawFileData, AllItemsMonthlyData, ItemForecast, ProcessedRow, ItemParameters, DistributionResult } from '@/types';
import { DEFAULT_LEAD_TIME_DAYS, DEFAULT_SERVICE_LEVEL_PERCENTAGE, FORECAST_SNAPSHOT_ENGINE_LABEL } from './bag-distribution/constants';
import { Header } from './bag-distribution/layout/Header';
import { Footer } from './bag-distribution/layout/Footer';
import { AnalyticsIcon } from './bag-distribution/icons/AnalyticsIcon';
import { InventoryIcon } from './bag-distribution/icons/InventoryIcon';
import { CalculatorIcon } from './bag-distribution/icons/CalculatorIcon';
import { DistributionIcon } from './bag-distribution/icons/DistributionIcon';
import { TrendingUpIcon } from './bag-distribution/icons/TrendingUpIcon';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Switch } from './ui/switch';
import { ArrowLeft, History } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { buildForecastRunPayload, historyRangeFromProcessedRows } from '@/lib/forecastSnapshot';
import { saveForecastRunSnapshot } from '@/app/forecast-snapshot-actions';


interface BagDistributionProps {
  onReturnToSuite: () => void;
}

export const BagDistribution: React.FC<BagDistributionProps> = ({ onReturnToSuite }) => {
  const { toast } = useToast();
  const forecastResultsRef = useRef<ItemForecast[]>([]);
  const [rawFilesData, setRawFilesData] = useState<RawFileData[]>([]);
  const [processedData, setProcessedData] = useState<AllItemsMonthlyData | null>(null);
  const [allProcessedRowsData, setAllProcessedRowsData] = useState<ProcessedRow[]>([]);
  const [itemInventories, setItemInventories] = useState<Map<string, number>>(new Map());
  const [itemParametersMap, setItemParametersMap] = useState<Map<string, ItemParameters>>(new Map());
  const [forecastResults, setForecastResults] = useState<ItemForecast[]>([]);
  const [autoSaveForecastRuns, setAutoSaveForecastRuns] = useState(true);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    'data' | 'forecast' | 'analytics' | 'distribution' | 'comparative' | 'history'
  >('data');
  const [itemDashboardActiveTab, setItemDashboardActiveTab] = useState<'data' | 'forecast'>('data');

  useEffect(() => {
    if (activeTab === 'forecast' && forecastResults.length > 0) {
      setItemDashboardActiveTab('forecast');
    } else if (activeTab === 'data') {
      setItemDashboardActiveTab('data');
    }
  }, [activeTab, forecastResults.length]);

  useEffect(() => {
    forecastResultsRef.current = forecastResults;
  }, [forecastResults]);

  const handleFilesUploaded = useCallback(async (files: File[]) => {
    setIsLoading(true);
    setError(null);
    setProcessedData(null);
    setAllProcessedRowsData([]);
    setForecastResults([]);
    
    const fileInfos: RawFileData[] = files.map(f => ({ name: f.name, content: '' }));
    setRawFilesData(fileInfos);

    let currentAllProcessedRows: ProcessedRow[] = [];
    let filesSuccessfullyProcessedCount = 0;
    let accumulatedErrors: string[] = [];

    for (const file of files) {
      try {
        const content = await file.text();
        const rowsFromFile = processSingleFile(content);
        currentAllProcessedRows = currentAllProcessedRows.concat(rowsFromFile);
        if (rowsFromFile.length > 0) {
            filesSuccessfullyProcessedCount++;
        }
      } catch (e) {
        accumulatedErrors.push(`Error al procesar el archivo ${file.name}: ${(e as Error).message}. Se omitieron los datos de este archivo.`);
      }
    }
    
    setAllProcessedRowsData(currentAllProcessedRows);

    if (accumulatedErrors.length > 0) {
        setError(accumulatedErrors.join('\n'));
    }

    if (currentAllProcessedRows.length === 0) {
       if (files.length > 0 && filesSuccessfullyProcessedCount === 0 && accumulatedErrors.length === files.length) {
       } else if (files.length > 0 && accumulatedErrors.length < files.length) {
        const currentErrorMsg = accumulatedErrors.join('\n');
        const noDataError = "No se encontraron datos válidos (RMV/RMP, etc.) en los archivos procesados exitosamente, o los archivos estaban vacíos de contenido relevante.";
        setError(currentErrorMsg ? `${currentErrorMsg}\n${noDataError}` : noDataError);
       }
       setIsLoading(false);
       setProcessedData(null);
       return;
    }

    try {
      const result = aggregateData(currentAllProcessedRows);
      
      if (result.size === 0) {
        const currentErrorMsg = accumulatedErrors.join('\n');
        const noItemsError = "Los datos procesados no generaron ningún item consolidado. Verifique los códigos de item y los datos de consumo en los archivos.";
        setError(currentErrorMsg ? `${currentErrorMsg}\n${noItemsError}` : noItemsError);
        setProcessedData(null);
      } else {
        setProcessedData(result);
        
        setItemInventories(prevInventories => {
            const newInventories = new Map(prevInventories);
            result.forEach((_, itemCode) => {
                if (!newInventories.has(itemCode)) {
                    newInventories.set(itemCode, 0);
                }
            });
            return newInventories;
        });

        setItemParametersMap(prevParams => {
            const newParams = new Map(prevParams);
            result.forEach((_, itemCode) => {
                if (!newParams.has(itemCode)) {
                    newParams.set(itemCode, {
                        leadTimeDays: DEFAULT_LEAD_TIME_DAYS,
                        serviceLevelPercentage: DEFAULT_SERVICE_LEVEL_PERCENTAGE
                    });
                }
            });
            return newParams;
        });

        setActiveTab('data');
        setItemDashboardActiveTab('data');
        if (accumulatedErrors.length === 0) setError(null);
        else setError(accumulatedErrors.join('\n') + "\nAlgunos archivos tuvieron errores pero se procesaron datos de otros.");
      }
    } catch (e) {
      setError(`Error al consolidar los datos procesados: ${(e as Error).message}`);
      setProcessedData(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (processedData && allProcessedRowsData.length > 0 && forecastResults.length > 0) {
      try {
        const newForecasts = generateAllForecasts(processedData, allProcessedRowsData, itemInventories, itemParametersMap);
        setForecastResults(newForecasts);
      } catch (e) {
        console.error("Error regenerating forecasts:", e);
        setError(`Error al actualizar pronósticos: ${(e as Error).message}`);
      }
    }
  }, [itemInventories, itemParametersMap, processedData, allProcessedRowsData, forecastResults.length]);


  const handleInventoryChange = useCallback((itemCode: string, quantity: number) => {
    const numericQuantity = isNaN(quantity) || quantity < 0 ? 0 : quantity;
    setItemInventories(prev => new Map(prev).set(itemCode, numericQuantity));
  }, []);
  
  const handleItemParametersChange = useCallback((itemCode: string, paramName: keyof ItemParameters, value: number) => {
    setItemParametersMap(prev => {
        const newMap = new Map(prev);
        const currentParams = newMap.get(itemCode) || {
            leadTimeDays: DEFAULT_LEAD_TIME_DAYS,
            serviceLevelPercentage: DEFAULT_SERVICE_LEVEL_PERCENTAGE
        };
        const numericValue = isNaN(value) ?
            (paramName === 'leadTimeDays' ? DEFAULT_LEAD_TIME_DAYS : DEFAULT_SERVICE_LEVEL_PERCENTAGE)
            : value;
        
        let finalValue = numericValue;
        if (paramName === 'leadTimeDays') {
            finalValue = Math.max(0, finalValue);
        } else if (paramName === 'serviceLevelPercentage') {
            finalValue = Math.max(0, Math.min(100, finalValue));
        }

        newMap.set(itemCode, { ...currentParams, [paramName]: finalValue });
        return newMap;
    });
  }, []);

  const persistForecastRunSnapshot = useCallback(
    async (itemForecasts: ItemForecast[], distributionResults: DistributionResult[]) => {
      if (!autoSaveForecastRuns) return;
      if (!itemForecasts.length) return;

      try {
        const historyRange =
          allProcessedRowsData.length > 0 ? historyRangeFromProcessedRows(allProcessedRowsData) : undefined;
        const payload = buildForecastRunPayload({
          generationDate: new Date(),
          itemForecasts,
          distributionResults,
          historyRange,
          meta: { engineVersion: FORECAST_SNAPSHOT_ENGINE_LABEL },
        });
        const result = await saveForecastRunSnapshot(payload);
        if (result.success) {
          toast({
            title: 'Corrida guardada',
            description:
              distributionResults.length > 0
                ? `Pronóstico y distribución guardados (id: ${result.id}).`
                : `Pronóstico guardado (id: ${result.id}).`,
          });
        } else {
          toast({
            variant: 'destructive',
            title: 'No se pudo guardar la corrida',
            description: result.error,
          });
        }
      } catch (e) {
        toast({
          variant: 'destructive',
          title: 'Error al guardar',
          description: (e as Error).message,
        });
      }
    },
    [allProcessedRowsData, autoSaveForecastRuns, toast],
  );

  const handleDistributionResultsChange = useCallback(
    (results: DistributionResult[]) => {
      void persistForecastRunSnapshot(forecastResultsRef.current, results);
    },
    [persistForecastRunSnapshot],
  );

  const handleGenerateForecasts = useCallback(async () => {
    if (!processedData || processedData.size === 0) {
      setError("No hay datos procesados para generar pronósticos. Por favor, cargue y procese archivos primero.");
      return;
    }
     if (allProcessedRowsData.length === 0) {
      setError("Faltan los datos de filas procesadas necesarios para generar pronósticos detallados. Por favor, vuelva a cargar los archivos.");
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const currentParams = new Map(itemParametersMap);
      let paramsUpdated = false;
      processedData.forEach((_, itemCode) => {
          if(!currentParams.has(itemCode)) {
              currentParams.set(itemCode, {
                  leadTimeDays: DEFAULT_LEAD_TIME_DAYS,
                  serviceLevelPercentage: DEFAULT_SERVICE_LEVEL_PERCENTAGE,
              });
              paramsUpdated = true;
          }
      });
      if(paramsUpdated) {
        setItemParametersMap(currentParams);
      }

      const forecastsData = generateAllForecasts(processedData, allProcessedRowsData, itemInventories, currentParams);
      setForecastResults(forecastsData);
      if (forecastsData.length > 0) {
        void persistForecastRunSnapshot(forecastsData, []);
      }
      setActiveTab('forecast');
      setItemDashboardActiveTab('forecast');
      if (forecastsData.length === 0) {
         setError("Se generaron pronósticos, pero no se obtuvieron resultados. Esto puede deberse a datos insuficientes para todos los items.");
      }
    } catch (e) {
      console.error("Error generating forecasts:", e);
      setError(`Error al generar pronósticos: ${(e as Error).message}`);
      setForecastResults([]);
    } finally {
      setIsLoading(false);
    }
  }, [processedData, allProcessedRowsData, itemInventories, itemParametersMap, persistForecastRunSnapshot]);


  const uniqueItemCodes = useMemo(() => {
    return processedData ? Array.from(processedData.keys()).sort() : [];
  }, [processedData]);

  const canShowAnalyticsOrDistribution = useMemo(() => allProcessedRowsData.length > 0, [allProcessedRowsData]);

  return (
    <div className="space-y-8">
        <Button onClick={onReturnToSuite} variant="outline" className="mb-4">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver a la Suite
        </Button>
        <div className="bg-slate-800 shadow-2xl rounded-xl p-6 mb-8">
          <h2 className="text-3xl font-bold mb-6 text-sky-400 border-b-2 border-sky-500 pb-2">
            1. Cargar Datos de Consumo (General)
          </h2>
          <FileUpload
            onFilesUploaded={handleFilesUploaded}
            isLoading={isLoading}
            idSuffix="general"
          />
          
          {rawFilesData.length > 0 && isLoading && (
            <p className="mt-4 text-sky-300">Procesando {rawFilesData.length} archivo(s)...</p>
          )}

          {processedData && !isLoading && (
            <div className="mt-4 text-green-400">
              <p className="font-semibold">
                Procesamiento de {rawFilesData.length} archivo(s) seleccionados completado.
              </p>
              {processedData.size > 0 ? (
                <p>{uniqueItemCodes.length} items únicos encontrados y consolidados. {allProcessedRowsData.length} filas de datos procesadas en total.</p>
              ) : (
                <p className="text-amber-500">
                  No se consolidaron items a partir de los datos. Verifique que los archivos contengan los tipos de documento (RMV, RMP) y datos correctos.
                </p>
              )}
            </div>
          )}
          
          {rawFilesData.length > 0 && !isLoading && !processedData && !error && (
             <p className="mt-4 text-amber-400">
                Se intentó procesar {rawFilesData.length} archivo(s). No se encontraron datos válidos o los archivos estaban vacíos.
             </p>
          )}
        </div>
        
        {error && (
          <div className="bg-red-500 text-white p-4 rounded-md mb-6 shadow-lg whitespace-pre-line" role="alert">
            <p className="font-semibold">Error(es):</p>
            <p>{error}</p>
          </div>
        )}

        <div className="flex border-b border-slate-700 mb-6 flex-wrap gap-y-1">
            <button
                type="button"
                onClick={() => setActiveTab('data')}
                disabled={!processedData || uniqueItemCodes.length === 0}
                className={`py-3 px-4 sm:px-6 font-medium text-sm transition-colors ${activeTab === 'data' ? 'border-b-2 border-sky-500 text-sky-400' : 'text-slate-400 hover:text-sky-300'} ${(!processedData || uniqueItemCodes.length === 0) ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
                <InventoryIcon className="inline-block w-5 h-5 mr-1 sm:mr-2" />
                Inventario
            </button>
            <button
                type="button"
                onClick={() => setActiveTab('forecast')}
                disabled={forecastResults.length === 0 && (!processedData || uniqueItemCodes.length === 0)}
                className={`py-3 px-4 sm:px-6 font-medium text-sm transition-colors ${activeTab === 'forecast' ? 'border-b-2 border-sky-500 text-sky-400' : 'text-slate-400 hover:text-sky-300'} ${(forecastResults.length === 0 && (!processedData || uniqueItemCodes.length === 0)) ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
                <CalculatorIcon className="inline-block w-5 h-5 mr-1 sm:mr-2" />
                Pronósticos
            </button>
            <button
                type="button"
                onClick={() => setActiveTab('analytics')}
                disabled={!canShowAnalyticsOrDistribution}
                className={`py-3 px-4 sm:px-6 font-medium text-sm transition-colors ${activeTab === 'analytics' ? 'border-b-2 border-sky-500 text-sky-400' : 'text-slate-400 hover:text-sky-300'} ${!canShowAnalyticsOrDistribution ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
                <AnalyticsIcon className="inline-block w-5 h-5 mr-1 sm:mr-2" />
                Analítica
            </button>
            <button
                type="button"
                onClick={() => setActiveTab('comparative')}
                disabled={!canShowAnalyticsOrDistribution}
                className={`py-3 px-4 sm:px-6 font-medium text-sm transition-colors ${activeTab === 'comparative' ? 'border-b-2 border-sky-500 text-sky-400' : 'text-slate-400 hover:text-sky-300'} ${!canShowAnalyticsOrDistribution ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
                <TrendingUpIcon className="inline-block w-5 h-5 mr-1 sm:mr-2" />
                Comparativo
            </button>
            <button
                type="button"
                onClick={() => setActiveTab('distribution')}
                disabled={!canShowAnalyticsOrDistribution || forecastResults.length === 0}
                className={`py-3 px-4 sm:px-6 font-medium text-sm transition-colors ${activeTab === 'distribution' ? 'border-b-2 border-sky-500 text-sky-400' : 'text-slate-400 hover:text-sky-300'} ${(!canShowAnalyticsOrDistribution || forecastResults.length === 0) ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
                <DistributionIcon className="inline-block w-5 h-5 mr-1 sm:mr-2" />
                Distribución
            </button>
            <button
                type="button"
                onClick={() => setActiveTab('history')}
                className={`py-3 px-4 sm:px-6 font-medium text-sm transition-colors ${activeTab === 'history' ? 'border-b-2 border-sky-500 text-sky-400' : 'text-slate-400 hover:text-sky-300'}`}
            >
                <History className="inline-block w-5 h-5 mr-1 sm:mr-2" />
                Historial
            </button>
        </div>

        {isLoading && (
          <div className="fixed inset-0 bg-slate-900 bg-opacity-75 flex items-center justify-center z-50">
            <Spinner />
            <p className="ml-4 text-xl text-sky-300">Procesando...</p>
          </div>
        )}

        {activeTab === 'data' && processedData && uniqueItemCodes.length > 0 && (
          <div className="bg-slate-800 shadow-2xl rounded-xl p-6 mb-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:justify-between lg:items-center mb-6">
                 <h2 className="text-3xl font-bold text-sky-400 border-b-2 border-sky-500 pb-2">
                    2. Inventario y Parámetros (General)
                </h2>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap sm:justify-end">
                <div className="flex items-center gap-2">
                  <Switch
                    id="auto-save-forecast-runs"
                    checked={autoSaveForecastRuns}
                    onCheckedChange={setAutoSaveForecastRuns}
                  />
                  <Label htmlFor="auto-save-forecast-runs" className="text-slate-300 text-sm cursor-pointer whitespace-normal">
                    Guardar automáticamente la corrida en Firestore
                  </Label>
                </div>
                <button
                    onClick={handleGenerateForecasts}
                    disabled={isLoading || uniqueItemCodes.length === 0}
                    className="bg-sky-500 hover:bg-sky-600 text-white font-semibold py-3 px-6 rounded-lg shadow-md transition duration-150 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M10 3.5a1.5 1.5 0 011.594 1.855l2.678 9.373A1.5 1.5 0 0112.5 17H7.5a1.5 1.5 0 01-1.772-2.272l2.678-9.373A1.5 1.5 0 0110 3.5zm0-1.5a3.5 3.5 0 00-3.406 4.31L3.916 15.68A3.5 3.5 0 007.5 19h5a3.5 3.5 0 003.584-3.321l-2.678-9.372A3.5 3.5 0 0010 2z" />
                        <path fillRule="evenodd" d="M10 7a1 1 0 011 1v2a1 1 0 11-2 0V8a1 1 0 011-1zm0-3a1 1 0 011 1v.01a1 1 0 11-2 0V5a1 1 0 011-1z" clipRule="evenodd" />
                    </svg>
                    <span>Generar Pronósticos</span>
                </button>
                </div>
            </div>
             <ItemDashboard
                itemCodes={uniqueItemCodes}
                processedData={processedData}
                inventories={itemInventories}
                itemParameters={itemParametersMap}
                forecasts={forecastResults}
                onInventoryChange={handleInventoryChange}
                onItemParametersChange={handleItemParametersChange}
                activeTab={itemDashboardActiveTab}
                setActiveTab={setItemDashboardActiveTab}
              />
          </div>
        )}

        {activeTab === 'forecast' && processedData && uniqueItemCodes.length > 0 && (
            forecastResults.length > 0 ? (
                 <ItemDashboard
                    itemCodes={uniqueItemCodes}
                    processedData={processedData}
                    inventories={itemInventories}
                    itemParameters={itemParametersMap}
                    forecasts={forecastResults}
                    onInventoryChange={handleInventoryChange}
                    onItemParametersChange={handleItemParametersChange}
                    activeTab={itemDashboardActiveTab}
                    setActiveTab={setItemDashboardActiveTab}
                />
            ) : (
                <div className="bg-slate-800 shadow-2xl rounded-xl p-6 text-center">
                    <p className="text-slate-300 text-lg">Por favor, genere los pronósticos primero usando el botón en la pestaña "Inventario".</p>
                </div>
            )
        )}
        
        {activeTab === 'analytics' && canShowAnalyticsOrDistribution && (
            <AnalyticsDashboard processedRows={allProcessedRowsData} />
        )}
        {activeTab === 'analytics' && !canShowAnalyticsOrDistribution && (
             <div className="bg-slate-800 shadow-2xl rounded-xl p-6 text-center">
                <p className="text-slate-300 text-lg">Cargue y procese archivos de datos para ver el Dashboard Analítico.</p>
            </div>
        )}

        {activeTab === 'comparative' && canShowAnalyticsOrDistribution && (
            <ComparisonDashboard processedRows={allProcessedRowsData} />
        )}
        {activeTab === 'comparative' && !canShowAnalyticsOrDistribution && (
             <div className="bg-slate-800 shadow-2xl rounded-xl p-6 text-center">
                <p className="text-slate-300 text-lg">Cargue y procese archivos de datos para ver el Dashboard Comparativo.</p>
            </div>
        )}

        {activeTab === 'distribution' && canShowAnalyticsOrDistribution && forecastResults.length > 0 && (
            <DistributionDashboard
                allProcessedRows={allProcessedRowsData}
                itemForecasts={forecastResults}
                onDistributionResultsChange={handleDistributionResultsChange}
            />
        )}
         {activeTab === 'distribution' && (!canShowAnalyticsOrDistribution || forecastResults.length === 0) && (
             <div className="bg-slate-800 shadow-2xl rounded-xl p-6 text-center">
                <p className="text-slate-300 text-lg">
                    { !canShowAnalyticsOrDistribution
                        ? "Cargue y procese archivos de datos generales primero."
                        : "Genere pronósticos generales en la pestaña 'Pronósticos' antes de usar la Distribución por Bodega."
                    }
                </p>
            </div>
        )}

        {activeTab === 'history' && <ForecastRunsHistoryPanel />}
    </div>
  );
};

import React, { useState, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import FileUpload from './components/FileUpload';
import ResultsDisplay from './components/ResultsDisplay';
import Spinner from './components/Spinner';
import CurveConfigurator from './components/CurveConfigurator';
import MappingModal from './components/MappingModal';
import { DownloadIcon } from './components/icons';
import { distribute, calculateAutoCurves } from './services/distributor';
import { getDistributionSummary } from './services/geminiService';
import {
  exportDocumentsToExcel,
  exportSummaryToExcel,
  findUnmappedWarehouses,
  exportStockTemplate,
  exportPlanTemplate,
} from './services/exportService';
import type { StockItem, DistributionRule, Allocation, BoxCurveRule } from './types';

interface DistributorModuleProps {
  onReturnToSuite: () => void;
}

const DistributorModule: React.FC<DistributorModuleProps> = ({ onReturnToSuite }) => {
  const [stockData, setStockData] = useState<StockItem[] | null>(null);
  const [planData, setPlanData] = useState<DistributionRule[] | null>(null);
  const [curveData, setCurveData] = useState<BoxCurveRule[] | null>(null);
  const [uniqueReferences, setUniqueReferences] = useState<string[]>([]);
  const [distributionResult, setDistributionResult] = useState<Allocation | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [resetCounter, setResetCounter] = useState(0);
  const [useAutoCurves, setUseAutoCurves] = useState(false);

  // Pre-calculate auto curves for preview when mode is active
  const previewCurves = useMemo(() => {
    if (!useAutoCurves || !stockData) return null;
    const curves = calculateAutoCurves(stockData);
    // Group by reference
    const byRef: Record<string, { talla: string; cantidad: number }[]> = {};
    for (const rule of curves) {
      if (!byRef[rule.REFERENCIA]) byRef[rule.REFERENCIA] = [];
      byRef[rule.REFERENCIA].push({ talla: rule.TALLA, cantidad: rule.CANTIDAD_CURVA });
    }
    // Sort sizes numerically within each ref
    for (const ref in byRef) {
      byRef[ref].sort((a, b) => a.talla.localeCompare(b.talla, undefined, { numeric: true }));
    }
    return byRef;
  }, [useAutoCurves, stockData]);

  // State for warehouse mapping
  const [coMap, setCoMap] = useState<{ [key: string]: string }>({
    'B12': '212', 'B15': '315', 'B16': '216', 'B3': '203', 
    'B6': '206', 'B8': '208', 'B9': '209', 'ML': '303', 
    'PAG': '999', 'PN': '997'
  });
  const [unmappedWarehouses, setUnmappedWarehouses] = useState<string[]>([]);
  const [pendingExportAction, setPendingExportAction] = useState<'documents' | 'summary' | null>(null);

  const handleFileProcessed = useCallback((type: 'stock' | 'plan', data: StockItem[] | DistributionRule[]) => {
    setError(''); // Clear previous errors on new file
    if (type === 'stock') {
      setStockData(data as StockItem[]);
    } else if (type === 'plan') {
      const plan = data as DistributionRule[];
      setPlanData(plan);
      const refs = [...new Set(plan.map(p => String(p.REFERENCIA).trim()))].sort();
      setUniqueReferences(refs);
      setCurveData([]); // Reset curves when a new plan is loaded
    }
  }, []);
  
  const handleCurvesChange = useCallback((curves: BoxCurveRule[]) => {
    setCurveData(curves);
  }, []);

  const handleProcessingError = useCallback((errorMessage: string) => {
    setError(errorMessage);
  }, []);

  const handleProcessDistribution = async () => {
    if (!stockData || !planData) {
      setError('Por favor, cargue los archivos de Existencias y Reparto antes de procesar.');
      return;
    }
    setError('');
    setIsLoading(true);
    setDistributionResult(null);
    setAiSummary(null);

    await new Promise(resolve => setTimeout(resolve, 500));

    try {
      let finalCurves = curveData;
      if (useAutoCurves && stockData) {
          finalCurves = calculateAutoCurves(stockData);
      }
      
      const result = distribute(stockData, planData, finalCurves);
      setDistributionResult(result);
      
      getDistributionSummary(result).then(summary => {
          setAiSummary(summary);
      });

    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Ocurrió un error inesperado durante la distribución.";
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleReset = () => {
      setStockData(null);
      setPlanData(null);
      setCurveData(null);
      setUniqueReferences([]);
      setDistributionResult(null);
      setAiSummary(null);
      setError('');
      setIsLoading(false);
      setUseAutoCurves(false);
      setResetCounter(c => c + 1);
  };
  
  const handleExportDocuments = () => {
    if (!distributionResult) {
      setError("No hay datos de resultados para exportar.");
      return;
    }
    const unmapped = findUnmappedWarehouses(distributionResult, coMap);
    if (unmapped.length > 0) {
        setUnmappedWarehouses(unmapped);
        setPendingExportAction('documents');
    } else {
        exportDocumentsToExcel(distributionResult, coMap);
    }
  };

  const handleExportSummary = () => {
    if (!distributionResult || !stockData || !planData) {
      setError("No hay datos de resultados para exportar.");
      return;
    }
    const unmapped = findUnmappedWarehouses(distributionResult, coMap);
    if (unmapped.length > 0) {
        setUnmappedWarehouses(unmapped);
        setPendingExportAction('summary');
    } else {
        exportSummaryToExcel(distributionResult, stockData, planData, coMap);
    }
  };

  const handleCloseMappingModal = () => {
    setUnmappedWarehouses([]);
    setPendingExportAction(null);
  };

  const handleSaveMappings = (newMappings: { [key: string]: string }) => {
    const updatedCoMap = { ...coMap, ...newMappings };
    setCoMap(updatedCoMap);
    
    if (pendingExportAction === 'documents' && distributionResult) {
        exportDocumentsToExcel(distributionResult, updatedCoMap);
    } else if (pendingExportAction === 'summary' && distributionResult && stockData && planData) {
        exportSummaryToExcel(distributionResult, stockData, planData, updatedCoMap);
    }

    handleCloseMappingModal();
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center p-4 sm:p-6 lg:p-8">
      <div className="w-full max-w-6xl mx-auto flex flex-col pt-4">
        <div className="flex justify-start mb-6">
          <Button variant="outline" onClick={onReturnToSuite} className="group hover:bg-muted transition-colors">
            <ArrowLeft className="w-5 h-5 mr-2 group-hover:-translate-x-1 transition-transform" />
            Volver a Suite
          </Button>
        </div>
        <header className="text-center mb-10">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-gray-800">
            Distribuidor de Mercancía
            <span className="text-primary"> IA</span>
          </h1>
          <p className="mt-3 text-lg text-gray-600 max-w-2xl mx-auto">
            Cargue sus archivos de existencias y reparto para generar una distribución equitativa de productos.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <Button variant="secondary" onClick={exportStockTemplate} className="inline-flex items-center">
              <DownloadIcon className="w-4 h-4 mr-2" />
              Plantilla Existencias
            </Button>
            <Button variant="secondary" onClick={exportPlanTemplate} className="inline-flex items-center">
              <DownloadIcon className="w-4 h-4 mr-2" />
              Plantilla Reparto
            </Button>
          </div>
        </header>

        <main className="bg-white p-6 sm:p-8 rounded-2xl shadow-xl border border-gray-200">
          {!distributionResult ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                <FileUpload
                  id="stock"
                  title="1. Archivo de Existencias"
                  onFileProcessed={handleFileProcessed}
                  onProcessingError={handleProcessingError}
                  reset={resetCounter > 0}
                />
                <FileUpload
                  id="plan"
                  title="2. Archivo de Reparto"
                  onFileProcessed={handleFileProcessed}
                  onProcessingError={handleProcessingError}
                  reset={resetCounter > 0}
                />
              </div>

              {uniqueReferences.length > 0 && stockData && (
                <div className="space-y-6">
                  <div className="bg-primary/5 border border-primary/20 p-4 rounded-xl flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="auto-curves" className="text-base font-bold text-gray-800">
                        Cálculo Automático de Curvas
                      </Label>
                      <p className="text-sm text-gray-600">
                        Identifica las curvas por referencia automáticamente dividiendo las existencias por 12.
                      </p>
                    </div>
                    <Switch
                      id="auto-curves"
                      checked={useAutoCurves}
                      onCheckedChange={setUseAutoCurves}
                    />
                  </div>

                  {!useAutoCurves ? (
                    <CurveConfigurator 
                        references={uniqueReferences}
                        onCurvesChange={handleCurvesChange}
                        reset={resetCounter > 0}
                    />
                  ) : (
                    <div className="border border-primary/20 rounded-2xl bg-primary/5 overflow-hidden">
                      <div className="px-6 py-4 bg-primary/10 border-b border-primary/20">
                        <p className="text-primary font-bold text-sm">Resumen de Curvas Detectadas Automáticamente</p>
                        <p className="text-xs text-gray-500 mt-0.5">Unidades por talla en cada caja (total ÷ 12, redondeado)</p>
                      </div>
                      <div className="overflow-auto max-h-96">
                        {previewCurves && Object.entries(previewCurves).map(([ref, sizes]) => {
                          const totalCurve = sizes.reduce((s, x) => s + x.cantidad, 0);
                          return (
                            <div key={ref} className="border-b border-primary/10 last:border-0 px-6 py-3">
                              <div className="flex items-center justify-between mb-2">
                                <span className="font-bold text-gray-800 text-sm">{ref}</span>
                                <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-semibold">
                                  {totalCurve} uds/caja
                                </span>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {sizes.map(s => (
                                  <div key={s.talla} className="flex flex-col items-center bg-white border border-primary/20 rounded-lg px-3 py-1.5 shadow-sm">
                                    <span className="text-xs text-gray-500">T{s.talla}</span>
                                    <span className="font-bold text-gray-800 text-sm">{s.cantidad}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {error && <div className="text-center text-red-600 bg-red-50 p-3 rounded-lg my-6">{error}</div>}

              <div className="text-center mt-8">
                <button
                  onClick={handleProcessDistribution}
                  disabled={!stockData || !planData || isLoading}
                  className="inline-flex items-center justify-center px-8 py-3 bg-primary text-primary-foreground font-bold rounded-lg shadow-md hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 transform hover:scale-105 disabled:scale-100"
                >
                  {isLoading ? (
                    <>
                      <Spinner />
                      <span className="ml-3">Procesando...</span>
                    </>
                  ) : (
                    'Generar Distribución'
                  )}
                </button>
              </div>
            </>
          ) : (
            <div className="text-center flex flex-wrap justify-center gap-4">
                 <button
                  onClick={handleReset}
                  className="px-6 py-3 bg-secondary text-secondary-foreground font-bold rounded-lg shadow-md hover:bg-secondary/80 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-secondary transition-colors"
                >
                  Comenzar de Nuevo
                </button>
                <button
                  onClick={handleExportDocuments}
                  className="inline-flex items-center justify-center px-6 py-3 bg-emerald-600 text-white font-bold rounded-lg shadow-md hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 transition-colors"
                >
                  <DownloadIcon className="w-5 h-5 mr-2" />
                  Exportar Documentos
                </button>
                <button
                  onClick={handleExportSummary}
                  className="inline-flex items-center justify-center px-6 py-3 bg-sky-600 text-white font-bold rounded-lg shadow-md hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500 transition-colors"
                >
                  <DownloadIcon className="w-5 h-5 mr-2" />
                  Exportar Resumen
                </button>
            </div>
          )}
        </main>
        
        {isLoading && !distributionResult && (
            <div className="text-center mt-8">
                <p className="text-gray-600">Calculando el reparto óptimo. Esto puede tomar un momento...</p>
            </div>
        )}

        <ResultsDisplay data={distributionResult} aiSummary={aiSummary} stockData={stockData} planData={planData} />
        
        {pendingExportAction && unmappedWarehouses.length > 0 && (
            <MappingModal
                unmappedWarehouses={unmappedWarehouses}
                onSave={handleSaveMappings}
                onClose={handleCloseMappingModal}
            />
        )}

        <footer className="text-center mt-12 text-sm text-gray-500">
            <p>Powered by React, Tailwind CSS, and Gemini API.</p>
        </footer>
      </div>
    </div>
  );
};

export default DistributorModule;
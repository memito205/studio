
"use client";

import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { Dashboard } from '@/components/returns-module/Dashboard';
import { DataPreviewModal } from '@/components/DataPreviewModal';
import { Transaction, RawTransaction, Filters } from '@/types';
import { generateMockData } from '@/services/mockData';
import { processRawData } from '@/services/dataUtils';
import { FileDownIcon } from '@/components/returns-module/icons';
import AuthLayout from '@/components/AuthLayout';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth-context';
import { useToast } from '@/hooks/use-toast';
import type { ReturnsPeriodMetaDoc, ReturnsPeriodStatus } from '@/lib/returnsIngest/types';
import {
  getReturnsTransactionsForYears,
  ingestReturnsPeriod,
  listReturnsPeriods,
} from '@/app/returns-ingest-actions';

const RETURNS_ACCESS_ROLES = new Set(['admin', 'office']);

function defaultPeriodId(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
}

/** Carga perezosa: en Next no existe el script global del CDN del prototipo estático. */
let html2pdfLoader: Promise<(typeof import('html2pdf.js'))['default']> | null = null;
function loadHtml2Pdf() {
  if (!html2pdfLoader) {
    html2pdfLoader = import('html2pdf.js').then((m) => m.default);
  }
  return html2pdfLoader;
}

export default function ReturnsModulePage() {
  const [processedData, setProcessedData] = useState<Transaction[]>([]);
  const [rawDataForPreview, setRawDataForPreview] = useState<RawTransaction[]>([]);
  const [processedDataForPreview, setProcessedDataForPreview] = useState<Transaction[]>([]);
  const [isProcessing, setIsProcessing] = useState(true);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false); // State to control layout visibility
  const [currentPdfName, setCurrentPdfName] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [fileName, setFileName] = useState('Datos de Muestra');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { toast } = useToast();
  const { role, loading: authLoading, user } = useAuth();
  const canAccessReturns = role != null && RETURNS_ACCESS_ROLES.has(role);
  /** Office no puede importar Excel ni carpetas; el resto del reporte (PDF, filtros, año) sí. */
  const canUploadExcel = role !== 'office';
  
  const dashboardStateRef = useRef<{ year: number; filters: Filters } | null>(null);

  const [firestorePeriods, setFirestorePeriods] = useState<ReturnsPeriodMetaDoc[]>([]);
  const [periodIdInput, setPeriodIdInput] = useState(defaultPeriodId);
  const [periodStatus, setPeriodStatus] = useState<ReturnsPeriodStatus>('partial');
  const [forceReopenComplete, setForceReopenComplete] = useState(false);
  const [isSavingFirestore, setIsSavingFirestore] = useState(false);

  const refreshFirestoreMetadata = async () => {
    const meta = await listReturnsPeriods();
    if (meta.success && meta.data) setFirestorePeriods(meta.data);
  };

  // Carga inicial: si hay datos en Firestore para año actual y anterior, los usa; si no, muestra mock.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsProcessing(true);
      const y = new Date().getFullYear();
      try {
        const [fromFs, meta] = await Promise.all([
          getReturnsTransactionsForYears([y, y - 1]),
          listReturnsPeriods(),
        ]);
        if (cancelled) return;
        if (meta.success && meta.data) setFirestorePeriods(meta.data);
        if (fromFs.success && fromFs.data && fromFs.data.length > 0) {
          setProcessedData(fromFs.data);
          setFileName('Datos desde Firebase');
        } else {
          const mockRawData = generateMockData();
          setProcessedData(processRawData(mockRawData));
          setFileName('Datos de muestra (local)');
        }
      } catch (e) {
        console.error('[returns-module] Firestore inicial:', e);
        if (!cancelled) {
          const mockRawData = generateMockData();
          setProcessedData(processRawData(mockRawData));
          setFileName('Datos de muestra (local)');
        }
      } finally {
        if (!cancelled) setIsProcessing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleReloadFromFirestore = async () => {
    setIsProcessing(true);
    try {
      const y = new Date().getFullYear();
      const r = await getReturnsTransactionsForYears([y, y - 1]);
      if (!r.success) {
        toast({ variant: 'destructive', title: 'Error', description: r.error ?? 'No se pudo leer Firestore.' });
        return;
      }
      if (!r.data?.length) {
        toast({
          variant: 'destructive',
          title: 'Sin datos en Firebase',
          description: 'No hay buckets guardados para el año actual ni el anterior. Guarde un período como administrador o revise el proyecto y las reglas.',
        });
        return;
      }
      setProcessedData(r.data);
      setFileName('Datos desde Firebase');
      try {
        await refreshFirestoreMetadata();
      } catch (metaErr) {
        console.error('[returns-module] refreshFirestoreMetadata:', metaErr);
        toast({
          variant: 'destructive',
          title: 'Metadatos',
          description: 'Los datos se cargaron pero no se pudo actualizar la lista de períodos en pantalla.',
        });
      }
      toast({ title: 'Datos actualizados', description: `Se cargaron ${r.data.length} líneas reconstruidas desde buckets.` });
    } catch (e) {
      console.error('[returns-module] handleReloadFromFirestore:', e);
      toast({
        variant: 'destructive',
        title: 'Error al recargar',
        description: e instanceof Error ? e.message : 'Fallo de red o del servidor al leer Firestore.',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePersistToFirestore = async () => {
    const isAdmin = role?.toLowerCase() === 'admin';
    if (!isAdmin) {
      toast({
        variant: 'destructive',
        title: 'No permitido',
        description: `Solo administrador puede guardar en Firebase (rol actual: ${role ?? 'sin sesión'}).`,
      });
      return;
    }
    setIsSavingFirestore(true);
    try {
      const res = await ingestReturnsPeriod({
        periodId: periodIdInput.trim(),
        transactions: processedData,
        status: periodStatus,
        lastIngestBy: user?.email ?? undefined,
        forceReopenComplete: forceReopenComplete,
        callerRole: role,
      });
      if (!res.success) {
        toast({ variant: 'destructive', title: 'No se guardó', description: res.error });
        return;
      }
      toast({
        title: 'Guardado en Firebase',
        description: `${res.bucketCount ?? 0} buckets · días tocados: ${(res.dayKeysTouched ?? []).join(', ') || '—'}`,
      });
      try {
        await refreshFirestoreMetadata();
      } catch (metaErr) {
        console.error('[returns-module] refreshFirestoreMetadata tras guardar:', metaErr);
      }
    } catch (e) {
      console.error('[returns-module] handlePersistToFirestore:', e);
      toast({
        variant: 'destructive',
        title: 'Error inesperado',
        description: e instanceof Error ? e.message : 'Fallo al invocar la acción de guardado.',
      });
    } finally {
      setIsSavingFirestore(false);
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (role === 'office') return;
    const files = event.target.files;
    if (!files || files.length === 0) return;
    
    setIsProcessing(true);
    
    let displayName = '';
    const isDirectoryUpload = files[0].webkitRelativePath;

    if (isDirectoryUpload) {
      const folderName = files[0].webkitRelativePath.split('/')[0];
      displayName = `Carpeta: ${folderName} (${files.length} archivo${files.length > 1 ? 's' : ''})`;
    } else {
      displayName = files[0].name + (files.length > 1 ? ` y ${files.length - 1} más` : '');
    }
    setFileName(displayName);


    try {
      let allRows: RawTransaction[] = [];
      for (const file of Array.from(files)) {
        if(file.name.endsWith('.xlsx')) {
            const data = await file.arrayBuffer();
            const workbook = XLSX.read(data);
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const json = XLSX.utils.sheet_to_json<RawTransaction>(worksheet);
            allRows = allRows.concat(json);
        }
      }
      setRawDataForPreview(allRows);
      const processedPreview = processRawData(allRows);
      setProcessedDataForPreview(processedPreview);
      setShowPreview(true);
    } catch (error) {
      console.error("Error al procesar el archivo XLSX:", error);
      alert("Hubo un error al procesar el archivo. Por favor, asegúrate de que sea un archivo XLSX válido.");
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleConfirmPreview = () => {
    setProcessedData(processedDataForPreview);
    setShowPreview(false);
    setRawDataForPreview([]);
    setProcessedDataForPreview([]);
  };
  
  const handleCancelPreview = () => {
    setShowPreview(false);
    setRawDataForPreview([]);
    setProcessedDataForPreview([]);
  };

  const triggerFileUpload = () => {
    if (fileInputRef.current) {
      fileInputRef.current.removeAttribute('webkitdirectory');
      fileInputRef.current.click();
    }
  };

  const triggerFolderUpload = () => {
    if (fileInputRef.current) {
        fileInputRef.current.setAttribute('webkitdirectory', 'true');
        fileInputRef.current.click();
    }
  };

  const generatePdf = (data: Transaction[], filename: string, _year: number) => {
    return new Promise<void>((resolve, reject) => {
      setCurrentPdfName(filename);
      setProcessedData(data);

      setTimeout(() => {
        void (async () => {
          try {
            const html2pdf = await loadHtml2Pdf();
            const element = document.getElementById('dashboard-for-print');
            if (!element) {
              reject(new Error('Print layout element (#dashboard-for-print) not found for PDF export.'));
              return;
            }
            const options = {
              margin: [0.25, 0.25, 0.25, 0.25] as [number, number, number, number],
              filename: `${filename}.pdf`,
              image: { type: 'jpeg' as const, quality: 0.85 },
              html2canvas: { scale: 1.5, useCORS: true, logging: false },
              jsPDF: { unit: 'in', format: 'letter', orientation: 'landscape' as const },
            };
            await html2pdf().from(element).set(options).save();
            resolve();
          } catch (e) {
            reject(e);
          }
        })();
      }, 1500);
    });
  };

  const handleExportPdf = async () => {
      if (!dashboardStateRef.current) {
        alert("Por favor, espera a que el dashboard cargue completamente antes de exportar.");
        return;
      }

      setIsGeneratingPdf(true); // Show spinner overlay
      setIsPrinting(true); // Switch to print layout
      
      // Allow a moment for React to re-render and show the print layout
      await new Promise(resolve => setTimeout(resolve, 100));

      const originalDataState = processedData;
      const originalDashboardState = { ...dashboardStateRef.current };

      try {
          const selectedYear = originalDashboardState.year;
          const previousYear = selectedYear - 1;

          const dataForBothYears = originalDataState.filter(d => 
              d.date.getFullYear() === selectedYear || d.date.getFullYear() === previousYear
          );
          
          const allPdvsForSelectedYear = Array.from(new Set(
            dataForBothYears
                .filter(d => d.date.getFullYear() === selectedYear)
                .map(d => d.pdv)
          ));
          
          const internetAndInstoreGroup = ['Ventas por Internet', 'Canal INSTORE'];
          
          const internetInstoreData = dataForBothYears.filter(d => internetAndInstoreGroup.includes(d.pdv));
          if (internetInstoreData.length > 0) {
              await generatePdf(internetInstoreData, 'Reporte_Internet_y_Tiendas_Propias', selectedYear);
          }
          
          const marketplaces = allPdvsForSelectedYear.filter(p => !internetAndInstoreGroup.includes(p) && p !== 'N/A');
          for (const marketplace of marketplaces) {
              const marketplaceData = dataForBothYears.filter(d => d.pdv === marketplace);
              await generatePdf(marketplaceData, `Reporte_${marketplace.replace(/ /g, '_')}`, selectedYear);
          }

          alert('Exportación a PDF completada.');
      } catch (error) {
          console.error("Failed to generate PDFs:", error);
          alert("Ocurrió un error durante la exportación a PDF.");
      } finally {
          // Restore original state regardless of success or failure
          setProcessedData(originalDataState);
          dashboardStateRef.current = originalDashboardState;
          setCurrentPdfName('');
          setIsPrinting(false); // Switch back to screen layout
          setIsGeneratingPdf(false); // Hide spinner overlay
      }
  };

  // Set dark mode
  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  if (authLoading) {
    return (
      <AuthLayout>
        <div className="flex min-h-[50vh] items-center justify-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
        </div>
      </AuthLayout>
    );
  }

  if (!canAccessReturns) {
    return (
      <AuthLayout>
        <div className="mx-auto max-w-lg rounded-lg border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Acceso restringido</h1>
          <p className="mt-2 text-slate-600 dark:text-slate-400">
            El reporte de devoluciones solo está disponible para los perfiles administrador u oficina.
          </p>
          <Button className="mt-6" onClick={() => router.push('/')} variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver a la Suite
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      {isGeneratingPdf && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex flex-col items-center justify-center z-50 text-white" aria-live="assertive">
            <h2 className="text-2xl font-bold mb-4">Generando reportes en PDF...</h2>
            <p>Esto puede tardar unos momentos. No cierres la ventana.</p>
            {currentPdfName && <p className="mt-2 text-sm text-slate-300">Generando: {currentPdfName}.pdf</p>}
             <div className="w-16 h-16 border-4 border-dashed rounded-full animate-spin border-indigo-400 mt-4"></div>
        </div>
      )}
      <div className={`min-h-screen bg-slate-100 dark:bg-slate-900 p-4 sm:p-6 lg:p-8 ${isPrinting ? 'invisible' : ''}`}>
        <div className="max-w-7xl mx-auto">
          <header className="mb-8 flex flex-wrap justify-between items-center gap-4">
            <div>
              <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Análisis de Ventas y Devoluciones</h1>
              <p className="text-slate-500 dark:text-slate-400">Mostrando datos de: <span className="font-semibold text-slate-600 dark:text-slate-300">{fileName}</span></p>
              {role === 'office' && (
                <p className="mt-2 text-sm text-amber-700 dark:text-amber-300/90">
                  Perfil oficina: puede explorar el reporte, filtrar y exportar PDF; no puede cargar archivos ni carpetas de datos.
                </p>
              )}
               <Button onClick={() => router.push('/')} variant="outline" className="mt-4">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Volver a la Suite
                </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2 justify-end">
              {canUploadExcel && (
                <>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                className="hidden"
                accept=".xlsx, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                multiple
              />
              <button
                onClick={triggerFileUpload}
                disabled={isProcessing || isGeneratingPdf}
                className="bg-indigo-600 text-white font-semibold px-5 py-2.5 rounded-lg shadow-md hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                {isProcessing ? 'Procesando...' : 'Cargar Archivos'}
              </button>
               <button
                onClick={triggerFolderUpload}
                disabled={isProcessing || isGeneratingPdf}
                className="bg-sky-600 text-white font-semibold px-5 py-2.5 rounded-lg shadow-md hover:bg-sky-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                {isProcessing ? 'Procesando...' : 'Cargar Carpeta'}
              </button>
                </>
              )}
              <button
                onClick={handleExportPdf}
                disabled={isProcessing || isGeneratingPdf}
                className="bg-slate-600 text-white font-semibold px-5 py-2.5 rounded-lg shadow-md hover:bg-slate-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                <FileDownIcon className="w-5 h-5"/>
                <span>{isGeneratingPdf ? 'Exportando...' : 'Exportar PDF'}</span>
              </button>
            </div>
          </header>
          {role === 'admin' && (
            <section className="mb-8 rounded-xl border border-violet-200 bg-violet-50/80 p-4 text-sm text-slate-800 shadow-sm dark:border-violet-900/50 dark:bg-violet-950/40 dark:text-slate-200">
              <h2 className="mb-2 text-base font-bold text-violet-900 dark:text-violet-200">Persistencia Firebase (devoluciones)</h2>
              <p className="mb-3 text-xs text-slate-600 dark:text-slate-400">
                Los datos se guardan como buckets agregados (opción B) en <code className="rounded bg-white/70 px-1 dark:bg-slate-900/80">returnsPeriods/&lt;YYYY-MM&gt;/buckets</code>.
                Idempotencia por día: al guardar, se borran solo los días presentes en el dataset actual y se reescriben.
              </p>
              {firestorePeriods.length > 0 && (
                <p className="mb-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                  Períodos en Firestore:{' '}
                  {firestorePeriods.map((p) => `${p.periodId} (${p.status})`).join(' · ')}
                </p>
              )}
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-xs font-semibold">
                  Período (YYYY-MM)
                  <input
                    className="rounded-md border border-slate-300 bg-white px-2 py-1.5 font-mono text-sm dark:border-slate-600 dark:bg-slate-900"
                    value={periodIdInput}
                    onChange={(e) => setPeriodIdInput(e.target.value)}
                    placeholder="2025-01"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold">
                  Estado
                  <select
                    className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
                    value={periodStatus}
                    onChange={(e) => setPeriodStatus(e.target.value as ReturnsPeriodStatus)}
                  >
                    <option value="partial">Parcial</option>
                    <option value="complete">Completo</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 text-xs font-semibold">
                  <input
                    type="checkbox"
                    checked={forceReopenComplete}
                    onChange={(e) => setForceReopenComplete(e.target.checked)}
                  />
                  Forzar si el mes estaba completo
                </label>
                <button
                  type="button"
                  disabled={isSavingFirestore || isProcessing || isGeneratingPdf}
                  onClick={() => void handlePersistToFirestore()}
                  className="rounded-lg bg-violet-700 px-4 py-2 text-xs font-bold text-white shadow hover:bg-violet-800 disabled:opacity-50"
                >
                  {isSavingFirestore ? 'Guardando…' : 'Guardar datos actuales en Firebase'}
                </button>
                <button
                  type="button"
                  disabled={isProcessing || isGeneratingPdf}
                  onClick={() => void handleReloadFromFirestore()}
                  className="rounded-lg border border-violet-400 bg-white px-4 py-2 text-xs font-bold text-violet-900 shadow-sm hover:bg-violet-100 dark:bg-slate-900 dark:text-violet-200 dark:hover:bg-slate-800"
                >
                  Recargar desde Firebase
                </button>
              </div>
            </section>
          )}
          <main>
            {isProcessing && processedData.length === 0 ? (
                 <div className="flex items-center justify-center min-h-[50vh] text-slate-800 dark:text-slate-200">
                   <div className="text-2xl font-semibold">Cargando datos del Dashboard...</div>
                 </div>
            ) : (
                <Dashboard 
                    data={processedData} 
                    isPrinting={isPrinting}
                    onStateChange={(state) => {
                      if (!isGeneratingPdf && !isPrinting) {
                        dashboardStateRef.current = state;
                      }
                    }}
                    initialState={dashboardStateRef.current}
                />
            )}
          </main>
        </div>
      </div>
      {showPreview && (
        <DataPreviewModal
          rawData={rawDataForPreview}
          processedData={processedDataForPreview}
          onConfirm={handleConfirmPreview}
          onCancel={handleCancelPreview}
          fileName={fileName}
        />
      )}
    </AuthLayout>
  );
};

    
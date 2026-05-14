
"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
import { firebaseProjectId } from '@/services/firebase';
import {
  estimateReturnsReadsFromMeta,
  fingerprintReturnsMetaForYears,
  formatReturnsFirestoreError,
  getReturnsTransactionsForYears,
  ingestReturnsPeriod,
  listReturnsPeriodMetaForYears,
  listReturnsPeriods,
  yearsInclusive,
} from '@/lib/returnsIngest/firestoreReturnsClient';
import {
  clearReturnsReadCache,
  readReturnsReadCache,
  writeReturnsReadCache,
} from '@/lib/returnsIngest/returnsReadCache';

const RETURNS_ACCESS_ROLES = new Set(['admin', 'office']);
/** Caché local IndexedDB: evita releer todos los buckets si los metadatos no cambiaron. */
const RETURNS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

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
  const nowYear = new Date().getFullYear();
  const [loadYearFrom, setLoadYearFrom] = useState(nowYear);
  const [loadYearTo, setLoadYearTo] = useState(nowYear);
  const [forceRefreshFs, setForceRefreshFs] = useState(false);
  const [dataReadSource, setDataReadSource] = useState<'cache' | 'network' | 'mock' | null>(null);

  const firestoreYearOptions = useMemo(() => Array.from({ length: 14 }, (_, i) => nowYear - i), [nowYear]);

  const readYearsSpan = useMemo(() => yearsInclusive(loadYearFrom, loadYearTo), [loadYearFrom, loadYearTo]);
  const readEstimate = useMemo(
    () => estimateReturnsReadsFromMeta(firestorePeriods, readYearsSpan),
    [firestorePeriods, readYearsSpan],
  );

  const pullReturnsData = useCallback(
    async (
      years: number[],
      forceRemote: boolean,
      opts?: { silent?: boolean },
    ): Promise<{ status: 'cache' | 'network' | 'empty' | 'meta_error' | 'fetch_error'; rows?: number }> => {
      const meta = await listReturnsPeriodMetaForYears(years);
      if (!meta.success || !meta.data) {
        if (!opts?.silent) {
          toast({ variant: 'destructive', title: 'Firestore', description: meta.error ?? 'No se listaron períodos.' });
        }
        return { status: 'meta_error' };
      }
      setFirestorePeriods(meta.data);
      const fp = fingerprintReturnsMetaForYears(meta.data, years);
      const sortedY = [...new Set(years.filter(Number.isFinite))].sort((a, b) => a - b);
      const key = `${firebaseProjectId}|y:${sortedY.join(',')}|fp:${fp}`;
      if (!forceRemote) {
        const cached = await readReturnsReadCache(key, RETURNS_CACHE_TTL_MS);
        if (cached && cached.length > 0) {
          setProcessedData(cached);
          setFileName('Datos desde Firebase (caché local · máx. 24 h)');
          setDataReadSource('cache');
          return { status: 'cache', rows: cached.length };
        }
      }
      const fromFs = await getReturnsTransactionsForYears(years);
      if (!fromFs.success) {
        if (!opts?.silent) {
          toast({ variant: 'destructive', title: 'Error', description: fromFs.error ?? 'No se pudo leer buckets.' });
        }
        return { status: 'fetch_error' };
      }
      if (fromFs.data && fromFs.data.length > 0) {
        setProcessedData(fromFs.data);
        setFileName('Datos desde Firebase');
        setDataReadSource('network');
        await writeReturnsReadCache(key, fromFs.data, RETURNS_CACHE_TTL_MS);
        return { status: 'network', rows: fromFs.data.length };
      }
      return { status: 'empty' };
    },
    [toast],
  );

  const refreshFirestoreMetadata = async (opts?: { showErrorToast?: boolean }) => {
    const meta = await listReturnsPeriods();
    if (meta.success && meta.data) {
      setFirestorePeriods(meta.data);
    } else if (!meta.success && meta.error && opts?.showErrorToast) {
      toast({ variant: 'destructive', title: 'Períodos en Firebase', description: meta.error });
    }
  };

  // Carga inicial: solo año en curso (menos lecturas). Caché local 24 h si metadatos coinciden.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsProcessing(true);
      const y = new Date().getFullYear();
      try {
        const result = await pullReturnsData(yearsInclusive(y, y), false, { silent: true });
        if (cancelled) return;
        if (result.status !== 'cache' && result.status !== 'network') {
          const mockRawData = generateMockData();
          setProcessedData(processRawData(mockRawData));
          setFileName('Datos de muestra (local)');
          setDataReadSource('mock');
        }
      } catch (e) {
        console.error('[returns-module] Firestore inicial:', e);
        if (!cancelled) {
          const mockRawData = generateMockData();
          setProcessedData(processRawData(mockRawData));
          setFileName('Datos de muestra (local)');
          setDataReadSource('mock');
        }
      } finally {
        if (!cancelled) setIsProcessing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pullReturnsData]);

  const handleReloadFromFirestore = async () => {
    setIsProcessing(true);
    try {
      const years = yearsInclusive(loadYearFrom, loadYearTo);
      const r = await pullReturnsData(years, forceRefreshFs, { silent: false });
      if (r.status === 'meta_error' || r.status === 'fetch_error') return;
      if (r.status === 'empty') {
        toast({
          variant: 'destructive',
          title: 'Sin datos en Firebase',
          description: `No hay buckets para el rango de años seleccionado (${years.join(', ')}).`,
        });
        return;
      }
      try {
        await refreshFirestoreMetadata({ showErrorToast: true });
      } catch (metaErr) {
        console.error('[returns-module] refreshFirestoreMetadata:', metaErr);
        toast({
          variant: 'destructive',
          title: 'Metadatos',
          description: 'Los datos se cargaron pero no se pudo actualizar la lista de períodos en pantalla.',
        });
      }
      const src = r.status === 'cache' ? 'caché local (sin releer buckets)' : 'Firebase';
      toast({
        title: r.status === 'cache' ? 'Datos desde caché' : 'Datos actualizados',
        description: `${src} · ${r.rows ?? 0} líneas reconstruidas.`,
      });
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

  const handleClearReturnsReadCache = async () => {
    await clearReturnsReadCache();
    toast({ title: 'Caché local borrada', description: 'La próxima recarga leerá de nuevo desde Firebase.' });
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
        description: `${res.bucketCount ?? 0} buckets · meses reescritos: ${(res.monthsTouched ?? []).join(', ') || '—'}`,
      });
      await clearReturnsReadCache();
      try {
        await refreshFirestoreMetadata({ showErrorToast: true });
      } catch (metaErr) {
        console.error('[returns-module] refreshFirestoreMetadata tras guardar:', metaErr);
      }
    } catch (e) {
      console.error('[returns-module] handlePersistToFirestore:', e);
      toast({
        variant: 'destructive',
        title: 'Error inesperado',
        description: formatReturnsFirestoreError(e),
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
          {canAccessReturns && (
            <section className="mb-6 rounded-xl border border-sky-200 bg-sky-50/80 p-4 text-sm text-slate-800 shadow-sm dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-slate-200">
              <h2 className="mb-2 text-base font-bold text-sky-900 dark:text-sky-200">Lectura desde Firebase (coste)</h2>
              <p className="mb-2 text-xs text-slate-600 dark:text-slate-400">
                Cada documento en la subcolección <code className="rounded bg-white/70 px-0.5 dark:bg-slate-900/80">buckets</code> cuenta como
                una lectura en facturación. Por defecto la suite carga solo el <strong>año en curso</strong>; amplíe el rango solo cuando necesite
                comparar más años. Si los metadatos de esos meses no cambiaron, durante <strong>24 horas</strong> se usa una caché en este navegador
                (casi cero lecturas de buckets al volver a entrar).
              </p>
              <div className="mb-2 flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-xs font-semibold">
                  Año desde
                  <select
                    className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
                    value={loadYearFrom}
                    onChange={(e) => setLoadYearFrom(Number(e.target.value))}
                  >
                    {firestoreYearOptions.map((y) => (
                      <option key={`from-${y}`} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold">
                  Año hasta
                  <select
                    className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
                    value={loadYearTo}
                    onChange={(e) => setLoadYearTo(Number(e.target.value))}
                  >
                    {firestoreYearOptions.map((y) => (
                      <option key={`to-${y}`} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex max-w-xs items-center gap-2 text-xs font-semibold leading-snug">
                  <input
                    type="checkbox"
                    checked={forceRefreshFs}
                    onChange={(e) => setForceRefreshFs(e.target.checked)}
                  />
                  Forzar lectura remota (ignorar caché 24 h)
                </label>
              </div>
              <p className="mb-2 text-xs text-slate-700 dark:text-slate-300">
                Estimado en el rango elegido: aprox.{' '}
                <strong>{readEstimate.estimatedBucketDocReads.toLocaleString('es-CO')}</strong> lecturas de documentos bucket
                {readEstimate.monthsInRange > 0 ? (
                  <>
                    {' '}
                    ({readEstimate.monthsInRange} mes(es) con metadatos en Firebase)
                  </>
                ) : (
                  <> (sin meses con datos en ese rango según metadatos locales)</>
                )}
                . El listado de períodos por año usa consultas acotadas, no toda la colección.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={isProcessing || isGeneratingPdf}
                  onClick={() => void handleReloadFromFirestore()}
                  className="rounded-lg bg-sky-700 px-4 py-2 text-xs font-bold text-white shadow hover:bg-sky-800 disabled:opacity-50"
                >
                  {isProcessing ? 'Leyendo…' : 'Recargar desde Firebase'}
                </button>
                <button
                  type="button"
                  disabled={isProcessing || isGeneratingPdf}
                  onClick={() => void handleClearReturnsReadCache()}
                  className="rounded-lg border border-sky-500 bg-white px-4 py-2 text-xs font-bold text-sky-900 shadow-sm hover:bg-sky-100 dark:bg-slate-900 dark:text-sky-200 dark:hover:bg-slate-800"
                >
                  Limpiar caché local
                </button>
              </div>
            </section>
          )}
          {role === 'admin' && (
            <section className="mb-8 rounded-xl border border-violet-200 bg-violet-50/80 p-4 text-sm text-slate-800 shadow-sm dark:border-violet-900/50 dark:bg-violet-950/40 dark:text-slate-200">
              <h2 className="mb-2 text-base font-bold text-violet-900 dark:text-violet-200">Persistencia Firebase (devoluciones)</h2>
              <p className="mb-3 text-xs text-slate-600 dark:text-slate-400">
                Los datos se guardan como buckets agregados (opción B) en <code className="rounded bg-white/70 px-1 dark:bg-slate-900/80">returnsPeriods/&lt;YYYY-MM&gt;/buckets</code>.
                Idempotencia por mes: al guardar, se borran los buckets de los meses presentes en el Excel (incluye legado diario del mismo mes) y se reescriben.
              </p>
              {firestorePeriods.length > 0 && (
                <p className="mb-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                  Períodos en Firestore (rango o última carga):{' '}
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

    
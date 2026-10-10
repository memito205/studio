"use client";

import React from 'react';
import Header from './components/Header';
import FileUpload from './components/FileUpload';
import ReportTable from './components/ReportTable';
import Loader from './components/Loader';
import FilterPanel from './components/FilterPanel';
import KPI from './components/KPI';
import AnalysisDashboard from './components/AnalysisDashboard';
import DailyIndicatorChart from './components/DailyIndicatorChart';
import SlaAnalysisTable from './components/SlaAnalysisTable';
import PendingDocsAnalysisTable from './components/PendingDocsAnalysisTable';
import BreakdownDashboard from './components/BreakdownDashboard';
import RutasModule from './components/RutasModule';
import WarehouseProcessesModule from './components/WarehouseProcessesModule';
import NovedadesModule from './components/NovedadesModule';
import { useReportData } from './hooks/useReportData';
import { findHeader, normalizeDate, formatDate, parseDateString, generatePendingSummaryPdf, getWeekStartDate, getCalendarDateKey, getTodayCalendarKey, normalizeDocId, buildTfWarehouseKey, getAnalyzerWarehouseMatchKeys, findQuickMatchForAnalyzer, getRouteMatchStatus, normalizePlate } from './utils/helpers';
import type { AnalyzerRouteMatch } from './utils/helpers';
import type { ExcelDataRow, BreaksReportData, ProcessedBreak, EmployeeDailyAnalysis, DailyAnalysis, WeeklyTrend, EmployeePerformance } from './types';
import type { TransferEntry } from '@/types';
import { loadAnalysisRecords, syncAnalysisRecords, persistTfPlatformStatuses, getAnalyzerAppStatusKeys, getAnalysisVersion, type OpenRouteTf } from '@/app/actions';
import { readLocalSnapshot, writeLocalSnapshot } from '@/lib/localSnapshotCache';
import { buildTfPlatformDocId, buildTfPlatformStatusRecords } from '@/lib/tfPlatformStatus';
import { getAppPodIndex } from '@/app/podActions';
import { buildAppPodIndex, overlayAppPods, type AppPodEntry } from '@/lib/podPlatform';
import { buildAnalyzerSnapshotDocs, type AnalyzerSnapshotDocWrite } from '@/lib/analyzerSnapshot';
import { saveAnalyzerSnapshotDocs } from '@/app/analyzerSnapshotActions';
import { getDeliveryStores } from '@/app/deliveryActions';
import { FileIcon, PackageIcon, TruckIcon, ChartIcon, CheckCircleIcon, TableIcon, UserCheckIcon, PdfFileIcon } from './components/icons';
import { Button } from '@/components/ui/button';
import { RefreshCw, Database, CloudUpload, Store } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth-context';
import * as XLSX from 'xlsx';


type SnapshotAppKeys = { received: string[]; collected: string[]; novedad: string[]; routes: Map<string, AnalyzerRouteMatch> };

/** TF en relaciones de ruta abiertas → EN RUTA HOY (con alias de bodega y placa de la relación). */
function buildAppRouteMap(enRuta: OpenRouteTf[]): Map<string, AnalyzerRouteMatch> {
  const map = new Map<string, AnalyzerRouteMatch>();
  enRuta.forEach((r) => {
    const sep = r.key.indexOf('|');
    if (sep < 0) return;
    const tf = r.key.slice(0, sep);
    const match: AnalyzerRouteMatch = { status: 'EN RUTA HOY', placaEntrega: r.placa };
    getAnalyzerWarehouseMatchKeys(r.key.slice(sep + 1)).forEach((whs) => map.set(`${tf}|${whs}`, match));
  });
  return map;
}

// --- MODULE 1: Warehouse Analyzer ---
const WarehouseAnalyzer: React.FC = () => {
  // --- CORE STATES ---
  const [baseData, setBaseData] = React.useState<ExcelDataRow[]>([]);
  const [columnMap, setColumnMap] = React.useState<{ [key: string]: string | undefined }>({});
  const [rawHeaders, setRawHeaders] = React.useState<string[]>([]);
  const [debugMapping, setDebugMapping] = React.useState<{ expected: string; found: string }[]>([]);
  const [availableWarehouses, setAvailableWarehouses] = React.useState<string[]>([]);
  const [mainFileName, setMainFileName] = React.useState<string | null>(null);

  // --- ESTADOS DEL APLICATIVO (rutas abiertas + status de Transferencias) ---
  const [routeData, setRouteData] = React.useState<Map<string, AnalyzerRouteMatch>>(new Map());
  const [novedadKeys, setNovedadKeys] = React.useState<string[]>([]);
  const [appStatusAt, setAppStatusAt] = React.useState<Date | null>(null);
  const [isAppStatusLoading, setIsAppStatusLoading] = React.useState(false);

  // --- UI CONTROL STATES ---
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [infoMessage, setInfoMessage] = React.useState<string | null>(null);
  
  // --- FILTER STATES ---
  const [selectedWarehouse, setSelectedWarehouse] = React.useState<string>('all');
  const [startDate, setStartDate] = React.useState<string>('');
  const [endDate, setEndDate] = React.useState<string>('');
  const [documentNumberFilter, setDocumentNumberFilter] = React.useState('');
  const deferredDocumentNumberFilter = React.useDeferredValue(documentNumberFilter);
  const [dataCount, setDataCount] = React.useState(0);
  const [filteredCount, setFilteredCount] = React.useState(0);
  const [isSyncing, setIsSyncing] = React.useState(false);
  const [platformFileName, setPlatformFileName] = React.useState<string | null>(null);
  const [isPublishingPlatform, setIsPublishingPlatform] = React.useState(false);
  const [receivedInWarehouseKeys, setReceivedInWarehouseKeys] = React.useState<string[]>([]);
  const [collectedOnRouteKeys, setCollectedOnRouteKeys] = React.useState<string[]>([]);
  const { user, userName } = useAuth();
  const [appPodIndex, setAppPodIndex] = React.useState<Map<string, AppPodEntry>>(new Map());
  const [isSavingSnapshot, setIsSavingSnapshot] = React.useState(false);
  const saveSnapshotRef = React.useRef<((keys?: SnapshotAppKeys) => Promise<void>) | null>(null);

  // Ids tf_platform_status de la base; Quick no cambia TF ni bodega, así que subirlo no vuelve a leer.
  const baseIdsKey = React.useMemo(() => {
    if (!columnMap.doc || !columnMap.warehouse) return '';
    const ids = new Set<string>();
    baseData.forEach((row) => {
      const tf = normalizeDocId(row[columnMap.doc!]);
      const whs = String(row[columnMap.warehouse!] || '').trim();
      if (tf && whs) ids.add(buildTfPlatformDocId(tf, whs));
    });
    return Array.from(ids).sort().join(',');
  }, [baseData, columnMap.doc, columnMap.warehouse]);

  React.useEffect(() => {
    if (!baseIdsKey) return;
    let alive = true;
    getAppPodIndex(baseIdsKey.split(','))
      .then((res) => {
        if (alive && res.data) setAppPodIndex(buildAppPodIndex(res.data));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [baseIdsKey]);

  /** Rutas abiertas, Recibido en Bodega, Recolectado en Ruta y Novedad de Entrega desde el aplicativo. */
  const loadAppStatuses = React.useCallback(async (force = false) => {
    setIsAppStatusLoading(true);
    try {
      const res = await getAnalyzerAppStatusKeys({ force });
      if (!res.data) throw new Error(res.error || 'No se pudieron leer los estados del aplicativo.');
      const routes = buildAppRouteMap(res.data.enRuta);
      setRouteData(routes);
      setReceivedInWarehouseKeys(res.data.received);
      setCollectedOnRouteKeys(res.data.collected);
      setNovedadKeys(res.data.novedad);
      setAppStatusAt(new Date(res.data.at));
      return { ...res.data, routes };
    } finally {
      setIsAppStatusLoading(false);
    }
  }, []);

  const publishPlatformStatusesIfComplete = React.useCallback(
    async (data: ExcelDataRow[], map: { [key: string]: string | undefined }) => {
      if (!data.length) {
        toast({
          title: 'Sin datos',
          description: 'No hay filas de transferencias para publicar.',
          variant: 'destructive',
        });
        return;
      }
      if (!map.doc || !map.warehouse) {
        toast({
          title: 'Mapeo incompleto',
          description: `Falta columna ${!map.doc ? 'NRO DOCUMENTO / TF' : 'bodega destino'} en la base. Revise la validación de columnas.`,
          variant: 'destructive',
        });
        return;
      }

      setIsPublishingPlatform(true);
      try {
        // Estados del aplicativo con antigüedad máxima de 10 min (caché compartida).
        const app = await loadAppStatuses();

        const records = buildTfPlatformStatusRecords(
          data,
          {
            doc: map.doc,
            warehouse: map.warehouse,
            warehouseOut: map.warehouseOut,
            qty: map.qty,
            fecha: map.fecha,
            marca: map.marca,
            grupo: map.grupo,
            estadoPlataforma: map.estadoPlataforma || 'estadoPlataforma',
            hoyRuta: map.hoyRuta || 'hoyRuta',
            fechaFinalizado: map.fechaFinalizado || 'fechaFinalizado',
            image: map.image || 'image',
          },
          app.routes,
          userName || user?.email || undefined,
          app.received,
          app.collected,
          app.novedad
        );

        if (!records.length) {
          toast({
            title: 'Sin estados para publicar',
            description: 'No se generaron registros TF+destino a partir del cruce.',
            variant: 'destructive',
          });
          return;
        }

        const result = await persistTfPlatformStatuses(records);
        if (!result.success) throw new Error(result.error || 'Error al publicar');

        const closed = result.closedEnRutaHoy || 0;
        toast({
          title: 'Estados publicados para tiendas',
          description:
            `Se publicaron ${result.count} TF (estado plataforma) en Firestore (colección tf_platform_status).` +
            (closed > 0
              ? ` Se cerraron ${closed} EN RUTA HOY previas que no venían en esta publicación → ENTREGADO.`
              : ''),
        });
        void saveSnapshotRef.current?.({ received: app.received, collected: app.collected, novedad: app.novedad, routes: app.routes });
      } catch (err: any) {
        console.error(err);
        toast({
          title: 'Error al publicar estados',
          description: err.message || 'No se pudo guardar el estado plataforma. Revise reglas de Firestore / consola.',
          variant: 'destructive',
        });
      } finally {
        setIsPublishingPlatform(false);
      }
    },
    [user?.email, userName, loadAppStatuses]
  );

  const fetchTransfersFromDB = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
        // Snapshot del último Excel (`transfers_analysis`) + estados del aplicativo en paralelo.
        const loadAnalysisCached = async (): Promise<{ data?: any[]; error?: string }> => {
          const [ver, local] = await Promise.all([getAnalysisVersion(), readLocalSnapshot<any[]>('transfers_analysis')]);
          if (ver.version && local && local.version === ver.version && Array.isArray(local.data)) {
            return { data: local.data };
          }
          const fresh = await loadAnalysisRecords();
          if (fresh.data && ver.version) void writeLocalSnapshot('transfers_analysis', ver.version, fresh.data);
          return fresh;
        };
        const [result] = await Promise.all([
          loadAnalysisCached(),
          loadAppStatuses().catch((e) => setError(`Estados del aplicativo: ${e.message}`)),
        ]);
        if (result.error) {
            throw new Error(result.error);
        }

        if (result.data) {
            processData(result.data);
            setDataCount(result.data.length);
            setMainFileName("Base de Datos (Análisis Raw)");
        }
    } catch (err: any) {
        setError(`Error al cargar datos desde la base de datos: ${err.message}`);
    } finally {
        setIsLoading(false);
    }
  }, []);
  
  const handleSyncToDB = async () => {
    if (baseData.length === 0) {
        toast({ title: "No hay datos", description: "Carga un archivo antes de sincronizar.", variant: "destructive" });
        return;
    }

    setIsSyncing(true);
    try {
        // Nunca podar: baseData del analizador ya viene filtrado; borrar el resto
        // vaciaba transfers_analysis (ej. solo quedaban ~14 TFs y desaparecía 631254).
        const result = await syncAnalysisRecords(baseData, { pruneMissing: false });
        if (result.success) {
            toast({
              title: "Sincronización parcial OK",
              description: `Se actualizaron ${result.count} registros visibles. Para reemplazar TODO el analizador, vuelva a subir el Excel en Transferencias.`,
            });
        } else {
            throw new Error(result.error);
        }
    } catch (err: any) {
        toast({ title: "Error de Sincronización", description: err.message, variant: "destructive" });
    } finally {
        setIsSyncing(false);
    }
  };

  React.useEffect(() => {
    fetchTransfersFromDB();
  }, [fetchTransfersFromDB]);

  const handleClearFilters = () => {
    setSelectedWarehouse('all');
    setStartDate('');
    setEndDate('');
    setDocumentNumberFilter('');
  };
  
  const processData = React.useCallback((data: ExcelDataRow[]) => {
    if (data.length === 0) {
        setError("El archivo de Excel está vacío o no tiene datos.");
        setBaseData([]);
        setColumnMap({});
        return;
    }

    const headers = Object.keys(data[0]);
    setRawHeaders(headers);
    
    // --- Definición de columnas ---
    const DOC_COL_NAMES = [
      'Nro documento.2',
      'Nro documento.',
      'Nro Documento',
      'Numero TF',
      'NUMERO TF',
      'numeroTF',
      'Número TF',
      'TF',
      'doc',
    ];
    const QTY_COL_NAMES = ['CANTIDAD', 'Cantidad', 'cantidad'];
    const WAREHOUSE_COL_NAMES = [
      'Bod. entrada',
      'Bodega entrada',
      'Bodega',
      'Destino',
      'Centro',
      'Almacén',
      'Almacen',
      'Bodega Destino',
      'BOD. DESTINO',
      'BOD DESTINO',
      'bodegaDestino',
    ];
    const FECHA_COL_NAMES = ['Fecha', 'fecha'];
    const WAREHOUSE_OUT_COL_NAMES = [
      'Bod. salida',
      'Bodega salida',
      'BOD SALIDA',
      'Bodega Origen',
      'BODEGA ORIGEN',
      'bodegaOrigen',
    ];
    const IMAGE_LINK_COL_NAMES = ['LINK IMAGENES.1.1.1', 'LINK_IMAGENES.1.1.1', 'LINK IMAGENES', 'Link Imagenes', 'linkimagenes', 'Imagenes', 'Evidencias'];
    const ESTADO_PLATAFORMA_COL_NAMES = ['ESTADO PLATAFORMA', 'Estado_Plataforma', 'Estado Plataforma', 'estadoplataforma'];
    const FECHA_FINALIZADO_PLATAFORMA_COL_NAMES = ['FECHA FINALIZADO PLATAFORMA', 'Fecha_Finalizado_Plataforma', 'Fecha Finalizado Plataforma', 'FECHA FINALIZADO', 'Fecha Finalizado', 'FECHA FINALIZACION', 'Fecha Finalizacion', 'FECHA FINALIZADO PALTAFORMA', 'FECHA FINALIZADO PLATAFORM'];
    const NOVEDAD_COL_NAMES = ['NOVEDAD', 'Novedad', 'Novedades'];
    const MARCA_COL_NAMES = ['MARCA', 'Marca'];
    const GRUPO_COL_NAMES = ['GRUPO', 'Grupo'];
    const ESTADO_GENERAL_COL_NAMES = ['ESTADO', 'Estado'];
    const HOY_RUTA_COL_NAMES = ['HOY RUTA.Personalizado', 'Hoy Ruta Personalizado', 'Hoy Ruta', 'HOY RUTA'];


    const newColumnMap = {
        fecha: findHeader(headers, FECHA_COL_NAMES),
        warehouse: findHeader(headers, WAREHOUSE_COL_NAMES),
        warehouseOut: findHeader(headers, WAREHOUSE_OUT_COL_NAMES),
        doc: findHeader(headers, DOC_COL_NAMES),
        qty: findHeader(headers, QTY_COL_NAMES),
        image: findHeader(headers, IMAGE_LINK_COL_NAMES),
        estadoPlataforma: findHeader(headers, ESTADO_PLATAFORMA_COL_NAMES),
        novedad: findHeader(headers, NOVEDAD_COL_NAMES),
        fechaFinalizado: findHeader(headers, FECHA_FINALIZADO_PLATAFORMA_COL_NAMES),
        marca: findHeader(headers, MARCA_COL_NAMES),
        grupo: findHeader(headers, GRUPO_COL_NAMES),
        estadoGeneral: findHeader(headers, ESTADO_GENERAL_COL_NAMES),
        hoyRuta: findHeader(headers, HOY_RUTA_COL_NAMES),
    };
    
    // Set up debug mapping for UI
    const debugMapForDisplay = [
        { expected: 'FECHA', found: newColumnMap.fecha || 'No encontrado' },
        { expected: 'BOD. ENTRADA', found: newColumnMap.warehouse || 'No encontrado' },
        { expected: 'BOD. SALIDA', found: newColumnMap.warehouseOut || 'No encontrado (Opcional)' },
        { expected: 'NRO DOCUMENTO.2', found: newColumnMap.doc || 'No encontrado' },
        { expected: 'CANTIDAD', found: newColumnMap.qty || 'No encontrado' },
        { expected: 'ESTADO PLATAFORMA', found: newColumnMap.estadoPlataforma || (platformFileName ? 'Vinculado (Plataforma)' : 'No encontrado (Opcional)') },
        { expected: 'NOVEDAD', found: newColumnMap.novedad || 'No encontrado (Opcional)' },
        { expected: 'LINK IMAGENES.1.1.1', found: newColumnMap.image || (platformFileName ? 'Vinculado (Plataforma)' : 'No encontrado (Opcional)') },
        { expected: 'FECHA FINALIZADO PLATAFORMA', found: newColumnMap.fechaFinalizado || (platformFileName ? 'Vinculado (Plataforma)' : 'No encontrado (Opcional)') },
        { expected: 'MARCA', found: newColumnMap.marca || 'No encontrado (Opcional)' },
        { expected: 'GRUPO', found: newColumnMap.grupo || 'No encontrado (Opcional)' },
        { expected: 'HOY RUTA.Personalizado', found: newColumnMap.hoyRuta || (platformFileName ? 'Vinculado (Plataforma)' : 'No encontrado (Opcional)') },
    ];
    setDebugMapping(debugMapForDisplay);

    const missingCols: string[] = [];
    if (!newColumnMap.fecha) missingCols.push(`'${FECHA_COL_NAMES[0]}'`);
    if (!newColumnMap.warehouse) missingCols.push(`'${WAREHOUSE_COL_NAMES[0]}'`);
    if (!newColumnMap.doc) missingCols.push(`'${DOC_COL_NAMES[0]}'`);
    if (!newColumnMap.qty) missingCols.push(`'${QTY_COL_NAMES[0]}'`);

    if (missingCols.length > 0) {
      setError(`El archivo de Excel no contiene las columnas requeridas. Faltan: ${missingCols.join(', ')}. Revisa la tabla de validación de columnas para más detalles.`);
      setBaseData([]);
      setColumnMap({});
      return;
    }
    setColumnMap(newColumnMap);

    // --- CORRECCIÓN DE INCONSISTENCIAS LÓGICAS ---
    let inconsistenciesFound = 0;
    const correctedData = data.map(row => {
        const estadoCol = newColumnMap.estadoPlataforma;
        const fechaCol = newColumnMap.fecha;
        const fechaFinalizadoCol = newColumnMap.fechaFinalizado;

        if (estadoCol && fechaCol && fechaFinalizadoCol) {
            const estado = String(row[estadoCol] || '').trim().toLowerCase();
            if (estado === 'finalizado') {
                const docDate = normalizeDate(row[fechaCol]);
                const finalizedDate = normalizeDate(row[fechaFinalizadoCol]);

                if (docDate && finalizedDate && finalizedDate.getTime() < docDate.getTime()) {
                    inconsistenciesFound++;
                    const newRow = { ...row };
                    newRow[estadoCol] = '';
                    return newRow;
                }
            }
        }
        return row;
    });

    // --- DE-DUPLICACIÓN Y AGREGACIÓN AVANZADA ---
    const aggregatedRecords = new Map<string, ExcelDataRow>();
    correctedData.forEach(row => {
        const docValue = row[newColumnMap.doc!];
        const warehouseValue = row[newColumnMap.warehouse!];

        if (!docValue || !warehouseValue) return;

        // The aggregation key must include Marca and Grupo to prevent merging
        // different products within the same document.
        const marcaValue = newColumnMap.marca ? String(row[newColumnMap.marca] || 'N/A') : 'N/A';
        const grupoValue = newColumnMap.grupo ? String(row[newColumnMap.grupo] || 'N/A') : 'N/A';
        const key = `${docValue}-${warehouseValue}-${marcaValue}-${grupoValue}`;

        const existingRecord = aggregatedRecords.get(key);

        if (!existingRecord) {
            // First time seeing this unique combination, add it.
            const newRow = { ...row };
            newRow[newColumnMap.qty!] = Number(newRow[newColumnMap.qty!] || 0);
            aggregatedRecords.set(key, newRow);
            return;
        }

        // Record exists, so we aggregate quantity and update the record if the new one is more recent.
        const qtyCol = newColumnMap.qty!;
        const newTotalQty = Number(existingRecord[qtyCol] || 0) + Number(row[qtyCol] || 0);

        const fechaCol = newColumnMap.fecha!;
        const existingDate = normalizeDate(existingRecord[fechaCol]);
        const currentDate = normalizeDate(row[fechaCol]);

        // If the current row is more recent, use its data but with the aggregated quantity.
        if (currentDate && (!existingDate || currentDate.getTime() > existingDate.getTime())) {
            const updatedRecord = { ...row };
            updatedRecord[qtyCol] = newTotalQty;
            aggregatedRecords.set(key, updatedRecord);
        } else {
            // Otherwise, just update the quantity of the existing (more recent) record.
            existingRecord[qtyCol] = newTotalQty;
            aggregatedRecords.set(key, existingRecord);
        }
    });

    const dedupedData = Array.from(aggregatedRecords.values());


    // --- FILTRAR BODEGAS EXCLUIDAS DEL CONJUNTO DE DATOS PRINCIPAL ---
    // Códigos internos (lista fija). NO usar endsWith('IN'): excluía MEDELLIN y similares.
    const excludedWarehouses = new Set(['BDTRA', 'BDIST', 'TRYNO', 'IMPOR', 'BGDOT', 'NONOS', 'BODFT', 'BREPA', 'SUCIO']);
    const filteredBaseData = dedupedData.filter(row => {
        const warehouseName = String(row[newColumnMap.warehouse!] || '').trim();
        if (!warehouseName) {
            return false; // Excluir filas sin bodega
        }
        const upperWarehouse = warehouseName.toUpperCase();
        return !excludedWarehouses.has(upperWarehouse);
    });

    setBaseData(filteredBaseData);
    setFilteredCount(filteredBaseData.length);
    
    // Derivar las bodegas disponibles del conjunto de datos ya filtrado
    const warehouses = [...new Set(filteredBaseData.map(row => String(row[newColumnMap.warehouse!])).filter(Boolean))]
        .sort();
    setAvailableWarehouses(warehouses);

    setError(null);
    const dropped = dedupedData.length - filteredBaseData.length;
    if (inconsistenciesFound > 0) {
      setInfoMessage(`${inconsistenciesFound} registro(s) con fechas de finalización inconsistentes fueron corregidos (el estado se marcó como no finalizado).`);
    } else if (dropped > 0) {
      setInfoMessage(
        `Base: ${dedupedData.length} líneas → ${filteredBaseData.length} tras excluir bodegas internas (BDTRA/BDIST/…). Si faltan TFs del Excel, re-suba el archivo en Transferencias.`
      );
    } else {
      setInfoMessage(null);
    }
    
  }, []);

  const handleMainFileProcess = (file: File) => {
    setIsLoading(true);
    setError(null);
    setInfoMessage(null);
    setBaseData([]);
    setMainFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true, codepage: 65001 });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData: ExcelDataRow[] = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
        
        processData(jsonData);
      } catch (err) {
        console.error(err);
        setError('Error al procesar el archivo. Asegúrate de que es un archivo Excel válido y no está corrupto.');
        setBaseData([]);
      } finally {
        setIsLoading(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };
  
  const handlePlatformFileProcess = (file: File) => {
    if (baseData.length === 0) {
        setError("Primero debes cargar el archivo principal de Transferencias para poder cruzar los datos.");
        return;
    }

    setIsLoading(true);
    setPlatformFileName(file.name);
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true, codepage: 65001 });
        
        // --- Búsqueda de Hoja QUICK con Trim y Flexibilidad ---
        const quickSheetName = workbook.SheetNames.find((name: string) => name.trim().toUpperCase() === 'QUICK') || workbook.SheetNames[0];
        
        if (!quickSheetName) {
            throw new Error("No se encontraron hojas en el archivo de Excel.");
        }

        const worksheet = workbook.Sheets[quickSheetName];
        const jsonData: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

        if (jsonData.length === 0) {
            throw new Error(`La hoja "${quickSheetName}" está vacía.`);
        }

        // --- Mapeo de Columnas Quick ---
        const headers = Object.keys(jsonData[0] || {});
        
        const QUICK_DOC_COL = findHeader(headers, ['NUMERO TF', 'Numero TF', 'NumeroTF', 'TF', 'Nro documento.2']);
        const QUICK_WHS_COL = findHeader(headers, ['BOD DESTINO', 'Bod Destino', 'Bodega Destino', 'DESTINO']);
        const QUICK_IMG_COL = findHeader(headers, ['link de imagenes', 'link imagenes', 'LINK IMAGENES']);
        const QUICK_DATE_COL = findHeader(headers, ['fecha de servicio', 'fecha servicio', 'FECHA SERVICIO']);

        if (!QUICK_DOC_COL || !QUICK_WHS_COL) {
            throw new Error(`Faltan columnas requeridas en "${quickSheetName}": se requiere NUMERO TF y BOD DESTINO.`);
        }

        const quickMap = new Map<string, any>();
        const quickByTf = new Map<string, any[]>();
        jsonData.forEach(qRow => {
            const qDoc = normalizeDocId(qRow[QUICK_DOC_COL]);
            const qWhs = String(qRow[QUICK_WHS_COL] || '').trim().toUpperCase();
            if (!qDoc) return;

            if (!quickByTf.has(qDoc)) quickByTf.set(qDoc, []);
            quickByTf.get(qDoc)!.push(qRow);

            if (qWhs) {
                getAnalyzerWarehouseMatchKeys(qWhs).forEach((whsKey) => {
                    const key = `${qDoc}-${whsKey}`;
                    if (!quickMap.has(key)) quickMap.set(key, qRow);
                });
            }
        });

        const todayKey = getTodayCalendarKey();
        const fechaFinCol = columnMap.fechaFinalizado || 'fechaFinalizado';
        const estadoPlatCol = columnMap.estadoPlataforma || 'estadoPlataforma';
        const targetImageCol = columnMap.image || 'image';

        let matchesCount = 0;
        let entregadoCount = 0;
        let aliasOrExactMatches = 0;
        let tfOnlyMatches = 0;

        // Quick = entregas/evidencias. Match: TF + bodega (exacto/alias). Fallback: TF única en Quick.
        const updatedData = baseData.map(row => {
            const docId = normalizeDocId(row[columnMap.doc!]);
            const whsId = String(row[columnMap.warehouse!] || '').trim().toUpperCase();
            const { row: quickMatch, matchType } = findQuickMatchForAnalyzer(
                quickMap,
                quickByTf,
                docId,
                whsId
            );

            if (quickMatch) {
                matchesCount++;
                if (matchType === 'tf_unica') tfOnlyMatches++;
                else aliasOrExactMatches++;

                const newRow = { ...row };

                const imgVal = QUICK_IMG_COL ? String(quickMatch[QUICK_IMG_COL] || '').trim() : '';
                if (imgVal) {
                    newRow[targetImageCol] = imgVal;
                }
                if (QUICK_DATE_COL && quickMatch[QUICK_DATE_COL] !== undefined && quickMatch[QUICK_DATE_COL] !== '') {
                    newRow[fechaFinCol] = quickMatch[QUICK_DATE_COL];
                }
                newRow[estadoPlatCol] = 'ENTREGADO';
                // Limpiar marca de ruta si venía de un cruce anterior
                if (columnMap.hoyRuta) newRow[columnMap.hoyRuta] = '';
                newRow['hoyRuta'] = '';
                entregadoCount++;
                return newRow;
            }
            return row;
        });

        setColumnMap(prev => ({
            ...prev,
            fechaFinalizado: prev.fechaFinalizado || fechaFinCol,
            image: prev.image || targetImageCol,
            estadoPlataforma: prev.estadoPlataforma || estadoPlatCol,
        }));

        setBaseData(updatedData);
        setInfoMessage(
            `Cruce Quick (${quickSheetName}): ${matchesCount} match(es) → ENTREGADO (${entregadoCount}). ` +
            `TF+bodega/alias: ${aliasOrExactMatches}; TF única: ${tfOnlyMatches}. ` +
            `Hoy calendario: ${todayKey}. En ruta hoy y en bodega salen del aplicativo.`
        );
        void publishPlatformStatusesIfComplete(updatedData, {
            ...columnMap,
            fechaFinalizado: columnMap.fechaFinalizado || fechaFinCol,
            image: columnMap.image || targetImageCol,
            estadoPlataforma: columnMap.estadoPlataforma || estadoPlatCol,
        });

      } catch (err: any) {
        console.error(err);
        setError(`Error al procesar el archivo: ${err.message || 'Error desconocido'}`);
      } finally {
        setIsLoading(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };


  const applyUnresolvedPlatformStatus = Boolean(appStatusAt);

  const analyzedData = React.useMemo(
    () => overlayAppPods(baseData, columnMap, appPodIndex),
    [baseData, columnMap, appPodIndex]
  );

  const snapshotInputRef = React.useRef({ analyzedData, columnMap, routeData, applyUnresolvedPlatformStatus, receivedInWarehouseKeys, collectedOnRouteKeys, novedadKeys, mainFileName });
  snapshotInputRef.current = { analyzedData, columnMap, routeData, applyUnresolvedPlatformStatus, receivedInWarehouseKeys, collectedOnRouteKeys, novedadKeys, mainFileName };

  const saveAnalyzerSnapshot = React.useCallback(
    async (keys?: SnapshotAppKeys) => {
      const s = snapshotInputRef.current;
      if (!s.analyzedData.length || !s.columnMap.warehouse) {
        toast({ title: 'Sin reporte', description: 'Cargue primero la base TF en el analizador.', variant: 'destructive' });
        return;
      }
      setIsSavingSnapshot(true);
      try {
        const storesRes = await getDeliveryStores();
        await new Promise((r) => setTimeout(r, 0));
        const docs = buildAnalyzerSnapshotDocs({
          baseData: s.analyzedData,
          columnMap: s.columnMap,
          routeStatusMap: keys?.routes ?? s.routeData,
          applyUnresolvedPlatformStatus: keys ? true : s.applyUnresolvedPlatformStatus,
          receivedInWarehouseKeys: keys?.received ?? s.receivedInWarehouseKeys,
          collectedOnRouteKeys: keys?.collected ?? s.collectedOnRouteKeys,
          novedadKeys: keys?.novedad ?? s.novedadKeys,
          stores: storesRes.data || [],
          meta: {
            at: new Date().toISOString(),
            byName: userName || user?.email || '',
            fileName: s.mainFileName || '',
          },
        });
        let chunk: AnalyzerSnapshotDocWrite[] = [];
        let size = 0;
        const flush = async () => {
          if (!chunk.length) return;
          const res = await saveAnalyzerSnapshotDocs(chunk);
          if (res.error) throw new Error(res.error);
          chunk = [];
          size = 0;
        };
        for (const d of docs) {
          const len = String(d.data.chunk ?? '').length + 500;
          if (chunk.length && size + len > 2_000_000) await flush();
          chunk.push(d);
          size += len;
        }
        await flush();
        toast({
          title: 'Foto del reporte guardada',
          description: `Office y tiendas la ven en Consulta Estado TF → Último reporte bodega (${docs.length} docs).`,
        });
      } catch (err: any) {
        console.error(err);
        toast({ title: 'No se guardó la foto del reporte', description: err?.message || 'Error al guardar.', variant: 'destructive' });
      } finally {
        setIsSavingSnapshot(false);
      }
    },
    [userName, user?.email]
  );
  saveSnapshotRef.current = saveAnalyzerSnapshot;

  const { kpiData, analysisData, dailyChartData, slaAnalysisData, pendingDocsAnalysisData, generalReport, deliveredDocsReport, brandReport, brandSummaryByWarehouse, deliveredDocsByWarehouse, pendingRows } = useReportData(
    analyzedData,
    columnMap,
    selectedWarehouse,
    startDate,
    endDate,
    deferredDocumentNumberFilter,
    routeData,
    applyUnresolvedPlatformStatus,
    receivedInWarehouseKeys,
    collectedOnRouteKeys,
    novedadKeys
  );

  const handleGenerateSpecialPdf = React.useCallback(() => {
    const { 
        fecha: FECHA_COL, 
        warehouse: WAREHOUSE_COL,
        warehouseOut: WAREHOUSE_OUT_COL,
        doc: DOC_COL,
        marca: MARCA_COL,
        qty: QTY_COL,
        grupo: GRUPO_COL
    } = columnMap;

    if (!WAREHOUSE_OUT_COL) { 
        alert("La columna 'Bod. salida' es necesaria para generar este PDF y no se encontró en el archivo.");
        return;
    }
    
    if (routeData.size === 0) {
        alert("No hay TF en relaciones de ruta abiertas (use Refrescar estados en el Paso 2).");
        return;
    }

    const filteredForPdf = pendingRows.filter(row => {
        const key = buildTfWarehouseKey(row[DOC_COL!], row[WAREHOUSE_COL!]);
        return (key ? getRouteMatchStatus(routeData, key) : undefined) === 'EN RUTA HOY';
    });

    if (filteredForPdf.length === 0) {
        alert("No se encontraron documentos pendientes en relaciones de ruta abiertas.");
        return;
    }

    const exportData = filteredForPdf.map(row => ({
        'FECHA': formatDate(normalizeDate(row[FECHA_COL!])),
        'BOD. SALIDA': String(row[WAREHOUSE_OUT_COL]),
        'BOD. ENTRADA': String(row[WAREHOUSE_COL!]),
        'NRO DOCUMENTO.2': DOC_COL ? String(row[DOC_COL]) : 'N/A',
        'MARCA': MARCA_COL ? String(row[MARCA_COL]) : 'N/A',
        'GRUPO': GRUPO_COL ? String(row[GRUPO_COL]) : 'N/A',
        'CANTIDAD': Number(row[QTY_COL!])
    }));
    
    generatePendingSummaryPdf(exportData);
    }, [pendingRows, columnMap, routeData]);

  const hasData = baseData.length > 0;
  
  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
                <div className="p-3 bg-blue-50 rounded-lg">
                    <Database className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                    <h3 className="font-semibold text-slate-900">Origen de Datos: transfers_analysis (snapshot Excel)</h3>
                    <p className="text-sm text-slate-500">
                      DB: {dataCount.toLocaleString()} · En pantalla: {filteredCount.toLocaleString()}.
                      Si faltan TFs (ej. 631254), re-suba el Excel en Transferencias y luego Actualizar Datos.
                    </p>
                </div>
            </div>
            
            <div className="flex gap-2">
                <Button 
                    onClick={fetchTransfersFromDB} 
                    disabled={isLoading}
                    variant="outline"
                    className="flex items-center gap-2"
                >
                    <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                    Actualizar Datos
                </Button>
                
                <Button 
                    onClick={handleSyncToDB} 
                    disabled={isSyncing || baseData.length === 0}
                    className="flex items-center gap-2 bg-green-600 hover:bg-green-700"
                >
                    <CloudUpload className={`w-4 h-4 ${isSyncing ? 'animate-pulse' : ''}`} />
                    {isSyncing ? 'Sincronizando...' : 'Sincronizar a DB'}
                </Button>
                
                <FileUpload 
                  onFileProcess={handleMainFileProcess} 
                  isLoading={isLoading}
                  fileName={mainFileName === "Base de Datos (Firestore)" ? null : mainFileName}
                  mainText="Cargar Excel Manual (Opcional)"
                  subText="Backup"
                  loadedSubText="Archivo de backup cargado."
                />
            </div>
        </div>
      </div>

      {isLoading && <Loader />}
      {error && <div className="mt-4 text-center text-red-600 bg-red-100 p-3 rounded-md">{error}</div>}
      {infoMessage && <div className="mt-4 text-center text-blue-600 bg-blue-100 p-3 rounded-md">{infoMessage}</div>}
      
      {hasData && (
          <section className="bg-white rounded-lg shadow-lg p-6">
              <h3 className="font-semibold text-lg text-gray-700 mb-2">Validación de Columnas y Mapeo</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm border-collapse border border-slate-300">
                    <thead className="bg-slate-50">
                        <tr>
                            <th className="border border-slate-300 p-2 text-left font-semibold text-gray-600">Campo de Análisis</th>
                            <th className="border border-slate-300 p-2 text-left font-semibold text-gray-600">Origen Encontrado</th>
                        </tr>
                    </thead>
                    <tbody>
                        {debugMapping.map(({ expected, found }) => (
                            <tr key={expected}>
                                <td className="border border-slate-300 p-2">{expected}</td>
                                <td className={`border border-slate-300 p-2 font-mono ${found.includes('No encontrado') ? 'text-red-600' : 'text-green-700'}`}>{found}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
              </div>
          </section>
      )}
      
      {hasData && (
        <>
          <section className="bg-white rounded-lg shadow-lg p-6 border-l-4 border-emerald-500">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3 border-b pb-3">
              <h2 className="text-2xl font-bold text-gray-800">Paso 2: Estados del aplicativo (automático)</h2>
              <Button type="button" variant="outline" size="sm" onClick={() => void loadAppStatuses(true).catch((e) => setError(e.message))} disabled={isAppStatusLoading}>
                <RefreshCw className={`w-4 h-4 mr-2 ${isAppStatusLoading ? 'animate-spin' : ''}`} />
                Refrescar estados
              </Button>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Ya no se suben Excel de rutas ni de empaque. <b>EN RUTA HOY</b> = TF en una relación de ruta abierta (Asignar a ruta / cargue),
              hasta que se cierre. <b>EN BODEGA</b> = status <b>Recibido en Bodega</b> en Transferencias.
              <b> NOVEDAD DE ENTREGA</b> y <b>RECOLECTADO EN RUTA</b> también salen de Transferencias. Lo demás → <b>VALIDAR CON AMBAS TIENDAS</b>.
            </p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-sm">
              <div className="rounded-md border bg-blue-50 border-blue-200 px-3 py-2">EN RUTA HOY: <b>{new Set(Array.from(routeData.keys()).map((k) => k.split('|')[0])).size}</b> TF</div>
              <div className="rounded-md border bg-amber-50 border-amber-200 px-3 py-2">EN BODEGA: <b>{receivedInWarehouseKeys.length}</b> TF</div>
              <div className="rounded-md border bg-violet-50 border-violet-200 px-3 py-2">RECOLECTADO EN RUTA: <b>{collectedOnRouteKeys.length}</b> TF</div>
              <div className="rounded-md border bg-red-50 border-red-200 px-3 py-2">NOVEDAD DE ENTREGA: <b>{novedadKeys.length}</b> TF</div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {appStatusAt ? `Leídos a las ${appStatusAt.toLocaleTimeString('es-CO')}. Al publicar se vuelven a leer.` : 'Aún no se han leído (use Actualizar Datos o Refrescar estados).'}
            </p>
          </section>

          <section className="bg-white rounded-lg shadow-lg p-6 border-l-4 border-blue-500">
            <h2 className="text-2xl font-bold text-gray-800 mb-4 border-b pb-3">Paso 3 (opcional): Archivo Quick - Plataforma (Entregados)</h2>
            <p className="text-sm text-gray-600 mb-4">
                Para entregas que aún no pasan por la app del conductor. Cruce por <b>NUMERO TF</b> + <b>BOD DESTINO</b> → <b>ENTREGADO</b>
                (acepta alias de bodega, ej. <b>40201</b> ↔ <b>B2</b> / <b>BR 402</b>).
                Si una TF aparece una sola vez en Quick, también cruza solo por TF. Al cargarlo se publica automáticamente.
            </p>
            <FileUpload
              onFileProcess={handlePlatformFileProcess}
              isLoading={isLoading}
              fileName={platformFileName}
              mainText="Subir Archivo Quick (Estado/Evidencias)"
              subText="Cruce por NUMERO TF y BOD DESTINO"
              loadedSubText="Archivo Quick cruzado exitosamente."
            />
          </section>

          <section className="bg-white rounded-lg shadow-lg p-6 border-l-4 border-indigo-600">
            <h2 className="text-xl font-bold text-gray-800 mb-2">Publicar estados para tiendas</h2>
            <p className="text-sm text-gray-600 mb-4">
              Guarda en Firestore (<code>tf_platform_status</code>) el estado de cada TF con la base TF + estados del aplicativo
              (+ Quick si se subió) y guarda la foto del reporte. Luego tiendas y office consultan en Consulta Estado TF.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4 text-sm">
              <div className={`rounded-md border px-3 py-2 ${hasData ? 'bg-green-50 border-green-300 text-green-800' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                1. Base TF: {hasData ? 'Listo' : 'Pendiente (Actualizar Datos)'}
              </div>
              <div className={`rounded-md border px-3 py-2 ${appStatusAt ? 'bg-green-50 border-green-300 text-green-800' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                2. Estados del aplicativo: {appStatusAt ? 'Listo' : 'Se leen al publicar'}
              </div>
              <div className={`rounded-md border px-3 py-2 ${platformFileName ? 'bg-green-50 border-green-300 text-green-800' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                3. Quick (opcional): {platformFileName ? 'Cargado' : 'No cargado'}
              </div>
            </div>
            <Button
              type="button"
              onClick={() => void publishPlatformStatusesIfComplete(baseData, columnMap)}
              disabled={isPublishingPlatform || baseData.length === 0}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              <Store className={`w-4 h-4 mr-2 ${isPublishingPlatform ? 'animate-pulse' : ''}`} />
              {isPublishingPlatform ? 'Publicando estados…' : 'Publicar estados para tiendas'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void saveAnalyzerSnapshot()}
              disabled={isSavingSnapshot || baseData.length === 0}
              className="ml-2"
              title="Guarda lo que está en pantalla para que office y tiendas lo vean en Consulta Estado TF"
            >
              <CloudUpload className={`w-4 h-4 mr-2 ${isSavingSnapshot ? 'animate-pulse' : ''}`} />
              {isSavingSnapshot ? 'Guardando foto…' : 'Guardar foto del reporte'}
            </Button>
          </section>
          
          <FilterPanel
            availableWarehouses={availableWarehouses}
            filters={{
              warehouse: selectedWarehouse,
              startDate: startDate,
              endDate: endDate,
              documentNumber: documentNumberFilter
            }}
            onWarehouseChange={setSelectedWarehouse}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
            onDocumentNumberChange={setDocumentNumberFilter}
            onClearFilters={handleClearFilters}
          />
          
          <section>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6">
                  <KPI title="Cantidad Documentos" value={kpiData.totalDocs} icon={<FileIcon/>} />
                  <KPI title="Entregados" value={kpiData.deliveredCount} icon={<CheckCircleIcon className="text-blue-600"/>} />
                  <KPI title="Por Entregar" value={kpiData.pendingCount} icon={<TruckIcon/>} />
                  <KPI title="Cant. Productos Entregados" value={kpiData.deliveredQty} icon={<PackageIcon/>} />
                  <KPI title="Cant. Pendientes de Recibir" value={kpiData.pendingQty} icon={<ChartIcon/>} />
                  <KPI title="Cumplimiento (Entregados/Total)" value={kpiData.compliancePercentage} icon={<CheckCircleIcon/>} />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Todo se unifica por <b>documento</b> (bodega + NRO TF). La cantidad de productos suma las líneas de marca/grupo de cada TF.
              </p>
          </section>

          {deliveredDocsReport.data.length > 0 && (
            <ReportTable
                title="Reporte de Documentos Entregados"
                data={deliveredDocsReport.data}
                headers={deliveredDocsReport.headers}
                exportData={deliveredDocsReport.exportData}
                icon={<CheckCircleIcon className="h-6 w-6 text-green-600 mr-3"/>}
            />
          )}

          {brandReport.data.length > 0 && (
              <ReportTable
                  title="Reporte General por Marca"
                  data={brandReport.data}
                  headers={brandReport.headers}
                  exportData={brandReport.exportData}
                  icon={<PackageIcon className="h-6 w-6 text-green-600 mr-3"/>}
              />
          )}

          <ReportTable
              title="Reporte General de Datos"
              data={generalReport.data}
              headers={generalReport.headers}
              exportData={generalReport.exportData}
              summaryText="1 fila = 1 documento (TF+bodega); cantidad = suma de líneas"
              icon={<TableIcon className="h-6 w-6 text-green-600 mr-3"/>}
          />

          <SlaAnalysisTable data={slaAnalysisData} />

          <PendingDocsAnalysisTable 
            reportData={{ kpiData, analysisData, dailyChartData, slaAnalysisData, pendingDocsAnalysisData, generalReport, deliveredDocsReport, brandReport, brandSummaryByWarehouse, deliveredDocsByWarehouse, pendingRows }} 
            onGenerateSpecialPdf={handleGenerateSpecialPdf}
            hasPendingRows={pendingRows.length > 0}
          />

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
              <AnalysisDashboard data={analysisData} />
              <DailyIndicatorChart data={dailyChartData} />
          </div>
        </>
      )}
    </div>
  );
};


// --- MODULE 2: Descansos Report ---
const DescansosReport: React.FC = () => {
    const [fileName, setFileName] = React.useState<string | null>(null);
    const [isLoading, setIsLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [reportData, setReportData] = React.useState<BreaksReportData | null>(null);
    
    const COLS_TO_KEEP = {
        employeeName: ['Empleado', 'EMPLEADO'],
        mealType: ['Tipo Comida', 'TIPO COMIDA'],
        startTime: ['Hora de inicio', 'HORA DE INICIO'],
        endTime: ['Hora de finalización', 'HORA DE FINALIZACION', 'Hora de finalizacion'],
        evento: ['Evento', 'EVENTO'],
    };

    const handleFileProcess = (file: File) => {
        setIsLoading(true);
        setError(null);
        setReportData(null);
        setFileName(file.name);

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target!.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array', cellDates: true, codepage: 65001 });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const jsonData: ExcelDataRow[] = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

                if (jsonData.length === 0) {
                    throw new Error("El archivo de Excel está vacío o no tiene datos.");
                }

                const fileHeaders = Object.keys(jsonData[0] || {});
                
                const colMap = {
                    employeeName: findHeader(fileHeaders, COLS_TO_KEEP.employeeName),
                    mealType: findHeader(fileHeaders, COLS_TO_KEEP.mealType),
                    startTime: findHeader(fileHeaders, COLS_TO_KEEP.startTime),
                    endTime: findHeader(fileHeaders, COLS_TO_KEEP.endTime),
                    evento: findHeader(fileHeaders, COLS_TO_KEEP.evento),
                };
                
                const missingCols = Object.entries(colMap)
                    .filter(([, value]) => !value)
                    .map(([key]) => `'${COLS_TO_KEEP[key as keyof typeof COLS_TO_KEEP][0]}'`);

                if (missingCols.length > 0) {
                    throw new Error(`El archivo no contiene las columnas requeridas: ${missingCols.join(', ')}.`);
                }
                
                const parseTime = (timeValue: any): Date | null => {
                    if (timeValue instanceof Date && !isNaN(timeValue.getTime())) {
                        return timeValue;
                    }
                    if (typeof timeValue === 'number' && timeValue > 0) {
                        const excelEpochDiff = 25569;
                        const msPerDay = 86400000;
                        const timestamp = (timeValue - excelEpochDiff) * msPerDay;
                        const jsDate = new Date(timestamp);
                        const timezoneOffsetInMs = jsDate.getTimezoneOffset() * 60 * 1000;
                        return new Date(jsDate.getTime() + timezoneOffsetInMs);
                    }
                    return null;
                };

                // --- NEW LOGIC: Pairing Entrada/Salida events ---
                const eventPairs = new Map<string, { entrada?: Date, salida?: Date }>();

                jsonData.forEach(row => {
                    const employee = String(row[colMap.employeeName!] || 'Desconocido').trim();
                    const meal = String(row[colMap.mealType!] || 'Desconocido').toLowerCase().trim();
                    const eventType = String(row[colMap.evento!] || '').toLowerCase().trim();

                    if (!employee || !meal || !eventType) return;

                    let eventTime: Date | null = null;
                    let dateForRecord: Date | null = null;

                    if (eventType === 'entrada') {
                        eventTime = parseTime(row[colMap.startTime!]);
                        dateForRecord = eventTime;
                    } else if (eventType === 'salida') {
                        eventTime = parseTime(row[colMap.endTime!]);
                        dateForRecord = eventTime;
                    }
                    
                    if (!eventTime || !dateForRecord) return;

                    const dateStr = formatDate(dateForRecord);
                    const key = `${employee}|${dateStr}|${meal}`;

                    if (!eventPairs.has(key)) {
                        eventPairs.set(key, {});
                    }
                    const pair = eventPairs.get(key)!;

                    if (eventType === 'entrada') {
                        if (!pair.entrada || eventTime < pair.entrada) {
                            pair.entrada = eventTime;
                        }
                    } else if (eventType === 'salida') {
                        if (!pair.salida || eventTime > pair.salida) {
                            pair.salida = eventTime;
                        }
                    }
                });
                
                const allBreaks: (ProcessedBreak & { employeeName: string; date: string })[] = [];
                eventPairs.forEach((pair, key) => {
                    const [employeeName, date, mealType] = key.split('|');
                    
                    const startTime = pair.entrada;
                    const endTime = pair.salida;
                    
                    const isPartial = !startTime || !endTime;
                    const isLogicalError = startTime && endTime && endTime.getTime() < startTime.getTime();
                    const duration = (isPartial || isLogicalError) ? 0 : Math.round((endTime!.getTime() - startTime!.getTime()) / (1000 * 60));

                    allBreaks.push({
                        employeeName,
                        date,
                        mealType,
                        duration,
                        startTime: startTime || new Date(0),
                        endTime: endTime || new Date(0),
                        isPartial: isPartial || !!isLogicalError,
                    });
                });

                // --- 2. Group breaks by employee and then by date ---
                const breaksByEmployeeByDate: Map<string, Map<string, ProcessedBreak[]>> = new Map();
                allBreaks.forEach(breakItem => {
                    const { employeeName, date } = breakItem;
                    if (!breaksByEmployeeByDate.has(employeeName)) {
                        breaksByEmployeeByDate.set(employeeName, new Map());
                    }
                    const employeeMap = breaksByEmployeeByDate.get(employeeName)!;
                    if (!employeeMap.has(date)) {
                        employeeMap.set(date, []);
                    }
                    employeeMap.get(date)!.push(breakItem);
                });

                // --- 3. Process each employee's day ---
                const allEmployeeDailyAnalyses: (EmployeeDailyAnalysis & { date: string })[] = [];
                const MEAL_TYPES = ['desayuno', 'almuerzo', 'refrigerio'];

                breaksByEmployeeByDate.forEach((recordsByDate, employeeName) => {
                    recordsByDate.forEach((completedBreaks, date) => {
                        const partialMarkingsCount = completedBreaks.filter(b => b.isPartial).length;
                        const totalMinutes = completedBreaks.reduce((sum, b) => sum + b.duration, 0);

                        const completedMealTypes = new Set(completedBreaks.map(b => b.mealType));
                        const missedBreaks = MEAL_TYPES.filter(m => !completedMealTypes.has(m));

                        const isCompliant = missedBreaks.length === 0 && partialMarkingsCount === 0 && totalMinutes <= 60;

                        allEmployeeDailyAnalyses.push({
                            employeeName,
                            date,
                            totalMinutes,
                            completedBreaks,
                            missedBreaks,
                            partialMarkingsCount,
                            exceededTotalTime: totalMinutes > 60,
                            isCompliant,
                        });
                    });
                });

                // --- 4. Aggregate daily analyses ---
                const dailyAnalysesMap = new Map<string, DailyAnalysis>();
                allEmployeeDailyAnalyses.forEach(analysis => {
                    if (!dailyAnalysesMap.has(analysis.date)) {
                        dailyAnalysesMap.set(analysis.date, { date: analysis.date, employeesAnalysis: [], stats: { totalEmployees: 0, employeesExceedingTime: 0, employeesWithMissedBreaks: 0, employeesWithPartialRegs: 0 } });
                    }
                    const day = dailyAnalysesMap.get(analysis.date)!;
                    day.employeesAnalysis.push(analysis);
                });

                dailyAnalysesMap.forEach(day => {
                    day.stats.totalEmployees = day.employeesAnalysis.length;
                    day.stats.employeesExceedingTime = day.employeesAnalysis.filter(e => e.exceededTotalTime).length;
                    day.stats.employeesWithMissedBreaks = day.employeesAnalysis.filter(e => e.missedBreaks.length > 0).length;
                    day.stats.employeesWithPartialRegs = day.employeesAnalysis.filter(e => e.partialMarkingsCount > 0).length;
                });
                
                const dailyAnalyses = Array.from(dailyAnalysesMap.values()).sort((a,b) => (parseDateString(b.date)?.getTime() ?? 0) - (parseDateString(a.date)?.getTime() ?? 0));

                // --- 5. Calculate KPIs, Trends, and Performances ---
                const totalEmployeeDays = allEmployeeDailyAnalyses.length;
                const compliantDays = allEmployeeDailyAnalyses.filter(a => a.isCompliant).length;
                const exceededDays = allEmployeeDailyAnalyses.filter(a => a.exceededTotalTime).length;
                const partialDays = allEmployeeDailyAnalyses.filter(a => a.partialMarkingsCount > 0).length;
                const totalBreakTime = allEmployeeDailyAnalyses.reduce((sum, a) => sum + a.totalMinutes, 0);
                const totalEmployeesWithBreaks = new Set(allEmployeeDailyAnalyses.map(a => a.employeeName)).size;

                const kpis = {
                    complianceRate: totalEmployeeDays > 0 ? (compliantDays / totalEmployeeDays) * 100 : 0,
                    exceededRate: totalEmployeeDays > 0 ? (exceededDays / totalEmployeeDays) * 100 : 0,
                    avgBreakTime: totalEmployeeDays > 0 ? totalBreakTime / totalEmployeeDays : 0,
                    totalEmployeesWithBreaks,
                    partialMarkingRate: totalEmployeeDays > 0 ? (partialDays / totalEmployeeDays) * 100 : 0,
                };
                
                const employeePerformances = Array.from(new Set(allBreaks.map(b => b.employeeName))).map(name => {
                    const employeeDays = allEmployeeDailyAnalyses.filter(a => a.employeeName === name);
                    const totalDays = employeeDays.length;
                    if (totalDays === 0) {
                      return {
                        employeeName: name,
                        avgTime: 0,
                        totalExceededDays: 0,
                        totalPartialDays: 0,
                        totalMissedDays: 0,
                        complianceRate: 0,
                      };
                    }
                    const totalExceeded = employeeDays.filter(d => d.exceededTotalTime).length;
                    const totalPartial = employeeDays.filter(d => d.partialMarkingsCount > 0).length;
                    const totalMissed = employeeDays.filter(d => d.missedBreaks.length > 0).length;
                    const avgTime = employeeDays.reduce((sum, d) => sum + d.totalMinutes, 0) / totalDays;

                    return {
                        employeeName: name,
                        avgTime: avgTime || 0,
                        totalExceededDays: totalExceeded,
                        totalPartialDays: totalPartial,
                        totalMissedDays: totalMissed,
                        complianceRate: (employeeDays.filter(d => d.isCompliant).length / totalDays) * 100,
                    };
                }).sort((a, b) => b.complianceRate - a.complianceRate);

                // --- 6. Calculate Weekly Trends ---
                const weeklyTrendsMap = new Map<string, EmployeeDailyAnalysis[]>();
                allEmployeeDailyAnalyses.forEach(analysis => {
                    const date = parseDateString(analysis.date);
                    if (!date) return;

                    const weekStartDate = getWeekStartDate(date);
                    const weekKey = weekStartDate.toISOString().split('T')[0]; // YYYY-MM-DD

                    if (!weeklyTrendsMap.has(weekKey)) {
                        weeklyTrendsMap.set(weekKey, []);
                    }
                    weeklyTrendsMap.get(weekKey)!.push(analysis);
                });

                const weeklyTrends: WeeklyTrend[] = Array.from(weeklyTrendsMap.entries())
                    .map(([weekKey, analyses]) => {
                        const totalEmployeeDays = analyses.length;
                        if (totalEmployeeDays === 0) return null;

                        const compliantDays = analyses.filter(a => a.isCompliant).length;
                        const exceededDays = analyses.filter(a => a.exceededTotalTime).length;
                        const totalBreakTime = analyses.reduce((sum, a) => sum + a.totalMinutes, 0);

                        const weekStartDateObj = parseDateString(weekKey);

                        return {
                            week: weekStartDateObj ? `Semana del ${formatDate(weekStartDateObj)}` : weekKey,
                            avgBreakTime: totalBreakTime / totalEmployeeDays,
                            complianceRate: (compliantDays / totalEmployeeDays) * 100,
                            exceededRate: (exceededDays / totalEmployeeDays) * 100,
                        };
                    })
                    .filter((trend): trend is WeeklyTrend => trend !== null)
                    .sort((a, b) => {
                        const dateA = parseDateString(a.week.replace("Semana del ", ""));
                        const dateB = parseDateString(b.week.replace("Semana del ", ""));
                        return (dateA?.getTime() || 0) - (dateB?.getTime() || 0);
                    });

                setReportData({ kpis, weeklyTrends, employeePerformances, dailyAnalyses });

            } catch (err: any) {
                setError(err.message || 'Ocurrió un error desconocido al procesar el archivo.');
                setReportData(null);
            } finally {
                setIsLoading(false);
            }
        };
        reader.readAsArrayBuffer(file);
    };

    return (
        <div className="space-y-8">
            <section className="bg-white rounded-lg shadow-lg p-6">
                <h2 className="text-2xl font-bold text-gray-800 mb-4 border-b pb-3">Cargar Reporte de Descansos</h2>
                <FileUpload
                    onFileProcess={handleFileProcess}
                    isLoading={isLoading}
                    fileName={fileName}
                    mainText="Arrastra o selecciona el archivo de descansos"
                    subText="Solo archivos .xlsx o .xls"
                    loadedSubText="Archivo cargado. Para analizar uno nuevo, selecciona otro."
                />
                {isLoading && <Loader />}
                {error && <div className="mt-4 text-center text-red-600 bg-red-100 p-3 rounded-md">{error}</div>}
            </section>
            
            {reportData && (
                <BreakdownDashboard data={reportData} />
            )}
        </div>
    );
}


interface LogisticsPlatformProps {
    onReturn: () => void;
}

// --- Main App Component ---
const LogisticsPlatform: React.FC<LogisticsPlatformProps> = ({ onReturn }) => {
    const [activeView, setActiveView] = React.useState<'bodega' | 'descansos' | 'rutas' | 'procesos' | 'novedades'>('bodega');

    return (
        <div className="min-h-screen bg-slate-100">
            <Header activeView={activeView} setActiveView={setActiveView} onReturn={onReturn} />
            <main className="container mx-auto p-4 sm:p-6 lg:p-8">
                {activeView === 'bodega' && <WarehouseAnalyzer />}
                {activeView === 'procesos' && <WarehouseProcessesModule />}
                {activeView === 'descansos' && <DescansosReport />}
                {activeView === 'rutas' && <RutasModule />}
                {activeView === 'novedades' && <NovedadesModule />}
            </main>
        </div>
    );
};

export default LogisticsPlatform;

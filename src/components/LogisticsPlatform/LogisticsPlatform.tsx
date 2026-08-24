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
import { findHeader, normalizeDate, formatDate, parseDateString, generatePendingSummaryPdf, getWeekStartDate, getCalendarDateKey, getTodayCalendarKey, normalizeDocId, buildTfWarehouseKey } from './utils/helpers';
import type { ExcelDataRow, BreaksReportData, ProcessedBreak, EmployeeDailyAnalysis, DailyAnalysis, WeeklyTrend, EmployeePerformance } from './types';
import type { TransferEntry } from '@/types';
import { loadAnalysisRecords, syncAnalysisRecords, persistTfPlatformStatuses } from '@/app/actions';
import { buildTfPlatformStatusRecords } from '@/lib/tfPlatformStatus';
import { FileIcon, PackageIcon, TruckIcon, ChartIcon, CheckCircleIcon, TableIcon, UserCheckIcon, PdfFileIcon } from './components/icons';
import { Button } from '@/components/ui/button';
import { RefreshCw, Database, CloudUpload, Store } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth-context';
import * as XLSX from 'xlsx';


// --- MODULE 1: Warehouse Analyzer ---
const WarehouseAnalyzer: React.FC = () => {
  // --- CORE STATES ---
  const [baseData, setBaseData] = React.useState<ExcelDataRow[]>([]);
  const [columnMap, setColumnMap] = React.useState<{ [key: string]: string | undefined }>({});
  const [rawHeaders, setRawHeaders] = React.useState<string[]>([]);
  const [debugMapping, setDebugMapping] = React.useState<{ expected: string; found: string }[]>([]);
  const [availableWarehouses, setAvailableWarehouses] = React.useState<string[]>([]);
  const [mainFileName, setMainFileName] = React.useState<string | null>(null);

  // --- ROUTE FILE STATES ---
  const [routeData, setRouteData] = React.useState<Map<string, string>>(new Map());
  const [routeFileName, setRouteFileName] = React.useState<string | null>(null);
  const [isRouteLoading, setIsRouteLoading] = React.useState(false);
  const [routeError, setRouteError] = React.useState<string | null>(null);
  const [routeDebugMapping, setRouteDebugMapping] = React.useState<{ expected: string; found: string; isFallback: boolean }[]>([]);
  const [rawRouteHeaders, setRawRouteHeaders] = React.useState<string[]>([]);

  // --- UI CONTROL STATES ---
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [infoMessage, setInfoMessage] = React.useState<string | null>(null);
  
  // --- FILTER STATES ---
  const [selectedWarehouse, setSelectedWarehouse] = React.useState<string>('all');
  const [startDate, setStartDate] = React.useState<string>('');
  const [endDate, setEndDate] = React.useState<string>('');
  const [documentNumberFilter, setDocumentNumberFilter] = React.useState('');
  const [dataCount, setDataCount] = React.useState(0);
  const [isSyncing, setIsSyncing] = React.useState(false);
  const [platformFileName, setPlatformFileName] = React.useState<string | null>(null);
  const [warehousePackFileName, setWarehousePackFileName] = React.useState<string | null>(null);
  const [isWarehousePackLoading, setIsWarehousePackLoading] = React.useState(false);
  const [isPublishingPlatform, setIsPublishingPlatform] = React.useState(false);
  const { user, userName } = useAuth();

  const publishPlatformStatusesIfComplete = React.useCallback(
    async (
      data: ExcelDataRow[],
      map: { [key: string]: string | undefined },
      routes: Map<string, string>,
      flags: { hasMain: boolean; hasRoutes: boolean; hasQuick: boolean; hasPack: boolean },
      options?: { silentIfIncomplete?: boolean }
    ) => {
      const missing: string[] = [];
      if (!flags.hasMain) missing.push('Paso 1 (base TF)');
      if (!flags.hasRoutes) missing.push('Paso 2 (rutas)');
      if (!flags.hasQuick) missing.push('Paso 3 (Quick)');
      if (!flags.hasPack) missing.push('Paso 4 (empaque)');

      if (missing.length) {
        if (!options?.silentIfIncomplete) {
          toast({
            title: 'Faltan pasos para publicar',
            description: `Complete: ${missing.join(', ')}.`,
            variant: 'destructive',
          });
        }
        return;
      }
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
        const records = buildTfPlatformStatusRecords(
          data,
          {
            doc: map.doc,
            warehouse: map.warehouse,
            qty: map.qty,
            fecha: map.fecha,
            marca: map.marca,
            grupo: map.grupo,
            estadoPlataforma: map.estadoPlataforma || 'estadoPlataforma',
            hoyRuta: map.hoyRuta || 'hoyRuta',
            fechaFinalizado: map.fechaFinalizado || 'fechaFinalizado',
            image: map.image || 'image',
          },
          routes,
          userName || user?.email || undefined
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

        toast({
          title: 'Estados publicados para tiendas',
          description: `Se publicaron ${result.count} TF (estado plataforma) en Firestore (colección tf_platform_status).`,
        });
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
    [user?.email, userName]
  );

  const stepFlags = {
    hasMain: baseData.length > 0,
    hasRoutes: Boolean(routeFileName) && routeData.size > 0,
    hasQuick: Boolean(platformFileName),
    hasPack: Boolean(warehousePackFileName),
  };
  const allStepsReady =
    stepFlags.hasMain && stepFlags.hasRoutes && stepFlags.hasQuick && stepFlags.hasPack;

  const fetchTransfersFromDB = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
        const result = await loadAnalysisRecords();
        if (result.error) {
            throw new Error(result.error);
        }
        
        if (result.data) {
            // No need to map manually here, processData handles column detection
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
        const result = await syncAnalysisRecords(baseData);
        if (result.success) {
            toast({ title: "Sincronización Exitosa", description: `Se han actualizado ${result.count} registros en la base de datos.` });
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
    const FECHA_COL_NAMES = ['Fecha'];
    const WAREHOUSE_COL_NAMES = ['Bod. entrada', 'Bodega entrada', 'Bodega', 'Destino', 'Centro', 'Almacén', 'Almacen', 'Bodega Destino', 'BOD. DESTINO'];
    const WAREHOUSE_OUT_COL_NAMES = ['Bod. salida', 'Bodega salida', 'BOD SALIDA', 'Bodega Origen', 'BODEGA ORIGEN'];
    const DOC_COL_NAMES = ['Nro documento.2', 'Nro documento.', 'Nro Documento', 'Numero TF', 'numeroTF'];
    const QTY_COL_NAMES = ['CANTIDAD', 'Cantidad'];
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
    const excludedWarehouses = new Set(['BDTRA', 'BDIST', 'TRYNO', 'IMPOR', 'BGDOT', 'NONOS', 'BODFT', 'BREPA', 'SUCIO']);
    const filteredBaseData = dedupedData.filter(row => {
        const warehouseName = String(row[newColumnMap.warehouse!]);
        if (!warehouseName) {
            return false; // Excluir filas sin bodega
        }
        const upperWarehouse = warehouseName.toUpperCase();
        return !upperWarehouse.endsWith('IN') && !excludedWarehouses.has(upperWarehouse);
    });

    setBaseData(filteredBaseData);
    
    // Derivar las bodegas disponibles del conjunto de datos ya filtrado
    const warehouses = [...new Set(filteredBaseData.map(row => String(row[newColumnMap.warehouse!])).filter(Boolean))]
        .sort();
    setAvailableWarehouses(warehouses);

    setError(null);
    if (inconsistenciesFound > 0) {
      setInfoMessage(`${inconsistenciesFound} registro(s) con fechas de finalización inconsistentes fueron corregidos (el estado se marcó como no finalizado).`);
    } else {
      setInfoMessage(null);
    }
    
  }, []);

  const handleMainFileProcess = (file: File) => {
    setIsLoading(true);
    setError(null);
    setInfoMessage(null);
    setBaseData([]);
    setRouteData(new Map());
    setRouteFileName(null);
    setRouteError(null);
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
  
  const handleRouteFileProcess = (file: File) => {
    if (baseData.length === 0) {
      setRouteError('Primero carga el archivo principal de Transferencias para poder cruzar por TF + destino.');
      return;
    }

    setIsRouteLoading(true);
    setRouteError(null);
    setRouteFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData: ExcelDataRow[] = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

        if (jsonData.length === 0) {
          setRouteError("El archivo de rutas está vacío.");
          setIsRouteLoading(false);
          return;
        }
        
        const headers = Object.keys(jsonData[0] || {});
        setRawRouteHeaders(headers);
        
        const TF_HEADER = findHeader(headers, [
          'Número TF', 'Numero TF', 'NUMERO TF', 'TF', 'Nro documento.2', 'NRO DOCUMENTO.2'
        ]);
        const DEST_HEADER = findHeader(headers, [
          'Almacen Destino', 'Almacén Destino', 'BOD DESTINO', 'Bod Destino', 'Bodega Destino',
          'DESTINO', 'Destino', 'Bod. entrada', 'Bodega entrada'
        ]);

        setRouteDebugMapping([
            { expected: 'Número TF / TF (obligatorio)', found: TF_HEADER || 'No encontrado', isFallback: false },
            { expected: 'Almacén / Bodega Destino (obligatorio)', found: DEST_HEADER || 'No encontrado', isFallback: false },
            { expected: 'Cruce', found: 'TF + Destino → EN RUTA HOY', isFallback: false },
        ]);

        if (!TF_HEADER || !DEST_HEADER) {
            setRouteError("El archivo de rutas debe traer columna TF (Número TF) y Almacén/Bodega Destino.");
            setIsRouteLoading(false);
            return;
        }

        const routeStatusMap = new Map<string, string>();
        let rowCount = 0;
        jsonData.forEach(row => {
            const key = buildTfWarehouseKey(row[TF_HEADER], row[DEST_HEADER]);
            if (!key) return;
            // Presencia en el archivo de rutas de hoy = EN RUTA HOY (por TF+destino)
            routeStatusMap.set(key, 'EN RUTA HOY');
            rowCount++;
        });

        if (routeStatusMap.size === 0) {
          setRouteError('No se pudo armar ningún cruce TF+destino. Revisa que ambas columnas tengan datos.');
          setIsRouteLoading(false);
          return;
        }

        setRouteData(routeStatusMap);
        setRouteError(null);
        setInfoMessage(
          `Paso 2 rutas: ${routeStatusMap.size} clave(s) TF+destino (${rowCount} fila(s)). Se marcarán EN RUTA HOY en el reporte.`
        );
        void publishPlatformStatusesIfComplete(baseData, columnMap, routeStatusMap, {
          hasMain: baseData.length > 0,
          hasRoutes: true,
          hasQuick: Boolean(platformFileName),
          hasPack: Boolean(warehousePackFileName),
        }, { silentIfIncomplete: true });
      } catch (err) {
        console.error("Error processing route file:", err);
        setRouteError('Ocurrió un error al procesar el archivo de rutas.');
      } finally {
        setIsRouteLoading(false);
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
        jsonData.forEach(qRow => {
            const qDoc = normalizeDocId(qRow[QUICK_DOC_COL]);
            const qWhs = String(qRow[QUICK_WHS_COL] || '').trim().toUpperCase();
            if (qDoc && qWhs) {
                const key = `${qDoc}-${qWhs}`;
                if (!quickMap.has(key)) {
                    quickMap.set(key, qRow);
                }
            }
        });

        const todayKey = getTodayCalendarKey();
        const fechaFinCol = columnMap.fechaFinalizado || 'fechaFinalizado';
        const estadoPlatCol = columnMap.estadoPlataforma || 'estadoPlataforma';
        const targetImageCol = columnMap.image || 'image';

        let matchesCount = 0;
        let entregadoCount = 0;

        // Quick = entregas/evidencias. Ya no marca EN RUTA HOY (eso es Paso 2).
        const updatedData = baseData.map(row => {
            const docId = normalizeDocId(row[columnMap.doc!]);
            const whsId = String(row[columnMap.warehouse!] || '').trim().toUpperCase();
            const lookupKey = `${docId}-${whsId}`;

            const quickMatch = quickMap.get(lookupKey);

            if (quickMatch) {
                matchesCount++;
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
            `Cruce Quick (${quickSheetName}): ${matchesCount} match(es) → ENTREGADO (${entregadoCount}). Hoy calendario: ${todayKey}. En ruta hoy sale del Paso 2 (TF+destino).`
        );
        const nextMap = {
            ...columnMap,
            fechaFinalizado: columnMap.fechaFinalizado || fechaFinCol,
            image: columnMap.image || targetImageCol,
            estadoPlataforma: columnMap.estadoPlataforma || estadoPlatCol,
        };
        void publishPlatformStatusesIfComplete(updatedData, nextMap, routeData, {
          hasMain: updatedData.length > 0,
          hasRoutes: Boolean(routeFileName) && routeData.size > 0,
          hasQuick: true,
          hasPack: Boolean(warehousePackFileName),
        }, { silentIfIncomplete: true });

      } catch (err: any) {
        console.error(err);
        setError(`Error al procesar el archivo: ${err.message || 'Error desconocido'}`);
      } finally {
        setIsLoading(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleWarehousePackFileProcess = (file: File) => {
    if (baseData.length === 0) {
        setError('Primero debes cargar el archivo principal de Transferencias.');
        return;
    }

    setIsWarehousePackLoading(true);
    setWarehousePackFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = new Uint8Array(e.target!.result as ArrayBuffer);
            const workbook = XLSX.read(data, { type: 'array', cellDates: true, codepage: 65001 });
            const sheetName = workbook.SheetNames[0];
            if (!sheetName) throw new Error('El archivo no tiene hojas.');

            const jsonData: any[] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
            if (jsonData.length === 0) throw new Error('La hoja está vacía.');

            const headers = Object.keys(jsonData[0] || {});
            const TF_COL = findHeader(headers, ['TF', 'Numero TF', 'NUMERO TF', 'NumeroTF', 'Nro documento.2', 'NRO DOCUMENTO.2']);
            if (!TF_COL) {
                throw new Error('No se encontró la columna TF en el archivo de unidades de empaque.');
            }

            const tfInWarehouse = new Set<string>();
            jsonData.forEach((row) => {
                const id = normalizeDocId(row[TF_COL]);
                if (id) tfInWarehouse.add(id);
            });

            const estadoPlatCol = columnMap.estadoPlataforma || 'estadoPlataforma';
            const hoyRutaCol = columnMap.hoyRuta || 'hoyRuta';
            let matched = 0;

            const updatedData = baseData.map((row) => {
                const docId = normalizeDocId(row[columnMap.doc!]);
                if (!docId || !tfInWarehouse.has(docId)) return row;

                const plat = String(row[estadoPlatCol] || row['estadoPlataforma'] || '').toUpperCase();
                const hoy = String(row[hoyRutaCol] || row['hoyRuta'] || '').toUpperCase();
                // No pisar entregado ni en ruta hoy
                if (plat === 'ENTREGADO' || plat === 'FINALIZADO' || plat === 'EN RUTA HOY' || hoy === 'EN RUTA HOY' || hoy === 'TRUE') {
                    return row;
                }

                matched++;
                return {
                    ...row,
                    estadoBodega: 'EN BODEGA',
                    [estadoPlatCol]: plat || 'EN BODEGA',
                };
            });

            setColumnMap((prev) => ({
                ...prev,
                estadoPlataforma: prev.estadoPlataforma || estadoPlatCol,
                hoyRuta: prev.hoyRuta || hoyRutaCol,
            }));
            setBaseData(updatedData);
            setInfoMessage(
                `Cruce empaque (columna ${TF_COL}): ${tfInWarehouse.size} TF en archivo; ${matched} línea(s) marcadas EN BODEGA.`
            );
            const nextMap = {
                ...columnMap,
                estadoPlataforma: columnMap.estadoPlataforma || estadoPlatCol,
                hoyRuta: columnMap.hoyRuta || hoyRutaCol,
            };
            void publishPlatformStatusesIfComplete(updatedData, nextMap, routeData, {
              hasMain: updatedData.length > 0,
              hasRoutes: Boolean(routeFileName) && routeData.size > 0,
              hasQuick: Boolean(platformFileName),
              hasPack: true,
            }, { silentIfIncomplete: false });
        } catch (err: any) {
            console.error(err);
            setError(`Error al procesar empaque: ${err.message || 'Error desconocido'}`);
        } finally {
            setIsWarehousePackLoading(false);
        }
    };
    reader.readAsArrayBuffer(file);
  };

  const applyUnresolvedPlatformStatus = Boolean(platformFileName || warehousePackFileName || routeFileName);

  const { kpiData, analysisData, dailyChartData, slaAnalysisData, pendingDocsAnalysisData, generalReport, deliveredDocsReport, brandReport, brandSummaryByWarehouse, deliveredDocsByWarehouse, pendingRows } = useReportData(
    baseData,
    columnMap,
    selectedWarehouse,
    startDate,
    endDate,
    documentNumberFilter,
    routeData,
    applyUnresolvedPlatformStatus
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
    
    // Ahora es obligatorio cargar el archivo de rutas para este reporte específico.
    if (routeData.size === 0) {
        alert("Para generar este reporte, es necesario cargar el 'Archivo de Rutas' (Paso 2: TF + destino).");
        return;
    }

    const filteredForPdf = pendingRows.filter(row => {
        const key = buildTfWarehouseKey(row[DOC_COL!], row[WAREHOUSE_COL!]);
        const routeStatus = key ? routeData.get(key) : undefined;
        // Con el nuevo Paso 2 (TF+destino) las claves en ruta quedan EN RUTA HOY.
        return routeStatus === 'EN RUTA HOY' || routeStatus === 'ESTA EN BODEGA PPAL' || routeStatus === 'EN CARGUE';
    });

    if (filteredForPdf.length === 0) {
        alert("No se encontraron documentos pendientes que coincidan con TF+destino del archivo de rutas.");
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
                    <h3 className="font-semibold text-slate-900">Origen de Datos: Base de Datos (Transferencias)</h3>
                    <p className="text-sm text-slate-500">Se están analizando {dataCount} registros. Marca y Grupo incluidos.</p>
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
            <h2 className="text-2xl font-bold text-gray-800 mb-4 border-b pb-3">Paso 2: Cargar Archivo de Rutas (En ruta hoy)</h2>
            <p className="text-sm text-gray-600 mb-4">
              Sube un Excel con <b>Número TF</b> y <b>Almacén/Bodega Destino</b>.
              El cruce es <b>TF + destino</b> (la misma TF en otro almacén no se mezcla).
              Las coincidencias quedan en <b>EN RUTA HOY</b> en ESTADO PLATAFORMA.
            </p>
            <FileUpload
              onFileProcess={handleRouteFileProcess}
              isLoading={isRouteLoading}
              fileName={routeFileName}
              mainText="Arrastra o selecciona el archivo de rutas (TF + destino)"
              subText="Columnas requeridas: TF y Almacén/Bodega Destino (.xlsx / .xls)"
              loadedSubText="Archivo de rutas cargado (cruce TF+destino)."
            />
            {isRouteLoading && <Loader />}
            {routeError && <div className="mt-4 text-center text-red-600 bg-red-100 p-3 rounded-md">{routeError}</div>}
            {routeFileName && !routeError && (
              <div className="mt-6">
                <h3 className="font-semibold text-lg text-gray-700 mb-2">Validación de Columnas (Archivo de Rutas)</h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm border-collapse border border-slate-300">
                      <thead className="bg-slate-50">
                          <tr>
                              <th className="border border-slate-300 p-2 text-left font-semibold text-gray-600">Columna de Búsqueda</th>
                              <th className="border border-slate-300 p-2 text-left font-semibold text-gray-600">Columna Encontrada</th>
                          </tr>
                      </thead>
                      <tbody>
                          {routeDebugMapping.map(({ expected, found }) => (
                              <tr key={expected}>
                                  <td className="border border-slate-300 p-2">{expected}</td>
                                  <td className={`border border-slate-300 p-2 font-mono ${found.includes('No encontrado') ? 'text-orange-600' : 'text-green-700'}`}>{found}</td>
                              </tr>
                          ))}
                      </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

<section className="bg-white rounded-lg shadow-lg p-6 border-l-4 border-blue-500">
            <h2 className="text-2xl font-bold text-gray-800 mb-4 border-b pb-3">Paso 3: Cargar Archivo Quick - Plataforma (Entregados)</h2>
            <p className="text-sm text-gray-600 mb-4">
                Sube el archivo Quick de entregas/evidencias. Cruce por <b>NUMERO TF</b> + <b>BOD DESTINO</b> → <b>ENTREGADO</b>.
                La ruta de hoy ya no sale de Quick (usa el Paso 2).
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

          <section className="bg-white rounded-lg shadow-lg p-6 border-l-4 border-amber-500">
            <h2 className="text-2xl font-bold text-gray-800 mb-4 border-b pb-3">Paso 4: Unidades de empaque en bodega</h2>
            <p className="text-sm text-gray-600 mb-4">
              Sube el Excel de unidades de empaque. Se cruza por la columna <b>TF</b> con <b>NRO DOCUMENTO.2</b>.
              Las que coincidan (y no estén entregadas / en ruta hoy) quedan en <b>EN BODEGA</b>.
              Tras rutas, Quick y/o empaque, lo que quede sin estado → <b>VALIDAR CON AMBAS TIENDAS</b>.
            </p>
            <FileUpload
              onFileProcess={handleWarehousePackFileProcess}
              isLoading={isWarehousePackLoading}
              fileName={warehousePackFileName}
              mainText="Subir unidades de empaque (TF en bodega)"
              subText="Columna requerida: TF"
              loadedSubText="Archivo de empaque cruzado."
            />
          </section>

          <section className="bg-white rounded-lg shadow-lg p-6 border-l-4 border-indigo-600">
            <h2 className="text-xl font-bold text-gray-800 mb-2">Publicar estados para tiendas</h2>
            <p className="text-sm text-gray-600 mb-4">
              Solo cuando los 4 pasos estén listos se guarda en Firestore (<code>tf_platform_status</code>).
              Luego el rol tiendas puede consultar por TF o bodega destino.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-4 text-sm">
              <div className={`rounded-md border px-3 py-2 ${stepFlags.hasMain ? 'bg-green-50 border-green-300 text-green-800' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                1. Base TF: {stepFlags.hasMain ? 'Listo' : 'Pendiente (Actualizar Datos)'}
              </div>
              <div className={`rounded-md border px-3 py-2 ${stepFlags.hasRoutes ? 'bg-green-50 border-green-300 text-green-800' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                2. Rutas: {stepFlags.hasRoutes ? 'Listo' : 'Pendiente'}
              </div>
              <div className={`rounded-md border px-3 py-2 ${stepFlags.hasQuick ? 'bg-green-50 border-green-300 text-green-800' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                3. Quick: {stepFlags.hasQuick ? 'Listo' : 'Pendiente'}
              </div>
              <div className={`rounded-md border px-3 py-2 ${stepFlags.hasPack ? 'bg-green-50 border-green-300 text-green-800' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                4. Empaque: {stepFlags.hasPack ? 'Listo' : 'Pendiente'}
              </div>
            </div>
            <Button
              type="button"
              onClick={() =>
                void publishPlatformStatusesIfComplete(baseData, columnMap, routeData, stepFlags)
              }
              disabled={isPublishingPlatform || baseData.length === 0}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              <Store className={`w-4 h-4 mr-2 ${isPublishingPlatform ? 'animate-pulse' : ''}`} />
              {isPublishingPlatform
                ? 'Publicando estados…'
                : allStepsReady
                  ? 'Publicar estados para tiendas'
                  : 'Publicar (completa los 4 pasos)'}
            </Button>
            {!allStepsReady && (
              <p className="text-xs text-amber-700 mt-2">
                El botón está visible, pero la publicación exige los 4 pasos en verde en esta misma sesión.
              </p>
            )}
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

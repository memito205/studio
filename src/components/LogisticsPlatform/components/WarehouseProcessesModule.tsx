'use client';

import React, { useMemo, useState } from 'react';
import FileUpload from './FileUpload';
import { findHeader, formatDate, normalizeDate, generateDailySummaryPdf, exportToExcel } from '../utils/helpers';
import type { ExcelDataRow, ObservationSummary, EntregasPorVehiculo, PendingGoodsItem } from '../types';
import { ClipboardPasteIcon, PlusCircleIcon, PdfFileIcon, PackageIcon, Trash2Icon, DownloadIcon, FileClockIcon } from './icons';
import { publishWarehouseProcessSummary } from '@/app/warehouseProcessSummaryActions';
import { useAuth } from '@/hooks/use-auth-context';
import { toast } from '@/hooks/use-toast';
import { CloudUpload, Loader2, Link2, Unlink } from 'lucide-react';
import {
    applyPreviousDayDeltas,
    autoMatchProcesses,
    clearPreviousDayDeltas,
    importUnmatchedPreviousAsActive,
    isImportedFromPrevious,
    methodLabel,
    parsePreviousDayRows,
    type PreviousDayProcessRow,
    type ProcessMatch,
} from '../utils/warehouseProcessMatching';

import * as XLSX from 'xlsx';

const generateUniqueId = () => {
    return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
};

const WarehouseProcessesModule: React.FC = () => {
    const { user, userName } = useAuth();
    const [processes, setProcesses] = useState<ObservationSummary[]>([]);
    const [pendingGoods, setPendingGoods] = useState<PendingGoodsItem[]>([]);
    const [entregasData, setEntregasData] = useState<EntregasPorVehiculo[]>([]);
    const [isPublishing, setIsPublishing] = useState(false);

    // UI States
    const [processesFileName, setProcessesFileName] = useState<string | null>(null);
    const [isProcessesLoading, setIsProcessesLoading] = useState(false);
    const [entregasFileName, setEntregasFileName] = useState<string | null>(null);
    const [isEntregasLoading, setIsEntregasLoading] = useState(false);
    const [pendingGoodsFileName, setPendingGoodsFileName] = useState<string | null>(null);
    const [isPendingLoading, setIsPendingLoading] = useState(false);
    const [isPrevReportLoading, setIsPrevReportLoading] = useState(false);
    const [prevReportFileName, setPrevReportFileName] = useState<string | null>(null);

    const [previousDayRows, setPreviousDayRows] = useState<PreviousDayProcessRow[]>([]);
    const [processMatches, setProcessMatches] = useState<ProcessMatch[]>([]);
    const [manualPick, setManualPick] = useState<Record<string, string>>({});

    const todayStr = new Date().toISOString().split('T')[0];

    const prevById = useMemo(() => {
        const map = new Map<string, PreviousDayProcessRow>();
        previousDayRows.forEach((r) => map.set(r.id, r));
        return map;
    }, [previousDayRows]);

    const processById = useMemo(() => {
        const map = new Map<string, ObservationSummary>();
        processes.forEach((p) => map.set(p.id, p));
        return map;
    }, [processes]);

    const matchedPrevIds = useMemo(
        () => new Set(processMatches.map((m) => m.previousId)),
        [processMatches]
    );
    const matchedCurrIds = useMemo(
        () => new Set(processMatches.map((m) => m.currentId)),
        [processMatches]
    );

    const unmatchedCurrent = useMemo(
        () => processes.filter((p) => !matchedCurrIds.has(p.id)),
        [processes, matchedCurrIds]
    );
    const unmatchedPrevious = useMemo(
        () => previousDayRows.filter((p) => !matchedPrevIds.has(p.id)),
        [previousDayRows, matchedPrevIds]
    );

    /** Previas libres + las ya importadas como «Desde ayer» (para Asociar sin perder el vínculo). */
    const previousAvailableForAssociate = useMemo(() => {
        const importedPrevIds = new Set(
            processMatches.filter((m) => m.method === 'imported_previous').map((m) => m.previousId)
        );
        return previousDayRows.filter(
            (p) => !matchedPrevIds.has(p.id) || importedPrevIds.has(p.id)
        );
    }, [previousDayRows, matchedPrevIds, processMatches]);

    const realMatches = useMemo(
        () => processMatches.filter((m) => m.method !== 'imported_previous'),
        [processMatches]
    );

    const applyMatchesToProcesses = (
        base: ObservationSummary[],
        matches: ProcessMatch[],
        prevRows: PreviousDayProcessRow[]
    ): ObservationSummary[] => {
        const prevMap = new Map(prevRows.map((r) => [r.id, r]));
        const matchByCurr = new Map(matches.map((m) => [m.currentId, m]));
        return base.map((item) => {
            const m = matchByCurr.get(item.id);
            if (!m) return clearPreviousDayDeltas(item);
            const prev = prevMap.get(m.previousId);
            if (!prev) return clearPreviousDayDeltas(item);
            if (m.method === 'imported_previous') {
                // Mantener baseline importado; applyPreviousDayDeltas dejaría deltas en 0 igual.
                return {
                    ...applyPreviousDayDeltas(item, prev, m.method),
                    matchMethod: 'imported_previous' as const,
                };
            }
            return applyPreviousDayDeltas(item, prev, m.method);
        });
    };

    /** Quita imports previos, rematch auto, importa no emparejados como activos. */
    const rematchAndImportPrevious = (
        baseProcesses: ObservationSummary[],
        prevRows: PreviousDayProcessRow[]
    ): { processes: ObservationSummary[]; matches: ProcessMatch[]; importedCount: number } => {
        const withoutImported = baseProcesses.filter((p) => !isImportedFromPrevious(p));
        const { matches, unmatchedPreviousIds } = autoMatchProcesses(withoutImported, prevRows);
        const matched = applyMatchesToProcesses(withoutImported, matches, prevRows);
        const { imported, importedMatches } = importUnmatchedPreviousAsActive(
            prevRows,
            unmatchedPreviousIds,
            generateUniqueId
        );
        return {
            processes: [...matched, ...imported],
            matches: [...matches, ...importedMatches],
            importedCount: imported.length,
        };
    };

    const handlePublishToBodegaLive = async () => {
        if (processes.length === 0 && pendingGoods.length === 0) {
            toast({
                title: 'Nada que publicar',
                description: 'Carga o crea al menos un proceso o ingreso pendiente.',
                variant: 'destructive',
            });
            return;
        }
        setIsPublishing(true);
        try {
            const publishedBy =
                userName || user?.displayName || user?.email || 'Sistema';
            const result = await publishWarehouseProcessSummary({
                publishedBy,
                processes: processes.map((p) => ({
                    id: p.id,
                    observation: p.observation,
                    totalQuantity: p.totalQuantity,
                    totalPacked: p.totalPacked,
                    packedPercentage: p.packedPercentage,
                    fechaEntrega: p.fechaEntrega,
                    procesoObservacion: p.procesoObservacion,
                    isVXM: p.isVXM,
                    conteoPorcentaje: p.conteoPorcentaje,
                    etiquetadoPorcentaje: p.etiquetadoPorcentaje,
                    revisionCalidadPorcentaje: p.revisionCalidadPorcentaje,
                    remisionPorcentaje: p.remisionPorcentaje,
                })),
                pendingGoods: pendingGoods.map((g) => ({
                    id: g.id,
                    marca: g.marca,
                    cantidadEntrada: g.cantidadEntrada,
                    fechaEntradaAprox: g.fechaEntradaAprox,
                })),
                entregas:
                    entregasData.length > 0
                        ? entregasData.map((e) => ({
                              vehiculo: e.vehiculo,
                              items: e.items,
                          }))
                        : undefined,
            });
            if (!result.success) {
                toast({
                    title: 'Error al publicar',
                    description: result.error || 'No se pudo publicar a Bodega Live.',
                    variant: 'destructive',
                });
                return;
            }
            toast({
                title: 'Publicado a Bodega Live',
                description: `${result.data?.totals.processCount || 0} procesos · se verá en la rotación de TV.`,
            });
        } catch (err: any) {
            toast({
                title: 'Error al publicar',
                description: err?.message || 'Error inesperado.',
                variant: 'destructive',
            });
        } finally {
            setIsPublishing(false);
        }
    };

    // --- ACCIONES DE PROCESOS ---
    const handleProcessChange = (id: string, field: keyof ObservationSummary, value: any) => {
        setProcesses(prev => prev.map(item => {
            if (item.id === id) {
                const updated = { ...item, [field]: value };

                // REGLA: El progreso total SIEMPRE es por unidades (Pedida vs Empacada)
                const q = Number(updated.totalQuantity || 0);
                const p = Number(updated.totalPacked || 0);
                updated.packedPercentage = q > 0 ? (p / q) * 100 : 0;

                // Recalcular avance vs baseline del día anterior (emparejado o importado)
                const prevRow = updated.matchedPreviousId
                    ? prevById.get(updated.matchedPreviousId)
                    : undefined;
                if (prevRow) {
                    updated.deltaPacked = Math.max(0, p - (prevRow.totalPacked || 0));
                    updated.deltaConteo = Math.max(
                        0,
                        (Number(updated.conteoPorcentaje) || 0) - (prevRow.conteoPorcentaje || 0)
                    );
                    updated.deltaEtiquetado = Math.max(
                        0,
                        (Number(updated.etiquetadoPorcentaje) || 0) - (prevRow.etiquetadoPorcentaje || 0)
                    );
                    updated.deltaCalidad = Math.max(
                        0,
                        (Number(updated.revisionCalidadPorcentaje) || 0) -
                            (prevRow.revisionCalidadPorcentaje || 0)
                    );
                    updated.deltaRemision = Math.max(
                        0,
                        (Number(updated.remisionPorcentaje) || 0) - (prevRow.remisionPorcentaje || 0)
                    );
                    updated.hasDeltas = true;
                }

                return updated;
            }
            return item;
        }));
    };

    const removeProcess = (id: string) => {
        setProcesses(current => current.filter(p => p.id !== id));
        setProcessMatches(ms => ms.filter(m => m.currentId !== id));
    };

    const handleAddManualProcess = (type: 'rim' | 'vxm') => {
        const newItem: ObservationSummary = {
            id: generateUniqueId(),
            observation: type === 'rim' ? "NUEVO PROCESO RIM" : "NUEVO PROCESO VXM",
            originalObservation: "manual",
            totalQuantity: 0,
            totalPacked: 0,
            packedPercentage: 0,
            fechaObs: formatDate(new Date()), // Valor por defecto
            fechaEntrega: new Date().toISOString().slice(0, 10),
            procesoObservacion: '',
            isVXM: type === 'vxm',
            conteoPorcentaje: 0,
            etiquetadoPorcentaje: 0,
            revisionCalidadPorcentaje: 0,
            remisionPorcentaje: 0
        };
        setProcesses(prev => [newItem, ...prev]);
    };

    const handleAddManualPending = () => {
        const newItem: PendingGoodsItem = {
            id: generateUniqueId(),
            marca: 'NUEVA MARCA',
            cantidadEntrada: 0,
            fechaEntradaAprox: new Date().toISOString().slice(0, 10)
        };
        setPendingGoods(prev => [newItem, ...prev]);
    };

    // --- EXPORTAR A EXCEL ---
    const handleExportExcel = () => {
        const dataToExport = processes.map(p => ({
            'ID': p.id,
            'TIPO': p.isVXM ? 'VXM' : 'RIM',
            'PROCESO': p.observation,
            'FECHA PROCESO': p.fechaObs,
            'FECHA ENTREGA': p.fechaEntrega,
            'OBSERVACIONES': p.procesoObservacion,
            'CONTEO %': p.conteoPorcentaje || 0,
            'ETIQUETADO %': p.etiquetadoPorcentaje || 0,
            'CALIDAD %': p.revisionCalidadPorcentaje || 0,
            'REMISION %': p.remisionPorcentaje || 0,
            'CANT. PEDIDA': p.totalQuantity,
            'CANT. EMPACADA': p.totalPacked,
            'AVANCE TOTAL %': p.packedPercentage.toFixed(2)
        }));
        exportToExcel(dataToExport, `Control_Procesos_Bodega_${todayStr}`);
    };

    const handleUnmatch = (currentId: string) => {
        const removed = processMatches.find((m) => m.currentId === currentId);
        const nextMatches = processMatches.filter((m) => m.currentId !== currentId);
        setProcesses((prev) => {
            const cleared = applyMatchesToProcesses(prev, nextMatches, previousDayRows);
            // La previa liberada vuelve como tarjeta activa «Desde ayer» (no a la lista sin usar).
            if (
                removed &&
                removed.method !== 'imported_previous' &&
                !nextMatches.some((m) => m.previousId === removed.previousId)
            ) {
                const { imported, importedMatches } = importUnmatchedPreviousAsActive(
                    previousDayRows,
                    [removed.previousId],
                    generateUniqueId
                );
                queueMicrotask(() => setProcessMatches([...nextMatches, ...importedMatches]));
                return [...cleared, ...imported];
            }
            queueMicrotask(() => setProcessMatches(nextMatches));
            return cleared;
        });
    };

    const handleManualAssociate = (currentId: string) => {
        const previousId = manualPick[currentId];
        if (!previousId) {
            toast({
                title: 'Elige un proceso del día anterior',
                description: 'Selecciona cuál asociar antes de confirmar.',
                variant: 'destructive',
            });
            return;
        }
        const existingPrevMatch = processMatches.find((m) => m.previousId === previousId);
        if (existingPrevMatch && existingPrevMatch.method !== 'imported_previous') {
            toast({
                title: 'Ya está asociado',
                description: 'Ese proceso del día anterior ya tiene pareja.',
                variant: 'destructive',
            });
            return;
        }
        // Si estaba importado como «Desde ayer», quitar esa tarjeta y usar el actual de hoy.
        const importedCurrentId =
            existingPrevMatch?.method === 'imported_previous' ? existingPrevMatch.currentId : null;

        const nextMatches: ProcessMatch[] = [
            ...processMatches.filter(
                (m) =>
                    m.currentId !== currentId &&
                    m.previousId !== previousId &&
                    m.currentId !== importedCurrentId
            ),
            { currentId, previousId, method: 'manual', score: 1 },
        ];
        setProcessMatches(nextMatches);
        setProcesses((prev) => {
            const base = importedCurrentId
                ? prev.filter((p) => p.id !== importedCurrentId)
                : prev;
            return applyMatchesToProcesses(base, nextMatches, previousDayRows);
        });
        setManualPick((p) => {
            const n = { ...p };
            delete n[currentId];
            return n;
        });
    };

    // --- CARGAR REPORTE ANTERIOR (Comparación) ---
    const handlePrevReportFile = (file: File) => {
        setIsPrevReportLoading(true);
        setPrevReportFileName(file.name);
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target!.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array' });
                const jsonData: Record<string, unknown>[] = XLSX.utils.sheet_to_json(
                    workbook.Sheets[workbook.SheetNames[0]],
                    { defval: "" }
                );

                const prevRows = parsePreviousDayRows(jsonData);
                if (prevRows.length === 0) {
                    alert('No se encontraron procesos en el archivo del día anterior.');
                    return;
                }

                setPreviousDayRows(prevRows);
                setManualPick({});
                setProcesses((currentProcesses) => {
                    const { processes: next, matches, importedCount } = rematchAndImportPrevious(
                        currentProcesses,
                        prevRows
                    );
                    const autoMatched = matches.filter((m) => m.method !== 'imported_previous').length;
                    queueMicrotask(() => {
                        setProcessMatches(matches);
                        toast({
                            title: 'Día anterior cargado',
                            description: `${autoMatched} emparejados · ${importedCount} importados desde ayer · ${prevRows.length} filas previas.`,
                        });
                    });
                    return next;
                });
            } catch (err) {
                console.error(err);
                alert("Error al cargar el reporte anterior.");
            } finally {
                setIsPrevReportLoading(false);
            }
        };
        reader.readAsArrayBuffer(file);
    };

    // --- PROCESAMIENTO DE ARCHIVOS ---
    const handleProcessesFileProcess = (file: File) => {
        setIsProcessesLoading(true); setProcessesFileName(file.name);
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target!.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array', cellDates: true, codepage: 65001 });
                const jsonData: ExcelDataRow[] = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
                const headers = Object.keys(jsonData[0] || {});
                const colMap = { TIPO: findHeader(headers, ['TIPO']), FECHA: findHeader(headers, ['FECHA']), OBS: findHeader(headers, ['OBS']), CANT: findHeader(headers, ['CANT']), EMP: findHeader(headers, ['EMP']) };

                if (!colMap.TIPO || !colMap.CANT) throw new Error("Faltan columnas TIPO o CANT");

                const tempMap = new Map<string, any>();
                jsonData.forEach(row => {
                    const tipo = String(row[colMap.TIPO!] || '').toUpperCase().trim();
                    if (tipo !== 'RIM' && tipo !== 'VXM') return;
                    const key = `${tipo}-${row[colMap.OBS!] || 'S/O'}`;
                    if (!tempMap.has(key)) tempMap.set(key, { q: 0, p: 0, d: null, tipo });
                    const curr = tempMap.get(key);
                    curr.q += Number(row[colMap.CANT!]) || 0;
                    curr.p += Number(row[colMap.EMP!]) || 0;
                    const f = normalizeDate(row[colMap.FECHA!]);
                    if (f && (!curr.d || f > curr.d)) curr.d = f;
                });

                const newItems: ObservationSummary[] = Array.from(tempMap.entries()).map(([k, d]) => ({
                    id: generateUniqueId(),
                    observation: k.split('-').slice(1).join('-'),
                    originalObservation: k,
                    totalQuantity: d.q,
                    totalPacked: d.p,
                    packedPercentage: d.q > 0 ? (d.p / d.q) * 100 : 0,
                    fechaObs: d.d ? formatDate(d.d) : 'N/D',
                    fechaEntrega: '',
                    procesoObservacion: '',
                    isVXM: d.tipo === 'VXM',
                    conteoPorcentaje: 0,
                    etiquetadoPorcentaje: 0,
                    revisionCalidadPorcentaje: 0,
                    remisionPorcentaje: 0
                }));

                setProcesses(prev => {
                    const combined = [...newItems, ...prev];
                    if (previousDayRows.length === 0) return combined;
                    const { processes: next, matches } = rematchAndImportPrevious(
                        combined,
                        previousDayRows
                    );
                    queueMicrotask(() => setProcessMatches(matches));
                    return next;
                });
            } catch (err: any) { alert(err.message); } finally { setIsProcessesLoading(false); }
        };
        reader.readAsArrayBuffer(file);
    };

    const handleEntregasFileProcess = (file: File) => {
        setIsEntregasLoading(true); setEntregasFileName(file.name);
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target!.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array', cellDates: true });
                const jsonData: any[] = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
                const grouped = new Map<string, any>();
                jsonData.forEach(row => {
                    const v = String(row['VEHICULO'] || 'S/V');
                    if (!grouped.has(v)) grouped.set(v, []);
                    grouped.get(v).push(row);
                });
                setEntregasData(Array.from(grouped.entries()).map(([v, rows]) => ({
                    vehiculo: v,
                    items: (rows as any[]).map((r: any) => ({ ubicacion: String(r['UBICACION'] || r['VALOR'] || 'N/D'), marca: String(r['MARCA'] || 'N/D'), cantidad: Number(r['CANTIDAD'] || 0) }))
                })));
            } catch (err) { console.error(err); } finally { setIsEntregasLoading(false); }
        };
        reader.readAsArrayBuffer(file);
    };

    const handlePendingFileProcess = (file: File) => {
        setIsPendingLoading(true); setPendingGoodsFileName(file.name);
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target!.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array', cellDates: true });
                const jsonData: any[] = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
                setPendingGoods(prev => [...prev, ...jsonData.map(row => ({
                    id: generateUniqueId(),
                    marca: String(row['MARCA'] || 'N/A'),
                    cantidadEntrada: Number(row['CANTIDAD'] || 0),
                    fechaEntradaAprox: row['FECHA'] instanceof Date ? row['FECHA'].toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)
                }))]);
            } catch (err) { console.error(err); } finally { setIsPendingLoading(false); }
        };
        reader.readAsArrayBuffer(file);
    };

    return (
        <div className="space-y-8 pb-24">
            {/* Cargas */}
            <section className="bg-white rounded-lg shadow-lg p-6">
                <div className="flex justify-between items-center mb-6 border-b pb-3 flex-wrap gap-2">
                    <h2 className="text-2xl font-bold text-gray-800">Panel de Control de Bodega</h2>
                    <div className="flex gap-2 flex-wrap">
                         <button
                            onClick={() => void handlePublishToBodegaLive()}
                            className="flex items-center px-4 py-2 bg-cyan-600 text-white font-bold rounded hover:bg-cyan-700 transition-all shadow disabled:opacity-60"
                            disabled={isPublishing || (processes.length === 0 && pendingGoods.length === 0)}
                        >
                            {isPublishing ? (
                                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                            ) : (
                                <CloudUpload className="h-5 w-5 mr-2" />
                            )}
                            Publicar a Bodega Live
                        </button>
                         <button
                            onClick={handleExportExcel}
                            className="flex items-center px-4 py-2 bg-emerald-600 text-white font-bold rounded hover:bg-emerald-700 transition-all shadow"
                            disabled={processes.length === 0}
                        >
                            <DownloadIcon className="h-5 w-5 mr-2" /> Excel Control
                        </button>
                        <button
                            onClick={() => generateDailySummaryPdf(processes.filter(p => !p.isVXM), processes.filter(p => p.isVXM), entregasData, pendingGoods)}
                            className="flex items-center px-4 py-2 bg-blue-600 text-white font-bold rounded hover:bg-blue-700 transition-all shadow"
                            disabled={processes.length === 0 && pendingGoods.length === 0}
                        >
                            <PdfFileIcon className="h-5 w-5 mr-2" /> PDF Diario
                        </button>
                    </div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                    <FileUpload onFileProcess={handleProcessesFileProcess} isLoading={isProcessesLoading} fileName={processesFileName} mainText="Cargar Procesos" subText="RIM / VXM" loadedSubText="Cargado." />
                    <FileUpload onFileProcess={handleEntregasFileProcess} isLoading={isEntregasLoading} fileName={entregasFileName} mainText="Cargar Entregas" subText="Vehículos" loadedSubText="Cargado." />
                    <FileUpload onFileProcess={handlePendingFileProcess} isLoading={isPendingLoading} fileName={pendingGoodsFileName} mainText="Cargar Ingresos" subText="Mercancía" loadedSubText="Cargado." />
                    <FileUpload onFileProcess={handlePrevReportFile} isLoading={isPrevReportLoading} fileName={prevReportFileName} mainText="Día Anterior" subText="Comparar Avance" loadedSubText="Cargado." />
                </div>
            </section>

            {/* Revisión de emparejamientos Día Anterior */}
            {previousDayRows.length > 0 && (
                <section className="bg-white rounded-lg shadow-lg p-6 border-t-4 border-amber-500">
                    <div className="flex items-center justify-between mb-4 border-b pb-3 flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                            <FileClockIcon className="h-6 w-6 text-amber-600" />
                            <div>
                                <h2 className="text-xl font-bold text-gray-800">Revisión de emparejamientos</h2>
                                <p className="text-xs text-gray-500">
                                    Día anterior: {prevReportFileName || 'archivo'} · {realMatches.length} asociados ·{' '}
                                    {processMatches.filter((m) => m.method === 'imported_previous').length} desde ayer ·{' '}
                                    {unmatchedCurrent.filter((p) => !isImportedFromPrevious(p)).length} actuales sin pareja
                                    {unmatchedPrevious.length > 0 ? ` · ${unmatchedPrevious.length} anteriores libres` : ''}
                                </p>
                                <p className="text-[11px] text-amber-800/80 mt-1 max-w-3xl">
                                    Si un proceso de ayer no está en el Excel de hoy, se crea automáticamente como tarjeta activa
                                    (badge «Desde ayer»). Si hay uno de hoy y uno de ayer, el avance (Δ) se calcula al asociarlos.
                                </p>
                            </div>
                        </div>
                    </div>

                    {realMatches.length > 0 && (
                        <div className="mb-6 overflow-x-auto">
                            <h3 className="text-sm font-bold text-gray-700 mb-2">Emparejados</h3>
                            <table className="min-w-full text-sm border rounded-lg overflow-hidden">
                                <thead className="bg-slate-50 text-left text-xs uppercase text-gray-500">
                                    <tr>
                                        <th className="px-3 py-2">Actual</th>
                                        <th className="px-3 py-2">Anterior</th>
                                        <th className="px-3 py-2">Método</th>
                                        <th className="px-3 py-2">Δ Emp.</th>
                                        <th className="px-3 py-2"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {realMatches.map((m) => {
                                        const cur = processById.get(m.currentId);
                                        const prev = prevById.get(m.previousId);
                                        if (!cur || !prev) return null;
                                        return (
                                            <tr key={`${m.currentId}-${m.previousId}`} className="hover:bg-amber-50/40">
                                                <td className="px-3 py-2">
                                                    <span className={`text-[10px] font-bold mr-1 ${cur.isVXM ? 'text-blue-600' : 'text-green-600'}`}>
                                                        {cur.isVXM ? 'VXM' : 'RIM'}
                                                    </span>
                                                    {cur.observation}
                                                    <div className="text-[10px] text-gray-400">Pedida {cur.totalQuantity} · Emp {cur.totalPacked}</div>
                                                </td>
                                                <td className="px-3 py-2">
                                                    {prev.label}
                                                    <div className="text-[10px] text-gray-400">Pedida {prev.totalQuantity} · Emp {prev.totalPacked}</div>
                                                </td>
                                                <td className="px-3 py-2">
                                                    <span className="inline-block px-2 py-0.5 rounded bg-slate-100 text-xs font-semibold">
                                                        {methodLabel(m.method)}
                                                    </span>
                                                </td>
                                                <td className="px-3 py-2 font-semibold text-blue-700">
                                                    +{cur.deltaPacked ?? 0}
                                                </td>
                                                <td className="px-3 py-2 text-right">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleUnmatch(m.currentId)}
                                                        className="inline-flex items-center gap-1 text-xs font-bold text-red-600 hover:bg-red-50 px-2 py-1 rounded"
                                                    >
                                                        <Unlink className="h-3.5 w-3.5" />
                                                        Desemparejar
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {unmatchedCurrent.filter((p) => !isImportedFromPrevious(p)).length > 0 && (
                        <div className="mb-6">
                            <h3 className="text-sm font-bold text-gray-700 mb-1">Actuales sin pareja — asociar manualmente</h3>
                            <p className="text-[11px] text-gray-500 mb-2">
                                Elige un proceso del día anterior y pulsa Asociar para que el avance (Δ Emp., etapas) se calcule contra esa base.
                                Si eliges uno ya mostrado como «Desde ayer», esa tarjeta se fusiona en el proceso de hoy.
                            </p>
                            <div className="space-y-3">
                                {unmatchedCurrent
                                    .filter((p) => !isImportedFromPrevious(p))
                                    .map((cur) => {
                                    const freePrev = previousAvailableForAssociate.filter(
                                        (p) => p.isVXM === Boolean(cur.isVXM)
                                    );
                                    return (
                                        <div
                                            key={cur.id}
                                            className="flex flex-wrap items-center gap-3 border border-slate-200 rounded-xl p-3 bg-slate-50"
                                        >
                                            <div className="min-w-[180px] flex-1">
                                                <span className={`text-[10px] font-bold ${cur.isVXM ? 'text-blue-600' : 'text-green-600'}`}>
                                                    {cur.isVXM ? 'VXM' : 'RIM'}
                                                </span>
                                                <div className="font-bold text-sm text-gray-800">{cur.observation}</div>
                                                <div className="text-[10px] text-gray-500">Pedida {cur.totalQuantity} · Emp {cur.totalPacked}</div>
                                            </div>
                                            <select
                                                className="flex-1 min-w-[200px] border border-slate-300 rounded-lg text-sm p-2 bg-white"
                                                value={manualPick[cur.id] || ''}
                                                onChange={(e) =>
                                                    setManualPick((p) => ({ ...p, [cur.id]: e.target.value }))
                                                }
                                            >
                                                <option value="">— Elegir del día anterior —</option>
                                                {freePrev.map((p) => {
                                                    const isImported = processMatches.some(
                                                        (m) =>
                                                            m.previousId === p.id &&
                                                            m.method === 'imported_previous'
                                                    );
                                                    return (
                                                        <option key={p.id} value={p.id}>
                                                            {p.label} (Ped {p.totalQuantity} / Emp {p.totalPacked})
                                                            {isImported ? ' · Desde ayer' : ''}
                                                        </option>
                                                    );
                                                })}
                                            </select>
                                            <button
                                                type="button"
                                                onClick={() => handleManualAssociate(cur.id)}
                                                disabled={!manualPick[cur.id] || freePrev.length === 0}
                                                className="inline-flex items-center gap-1 px-3 py-2 bg-amber-600 text-white text-xs font-bold rounded-lg hover:bg-amber-700 disabled:opacity-50"
                                            >
                                                <Link2 className="h-3.5 w-3.5" />
                                                Asociar
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                            {previousAvailableForAssociate.length === 0 && (
                                <p className="text-xs text-gray-400 mt-2">No quedan procesos del día anterior libres para asociar.</p>
                            )}
                        </div>
                    )}

                    {unmatchedPrevious.length > 0 && (
                        <div>
                            <h3 className="text-sm font-bold text-gray-700 mb-1">Anteriores sin usar</h3>
                            <p className="text-[11px] text-gray-500 mb-2">
                                Casos excepcionales que no se importaron como activos. Normalmente esta lista queda vacía.
                            </p>
                            <ul className="text-xs text-gray-600 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                                {unmatchedPrevious.map((p) => (
                                    <li key={p.id} className="border border-dashed border-gray-200 rounded-lg px-3 py-2 bg-white">
                                        <span className={`font-bold ${p.isVXM ? 'text-blue-600' : 'text-green-600'}`}>
                                            {p.isVXM ? 'VXM' : 'RIM'}
                                        </span>{' '}
                                        {p.label}
                                        <span className="text-gray-400"> · Ped {p.totalQuantity} / Emp {p.totalPacked}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </section>
            )}

            {/* Panel de Procesos Activos */}
            {processes.length > 0 && (
                <section className="bg-white rounded-lg shadow-lg p-6 border-t-4 border-blue-600">
                    <div className="flex justify-between items-center mb-6 border-b pb-3 flex-wrap gap-3">
                        <div className="flex items-center">
                            <ClipboardPasteIcon className="h-6 w-6 text-green-600 mr-2" />
                            <h2 className="text-xl font-bold text-gray-800">Control de Procesos Activos ({processes.length})</h2>
                        </div>
                        <div className="flex gap-2">
                            <button onClick={() => handleAddManualProcess('rim')} className="px-3 py-1.5 bg-green-600 text-white rounded font-bold text-xs shadow hover:bg-green-700">+ RIM</button>
                            <button onClick={() => handleAddManualProcess('vxm')} className="px-3 py-1.5 bg-blue-600 text-white rounded font-bold text-xs shadow hover:bg-blue-700">+ VXM</button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {processes.map(item => {
                            const isOverdue = item.fechaEntrega && item.fechaEntrega <= todayStr && item.packedPercentage < 100;

                            return (
                                <div key={item.id} className={`bg-white border-2 ${isOverdue ? 'border-red-500 ring-4 ring-red-100' : 'border-gray-200'} rounded-2xl overflow-visible shadow-lg hover:shadow-xl transition-all flex flex-col relative`}>

                                    {/* ALERTA DE ATRASADO GRANDE */}
                                    {isOverdue && (
                                        <div className="absolute -top-3 left-1/2 transform -translate-x-1/2 z-[60] bg-red-600 text-white text-xs font-black px-6 py-1.5 rounded-full shadow-2xl animate-bounce border-2 border-white">
                                            ¡PROCESO ATRASADO!
                                        </div>
                                    )}

                                    {/* BOTÓN DE ELIMINAR SEGURO */}
                                    <div className="absolute top-2 right-2 z-[100]">
                                        <button
                                            type="button"
                                            onMouseDown={(e) => { e.preventDefault(); removeProcess(item.id); }}
                                            className="p-2 bg-red-50 text-red-600 hover:bg-red-600 hover:text-white rounded-xl transition-all shadow-md border border-red-100"
                                        >
                                            <Trash2Icon className="h-5 w-5 pointer-events-none" />
                                        </button>
                                    </div>

                                    <div className="p-5 space-y-4">
                                        <div className="pr-10">
                                            <span className={`text-[10px] font-black px-3 py-1 rounded-full ${item.isVXM ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                                                {item.isVXM ? 'VXM' : 'RIM'}
                                            </span>
                                            {item.matchMethod === 'imported_previous' && (
                                                <span className="ml-2 text-[9px] font-bold text-violet-700 bg-violet-50 px-2 py-0.5 rounded-full border border-violet-200">
                                                    Desde ayer
                                                </span>
                                            )}
                                            {item.hasDeltas && item.matchedPreviousLabel && item.matchMethod !== 'imported_previous' && (
                                                <span className="ml-2 text-[9px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                                                    vs {item.matchedPreviousLabel.slice(0, 24)}{item.matchedPreviousLabel.length > 24 ? '…' : ''} ({methodLabel(item.matchMethod || 'manual')})
                                                </span>
                                            )}
                                            <input
                                                type="text"
                                                value={item.observation}
                                                onChange={(e) => handleProcessChange(item.id, 'observation', e.target.value)}
                                                className="font-black text-gray-900 bg-transparent border-none p-0 text-sm focus:ring-0 w-full mt-2"
                                            />
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest">F. Proceso</label>
                                                {item.originalObservation === 'manual' || item.originalObservation === 'imported_previous' ? (
                                                    <input
                                                        type="text"
                                                        value={item.fechaObs}
                                                        onChange={e => handleProcessChange(item.id, 'fechaObs', e.target.value)}
                                                        className="w-full bg-slate-50 border border-slate-100 rounded p-1 text-[11px] font-bold text-gray-700"
                                                    />
                                                ) : (
                                                    <div className="text-xs font-bold text-gray-700">{item.fechaObs}</div>
                                                )}
                                            </div>
                                            <div>
                                                <label className={`text-[9px] font-black uppercase tracking-widest ${isOverdue ? 'text-red-600' : 'text-gray-400'}`}>F. Entrega</label>
                                                <input
                                                    type="date"
                                                    value={item.fechaEntrega}
                                                    onChange={(e) => handleProcessChange(item.id, 'fechaEntrega', e.target.value)}
                                                    className={`w-full border-2 rounded-lg p-1.5 text-[11px] font-bold ${isOverdue ? 'bg-red-50 border-red-300 text-red-800' : 'bg-slate-50 border-slate-100'}`}
                                                />
                                            </div>
                                        </div>

                                        {/* ETAPAS EDITABLES CON PORCENTAJE MANUAL */}
                                        <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-4">
                                            {item.isVXM ? (
                                                <>
                                                    <div className="space-y-2">
                                                        <div className="flex justify-between items-center">
                                                            <label className="text-[10px] font-black text-blue-800 uppercase">Rev. Calidad</label>
                                                            <div className="flex items-center bg-white border-2 border-blue-100 rounded-lg px-2">
                                                                <input type="number" min="0" max="100" value={item.revisionCalidadPorcentaje || 0} onChange={e => handleProcessChange(item.id, 'revisionCalidadPorcentaje', Number(e.target.value))} className="w-12 text-[12px] font-black p-1 bg-transparent border-none text-right focus:ring-0" />
                                                                <span className="text-[11px] font-black text-blue-800">%</span>
                                                            </div>
                                                        </div>
                                                        <div className="w-full bg-blue-200 h-2 rounded-full overflow-hidden shadow-inner">
                                                            <div className="h-full bg-blue-600 transition-all duration-500" style={{ width: `${Math.min(100, item.revisionCalidadPorcentaje || 0)}%` }}></div>
                                                        </div>
                                                        {item.deltaCalidad !== undefined && <div className="text-[9px] font-bold text-blue-600">+ {item.deltaCalidad}% hoy</div>}
                                                    </div>
                                                    <div className="space-y-2">
                                                        <div className="flex justify-between items-center">
                                                            <label className="text-[10px] font-black text-indigo-800 uppercase">Remisión</label>
                                                            <div className="flex items-center bg-white border-2 border-indigo-100 rounded-lg px-2">
                                                                <input type="number" min="0" max="100" value={item.remisionPorcentaje || 0} onChange={e => handleProcessChange(item.id, 'remisionPorcentaje', Number(e.target.value))} className="w-12 text-[12px] font-black p-1 bg-transparent border-none text-right focus:ring-0" />
                                                                <span className="text-[11px] font-black text-indigo-800">%</span>
                                                            </div>
                                                        </div>
                                                        <div className="w-full bg-indigo-200 h-2 rounded-full overflow-hidden shadow-inner">
                                                            <div className="h-full bg-indigo-600 transition-all duration-500" style={{ width: `${Math.min(100, item.remisionPorcentaje || 0)}%` }}></div>
                                                        </div>
                                                        {item.deltaRemision !== undefined && <div className="text-[9px] font-bold text-indigo-600">+ {item.deltaRemision}% hoy</div>}
                                                    </div>
                                                </>
                                            ) : (
                                                <>
                                                    <div className="space-y-2">
                                                        <div className="flex justify-between items-center">
                                                            <label className="text-[10px] font-black text-green-800 uppercase">Conteo</label>
                                                            <div className="flex items-center bg-white border-2 border-green-100 rounded-lg px-2">
                                                                <input type="number" min="0" max="100" value={item.conteoPorcentaje || 0} onChange={e => handleProcessChange(item.id, 'conteoPorcentaje', Number(e.target.value))} className="w-12 text-[12px] font-black p-1 bg-transparent border-none text-right focus:ring-0" />
                                                                <span className="text-[11px] font-black text-green-800">%</span>
                                                            </div>
                                                        </div>
                                                        <div className="w-full bg-green-200 h-2 rounded-full overflow-hidden shadow-inner">
                                                            <div className="h-full bg-green-600 transition-all duration-500" style={{ width: `${Math.min(100, item.conteoPorcentaje || 0)}%` }}></div>
                                                        </div>
                                                        {item.deltaConteo !== undefined && <div className="text-[9px] font-bold text-green-600">+ {item.deltaConteo}% hoy</div>}
                                                    </div>
                                                    <div className="space-y-2">
                                                        <div className="flex justify-between items-center">
                                                            <label className="text-[10px] font-black text-purple-800 uppercase">Etiquetado</label>
                                                            <div className="flex items-center bg-white border-2 border-purple-100 rounded-lg px-2">
                                                                <input type="number" min="0" max="100" value={item.etiquetadoPorcentaje || 0} onChange={e => handleProcessChange(item.id, 'etiquetadoPorcentaje', Number(e.target.value))} className="w-12 text-[12px] font-black p-1 bg-transparent border-none text-right focus:ring-0" />
                                                                <span className="text-[11px] font-black text-purple-800">%</span>
                                                            </div>
                                                        </div>
                                                        <div className="w-full bg-purple-200 h-2 rounded-full overflow-hidden shadow-inner">
                                                            <div className="h-full bg-purple-600 transition-all duration-500" style={{ width: `${Math.min(100, item.etiquetadoPorcentaje || 0)}%` }}></div>
                                                        </div>
                                                        {item.deltaEtiquetado !== undefined && <div className="text-[9px] font-bold text-purple-600">+ {item.deltaEtiquetado}% hoy</div>}
                                                    </div>
                                                </>
                                            )}
                                        </div>

                                        <div>
                                            <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Observaciones</label>
                                            <textarea rows={2} value={item.procesoObservacion} onChange={(e) => handleProcessChange(item.id, 'procesoObservacion', e.target.value)} className="w-full text-xs p-3 border-2 border-slate-100 rounded-xl bg-slate-50 resize-none focus:ring-2 focus:ring-blue-500 font-medium" placeholder="Notas del estado..." />
                                        </div>

                                        <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-4">
                                            <div className="bg-slate-50 p-2.5 rounded-xl text-center border border-slate-100">
                                                <span className="block text-[9px] text-gray-500 font-black uppercase mb-1">Pedida</span>
                                                <input type="number" value={item.totalQuantity} onChange={e => handleProcessChange(item.id, 'totalQuantity', Number(e.target.value))} className="w-full bg-transparent font-black text-sm p-0 border-none text-center focus:ring-0" />
                                            </div>
                                            <div className="bg-slate-50 p-2.5 rounded-xl text-center border border-slate-100">
                                                <span className="block text-[9px] text-gray-500 font-black uppercase mb-1">Empacada</span>
                                                <input type="number" value={item.totalPacked} onChange={e => handleProcessChange(item.id, 'totalPacked', Number(e.target.value))} className="w-full bg-transparent font-black text-sm p-0 border-none text-center focus:ring-0" />
                                                {item.deltaPacked !== undefined && <span className="text-[8px] font-bold text-blue-600 block mt-1">+{item.deltaPacked} hoy</span>}
                                            </div>
                                        </div>

                                        <div className="pt-2">
                                            <div className="flex justify-between text-[11px] font-black text-gray-800 mb-2">
                                                <span className="tracking-tighter uppercase">Avance Total Unidades</span>
                                                <span className={`${item.packedPercentage >= 100 ? 'text-green-600' : 'text-blue-600'}`}>
                                                    {Math.round(item.packedPercentage)}%
                                                </span>
                                            </div>
                                            <div className="w-full bg-gray-200 h-4 rounded-full overflow-hidden shadow-inner p-1">
                                                <div className={`h-full rounded-full transition-all duration-1000 ${item.packedPercentage >= 100 ? 'bg-green-500' : (isOverdue ? 'bg-red-500' : 'bg-blue-500')}`} style={{ width: `${Math.min(100, item.packedPercentage)}%` }}></div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </section>
            )}

            {/* Mercancía Pendiente */}
            <section className="bg-white rounded-lg shadow-lg p-6 border-t-4 border-orange-500">
                <div className="flex items-center justify-between mb-4 border-b pb-3">
                    <div className="flex items-center">
                        <PackageIcon className="h-6 w-6 text-orange-600 mr-2" />
                        <h2 className="text-xl font-bold text-gray-800">Próximos Ingresos</h2>
                    </div>
                    <button onClick={handleAddManualPending} className="flex items-center px-4 py-2 bg-orange-500 text-white rounded-xl text-sm font-black hover:bg-orange-600 shadow-lg transition-all active:scale-95">
                        <PlusCircleIcon className="h-5 w-5 mr-2" /> + Añadir Ingreso Manual
                    </button>
                </div>

                {pendingGoods.length > 0 ? (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 border rounded-2xl overflow-hidden shadow-sm">
                            <thead className="bg-slate-50">
                                <tr>
                                    <th className="px-6 py-4 text-left text-xs font-black text-gray-500 uppercase tracking-widest">Marca</th>
                                    <th className="px-6 py-4 text-left text-xs font-black text-gray-500 uppercase tracking-widest">Cantidad</th>
                                    <th className="px-6 py-4 text-left text-xs font-black text-gray-500 uppercase tracking-widest">Fecha Est. Entrada</th>
                                    <th className="px-6 py-4 text-center text-xs font-black text-gray-500 uppercase tracking-widest">Borrar</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 bg-white">
                                {pendingGoods.map(p => (
                                    <tr key={p.id} className="hover:bg-orange-50/50 transition-colors">
                                        <td className="px-6 py-3"><input type="text" value={p.marca} onChange={e => setPendingGoods(prev => prev.map(x => x.id === p.id ? {...x, marca: e.target.value} : x))} className="w-full text-sm font-bold border-gray-200 rounded-lg focus:ring-orange-500" /></td>
                                        <td className="px-6 py-3"><input type="number" value={p.cantidadEntrada} onChange={e => setPendingGoods(prev => prev.map(x => x.id === p.id ? {...x, cantidadEntrada: Number(e.target.value)} : x))} className="w-32 text-sm font-black border-gray-200 rounded-lg focus:ring-orange-500" /></td>
                                        <td className="px-6 py-3"><input type="date" value={p.fechaEntradaAprox} onChange={e => setPendingGoods(prev => prev.map(x => x.id === p.id ? {...x, fechaEntradaAprox: e.target.value} : x))} className="text-sm font-bold border-gray-200 rounded-lg focus:ring-orange-500" /></td>
                                        <td className="px-6 py-3 text-center">
                                            <button onMouseDown={(e) => { e.preventDefault(); setPendingGoods(prev => prev.filter(x => x.id !== p.id)); }} className="text-red-400 hover:text-red-600 p-2 rounded-full hover:bg-red-50 transition-all">
                                                <Trash2Icon className="h-5 w-5" />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="py-12 text-center text-gray-400 italic text-sm border-2 border-dashed border-gray-200 rounded-2xl bg-slate-50">
                        No hay ingresos pendientes registrados.
                    </div>
                )}
            </section>
        </div>
    );
};

export default WarehouseProcessesModule;

'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { ArrowLeft, ClipboardList, FileDown, FileSearch, Loader2, RefreshCw, Trash2, Upload } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth-context';
import type { CyclicInventoryCountRecord, CyclicInventoryDayMeta, CyclicInventoryLine } from '@/types';
import { findCaseInsensitiveKey, parseRobustNumber } from '@/lib/parsingUtils';
import { getCyclicCountDiff } from '@/lib/cyclicInventoryDiff';
import { isValidInventoryDateKey } from '@/lib/cyclicInventoryDate';
import {
  createInventoryAdjustment,
  deleteInventoryAdjustment,
  getCyclicInventoryLinesForDate,
  importCyclicInventoryForDate,
  listInventoryAdjustmentsForDate,
  listCyclicInventoryCountRecordsForReport,
  listCyclicInventoryDayMeta,
  saveCyclicInventoryLineCount,
} from '@/app/cyclicInventoryActions';

type InventoryLineView = CyclicInventoryLine & {
  expectedQtyBase?: number;
  expectedQtyDelta?: number;
};

type InventoryAdjustmentRecord = {
  id: string;
  inventoryDate: string;
  reference: string;
  size?: string;
  location: string;
  deltaQty: number;
  reason?: string;
  createdAt: string | Date;
  createdBy: string;
  createdByName?: string;
};

type DiffPriority = 'critico' | 'alto' | 'medio' | 'bajo' | 'sin_conteo';
type DiffStatus = 'faltante' | 'sobrante' | 'cuadrado' | 'sin_conteo';

type InventoryDiffRow = {
  reference: string;
  location: string;
  expectedAdjusted: number;
  expectedBase: number;
  adjustmentDelta: number;
  countedQty: number | null;
  diffQty: number;
  diffPct: number;
  status: DiffStatus;
  priority: DiffPriority;
  recountSuggested: boolean;
  lastCountedAt?: string | Date | null;
};

type LocationRecountRecommendation = {
  location: string;
  linesWithDiff: number;
  linesWithoutCount: number;
  totalAbsDiff: number;
  weightedScore: number;
  topPriority: DiffPriority;
};

function classifyDiffPriority(row: {
  countedQty: number | null;
  expectedAdjusted: number;
  diffQty: number;
  diffPct: number;
}): DiffPriority {
  if (row.countedQty === null || row.countedQty === undefined) return 'sin_conteo';
  const absDiff = Math.abs(row.diffQty);
  const absPct = Math.abs(row.diffPct);
  if (absDiff >= 20 || absPct >= 0.18) return 'critico';
  if (absDiff >= 10 || absPct >= 0.1) return 'alto';
  if (absDiff >= 4 || absPct >= 0.05) return 'medio';
  if (absDiff > 0) return 'bajo';
  return 'bajo';
}

function priorityWeight(priority: DiffPriority): number {
  switch (priority) {
    case 'critico':
      return 100;
    case 'alto':
      return 50;
    case 'medio':
      return 20;
    case 'sin_conteo':
      return 15;
    default:
      return 5;
  }
}

function priorityLabel(priority: DiffPriority): string {
  switch (priority) {
    case 'critico':
      return 'Crítico';
    case 'alto':
      return 'Alto';
    case 'medio':
      return 'Medio';
    case 'sin_conteo':
      return 'Sin conteo';
    default:
      return 'Bajo';
  }
}

function ymdDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayYmdLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatCountedAt(value: string | Date | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
}

function readCell(row: Record<string, unknown>, ...aliases: string[]): string {
  const key = findCaseInsensitiveKey(row, ...aliases);
  if (!key) return '';
  return String(row[key] ?? '').trim();
}

function parseImportRows(raw: unknown[]): { reference: string; size: string; location: string; expectedQty: number }[] {
  const out: { reference: string; size: string; location: string; expectedQty: number }[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const reference = readCell(r, 'referencia', 'ref', 'reference', 'codigo_referencia');
    const size = readCell(r, 'talla', 'size', 'detalle', 'detalle_ext');
    const location = readCell(r, 'ubicacion', 'location', 'loc', 'ubicación');
    const qtyKey =
      findCaseInsensitiveKey(r, 'cantidad_esperada', 'esperada', 'qty', 'cantidad', 'stock', 'inventario', 'existencia') ||
      findCaseInsensitiveKey(r, 'cant');
    const qtyRaw = qtyKey ? r[qtyKey] : undefined;
    const expectedQty = Number.isFinite(Number(qtyRaw))
      ? Number(qtyRaw)
      : parseRobustNumber(String(qtyRaw ?? ''));
    if (!reference) continue;
    out.push({
      reference,
      size,
      location,
      expectedQty: Number.isFinite(expectedQty) && !Number.isNaN(expectedQty) ? Math.max(0, Math.floor(expectedQty)) : 0,
    });
  }
  return out;
}

export const CyclicInventoryModule: React.FC<{ onReturnToSuite: () => void }> = ({ onReturnToSuite }) => {
  const { user, role } = useAuth();
  const { toast } = useToast();
  const [inventoryDate, setInventoryDate] = useState(() => todayYmdLocal());
  const [recentDays, setRecentDays] = useState<CyclicInventoryDayMeta[]>([]);
  const [loadingDays, setLoadingDays] = useState(false);
  const [lines, setLines] = useState<InventoryLineView[]>([]);
  const [loadingLines, setLoadingLines] = useState(false);
  const [filterRef, setFilterRef] = useState('');
  const [filterLoc, setFilterLoc] = useState('');
  const [onlyPending, setOnlyPending] = useState(false);
  const [importing, setImporting] = useState(false);

  const [reportDateFrom, setReportDateFrom] = useState(() => ymdDaysAgo(30));
  const [reportDateTo, setReportDateTo] = useState(() => todayYmdLocal());
  const [reportFilterRef, setReportFilterRef] = useState('');
  const [reportFilterLoc, setReportFilterLoc] = useState('');
  const [reportRows, setReportRows] = useState<CyclicInventoryCountRecord[]>([]);
  const [loadingReport, setLoadingReport] = useState(false);
  const [adjustments, setAdjustments] = useState<InventoryAdjustmentRecord[]>([]);
  const [loadingAdjustments, setLoadingAdjustments] = useState(false);
  const [savingAdjustment, setSavingAdjustment] = useState(false);
  const [adjReference, setAdjReference] = useState('');
  const [adjSize, setAdjSize] = useState('');
  const [adjLocation, setAdjLocation] = useState('');
  const [adjDiscountQty, setAdjDiscountQty] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [diffFilterRef, setDiffFilterRef] = useState('');
  const [diffFilterLoc, setDiffFilterLoc] = useState('');
  const [diffOnlySuggested, setDiffOnlySuggested] = useState(true);
  const [diffHideSquare, setDiffHideSquare] = useState(true);

  const canAdmin = role === 'admin' || role === 'supervisor';

  const loadRecentDays = useCallback(async () => {
    setLoadingDays(true);
    try {
      const res = await listCyclicInventoryDayMeta(60);
      if (!res.success || !res.data) {
        throw new Error(res.error || 'No se pudieron cargar los días recientes.');
      }
      setRecentDays(res.data);
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'Días recientes',
        description: e instanceof Error ? e.message : 'Error desconocido',
      });
    } finally {
      setLoadingDays(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadRecentDays();
  }, [loadRecentDays]);

  const loadLines = useCallback(async () => {
    const dateKey = inventoryDate.trim();
    if (!isValidInventoryDateKey(dateKey)) {
      setLines([]);
      return;
    }
    setLoadingLines(true);
    try {
      const res = await getCyclicInventoryLinesForDate(dateKey);
      if (!res.success || !res.data) {
        throw new Error(res.error || 'No se pudieron cargar las líneas.');
      }
      setLines(res.data as InventoryLineView[]);
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: e instanceof Error ? e.message : 'Error desconocido',
      });
      setLines([]);
    } finally {
      setLoadingLines(false);
    }
  }, [inventoryDate, toast]);

  useEffect(() => {
    void loadLines();
  }, [loadLines]);

  const loadAdjustments = useCallback(async () => {
    const dateKey = inventoryDate.trim();
    if (!isValidInventoryDateKey(dateKey)) {
      setAdjustments([]);
      return;
    }
    setLoadingAdjustments(true);
    try {
      const res = await listInventoryAdjustmentsForDate({ inventoryDate: dateKey, maxRecords: 500 });
      if (!res.success || !res.data) {
        throw new Error(res.error || 'No se pudieron cargar los ajustes.');
      }
      setAdjustments(res.data);
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'Ajustes',
        description: e instanceof Error ? e.message : 'Error desconocido',
      });
      setAdjustments([]);
    } finally {
      setLoadingAdjustments(false);
    }
  }, [inventoryDate, toast]);

  useEffect(() => {
    if (!canAdmin) return;
    void loadAdjustments();
  }, [canAdmin, loadAdjustments]);

  const loadReport = useCallback(async () => {
    setLoadingReport(true);
    try {
      const res = await listCyclicInventoryCountRecordsForReport({
        dateFrom: reportDateFrom.trim(),
        dateTo: reportDateTo.trim(),
        referenceContains: reportFilterRef.trim() || undefined,
        locationContains: reportFilterLoc.trim() || undefined,
        maxRecords: 1200,
      });
      if (!res.success || !res.data) {
        throw new Error(res.error || 'No se pudo cargar el reporte.');
      }
      setReportRows(res.data);
      if (res.data.length === 0) {
        toast({ title: 'Reporte', description: 'No hay registros con ese criterio.' });
      }
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'Reporte',
        description: e instanceof Error ? e.message : 'Error',
      });
      setReportRows([]);
    } finally {
      setLoadingReport(false);
    }
  }, [reportDateFrom, reportDateTo, reportFilterRef, reportFilterLoc, toast]);

  const filteredLines = useMemo(() => {
    const fr = filterRef.trim().toUpperCase();
    const fl = filterLoc.trim().toUpperCase();
    return lines.filter((l) => {
      if (fr && !l.reference.includes(fr)) return false;
      if (fl && !(l.location || '').toUpperCase().includes(fl)) return false;
      if (onlyPending && l.countedQty !== null && l.countedQty !== undefined) return false;
      return true;
    });
  }, [lines, filterRef, filterLoc, onlyPending]);

  const allDiffRows = useMemo<InventoryDiffRow[]>(() => {
    return lines.map((line) => {
      const expectedAdjusted = Math.max(0, Math.floor(Number(line.expectedQty) || 0));
      const expectedBase = Math.max(0, Math.floor(Number(line.expectedQtyBase ?? line.expectedQty) || 0));
      const adjustmentDelta = Math.trunc(Number(line.expectedQtyDelta) || 0);
      const countedQty = line.countedQty ?? null;
      const diffQty = countedQty === null ? 0 : countedQty - expectedAdjusted;
      const diffPct = expectedAdjusted > 0 ? diffQty / expectedAdjusted : countedQty === null ? 0 : countedQty > 0 ? 1 : 0;
      const status: DiffStatus =
        countedQty === null ? 'sin_conteo' : diffQty === 0 ? 'cuadrado' : diffQty < 0 ? 'faltante' : 'sobrante';
      const priority = classifyDiffPriority({ countedQty, expectedAdjusted, diffQty, diffPct });
      const recountSuggested = status !== 'cuadrado';
      return {
        reference: line.reference,
        location: line.location || '',
        expectedAdjusted,
        expectedBase,
        adjustmentDelta,
        countedQty,
        diffQty,
        diffPct,
        status,
        priority,
        recountSuggested,
        lastCountedAt: line.countedAt,
      };
    });
  }, [lines]);

  const filteredDiffRows = useMemo(() => {
    const ref = diffFilterRef.trim().toUpperCase();
    const loc = diffFilterLoc.trim().toUpperCase();
    return allDiffRows
      .filter((row) => {
        if (ref && !row.reference.includes(ref)) return false;
        if (loc && !row.location.toUpperCase().includes(loc)) return false;
        if (diffOnlySuggested && !row.recountSuggested) return false;
        if (diffHideSquare && row.status === 'cuadrado') return false;
        return true;
      })
      .sort((a, b) => {
        const byPriority = priorityWeight(b.priority) - priorityWeight(a.priority);
        if (byPriority !== 0) return byPriority;
        const byAbsDiff = Math.abs(b.diffQty) - Math.abs(a.diffQty);
        if (byAbsDiff !== 0) return byAbsDiff;
        return `${a.reference}|${a.location}`.localeCompare(`${b.reference}|${b.location}`);
      });
  }, [allDiffRows, diffFilterRef, diffFilterLoc, diffOnlySuggested, diffHideSquare]);

  const locationRecommendations = useMemo<LocationRecountRecommendation[]>(() => {
    const byLoc = new Map<string, LocationRecountRecommendation>();
    for (const row of filteredDiffRows) {
      const key = row.location || 'SIN UBICACION';
      const existing = byLoc.get(key) ?? {
        location: key,
        linesWithDiff: 0,
        linesWithoutCount: 0,
        totalAbsDiff: 0,
        weightedScore: 0,
        topPriority: 'bajo' as DiffPriority,
      };
      if (row.status !== 'cuadrado' && row.countedQty !== null) {
        existing.linesWithDiff += 1;
      }
      if (row.countedQty === null) {
        existing.linesWithoutCount += 1;
      }
      existing.totalAbsDiff += Math.abs(row.diffQty);
      const pWeight = priorityWeight(row.priority);
      existing.weightedScore += pWeight + Math.abs(row.diffQty);
      if (pWeight > priorityWeight(existing.topPriority)) {
        existing.topPriority = row.priority;
      }
      byLoc.set(key, existing);
    }
    return [...byLoc.values()].sort((a, b) => {
      if (b.weightedScore !== a.weightedScore) return b.weightedScore - a.weightedScore;
      return b.totalAbsDiff - a.totalAbsDiff;
    });
  }, [filteredDiffRows]);

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!user?.uid) {
      toast({ variant: 'destructive', title: 'Sesión', description: 'Inicie sesión.' });
      return;
    }
    const dateKey = inventoryDate.trim();
    if (!isValidInventoryDateKey(dateKey)) {
      toast({ variant: 'destructive', title: 'Fecha', description: 'Seleccione una fecha válida (AAAA-MM-DD).' });
      return;
    }
    const file = e.target.files?.[0];
    if (!file) return;

    const hasLines = lines.length > 0;
    if (
      hasLines &&
      !confirm(
        '¿Actualizar el inventario esperado de esta fecha? Las cantidades esperadas vendrán del nuevo Excel (filas del mismo Excel con la misma referencia y ubicación se suman). Los conteos ya registrados no se borran: quedan en el historial y se vuelven a aplicar por referencia y ubicación.'
      )
    ) {
      if (e.target) e.target.value = '';
      return;
    }

    setImporting(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet) as unknown[];
      const rows = parseImportRows(json);
      if (rows.length === 0) {
        throw new Error(
          'No se encontraron filas válidas. Use columnas: Referencia, Ubicación, Cantidad esperada (Talla es opcional y se agrupa sumando cantidades por ref + ubicación).'
        );
      }
      const res = await importCyclicInventoryForDate({
        inventoryDate: dateKey,
        lines: rows,
        uploadedBy: user.uid,
        uploadedByName: user.displayName || user.email || '',
        fileName: file.name,
      });
      if (!res.success) {
        throw new Error(res.error || 'Error al importar.');
      }
      toast({ title: 'Inventario del día cargado', description: `Se importaron ${res.imported ?? 0} líneas para ${dateKey}.` });
      await loadLines();
      await loadRecentDays();
    } catch (err: unknown) {
      toast({
        variant: 'destructive',
        title: 'Importación',
        description: err instanceof Error ? err.message : 'Error',
      });
    } finally {
      setImporting(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleSaveCount = async (line: CyclicInventoryLine, raw: string) => {
    if (!user?.uid) return;
    const n = Math.floor(Number(String(raw).replace(',', '.')));
    if (Number.isNaN(n) || n < 0) {
      toast({ variant: 'destructive', title: 'Cantidad', description: 'Ingrese un número entero ≥ 0.' });
      return;
    }
    const res = await saveCyclicInventoryLineCount({
      lineIds: line.consolidatedLineIds ?? [line.id],
      countedQty: n,
      countedBy: user.uid,
      countedByName: user.displayName || user.email || '',
    });
    if (!res.success) {
      toast({ variant: 'destructive', title: 'Guardar', description: res.error || 'Error' });
      return;
    }
    await loadLines();
  };

  const handleCreateAdjustment = async () => {
    if (!canAdmin) return;
    if (!user?.uid) {
      toast({ variant: 'destructive', title: 'Sesión', description: 'Inicie sesión.' });
      return;
    }
    const dateKey = inventoryDate.trim();
    if (!isValidInventoryDateKey(dateKey)) {
      toast({ variant: 'destructive', title: 'Fecha', description: 'Seleccione una fecha válida (AAAA-MM-DD).' });
      return;
    }
    const n = Math.floor(Number(adjDiscountQty));
    if (!Number.isFinite(n) || n <= 0) {
      toast({ variant: 'destructive', title: 'Cantidad', description: 'Ingrese unidades a descontar (> 0).' });
      return;
    }
    setSavingAdjustment(true);
    try {
      const res = await createInventoryAdjustment({
        inventoryDate: dateKey,
        reference: adjReference,
        size: adjSize,
        location: adjLocation,
        discountQty: n,
        reason: adjReason,
        createdBy: user.uid,
        createdByName: user.displayName || user.email || '',
      });
      if (!res.success) {
        throw new Error(res.error || 'No se pudo crear el ajuste.');
      }
      toast({ title: 'Ajuste registrado', description: `Se descontaron ${n} unidades de la expectativa del día.` });
      setAdjDiscountQty('');
      setAdjReason('');
      await loadAdjustments();
      await loadLines();
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'Ajustes',
        description: e instanceof Error ? e.message : 'Error',
      });
    } finally {
      setSavingAdjustment(false);
    }
  };

  const handleDeleteAdjustment = async (adjustmentId: string) => {
    if (!canAdmin) return;
    if (!confirm('¿Eliminar este ajuste? Esto recalculará la expectativa ajustada del día.')) return;
    const res = await deleteInventoryAdjustment({ adjustmentId });
    if (!res.success) {
      toast({ variant: 'destructive', title: 'Ajustes', description: res.error || 'No se pudo eliminar.' });
      return;
    }
    toast({ title: 'Ajuste eliminado', description: 'Se recalculó la expectativa ajustada.' });
    await loadAdjustments();
    await loadLines();
  };

  const handleDownloadDiffReport = () => {
    if (filteredDiffRows.length === 0) {
      toast({ title: 'Reporte de diferencias', description: 'No hay filas para exportar con los filtros actuales.' });
      return;
    }
    const detailRows = filteredDiffRows.map((row) => ({
      Fecha: inventoryDate,
      Referencia: row.reference,
      Ubicacion: row.location || 'SIN UBICACION',
      EsperadaBase: row.expectedBase,
      Ajuste: row.adjustmentDelta,
      EsperadaAjustada: row.expectedAdjusted,
      ConteoFisico: row.countedQty ?? '',
      Diferencia: row.diffQty,
      DiferenciaPct: `${(row.diffPct * 100).toFixed(2)}%`,
      Estado: row.status,
      PrioridadReconteo: priorityLabel(row.priority),
      RecomendarReconteo: row.recountSuggested ? 'SI' : 'NO',
      UltimoConteo: formatCountedAt(row.lastCountedAt),
    }));
    const locationRows = locationRecommendations.map((loc, idx) => ({
      Ranking: idx + 1,
      Ubicacion: loc.location,
      PrioridadMaxima: priorityLabel(loc.topPriority),
      LineasConDiferencia: loc.linesWithDiff,
      LineasSinConteo: loc.linesWithoutCount,
      DiferenciaAbsolutaTotal: loc.totalAbsDiff,
      PuntajeReconteo: loc.weightedScore,
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailRows), 'Diferencias');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(locationRows), 'ReconteoPorUbicacion');
    XLSX.writeFile(wb, `reconteo_recomendado_${inventoryDate}.xlsx`);
  };

  const diffBadge = (line: CyclicInventoryLine) => {
    const { status, label } = getCyclicCountDiff(line.expectedQty, line.countedQty);
    const variant =
      status === 'cuadrado'
        ? 'success'
        : status === 'pending'
          ? 'secondary'
          : status === 'faltante'
            ? 'destructive'
            : 'warning';
    return (
      <Badge variant={variant} className="whitespace-nowrap">
        {label}
      </Badge>
    );
  };

  return (
    <div className="container max-w-6xl mx-auto p-4 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <ClipboardList className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Inventario cíclico</h1>
            <p className="text-sm text-muted-foreground">
              Cada día se sube el inventario esperado (Excel). El operario elige la fecha; la vista de conteo es por referencia y
              ubicación (v1 sin talla). Cada guardado queda en historial inmutable para auditoría.
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={onReturnToSuite}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Volver a la suite
        </Button>
      </div>

      <Tabs defaultValue="conteo" className="w-full">
        <TabsList>
          <TabsTrigger value="conteo">Conteo</TabsTrigger>
          <TabsTrigger value="reporte">
            <FileSearch className="mr-2 h-4 w-4 inline" />
            Reporte de conteos
          </TabsTrigger>
          <TabsTrigger value="diferencias">Diferencias y reconteo</TabsTrigger>
          {canAdmin ? <TabsTrigger value="ajustes">Ajustes de inventario</TabsTrigger> : null}
          {canAdmin ? <TabsTrigger value="subir">Subir inventario del día</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="conteo" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Ejecutar conteo</CardTitle>
              <CardDescription>
                Elija la fecha del inventario que está contando (la misma del archivo cargado ese día). La grilla está consolidada
                por <strong>referencia y ubicación</strong> (cantidad esperada sumada). Filtre e ingrese la cantidad física total
                de esa combinación.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-4 items-end">
                <div className="space-y-2">
                  <Label htmlFor="inv-date-conteo">Fecha del inventario</Label>
                  <Input
                    id="inv-date-conteo"
                    type="date"
                    value={inventoryDate}
                    onChange={(e) => setInventoryDate(e.target.value)}
                    className="w-44"
                  />
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => void loadLines()} disabled={loadingLines}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${loadingLines ? 'animate-spin' : ''}`} />
                  Recargar líneas
                </Button>
              </div>

              {recentDays.length > 0 ? (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Días con carga reciente</Label>
                  <div className="flex flex-wrap gap-2">
                    {recentDays.slice(0, 12).map((d) => (
                      <Button
                        key={d.id}
                        type="button"
                        variant={d.id === inventoryDate ? 'default' : 'outline'}
                        size="sm"
                        className="h-8 font-mono text-xs"
                        onClick={() => setInventoryDate(d.id)}
                      >
                        {d.id}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : loadingDays ? (
                <p className="text-xs text-muted-foreground">Cargando días recientes…</p>
              ) : null}

              <div className="flex flex-wrap gap-3 items-end">
                <div className="space-y-2">
                  <Label>Filtrar referencia</Label>
                  <Input value={filterRef} onChange={(e) => setFilterRef(e.target.value)} placeholder="REF…" className="w-40" />
                </div>
                <div className="space-y-2">
                  <Label>Filtrar ubicación</Label>
                  <Input value={filterLoc} onChange={(e) => setFilterLoc(e.target.value)} placeholder="Ubicación…" className="w-40" />
                </div>
                <div className="flex items-center space-x-2 pb-2">
                  <Checkbox id="pend" checked={onlyPending} onCheckedChange={(c) => setOnlyPending(!!c)} />
                  <Label htmlFor="pend" className="font-normal cursor-pointer">
                    Solo pendientes
                  </Label>
                </div>
              </div>

              {loadingLines ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="rounded-md border overflow-x-auto max-h-[60vh] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Referencia</TableHead>
                        <TableHead className="text-right">Esperada</TableHead>
                        <TableHead>Ubicación</TableHead>
                        <TableHead className="w-36">Físico</TableHead>
                        <TableHead className="whitespace-nowrap min-w-[120px]">Guardado</TableHead>
                        <TableHead>Resultado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredLines.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                            No hay líneas para esta fecha o ninguna coincide con el filtro. Pida a un supervisor que suba el Excel
                            del día.
                          </TableCell>
                        </TableRow>
                      ) : (
                        filteredLines.map((line) => (
                          <TableRow key={`${line.reference}|${line.location}`}>
                            <TableCell className="font-mono text-sm">{line.reference}</TableCell>
                            <TableCell className="text-right font-medium">
                              <div>{line.expectedQty}</div>
                              {(line.expectedQtyDelta ?? 0) !== 0 ? (
                                <div className="text-[11px] text-muted-foreground">
                                  base {line.expectedQtyBase ?? line.expectedQty} / ajuste {line.expectedQtyDelta}
                                </div>
                              ) : null}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">{line.location || '—'}</TableCell>
                            <TableCell>
                              <CountInput line={line} onSave={(v) => void handleSaveCount(line, v)} />
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {formatCountedAt(line.countedAt)}
                            </TableCell>
                            <TableCell>{diffBadge(line)}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="diferencias" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Diferencias y reconteo recomendado</CardTitle>
              <CardDescription>
                Prioriza reconteo por discrepancia contra <strong>esperada ajustada</strong> y agrupa ubicaciones críticas para
                revalidación en piso.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-3 items-end">
                <div className="space-y-2">
                  <Label>Fecha inventario</Label>
                  <Input type="date" value={inventoryDate} onChange={(e) => setInventoryDate(e.target.value)} className="w-44" />
                </div>
                <div className="space-y-2">
                  <Label>Filtrar referencia</Label>
                  <Input value={diffFilterRef} onChange={(e) => setDiffFilterRef(e.target.value)} placeholder="REF..." className="w-40" />
                </div>
                <div className="space-y-2">
                  <Label>Filtrar ubicación</Label>
                  <Input value={diffFilterLoc} onChange={(e) => setDiffFilterLoc(e.target.value)} placeholder="Ubicación..." className="w-40" />
                </div>
                <div className="flex items-center space-x-2 pb-2">
                  <Checkbox id="diff-suggested" checked={diffOnlySuggested} onCheckedChange={(c) => setDiffOnlySuggested(!!c)} />
                  <Label htmlFor="diff-suggested" className="font-normal cursor-pointer">
                    Solo sugeridas a reconteo
                  </Label>
                </div>
                <div className="flex items-center space-x-2 pb-2">
                  <Checkbox id="diff-hide-square" checked={diffHideSquare} onCheckedChange={(c) => setDiffHideSquare(!!c)} />
                  <Label htmlFor="diff-hide-square" className="font-normal cursor-pointer">
                    Ocultar cuadrados
                  </Label>
                </div>
                <Button type="button" variant="outline" onClick={() => void loadLines()} disabled={loadingLines}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${loadingLines ? 'animate-spin' : ''}`} />
                  Recalcular
                </Button>
                <Button type="button" onClick={handleDownloadDiffReport}>
                  <FileDown className="mr-2 h-4 w-4" />
                  Descargar Excel
                </Button>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Líneas evaluadas</p>
                  <p className="text-2xl font-semibold">{filteredDiffRows.length}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Ubicaciones recomendadas a reconteo</p>
                  <p className="text-2xl font-semibold">{locationRecommendations.length}</p>
                </div>
              </div>

              <div className="rounded-md border overflow-x-auto max-h-[32vh] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right w-16">#</TableHead>
                      <TableHead>Ubicación</TableHead>
                      <TableHead>Prioridad máxima</TableHead>
                      <TableHead className="text-right">Líneas con diferencia</TableHead>
                      <TableHead className="text-right">Sin conteo</TableHead>
                      <TableHead className="text-right">Abs total</TableHead>
                      <TableHead className="text-right">Puntaje</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {locationRecommendations.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                          No hay ubicaciones priorizadas con los filtros actuales.
                        </TableCell>
                      </TableRow>
                    ) : (
                      locationRecommendations.map((loc, idx) => (
                        <TableRow key={`${loc.location}-${idx}`}>
                          <TableCell className="text-right font-mono text-xs">{idx + 1}</TableCell>
                          <TableCell className="font-mono text-sm">{loc.location}</TableCell>
                          <TableCell>
                            <Badge variant={loc.topPriority === 'critico' ? 'destructive' : loc.topPriority === 'alto' ? 'warning' : 'secondary'}>
                              {priorityLabel(loc.topPriority)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">{loc.linesWithDiff}</TableCell>
                          <TableCell className="text-right">{loc.linesWithoutCount}</TableCell>
                          <TableCell className="text-right">{loc.totalAbsDiff}</TableCell>
                          <TableCell className="text-right font-medium">{loc.weightedScore}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="rounded-md border overflow-x-auto max-h-[50vh] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Referencia</TableHead>
                      <TableHead>Ubicación</TableHead>
                      <TableHead className="text-right">Esperada base</TableHead>
                      <TableHead className="text-right">Ajuste</TableHead>
                      <TableHead className="text-right">Esperada ajustada</TableHead>
                      <TableHead className="text-right">Conteo</TableHead>
                      <TableHead className="text-right">Diferencia</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Prioridad</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredDiffRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                          No hay diferencias para el criterio actual.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredDiffRows.map((row) => (
                        <TableRow key={`${row.reference}|${row.location}`}>
                          <TableCell className="font-mono text-sm">{row.reference}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{row.location || '—'}</TableCell>
                          <TableCell className="text-right">{row.expectedBase}</TableCell>
                          <TableCell className={`text-right ${row.adjustmentDelta < 0 ? 'text-red-600' : row.adjustmentDelta > 0 ? 'text-emerald-600' : ''}`}>
                            {row.adjustmentDelta}
                          </TableCell>
                          <TableCell className="text-right font-medium">{row.expectedAdjusted}</TableCell>
                          <TableCell className="text-right">{row.countedQty ?? '—'}</TableCell>
                          <TableCell className={`text-right font-medium ${row.diffQty < 0 ? 'text-red-600' : row.diffQty > 0 ? 'text-amber-600' : ''}`}>
                            {row.countedQty === null ? '—' : row.diffQty}
                          </TableCell>
                          <TableCell>
                            <Badge variant={row.status === 'cuadrado' ? 'success' : row.status === 'sin_conteo' ? 'secondary' : row.status === 'faltante' ? 'destructive' : 'warning'}>
                              {row.status === 'sin_conteo' ? 'Sin conteo' : row.status === 'cuadrado' ? 'Cuadrado' : row.status === 'faltante' ? 'Faltante' : 'Sobrante'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={row.priority === 'critico' ? 'destructive' : row.priority === 'alto' ? 'warning' : 'secondary'}>
                              {priorityLabel(row.priority)}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {canAdmin ? (
          <TabsContent value="ajustes" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Descuentos manuales de inventario esperado</CardTitle>
                <CardDescription>
                  Registre descuentos para stock que ya salió pero todavía no impacta el esperado. Se aplican por referencia +
                  ubicación en la fecha seleccionada.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-3 items-end">
                  <div className="space-y-2">
                    <Label>Fecha del inventario</Label>
                    <Input type="date" value={inventoryDate} onChange={(e) => setInventoryDate(e.target.value)} className="w-44" />
                  </div>
                  <div className="space-y-2">
                    <Label>Referencia</Label>
                    <Input
                      value={adjReference}
                      onChange={(e) => setAdjReference(e.target.value.toUpperCase())}
                      placeholder="REF"
                      className="w-44"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Talla (opcional)</Label>
                    <Input value={adjSize} onChange={(e) => setAdjSize(e.target.value)} placeholder="Opcional" className="w-32" />
                  </div>
                  <div className="space-y-2">
                    <Label>Ubicación</Label>
                    <Input value={adjLocation} onChange={(e) => setAdjLocation(e.target.value)} placeholder="Ubicación" className="w-40" />
                  </div>
                  <div className="space-y-2">
                    <Label>Unidades a descontar</Label>
                    <Input
                      inputMode="numeric"
                      value={adjDiscountQty}
                      onChange={(e) => setAdjDiscountQty(e.target.value)}
                      placeholder="0"
                      className="w-32"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Motivo (opcional)</Label>
                    <Input value={adjReason} onChange={(e) => setAdjReason(e.target.value)} placeholder="Venta no descontada, etc." className="w-64" />
                  </div>
                  <Button type="button" onClick={() => void handleCreateAdjustment()} disabled={savingAdjustment}>
                    {savingAdjustment ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Registrar descuento
                  </Button>
                  <Button type="button" variant="outline" onClick={() => void loadAdjustments()} disabled={loadingAdjustments}>
                    <RefreshCw className={`mr-2 h-4 w-4 ${loadingAdjustments ? 'animate-spin' : ''}`} />
                    Recargar
                  </Button>
                </div>

                {loadingAdjustments ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="rounded-md border overflow-x-auto max-h-[50vh] overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Fecha</TableHead>
                          <TableHead>Referencia</TableHead>
                          <TableHead>Talla</TableHead>
                          <TableHead>Ubicación</TableHead>
                          <TableHead className="text-right">Delta</TableHead>
                          <TableHead>Motivo</TableHead>
                          <TableHead>Usuario</TableHead>
                          <TableHead>Creado</TableHead>
                          <TableHead className="text-right">Acción</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {adjustments.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                              No hay ajustes para esta fecha.
                            </TableCell>
                          </TableRow>
                        ) : (
                          adjustments.map((a) => (
                            <TableRow key={a.id}>
                              <TableCell className="font-mono text-xs">{a.inventoryDate}</TableCell>
                              <TableCell className="font-mono text-sm">{a.reference}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">{a.size || '—'}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">{a.location || '—'}</TableCell>
                              <TableCell className={`text-right font-medium ${a.deltaQty < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                                {a.deltaQty}
                              </TableCell>
                              <TableCell className="text-xs max-w-[260px] truncate" title={a.reason || ''}>
                                {a.reason || '—'}
                              </TableCell>
                              <TableCell className="text-xs max-w-[140px] truncate" title={a.createdByName || a.createdBy}>
                                {a.createdByName || a.createdBy || '—'}
                              </TableCell>
                              <TableCell className="text-xs whitespace-nowrap">{formatCountedAt(a.createdAt)}</TableCell>
                              <TableCell className="text-right">
                                <Button type="button" variant="ghost" size="sm" onClick={() => void handleDeleteAdjustment(a.id)}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        ) : null}

        <TabsContent value="reporte" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Reporte de conteos registrados</CardTitle>
              <CardDescription>
                Historial inmutable por cada guardado. Filtre por rango de fechas del inventario y, opcionalmente, por texto en
                referencia o ubicación (v1 sin talla en pantalla).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-4 items-end">
                <div className="space-y-2">
                  <Label htmlFor="rep-from">Fecha inventario desde</Label>
                  <Input
                    id="rep-from"
                    type="date"
                    value={reportDateFrom}
                    onChange={(e) => setReportDateFrom(e.target.value)}
                    className="w-44"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rep-to">Fecha inventario hasta</Label>
                  <Input
                    id="rep-to"
                    type="date"
                    value={reportDateTo}
                    onChange={(e) => setReportDateTo(e.target.value)}
                    className="w-44"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Referencia contiene</Label>
                  <Input
                    value={reportFilterRef}
                    onChange={(e) => setReportFilterRef(e.target.value)}
                    placeholder="Opcional"
                    className="w-40"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Ubicación contiene</Label>
                  <Input
                    value={reportFilterLoc}
                    onChange={(e) => setReportFilterLoc(e.target.value)}
                    placeholder="Opcional"
                    className="w-40"
                  />
                </div>
                <Button type="button" onClick={() => void loadReport()} disabled={loadingReport}>
                  {loadingReport ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSearch className="mr-2 h-4 w-4" />}
                  Buscar
                </Button>
              </div>

              {loadingReport ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="rounded-md border overflow-x-auto max-h-[60vh] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fecha inv.</TableHead>
                        <TableHead>Referencia</TableHead>
                        <TableHead>Ubicación</TableHead>
                        <TableHead className="text-right">Esperada (al guardar)</TableHead>
                        <TableHead className="text-right">Físico</TableHead>
                        <TableHead className="whitespace-nowrap">Registrado</TableHead>
                        <TableHead>Usuario</TableHead>
                        <TableHead>Vs esperada</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reportRows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                            Pulse Buscar para cargar registros (por defecto últimos 30 días).
                          </TableCell>
                        </TableRow>
                      ) : (
                        reportRows.map((r) => {
                          const { status, label } = getCyclicCountDiff(r.expectedQtyAtSave, r.countedQty);
                          const variant =
                            status === 'cuadrado'
                              ? 'success'
                              : status === 'pending'
                                ? 'secondary'
                                : status === 'faltante'
                                  ? 'destructive'
                                  : 'warning';
                          return (
                            <TableRow key={r.id}>
                              <TableCell className="font-mono text-xs whitespace-nowrap">{r.inventoryDate}</TableCell>
                              <TableCell className="font-mono text-sm">{r.reference}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">{r.location || '—'}</TableCell>
                              <TableCell className="text-right">{r.expectedQtyAtSave}</TableCell>
                              <TableCell className="text-right font-medium">{r.countedQty}</TableCell>
                              <TableCell className="text-xs whitespace-nowrap">{formatCountedAt(r.countedAt)}</TableCell>
                              <TableCell className="text-xs max-w-[140px] truncate" title={r.countedByName || r.countedBy}>
                                {r.countedByName || r.countedBy || '—'}
                              </TableCell>
                              <TableCell>
                                <Badge variant={variant} className="whitespace-nowrap">
                                  {label}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
              {reportRows.length > 0 ? (
                <p className="text-xs text-muted-foreground">Mostrando hasta {reportRows.length} registros (límite de consulta).</p>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        {canAdmin ? (
          <TabsContent value="subir" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Subir inventario del día</CardTitle>
                <CardDescription>
                  Indique la fecha a la que corresponde el archivo (normalmente hoy). El Excel reemplaza las líneas de inventario
                  esperado de esa fecha; las filas con la misma referencia y ubicación se consolidan sumando la cantidad esperada.
                  Los conteos registrados no se eliminan: se guardan en historial y se vuelven a aplicar por referencia y ubicación.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 max-w-xl">
                <div className="space-y-2">
                  <Label htmlFor="inv-date-upload">Fecha del inventario</Label>
                  <Input
                    id="inv-date-upload"
                    type="date"
                    value={inventoryDate}
                    onChange={(e) => setInventoryDate(e.target.value)}
                    className="w-44"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" asChild disabled={importing}>
                    <label className="cursor-pointer">
                      <Upload className="mr-2 h-4 w-4 inline" />
                      {importing ? 'Importando…' : 'Elegir archivo Excel'}
                      <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(ev) => void handleImportFile(ev)} />
                    </label>
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Columnas Excel: <strong>Referencia</strong>, <strong>Ubicación</strong>,{' '}
                  <strong>Cantidad esperada</strong> (Talla opcional; varias filas con la misma ref + ubicación se suman). También:
                  Esperada, Stock, Inventario, Existencia. Use la pestaña Reporte de conteos para auditar todos los guardados.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
};

const CountInput: React.FC<{
  line: CyclicInventoryLine;
  onSave: (value: string) => void;
}> = ({ line, onSave }) => {
  const [val, setVal] = useState(
    line.countedQty !== null && line.countedQty !== undefined ? String(line.countedQty) : ''
  );
  useEffect(() => {
    setVal(line.countedQty !== null && line.countedQty !== undefined ? String(line.countedQty) : '');
  }, [line.countedQty, line.reference, line.location]);
  return (
    <div className="flex gap-1 items-center">
      <Input
        className="h-8 w-24"
        inputMode="numeric"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => {
          if (val === '' && (line.countedQty === null || line.countedQty === undefined)) return;
          if (val === String(line.countedQty ?? '')) return;
          onSave(val);
        }}
      />
      <Button type="button" size="sm" variant="secondary" className="h-8 px-2" onClick={() => onSave(val)}>
        OK
      </Button>
    </div>
  );
};

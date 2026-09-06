'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  ArrowLeft,
  Box,
  LayoutDashboard,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Store,
  Trash2,
  Upload,
  Warehouse,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth-context';
import type { StoreCapacityForecast, StoreCapacityProfile, StoreDrawerCapacity } from '@/types';
import {
  DEFAULT_GARMENTS_PER_DRAWER,
  computeFootwearCapacityBreakdown,
  computeStoreCapacityTotals,
  emptyDrawerRow,
  formatCapacityPctLabel,
  inventoryTotal,
  normalizePdvCode,
  parseGlobalInventorySheet,
  parseCediEnProcesoSheet,
  parseTfPendingReceiveSheet,
  parseStoreCapacitySheet,
} from '@/lib/storeCapacity';
import {
  applyCediEnProceso,
  applyGlobalStoreInventory,
  applyTfPendingReceive,
  deleteStoreCapacityProfile,
  getCapacityForecastsByWarehouse,
  getStoreCapacitySettings,
  listStoreCapacityProfiles,
  saveStoreCapacityProfile,
  saveStoreCapacitySettings,
  upsertStoreCapacityProfiles,
} from '@/app/storeCapacityActions';

interface StoreCapacityModuleProps {
  onReturnToSuite: () => void;
}

function blankProfile(): StoreCapacityProfile {
  const now = new Date().toISOString();
  return {
    id: '',
    pdvCode: '',
    pdvName: '',
    drawers: [emptyDrawerRow({ measure: '60*60', capacityWithBox: 11, capacityWithoutBox: 22, drawerCount: 0 })],
    inventorySnapshot: {
      accesorios: 0,
      calzado: 0,
      ropa: 0,
      comprometidoAccesorios: 0,
      comprometidoCalzado: 0,
      comprometidoRopa: 0,
      source: 'manual',
    },
    exhibitionAffectsCapacity: false,
    exhibitionCalzado: 0,
    exhibitionRopa: 0,
    cediEnProceso: { calzado: 0, ropa: 0, source: 'manual' },
    tfPendingReceive: { calzado: 0, ropa: 0, source: 'manual' },
    notes: '',
    active: true,
    createdAt: now,
    updatedAt: now,
  };
}

function forecastFor(
  map: Record<string, StoreCapacityForecast>,
  code: string
): StoreCapacityForecast | undefined {
  return map[normalizePdvCode(code)];
}

function buildBreakdownArgs(
  p: Pick<
    StoreCapacityProfile,
    | 'drawers'
    | 'inventorySnapshot'
    | 'exhibitionAffectsCapacity'
    | 'exhibitionCalzado'
    | 'exhibitionRopa'
    | 'cediEnProceso'
    | 'tfPendingReceive'
  >,
  garmentsPerDrawer: number,
  forecast?: StoreCapacityForecast
) {
  // Inbound Próxima = SOLO Excel/manual tfPendingReceive (sin cruce transfers → evita doble conteo)
  const pendingCalz = Number(p.tfPendingReceive?.calzado) || 0;
  const pendingRopa = Number(p.tfPendingReceive?.ropa) || 0;
  return {
    drawers: p.drawers || [],
    ropaOnHand: Number(p.inventorySnapshot?.ropa) || 0,
    calzadoOnHand: Number(p.inventorySnapshot?.calzado) || 0,
    calzadoInTransit: pendingCalz,
    ropaInTransit: pendingRopa,
    calzadoEnProceso: p.cediEnProceso?.calzado,
    ropaEnProceso: p.cediEnProceso?.ropa,
    forecastCalzadoOutflow: forecast?.forecastCalzadoOutflow,
    forecastRopaOutflow: forecast?.forecastRopaOutflow,
    forecastAvgDailyCalzadoOutflow: forecast?.avgDailyCalzadoOutflow,
    forecastSamples: forecast?.samples,
    garmentsPerDrawer,
    exhibitionAffectsCapacity: !!p.exhibitionAffectsCapacity,
    exhibitionCalzado: p.exhibitionCalzado,
    exhibitionRopa: p.exhibitionRopa,
    committedCalzado: p.inventorySnapshot?.comprometidoCalzado,
    committedRopa: p.inventorySnapshot?.comprometidoRopa,
  };
}

export function StoreCapacityModule({ onReturnToSuite }: StoreCapacityModuleProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const capacityFileRef = useRef<HTMLInputElement>(null);
  const inventoryFileRef = useRef<HTMLInputElement>(null);
  const cediFileRef = useRef<HTMLInputElement>(null);
  const pendingTfFileRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [importingCapacity, setImportingCapacity] = useState(false);
  const [importingInventory, setImportingInventory] = useState(false);
  const [importingCedi, setImportingCedi] = useState(false);
  const [importingPendingTf, setImportingPendingTf] = useState(false);
  const [profiles, setProfiles] = useState<StoreCapacityProfile[]>([]);
  const [forecastByWhs, setForecastByWhs] = useState<Record<string, StoreCapacityForecast>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<StoreCapacityProfile>(blankProfile());
  const [filter, setFilter] = useState('');
  const [garmentsPerDrawer, setGarmentsPerDrawer] = useState(DEFAULT_GARMENTS_PER_DRAWER);
  const [forecastHorizonDays, setForecastHorizonDays] = useState(7);
  const [mainTab, setMainTab] = useState<'maestro' | 'tablero'>('maestro');

  const load = useCallback(async () => {
    setLoading(true);
    const [profilesRes, settingsRes, forecastRes] = await Promise.all([
      listStoreCapacityProfiles(),
      getStoreCapacitySettings(),
      getCapacityForecastsByWarehouse(),
    ]);
    if (!profilesRes.success) {
      toast({ variant: 'destructive', title: 'Error', description: profilesRes.error });
      setProfiles([]);
    } else {
      setProfiles(profilesRes.data || []);
    }
    if (settingsRes.success && settingsRes.data) {
      setGarmentsPerDrawer(settingsRes.data.garmentsPerDrawerForClothing);
      setForecastHorizonDays(settingsRes.data.forecastHorizonDays || 7);
    }
    if (forecastRes.success && forecastRes.data) {
      setForecastByWhs(forecastRes.data);
    } else {
      setForecastByWhs({});
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter(
      (p) =>
        p.pdvCode.toLowerCase().includes(q) ||
        (p.pdvName || '').toLowerCase().includes(q)
    );
  }, [profiles, filter]);

  const draftForecast = useMemo(
    () => forecastFor(forecastByWhs, draft.pdvCode || selectedId || ''),
    [forecastByWhs, draft.pdvCode, selectedId]
  );

  const totals = useMemo(() => computeStoreCapacityTotals(draft.drawers), [draft.drawers]);
  const breakdown = useMemo(
    () => computeFootwearCapacityBreakdown(buildBreakdownArgs(draft, garmentsPerDrawer, draftForecast)),
    [draft, garmentsPerDrawer, draftForecast]
  );

  const dashboardRows = useMemo(() => {
    const rows = profiles.map((p) => {
      const forecast = forecastFor(forecastByWhs, p.pdvCode);
      const b = computeFootwearCapacityBreakdown(buildBreakdownArgs(p, garmentsPerDrawer, forecast));
      return { profile: p, forecast, breakdown: b };
    });
    rows.sort((a, b) => b.breakdown.futuraOccupancyPct - a.breakdown.futuraOccupancyPct);
    return rows;
  }, [profiles, forecastByWhs, garmentsPerDrawer]);

  const boardStats = useMemo(() => {
    const exceedsHoyWithBox = dashboardRows.filter((r) => r.breakdown.hoyExceedsWithBox).length;
    const exceedsHoyWithoutBox = dashboardRows.filter((r) => r.breakdown.hoyExceedsWithoutBox).length;
    const exceedsProximaWithBox = dashboardRows.filter((r) => r.breakdown.proximaExceedsWithBox).length;
    const exceedsFuturaWithBox = dashboardRows.filter((r) => r.breakdown.futuraExceedsWithBox).length;
    const exceedsFuturaWithoutBox = dashboardRows.filter((r) => r.breakdown.futuraExceedsWithoutBox).length;
    const okSinCaja = dashboardRows.length - exceedsHoyWithoutBox;
    const avgHoyWith =
      dashboardRows.length > 0
        ? dashboardRows.reduce((s, r) => s + r.breakdown.hoyOccupancyPctWithBox, 0) / dashboardRows.length
        : 0;
    const avgHoyWithout =
      dashboardRows.length > 0
        ? dashboardRows.reduce((s, r) => s + r.breakdown.hoyOccupancyPctWithoutBox, 0) / dashboardRows.length
        : 0;
    const avgFuturaWith =
      dashboardRows.length > 0
        ? dashboardRows.reduce((s, r) => s + r.breakdown.futuraOccupancyPctWithBox, 0) / dashboardRows.length
        : 0;
    const avgFuturaWithout =
      dashboardRows.length > 0
        ? dashboardRows.reduce((s, r) => s + r.breakdown.futuraOccupancyPctWithoutBox, 0) / dashboardRows.length
        : 0;
    return {
      exceedsHoyWithBox,
      exceedsHoyWithoutBox,
      exceedsProximaWithBox,
      exceedsFuturaWithBox,
      exceedsFuturaWithoutBox,
      okSinCaja,
      avgHoyWith,
      avgHoyWithout,
      avgFuturaWith,
      avgFuturaWithout,
      // legacy aliases used in badge
      exceedsHoy: exceedsHoyWithBox,
      exceedsFutura: exceedsFuturaWithBox,
      ok: okSinCaja,
      avgHoy: avgHoyWith,
      avgProxima: 0,
      avgFutura: avgFuturaWith,
    };
  }, [dashboardRows]);

  const startNew = () => {
    setSelectedId(null);
    setDraft(blankProfile());
    setMainTab('maestro');
  };

  const selectProfile = (p: StoreCapacityProfile) => {
    setSelectedId(p.id);
    setDraft({
      ...p,
      drawers: p.drawers?.length ? p.drawers.map((d) => ({ ...d })) : [emptyDrawerRow()],
      inventorySnapshot: p.inventorySnapshot
        ? {
            ...p.inventorySnapshot,
            comprometidoAccesorios: Number(p.inventorySnapshot.comprometidoAccesorios) || 0,
            comprometidoCalzado: Number(p.inventorySnapshot.comprometidoCalzado) || 0,
            comprometidoRopa: Number(p.inventorySnapshot.comprometidoRopa) || 0,
          }
        : {
            accesorios: 0,
            calzado: 0,
            ropa: 0,
            comprometidoAccesorios: 0,
            comprometidoCalzado: 0,
            comprometidoRopa: 0,
            source: 'manual',
          },
      exhibitionAffectsCapacity: !!p.exhibitionAffectsCapacity,
      exhibitionCalzado: Number(p.exhibitionCalzado) || 0,
      exhibitionRopa: Number(p.exhibitionRopa) || 0,
      cediEnProceso: p.cediEnProceso
        ? { ...p.cediEnProceso }
        : { calzado: 0, ropa: 0, source: 'manual' },
      tfPendingReceive: p.tfPendingReceive
        ? { ...p.tfPendingReceive }
        : { calzado: 0, ropa: 0, source: 'manual' },
    });
    setMainTab('maestro');
  };

  const updateDrawer = (id: string, patch: Partial<StoreDrawerCapacity>) => {
    setDraft((prev) => ({
      ...prev,
      drawers: prev.drawers.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    }));
  };

  const addDrawer = () => {
    setDraft((prev) => ({ ...prev, drawers: [...prev.drawers, emptyDrawerRow()] }));
  };

  const removeDrawer = (id: string) => {
    setDraft((prev) => ({
      ...prev,
      drawers: prev.drawers.length <= 1 ? prev.drawers : prev.drawers.filter((d) => d.id !== id),
    }));
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    const res = await saveStoreCapacitySettings(garmentsPerDrawer, user?.uid, {
      horizonDays: forecastHorizonDays,
    });
    setSavingSettings(false);
    if (!res.success || !res.data) {
      toast({ variant: 'destructive', title: 'No se guardó el parámetro', description: res.error });
      return;
    }
    setGarmentsPerDrawer(res.data.garmentsPerDrawerForClothing);
    setForecastHorizonDays(res.data.forecastHorizonDays || 7);
    toast({
      title: 'Parámetros actualizados',
      description: `Ropa: ${res.data.garmentsPerDrawerForClothing}/cajón · horizonte: ${res.data.forecastHorizonDays}d.`,
    });
    await load();
  };

  const handleSave = async () => {
    const code = normalizePdvCode(draft.pdvCode);
    if (!code) {
      toast({ variant: 'destructive', title: 'PDV requerido', description: 'Indique el código de tienda (ej. B18).' });
      return;
    }
    if (draft.exhibitionAffectsCapacity) {
      const exhC = Number(draft.exhibitionCalzado) || 0;
      const exhR = Number(draft.exhibitionRopa) || 0;
      if (exhC <= 0 && exhR <= 0) {
        toast({
          variant: 'destructive',
          title: 'Exhibición incompleta',
          description: 'Si activa exhibición, indique calzado y/o ropa en sala (> 0).',
        });
        return;
      }
    }
    if (!draft.drawers?.some((d) => String(d.measure || '').trim())) {
      toast({
        variant: 'destructive',
        title: 'Sin medidas de cajón',
        description: 'Agregue al menos una medida de cajón antes de guardar.',
      });
      return;
    }
    setSaving(true);
    try {
      const res = await saveStoreCapacityProfile(
        {
          ...draft,
          pdvCode: code,
          inventorySnapshot: draft.inventorySnapshot
            ? {
                ...draft.inventorySnapshot,
                updatedAt: new Date().toISOString(),
                source: draft.inventorySnapshot.source || 'manual',
              }
            : undefined,
          cediEnProceso: draft.cediEnProceso
            ? {
                calzado: Number(draft.cediEnProceso.calzado) || 0,
                ropa: Number(draft.cediEnProceso.ropa) || 0,
                updatedAt: new Date().toISOString(),
                source: draft.cediEnProceso.source || 'manual',
              }
            : undefined,
          tfPendingReceive: draft.tfPendingReceive
            ? {
                calzado: Number(draft.tfPendingReceive.calzado) || 0,
                ropa: Number(draft.tfPendingReceive.ropa) || 0,
                updatedAt: new Date().toISOString(),
                source: draft.tfPendingReceive.source || 'manual',
              }
            : undefined,
        },
        user?.uid
      );
      if (!res.success || !res.data) {
        toast({
          variant: 'destructive',
          title: 'No se guardó',
          description: res.error || 'Error desconocido al persistir en Firestore.',
        });
        return;
      }
      toast({ title: 'Guardado', description: `Capacidad de ${res.data.pdvCode} actualizada.` });
      setSelectedId(res.data.id);
      setDraft({
        ...res.data,
        drawers: res.data.drawers?.length ? res.data.drawers : [emptyDrawerRow()],
        inventorySnapshot: res.data.inventorySnapshot || blankProfile().inventorySnapshot,
        cediEnProceso: res.data.cediEnProceso || { calzado: 0, ropa: 0, source: 'manual' },
        tfPendingReceive: res.data.tfPendingReceive || { calzado: 0, ropa: 0, source: 'manual' },
      });
      await load();
    } catch (e: any) {
      toast({
        variant: 'destructive',
        title: 'Error al guardar',
        description: e?.message || String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const code = normalizePdvCode(draft.pdvCode || selectedId || '');
    if (!code) return;
    if (!confirm(`¿Eliminar el maestro de capacidad de ${code}?`)) return;
    const res = await deleteStoreCapacityProfile(code);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'Error', description: res.error });
      return;
    }
    toast({ title: 'Eliminado', description: code });
    startNew();
    await load();
  };

  const handleImportCapacityExcel = async (file: File) => {
    setImportingCapacity(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const parsed: Array<ReturnType<typeof parseStoreCapacitySheet>> = [];
      for (const name of wb.SheetNames) {
        const sheet = wb.Sheets[name];
        if (!sheet) continue;
        const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][];
        const profile = parseStoreCapacitySheet(name, matrix);
        if (profile && profile.drawers.length > 0) parsed.push(profile);
      }
      if (parsed.length === 0) {
        toast({
          variant: 'destructive',
          title: 'Sin datos',
          description: 'No se detectaron hojas con cajones/capacidades.',
        });
        return;
      }
      const res = await upsertStoreCapacityProfiles(parsed.filter(Boolean) as any[], user?.uid);
      if (!res.success) {
        toast({ variant: 'destructive', title: 'Importación fallida', description: res.error });
        return;
      }
      toast({ title: 'Capacidades importadas', description: `${res.saved} tienda(s).` });
      await load();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error al leer Excel', description: e?.message || String(e) });
    } finally {
      setImportingCapacity(false);
      if (capacityFileRef.current) capacityFileRef.current.value = '';
    }
  };

  const handleImportInventoryExcel = async (file: File) => {
    setImportingInventory(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) {
        toast({ variant: 'destructive', title: 'Excel vacío' });
        return;
      }
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, unknown>[];
      const { byBodega, rowCount, skipped } = parseGlobalInventorySheet(rows);
      if (byBodega.size === 0) {
        toast({
          variant: 'destructive',
          title: 'Sin filas válidas',
          description: 'Columnas: BODEGA, GRUPO, CANTIDAD.',
        });
        return;
      }
      const payload: Record<string, import('@/types').StoreInventorySnapshot> = {};
      byBodega.forEach((snap, code) => {
        payload[code] = snap;
      });
      const res = await applyGlobalStoreInventory(payload, user?.uid);
      if (!res.success) {
        toast({ variant: 'destructive', title: 'No se aplicó inventario', description: res.error });
        return;
      }
      toast({
        title: 'Inventario global aplicado',
        description: `${rowCount} filas · ${res.updated} actualizadas · ${res.created} nuevas${
          skipped ? ` · ${skipped} omitidas` : ''
        }.`,
      });
      await load();
      const code = normalizePdvCode(draft.pdvCode || selectedId || '');
      if (code && payload[code]) {
        setDraft((prev) => ({ ...prev, inventorySnapshot: { ...payload[code] } }));
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error al leer inventario', description: e?.message || String(e) });
    } finally {
      setImportingInventory(false);
      if (inventoryFileRef.current) inventoryFileRef.current.value = '';
    }
  };

  const handleImportCediExcel = async (file: File) => {
    setImportingCedi(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) {
        toast({ variant: 'destructive', title: 'Excel vacío' });
        return;
      }
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, unknown>[];
      const { byBodega, rowCount, skipped } = parseCediEnProcesoSheet(rows);
      if (byBodega.size === 0) {
        toast({
          variant: 'destructive',
          title: 'Sin filas válidas',
          description: 'Columnas: BODEGA y CANT EN PROCESO (GRUPO opcional).',
        });
        return;
      }
      const payload: Record<string, { calzado: number; ropa: number }> = {};
      byBodega.forEach((snap, code) => {
        payload[code] = snap;
      });
      const res = await applyCediEnProceso(payload, user?.uid);
      if (!res.success) {
        toast({ variant: 'destructive', title: 'No se aplicó CEDI', description: res.error });
        return;
      }
      toast({
        title: 'CEDI en proceso aplicado',
        description: `${rowCount} filas · ${res.updated} actualizadas · ${res.created} nuevas${
          skipped ? ` · ${skipped} omitidas` : ''
        }.`,
      });
      await load();
      const code = normalizePdvCode(draft.pdvCode || selectedId || '');
      if (code && payload[code]) {
        setDraft((prev) => ({
          ...prev,
          cediEnProceso: {
            calzado: payload[code].calzado,
            ropa: payload[code].ropa,
            updatedAt: new Date().toISOString(),
            source: 'import',
          },
        }));
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error al leer CEDI', description: e?.message || String(e) });
    } finally {
      setImportingCedi(false);
      if (cediFileRef.current) cediFileRef.current.value = '';
    }
  };

  const handleImportPendingTfExcel = async (file: File) => {
    setImportingPendingTf(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) {
        toast({ variant: 'destructive', title: 'Excel vacío' });
        return;
      }
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, unknown>[];
      const { byBodega, rowCount, skipped } = parseTfPendingReceiveSheet(rows);
      if (byBodega.size === 0) {
        toast({
          variant: 'destructive',
          title: 'Sin filas válidas',
          description: 'Columnas: BODEGA y CANTIDAD (GRUPO opcional; sin grupo = calzado).',
        });
        return;
      }
      const payload: Record<string, { calzado: number; ropa: number }> = {};
      byBodega.forEach((snap, code) => {
        payload[code] = snap;
      });
      const res = await applyTfPendingReceive(payload, user?.uid);
      if (!res.success) {
        toast({ variant: 'destructive', title: 'No se aplicó TF pendiente', description: res.error });
        return;
      }
      toast({
        title: 'Inbound TF (Excel) aplicado',
        description: `${rowCount} filas · ${res.updated} actualizadas · ${res.created} nuevas · ${
          res.cleared || 0
        } limpiadas${skipped ? ` · ${skipped} omitidas` : ''}. Reemplaza el inbound previo (no suma).`,
      });
      await load();
      const code = normalizePdvCode(draft.pdvCode || selectedId || '');
      if (code && payload[code]) {
        setDraft((prev) => ({
          ...prev,
          tfPendingReceive: {
            calzado: payload[code].calzado,
            ropa: payload[code].ropa,
            updatedAt: new Date().toISOString(),
            source: 'import',
          },
        }));
      }
    } catch (e: any) {
      toast({
        variant: 'destructive',
        title: 'Error al leer TF pendiente',
        description: e?.message || String(e),
      });
    } finally {
      setImportingPendingTf(false);
      if (pendingTfFileRef.current) pendingTfFileRef.current.value = '';
    }
  };

  return (
    <div className="space-y-4 p-3 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" onClick={onReturnToSuite} aria-label="Volver">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Warehouse className="h-6 w-6 text-sky-700" />
              Capacidad de tiendas
            </h1>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Cupo de cajones = calzado. Ropa descuenta cajones. Accesorios no afectan. Inventario + inbound TF (Excel) +
              CEDI en proceso (futura). Outlet puede restar exhibición.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={capacityFileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImportCapacityExcel(f);
            }}
          />
          <input
            ref={inventoryFileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImportInventoryExcel(f);
            }}
          />
          <input
            ref={cediFileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImportCediExcel(f);
            }}
          />
          <input
            ref={pendingTfFileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImportPendingTfExcel(f);
            }}
          />
          <Button variant="outline" disabled={loading} onClick={() => void load()}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Actualizar
          </Button>
          <Button variant="outline" disabled={importingCapacity} onClick={() => capacityFileRef.current?.click()}>
            {importingCapacity ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            Importar cajones
          </Button>
          <Button variant="outline" disabled={importingInventory} onClick={() => inventoryFileRef.current?.click()}>
            {importingInventory ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            Inventario global
          </Button>
          <Button variant="outline" disabled={importingCedi} onClick={() => cediFileRef.current?.click()}>
            {importingCedi ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            CEDI en proceso
          </Button>
          <Button
            variant="outline"
            disabled={importingPendingTf}
            onClick={() => pendingTfFileRef.current?.click()}
          >
            {importingPendingTf ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            TF Inbound Excel
          </Button>
          <Button variant="secondary" onClick={startNew}>
            <Plus className="mr-2 h-4 w-4" />
            Nueva tienda
          </Button>
        </div>
      </div>

      <Card className="border-amber-600/30 bg-amber-50/40 dark:bg-amber-950/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            Parámetros rápidos
          </CardTitle>
          <CardDescription>
            <strong>Hoy</strong> = solo almacén · <strong>Próxima</strong> = almacén + inbound TF (solo Excel) ·{' '}
            <strong>Futura</strong> = próxima + CEDI − salidas.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="garmentsPerDrawer">Prendas ropa / cajón</Label>
            <Input
              id="garmentsPerDrawer"
              type="number"
              min={1}
              className="w-36 tabular-nums font-semibold"
              value={garmentsPerDrawer}
              onChange={(e) => setGarmentsPerDrawer(Math.max(1, Number(e.target.value) || 1))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="forecastHorizon">Horizonte pronóstico (días)</Label>
            <Input
              id="forecastHorizon"
              type="number"
              min={1}
              className="w-36 tabular-nums font-semibold"
              value={forecastHorizonDays}
              onChange={(e) => setForecastHorizonDays(Math.max(1, Number(e.target.value) || 1))}
            />
          </div>
          <Button type="button" onClick={() => void handleSaveSettings()} disabled={savingSettings}>
            {savingSettings ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Guardar parámetros
          </Button>
          <p className="text-xs text-muted-foreground max-w-xl">
            Inbound TF ya no cruza transferencias (evita doble conteo). Suba Excel «Inbound TF» con{' '}
            <code>BODEGA | CANTIDAD | GRUPO</code> (calzado/ropa). Cada carga <strong>reemplaza</strong> el inbound
            previo.
          </p>
        </CardContent>
      </Card>

      <Tabs value={mainTab} onValueChange={(v) => setMainTab(v as 'maestro' | 'tablero')}>
        <TabsList>
          <TabsTrigger value="maestro">
            <Store className="mr-1.5 h-4 w-4" />
            Maestro por tienda
          </TabsTrigger>
          <TabsTrigger value="tablero">
            <LayoutDashboard className="mr-1.5 h-4 w-4" />
            Tablero ocupación
            {boardStats.exceedsHoyWithoutBox > 0 || boardStats.exceedsFuturaWithoutBox > 0 ? (
              <Badge variant="destructive" className="ml-2">
                {boardStats.exceedsHoyWithoutBox} hoy s/caja · {boardStats.exceedsFuturaWithoutBox} futura s/caja
              </Badge>
            ) : boardStats.exceedsHoyWithBox > 0 ? (
              <Badge className="ml-2 bg-orange-500/20 text-orange-900">
                {boardStats.exceedsHoyWithBox} hoy solo c/caja
              </Badge>
            ) : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tablero" className="space-y-4 mt-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Card>
              <CardHeader className="py-3">
                <CardDescription>OK hoy (caben s/caja)</CardDescription>
                <CardTitle className="text-2xl tabular-nums text-emerald-700">{boardStats.okSinCaja}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="py-3">
                <CardDescription>Exceden HOY c/caja</CardDescription>
                <CardTitle className="text-2xl tabular-nums text-orange-600">
                  {boardStats.exceedsHoyWithBox}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="py-3">
                <CardDescription>No caben HOY ni s/caja</CardDescription>
                <CardTitle className="text-2xl tabular-nums text-red-600">
                  {boardStats.exceedsHoyWithoutBox}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="py-3">
                <CardDescription>No caben FUTURA ni s/caja</CardDescription>
                <CardTitle className="text-2xl tabular-nums text-amber-700">
                  {boardStats.exceedsFuturaWithoutBox}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="py-3">
                <CardDescription>Ocup. hoy c/caja · s/caja</CardDescription>
                <CardTitle className="text-xl tabular-nums">
                  {boardStats.avgHoyWith.toFixed(0)}% · {boardStats.avgHoyWithout.toFixed(0)}%
                </CardTitle>
              </CardHeader>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Tablero por horizonte</CardTitle>
              <CardDescription>
                <strong>c/caja</strong> = capacidad conservadora · <strong>s/caja</strong> = máximo físico ·{' '}
                <strong>Hoy</strong> almacén · <strong>Próxima</strong> + inbound TF (Excel) · <strong>Futura</strong> +
                CEDI − salidas.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {loading ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>PDV</TableHead>
                      <TableHead className="text-right">Almacén</TableHead>
                      <TableHead className="text-right">Inbound TF</TableHead>
                      <TableHead className="text-right">CEDI</TableHead>
                      <TableHead className="text-right">Pronóst.</TableHead>
                      <TableHead className="min-w-[120px]">Hoy c/caja · s/caja</TableHead>
                      <TableHead className="min-w-[120px]">Próxima c/ · s/</TableHead>
                      <TableHead className="min-w-[120px]">Futura c/ · s/</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dashboardRows.map(({ profile: p, breakdown: b }) => (
                      <TableRow
                        key={p.id}
                        className={
                          b.hoyExceedsWithoutBox
                            ? 'bg-red-50/60 dark:bg-red-950/20'
                            : b.hoyExceedsWithBox
                              ? 'bg-orange-50/60 dark:bg-orange-950/15'
                              : b.futuraExceedsWithoutBox
                                ? 'bg-amber-50/70 dark:bg-amber-950/20'
                                : undefined
                        }
                      >
                        <TableCell>
                          <div className="font-semibold">{p.pdvCode}</div>
                          <div className="text-xs text-muted-foreground">
                            {p.exhibitionAffectsCapacity ? 'Outlet · exhibición' : p.pdvName || '—'}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {b.calzadoOnHand.toLocaleString()}
                          {b.committedCalzadoApplied > 0 ? (
                            <div className="text-[10px] text-orange-700">−{b.committedCalzadoApplied} a sacar</div>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {b.calzadoInTransit.toLocaleString()}
                          {b.ropaInTransit > 0 ? (
                            <div className="text-[10px] text-muted-foreground">
                              ropa {b.ropaInTransit.toLocaleString()}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sky-800 dark:text-sky-300">
                          {b.calzadoEnProceso.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-emerald-800 dark:text-emerald-300">
                          {b.forecastCalzadoOutflow > 0
                            ? `−${Math.round(b.forecastCalzadoOutflow).toLocaleString()}`
                            : '—'}
                          {b.forecastSamples > 0 ? (
                            <div className="text-[10px] text-muted-foreground">{b.forecastSamples} muestras</div>
                          ) : (
                            <div className="text-[10px] text-muted-foreground">sin histórico</div>
                          )}
                        </TableCell>
                        <TableCell className="tabular-nums text-xs font-semibold">
                          <span className={b.hoyExceedsWithBox ? 'text-orange-700' : ''}>
                            {formatCapacityPctLabel(b.hoyOccupancyPctWithBox, b.hoyExceedsWithBox)}
                          </span>
                          {' · '}
                          <span className={b.hoyExceedsWithoutBox ? 'text-red-700' : 'text-emerald-800'}>
                            {formatCapacityPctLabel(b.hoyOccupancyPctWithoutBox, b.hoyExceedsWithoutBox)}
                          </span>
                        </TableCell>
                        <TableCell className="tabular-nums text-xs font-semibold">
                          {formatCapacityPctLabel(b.proximaOccupancyPctWithBox, b.proximaExceedsWithBox)} ·{' '}
                          {formatCapacityPctLabel(b.proximaOccupancyPctWithoutBox, b.proximaExceedsWithoutBox)}
                        </TableCell>
                        <TableCell className="tabular-nums text-xs font-semibold">
                          {formatCapacityPctLabel(b.futuraOccupancyPctWithBox, b.futuraExceedsWithBox)} ·{' '}
                          {formatCapacityPctLabel(b.futuraOccupancyPctWithoutBox, b.futuraExceedsWithoutBox)}
                        </TableCell>
                        <TableCell>
                          {b.hoyExceedsWithoutBox ? (
                            <Badge variant="destructive">NO CABE HOY</Badge>
                          ) : b.hoyExceedsWithBox ? (
                            <Badge className="bg-orange-500/20 text-orange-900">REQUIERE S/CAJA</Badge>
                          ) : b.futuraExceedsWithoutBox ? (
                            <Badge className="bg-amber-500/20 text-amber-900">RIESGO FUTURO</Badge>
                          ) : b.proximaExceedsWithBox ? (
                            <Badge className="bg-sky-500/15 text-sky-900">TF → mezcla</Badge>
                          ) : (
                            <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-800">
                              OK
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost" onClick={() => selectProfile(p)}>
                            Editar
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {dashboardRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                          Sin tiendas. Importe cajones o cree un maestro.
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="maestro" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Tiendas</CardTitle>
                <CardDescription>{profiles.length} perfil(es)</CardDescription>
                <Input
                  placeholder="Filtrar PDV…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="mt-2"
                />
              </CardHeader>
              <CardContent className="max-h-[70vh] overflow-y-auto space-y-1 p-2">
                {loading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : filtered.length === 0 ? (
                  <p className="text-sm text-muted-foreground p-3">Sin tiendas.</p>
                ) : (
                  filtered.map((p) => {
                    const forecast = forecastFor(forecastByWhs, p.pdvCode);
                    const b = computeFootwearCapacityBreakdown(
                      buildBreakdownArgs(p, garmentsPerDrawer, forecast)
                    );
                    const active =
                      selectedId === p.id || (!selectedId && normalizePdvCode(draft.pdvCode) === p.pdvCode);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => selectProfile(p)}
                        className={`w-full text-left rounded-md border px-3 py-2 transition-colors ${
                          active ? 'border-sky-600 bg-sky-50 dark:bg-sky-950/40' : 'hover:bg-muted/60'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold flex items-center gap-1.5">
                            <Store className="h-3.5 w-3.5" />
                            {p.pdvCode}
                          </span>
                          <Badge
                            variant={
                              b.hoyExceedsWithoutBox || b.futuraExceedsWithoutBox
                                ? 'destructive'
                                : b.hoyExceedsWithBox
                                  ? 'secondary'
                                  : 'secondary'
                            }
                            className={`tabular-nums text-[10px] ${
                              b.hoyExceedsWithBox && !b.hoyExceedsWithoutBox
                                ? 'bg-orange-500/20 text-orange-900'
                                : ''
                            }`}
                          >
                            {formatCapacityPctLabel(b.hoyOccupancyPctWithBox, b.hoyExceedsWithBox).replace(
                              ' exceso',
                              ''
                            )}
                            /
                            {formatCapacityPctLabel(b.hoyOccupancyPctWithoutBox, b.hoyExceedsWithoutBox).replace(
                              ' exceso',
                              ''
                            )}
                          </Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground tabular-nums">
                          hoy c/ {Math.round(b.hoyAvailableWithBox).toLocaleString()} · s/{' '}
                          {Math.round(b.hoyAvailableWithoutBox).toLocaleString()}
                          {b.calzadoEnProceso > 0 ? ` · CEDI +${b.calzadoEnProceso}` : ''}
                          {p.exhibitionAffectsCapacity ? ' · exhib.' : ''}
                        </p>
                      </button>
                    );
                  })
                )}
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Datos de la tienda</CardTitle>
                  <CardDescription>
                    Mismo código que <code className="text-xs">bodegaDestino</code> en transferencias / Consulta TF.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="pdvCode">PDV / código</Label>
                    <Input
                      id="pdvCode"
                      value={draft.pdvCode}
                      onChange={(e) => setDraft((p) => ({ ...p, pdvCode: e.target.value.toUpperCase() }))}
                      placeholder="B18"
                      disabled={!!selectedId}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pdvName">Nombre (opcional)</Label>
                    <Input
                      id="pdvName"
                      value={draft.pdvName || ''}
                      onChange={(e) => setDraft((p) => ({ ...p, pdvName: e.target.value }))}
                      placeholder="Tienda / Outlet"
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="notes">Notas</Label>
                    <Textarea
                      id="notes"
                      value={draft.notes || ''}
                      onChange={(e) => setDraft((p) => ({ ...p, notes: e.target.value }))}
                      rows={2}
                    />
                  </div>
                </CardContent>
              </Card>

              <Card className="border-violet-600/25">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Exhibición en sala (Outlet)</CardTitle>
                  <CardDescription>
                    Si el inventario total incluye lo del salón, active esta opción: esas unidades{' '}
                    <strong>no ocupan cajones</strong> y se restan del inventario al calcular cupo de almacén.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={!!draft.exhibitionAffectsCapacity}
                      onCheckedChange={(v) =>
                        setDraft((p) => ({ ...p, exhibitionAffectsCapacity: v === true }))
                      }
                    />
                    Exhibición influye en capacidad (restar del inventario de almacén)
                  </label>
                  {draft.exhibitionAffectsCapacity ? (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label>Calzado exhibido</Label>
                        <Input
                          type="number"
                          min={0}
                          className="tabular-nums"
                          value={draft.exhibitionCalzado ?? 0}
                          onChange={(e) =>
                            setDraft((p) => ({ ...p, exhibitionCalzado: Number(e.target.value) || 0 }))
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Ropa exhibida</Label>
                        <Input
                          type="number"
                          min={0}
                          className="tabular-nums"
                          value={draft.exhibitionRopa ?? 0}
                          onChange={(e) =>
                            setDraft((p) => ({ ...p, exhibitionRopa: Number(e.target.value) || 0 }))
                          }
                        />
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card className="border-sky-600/25">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">CEDI en proceso — próxima a llegar</CardTitle>
                  <CardDescription>
                    Mercancía trabajando en CEDI (aún no en tránsito). Excel: <code>BODEGA</code>,{' '}
                    <code>CANT EN PROCESO</code> (y <code>GRUPO</code> opcional; sin grupo = calzado). Alimenta la
                    capacidad futura.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Calzado en proceso</Label>
                    <Input
                      type="number"
                      min={0}
                      className="tabular-nums"
                      value={draft.cediEnProceso?.calzado ?? 0}
                      onChange={(e) =>
                        setDraft((p) => ({
                          ...p,
                          cediEnProceso: {
                            calzado: Number(e.target.value) || 0,
                            ropa: p.cediEnProceso?.ropa ?? 0,
                            source: 'manual',
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Ropa en proceso</Label>
                    <Input
                      type="number"
                      min={0}
                      className="tabular-nums"
                      value={draft.cediEnProceso?.ropa ?? 0}
                      onChange={(e) =>
                        setDraft((p) => ({
                          ...p,
                          cediEnProceso: {
                            calzado: p.cediEnProceso?.calzado ?? 0,
                            ropa: Number(e.target.value) || 0,
                            source: 'manual',
                          },
                        }))
                      }
                    />
                  </div>
                </CardContent>
              </Card>

              <Card className="border-orange-600/25">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Inbound TF — Excel (capacidad Próxima)</CardTitle>
                  <CardDescription>
                    Única fuente de inbound: mercancía en camino / pendiente de recibir que <strong>aún no</strong>{' '}
                    está en inventario. Formato <code>BODEGA | CANTIDAD | GRUPO</code> (calzado/ropa). Cada carga{' '}
                    <strong>reemplaza</strong> el dato anterior (no se duplica con transferencias).
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Calzado pendiente</Label>
                    <Input
                      type="number"
                      min={0}
                      className="tabular-nums"
                      value={draft.tfPendingReceive?.calzado ?? 0}
                      onChange={(e) =>
                        setDraft((p) => ({
                          ...p,
                          tfPendingReceive: {
                            calzado: Number(e.target.value) || 0,
                            ropa: p.tfPendingReceive?.ropa ?? 0,
                            source: 'manual',
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Ropa pendiente</Label>
                    <Input
                      type="number"
                      min={0}
                      className="tabular-nums"
                      value={draft.tfPendingReceive?.ropa ?? 0}
                      onChange={(e) =>
                        setDraft((p) => ({
                          ...p,
                          tfPendingReceive: {
                            calzado: p.tfPendingReceive?.calzado ?? 0,
                            ropa: Number(e.target.value) || 0,
                            source: 'manual',
                          },
                        }))
                      }
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Box className="h-4 w-4" />
                      Cajones — capacidad de calzado
                    </CardTitle>
                    <CardDescription>Capacidad base en pares. La ropa descuenta cajones de este pool.</CardDescription>
                  </div>
                  <Button type="button" size="sm" variant="outline" onClick={addDrawer}>
                    <Plus className="mr-1 h-4 w-4" />
                    Medida
                  </Button>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Medida</TableHead>
                        <TableHead className="text-right">Cap. c/caja</TableHead>
                        <TableHead className="text-right">Cap. s/caja</TableHead>
                        <TableHead className="text-right">Cant. cajones</TableHead>
                        <TableHead className="text-right">Total c/caja</TableHead>
                        <TableHead className="text-right">Total s/caja</TableHead>
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {draft.drawers.map((d) => {
                        const withBox = (Number(d.capacityWithBox) || 0) * (Number(d.drawerCount) || 0);
                        const withoutBox = (Number(d.capacityWithoutBox) || 0) * (Number(d.drawerCount) || 0);
                        return (
                          <TableRow key={d.id}>
                            <TableCell>
                              <Input
                                value={d.measure}
                                onChange={(e) => updateDrawer(d.id, { measure: e.target.value })}
                                placeholder="60*60"
                                className="min-w-[100px]"
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                min={0}
                                className="text-right tabular-nums"
                                value={d.capacityWithBox}
                                onChange={(e) =>
                                  updateDrawer(d.id, { capacityWithBox: Number(e.target.value) || 0 })
                                }
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                min={0}
                                className="text-right tabular-nums"
                                value={d.capacityWithoutBox}
                                onChange={(e) =>
                                  updateDrawer(d.id, { capacityWithoutBox: Number(e.target.value) || 0 })
                                }
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                min={0}
                                className="text-right tabular-nums"
                                value={d.drawerCount}
                                onChange={(e) =>
                                  updateDrawer(d.id, { drawerCount: Number(e.target.value) || 0 })
                                }
                              />
                            </TableCell>
                            <TableCell className="text-right font-semibold tabular-nums">
                              {withBox.toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">
                              {withoutBox.toLocaleString()}
                            </TableCell>
                            <TableCell>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                disabled={draft.drawers.length <= 1}
                                onClick={() => removeDrawer(d.id)}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      <TableRow className="bg-muted/40 font-semibold">
                        <TableCell colSpan={3}>TOTALES (bruto)</TableCell>
                        <TableCell className="text-right tabular-nums">{totals.totalDrawers.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums">{totals.totalWithBox.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums">{totals.totalWithoutBox.toLocaleString()}</TableCell>
                        <TableCell />
                      </TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Inventario actual</CardTitle>
                    <CardDescription>
                      Excel: <code>BODEGA</code>, <code>GRUPO</code>, <code>CANTIDAD</code>,{' '}
                      <code>CANT COMPROMETIDA</code>. Lo comprometido es mercancía a sacar: resta del stock que ocupa
                      cupo. Accesorios no restan cajones.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <Label>Accesorios</Label>
                        <Input
                          type="number"
                          min={0}
                          className="tabular-nums"
                          value={draft.inventorySnapshot?.accesorios ?? 0}
                          onChange={(e) =>
                            setDraft((p) => ({
                              ...p,
                              inventorySnapshot: {
                                ...(p.inventorySnapshot || blankProfile().inventorySnapshot!),
                                accesorios: Number(e.target.value) || 0,
                                source: 'manual',
                              },
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Calzado</Label>
                        <Input
                          type="number"
                          min={0}
                          className="tabular-nums"
                          value={draft.inventorySnapshot?.calzado ?? 0}
                          onChange={(e) =>
                            setDraft((p) => ({
                              ...p,
                              inventorySnapshot: {
                                ...(p.inventorySnapshot || blankProfile().inventorySnapshot!),
                                calzado: Number(e.target.value) || 0,
                                source: 'manual',
                              },
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Ropa</Label>
                        <Input
                          type="number"
                          min={0}
                          className="tabular-nums"
                          value={draft.inventorySnapshot?.ropa ?? 0}
                          onChange={(e) =>
                            setDraft((p) => ({
                              ...p,
                              inventorySnapshot: {
                                ...(p.inventorySnapshot || blankProfile().inventorySnapshot!),
                                ropa: Number(e.target.value) || 0,
                                source: 'manual',
                              },
                            }))
                          }
                        />
                      </div>
                    </div>

                    <div className="rounded-md border border-orange-600/30 bg-orange-50/50 dark:bg-orange-950/20 p-3 space-y-2">
                      <p className="text-sm font-medium text-orange-900 dark:text-orange-200">
                        Cant. comprometida (a sacar del inventario)
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Pedidos de salida pendientes. Se restan del inventario al calcular ocupación de cajones.
                      </p>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Accesorios</Label>
                          <Input
                            type="number"
                            min={0}
                            className="tabular-nums"
                            value={draft.inventorySnapshot?.comprometidoAccesorios ?? 0}
                            onChange={(e) =>
                              setDraft((p) => ({
                                ...p,
                                inventorySnapshot: {
                                  ...(p.inventorySnapshot || blankProfile().inventorySnapshot!),
                                  comprometidoAccesorios: Number(e.target.value) || 0,
                                  source: 'manual',
                                },
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Calzado</Label>
                          <Input
                            type="number"
                            min={0}
                            className="tabular-nums"
                            value={draft.inventorySnapshot?.comprometidoCalzado ?? 0}
                            onChange={(e) =>
                              setDraft((p) => ({
                                ...p,
                                inventorySnapshot: {
                                  ...(p.inventorySnapshot || blankProfile().inventorySnapshot!),
                                  comprometidoCalzado: Number(e.target.value) || 0,
                                  source: 'manual',
                                },
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Ropa</Label>
                          <Input
                            type="number"
                            min={0}
                            className="tabular-nums"
                            value={draft.inventorySnapshot?.comprometidoRopa ?? 0}
                            onChange={(e) =>
                              setDraft((p) => ({
                                ...p,
                                inventorySnapshot: {
                                  ...(p.inventorySnapshot || blankProfile().inventorySnapshot!),
                                  comprometidoRopa: Number(e.target.value) || 0,
                                  source: 'manual',
                                },
                              }))
                            }
                          />
                        </div>
                      </div>
                    </div>

                    <p className="text-sm text-muted-foreground">
                      Total inventario:{' '}
                      <span className="font-semibold text-foreground">
                        {inventoryTotal(draft.inventorySnapshot).toLocaleString()}
                      </span>
                      {(Number(draft.inventorySnapshot?.comprometidoCalzado) || 0) +
                        (Number(draft.inventorySnapshot?.comprometidoRopa) || 0) +
                        (Number(draft.inventorySnapshot?.comprometidoAccesorios) || 0) >
                      0 ? (
                        <span className="ml-2 text-orange-800 dark:text-orange-300">
                          · a sacar{' '}
                          {(
                            (Number(draft.inventorySnapshot?.comprometidoCalzado) || 0) +
                            (Number(draft.inventorySnapshot?.comprometidoRopa) || 0) +
                            (Number(draft.inventorySnapshot?.comprometidoAccesorios) || 0)
                          ).toLocaleString()}
                        </span>
                      ) : null}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Cupo efectivo de calzado</CardTitle>
                    <CardDescription>
                      Inventario − exhibición − comprometido + inbound TF. Ropa ÷ {garmentsPerDrawer} = cajones.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span>Capacidad bruta c/caja</span>
                      <span className="tabular-nums">{Math.round(breakdown.grossCapacityWithBox).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Capacidad bruta s/caja</span>
                      <span className="tabular-nums">
                        {Math.round(breakdown.grossCapacityWithoutBox).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between text-amber-800 dark:text-amber-300">
                      <span>Cajones por ropa</span>
                      <span className="tabular-nums">−{breakdown.drawersUsedByClothing.toFixed(2)}</span>
                    </div>
                    {breakdown.exhibitionCalzadoApplied > 0 || breakdown.exhibitionRopaApplied > 0 ? (
                      <div className="flex justify-between text-violet-800 dark:text-violet-300">
                        <span>Exhibición restada</span>
                        <span className="tabular-nums">
                          calz {breakdown.exhibitionCalzadoApplied} · ropa {breakdown.exhibitionRopaApplied}
                        </span>
                      </div>
                    ) : null}
                    {breakdown.committedCalzadoApplied > 0 || breakdown.committedRopaApplied > 0 ? (
                      <div className="flex justify-between text-orange-800 dark:text-orange-300">
                        <span>Comprometido a sacar</span>
                        <span className="tabular-nums">
                          calz −{breakdown.committedCalzadoApplied} · ropa −{breakdown.committedRopaApplied}
                        </span>
                      </div>
                    ) : null}
                    <div className="flex justify-between">
                      <span>Capacidad efectiva c/caja</span>
                      <span className="font-semibold tabular-nums text-sky-800 dark:text-sky-300">
                        {Math.round(breakdown.effectiveCapacityWithBox).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Capacidad efectiva s/caja</span>
                      <span className="font-semibold tabular-nums text-emerald-800 dark:text-emerald-300">
                        {Math.round(breakdown.effectiveCapacityWithoutBox).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Calzado almacén (neto)</span>
                      <span className="tabular-nums">{breakdown.calzadoOnHand.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-start gap-2">
                      <span>
                        Inbound TF (Próxima)
                        <span className="block text-[10px] text-muted-foreground font-normal">
                          Solo Excel/manual · no cruza transferencias
                        </span>
                      </span>
                      <span className="tabular-nums text-right">
                        <span className="font-semibold">{breakdown.calzadoInTransit.toLocaleString()}</span> calz
                        {breakdown.ropaInTransit > 0 ? (
                          <>
                            {' · '}
                            <span className="font-semibold">{breakdown.ropaInTransit.toLocaleString()}</span> ropa
                          </>
                        ) : null}
                      </span>
                    </div>
                    <div className="flex justify-between text-sky-800 dark:text-sky-300">
                      <span>CEDI en proceso (entra en Futura)</span>
                      <span className="tabular-nums">
                        +{breakdown.calzadoEnProceso.toLocaleString()}
                        {breakdown.ropaEnProceso > 0 ? ` · ropa +${breakdown.ropaEnProceso}` : ''}
                      </span>
                    </div>
                    <div className="border-t pt-2 space-y-3">
                      <p className="text-[11px] text-muted-foreground leading-snug">
                        Cada horizonte muestra <strong>c/caja</strong> y <strong>s/caja</strong>. Si supera capacidad,
                        el % es solo el <strong>exceso</strong> (ej. ocupación 200% → +100% exceso). Si no supera, es
                        ocupación.
                      </p>
                      {(
                        [
                          {
                            key: 'hoy',
                            title: 'Hoy',
                            subtitle: 'solo almacén',
                            withBox: {
                              avail: breakdown.hoyAvailableWithBox,
                              pct: breakdown.hoyOccupancyPctWithBox,
                              exceeds: breakdown.hoyExceedsWithBox,
                              cap: breakdown.hoyEffectiveCapacityWithBox,
                            },
                            withoutBox: {
                              avail: breakdown.hoyAvailableWithoutBox,
                              pct: breakdown.hoyOccupancyPctWithoutBox,
                              exceeds: breakdown.hoyExceedsWithoutBox,
                              cap: breakdown.hoyEffectiveCapacityWithoutBox,
                            },
                          },
                          {
                            key: 'proxima',
                            title: 'Próxima',
                            subtitle: '+ TF tránsito',
                            withBox: {
                              avail: breakdown.proximaAvailableWithBox,
                              pct: breakdown.proximaOccupancyPctWithBox,
                              exceeds: breakdown.proximaExceedsWithBox,
                              cap: breakdown.proximaEffectiveCapacityWithBox,
                            },
                            withoutBox: {
                              avail: breakdown.proximaAvailableWithoutBox,
                              pct: breakdown.proximaOccupancyPctWithoutBox,
                              exceeds: breakdown.proximaExceedsWithoutBox,
                              cap: breakdown.proximaEffectiveCapacityWithoutBox,
                            },
                          },
                          {
                            key: 'futura',
                            title: 'Futura',
                            subtitle: '+ CEDI − salidas',
                            withBox: {
                              avail: breakdown.futuraAvailableWithBox,
                              pct: breakdown.futuraOccupancyPctWithBox,
                              exceeds: breakdown.futuraExceedsWithBox,
                              cap: breakdown.futuraEffectiveCapacityWithBox,
                            },
                            withoutBox: {
                              avail: breakdown.futuraAvailableWithoutBox,
                              pct: breakdown.futuraOccupancyPctWithoutBox,
                              exceeds: breakdown.futuraExceedsWithoutBox,
                              cap: breakdown.futuraEffectiveCapacityWithoutBox,
                            },
                          },
                        ] as const
                      ).map((h) => (
                        <div key={h.key} className="rounded-md border bg-muted/20 p-2.5 space-y-1.5">
                          <div className="text-sm">
                            <strong>{h.title}</strong>{' '}
                            <span className="text-muted-foreground text-xs">({h.subtitle})</span>
                          </div>
                          <div className="flex flex-wrap gap-1.5 items-center justify-between">
                            <span className="text-xs text-muted-foreground">
                              c/caja · cap {Math.round(h.withBox.cap).toLocaleString()}
                            </span>
                            <Badge
                              variant={h.withBox.exceeds ? 'destructive' : 'secondary'}
                              className="tabular-nums text-xs"
                            >
                              {Math.round(h.withBox.avail).toLocaleString()} ·{' '}
                              {formatCapacityPctLabel(h.withBox.pct, h.withBox.exceeds)}
                            </Badge>
                          </div>
                          <div className="flex flex-wrap gap-1.5 items-center justify-between">
                            <span className="text-xs text-muted-foreground">
                              s/caja · cap {Math.round(h.withoutBox.cap).toLocaleString()}
                            </span>
                            <Badge
                              variant={h.withoutBox.exceeds ? 'destructive' : 'default'}
                              className={`tabular-nums text-xs ${
                                !h.withoutBox.exceeds
                                  ? 'bg-emerald-500/15 text-emerald-900 hover:bg-emerald-500/20'
                                  : ''
                              }`}
                            >
                              {Math.round(h.withoutBox.avail).toLocaleString()} ·{' '}
                              {formatCapacityPctLabel(h.withoutBox.pct, h.withoutBox.exceeds)}
                            </Badge>
                          </div>
                        </div>
                      ))}
                      {breakdown.forecastCalzadoOutflow > 0 ? (
                        <p className="text-xs text-emerald-800 dark:text-emerald-300">
                          Pronóstico salidas {forecastHorizonDays}d: −
                          {Math.round(breakdown.forecastCalzadoOutflow).toLocaleString()} calzado
                          {breakdown.forecastSamples
                            ? ` (prom. ${breakdown.forecastAvgDailyCalzadoOutflow.toFixed(1)}/día · ${breakdown.forecastSamples} muestras)`
                            : ''}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Sin pronóstico aún: suba inventario varios días (histórico automático).
                        </p>
                      )}
                    </div>

                    <div
                      className={`mt-3 rounded-md border p-3 text-xs space-y-2 ${
                        breakdown.hoyBoxMix.exceedsEvenWithoutBox
                          ? 'border-red-600/30 bg-red-50/60 dark:bg-red-950/20'
                          : breakdown.hoyBoxMix.fitsAllWithBox
                            ? 'border-emerald-600/30 bg-emerald-50/50 dark:bg-emerald-950/20'
                            : 'border-sky-600/30 bg-sky-50/50 dark:bg-sky-950/20'
                      }`}
                    >
                      <p className="font-semibold text-sm text-foreground">
                        Distribución HOY: con caja vs sin caja
                      </p>
                      <p className="text-muted-foreground leading-relaxed">{breakdown.hoyBoxMix.summary}</p>
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <div>
                          <div className="text-muted-foreground">Cajones CON caja</div>
                          <div className="font-semibold tabular-nums text-base">
                            ~{breakdown.hoyBoxMix.drawersWithBox.toFixed(1)}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Cajones SIN caja</div>
                          <div className="font-semibold tabular-nums text-base">
                            ~{breakdown.hoyBoxMix.drawersWithoutBox.toFixed(1)}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-md border border-sky-600/30 bg-sky-50/40 dark:bg-sky-950/20 p-3 text-xs space-y-2">
                      <p className="font-semibold text-sm text-foreground">Distribución FUTURA</p>
                      <p className="text-muted-foreground leading-relaxed">{breakdown.futuraBoxMix.summary}</p>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                {selectedId ? (
                  <Button type="button" variant="destructive" onClick={() => void handleDelete()}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Eliminar
                  </Button>
                ) : null}
                <Button type="button" onClick={() => void handleSave()} disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Guardar maestro
                </Button>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

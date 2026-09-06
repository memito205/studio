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
import type { StoreCapacityProfile, StoreDrawerCapacity, StoreInboundQuantities } from '@/types';
import {
  DEFAULT_GARMENTS_PER_DRAWER,
  computeFootwearCapacityBreakdown,
  computeStoreCapacityTotals,
  emptyDrawerRow,
  inventoryTotal,
  normalizePdvCode,
  parseGlobalInventorySheet,
  parseStoreCapacitySheet,
} from '@/lib/storeCapacity';
import {
  applyGlobalStoreInventory,
  deleteStoreCapacityProfile,
  getInboundQuantitiesByWarehouse,
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
    notes: '',
    active: true,
    createdAt: now,
    updatedAt: now,
  };
}

function inboundFor(map: Record<string, StoreInboundQuantities>, code: string): StoreInboundQuantities {
  return map[normalizePdvCode(code)] || { calzado: 0, ropa: 0, accesorios: 0, transferLines: 0, enRutaHoyLines: 0 };
}

export function StoreCapacityModule({ onReturnToSuite }: StoreCapacityModuleProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const capacityFileRef = useRef<HTMLInputElement>(null);
  const inventoryFileRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [importingCapacity, setImportingCapacity] = useState(false);
  const [importingInventory, setImportingInventory] = useState(false);
  const [profiles, setProfiles] = useState<StoreCapacityProfile[]>([]);
  const [inboundByWhs, setInboundByWhs] = useState<Record<string, StoreInboundQuantities>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<StoreCapacityProfile>(blankProfile());
  const [filter, setFilter] = useState('');
  const [garmentsPerDrawer, setGarmentsPerDrawer] = useState(DEFAULT_GARMENTS_PER_DRAWER);
  const [mainTab, setMainTab] = useState<'maestro' | 'tablero'>('maestro');

  const load = useCallback(async () => {
    setLoading(true);
    const [profilesRes, settingsRes, inboundRes] = await Promise.all([
      listStoreCapacityProfiles(),
      getStoreCapacitySettings(),
      getInboundQuantitiesByWarehouse(),
    ]);
    if (!profilesRes.success) {
      toast({ variant: 'destructive', title: 'Error', description: profilesRes.error });
      setProfiles([]);
    } else {
      setProfiles(profilesRes.data || []);
    }
    if (settingsRes.success && settingsRes.data) {
      setGarmentsPerDrawer(settingsRes.data.garmentsPerDrawerForClothing);
    }
    if (inboundRes.success && inboundRes.data) {
      setInboundByWhs(inboundRes.data);
    } else if (!inboundRes.success) {
      toast({
        variant: 'destructive',
        title: 'Inbound TF',
        description: inboundRes.error || 'No se pudo cruzar transferencias.',
      });
      setInboundByWhs({});
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

  const draftInbound = useMemo(
    () => inboundFor(inboundByWhs, draft.pdvCode || selectedId || ''),
    [inboundByWhs, draft.pdvCode, selectedId]
  );

  const totals = useMemo(() => computeStoreCapacityTotals(draft.drawers), [draft.drawers]);
  const breakdown = useMemo(
    () =>
      computeFootwearCapacityBreakdown({
        drawers: draft.drawers,
        ropaOnHand: Number(draft.inventorySnapshot?.ropa) || 0,
        calzadoOnHand: Number(draft.inventorySnapshot?.calzado) || 0,
        calzadoInTransit: draftInbound.calzado,
        ropaInTransit: draftInbound.ropa,
        garmentsPerDrawer,
        exhibitionAffectsCapacity: !!draft.exhibitionAffectsCapacity,
        exhibitionCalzado: draft.exhibitionCalzado,
        exhibitionRopa: draft.exhibitionRopa,
        committedCalzado: draft.inventorySnapshot?.comprometidoCalzado,
        committedRopa: draft.inventorySnapshot?.comprometidoRopa,
      }),
    [
      draft.drawers,
      draft.inventorySnapshot?.ropa,
      draft.inventorySnapshot?.calzado,
      draft.inventorySnapshot?.comprometidoCalzado,
      draft.inventorySnapshot?.comprometidoRopa,
      draft.exhibitionAffectsCapacity,
      draft.exhibitionCalzado,
      draft.exhibitionRopa,
      draftInbound.calzado,
      draftInbound.ropa,
      garmentsPerDrawer,
    ]
  );

  const dashboardRows = useMemo(() => {
    const rows = profiles.map((p) => {
      const inbound = inboundFor(inboundByWhs, p.pdvCode);
      const b = computeFootwearCapacityBreakdown({
        drawers: p.drawers || [],
        ropaOnHand: Number(p.inventorySnapshot?.ropa) || 0,
        calzadoOnHand: Number(p.inventorySnapshot?.calzado) || 0,
        calzadoInTransit: inbound.calzado,
        ropaInTransit: inbound.ropa,
        garmentsPerDrawer,
        exhibitionAffectsCapacity: !!p.exhibitionAffectsCapacity,
        exhibitionCalzado: p.exhibitionCalzado,
        exhibitionRopa: p.exhibitionRopa,
        committedCalzado: p.inventorySnapshot?.comprometidoCalzado,
        committedRopa: p.inventorySnapshot?.comprometidoRopa,
      });
      return { profile: p, inbound, breakdown: b };
    });
    rows.sort((a, b) => b.breakdown.occupancyPct - a.breakdown.occupancyPct);
    return rows;
  }, [profiles, inboundByWhs, garmentsPerDrawer]);

  const boardStats = useMemo(() => {
    const exceeds = dashboardRows.filter((r) => r.breakdown.exceeds).length;
    const ok = dashboardRows.length - exceeds;
    const avg =
      dashboardRows.length > 0
        ? dashboardRows.reduce((s, r) => s + r.breakdown.occupancyPct, 0) / dashboardRows.length
        : 0;
    return { exceeds, ok, avg };
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
    const res = await saveStoreCapacitySettings(garmentsPerDrawer, user?.uid);
    setSavingSettings(false);
    if (!res.success || !res.data) {
      toast({ variant: 'destructive', title: 'No se guardó el parámetro', description: res.error });
      return;
    }
    setGarmentsPerDrawer(res.data.garmentsPerDrawerForClothing);
    toast({
      title: 'Parámetro actualizado',
      description: `Ropa: ${res.data.garmentsPerDrawerForClothing} prendas por cajón.`,
    });
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
          description: 'Active exhibición solo si indica cantidad de calzado y/o ropa en sala.',
        });
        return;
      }
    }
    setSaving(true);
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
      },
      user?.uid
    );
    setSaving(false);
    if (!res.success || !res.data) {
      toast({ variant: 'destructive', title: 'No se guardó', description: res.error });
      return;
    }
    toast({ title: 'Guardado', description: `Capacidad de ${res.data.pdvCode} actualizada.` });
    setSelectedId(res.data.id);
    setDraft(res.data);
    await load();
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
              Cupo de cajones = calzado. Ropa descuenta cajones. Accesorios no afectan. Inventario + TF en tránsito /
              recibido bodega / enviado destino / EN RUTA HOY. Outlet puede restar exhibición de sala.
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
            Parámetro rápido — ropa por cajón
          </CardTitle>
          <CardDescription>
            Cada N prendas de ropa (en almacén + en tránsito) ocupan 1 cajón y reducen el cupo de calzado.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="garmentsPerDrawer">Prendas de ropa por cajón</Label>
            <Input
              id="garmentsPerDrawer"
              type="number"
              min={1}
              className="w-36 tabular-nums font-semibold"
              value={garmentsPerDrawer}
              onChange={(e) => setGarmentsPerDrawer(Math.max(1, Number(e.target.value) || 1))}
            />
          </div>
          <Button type="button" onClick={() => void handleSaveSettings()} disabled={savingSettings}>
            {savingSettings ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Guardar parámetro
          </Button>
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
            {boardStats.exceeds > 0 ? (
              <Badge variant="destructive" className="ml-2">
                {boardStats.exceeds} exceden
              </Badge>
            ) : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tablero" className="space-y-4 mt-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Card>
              <CardHeader className="py-3">
                <CardDescription>Tiendas OK</CardDescription>
                <CardTitle className="text-2xl tabular-nums text-emerald-700">{boardStats.ok}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="py-3">
                <CardDescription>Exceden capacidad</CardDescription>
                <CardTitle className="text-2xl tabular-nums text-red-600">{boardStats.exceeds}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="py-3">
                <CardDescription>Ocupación promedio</CardDescription>
                <CardTitle className="text-2xl tabular-nums">{boardStats.avg.toFixed(0)}%</CardTitle>
              </CardHeader>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Capacidad efectiva vs inventario + inbound TF</CardTitle>
              <CardDescription>
                Incluye En Tránsito, Recibido en Bodega, Enviado a Destino y EN RUTA HOY (sin duplicar TF). Ordenado por %
                ocupación.
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
                      <TableHead className="text-right">Cap. efectiva</TableHead>
                      <TableHead className="text-right">Calz. alm.</TableHead>
                      <TableHead className="text-right">Calz. inbound</TableHead>
                      <TableHead className="text-right">Ropa (caj.)</TableHead>
                      <TableHead className="min-w-[140px]">Ocupación</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dashboardRows.map(({ profile: p, inbound, breakdown: b }) => (
                      <TableRow key={p.id} className={b.exceeds ? 'bg-red-50/60 dark:bg-red-950/20' : undefined}>
                        <TableCell>
                          <div className="font-semibold">{p.pdvCode}</div>
                          <div className="text-xs text-muted-foreground">
                            {p.exhibitionAffectsCapacity ? 'Outlet · exhibición' : p.pdvName || '—'}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {Math.round(b.effectiveCapacityWithBox).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {b.calzadoOnHand.toLocaleString()}
                          {b.committedCalzadoApplied > 0 ? (
                            <div className="text-[10px] text-orange-700 dark:text-orange-300">
                              −{b.committedCalzadoApplied} a sacar
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {inbound.calzado.toLocaleString()}
                          <div className="text-[10px] text-muted-foreground">
                            {inbound.transferLines + inbound.enRutaHoyLines} líneas
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {b.drawersUsedByClothing.toFixed(1)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress
                              value={Math.min(100, Math.max(0, b.occupancyPct))}
                              className="h-2 flex-1"
                            />
                            <span className="text-xs font-semibold tabular-nums w-12 text-right">
                              {b.occupancyPct.toFixed(0)}%
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {b.exceeds ? (
                            <Badge variant="destructive">EXCEDE</Badge>
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
                        <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
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
                    const inbound = inboundFor(inboundByWhs, p.pdvCode);
                    const b = computeFootwearCapacityBreakdown({
                      drawers: p.drawers || [],
                      ropaOnHand: Number(p.inventorySnapshot?.ropa) || 0,
                      calzadoOnHand: Number(p.inventorySnapshot?.calzado) || 0,
                      calzadoInTransit: inbound.calzado,
                      ropaInTransit: inbound.ropa,
                      garmentsPerDrawer,
                      exhibitionAffectsCapacity: !!p.exhibitionAffectsCapacity,
                      exhibitionCalzado: p.exhibitionCalzado,
                      exhibitionRopa: p.exhibitionRopa,
                      committedCalzado: p.inventorySnapshot?.comprometidoCalzado,
                      committedRopa: p.inventorySnapshot?.comprometidoRopa,
                    });
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
                            variant={b.exceeds ? 'destructive' : 'secondary'}
                            className="tabular-nums text-[10px]"
                          >
                            {b.occupancyPct.toFixed(0)}%
                          </Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground tabular-nums">
                          disp. {Math.round(b.available).toLocaleString()}
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
                      <span>Capacidad efectiva</span>
                      <span className="font-semibold tabular-nums text-sky-800 dark:text-sky-300">
                        {Math.round(breakdown.effectiveCapacityWithBox).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Calzado almacén (neto)</span>
                      <span className="tabular-nums">{breakdown.calzadoOnHand.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Inbound TF (calzado)</span>
                      <span className="tabular-nums">
                        {breakdown.calzadoInTransit.toLocaleString()}
                        <span className="text-[10px] text-muted-foreground ml-1">
                          ({draftInbound.transferLines} TF · {draftInbound.enRutaHoyLines} ruta hoy)
                        </span>
                      </span>
                    </div>
                    <div className="border-t pt-2 flex justify-between items-center">
                      <span>Disponible / ocupación</span>
                      <Badge
                        variant={breakdown.exceeds ? 'destructive' : 'default'}
                        className="tabular-nums text-sm"
                      >
                        {Math.round(breakdown.available).toLocaleString()} · {breakdown.occupancyPct.toFixed(0)}%
                        {breakdown.exceeds ? ' EXCEDE' : ''}
                      </Badge>
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

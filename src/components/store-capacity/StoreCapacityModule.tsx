'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  ArrowLeft,
  Box,
  Loader2,
  Plus,
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
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth-context';
import type { StoreCapacityProfile, StoreDrawerCapacity } from '@/types';
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
    inventorySnapshot: { accesorios: 0, calzado: 0, ropa: 0, source: 'manual' },
    notes: '',
    active: true,
    createdAt: now,
    updatedAt: now,
  };
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<StoreCapacityProfile>(blankProfile());
  const [filter, setFilter] = useState('');
  const [garmentsPerDrawer, setGarmentsPerDrawer] = useState(DEFAULT_GARMENTS_PER_DRAWER);

  const load = useCallback(async () => {
    setLoading(true);
    const [profilesRes, settingsRes] = await Promise.all([
      listStoreCapacityProfiles(),
      getStoreCapacitySettings(),
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

  const totals = useMemo(() => computeStoreCapacityTotals(draft.drawers), [draft.drawers]);
  const breakdown = useMemo(
    () =>
      computeFootwearCapacityBreakdown({
        drawers: draft.drawers,
        ropaOnHand: Number(draft.inventorySnapshot?.ropa) || 0,
        calzadoOnHand: Number(draft.inventorySnapshot?.calzado) || 0,
        calzadoInTransit: 0,
        garmentsPerDrawer,
      }),
    [draft.drawers, draft.inventorySnapshot?.ropa, draft.inventorySnapshot?.calzado, garmentsPerDrawer]
  );

  const startNew = () => {
    setSelectedId(null);
    setDraft(blankProfile());
  };

  const selectProfile = (p: StoreCapacityProfile) => {
    setSelectedId(p.id);
    setDraft({
      ...p,
      drawers: p.drawers?.length ? p.drawers.map((d) => ({ ...d })) : [emptyDrawerRow()],
      inventorySnapshot: p.inventorySnapshot
        ? { ...p.inventorySnapshot }
        : { accesorios: 0, calzado: 0, ropa: 0, source: 'manual' },
    });
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
          description: 'No se detectaron hojas con cajones/capacidades. Revise el formato del Excel.',
        });
        return;
      }
      const res = await upsertStoreCapacityProfiles(parsed.filter(Boolean) as any[], user?.uid);
      if (!res.success) {
        toast({ variant: 'destructive', title: 'Importación fallida', description: res.error });
        return;
      }
      toast({
        title: 'Capacidades importadas',
        description: `Se guardaron ${res.saved} tienda(s) (cajones).`,
      });
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
        toast({ variant: 'destructive', title: 'Excel vacío', description: 'No hay hojas en el archivo.' });
        return;
      }
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, unknown>[];
      const { byBodega, rowCount, skipped } = parseGlobalInventorySheet(rows);
      if (byBodega.size === 0) {
        toast({
          variant: 'destructive',
          title: 'Sin filas válidas',
          description: 'Se esperan columnas BODEGA, GRUPO (CALZADO/ROPA/ACCESORIOS) y CANTIDAD.',
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
        description: `${rowCount} filas · ${res.updated} tiendas actualizadas · ${res.created} nuevas${
          skipped ? ` · ${skipped} omitidas` : ''
        }.`,
      });
      await load();
      // Refrescar draft si la tienda abierta recibió inventario
      const code = normalizePdvCode(draft.pdvCode || selectedId || '');
      if (code && payload[code]) {
        setDraft((prev) => ({
          ...prev,
          inventorySnapshot: { ...payload[code] },
        }));
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
              Los cajones definen cupo de <strong>calzado</strong>. La <strong>ropa</strong> descuenta cajones
              (prendas/cajón configurable). Accesorios no afectan el cupo.
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
          <Button
            variant="outline"
            disabled={importingCapacity}
            onClick={() => capacityFileRef.current?.click()}
          >
            {importingCapacity ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            Importar cajones
          </Button>
          <Button
            variant="outline"
            disabled={importingInventory}
            onClick={() => inventoryFileRef.current?.click()}
          >
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
            Cada N prendas de ropa ocupan 1 cajón y reducen el cupo efectivo de calzado. Cambie el valor y guarde.
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
          <p className="text-xs text-muted-foreground max-w-md">
            Inventario global: columnas <code>BODEGA</code>, <code>GRUPO</code> (CALZADO / ROPA / ACCESORIOS) y{' '}
            <code>CANTIDAD</code>.
          </p>
        </CardContent>
      </Card>

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
              <p className="text-sm text-muted-foreground p-3">Sin tiendas. Cree una o importe el Excel.</p>
            ) : (
              filtered.map((p) => {
                const t = computeStoreCapacityTotals(p.drawers || []);
                const b = computeFootwearCapacityBreakdown({
                  drawers: p.drawers || [],
                  ropaOnHand: Number(p.inventorySnapshot?.ropa) || 0,
                  calzadoOnHand: Number(p.inventorySnapshot?.calzado) || 0,
                  garmentsPerDrawer,
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
                      <Badge variant="secondary" className="tabular-nums text-[10px]">
                        {Math.round(b.effectiveCapacityWithBox).toLocaleString()} efect.
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground tabular-nums">
                      bruto {t.totalWithBox.toLocaleString()} · ropa −
                      {b.drawersUsedByClothing.toFixed(1)} caj.
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
                Use el mismo código que en transferencias (<code className="text-xs">bodegaDestino</code>).
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
                  placeholder="Tienda B18"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="notes">Notas</Label>
                <Textarea
                  id="notes"
                  value={draft.notes || ''}
                  onChange={(e) => setDraft((p) => ({ ...p, notes: e.target.value }))}
                  rows={2}
                  placeholder="Observaciones de layout, excepciones…"
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
                <CardDescription>
                  Capacidad base en pares (con/sin caja). La ropa descuenta cajones de este pool.
                </CardDescription>
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
                    <TableHead>Medida cajón</TableHead>
                    <TableHead className="text-right">Cap. con caja</TableHead>
                    <TableHead className="text-right">Cap. sin caja</TableHead>
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
                            onChange={(e) => updateDrawer(d.id, { capacityWithBox: Number(e.target.value) || 0 })}
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
                            onChange={(e) => updateDrawer(d.id, { drawerCount: Number(e.target.value) || 0 })}
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
                            aria-label="Quitar medida"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow className="bg-muted/40 font-semibold">
                    <TableCell colSpan={3}>TOTALES (bruto calzado)</TableCell>
                    <TableCell className="text-right tabular-nums">{totals.totalDrawers.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums text-sky-800 dark:text-sky-300">
                      {totals.totalWithBox.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {totals.totalWithoutBox.toLocaleString()}
                    </TableCell>
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
                  Preferible cargar con <strong>Inventario global</strong>. Edición manual por tienda también válida.
                  Accesorios no restan cupo.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-3 gap-3">
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
                          accesorios: Number(e.target.value) || 0,
                          calzado: p.inventorySnapshot?.calzado ?? 0,
                          ropa: p.inventorySnapshot?.ropa ?? 0,
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
                          accesorios: p.inventorySnapshot?.accesorios ?? 0,
                          calzado: Number(e.target.value) || 0,
                          ropa: p.inventorySnapshot?.ropa ?? 0,
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
                          accesorios: p.inventorySnapshot?.accesorios ?? 0,
                          calzado: p.inventorySnapshot?.calzado ?? 0,
                          ropa: Number(e.target.value) || 0,
                          source: 'manual',
                        },
                      }))
                    }
                  />
                </div>
                <p className="col-span-3 text-sm text-muted-foreground">
                  Total unidades:{' '}
                  <span className="font-semibold text-foreground">
                    {inventoryTotal(draft.inventorySnapshot).toLocaleString()}
                  </span>
                  {draft.inventorySnapshot?.source ? (
                    <span className="ml-2 text-xs">({draft.inventorySnapshot.source})</span>
                  ) : null}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Cupo efectivo de calzado</CardTitle>
                <CardDescription>
                  Ropa ÷ {garmentsPerDrawer} = cajones ocupados. Eso reduce capacidad con caja. Accesorios = 0 efecto.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Cajones totales</span>
                  <span className="tabular-nums">{breakdown.totalDrawers.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-amber-800 dark:text-amber-300">
                  <span>Cajones por ropa</span>
                  <span className="tabular-nums">−{breakdown.drawersUsedByClothing.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Cajones p/ calzado</span>
                  <span className="font-semibold tabular-nums">
                    {breakdown.drawersAvailableForFootwear.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between border-t pt-2">
                  <span>Capacidad bruta c/caja</span>
                  <span className="tabular-nums">{Math.round(breakdown.grossCapacityWithBox).toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-amber-800 dark:text-amber-300">
                  <span>Pérdida por ropa</span>
                  <span className="tabular-nums">
                    −{Math.round(breakdown.capacityLostToClothing).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Capacidad efectiva</span>
                  <span className="font-semibold tabular-nums text-sky-800 dark:text-sky-300">
                    {Math.round(breakdown.effectiveCapacityWithBox).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Calzado en tienda</span>
                  <span className="tabular-nums">{breakdown.calzadoOnHand.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>En tránsito (TF)</span>
                  <span className="tabular-nums text-muted-foreground">0 · próximamente</span>
                </div>
                <div className="border-t pt-2 flex justify-between items-center">
                  <span>Disponible para recibir</span>
                  <Badge
                    variant={breakdown.canReceive ? 'default' : 'destructive'}
                    className="tabular-nums text-sm"
                  >
                    {Math.round(breakdown.available).toLocaleString()} · {breakdown.occupancyPct.toFixed(0)}% ocup.
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
    </div>
  );
}

'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, FileSpreadsheet, Loader2, PackageSearch, RefreshCw, Scale } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/hooks/use-auth-context';
import { useToast } from '@/hooks/use-toast';
import {
  createDistributionCompare,
  listDistributionCompares,
  listReceptionOptionsForCompare,
  type DistributionPlanRowInput,
  type DistributionStockRowInput,
} from '@/app/distributionCompareActions';
import type { DistributionCompareOperation } from '@/types';
import {
  parseExcelFile,
  validatePlanData,
  validateStockData,
} from '@/components/distributor-module/services/parser';

interface Props {
  onReturnToSuite: () => void;
}

function fmt(n: number) {
  return (Number(n) || 0).toLocaleString('es-CO');
}

export default function DistributionCompareModule({ onReturnToSuite }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [view, setView] = useState<'list' | 'new' | 'detail'>('list');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<DistributionCompareOperation[]>([]);
  const [selected, setSelected] = useState<DistributionCompareOperation | null>(null);

  const [receptions, setReceptions] = useState<
    Array<{
      id: string;
      rk_identifier: string;
      supplier: string;
      status: string;
      totalScannedQuantity: number;
      expected_quantity: number;
      created_at: string;
    }>
  >([]);
  const [receptionId, setReceptionId] = useState<string>('');
  const [physicalSource, setPhysicalSource] = useState<'reception_scan' | 'excel_stock'>(
    'reception_scan'
  );
  const [planRows, setPlanRows] = useState<DistributionPlanRowInput[] | null>(null);
  const [planFileName, setPlanFileName] = useState('');
  const [stockRows, setStockRows] = useState<DistributionStockRowInput[] | null>(null);
  const [stockFileName, setStockFileName] = useState('');
  const [notes, setNotes] = useState('');
  const [onlyRemainder, setOnlyRemainder] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const [listRes, recvRes] = await Promise.all([
      listDistributionCompares(60),
      listReceptionOptionsForCompare(100),
    ]);
    if (listRes.success) setItems(listRes.data || []);
    else {
      toast({
        variant: 'destructive',
        title: 'Comparaciones',
        description: listRes.error || 'No se pudo cargar el listado.',
      });
    }
    if (recvRes.success) setReceptions(recvRes.data || []);
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const detailLines = useMemo(() => {
    const lines = selected?.lines || [];
    if (!onlyRemainder) return lines;
    return lines.filter((l) => l.remainderQty !== 0);
  }, [selected, onlyRemainder]);

  const onPlanFile = async (file: File | null) => {
    if (!file) return;
    try {
      const data = await parseExcelFile<DistributionPlanRowInput>(file);
      if (!validatePlanData(data as any[])) {
        throw new Error('Columnas requeridas: REFERENCIA, BODEGA, CANT');
      }
      setPlanRows(data);
      setPlanFileName(file.name);
      toast({ title: 'Distribución cargada', description: `${data.length} filas` });
    } catch (e: any) {
      setPlanRows(null);
      setPlanFileName('');
      toast({
        variant: 'destructive',
        title: 'Archivo de distribución',
        description: e?.message || 'No se pudo leer el Excel.',
      });
    }
  };

  const onStockFile = async (file: File | null) => {
    if (!file) return;
    try {
      const data = await parseExcelFile<DistributionStockRowInput>(file);
      if (!validateStockData(data as any[])) {
        throw new Error('Columnas requeridas: REFERENCIA, NOMBRE, TALLA, CANTD LEIDA');
      }
      setStockRows(data);
      setStockFileName(file.name);
      toast({ title: 'Existencias cargadas', description: `${data.length} filas` });
    } catch (e: any) {
      setStockRows(null);
      setStockFileName('');
      toast({
        variant: 'destructive',
        title: 'Archivo de existencias',
        description: e?.message || 'No se pudo leer el Excel.',
      });
    }
  };

  const handleCreate = async () => {
    if (!user?.uid) {
      toast({ variant: 'destructive', title: 'Sesión', description: 'Inicie sesión.' });
      return;
    }
    if (!planRows?.length) {
      toast({
        variant: 'destructive',
        title: 'Distribución',
        description: 'Suba el Excel de reparto (REFERENCIA, BODEGA, CANT).',
      });
      return;
    }
    setSaving(true);
    const res = await createDistributionCompare({
      receptionOperationId: receptionId || null,
      physicalSource,
      planRows,
      stockRows: stockRows || undefined,
      planFileName,
      stockFileName: stockFileName || undefined,
      notes: notes || undefined,
      createdBy: user.uid,
      createdByName: user.displayName || user.email || user.uid,
    });
    setSaving(false);
    if (!res.success || !res.data) {
      toast({
        variant: 'destructive',
        title: 'No se guardó',
        description: res.error || 'Error al comparar.',
      });
      return;
    }
    toast({
      title: 'Comparación guardada',
      description: `Remanente total: ${fmt(res.data.totals.remainderQty)} und.`,
    });
    setSelected(res.data);
    setView('detail');
    setOnlyRemainder(true);
    await reload();
  };

  const resetNewForm = () => {
    setReceptionId('');
    setPhysicalSource('reception_scan');
    setPlanRows(null);
    setPlanFileName('');
    setStockRows(null);
    setStockFileName('');
    setNotes('');
  };

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-4 max-w-7xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => {
              if (view === 'list') onReturnToSuite();
              else {
                setView('list');
                setSelected(null);
              }
            }}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Scale className="h-6 w-6 text-primary" />
              Físico vs Distribución
            </h1>
            <p className="text-sm text-muted-foreground">
              Fase 1 · Compara lo recibido con el reparto comercial y muestra remanente en bodega
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => void reload()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
          {view === 'list' ? (
            <Button
              type="button"
              onClick={() => {
                resetNewForm();
                setView('new');
              }}
            >
              Nueva comparación
            </Button>
          ) : null}
        </div>
      </div>

      {view === 'list' ? (
        <Card>
          <CardHeader>
            <CardTitle>Comparaciones guardadas</CardTitle>
            <CardDescription>
              No modifica Recepción ni Distribuidor IA. Solo lee recepción y guarda el cruce aquí.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-10 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : items.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground space-y-3">
                <PackageSearch className="h-10 w-10 mx-auto opacity-50" />
                <p>Aún no hay comparaciones. Cree la primera con el reparto comercial.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>RK / Recepción</TableHead>
                      <TableHead>Fuente físico</TableHead>
                      <TableHead className="text-right">Físico</TableHead>
                      <TableHead className="text-right">Distribuido</TableHead>
                      <TableHead className="text-right">Remanente</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((it) => (
                      <TableRow key={it.id}>
                        <TableCell className="whitespace-nowrap text-sm">
                          {it.createdAt ? new Date(it.createdAt).toLocaleString('es-CO') : '—'}
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{it.rkIdentifier || '—'}</div>
                          <div className="text-xs text-muted-foreground">
                            {it.receptionSupplier || it.createdByName || ''}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            {it.physicalSource === 'reception_scan' ? 'Recepción' : 'Excel existencias'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmt(it.totals?.physicalQty)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmt(it.totals?.distributedQty)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">
                          {fmt(it.totals?.remainderQty)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={it.status === 'open' ? 'default' : 'outline'}>
                            {it.status === 'open' ? 'Abierta' : 'Archivada'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setSelected(it);
                              setView('detail');
                            }}
                          >
                            Ver
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {view === 'new' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>1. Físico recibido</CardTitle>
              <CardDescription>
                Preferido: escaneos de una recepción. Alternativa: Excel de existencias (mismo formato
                del Distribuidor IA).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Fuente del físico</Label>
                <Select
                  value={physicalSource}
                  onValueChange={(v) => setPhysicalSource(v as 'reception_scan' | 'excel_stock')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="reception_scan">Recepción (escaneos por referencia)</SelectItem>
                    <SelectItem value="excel_stock">Excel existencias (CANTD LEIDA)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Operación de recepción {physicalSource === 'reception_scan' ? '*' : '(opcional)'}</Label>
                <Select value={receptionId || undefined} onValueChange={setReceptionId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccione RK / recepción" />
                  </SelectTrigger>
                  <SelectContent>
                    {receptions.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.rk_identifier} · {r.status} · esc {fmt(r.totalScannedQuantity)} / esp{' '}
                        {fmt(r.expected_quantity)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {physicalSource === 'excel_stock' ? (
                <div className="space-y-2">
                  <Label>Archivo existencias *</Label>
                  <Input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={(e) => void onStockFile(e.target.files?.[0] || null)}
                  />
                  {stockFileName ? (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <FileSpreadsheet className="h-3 w-3" /> {stockFileName} ({stockRows?.length || 0}{' '}
                      filas)
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="space-y-2">
                <Label>Notas</Label>
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Opcional"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>2. Distribución comercial</CardTitle>
              <CardDescription>
                Excel de reparto: columnas <strong>REFERENCIA</strong>, <strong>BODEGA</strong>,{' '}
                <strong>CANT</strong> (igual que Distribuidor IA).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Archivo de distribución *</Label>
                <Input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => void onPlanFile(e.target.files?.[0] || null)}
                />
                {planFileName ? (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <FileSpreadsheet className="h-3 w-3" /> {planFileName} ({planRows?.length || 0} filas)
                  </p>
                ) : null}
              </div>

              <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1">
                <p className="font-medium">Cálculo</p>
                <p>Remanente = Físico − Distribuido (por referencia).</p>
                <p className="text-muted-foreground">
                  Ej.: llegaron 300, se repartieron 280 → quedan 20 en bodega.
                </p>
              </div>

              <Button type="button" className="w-full" disabled={saving} onClick={() => void handleCreate()}>
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Comparando…
                  </>
                ) : (
                  'Comparar y guardar'
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {view === 'detail' && selected ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Físico</CardDescription>
                <CardTitle className="text-3xl tabular-nums">{fmt(selected.totals.physicalQty)}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Distribuido</CardDescription>
                <CardTitle className="text-3xl tabular-nums">
                  {fmt(selected.totals.distributedQty)}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Remanente bodega</CardDescription>
                <CardTitle className="text-3xl tabular-nums text-amber-600">
                  {fmt(selected.totals.remainderQty)}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground pt-0">
                {selected.totals.referencesWithRemainder} referencias con sobrante &gt; 0
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>
                  Detalle {selected.rkIdentifier ? `· ${selected.rkIdentifier}` : ''}
                </CardTitle>
                <CardDescription>
                  {selected.physicalSource === 'reception_scan' ? 'Físico desde recepción' : 'Físico desde Excel'}
                  {selected.planFileName ? ` · Plan: ${selected.planFileName}` : ''}
                  {selected.notes ? ` · ${selected.notes}` : ''}
                </CardDescription>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={onlyRemainder}
                  onChange={(e) => setOnlyRemainder(e.target.checked)}
                />
                Solo diferencias ≠ 0
              </label>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Referencia</TableHead>
                    <TableHead className="text-right">Físico</TableHead>
                    <TableHead className="text-right">Distribuido</TableHead>
                    <TableHead className="text-right">Remanente</TableHead>
                    <TableHead>Tiendas (reparto)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailLines.map((line) => (
                    <TableRow key={line.reference}>
                      <TableCell className="font-medium">{line.reference}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(line.physicalQty)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmt(line.distributedQty)}
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums font-semibold ${
                          line.remainderQty > 0
                            ? 'text-amber-600'
                            : line.remainderQty < 0
                              ? 'text-red-600'
                              : ''
                        }`}
                      >
                        {fmt(line.remainderQty)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[280px]">
                        {line.byBodega?.length
                          ? line.byBodega.map((b) => `${b.bodega}:${b.qty}`).join(' · ')
                          : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {detailLines.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">Sin filas para mostrar.</p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

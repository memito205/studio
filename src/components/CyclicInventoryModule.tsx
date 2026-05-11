'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { ArrowLeft, ClipboardList, Loader2, RefreshCw, Upload } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth-context';
import type { CyclicInventoryLine, CyclicInventoryRun } from '@/types';
import { findCaseInsensitiveKey, parseRobustNumber } from '@/lib/parsingUtils';
import { getCyclicCountDiff } from '@/lib/cyclicInventoryDiff';
import {
  closeCyclicInventoryRun,
  createCyclicInventoryRun,
  getCyclicInventoryLines,
  importCyclicInventoryLines,
  listCyclicInventoryRuns,
  saveCyclicInventoryLineCount,
} from '@/app/cyclicInventoryActions';

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
  const [runs, setRuns] = useState<CyclicInventoryRun[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string>('');
  const [lines, setLines] = useState<CyclicInventoryLine[]>([]);
  const [loadingLines, setLoadingLines] = useState(false);
  const [filterRef, setFilterRef] = useState('');
  const [filterLoc, setFilterLoc] = useState('');
  const [onlyPending, setOnlyPending] = useState(false);

  const [newRunName, setNewRunName] = useState('');
  const [newRunWarehouse, setNewRunWarehouse] = useState('');
  const [creatingRun, setCreatingRun] = useState(false);
  const [importing, setImporting] = useState(false);
  const [newRunIdForImport, setNewRunIdForImport] = useState<string | null>(null);

  const canAdmin = role === 'admin' || role === 'supervisor';

  const loadRuns = useCallback(async () => {
    setLoadingRuns(true);
    try {
      const res = await listCyclicInventoryRuns(50);
      if (!res.success || !res.data) {
        throw new Error(res.error || 'No se pudieron cargar los conteos.');
      }
      setRuns(res.data);
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: e instanceof Error ? e.message : 'Error desconocido',
      });
    } finally {
      setLoadingRuns(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    if (selectedRunId) return;
    if (runs.length === 0) return;
    const firstActive = runs.find((r) => r.status === 'active') || runs[0];
    setSelectedRunId(firstActive.id);
  }, [runs, selectedRunId]);

  const loadLines = useCallback(async () => {
    if (!selectedRunId) {
      setLines([]);
      return;
    }
    setLoadingLines(true);
    try {
      const res = await getCyclicInventoryLines(selectedRunId);
      if (!res.success || !res.data) {
        throw new Error(res.error || 'No se pudieron cargar las líneas.');
      }
      setLines(res.data);
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
  }, [selectedRunId, toast]);

  useEffect(() => {
    void loadLines();
  }, [loadLines]);

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

  const handleCreateRun = async () => {
    if (!user?.uid) {
      toast({ variant: 'destructive', title: 'Sesión', description: 'Inicie sesión.' });
      return;
    }
    if (!newRunName.trim()) {
      toast({ variant: 'destructive', title: 'Nombre', description: 'Indique un nombre para el conteo.' });
      return;
    }
    setCreatingRun(true);
    try {
      const res = await createCyclicInventoryRun({
        name: newRunName.trim(),
        warehouseLabel: newRunWarehouse.trim(),
        createdBy: user.uid,
        createdByName: user.displayName || user.email || '',
      });
      if (!res.success || !res.id) {
        throw new Error(res.error || 'No se pudo crear el conteo.');
      }
      toast({ title: 'Conteo creado', description: 'Ahora puede importar el archivo Excel.' });
      setNewRunIdForImport(res.id);
      setNewRunName('');
      setNewRunWarehouse('');
      await loadRuns();
      setSelectedRunId(res.id);
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: e instanceof Error ? e.message : 'Error',
      });
    } finally {
      setCreatingRun(false);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const runId = newRunIdForImport || selectedRunId;
    if (!runId) {
      toast({ variant: 'destructive', title: 'Conteo', description: 'Seleccione o cree un conteo activo primero.' });
      return;
    }
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet) as unknown[];
      const rows = parseImportRows(json);
      if (rows.length === 0) {
        throw new Error('No se encontraron filas válidas. Use columnas: Referencia, Talla, Ubicación, Cantidad esperada.');
      }
      const res = await importCyclicInventoryLines({ runId, lines: rows });
      if (!res.success) {
        throw new Error(res.error || 'Error al importar.');
      }
      toast({ title: 'Importación lista', description: `Se cargaron ${res.imported ?? 0} líneas.` });
      setNewRunIdForImport(null);
      await loadLines();
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
    const res = await saveCyclicInventoryLineCount({ lineId: line.id, countedQty: n, countedBy: user.uid });
    if (!res.success) {
      toast({ variant: 'destructive', title: 'Guardar', description: res.error || 'Error' });
      return;
    }
    setLines((prev) =>
      prev.map((x) =>
        x.id === line.id
          ? {
              ...x,
              countedQty: n,
              countedAt: new Date().toISOString(),
              countedBy: user.uid,
            }
          : x
      )
    );
  };

  const handleCloseRun = async () => {
    if (!selectedRunId) return;
    if (!confirm('¿Cerrar este conteo? Los operarios ya no podrán editar líneas en este run.')) return;
    const res = await closeCyclicInventoryRun(selectedRunId);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'Cerrar', description: res.error });
      return;
    }
    toast({ title: 'Conteo cerrado' });
    await loadRuns();
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
              Compare cantidad esperada vs física: cuadrado, faltante o sobrante. Cada guardado queda fechado en base de datos.
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
          {canAdmin ? <TabsTrigger value="nuevo">Nuevo conteo / importar</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="conteo" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Ejecutar conteo</CardTitle>
              <CardDescription>
                Seleccione el conteo activo, filtre por referencia o ubicación e ingrese la cantidad física. El resultado se
                calcula al instante respecto a la esperada.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-4 items-end">
                <div className="space-y-2 min-w-[220px]">
                  <Label>Conteo</Label>
                  <Select
                    value={selectedRunId}
                    onValueChange={(v) => setSelectedRunId(v)}
                    disabled={loadingRuns || runs.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={loadingRuns ? 'Cargando…' : 'Seleccione'} />
                    </SelectTrigger>
                    <SelectContent>
                      {runs.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.name} — {r.status === 'active' ? 'Activo' : 'Cerrado'}{' '}
                          {r.warehouseLabel ? `(${r.warehouseLabel})` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button type="button" variant="secondary" size="sm" onClick={() => void loadRuns()} disabled={loadingRuns}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${loadingRuns ? 'animate-spin' : ''}`} />
                  Actualizar lista
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => void loadLines()} disabled={loadingLines}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${loadingLines ? 'animate-spin' : ''}`} />
                  Recargar líneas
                </Button>
              </div>

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
                        <TableHead>Resultado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredLines.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                            No hay líneas o ninguna coincide con el filtro.
                          </TableCell>
                        </TableRow>
                      ) : (
                        filteredLines.map((line) => {
                          const selectedRun = runs.find((r) => r.id === selectedRunId);
                          const readOnly = selectedRun?.status === 'closed';
                          return (
                            <TableRow key={line.id}>
                              <TableCell className="font-mono text-sm">{line.reference}</TableCell>
                              <TableCell className="text-right font-medium">{line.expectedQty}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">{line.location || '—'}</TableCell>
                              <TableCell>
                                <CountInput
                                  line={line}
                                  disabled={readOnly}
                                  onSave={(v) => void handleSaveCount(line, v)}
                                />
                              </TableCell>
                              <TableCell>{diffBadge(line)}</TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {canAdmin ? (
          <TabsContent value="nuevo" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Crear conteo e importar plantilla</CardTitle>
                <CardDescription>
                  Excel: columnas reconocidas (cualquier orden): <strong>Referencia</strong>, <strong>Talla</strong> (se
                  guarda; en pantalla de conteo v1 solo ref / esperada / ubicación), <strong>Ubicación</strong> (puede
                  vacío), <strong>Cantidad esperada</strong> (también: Esperada, Stock, Inventario, Existencia).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 max-w-xl">
                <div className="space-y-2">
                  <Label>Nombre del conteo</Label>
                  <Input value={newRunName} onChange={(e) => setNewRunName(e.target.value)} placeholder="Ej: Cíclico bodega principal 12/05/2026" />
                </div>
                <div className="space-y-2">
                  <Label>Bodega / contexto (opcional)</Label>
                  <Input value={newRunWarehouse} onChange={(e) => setNewRunWarehouse(e.target.value)} placeholder="Ej: Principal" />
                </div>
                <Button onClick={() => void handleCreateRun()} disabled={creatingRun}>
                  {creatingRun ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Crear conteo vacío
                </Button>
                <div className="space-y-2 pt-4 border-t">
                  <Label>Importar Excel al conteo seleccionado arriba (o al recién creado)</Label>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" asChild disabled={importing || (!selectedRunId && !newRunIdForImport)}>
                      <label className="cursor-pointer">
                        <Upload className="mr-2 h-4 w-4 inline" />
                        {importing ? 'Importando…' : 'Elegir archivo'}
                        <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(ev) => void handleImportFile(ev)} />
                      </label>
                    </Button>
                    {(newRunIdForImport || selectedRunId) && (
                      <span className="text-xs text-muted-foreground font-mono">Run: {newRunIdForImport || selectedRunId}</span>
                    )}
                  </div>
                </div>
                <Button variant="destructive" size="sm" onClick={() => void handleCloseRun()} disabled={!selectedRunId}>
                  Cerrar conteo seleccionado
                </Button>
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
  disabled: boolean;
  onSave: (value: string) => void;
}> = ({ line, disabled, onSave }) => {
  const [val, setVal] = useState(
    line.countedQty !== null && line.countedQty !== undefined ? String(line.countedQty) : ''
  );
  useEffect(() => {
    setVal(line.countedQty !== null && line.countedQty !== undefined ? String(line.countedQty) : '');
  }, [line.countedQty, line.id]);
  return (
    <div className="flex gap-1 items-center">
      <Input
        className="h-8 w-24"
        inputMode="numeric"
        disabled={disabled}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => {
          if (val === '' && (line.countedQty === null || line.countedQty === undefined)) return;
          if (val === String(line.countedQty ?? '')) return;
          onSave(val);
        }}
      />
      <Button type="button" size="sm" variant="secondary" className="h-8 px-2" disabled={disabled} onClick={() => onSave(val)}>
        OK
      </Button>
    </div>
  );
};

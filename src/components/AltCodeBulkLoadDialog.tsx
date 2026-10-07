"use client";

import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { FileDown, Loader2, Upload } from 'lucide-react';
import {
  applyAltCodeBulkLoad,
  previewAltCodeBulkLoad,
  type AltCodeBulkAction,
  type AltCodeBulkInputRow,
  type AltCodeBulkPreviewRow,
} from '@/app/actions';
import type { TransferActor } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { ToastAction } from '@/components/ui/toast';
import { buildAltCodeStickersPdf, openPdfForPrint } from '@/lib/labelPdf';

const ACTION_LABEL: Record<AltCodeBulkAction, string> = {
  enlazar: 'Se enlaza con TF',
  pendiente: 'Queda pendiente (sin TF)',
  despachada: 'TF ya despachada (se ignora)',
  antigua: 'TF antigua (revisar)',
  ya_registrado: 'Ya registrado (se ignora)',
  repetido: 'Repetido en archivo',
  vacio: 'Fila vacía',
};

const ACTION_STYLE: Record<AltCodeBulkAction, string> = {
  enlazar: 'bg-green-600 text-white',
  pendiente: 'bg-amber-500 text-white',
  despachada: 'bg-slate-500 text-white',
  antigua: 'bg-red-600 text-white',
  ya_registrado: 'bg-slate-300 text-slate-900',
  repetido: 'bg-slate-300 text-slate-900',
  vacio: 'bg-slate-200 text-slate-700',
};

const ACTIONS = Object.keys(ACTION_LABEL) as AltCodeBulkAction[];

const normHeader = (h: string) =>
  h.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z]/g, '');

function parseBulkRows(rows: Record<string, unknown>[]): AltCodeBulkInputRow[] {
  if (rows.length === 0) return [];
  const headers = Object.keys(rows[0]);
  const find = (...needles: string[]) => headers.find((h) => needles.some((n) => normHeader(h).includes(n)));
  const codeKey = find('ALTERN') || find('CODIGO') || headers[0];
  const ubicKey = find('UBICACI');
  const destKey = find('DESTINO', 'BODEGA');
  const packKey = find('EMPAC', 'RESPONSABLE', 'REGISTRA', 'RECIBE');
  return rows.map((r) => ({
    codigoAlterno: String(r[codeKey] ?? '').trim(),
    ubicacion: ubicKey ? String(r[ubicKey] ?? '').trim() : '',
    destino: destKey ? String(r[destKey] ?? '').trim() : '',
    empacador: packKey ? String(r[packKey] ?? '').trim() : '',
  }));
}

export const AltCodeBulkLoadDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actor?: TransferActor;
  onApplied: () => void;
  mode?: 'inicial' | 'listado';
}> = ({ open, onOpenChange, actor, onApplied, mode = 'inicial' }) => {
  const isList = mode === 'listado';
  const { toast } = useToast();
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<AltCodeBulkInputRow[]>([]);
  const [maxDays, setMaxDays] = useState(90);
  const [preview, setPreview] = useState<AltCodeBulkPreviewRow[] | null>(null);
  const [filter, setFilter] = useState<'all' | AltCodeBulkAction>('all');
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null);

  const counts = useMemo(() => {
    const c = Object.fromEntries(ACTIONS.map((a) => [a, 0])) as Record<AltCodeBulkAction, number>;
    (preview || []).forEach((p) => (c[p.action] += 1));
    return c;
  }, [preview]);
  const unknownLocations = useMemo(() => (preview || []).filter((p) => p.ubicacionDesconocida).length, [preview]);
  const visible = useMemo(() => (preview || []).filter((p) => filter === 'all' || p.action === filter), [preview, filter]);

  const reset = () => {
    setFileName('');
    setRows([]);
    setPreview(null);
    setFilter('all');
  };

  const runPreview = async (input: AltCodeBulkInputRow[], days: number) => {
    setBusy('preview');
    const res = await previewAltCodeBulkLoad(input, days);
    setBusy(null);
    if (!res.success || !res.preview) {
      toast({ variant: 'destructive', title: 'No se pudo analizar', description: res.error });
      return;
    }
    setPreview(res.preview);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const parsed = parseBulkRows(XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false }));
      if (parsed.length === 0) {
        toast({ variant: 'destructive', title: 'Archivo vacío' });
        return;
      }
      setFileName(file.name);
      setRows(parsed);
      await runPreview(parsed, maxDays);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'No se pudo leer el Excel', description: err?.message });
    }
  };

  const downloadTemplate = () => {
    const ws = XLSX.utils.json_to_sheet([
      isList
        ? { 'CODIGO ALTERNO': '', UBICACION: '', REGISTRA: '', DESTINO: '' }
        : { 'CODIGO ALTERNO': '', UBICACION: '', DESTINO: '', EMPACADOR: '' },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, isList ? 'Listado' : 'Carga inicial');
    XLSX.writeFile(wb, isList ? 'plantilla_listado_codigos_alternos.xlsx' : 'plantilla_carga_inicial_codigos_alternos.xlsx');
  };

  const downloadPreview = () => {
    if (!preview) return;
    const ws = XLSX.utils.json_to_sheet(
      preview.map((p) => ({
        Fila: p.fila,
        'Código alterno': p.codigoAlterno,
        Ubicación: p.ubicacion,
        'Ubicación fuera del maestro': p.ubicacionDesconocida ? 'Sí' : '',
        Destino: p.destino,
        Empacador: p.empacador,
        Resultado: ACTION_LABEL[p.action],
        TF: p.tfs,
        'Destino TF': p.destinos,
        'Estado TF': p.estados,
        'Fecha TF': p.fechaTf ? format(new Date(p.fechaTf), 'dd/MM/yyyy') : '',
        Nota: p.nota,
      }))
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Vista previa');
    XLSX.writeFile(wb, `vista_previa_carga_codigos_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`);
  };

  const handleApply = async () => {
    setBusy('apply');
    const res = await applyAltCodeBulkLoad(rows, maxDays, actor, mode);
    setBusy(null);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'No se aplicó la carga', description: res.error });
      return;
    }
    toast({
      title: isList ? 'Listado registrado' : 'Carga inicial aplicada',
      ...(isList && res.stickers?.length
        ? {
            action: (
              <ToastAction altText="Imprimir etiquetas" onClick={() => openPdfForPrint(buildAltCodeStickersPdf(res.stickers!))}>
                Imprimir {res.stickers.length} etiqueta(s)
              </ToastAction>
            ),
          }
        : {}),
      description: `${res.linked} enlazadas a su TF (Recibido en Bodega) · ${res.pending} pendientes de TF · ${res.skipped} ignoradas.`,
      duration: isList ? 60000 : 10000,
    });
    reset();
    onOpenChange(false);
    onApplied();
  };

  const applicable = counts.enlazar + counts.pendiente;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) { if (!o) reset(); onOpenChange(o); } }}>
      <DialogContent className="max-w-5xl h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{isList ? 'Registrar listado de códigos alternos (Excel)' : 'Carga inicial de códigos alternos'}</DialogTitle>
          <DialogDescription>
            {isList ? (
              <>
                Para cajas que <strong>llegaron hoy a bodega</strong> y no se escanearon una a una (p. ej. operador externo sin Suite).
                Columnas: <strong>CODIGO ALTERNO</strong>, <strong>UBICACION</strong>, <strong>REGISTRA</strong> (quien recibe) y DESTINO
                (opcional). Cada código queda registrado igual que el registro manual, con la hora de esta carga: si su TF ya está, pasa a
                Recibido en Bodega; si no, queda pendiente y se enlaza sola al subir transferencias. No hay que volver a escanearlas.
              </>
            ) : (
              <>
                Suba el Excel de las cajas de código alterno que <strong>realmente están en bodega hoy</strong>. Cada código se registra
                como si se hubiera escaneado: si su TF existe y no ha salido, pasa a Recibido en Bodega con esa ubicación; si no
                existe, queda pendiente y se enlaza sola al subir transferencias. Lo despachado y lo ya registrado no se toca.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
            {busy === 'preview' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {fileName ? 'Cambiar archivo' : 'Seleccionar Excel'}
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} disabled={!!busy} />
          </label>
          <Button variant="outline" size="sm" onClick={downloadTemplate}>
            <FileDown className="mr-2 h-4 w-4" /> Plantilla
          </Button>
          <div>
            <Label className="text-xs">No enlazar TF con más de (días)</Label>
            <Input
              type="number"
              min={1}
              value={maxDays}
              onChange={(e) => setMaxDays(Math.max(1, Number(e.target.value) || 90))}
              onBlur={() => rows.length > 0 && void runPreview(rows, maxDays)}
              className="h-9 w-[120px]"
            />
          </div>
          {fileName && <span className="text-xs text-muted-foreground">{fileName} · {rows.length} fila(s)</span>}
        </div>

        {preview && (
          <>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setFilter('all')}>
                <Badge variant={filter === 'all' ? 'default' : 'outline'}>Todas ({preview.length})</Badge>
              </button>
              {ACTIONS.filter((a) => counts[a] > 0).map((a) => (
                <button type="button" key={a} onClick={() => setFilter(a)}>
                  <Badge className={cn(ACTION_STYLE[a], filter === a && 'ring-2 ring-offset-1 ring-primary')}>
                    {ACTION_LABEL[a]}: {counts[a]}
                  </Badge>
                </button>
              ))}
              {unknownLocations > 0 && (
                <Badge variant="outline" className="border-amber-500 text-amber-800">
                  {unknownLocations} ubicación(es) fuera del maestro
                </Badge>
              )}
            </div>
            <ScrollArea className="flex-grow rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 bg-secondary z-10">
                  <TableRow>
                    <TableHead>Fila</TableHead>
                    <TableHead>Código alterno</TableHead>
                    <TableHead>Ubicación</TableHead>
                    <TableHead>Resultado</TableHead>
                    <TableHead>TF</TableHead>
                    <TableHead>Destino TF</TableHead>
                    <TableHead>Estado TF</TableHead>
                    <TableHead>Fecha TF</TableHead>
                    <TableHead>Nota</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.slice(0, 1000).map((p) => (
                    <TableRow key={p.fila}>
                      <TableCell className="text-xs">{p.fila}</TableCell>
                      <TableCell className="text-xs font-bold">{p.codigoAlterno || '—'}</TableCell>
                      <TableCell className={cn('text-xs', p.ubicacionDesconocida && 'text-amber-700 font-semibold')}>
                        {p.ubicacion || '—'}
                      </TableCell>
                      <TableCell><Badge className={cn('text-[10px]', ACTION_STYLE[p.action])}>{ACTION_LABEL[p.action]}</Badge></TableCell>
                      <TableCell className="text-xs">{p.tfs}</TableCell>
                      <TableCell className="text-xs">{p.destinos}</TableCell>
                      <TableCell className="text-xs">{p.estados}</TableCell>
                      <TableCell className="text-xs">{p.fechaTf ? format(new Date(p.fechaTf), 'dd/MM/yyyy') : ''}</TableCell>
                      <TableCell className="text-xs">{p.nota}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {visible.length > 1000 && (
                <p className="p-2 text-center text-xs text-muted-foreground">Mostrando 1000 de {visible.length}. Descargue la vista previa para ver todo.</p>
              )}
            </ScrollArea>
          </>
        )}

        <DialogFooter className="gap-2">
          {preview && (
            <Button variant="outline" onClick={downloadPreview} disabled={!!busy}>
              <FileDown className="mr-2 h-4 w-4" /> Descargar vista previa
            </Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={!!busy}>Cancelar</Button>
          <Button onClick={() => void handleApply()} disabled={!preview || applicable === 0 || !!busy}>
            {busy === 'apply' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Aplicar ({counts.enlazar} enlazar · {counts.pendiente} pendientes)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

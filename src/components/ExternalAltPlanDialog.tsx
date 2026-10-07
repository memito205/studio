"use client";

import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { FileDown, Loader2, Upload } from 'lucide-react';
import {
  applyExternalAltPlan,
  previewExternalAltPlan,
  type ExternalAltPlanAction,
  type ExternalAltPlanPreviewRow,
  type ExternalAltPlanRow,
} from '@/app/actions';
import type { TransferActor } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

const ACTION_LABEL: Record<ExternalAltPlanAction, string> = {
  asignar: 'Se asigna a la TF',
  espera: 'En espera (TF aún no en la Suite)',
  ya_asignado: 'Ya tenía este código',
  conflicto: 'Conflicto (revisar)',
  varios_destinos: 'TF con varios destinos',
  codigo_en_uso: 'Código usado en otra TF',
  despachada: 'TF ya despachada',
  repetido: 'Repetido en archivo',
  vacio: 'Fila incompleta',
};

const ACTION_STYLE: Record<ExternalAltPlanAction, string> = {
  asignar: 'bg-green-600 text-white',
  espera: 'bg-amber-500 text-white',
  ya_asignado: 'bg-slate-300 text-slate-900',
  conflicto: 'bg-red-600 text-white',
  varios_destinos: 'bg-red-600 text-white',
  codigo_en_uso: 'bg-red-600 text-white',
  despachada: 'bg-slate-500 text-white',
  repetido: 'bg-slate-300 text-slate-900',
  vacio: 'bg-slate-200 text-slate-700',
};

const ACTIONS = Object.keys(ACTION_LABEL) as ExternalAltPlanAction[];

const normHeader = (h: string) =>
  h.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z]/g, '');

function parsePlanRows(rows: Record<string, unknown>[]): ExternalAltPlanRow[] {
  if (rows.length === 0) return [];
  const headers = Object.keys(rows[0]);
  const find = (...needles: string[]) => headers.find((h) => needles.some((n) => normHeader(h).includes(n)));
  const codeKey = find('ALTERN') || find('CODIGO');
  const tfKey = headers.find((h) => /^(TF|NUMEROTF|NROTF|NOTF|TRANSFERENCIA|DOCUMENTO)$/.test(normHeader(h))) || find('TRANSFER', 'NUMEROTF');
  const destKey = find('DESTINO') || find('TIENDA');
  if (!codeKey || !tfKey) return [];
  return rows.map((r) => ({
    numeroTF: String(r[tfKey] ?? '').trim(),
    codigoAlterno: String(r[codeKey] ?? '').trim(),
    destino: destKey ? String(r[destKey] ?? '').trim() : '',
  }));
}

export const ExternalAltPlanDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actor?: TransferActor;
  onApplied: () => void;
}> = ({ open, onOpenChange, actor, onApplied }) => {
  const { toast } = useToast();
  const [fileName, setFileName] = useState('');
  const [operador, setOperador] = useState('');
  const [rows, setRows] = useState<ExternalAltPlanRow[]>([]);
  const [preview, setPreview] = useState<ExternalAltPlanPreviewRow[] | null>(null);
  const [filter, setFilter] = useState<'all' | ExternalAltPlanAction>('all');
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null);

  const counts = useMemo(() => {
    const c = Object.fromEntries(ACTIONS.map((a) => [a, 0])) as Record<ExternalAltPlanAction, number>;
    (preview || []).forEach((p) => (c[p.action] += 1));
    return c;
  }, [preview]);
  const visible = useMemo(() => (preview || []).filter((p) => filter === 'all' || p.action === filter), [preview, filter]);

  const reset = () => {
    setFileName('');
    setRows([]);
    setPreview(null);
    setFilter('all');
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const parsed = parsePlanRows(XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false }));
      if (parsed.length === 0) {
        toast({ variant: 'destructive', title: 'Plano no válido', description: 'Debe tener columnas TF y CODIGO ALTERNO (DESTINO opcional).' });
        return;
      }
      setFileName(file.name);
      setRows(parsed);
      setBusy('preview');
      const res = await previewExternalAltPlan(parsed);
      setBusy(null);
      if (!res.success || !res.preview) {
        toast({ variant: 'destructive', title: 'No se pudo analizar', description: res.error });
        return;
      }
      setPreview(res.preview);
    } catch (err: any) {
      setBusy(null);
      toast({ variant: 'destructive', title: 'No se pudo leer el Excel', description: err?.message });
    }
  };

  const downloadTemplate = () => {
    const ws = XLSX.utils.json_to_sheet([{ TF: '', 'CODIGO ALTERNO': '', DESTINO: '' }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Plano');
    XLSX.writeFile(wb, 'plantilla_plano_operador_externo.xlsx');
  };

  const downloadPreview = () => {
    if (!preview) return;
    const ws = XLSX.utils.json_to_sheet(
      preview.map((p) => ({
        Fila: p.fila,
        TF: p.numeroTF,
        'Código alterno': p.codigoAlterno,
        Destino: p.destino,
        Resultado: ACTION_LABEL[p.action],
        'Destino TF': p.destinos,
        'Estado TF': p.estados,
        Nota: p.nota,
      }))
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Vista previa');
    XLSX.writeFile(wb, `vista_previa_plano_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`);
  };

  const handleApply = async () => {
    setBusy('apply');
    const res = await applyExternalAltPlan(rows, operador, actor);
    setBusy(null);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'No se aplicó el plano', description: res.error });
      return;
    }
    toast({
      title: 'Plano aplicado',
      description: `${res.assigned} código(s) asignados a su TF · ${res.waiting} en espera de la TF · ${res.skipped} sin aplicar.`,
      duration: 10000,
    });
    reset();
    onOpenChange(false);
    onApplied();
  };

  const applicable = counts.asignar + counts.espera;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) { if (!o) reset(); onOpenChange(o); } }}>
      <DialogContent className="max-w-5xl h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Plano de operador externo</DialogTitle>
          <DialogDescription>
            Suba el plano que manda el operador <strong>antes</strong> de que llegue la mercancía: columnas <strong>TF</strong>,{' '}
            <strong>CODIGO ALTERNO</strong> y <strong>DESTINO</strong> (opcional, solo si la TF va a varios destinos). El código queda
            en la TF; cuando la caja llegue se escanea aquí como cualquier código alterno (recibe, ubica e imprime). No cambia el estado de
            ninguna TF. Si la TF aún no está en la Suite, queda en espera y se asigna sola al subir el Excel de transferencias.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs">Operador externo *</Label>
            <Input value={operador} onChange={(e) => setOperador(e.target.value.toUpperCase())} placeholder="Nombre del operador" className="h-9 w-[220px]" />
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
            {busy === 'preview' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {fileName ? 'Cambiar archivo' : 'Seleccionar plano'}
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} disabled={!!busy} />
          </label>
          <Button variant="outline" size="sm" onClick={downloadTemplate}>
            <FileDown className="mr-2 h-4 w-4" /> Plantilla
          </Button>
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
            </div>
            <div className="flex-grow overflow-auto rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 bg-secondary z-10">
                  <TableRow>
                    <TableHead>Fila</TableHead>
                    <TableHead>TF</TableHead>
                    <TableHead>Código alterno</TableHead>
                    <TableHead>Resultado</TableHead>
                    <TableHead>Destino TF</TableHead>
                    <TableHead>Estado TF</TableHead>
                    <TableHead>Nota</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.slice(0, 1000).map((p) => (
                    <TableRow key={p.fila}>
                      <TableCell className="text-xs">{p.fila}</TableCell>
                      <TableCell className="text-xs font-semibold">{p.numeroTF || '—'}</TableCell>
                      <TableCell className="text-xs font-bold">{p.codigoAlterno || '—'}</TableCell>
                      <TableCell><Badge className={cn('text-[10px]', ACTION_STYLE[p.action])}>{ACTION_LABEL[p.action]}</Badge></TableCell>
                      <TableCell className="text-xs">{p.destinos || p.destino}</TableCell>
                      <TableCell className="text-xs">{p.estados}</TableCell>
                      <TableCell className="text-xs">{p.nota}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {visible.length > 1000 && (
                <p className="p-2 text-center text-xs text-muted-foreground">Mostrando 1000 de {visible.length}. Descargue la vista previa para ver todo.</p>
              )}
            </div>
          </>
        )}

        <DialogFooter className="gap-2">
          {preview && (
            <Button variant="outline" onClick={downloadPreview} disabled={!!busy}>
              <FileDown className="mr-2 h-4 w-4" /> Descargar vista previa
            </Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={!!busy}>Cancelar</Button>
          <Button onClick={() => void handleApply()} disabled={!preview || applicable === 0 || !operador.trim() || !!busy}>
            {busy === 'apply' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Aplicar ({counts.asignar} asignar · {counts.espera} en espera)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

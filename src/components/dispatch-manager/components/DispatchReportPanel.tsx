"use client";

import React, { useMemo, useState } from 'react';
import { format, startOfDay, endOfDay, subDays } from 'date-fns';
import { FileDown, Loader2, Truck } from 'lucide-react';
import type { SavedVerification, VerificationDispatchClass } from '@/types';
import { getManifestAltCodeRows } from '@/app/actions';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/components/dispatch-manager/utils/cn';
import {
  DISPATCH_CLASSES,
  DISPATCH_CLASS_LABEL,
  computeDispatchIndicators,
  downloadAltCodesExcel,
  exportDispatchReportExcel,
  isClosedCargueSession,
  sessionClosedAt,
} from '@/components/dispatch-manager/utils/dispatchReport';
import { arrivalLabel } from '@/components/dispatch-manager/utils/verificationScan';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const CLASS_COLOR: Record<VerificationDispatchClass, string> = {
  ambas: 'text-green-700',
  solo_cargue: 'text-blue-700',
  solo_alistamiento: 'text-orange-600',
  no_encontrada: 'text-red-600',
  sin_leer: 'text-muted-foreground',
};

const CLASS_ROW: Partial<Record<VerificationDispatchClass, string>> = {
  ambas: 'bg-green-50',
  solo_cargue: 'bg-blue-50',
  solo_alistamiento: 'bg-orange-50',
  no_encontrada: 'bg-red-50',
};

const timeLabel = (v: unknown) => {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v as string);
  return Number.isNaN(d.getTime()) ? '' : format(d, 'HH:mm');
};

/** Botón para volver a descargar el Excel de códigos alternos de un despacho cerrado. */
export const AltCodesButton: React.FC<{ session: SavedVerification; size?: 'sm' | 'default' }> = ({ session, size = 'sm' }) => {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const manifestDocId = session.dispatchClose?.manifestDocId;
  if (!manifestDocId) return null;
  const handle = async () => {
    setBusy(true);
    const res = await getManifestAltCodeRows(manifestDocId);
    setBusy(false);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'Error', description: res.error });
      return;
    }
    if (!res.rows?.length) {
      toast({ title: 'Sin códigos alternos', description: 'Ninguna TF de esta relación tiene código alterno.' });
      return;
    }
    downloadAltCodesExcel(res.rows, {
      sessionName: session.name,
      manifestId: session.dispatchClose?.manifestId,
      placa: session.cargue?.placa,
      fecha: sessionClosedAt(session),
    });
  };
  return (
    <Button variant="outline" size={size} onClick={() => void handle()} disabled={busy}>
      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />}
      Códigos alternos
    </Button>
  );
};

/** Pestaña de detalle del despacho (doble lectura) dentro del diálogo del historial. */
export const DispatchSessionDetail: React.FC<{ session: SavedVerification }> = ({ session }) => {
  const [filter, setFilter] = useState<'all' | VerificationDispatchClass>('all');
  const ind = useMemo(() => computeDispatchIndicators([session]), [session]);
  const rows = useMemo(
    () =>
      (session.results || [])
        .filter((i) => filter === 'all' || i.dispatchClass === filter)
        .sort((a, b) => DISPATCH_CLASSES.indexOf(a.dispatchClass || 'sin_leer') - DISPATCH_CLASSES.indexOf(b.dispatchClass || 'sin_leer')),
    [session, filter]
  );
  const close = session.dispatchClose;

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="flex items-center gap-1 font-semibold"><Truck className="h-4 w-4" /> {session.cargue?.placa || '—'}</span>
          <span>Conductor: <strong>{session.cargue?.conductor || '—'}</strong></span>
          {session.cargue?.auxiliares && <span>Aux: {session.cargue.auxiliares}</span>}
          <span>Relación <strong>#{close?.manifestId ?? '—'}</strong></span>
          <span className="text-muted-foreground">
            Cerró {close?.closedByName || '—'} {sessionClosedAt(session) ? format(sessionClosedAt(session)!, 'dd/MM/yyyy HH:mm') : ''}
          </span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => exportDispatchReportExcel([session], session.name)}>
            <FileDown className="mr-2 h-4 w-4" /> Excel despacho
          </Button>
          <AltCodesButton session={session} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {DISPATCH_CLASSES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setFilter((f) => (f === c ? 'all' : c))}
            className={cn('rounded-md border p-2 text-left transition', filter === c && 'ring-2 ring-primary')}
          >
            <p className="text-[10px] uppercase text-muted-foreground">{DISPATCH_CLASS_LABEL[c]}</p>
            <p className={cn('text-xl font-bold', CLASS_COLOR[c])}>{ind.byClass[c]}</p>
          </button>
        ))}
      </div>

      {(ind.reasons.length > 0 || (close?.skipped?.length || 0) > 0) && (
        <div className="flex flex-wrap gap-2 text-xs">
          {ind.reasons.map((r) => (
            <Badge key={r.motivo} variant="outline" className="border-orange-400 text-orange-800">
              {r.motivo}: {r.cajas}
            </Badge>
          ))}
          {(close?.skipped?.length || 0) > 0 && (
            <Badge variant="destructive">{close!.skipped!.length} cargada(s) no entraron en la relación</Badge>
          )}
        </div>
      )}

      <ScrollArea className="flex-grow">
        <Table>
          <TableHeader className="sticky top-0 bg-secondary z-10">
            <TableRow>
              <TableHead>Clasificación</TableHead>
              <TableHead>Código</TableHead>
              <TableHead>Destino</TableHead>
              <TableHead>Ubicación</TableHead>
              <TableHead>Llegada</TableHead>
              <TableHead>Cant.</TableHead>
              <TableHead>Alistó</TableHead>
              <TableHead>Cargue</TableHead>
              <TableHead>Motivo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((item, idx) => (
              <TableRow key={item.codigo + idx} className={cn(item.dispatchClass && CLASS_ROW[item.dispatchClass])}>
                <TableCell className="text-xs">
                  <span className={cn('font-semibold', item.dispatchClass && CLASS_COLOR[item.dispatchClass])}>
                    {item.dispatchClass ? DISPATCH_CLASS_LABEL[item.dispatchClass] : '—'}
                  </span>
                  {item.outOfPlan && <Badge className="ml-1 bg-blue-600 text-white text-[9px]">Fuera plan</Badge>}
                </TableCell>
                <TableCell className="text-xs font-bold">{item.codigo}</TableCell>
                <TableCell className="text-xs">{item.destino}</TableCell>
                <TableCell className="text-xs font-bold">{item.ubicacion || '—'}</TableCell>
                <TableCell className="text-xs">{arrivalLabel(item.fechaLlegada)}</TableCell>
                <TableCell className="text-xs">{item.cantTft}</TableCell>
                <TableCell className="text-xs">{timeLabel(item.scanTime)}</TableCell>
                <TableCell className="text-xs">
                  {timeLabel(item.loadedAt)} {item.loadedByName || ''}
                </TableCell>
                <TableCell className="text-xs">{item.notLoadedReason || ''}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  );
};

/** Reporte por rango de fechas de los despachos cerrados con cargue. */
export const DispatchReportPanel: React.FC<{ sessions: SavedVerification[] }> = ({ sessions }) => {
  const [from, setFrom] = useState(format(subDays(new Date(), 7), 'yyyy-MM-dd'));
  const [to, setTo] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [destino, setDestino] = useState('all');

  const closed = useMemo(() => sessions.filter(isClosedCargueSession), [sessions]);
  const destinos = useMemo(
    () => Array.from(new Set(closed.flatMap((s) => (s.results || []).map((i) => i.destino)))).filter(Boolean).sort(),
    [closed]
  );

  const inRange = useMemo(() => {
    const start = startOfDay(new Date(`${from}T00:00:00`));
    const end = endOfDay(new Date(`${to}T00:00:00`));
    return closed
      .filter((s) => {
        const d = sessionClosedAt(s);
        return d && d >= start && d <= end;
      })
      .map((s) => (destino === 'all' ? s : { ...s, results: (s.results || []).filter((i) => i.destino === destino) }))
      .filter((s) => (s.results || []).length > 0);
  }, [closed, from, to, destino]);

  const ind = useMemo(() => computeDispatchIndicators(inRange), [inRange]);
  const loaded = ind.byClass.ambas + ind.byClass.solo_cargue;
  const picked = ind.byClass.ambas + ind.byClass.solo_alistamiento;

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Reporte de despachos (alistamiento + cargue)</CardTitle>
        <CardDescription>
          Solo despachos cerrados con doble lectura. Las validaciones anteriores a la Fase 4 no aparecen aquí.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs">Desde</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-[160px]" />
          </div>
          <div>
            <Label className="text-xs">Hasta</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-[160px]" />
          </div>
          <div>
            <Label className="text-xs">Destino</Label>
            <Select value={destino} onValueChange={setDestino}>
              <SelectTrigger className="h-9 w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {destinos.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            disabled={inRange.length === 0}
            onClick={() => exportDispatchReportExcel(inRange, `${from}_a_${to}${destino === 'all' ? '' : `_${destino}`}`)}
          >
            <FileDown className="mr-2 h-4 w-4" /> Descargar Excel ({inRange.length} despacho(s))
          </Button>
        </div>

        {inRange.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No hay despachos cerrados con cargue en este rango.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
              <Kpi label="Despachos" value={ind.despachos} />
              <Kpi label="Cajas en camión" value={loaded} className="text-green-700" />
              <Kpi label="Unidades cargadas" value={ind.unidadesCargadas} />
              <Kpi
                label="Alistadas sin cargar"
                value={ind.byClass.solo_alistamiento}
                hint={picked ? `${Math.round((ind.byClass.solo_alistamiento / picked) * 100)}% de lo alistado` : undefined}
                className="text-orange-600"
              />
              <Kpi label="Solo cargue" value={ind.byClass.solo_cargue} hint={`${ind.outOfPlanLoaded} fuera del plan`} className="text-blue-700" />
              <Kpi label="No encontradas" value={ind.byClass.no_encontrada} className="text-red-600" />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <MiniTable title="Motivos de no cargue" head={['Motivo', 'Cajas']} rows={ind.reasons.map((r) => [r.motivo, r.cajas])} />
              <MiniTable title="No encontradas por destino" head={['Destino', 'Cajas']} rows={ind.notFoundByDest.map((r) => [r.destino, r.cajas])} />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

const Kpi: React.FC<{ label: string; value: number; hint?: string; className?: string }> = ({ label, value, hint, className }) => (
  <div className="rounded-md border p-3">
    <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
    <p className={cn('text-2xl font-bold', className)}>{value}</p>
    {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
  </div>
);

const MiniTable: React.FC<{ title: string; head: [string, string]; rows: Array<[string, number]> }> = ({ title, head, rows }) => (
  <div className="rounded-md border">
    <p className="border-b px-3 py-2 text-sm font-semibold">{title}</p>
    {rows.length === 0 ? (
      <p className="px-3 py-4 text-xs text-muted-foreground">Sin datos.</p>
    ) : (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{head[0]}</TableHead>
            <TableHead className="text-right">{head[1]}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(([k, v]) => (
            <TableRow key={k}>
              <TableCell className="text-xs">{k}</TableCell>
              <TableCell className="text-right text-xs font-bold">{v}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )}
  </div>
);

"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { AlertTriangle, Loader2, RefreshCw, Save, Trash2 } from 'lucide-react';
import { getEtiquetadoDayBreakdown } from '@/app/bodegaTvActions';
import {
  correctLabelingActivityLogTimestamp,
  correctLabelingActivityLogUnits,
  deleteLabelingActivityLog,
  purgeDuplicateFinishLogsForOperations,
} from '@/app/reception/actions';
import type { EtiquetadoContributionRow, EtiquetadoDayBreakdown } from '@/lib/bodegaTvTypes';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

function toDayKey(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocalValue(value: string): string {
  const d = new Date(value);
  return d.toISOString();
}

function sourceLabel(source: EtiquetadoContributionRow['source']): string {
  return source === 'finish' ? 'FINISH' : 'LIVE caja';
}

type Draft = { timestampLocal: string; units: string };

interface Props {
  day: Date;
}

export const EtiquetadoLiveAuditPanel: React.FC<Props> = ({ day }) => {
  const { toast } = useToast();
  const dayKey = useMemo(() => toDayKey(day), [day]);
  const [data, setData] = useState<EtiquetadoDayBreakdown | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [purging, setPurging] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const result = await getEtiquetadoDayBreakdown(dayKey);
    if (result.success && result.data) {
      setData(result.data);
      const next: Record<string, Draft> = {};
      for (const row of result.data.contributions) {
        next[row.id] = {
          timestampLocal: toDatetimeLocalValue(row.timestamp),
          units: String(row.units),
        };
      }
      setDrafts(next);
    } else {
      setData(null);
      toast({
        variant: 'destructive',
        title: 'No se pudo cargar la auditoría',
        description: result.error || 'Error desconocido',
      });
    }
    setLoading(false);
  }, [dayKey, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const purgeDuplicates = async () => {
    if (!data) return;
    const opIds = [
      ...new Set(
        data.contributions
          .filter((r) => r.source === 'finish' && r.excluded)
          .map((r) => r.operationId)
      ),
    ];
    if (opIds.length === 0) {
      toast({ title: 'No hay FINISH duplicados para limpiar' });
      return;
    }
    setPurging(true);
    try {
      const r = await purgeDuplicateFinishLogsForOperations(opIds);
      if (!r.success) {
        toast({ variant: 'destructive', title: 'Error al limpiar', description: r.error });
        return;
      }
      toast({
        title: 'Duplicados eliminados',
        description: `Se borraron ${r.deleted || 0} FINISH extra. Queda 1 por tarea; el total ya no los duplica. Si bajaste und a la mitad, vuelve a poner el valor real en el FINISH que quedó.`,
      });
      await load();
    } finally {
      setPurging(false);
    }
  };

  const deleteRow = async (row: EtiquetadoContributionRow) => {
    if (!row.logId) {
      toast({
        variant: 'destructive',
        title: 'Sin ID de log',
        description: 'No se puede borrar este registro.',
      });
      return;
    }
    const isCountingFinish = row.source === 'finish' && !row.excluded;
    const ok = window.confirm(
      isCountingFinish
        ? `¿Borrar la finalización de ${row.reference} (${row.units} und)?\n\nDejará de sumar a la productividad del día. Si era el único FINISH, la tarea vuelve a Pausada.`
        : `¿Borrar este registro (${sourceLabel(row.source)} · ${row.reference})?`
    );
    if (!ok) return;

    setSavingId(row.id);
    try {
      const r = await deleteLabelingActivityLog(row.operationId, row.logId);
      if (!r.success) {
        toast({ variant: 'destructive', title: 'Error al borrar', description: r.error });
        return;
      }
      toast({
        title: 'Log borrado',
        description: r.reopened
          ? 'Ya no suma al total. La tarea quedó en Pausada para reabrir el trabajo.'
          : 'Ya no suma al total.',
      });
      await load();
    } finally {
      setSavingId(null);
    }
  };

  const saveRow = async (row: EtiquetadoContributionRow) => {
    if (!row.logId) {
      toast({
        variant: 'destructive',
        title: 'Sin ID de log',
        description: 'Este aporte no tiene id de Firestore; no se puede corregir desde aquí.',
      });
      return;
    }
    const draft = drafts[row.id];
    if (!draft) return;

    const units = Math.round(Number(draft.units));
    if (!Number.isFinite(units) || units < 0) {
      toast({ variant: 'destructive', title: 'Unidades inválidas' });
      return;
    }
    if (!draft.timestampLocal) {
      toast({ variant: 'destructive', title: 'Fecha inválida' });
      return;
    }

    setSavingId(row.id);
    try {
      const tsChanged = toDatetimeLocalValue(row.timestamp) !== draft.timestampLocal;
      const unitsChanged = row.units !== units;

      if (tsChanged) {
        const r = await correctLabelingActivityLogTimestamp(
          row.operationId,
          row.logId,
          fromDatetimeLocalValue(draft.timestampLocal)
        );
        if (!r.success) {
          toast({ variant: 'destructive', title: 'Error al corregir fecha', description: r.error });
          return;
        }
      }
      if (unitsChanged) {
        const r = await correctLabelingActivityLogUnits(row.operationId, row.logId, units);
        if (!r.success) {
          toast({ variant: 'destructive', title: 'Error al corregir und', description: r.error });
          return;
        }
      }
      if (!tsChanged && !unitsChanged) {
        toast({ title: 'Sin cambios' });
        return;
      }
      toast({
        title: 'Corrección guardada',
        description: 'Bodega Live y el tablero se recalculan con la nueva fecha/und.',
      });
      await load();
    } finally {
      setSavingId(null);
    }
  };

  const total = data?.totalUnits || 0;

  return (
    <Card className="border-amber-500/30 shadow-sm">
      <CardHeader className="bg-amber-500/5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="text-lg">Auditoría Bodega Live · Etiquetado</CardTitle>
            <CardDescription className="mt-1">
              Qué está sumando el TV el {format(day, "d MMM yyyy", { locale: es })}: cada FINISH y
              cada caja LIVE del día. Corrige fecha/und o borra un FINISH equivocado (deja de
              sumar productividad).
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {(data?.omittedFinishDuplicates || 0) > 0 ? (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void purgeDuplicates()}
                disabled={loading || purging}
              >
                {purging ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-2 h-4 w-4" />
                )}
                Eliminar duplicados
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Recargar
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {loading && !data ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
            <Loader2 className="h-5 w-5 animate-spin" />
            Cargando aportes del día…
          </div>
        ) : data ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">FINISH (cerradas)</p>
                <p className="text-2xl font-bold tabular-nums">{data.finishUnits.toLocaleString()}</p>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">LIVE (cajas hoy)</p>
                <p className="text-2xl font-bold tabular-nums">{data.liveUnits.toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                <p className="text-xs text-muted-foreground">Total TV (= FINISH + LIVE)</p>
                <p className="text-2xl font-bold tabular-nums">{data.totalUnits.toLocaleString()}</p>
              </div>
            </div>
            {(data.omittedFinishDuplicates || 0) > 0 ? (
              <p className="text-sm text-amber-700 dark:text-amber-400 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                Se omitieron {data.omittedFinishDuplicates} FINISH duplicado(s) de la misma tarea (no
                suman al total).
              </p>
            ) : null}

            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fuente</TableHead>
                    <TableHead>Operario</TableHead>
                    <TableHead>Referencia</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Fecha log</TableHead>
                    <TableHead className="text-right">Und</TableHead>
                    <TableHead className="w-[100px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.contributions.map((row) => {
                    const draft = drafts[row.id] || {
                      timestampLocal: toDatetimeLocalValue(row.timestamp),
                      units: String(row.units),
                    };
                    const share = total > 0 && !row.excluded ? (row.units / total) * 100 : 0;
                    const suspicious = !row.excluded && (share >= 35 || row.units >= 500);
                    return (
                      <TableRow
                        key={row.id}
                        className={cn(
                          suspicious && 'bg-amber-500/10',
                          row.excluded && 'bg-muted/40 opacity-70'
                        )}
                      >
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <Badge variant={row.source === 'finish' ? 'default' : 'secondary'}>
                              {sourceLabel(row.source)}
                            </Badge>
                            {row.excluded ? (
                              <span className="inline-flex items-center gap-1 text-[10px] text-red-600 dark:text-red-400">
                                <AlertTriangle className="h-3 w-3" />
                                {row.excludeReason || 'No suma'}
                              </span>
                            ) : null}
                            {suspicious ? (
                              <span className="inline-flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-400">
                                <AlertTriangle className="h-3 w-3" /> Alto vs día
                              </span>
                            ) : null}
                            <span className="text-[10px] text-muted-foreground font-mono">
                              {row.operationId.slice(0, 8)}…
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[160px] text-sm font-medium">
                          <div className="truncate" title={row.operatorLabel}>
                            {row.operatorLabel}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[120px] truncate text-sm">{row.reference}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {row.status}
                          {row.trackingMode ? (
                            <div className="text-[10px]">{row.trackingMode}</div>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Input
                            type="datetime-local"
                            className="h-8 w-[190px] text-xs"
                            value={draft.timestampLocal}
                            onChange={(e) =>
                              setDrafts((prev) => ({
                                ...prev,
                                [row.id]: { ...draft, timestampLocal: e.target.value },
                              }))
                            }
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={0}
                            className="h-8 w-24 ml-auto text-right tabular-nums"
                            value={draft.units}
                            onChange={(e) =>
                              setDrafts((prev) => ({
                                ...prev,
                                [row.id]: { ...draft, units: e.target.value },
                              }))
                            }
                          />
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            {row.unitsSource}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            {!row.excluded ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={!row.logId || savingId === row.id}
                                onClick={() => void saveRow(row)}
                              >
                                {savingId === row.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <>
                                    <Save className="mr-1 h-3.5 w-3.5" />
                                    Guardar
                                  </>
                                )}
                              </Button>
                            ) : null}
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={!row.logId || savingId === row.id}
                              onClick={() => void deleteRow(row)}
                            >
                              {savingId === row.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <>
                                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                                  Borrar
                                </>
                              )}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {data.contributions.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="h-20 text-center text-muted-foreground">
                        No hay aportes FINISH ni LIVE para este día.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground">
              El total solo cuenta un FINISH por tarea. Si alguien finalizó mal y te infló el día:{' '}
              <strong>Borrar</strong> ese FINISH (deja de sumar; la tarea vuelve a Pausada). Si ves
              duplicados, usa <strong>Eliminar duplicados</strong>. Corregir und/fecha solo cambia
              ese log.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground py-6 text-center">Sin datos.</p>
        )}
      </CardContent>
    </Card>
  );
};

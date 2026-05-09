'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, CalendarRange, ChevronDown, ClipboardCheck, Download, Loader2, RefreshCw, Warehouse } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { endOfWeek, format, parseISO, startOfWeek } from 'date-fns';
import { es } from 'date-fns/locale';
import { exportToXlsx } from '@/services/export';
import {
  getReceptionSamplesAuditReport,
  type ReceptionSampleAuditRow,
  type ReceptionSamplesAuditScanContext,
  type ReceptionSamplesAuditStats,
} from '@/app/receptionSampleAuditActions';
import { RECEPTION_SAMPLE_AUDIT_START_ISO } from '@/lib/receptionSampleAudit';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { loadReceptionOperations } from '@/app/reception/actions';
import type { ReceptionOperation } from '@/types';

function defaultWeekYmDs(): { fromYmd: string; toYmd: string } {
  const ws = startOfWeek(new Date(), { weekStartsOn: 1 });
  const we = endOfWeek(new Date(), { weekStartsOn: 1 });
  return { fromYmd: format(ws, 'yyyy-MM-dd'), toYmd: format(we, 'yyyy-MM-dd') };
}

function localDayStartIso(dateYmd: string): string {
  const [y, m, d] = dateYmd.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}

function localDayEndIso(dateYmd: string): string {
  const [y, m, d] = dateYmd.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
}

function ReceptionOperationsCell({
  ids,
  labels,
}: {
  ids: string[];
  labels: string[];
}) {
  const n = ids.length;
  if (n === 0) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }
  if (n === 1) {
    return <span className="font-mono text-xs">{labels[0]}</span>;
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1 font-normal max-w-[200px]">
          <span className="truncate text-xs">{labels.length} operaciones</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3" align="start">
        <p className="text-xs font-medium text-muted-foreground mb-2">Recepciones (RK) donde llegó la referencia</p>
        <ul className="text-sm space-y-1.5 max-h-60 overflow-y-auto">
          {labels.map((lbl, i) => (
            <li key={ids[i]} className="font-mono text-xs border-b border-border/40 pb-1 last:border-0 last:pb-0">
              {lbl}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export interface ReceptionSamplesAuditReportProps {
  onReturn?: () => void;
}

type RowFilter = 'all' | 'missing_validation' | 'missing_photo' | 'missing_tf' | 'fully_ok';

function matchesFilter(r: ReceptionSampleAuditRow, f: RowFilter): boolean {
  switch (f) {
    case 'missing_validation':
      return !r.hasVerificationSinceCutoff;
    case 'missing_photo':
      return !r.inSampleDatabase;
    case 'missing_tf':
      return !r.hasTransferDelivery;
    case 'fully_ok':
      return (
        r.hasVerificationSinceCutoff &&
        r.inSampleDatabase &&
        r.hasTransferDelivery
      );
    default:
      return true;
  }
}

export const ReceptionSamplesAuditReport: React.FC<ReceptionSamplesAuditReportProps> = ({
  onReturn,
}) => {
  const { toast } = useToast();
  const initialWeek = useMemo(() => defaultWeekYmDs(), []);

  const [loading, setLoading] = useState(false);
  const [reportTab, setReportTab] = useState<'dates' | 'operation'>('dates');
  const [dateFrom, setDateFrom] = useState(initialWeek.fromYmd);
  const [dateTo, setDateTo] = useState(initialWeek.toYmd);
  const [selectedOpId, setSelectedOpId] = useState<string>('');
  const [operations, setOperations] = useState<ReceptionOperation[]>([]);
  const [loadingOps, setLoadingOps] = useState(false);

  const [rows, setRows] = useState<ReceptionSampleAuditRow[]>([]);
  const [validationCutoffIso, setValidationCutoffIso] = useState(RECEPTION_SAMPLE_AUDIT_START_ISO);
  const [scanContext, setScanContext] = useState<ReceptionSamplesAuditScanContext | null>(null);
  const [pagesHint, setPagesHint] = useState<number | undefined>();
  const [stats, setStats] = useState<ReceptionSamplesAuditStats | null>(null);
  const [filter, setFilter] = useState<RowFilter>('all');
  const [search, setSearch] = useState('');

  const applyServerReport = useCallback(
    (res: Awaited<ReturnType<typeof getReceptionSamplesAuditReport>>) => {
      if (!res.success) {
        throw new Error(res.error || 'No se pudo cargar el reporte.');
      }
      setRows(res.rows ?? []);
      setValidationCutoffIso(res.validationCutoffIso ?? res.cutoffIso ?? RECEPTION_SAMPLE_AUDIT_START_ISO);
      setScanContext(res.scanContext ?? null);
      setPagesHint(res.scannedPages);
      setStats(res.stats ?? null);
    },
    []
  );

  const refreshByDates = useCallback(
    async (fromYmd: string, toYmd: string) => {
      setLoading(true);
      try {
        const res = await getReceptionSamplesAuditReport({
          scanDateFromIso: localDayStartIso(fromYmd),
          scanDateToIso: localDayEndIso(toYmd),
        });
        applyServerReport(res);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Error desconocido';
        toast({ variant: 'destructive', title: 'Error', description: msg });
        setRows([]);
        setStats(null);
        setScanContext(null);
      } finally {
        setLoading(false);
      }
    },
    [applyServerReport, toast]
  );

  const refreshByOperation = useCallback(
    async (opId: string) => {
      if (!opId.trim()) {
        toast({
          variant: 'destructive',
          title: 'Operación requerida',
          description: 'Seleccione una operación de recepción.',
        });
        return;
      }
      setLoading(true);
      try {
        const res = await getReceptionSamplesAuditReport({
          receptionOperationId: opId.trim(),
        });
        applyServerReport(res);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Error desconocido';
        toast({ variant: 'destructive', title: 'Error', description: msg });
        setRows([]);
        setStats(null);
        setScanContext(null);
      } finally {
        setLoading(false);
      }
    },
    [applyServerReport, toast]
  );

  useEffect(() => {
    void refreshByDates(initialWeek.fromYmd, initialWeek.toYmd);
    // Solo montaje: semana actual calculada una vez (evita bucles si refreshByDates cambia identidad).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (reportTab !== 'operation') return;
    let cancelled = false;
    setLoadingOps(true);
    void loadReceptionOperations().then((res) => {
      if (cancelled) return;
      if (res.success && res.data?.operations) {
        const sorted = [...res.data.operations].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        setOperations(sorted);
      } else if (!res.success) {
        toast({ variant: 'destructive', title: 'Operaciones', description: res.error || 'No se pudieron cargar.' });
      }
      setLoadingOps(false);
    });
    return () => {
      cancelled = true;
    };
  }, [reportTab, toast]);

  const validationCutoffLabel = useMemo(() => {
    try {
      return format(parseISO(validationCutoffIso), 'PPP', { locale: es });
    } catch {
      return validationCutoffIso;
    }
  }, [validationCutoffIso]);

  const scanScopeDescription = useMemo(() => {
    if (!scanContext) return null;
    if (scanContext.type === 'operation') {
      const op = operations.find((o) => o.id === scanContext.receptionOperationId);
      const rk = op?.rk_identifier?.trim() || scanContext.receptionOperationId;
      return (
        <>
          Escaneos solo de la operación <strong className="font-mono">{rk}</strong>
          {op?.supplier ? (
            <>
              {' '}
              (<span className="text-muted-foreground">{op.supplier}</span>)
            </>
          ) : null}
          .
        </>
      );
    }
    try {
      const a = format(parseISO(scanContext.dateFromIso!), 'PP', { locale: es });
      const b = format(parseISO(scanContext.dateToIso!), 'PP', { locale: es });
      return (
        <>
          Escaneos entre <strong>{a}</strong> y <strong>{b}</strong> (hora local del equipo → ISO en servidor).
        </>
      );
    } catch {
      return <>Rango de fechas aplicado en servidor.</>;
    }
  }, [scanContext, operations]);

  const excelContextLabel = useMemo(() => {
    if (!scanContext) return '';
    if (scanContext.type === 'operation') {
      const op = operations.find((o) => o.id === scanContext.receptionOperationId);
      return op?.rk_identifier || scanContext.receptionOperationId || '';
    }
    try {
      const a = format(parseISO(scanContext.dateFromIso!), 'yyyy-MM-dd', { locale: es });
      const b = format(parseISO(scanContext.dateToIso!), 'yyyy-MM-dd', { locale: es });
      return `${a} → ${b}`;
    } catch {
      return 'rango';
    }
  }, [scanContext, operations]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toUpperCase();
    return rows.filter((r) => matchesFilter(r, filter) && (!q || r.reference.includes(q)));
  }, [rows, filter, search]);

  const summary = useMemo(() => {
    const total = filteredRows.length;
    const withVer = filteredRows.filter((r) => r.hasVerificationSinceCutoff).length;
    const inDb = filteredRows.filter((r) => r.inSampleDatabase).length;
    const withTf = filteredRows.filter((r) => r.hasTransferDelivery).length;
    const gaps = filteredRows.filter(
      (r) => !r.hasVerificationSinceCutoff || !r.inSampleDatabase || !r.hasTransferDelivery
    ).length;
    return { total, withVer, inDb, withTf, gaps };
  }, [filteredRows]);

  const handleExport = () => {
    if (filteredRows.length === 0) {
      toast({ variant: 'destructive', title: 'Sin datos', description: 'No hay filas para exportar.' });
      return;
    }
    exportToXlsx(
      filteredRows.map((r) => ({
        Contexto_escaneo: excelContextLabel,
        Referencia: r.reference,
        'Operaciones RK': r.receptionOperationLabels.join('; '),
        'Validación guardada (≥ corte)': r.hasVerificationSinceCutoff ? 'Sí' : 'No',
        'Muestra en BD (foto)': r.inSampleDatabase ? 'Sí' : 'No',
        'TF entrega registrado': r.hasTransferDelivery ? 'Sí' : 'No',
        'Números TF': r.transferNumbers,
      })),
      'cruce_recepcion_muestras'
    );
    toast({ title: 'Exportado', description: 'Archivo generado.' });
  };

  const handlePrimaryRefresh = () => {
    if (reportTab === 'operation') {
      void refreshByOperation(selectedOpId);
    } else {
      void refreshByDates(dateFrom, dateTo);
    }
  };

  const applyThisWeek = () => {
    const { fromYmd, toYmd } = defaultWeekYmDs();
    setDateFrom(fromYmd);
    setDateTo(toYmd);
    void refreshByDates(fromYmd, toYmd);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 flex-wrap">
              <ClipboardCheck className="h-5 w-5 text-primary shrink-0" />
              Cruce recepción ↔ control de muestras
            </CardTitle>
            <CardDescription className="max-w-3xl space-y-2">
              <p>
                Referencias distintas según el <strong>alcance de escaneos</strong> que elijas abajo, cruzadas con
                validación de muestras (sesiones guardadas desde{' '}
                <strong>{validationCutoffLabel}</strong>), foto en BD y TF en{' '}
                <code className="text-xs bg-muted px-1 rounded">sampleDeliveries</code>.
              </p>
              {scanScopeDescription ? (
                <p className="text-sm border-l-2 border-primary/30 pl-2">{scanScopeDescription}</p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Firebase cobra por lecturas de documentos: en modo fechas depende del rango; en modo operación solo los
                escaneos de esa recepción (sin filtrar por calendario en consulta).
              </p>
              {stats && (
                <p className="text-xs text-muted-foreground border-l-2 border-muted pl-2 space-y-0.5">
                  <span className="block">
                    Última corrida — lecturas aprox.:{' '}
                    <strong>{stats.scannedItemDocsRead.toLocaleString()}</strong> docs{' '}
                    <span className="text-muted-foreground">(recepción)</span>
                    {' + '}
                    <strong>{stats.verificationDocsRead.toLocaleString()}</strong>{' '}
                    <span className="text-muted-foreground">(verificaciones ≥ corte)</span>
                    {' + '}
                    <strong>{stats.deliveryDocsRead.toLocaleString()}</strong>{' '}
                    <span className="text-muted-foreground">(entregas TF)</span>
                    {' + '}
                    <strong>{stats.receptionOperationDocsRead.toLocaleString()}</strong>{' '}
                    <span className="text-muted-foreground">(operaciones RK)</span>
                    {pagesHint != null ? (
                      <>
                        {' · '}
                        {pagesHint} ronda(s) paginación escaneos
                      </>
                    ) : null}
                    . Más lecturas en <code className="bg-muted px-1 rounded">sampleReferences</code>.
                  </span>
                </p>
              )}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {onReturn && (
              <Button variant="outline" size="sm" onClick={onReturn}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Volver
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={handlePrimaryRefresh} disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Actualizar
            </Button>
            <Button variant="secondary" size="sm" onClick={handleExport} disabled={loading || filteredRows.length === 0}>
              <Download className="mr-2 h-4 w-4" />
              Exportar Excel
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={reportTab} onValueChange={(v) => setReportTab(v as 'dates' | 'operation')} className="w-full">
            <TabsList className="grid w-full max-w-md grid-cols-2">
              <TabsTrigger value="dates" className="gap-2">
                <CalendarRange className="h-4 w-4" />
                Por fechas
              </TabsTrigger>
              <TabsTrigger value="operation" className="gap-2">
                <Warehouse className="h-4 w-4" />
                Por operación
              </TabsTrigger>
            </TabsList>

            <TabsContent value="dates" className="mt-4 space-y-3">
              <div className="flex flex-col sm:flex-row flex-wrap gap-3 sm:items-end">
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Desde</span>
                  <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-[160px]" />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Hasta</span>
                  <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-[160px]" />
                </div>
                <Button type="button" variant="secondary" size="sm" onClick={applyThisWeek}>
                  Semana actual
                </Button>
                <Button type="button" size="sm" onClick={() => void refreshByDates(dateFrom, dateTo)} disabled={loading}>
                  Generar con fechas
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Por defecto al abrir el reporte se carga la <strong>semana calendario actual</strong> (lunes a domingo,
                según la zona horaria del navegador).
              </p>
            </TabsContent>

            <TabsContent value="operation" className="mt-4 space-y-3">
              <div className="flex flex-col sm:flex-row gap-3 sm:items-end max-w-2xl">
                <div className="flex flex-col gap-1 flex-1 min-w-[240px]">
                  <span className="text-xs text-muted-foreground">Operación de recepción</span>
                  <Select
                    value={selectedOpId}
                    onValueChange={(v) => {
                      setSelectedOpId(v);
                    }}
                    disabled={loadingOps || operations.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={loadingOps ? 'Cargando…' : 'Elegir por fecha de creación'} />
                    </SelectTrigger>
                    <SelectContent className="max-h-72 overflow-y-auto">
                      {operations.map((op) => {
                        const line = `${format(new Date(op.created_at), 'dd/MM/yyyy HH:mm', { locale: es })} · ${op.rk_identifier} · ${op.supplier}`;
                        return (
                          <SelectItem key={op.id} value={op.id} title={line}>
                            {line.length > 96 ? `${line.slice(0, 93)}…` : line}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void refreshByOperation(selectedOpId)}
                  disabled={loading || !selectedOpId}
                >
                  Generar para esta operación
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Lista ordenada por <strong>fecha de creación</strong> de la operación (más reciente primero).
              </p>
            </TabsContent>
          </Tabs>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
            <div className="rounded-lg border p-3 bg-muted/30">
              <div className="text-muted-foreground text-xs">Referencias (filtro)</div>
              <div className="text-2xl font-bold">{summary.total}</div>
            </div>
            <div className="rounded-lg border p-3 bg-muted/30">
              <div className="text-muted-foreground text-xs">Con validación ≥ corte</div>
              <div className="text-2xl font-bold text-emerald-600">{summary.withVer}</div>
            </div>
            <div className="rounded-lg border p-3 bg-muted/30">
              <div className="text-muted-foreground text-xs">En BD muestras</div>
              <div className="text-2xl font-bold text-green-600">{summary.inDb}</div>
            </div>
            <div className="rounded-lg border p-3 bg-muted/30">
              <div className="text-muted-foreground text-xs">Con TF entrega</div>
              <div className="text-2xl font-bold text-blue-600">{summary.withTf}</div>
            </div>
            <div className="rounded-lg border p-3 bg-muted/30">
              <div className="text-muted-foreground text-xs">Algún pendiente</div>
              <div className="text-2xl font-bold text-amber-600">{summary.gaps}</div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 sm:items-end flex-wrap">
            <div className="flex flex-col gap-1 min-w-[200px]">
              <span className="text-sm text-muted-foreground">Filtro rápido</span>
              <Select value={filter} onValueChange={(v) => setFilter(v as RowFilter)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las referencias del período</SelectItem>
                  <SelectItem value="missing_validation">Sin validación guardada (≥ corte)</SelectItem>
                  <SelectItem value="missing_photo">Sin muestra en BD</SelectItem>
                  <SelectItem value="missing_tf">Sin TF de entrega</SelectItem>
                  <SelectItem value="fully_ok">Completo (validación + foto + TF)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1 flex-1 min-w-[200px] max-w-md">
              <span className="text-sm text-muted-foreground">Buscar referencia</span>
              <Input
                placeholder="Ej. ABC123"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
            </div>
          ) : filteredRows.length === 0 ? (
            <p className="text-center text-muted-foreground py-12">
              No hay filas que cumplan el filtro, o no hay escaneos en el alcance seleccionado.
            </p>
          ) : (
            <div className="border rounded-md overflow-x-auto max-h-[65vh] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Referencia</TableHead>
                    <TableHead>Operación recepción</TableHead>
                    <TableHead className="text-center">Validación</TableHead>
                    <TableHead className="text-center">BD muestras</TableHead>
                    <TableHead className="text-center">TF entrega</TableHead>
                    <TableHead>Números TF</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.map((r) => (
                    <TableRow key={r.reference}>
                      <TableCell className="font-mono">{r.reference}</TableCell>
                      <TableCell className="max-w-[220px]">
                        <ReceptionOperationsCell ids={r.receptionOperationIds} labels={r.receptionOperationLabels} />
                      </TableCell>
                      <TableCell className="text-center">
                        {r.hasVerificationSinceCutoff ? (
                          <Badge variant="success">Sí</Badge>
                        ) : (
                          <Badge variant="destructive">No</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {r.inSampleDatabase ? (
                          <Badge variant="success">Sí</Badge>
                        ) : (
                          <Badge variant="secondary">No</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {r.hasTransferDelivery ? (
                          <Badge variant="default">Sí</Badge>
                        ) : (
                          <Badge variant="outline">No</Badge>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[240px] text-xs break-words">{r.transferNumbers}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

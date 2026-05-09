'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, ChevronDown, ClipboardCheck, Download, Loader2, RefreshCw } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { exportToXlsx } from '@/services/export';
import {
  getReceptionSamplesAuditReport,
  type ReceptionSampleAuditRow,
  type ReceptionSamplesAuditStats,
} from '@/app/receptionSampleAuditActions';
import { RECEPTION_SAMPLE_AUDIT_START_ISO } from '@/lib/receptionSampleAudit';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

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
  /** Si viene desde Recepción, botón volver al listado de operaciones */
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
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<ReceptionSampleAuditRow[]>([]);
  const [cutoffIso, setCutoffIso] = useState<string>(RECEPTION_SAMPLE_AUDIT_START_ISO);
  const [pagesHint, setPagesHint] = useState<number | undefined>();
  const [stats, setStats] = useState<ReceptionSamplesAuditStats | null>(null);
  const [filter, setFilter] = useState<RowFilter>('all');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getReceptionSamplesAuditReport();
      if (!res.success) {
        throw new Error(res.error || 'No se pudo cargar el reporte.');
      }
      setRows(res.rows ?? []);
      setCutoffIso(res.cutoffIso ?? RECEPTION_SAMPLE_AUDIT_START_ISO);
      setPagesHint(res.scannedPages);
      setStats(res.stats ?? null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error desconocido';
      toast({ variant: 'destructive', title: 'Error', description: msg });
      setRows([]);
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const cutoffLabel = useMemo(() => {
    try {
      return format(parseISO(cutoffIso), 'PPP', { locale: es });
    } catch {
      return cutoffIso;
    }
  }, [cutoffIso]);

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
                Lista de <strong>referencias distintas</strong> vistas en recepción desde{' '}
                <strong>{cutoffLabel}</strong> (UTC, configurable en código), con validación de muestras, foto en
                BD, TF en <code className="text-xs bg-muted px-1 rounded">sampleDeliveries</code> y número de
                operación RK (si hay varias recepciones, se despliegan con el botón). El ritmo del reporte depende
                sobre todo de cuántos <strong>documentos escaneados</strong> existan desde esa fecha; quitar
                cantidades en pantalla no reduce esas lecturas.
              </p>
              <p className="text-xs text-muted-foreground">
                Firebase cobra sobre todo por <strong>lecturas de documentos</strong>. Aquí la parte más pesada
                suele ser recorrer los escaneos desde la fecha de corte; ya no se descarga toda la colección
                de TF ni todo el historial de verificaciones, solo lo relacionado con esas referencias o fechas.
              </p>
              {stats && (
                <p className="text-xs text-muted-foreground border-l-2 border-muted pl-2 space-y-0.5">
                  <span className="block">
                    Última actualización — lecturas aprox.:{' '}
                    <strong>{stats.scannedItemDocsRead.toLocaleString()}</strong> docs{' '}
                    <span className="text-muted-foreground">(recepción)</span>
                    {' + '}
                    <strong>{stats.verificationDocsRead.toLocaleString()}</strong>{' '}
                    <span className="text-muted-foreground">(verificaciones ≥ corte)</span>
                    {' + '}
                    <strong>{stats.deliveryDocsRead.toLocaleString()}</strong>{' '}
                    <span className="text-muted-foreground">(entregas TF coincidentes)</span>
                    {' + '}
                    <strong>{stats.receptionOperationDocsRead.toLocaleString()}</strong>{' '}
                    <span className="text-muted-foreground">(operaciones RK)</span>
                    {pagesHint != null ? (
                      <>
                        {' · '}
                        {pagesHint} ronda(s) de paginación en escaneos
                      </>
                    ) : null}
                    . Además hay lecturas por comprobación de existencia en{' '}
                    <code className="bg-muted px-1 rounded">sampleReferences</code> (≈ proporcional al número de
                    referencias distintas).
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
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
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
              No hay filas que cumplan el filtro, o no hay escaneos en recepción desde la fecha de corte.
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

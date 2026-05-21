"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, RefreshCw, Download, FlaskConical } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import type {
  SavedSampleVerification,
  SampleDelivery,
  SamplePhotoReception,
  SamplePhotoReceptionStatus,
} from '@/types';
import {
  loadSampleVerifications,
  getSampleReferencesExistence,
  getSampleDeliveriesByReferences,
  getSamplePhotoReceptionsByReferences,
} from '@/app/actions';
import { exportToXlsx } from '@/services/export';

function normRef(r: string) {
  return String(r || '')
    .trim()
    .toUpperCase();
}

function deliveriesForReference(all: SampleDelivery[], refNorm: string): SampleDelivery[] {
  return all.filter((d) => normRef(d.reference) === refNorm);
}

function receptionsForReference(all: SamplePhotoReception[], refNorm: string): SamplePhotoReception[] {
  return all.filter((r) => normRef(r.reference) === refNorm);
}

function aggregateReceptionStatus(list: SamplePhotoReception[]): {
  status: SamplePhotoReceptionStatus | 'none';
  receivedCount: number;
  totalCount: number;
} {
  if (!list.length) return { status: 'none', receivedCount: 0, totalCount: 0 };
  const totalCount = list.length;
  const receivedCount = list.filter((r) => r.status === 'received').length;
  const inProgressCount = list.filter((r) => r.status === 'in_progress').length;
  const pendingCount = list.filter((r) => r.status === 'pending').length;
  const cancelledCount = list.filter((r) => r.status === 'cancelled').length;

  if (receivedCount > 0) return { status: 'received', receivedCount, totalCount };
  if (inProgressCount > 0) return { status: 'in_progress', receivedCount, totalCount };
  if (pendingCount > 0) return { status: 'pending', receivedCount, totalCount };
  if (cancelledCount > 0) return { status: 'cancelled', receivedCount, totalCount };
  return { status: 'none', receivedCount, totalCount };
}

type FollowUpRow = {
  verificationId: string;
  verificationName: string;
  verificationDate: Date;
  reference: string;
  refNorm: string;
  inSampleDbNow: boolean;
  hasRealTf: boolean;
  photoReceptionStatus: SamplePhotoReceptionStatus | 'none';
  photoReceptionReceivedCount: number;
  photoReceptionTotalCount: number;
  transferNumbers: string;
  lastDeliveryDate: string;
};

export const SampleFollowUpReport: React.FC = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<FollowUpRow[]>([]);
  const [filterVerificationId, setFilterVerificationId] = useState<string>('all');

  const buildRows = useCallback(
    async (
      verifications: SavedSampleVerification[],
      existence: Record<string, boolean>,
      allDeliveries: SampleDelivery[],
      allPhotoReceptions: SamplePhotoReception[]
    ) => {
      const baseRows: {
        verificationId: string;
        verificationName: string;
        verificationDate: Date;
        refNorm: string;
      }[] = [];

      for (const v of verifications) {
        const fromSnapshot =
          v.newSampleReferencesAtRun && v.newSampleReferencesAtRun.length > 0
            ? v.newSampleReferencesAtRun.map(normRef)
            : v.results
                .filter((r) => r.status === 'Muestra Nueva Requerida')
                .map((r) => normRef(r.reference));

        const uniqueInVerification = [...new Set(fromSnapshot.filter(Boolean))];
        uniqueInVerification.forEach((refNorm) => {
          baseRows.push({
            verificationId: v.id,
            verificationName: v.name,
            verificationDate: new Date(v.createdAt),
            refNorm,
          });
        });
      }

      if (baseRows.length === 0) {
        return [] as FollowUpRow[];
      }

      const out: FollowUpRow[] = baseRows.map((b) => {
        const dlist = deliveriesForReference(allDeliveries, b.refNorm).sort(
          (a, c) => new Date(c.deliveryDate).getTime() - new Date(a.deliveryDate).getTime()
        );
        const receptionAgg = aggregateReceptionStatus(receptionsForReference(allPhotoReceptions, b.refNorm));
        const hasRealTf = dlist.length > 0;
        const transferNumbers = dlist.map((d) => d.transferNumber).join('; ') || '—';
        const last = dlist[0]?.deliveryDate
          ? format(new Date(dlist[0].deliveryDate), 'dd/MM/yyyy', { locale: es })
          : '—';

        return {
          verificationId: b.verificationId,
          verificationName: b.verificationName,
          verificationDate: b.verificationDate,
          reference: b.refNorm,
          refNorm: b.refNorm,
          inSampleDbNow: !!existence[b.refNorm],
          hasRealTf,
          photoReceptionStatus: receptionAgg.status,
          photoReceptionReceivedCount: receptionAgg.receivedCount,
          photoReceptionTotalCount: receptionAgg.totalCount,
          transferNumbers,
          lastDeliveryDate: last,
        };
      });

      return out.sort((a, b) => {
        const t = b.verificationDate.getTime() - a.verificationDate.getTime();
        if (t !== 0) return t;
        return a.refNorm.localeCompare(b.refNorm);
      });
    },
    []
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const verRes = await loadSampleVerifications({ maxSessions: 4500 });
      if (!verRes.success || !verRes.data) {
        throw new Error(verRes.error || 'No se pudieron cargar las verificaciones.');
      }

      const baseRefSet = new Set<string>();
      for (const v of verRes.data) {
        const fromSnapshot =
          v.newSampleReferencesAtRun && v.newSampleReferencesAtRun.length > 0
            ? v.newSampleReferencesAtRun.map(normRef)
            : v.results
                .filter((r) => r.status === 'Muestra Nueva Requerida')
                .map((r) => normRef(r.reference));
        [...new Set(fromSnapshot.filter(Boolean))].forEach((r) => baseRefSet.add(r));
      }
      const allRefs = [...baseRefSet];

      const [existenceRes, delRes, photoRes] = await Promise.all([
        allRefs.length
          ? getSampleReferencesExistence(allRefs)
          : Promise.resolve({ success: true, data: {} } as Awaited<ReturnType<typeof getSampleReferencesExistence>>),
        allRefs.length
          ? getSampleDeliveriesByReferences(allRefs)
          : Promise.resolve({ success: true, data: [] } as Awaited<ReturnType<typeof getSampleDeliveriesByReferences>>),
        allRefs.length
          ? getSamplePhotoReceptionsByReferences(allRefs)
          : Promise.resolve({ success: true, data: [] } as Awaited<ReturnType<typeof getSamplePhotoReceptionsByReferences>>),
      ]);

      if (!existenceRes.success || !existenceRes.data) {
        throw new Error(existenceRes.error || 'No se pudo consultar la base de muestras.');
      }
      if (!delRes.success || !delRes.data) {
        throw new Error(delRes.error || 'No se pudieron cargar las entregas (TF) por referencia.');
      }
      if (!photoRes.success || !photoRes.data) {
        throw new Error(photoRes.error || 'No se pudo cargar la recepción foto por referencia.');
      }

      const built = await buildRows(verRes.data, existenceRes.data, delRes.data, photoRes.data);
      setRows(built);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [buildRows, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredRows = useMemo(() => {
    if (filterVerificationId === 'all') return rows;
    return rows.filter((r) => r.verificationId === filterVerificationId);
  }, [rows, filterVerificationId]);

  const summary = useMemo(() => {
    const set = filteredRows;
    const total = set.length;
    const inDb = set.filter((r) => r.inSampleDbNow).length;
    const withTf = set.filter((r) => r.hasRealTf).length;
    const pendingBoth = set.filter((r) => !r.inSampleDbNow && !r.hasRealTf).length;
    return { total, inDb, withTf, pendingBoth };
  }, [filteredRows]);

  const verificationOptions = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach((r) => map.set(r.verificationId, r.verificationName));
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const handleExport = () => {
    if (filteredRows.length === 0) {
      toast({ variant: 'destructive', title: 'Sin datos', description: 'No hay filas para exportar.' });
      return;
    }
    exportToXlsx(
      filteredRows.map((r) => ({
        Verificación: r.verificationName,
        'Fecha verificación': format(r.verificationDate, 'PPp', { locale: es }),
        Referencia: r.reference,
        'En base muestras (foto) ahora': r.inSampleDbNow ? 'Sí' : 'No',
        'TF registrado (entregas reales)': r.hasRealTf ? 'Sí' : 'No',
        'Recepción foto': r.photoReceptionStatus === 'none' ? 'Sin registro' : r.photoReceptionStatus,
        'Recepción foto (recibidas/total)': `${r.photoReceptionReceivedCount}/${r.photoReceptionTotalCount}`,
        'Números TF': r.transferNumbers,
        'Última fecha entrega': r.lastDeliveryDate,
      })),
      'seguimiento_muestras_nuevas'
    );
    toast({ title: 'Exportado', description: 'Archivo generado.' });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <FlaskConical className="h-5 w-5 text-primary" />
              Seguimiento de muestras nuevas
            </CardTitle>
            <CardDescription>
              Cruza las referencias que en su momento salieron como <strong>Muestra nueva requerida</strong> con el
              estado <em>actual</em>: si ya están en la base de muestras (foto) y si tienen entregas reales con TF en{' '}
              <code className="text-xs bg-muted px-1 rounded">sampleDeliveries</code>. No modifica verificaciones
              existentes; las nuevas guardan la lista explícita al momento del guardado. Para ahorrar lecturas en
              Firebase, solo se consideran las verificaciones más recientes (tope configurable en código) y las TF se
              consultan solo para las referencias que aparecen en ese conjunto.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div className="rounded-lg border p-3 bg-muted/30">
              <div className="text-muted-foreground text-xs">Filas (filtro)</div>
              <div className="text-2xl font-bold">{summary.total}</div>
            </div>
            <div className="rounded-lg border p-3 bg-muted/30">
              <div className="text-muted-foreground text-xs">Ya en base muestras</div>
              <div className="text-2xl font-bold text-green-600">{summary.inDb}</div>
            </div>
            <div className="rounded-lg border p-3 bg-muted/30">
              <div className="text-muted-foreground text-xs">Con TF registrado</div>
              <div className="text-2xl font-bold text-blue-600">{summary.withTf}</div>
            </div>
            <div className="rounded-lg border p-3 bg-muted/30">
              <div className="text-muted-foreground text-xs">Sin foto ni TF</div>
              <div className="text-2xl font-bold text-amber-600">{summary.pendingBoth}</div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 sm:items-center max-w-md">
            <span className="text-sm text-muted-foreground shrink-0">Filtrar por verificación</span>
            <Select value={filterVerificationId} onValueChange={setFilterVerificationId}>
              <SelectTrigger>
                <SelectValue placeholder="Todas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las verificaciones</SelectItem>
                {verificationOptions.map(([id, name]) => (
                  <SelectItem key={id} value={id}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
            </div>
          ) : filteredRows.length === 0 ? (
            <p className="text-center text-muted-foreground py-12">
              No hay referencias marcadas como muestra nueva en el historial, o el filtro no devuelve resultados.
            </p>
          ) : (
            <div className="border rounded-md overflow-x-auto max-h-[65vh] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Verificación</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Referencia</TableHead>
                    <TableHead className="text-center">En BD muestras</TableHead>
                    <TableHead className="text-center">TF real</TableHead>
                    <TableHead className="text-center">Recepción foto</TableHead>
                    <TableHead>Números TF</TableHead>
                    <TableHead>Última entrega</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.map((r, idx) => (
                    <TableRow key={`${r.verificationId}-${r.refNorm}-${idx}`}>
                      <TableCell className="font-medium max-w-[180px] truncate" title={r.verificationName}>
                        {r.verificationName}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {format(r.verificationDate, 'PPp', { locale: es })}
                      </TableCell>
                      <TableCell className="font-mono">{r.reference}</TableCell>
                      <TableCell className="text-center">
                        {r.inSampleDbNow ? (
                          <Badge variant="success">Sí</Badge>
                        ) : (
                          <Badge variant="secondary">No</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {r.hasRealTf ? (
                          <Badge variant="default">Sí</Badge>
                        ) : (
                          <Badge variant="outline">No</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {r.photoReceptionStatus === 'received' ? (
                          <Badge variant="success">{`Recibida (${r.photoReceptionReceivedCount}/${r.photoReceptionTotalCount})`}</Badge>
                        ) : r.photoReceptionStatus === 'in_progress' ? (
                          <Badge variant="default">{`En proceso (${r.photoReceptionReceivedCount}/${r.photoReceptionTotalCount})`}</Badge>
                        ) : r.photoReceptionStatus === 'pending' ? (
                          <Badge variant="secondary">{`Pendiente (${r.photoReceptionReceivedCount}/${r.photoReceptionTotalCount})`}</Badge>
                        ) : r.photoReceptionStatus === 'cancelled' ? (
                          <Badge variant="outline">{`Cancelada (${r.photoReceptionReceivedCount}/${r.photoReceptionTotalCount})`}</Badge>
                        ) : (
                          <Badge variant="outline">Sin registro</Badge>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[220px] text-xs break-words">{r.transferNumbers}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{r.lastDeliveryDate}</TableCell>
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

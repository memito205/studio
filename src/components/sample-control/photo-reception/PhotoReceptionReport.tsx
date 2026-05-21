"use client";

import React, { useCallback, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Download, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  loadSamplePhotoReceptionReport,
  type LoadSamplePhotoReceptionReportOptions,
  type SamplePhotoReceptionReportData,
} from '@/app/actions';
import { exportToXlsx } from '@/services/export';

const STATUS_LABEL: Record<'pending' | 'in_progress' | 'received' | 'cancelled', string> = {
  pending: 'Pendiente',
  in_progress: 'En proceso',
  received: 'Recibida',
  cancelled: 'Cancelada',
};

export const PhotoReceptionReport: React.FC = () => {
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [transferNumber, setTransferNumber] = useState('');
  const [status, setStatus] = useState<LoadSamplePhotoReceptionReportOptions['status']>('all');
  const [isLoading, setIsLoading] = useState(false);
  const [report, setReport] = useState<SamplePhotoReceptionReportData | null>(null);
  const { toast } = useToast();

  const fetchReport = useCallback(async () => {
    setIsLoading(true);
    const result = await loadSamplePhotoReceptionReport({
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      transferNumber: transferNumber || undefined,
      status,
      maxItems: 5000,
    });
    if (!result.success || !result.data) {
      toast({
        variant: 'destructive',
        title: 'Error de reporte',
        description: result.error || 'No fue posible cargar el reporte.',
      });
      setReport(null);
      setIsLoading(false);
      return;
    }
    setReport(result.data);
    setIsLoading(false);
  }, [fromDate, toDate, transferNumber, status, toast]);

  const exportRows = useMemo(() => {
    if (!report) return [];
    return report.rows.map((row) => ({
      Referencia: row.reference,
      TF: row.transferNumber,
      Estado: STATUS_LABEL[row.status],
      UltimaActualizacion: row.updatedAt ? format(row.updatedAt, 'yyyy-MM-dd HH:mm:ss') : '',
      Usuario: row.updatedByName || '',
      Fuente: row.lastEventSource || '',
      Nota: row.lastEventNote || '',
      TFCerrada: row.isTransferClosed ? 'SI' : 'NO',
    }));
  }, [report]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reporte recepci�n foto</CardTitle>
        <CardDescription>M�tricas y auditor�a de recepciones por rango, TF y estado.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          <Input
            value={transferNumber}
            onChange={(e) => setTransferNumber(e.target.value)}
            placeholder="TF (opcional)"
          />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as LoadSamplePhotoReceptionReportOptions['status'])}
            className="h-10 rounded-md border bg-background px-3 text-sm"
          >
            <option value="all">Todos</option>
            <option value="pending">Pendiente</option>
            <option value="in_progress">En proceso</option>
            <option value="received">Recibida</option>
            <option value="cancelled">Cancelada</option>
          </select>
          <div className="flex items-center gap-2">
            <Button onClick={fetchReport} disabled={isLoading}>
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Consultar
            </Button>
            <Button
              variant="outline"
              onClick={() => exportToXlsx(exportRows, `reporte_recepcion_foto_${Date.now()}`)}
              disabled={exportRows.length === 0}
            >
              <Download className="mr-2 h-4 w-4" />
              Exportar
            </Button>
          </div>
        </div>

        {report && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2 text-xs">
              <Badge variant="outline">Total: {report.totals.total}</Badge>
              <Badge variant="outline">Pend: {report.totals.pending}</Badge>
              <Badge variant="outline">Proc: {report.totals.inProgress}</Badge>
              <Badge variant="outline">Rec: {report.totals.received}</Badge>
              <Badge variant="outline">Cancel: {report.totals.cancelled}</Badge>
              <Badge variant="outline">TF cerradas: {report.totals.closedTransfers}</Badge>
              <Badge variant="outline">TF abiertas: {report.totals.openTransfers}</Badge>
            </div>

            <div className="border rounded-md max-h-[60vh] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-secondary">
                  <TableRow>
                    <TableHead>Referencia</TableHead>
                    <TableHead>TF</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Actualizado</TableHead>
                    <TableHead>Usuario</TableHead>
                    <TableHead>Fuente</TableHead>
                    <TableHead>TF cerrada</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                        No hay resultados para los filtros seleccionados.
                      </TableCell>
                    </TableRow>
                  ) : (
                    report.rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-mono">{row.reference}</TableCell>
                        <TableCell className="font-mono">{row.transferNumber}</TableCell>
                        <TableCell>{STATUS_LABEL[row.status]}</TableCell>
                        <TableCell>
                          {row.updatedAt ? format(row.updatedAt, 'PPP p', { locale: es }) : 'Sin fecha'}
                        </TableCell>
                        <TableCell>{row.updatedByName || 'N/A'}</TableCell>
                        <TableCell>{row.lastEventSource || 'N/A'}</TableCell>
                        <TableCell>{row.isTransferClosed ? 'SI' : 'NO'}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

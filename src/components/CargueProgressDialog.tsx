"use client";

import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Download, Truck, Package, CheckCircle2, Clock } from 'lucide-react';
import type { WholesaleOrder } from '@/types';
import { getLabelsForOrder, getPackedItemsForOrder, getPackingSession, getShipments } from '@/app/actions';
import { useToast } from '@/hooks/use-toast';
import {
  buildCargueLoadLookup,
  buildCargueProgress,
  cargueProgressToExcelRows,
  type CargueProgressReport,
} from '@/lib/wholesalePacking';

interface CargueProgressDialogProps {
  order: WholesaleOrder | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatLoadedAt(d: Date | null): string {
  if (!d) return '—';
  return d.toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'medium' });
}

export function CargueProgressDialog({ order, isOpen, onOpenChange }: CargueProgressDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [report, setReport] = useState<CargueProgressReport | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen && order) {
      void loadProgress();
    } else {
      setReport(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when dialog opens for an order
  }, [isOpen, order?.id]);

  const loadProgress = async () => {
    if (!order) return;
    setIsLoading(true);
    try {
      const [labelsRes, itemsRes, sessionRes, shipmentsRes] = await Promise.all([
        getLabelsForOrder(order.id),
        getPackedItemsForOrder(order.id),
        getPackingSession(order.id),
        getShipments(),
      ]);
      const loadLookup = buildCargueLoadLookup(shipmentsRes.data || []);
      const next = buildCargueProgress({
        orderId: order.id,
        packedItems: itemsRes.data || [],
        session: sessionRes.data || null,
        labels: labelsRes.data || [],
        loadLookup,
      });
      setReport(next);
    } catch (error: any) {
      console.error('Error loading cargue progress:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error?.message || 'No se pudo cargar el progreso de cargue.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const progressPercent = useMemo(() => {
    if (!report || report.expectedBoxes <= 0) return report?.loadedBoxes ? 100 : 0;
    return (report.loadedBoxes / report.expectedBoxes) * 100;
  }, [report]);

  const loadedUnits = useMemo(() => report?.units.filter((u) => u.loaded) || [], [report]);
  const pendingUnits = useMemo(() => report?.units.filter((u) => !u.loaded) || [], [report]);

  const handleDownloadExcel = () => {
    if (!order || !report) return;
    try {
      const rows = cargueProgressToExcelRows(report);
      const summaryRows = [
        { Concepto: 'Cajas esperadas', Cantidad: report.expectedBoxes },
        { Concepto: 'Cajas cargadas', Cantidad: report.loadedBoxes },
        { Concepto: 'Cajas pendientes', Cantidad: report.pendingBoxes },
        { Concepto: 'Unds en cajas cargadas', Cantidad: report.loadedUnitsQty },
        { Concepto: 'Unds en cajas pendientes', Cantidad: report.pendingUnitsQty },
        { Concepto: 'Estado pedido', Cantidad: order.status },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Progreso cargue');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'Resumen');
      XLSX.writeFile(wb, `Progreso_Cargue_${order.id}.xlsx`);
      toast({
        title: 'Progreso de cargue descargado',
        description: `${report.loadedBoxes}/${report.expectedBoxes} cajas · ${rows.length} líneas.`,
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error al descargar',
        description: error?.message || 'No se pudo generar el Excel de cargue.',
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5 text-amber-600" />
            Progreso de cargue — {order?.id}
          </DialogTitle>
          <DialogDescription>
            {order?.cliente} · Estado: <Badge variant="outline">{order?.status}</Badge>
            {' '}· Se actualiza con las etiquetas VXM escaneadas en despacho (también en curso).
          </DialogDescription>
        </DialogHeader>

        {isLoading || !report ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-10 w-10 animate-spin text-primary mb-3" />
            <p className="text-muted-foreground text-sm">Cargando cajas y escaneos de despacho...</p>
          </div>
        ) : (
          <div className="space-y-4 flex-1 min-h-0">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-md border p-3 bg-muted/30">
                <p className="text-xs text-muted-foreground">Esperadas</p>
                <p className="text-xl font-semibold">{report.expectedBoxes}</p>
              </div>
              <div className="rounded-md border p-3 bg-green-50 border-green-200">
                <p className="text-xs text-green-700">Cargadas</p>
                <p className="text-xl font-semibold text-green-800">{report.loadedBoxes}</p>
              </div>
              <div className="rounded-md border p-3 bg-amber-50 border-amber-200">
                <p className="text-xs text-amber-700">Pendientes</p>
                <p className="text-xl font-semibold text-amber-800">{report.pendingBoxes}</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Unds cargadas</p>
                <p className="text-xl font-semibold">{report.loadedUnitsQty}</p>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Avance de cargue</span>
                <span className="font-medium">{progressPercent.toFixed(0)}%</span>
              </div>
              <Progress value={progressPercent} className="h-2.5" />
            </div>

            <Tabs defaultValue="cargadas" className="flex-1 min-h-0">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="cargadas" className="gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Cargadas ({loadedUnits.length})
                </TabsTrigger>
                <TabsTrigger value="pendientes" className="gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  Pendientes ({pendingUnits.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="cargadas" className="mt-3">
                <ScrollArea className="h-[min(42vh,420px)] border rounded-md">
                  {loadedUnits.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-10 italic">
                      Aún no se ha cargado ninguna caja de este pedido.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Caja</TableHead>
                          <TableHead>Etiqueta VXM</TableHead>
                          <TableHead>Contenido</TableHead>
                          <TableHead className="text-right">Unds</TableHead>
                          <TableHead>Hora cargue</TableHead>
                          <TableHead>Envío</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {loadedUnits.map((unit) => (
                          <TableRow key={unit.etiqueta}>
                            <TableCell className="font-medium">{unit.caja}</TableCell>
                            <TableCell className="font-mono text-xs">{unit.etiqueta}</TableCell>
                            <TableCell className="text-xs max-w-[240px]">
                              {unit.items.length === 0 ? (
                                <span className="text-muted-foreground">Sin packedItems</span>
                              ) : (
                                <ul className="space-y-0.5">
                                  {unit.items.map((it) => (
                                    <li key={`${it.referencia}-${it.talla}`}>
                                      <span className="font-medium">{it.referencia}</span>
                                      <span className="text-muted-foreground"> · {it.talla} × {it.cantidad}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </TableCell>
                            <TableCell className="text-right font-semibold">{unit.totalQty}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{formatLoadedAt(unit.loadedAt)}</TableCell>
                            <TableCell className="text-xs">
                              {unit.truckPlate ? (
                                <span title={unit.shipmentId}>
                                  {unit.truckPlate}
                                  {unit.shipmentId ? ` · #${unit.shipmentId.slice(-6)}` : ''}
                                </span>
                              ) : (
                                '—'
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </ScrollArea>
              </TabsContent>

              <TabsContent value="pendientes" className="mt-3">
                <ScrollArea className="h-[min(42vh,420px)] border rounded-md">
                  {pendingUnits.length === 0 ? (
                    <div className="text-center py-10">
                      <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">Todas las cajas del pedido están cargadas.</p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Caja</TableHead>
                          <TableHead>Etiqueta VXM</TableHead>
                          <TableHead>Contenido</TableHead>
                          <TableHead className="text-right">Unds</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pendingUnits.map((unit) => (
                          <TableRow key={unit.etiqueta}>
                            <TableCell className="font-medium">{unit.caja}</TableCell>
                            <TableCell className="font-mono text-xs">{unit.etiqueta}</TableCell>
                            <TableCell className="text-xs max-w-[280px]">
                              {unit.items.length === 0 ? (
                                <span className="text-muted-foreground">Sin packedItems</span>
                              ) : (
                                <ul className="space-y-0.5">
                                  {unit.items.map((it) => (
                                    <li key={`${it.referencia}-${it.talla}`}>
                                      <span className="font-medium">{it.referencia}</span>
                                      <span className="text-muted-foreground"> · {it.talla} × {it.cantidad}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </TableCell>
                            <TableCell className="text-right font-semibold">{unit.totalQty}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
          <Button variant="outline" onClick={() => void loadProgress()} disabled={isLoading}>
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Package className="mr-2 h-4 w-4" />}
            Actualizar
          </Button>
          <Button onClick={handleDownloadExcel} disabled={!report || isLoading} className="bg-amber-600 hover:bg-amber-700">
            <Download className="mr-2 h-4 w-4" />
            Descargar Excel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

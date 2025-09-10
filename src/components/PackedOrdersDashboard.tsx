

"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, CheckCircle, Package, AlertCircle, Eye, AlarmClockOff } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { StatCard } from './StatCard';
import type { WholesaleOrder, PackingSession, PackingPause } from '@/types';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

interface PackedOrdersDashboardProps {
  orders: WholesaleOrder[];
  sessions: PackingSession[];
  onReturn: () => void;
}

interface OrderAnalysis {
  order: WholesaleOrder;
  session?: PackingSession;
  packedTotal: number;
  accuracy: number;
  difference: number;
  boxCount: number;
}


const SessionDetailsDialog: React.FC<{
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  analysis: OrderAnalysis | null;
}> = ({ isOpen, onOpenChange, analysis }) => {
    if (!analysis || !analysis.session) return null;

    const { order, session } = analysis;

    const formatDuration = (start: Date, end: Date | undefined): string => {
        if (!end) return "En curso...";
        const diffMs = new Date(end).getTime() - new Date(start).getTime();
        const minutes = Math.floor(diffMs / 60000);
        const seconds = Math.floor((diffMs % 60000) / 1000);
        return `${minutes}m ${seconds}s`;
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl">
                <DialogHeader>
                    <DialogTitle>Detalles de Empaque - Pedido {order.id}</DialogTitle>
                    <DialogDescription>Operario: <span className="font-semibold">{session.packerName}</span></DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4 max-h-[70vh] overflow-y-auto">
                    
                    {/* Pause Report */}
                    <div className="space-y-4">
                        <h3 className="font-semibold text-lg flex items-center gap-2"><AlarmClockOff/> Reporte de Pausas</h3>
                        {session.pauses && session.pauses.length > 0 ? (
                             <ScrollArea className="h-72 border rounded-md">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Motivo</TableHead>
                                            <TableHead>Inicio</TableHead>
                                            <TableHead className="text-right">Duración</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {session.pauses.map((pause, index) => (
                                            <TableRow key={index}>
                                                <TableCell>{pause.reason}</TableCell>
                                                <TableCell>{new Date(pause.startTime).toLocaleTimeString()}</TableCell>
                                                <TableCell className="text-right">{formatDuration(pause.startTime, pause.endTime)}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </ScrollArea>
                        ) : (
                            <p className="text-muted-foreground text-center py-4">No se registraron pausas para esta sesión.</p>
                        )}
                    </div>
                    
                     {/* Box Contents */}
                     <div className="space-y-4">
                        <h3 className="font-semibold text-lg">Contenido de Cajas</h3>
                         <ScrollArea className="h-72 border rounded-md">
                            <div className="p-4 space-y-3">
                                {session.units.map(unit => (
                                    <div key={unit.id} className="p-3 bg-muted/50 rounded-lg">
                                        <p className="font-semibold">Caja #{unit.id} - Etiqueta: <span className="font-mono">{unit.labelBarcode || 'N/A'}</span></p>
                                        <ul className="list-disc list-inside text-sm text-muted-foreground mt-1">
                                            {Object.values(unit.items).map(item => (
                                                <li key={item.item.codigoBarras}>
                                                    {item.packedQuantity} x {item.item.referencia} ({item.item.talla})
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                ))}
                                {session.units.length === 0 && <p className="text-muted-foreground text-center py-4">No hay cajas registradas.</p>}
                            </div>
                        </ScrollArea>
                    </div>

                </div>
                <DialogFooter>
                    <Button onClick={() => onOpenChange(false)}>Cerrar</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};


export const PackedOrdersDashboard: React.FC<PackedOrdersDashboardProps> = ({ orders, sessions, onReturn }) => {
  const [selectedAnalysis, setSelectedAnalysis] = useState<OrderAnalysis | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  
  const analysis: OrderAnalysis[] = React.useMemo(() => {
    const sessionMap = new Map(sessions.map(s => [s.orderId, s]));
    return orders
      .filter(order => sessionMap.has(order.id)) // Show any order that has a packing session
      .map(order => {
        const session = sessionMap.get(order.id);
        const packedTotal = session ? session.units.reduce((sum, unit) => sum + Object.values(unit.items).reduce((itemSum, item) => itemSum + item.packedQuantity, 0), 0) : 0;
        const orderedTotal = order.cantidadTotal;
        const difference = packedTotal - orderedTotal;
        const accuracy = orderedTotal > 0 ? (packedTotal / orderedTotal) * 100 : 100;
        
        return {
          order,
          session,
          packedTotal,
          accuracy,
          difference,
          boxCount: session ? session.units.length : 0,
        };
      })
      .sort((a, b) => new Date(b.order.fecha).getTime() - new Date(a.order.fecha).getTime());
  }, [orders, sessions]);

  const totalPackedOrders = analysis.length;
  const totalUnitsPacked = analysis.reduce((sum, a) => sum + a.packedTotal, 0);
  const totalUnitsOrdered = analysis.reduce((sum, a) => sum + a.order.cantidadTotal, 0);
  const overallAccuracy = totalUnitsOrdered > 0 ? (totalUnitsPacked / totalUnitsOrdered) * 100 : 0;

  const getAccuracyColor = (accuracy: number) => {
    if (accuracy === 100) return 'text-green-500';
    if (accuracy > 100 || accuracy < 99) return 'text-red-500';
    return 'text-amber-500';
  }

  const handleViewDetails = (item: OrderAnalysis) => {
    setSelectedAnalysis(item);
    setIsDetailsOpen(true);
  }

  return (
    <div className="space-y-8">
      <SessionDetailsDialog isOpen={isDetailsOpen} onOpenChange={setIsDetailsOpen} analysis={selectedAnalysis} />
      <Card>
        <CardHeader className="flex flex-row justify-between items-center">
          <div>
            <CardTitle>Dashboard de Analíticas de Empaque</CardTitle>
            <CardDescription>Análisis de rendimiento y precisión de los pedidos empacados.</CardDescription>
          </div>
          <Button onClick={onReturn} variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver
          </Button>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        <StatCard title="Pedidos Procesados" value={totalPackedOrders.toLocaleString()} icon={<CheckCircle />} color="text-blue-500" />
        <StatCard title="Unidades Procesadas" value={totalUnitsPacked.toLocaleString()} icon={<Package />} color="text-amber-500" />
        <StatCard title="Precisión General" value={`${overallAccuracy.toFixed(2)}%`} icon={<AlertCircle />} color={getAccuracyColor(overallAccuracy)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Reporte de Precisión por Pedido</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nro Pedido</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead className="text-right">Pedido</TableHead>
                <TableHead className="text-right">Empacado</TableHead>
                <TableHead className="text-right">Diferencia</TableHead>
                <TableHead className="text-right">Precisión</TableHead>
                <TableHead className="text-center">Cajas</TableHead>
                <TableHead className="text-center">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {analysis.map((item) => (
                <TableRow key={item.order.id}>
                  <TableCell className="font-medium">{item.order.id}</TableCell>
                  <TableCell>{item.order.cliente}</TableCell>
                  <TableCell>{new Date(item.order.fecha).toLocaleDateString()}</TableCell>
                  <TableCell className="text-right">{item.order.cantidadTotal}</TableCell>
                  <TableCell className="text-right font-semibold">{item.packedTotal}</TableCell>
                  <TableCell className={cn("text-right font-bold", item.difference !== 0 ? 'text-red-500' : 'text-green-500')}>
                    {item.difference > 0 ? `+${item.difference}` : item.difference}
                  </TableCell>
                  <TableCell className={cn("text-right font-bold", getAccuracyColor(item.accuracy))}>
                    {item.accuracy.toFixed(2)}%
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="secondary">{item.boxCount}</Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <Button variant="outline" size="sm" onClick={() => handleViewDetails(item)}>
                        <Eye className="mr-2 h-4 w-4" />
                        Ver Detalles
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {analysis.length === 0 && (
            <p className="text-center py-8 text-muted-foreground">No hay pedidos con sesiones de empaque para analizar.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

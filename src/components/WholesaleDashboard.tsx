
"use client";

import React, { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { UploadCloud, Loader2, PackageCheck, ArrowLeft, Database, Boxes, BarChart2, Printer, Send, Lock, Compass, Download } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import type { WholesaleOrder, WholesaleOrderDetail, OrderStatus, ProductDatabaseItem, PackingSession, PreprintedLabel, PackedItem } from '@/types';
import { processAndSaveWholesaleFile, saveProductDatabaseItems, updateOrderStatus, getPackingSession, generateAndSaveLabels, getLabelsForOrder, addSingleLabel, loadAllPackingSessions, getPackedItemsForOrder } from '@/app/actions';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import { exportToXlsx } from '@/services/export';
import { LabelPrintDialog } from './LabelPrintDialog';
import { excelSerialDateToJSDate } from '@/lib/parsingUtils';
import { Checkbox } from './ui/checkbox';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';


interface WholesaleDashboardProps {
    orders: WholesaleOrder[];
    isLoadingOrders: boolean;
    fetchOrders: () => void;
    onStartPacking: (order: WholesaleOrder) => void;
    onReturnToSuite: () => void;
    onNavigateToPackedOrdersDashboard: () => void;
    onNavigateToDispatchDashboard: () => void;
}

const OrderTable: React.FC<{
  orders: WholesaleOrder[];
  sessions: Map<string, PackingSession>; 
  allPackedItems: PackedItem[];
  selectedOrders: Set<string>;
  onOrderSelect: (orderId: string, isSelected: boolean) => void;
  onStartPacking: (order: WholesaleOrder) => void;
  onOpenPrintDialog: (order: WholesaleOrder) => void;
  onForceCloseOrder: (order: WholesaleOrder) => void;
}> = ({ orders, sessions, allPackedItems, selectedOrders, onOrderSelect, onStartPacking, onOpenPrintDialog, onForceCloseOrder }) => {
    
  if (orders.length === 0) {
    return <p className="text-muted-foreground text-center py-8">No hay pedidos en esta etapa.</p>;
  }

  const getStatusVariant = (status: OrderStatus) => {
    switch (status) {
      case 'Pte Empaque': return 'warning';
      case 'En Empaque': return 'default';
      case 'Empacado': return 'success';
      case 'Cancelado': return 'destructive';
      default: return 'secondary';
    }
  };


  return (
    <Table>
        <TableHeader>
            <TableRow>
                <TableHead className="w-12"></TableHead>
                <TableHead>Nro Documento</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead className="text-center">Estado</TableHead>
                <TableHead className="text-right">Progreso</TableHead>
                <TableHead className="text-center">Acción</TableHead>
            </TableRow>
        </TableHeader>
        <TableBody>
            {orders.map(order => {
                const packedUnits = allPackedItems.filter(item => item.orderId === order.id).reduce((sum, item) => sum + item.quantity, 0);
                const totalUnits = order.cantidadTotal;
                const progress = totalUnits > 0 ? (packedUnits / totalUnits) * 100 : (packedUnits > 0 ? 100 : 0);
                const boxCount = new Set(allPackedItems.filter(item => item.orderId === order.id).map(item => item.packingUnitId)).size;
                const isSelected = selectedOrders.has(order.id);

                return (
                    <TableRow key={order.id} data-state={isSelected ? "selected" : ""}>
                        <TableCell>
                            {order.status === 'Empacado' && (
                                <Checkbox
                                    checked={isSelected}
                                    onCheckedChange={(checked) => onOrderSelect(order.id, !!checked)}
                                    aria-label={`Seleccionar pedido ${order.id}`}
                                />
                            )}
                        </TableCell>
                        <TableCell className="font-medium">{order.id}</TableCell>
                        <TableCell>{order.cliente}</TableCell>
                        <TableCell>{new Date(order.fecha).toLocaleDateString()}</TableCell>
                        <TableCell className="text-center">
                        <Badge variant={getStatusVariant(order.status)}>{order.status}</Badge>
                        </TableCell>
                         <TableCell className="text-right">
                           <div className="flex flex-col items-end">
                             <span className="font-semibold">{packedUnits} / {totalUnits}</span>
                             <div className="flex items-center gap-2 w-28 mt-1">
                               <Progress value={progress} className="h-1.5" />
                               <span className="text-xs text-muted-foreground w-10 text-left">{progress.toFixed(0)}%</span>
                             </div>
                              <span className="text-xs text-muted-foreground mt-1">{boxCount} Cajas</span>
                           </div>
                        </TableCell>
                        <TableCell className="text-center space-x-2">
                             {order.status === 'En Empaque' && (
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button size="sm" variant="destructive">
                                            <Lock className="mr-2 h-4 w-4" />
                                            Forzar Cierre
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>¿Forzar Cierre de Pedido?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                Esta acción marcará el pedido como "Empacado" aunque no esté completo. Podrá generar la orden de despacho. ¿Desea continuar?
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>No</AlertDialogCancel>
                                            <AlertDialogAction onClick={() => onForceCloseOrder(order)}>Sí, Cerrar Pedido</AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            )}
                            <Button onClick={() => onOpenPrintDialog(order)} size="sm" variant="outline">
                                <Printer className="mr-2 h-4 w-4" />
                                Etiquetas
                            </Button>
                            <Button onClick={() => onStartPacking(order)} size="sm" disabled={order.status === 'Empacado' || order.status === 'Cancelado'}>
                                <PackageCheck className="mr-2 h-4 w-4" />
                                {order.status === 'En Empaque' ? 'Continuar' : 'Empacar'}
                            </Button>
                        </TableCell>
                    </TableRow>
                )
            })}
        </TableBody>
    </Table>
  );
};


export const WholesaleDashboard: React.FC<WholesaleDashboardProps> = ({
    orders,
    isLoadingOrders,
    fetchOrders,
    onStartPacking,
    onReturnToSuite,
    onNavigateToPackedOrdersDashboard,
    onNavigateToDispatchDashboard,
}) => {
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [isPrintDialogOpen, setIsPrintDialogOpen] = useState(false);
  const [orderForPrinting, setOrderForPrinting] = useState<WholesaleOrder | null>(null);
  const [allPackedItems, setAllPackedItems] = useState<PackedItem[]>([]);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());


  const { toast } = useToast();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  
  // Optimization: Fetch all packed items at once when the component mounts or orders change.
  useEffect(() => {
    const fetchAllPackedItems = async () => {
        const orderIds = orders.map(o => o.id);
        const allItems: PackedItem[] = [];
        // This is not ideal, but necessary without a "get all" function.
        for (const orderId of orderIds) {
            const result = await getPackedItemsForOrder(orderId);
            if (result.data) {
                allItems.push(...result.data);
            }
        }
        setAllPackedItems(allItems);
    };
    if (orders.length > 0) {
        fetchAllPackedItems();
    }
  }, [orders]);

  const handleOpenPrintDialog = (order: WholesaleOrder) => {
    setOrderForPrinting(order);
    setIsPrintDialogOpen(true);
  };
  
  const handleOrderSelect = (orderId: string, isSelected: boolean) => {
    setSelectedOrders(prev => {
        const newSelection = new Set(prev);
        if(isSelected) {
            newSelection.add(orderId);
        } else {
            newSelection.delete(orderId);
        }
        return newSelection;
    });
  };

  const handleDownloadTemplate = () => {
    // Create a link to the static template in the public folder
    const link = document.createElement('a');
    link.href = '/templates/plantilla_pedidos_mayorista.xlsx';
    link.setAttribute('download', 'plantilla_pedidos_mayorista.xlsx');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    toast({
      title: "Plantilla descargada",
      description: "Se ha descargado la plantilla de Excel."
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    try {
        const fileContent = await file.arrayBuffer();
        const workbook = XLSX.read(fileContent, { type: 'binary', cellDates: true });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(sheet);
        
        const ordersMap = new Map<string, WholesaleOrder>();
        
        data.forEach((row: any) => {
            const orderId = String(row['Nro documento'] || '').trim();
            if (!orderId) return;

            if (!ordersMap.has(orderId)) {
                let orderDate: Date;
                const rawDate = row['Fecha'];

                if (rawDate instanceof Date) {
                    orderDate = rawDate;
                } else if (typeof rawDate === 'number') {
                    orderDate = excelSerialDateToJSDate(rawDate);
                } else if (typeof rawDate === 'string') {
                    const parsedDate = new Date(rawDate);
                    orderDate = isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
                } else {
                    orderDate = new Date();
                }

                ordersMap.set(orderId, {
                    id: orderId,
                    vendedor: String(row['Nombre vendedor'] || ''),
                    fecha: orderDate.toISOString(),
                    bodega: String(row['Bodega'] || ''),
                    cliente: String(row['Razón social cliente despacho'] || ''),
                    sucursal: String(row['Sucursal factura'] || ''),
                    ordenDeCompra: String(row['Orden de compra'] || ''),
                    cantidadTotal: 0,
                    valorNetoTotal: 0,
                    status: 'Pte Empaque',
                    details: [],
                });
            }

            const order = ordersMap.get(orderId)!;
            
            const newDetail: WholesaleOrderDetail = {
                referencia: String(row['Referencia'] || '').trim(),
                item: String(row['Item'] || '').trim(),
                talla: String(row['Detalle ext. 1'] || '').trim(),
                cantidad: Number(row['Cant. comprom.']),
            };

            order.cantidadTotal += newDetail.cantidad;
            order.valorNetoTotal += Number(row['Valor neto']) || 0;
            
            const detailKey = `${newDetail.referencia}-${newDetail.talla}-${newDetail.item}`;
            const existingDetail = order.details.find(d => `${d.referencia}-${d.talla}-${d.item}` === detailKey);
            
            if (existingDetail) {
                existingDetail.cantidad += newDetail.cantidad;
            } else {
                order.details.push(newDetail);
            }
        });

        const newOrders = Array.from(ordersMap.values());
        const result = await processAndSaveWholesaleFile(newOrders);
        if (result.error) {
            toast({ variant: "destructive", title: "Error al procesar pedidos", description: result.error });
        } else {
            toast({ title: "Proceso completado", description: `Se procesaron ${result.data?.processedCount || 0} pedidos.` });
            fetchOrders();
        }
    } catch(err: any) {
        toast({ variant: 'destructive', title: 'Error', description: `Error al procesar el archivo: ${err.message}` });
    } finally {
        setIsProcessing(false);
        if (e.target) e.target.value = ''; // Reset file input
    }
  };

  const handleForceClose = async (order: WholesaleOrder) => {
    const result = await updateOrderStatus(order.id, 'Empacado');
    if (result.success) {
        toast({ title: "Estado Actualizado", description: `El pedido ${order.id} ha sido marcado como Empacado.` });
        fetchOrders();
    } else {
        toast({ variant: 'destructive', title: "Error", description: result.error });
    }
  };

  const onUploadClick = () => fileInputRef.current?.click();

  const ordersByStatus = React.useMemo(() => {
    return orders.reduce((acc, order) => {
      const status = order.status;
      if (!acc[status]) {
        acc[status] = [];
      }
      acc[status].push(order);
      return acc;
    }, {} as Record<OrderStatus, WholesaleOrder[]>);
  }, [orders]);
  
  return (
    <div className="space-y-8">
      {orderForPrinting && (
        <LabelPrintDialog
            isOpen={isPrintDialogOpen}
            onOpenChange={setIsPrintDialogOpen}
            order={orderForPrinting}
        />
      )}
      <div className="flex justify-between items-center flex-wrap gap-4">
          <div className="flex-1">
              <h1 className="text-2xl font-bold">Módulo de Ventas por Mayor</h1>
              <p className="text-muted-foreground">Cargue el archivo de Excel o CSV con los pedidos para comenzar a procesarlos.</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <input type="file" ref={fileInputRef} className="hidden" onChange={(e) => handleFileChange(e)} accept=".xlsx, .xls, .csv, .txt" />
            <Button onClick={onUploadClick} disabled={isProcessing}>
              {isProcessing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <UploadCloud className="mr-2 h-4 w-4" />
              )}
              Cargar Pedidos
            </Button>
            <Button onClick={handleDownloadTemplate} variant="outline" className="border-primary/50 text-primary hover:bg-primary/5">
                <Download className="mr-2 h-4 w-4" />
                Descargar Plantilla
            </Button>
            <Button onClick={onNavigateToDispatchDashboard} variant="default">
                <Compass className="mr-2 h-4 w-4" />
                Gestionar Despachos
            </Button>
            <Button onClick={onNavigateToPackedOrdersDashboard} variant="outline">
                <BarChart2 className="mr-2 h-4 w-4" />
                Ver Analíticas
            </Button>
            <Button onClick={onReturnToSuite} variant="secondary">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Volver
            </Button>
          </div>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle>Flujo de Empaque de Pedidos</CardTitle>
           <CardDescription>
            {orders.length > 0 ? `Se encontraron ${orders.length} pedidos. Seleccione uno para comenzar.` : 'Aún no se han cargado pedidos.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingOrders ? (
             <div className="flex flex-col items-center justify-center h-48">
              <Loader2 className="w-12 h-12 mb-4 text-primary animate-spin" />
              <p className="text-muted-foreground">Cargando pedidos desde la base de datos...</p>
             </div>
          ) : (
            <Tabs defaultValue="Pte Empaque" className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="Pte Empaque">Pendiente Empaque ({ordersByStatus['Pte Empaque']?.length || 0})</TabsTrigger>
                <TabsTrigger value="En Empaque">En Empaque ({ordersByStatus['En Empaque']?.length || 0})</TabsTrigger>
                <TabsTrigger value="Empacado">Empacado ({ordersByStatus['Empacado']?.length || 0})</TabsTrigger>
                <TabsTrigger value="Cancelado">Cancelado ({ordersByStatus['Cancelado']?.length || 0})</TabsTrigger>
              </TabsList>
              <TabsContent value="Pte Empaque" className="mt-4">
                  <OrderTable orders={ordersByStatus['Pte Empaque'] || []} sessions={new Map()} allPackedItems={allPackedItems} selectedOrders={selectedOrders} onOrderSelect={handleOrderSelect} onStartPacking={onStartPacking} onOpenPrintDialog={handleOpenPrintDialog} onForceCloseOrder={handleForceClose} />
              </TabsContent>
              <TabsContent value="En Empaque" className="mt-4">
                  <OrderTable orders={ordersByStatus['En Empaque'] || []} sessions={new Map()} allPackedItems={allPackedItems} selectedOrders={selectedOrders} onOrderSelect={handleOrderSelect} onStartPacking={onStartPacking} onOpenPrintDialog={handleOpenPrintDialog} onForceCloseOrder={handleForceClose} />
              </TabsContent>
              <TabsContent value="Empacado" className="mt-4">
                  <OrderTable orders={ordersByStatus['Empacado'] || []} sessions={new Map()} allPackedItems={allPackedItems} selectedOrders={selectedOrders} onOrderSelect={handleOrderSelect} onStartPacking={onStartPacking} onOpenPrintDialog={handleOpenPrintDialog} onForceCloseOrder={handleForceClose} />
              </TabsContent>
               <TabsContent value="Cancelado" className="mt-4">
                  <OrderTable orders={ordersByStatus['Cancelado'] || []} sessions={new Map()} allPackedItems={allPackedItems} selectedOrders={selectedOrders} onOrderSelect={handleOrderSelect} onStartPacking={onStartPacking} onOpenPrintDialog={handleOpenPrintDialog} onForceCloseOrder={handleForceClose} />
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

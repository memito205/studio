
"use client";

import React, { useEffect, useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { UploadCloud, Loader2, PackageCheck, ArrowLeft, Database, Boxes, BarChart2, Printer, Send, Lock, Compass, Download, FileSearch, RotateCcw, Truck } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth-context';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { WholesaleOrder, WholesaleOrderDetail, OrderStatus, ProductDatabaseItem, PackingSession, PreprintedLabel, PackedItem, OperationPulse } from '@/types';
import { processAndSaveWholesaleFile, saveProductDatabaseItems, updateOrderStatus, getPackingSession, generateAndSaveLabels, getLabelsForOrder, addSingleLabel, loadAllPackingSessions, getPackedItemsForOrder, getPackedItemsForDate, getUserPulsesForDay, loadOperatorMappings } from '@/app/actions';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import { exportToXlsx } from '@/services/export';
import { LabelPrintDialog } from './LabelPrintDialog';
import { OrderAuditDialog } from './OrderAuditDialog';
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
  onOpenAuditDialog: (order: WholesaleOrder) => void;
  onForceDispatchOrder: (order: WholesaleOrder) => void;
  role: string | null;
}> = ({ orders, sessions, allPackedItems, selectedOrders, onOrderSelect, onStartPacking, onOpenPrintDialog, onForceCloseOrder, onOpenAuditDialog, onForceDispatchOrder, role }) => {
    
  if (orders.length === 0) {
    return <p className="text-muted-foreground text-center py-8">No hay pedidos en esta etapa.</p>;
  }

  const getStatusVariant = (status: OrderStatus) => {
    switch (status) {
      case 'Pte Empaque': return 'warning';
      case 'En Empaque': return 'default';
      case 'Empacado': return 'success';
      case 'En Cargue': return 'default';
      case 'Despachado': return 'secondary';
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
                             {order.status === 'En Empaque' && (role === 'admin' || role === 'supervisor') && (
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
                            {order.status === 'En Cargue' && (role === 'admin' || role === 'supervisor') && (
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button size="sm" variant="outline" className="mr-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50">
                                            <Send className="mr-2 h-4 w-4" />
                                            Forzar Despacho
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>¿Confirmar Despacho Forzado?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                Esta acción pasará el pedido a estado 'Despachado' aunque no se hayan cargado todas sus cajas en el panel de despacho.
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                            <AlertDialogAction onClick={() => onForceDispatchOrder(order)} className="bg-blue-600 hover:bg-blue-700">
                                                Confirmar
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            )}
                            <Button onClick={() => onOpenAuditDialog(order)} size="sm" variant="outline" className="mr-2 border-primary/20 hover:bg-primary/10">
                                <FileSearch className="mr-2 h-4 w-4" />
                                Auditar
                            </Button>
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
  const [isAuditDialogOpen, setIsAuditDialogOpen] = useState(false);
  const [orderForAuditing, setOrderForAuditing] = useState<WholesaleOrder | null>(null);
  const [allPackedItems, setAllPackedItems] = useState<PackedItem[]>([]);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [isProductivityDialogOpen, setIsProductivityDialogOpen] = useState(false);

  const { role } = useAuth();
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
  
  const handleOpenAuditDialog = (order: WholesaleOrder) => {
    setOrderForAuditing(order);
    setIsAuditDialogOpen(true);
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

  const handleForceDispatch = async (order: WholesaleOrder) => {
    setIsProcessing(true);
    try {
        const result = await updateOrderStatus(order.id, 'Despachado');
        if (result.success) {
            toast({ title: "Estado Actualizado", description: `El pedido ${order.id} ha sido forzado a Despachado.` });
            fetchOrders();
        } else {
            console.error("Failed to force dispatch:", result.error);
            toast({ variant: 'destructive', title: "Error", description: `Error al forzar despacho: ${result.error}` });
        }
    } catch (error) {
        console.error("Error force dispatching order:", error);
    } finally {
        setIsProcessing(false);
    }
  };

  const onUploadClick = () => fileInputRef.current?.click();

  const ordersByStatus = React.useMemo(() => {
    return orders.reduce((acc, order) => {
        const packedUnits = allPackedItems.filter(item => item.orderId === order.id).reduce((sum, item) => sum + item.quantity, 0);
        let status = order.status || 'Pte Empaque';
        
        // Logical correction for UI grouping
        if (status === 'Pte Empaque' && packedUnits > 0) {
            status = 'En Empaque';
        } else if (status === 'En Empaque' && packedUnits >= order.cantidadTotal && order.cantidadTotal > 0) {
            status = 'Empacado';
        }
        
        if (!acc[status]) acc[status] = [];
        acc[status].push({ ...order, status }); // Pass corrected status to children
        return acc;
    }, {} as Record<string, WholesaleOrder[]>);
  }, [orders, allPackedItems]);

  // Background sync for stale statuses
  useEffect(() => {
    const syncStatuses = async () => {
        for (const order of orders) {
            const packedUnits = allPackedItems.filter(item => item.orderId === order.id).reduce((sum, item) => sum + item.quantity, 0);
            let targetStatus: OrderStatus | null = null;

            if (order.status === 'Pte Empaque' && packedUnits > 0) {
                targetStatus = 'En Empaque';
            } else if (order.status === 'En Empaque' && packedUnits >= order.cantidadTotal && order.cantidadTotal > 0) {
                targetStatus = 'Empacado';
            }

            if (targetStatus) {
                await updateOrderStatus(order.id, targetStatus);
            }
        }
    };
    if (orders.length > 0 && allPackedItems.length > 0) {
        syncStatuses();
    }
  }, [orders.length, allPackedItems.length]);
  
  return (
    <div className="space-y-8">
      {orderForPrinting && (
        <LabelPrintDialog
            isOpen={isPrintDialogOpen}
            onOpenChange={setIsPrintDialogOpen}
            order={orderForPrinting}
        />
      )}
      <PackingProductivityDialog
        isOpen={isProductivityDialogOpen}
        onOpenChange={setIsProductivityDialogOpen}
      />
      {orderForAuditing && (
        <OrderAuditDialog
            isOpen={isAuditDialogOpen}
            onOpenChange={setIsAuditDialogOpen}
            order={orderForAuditing}
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
            {(role === 'admin' || role === 'supervisor') && (
                <>
                    <Button onClick={() => setIsProductivityDialogOpen(true)} variant="outline" className="bg-primary/5 border-primary/20 hover:bg-primary/10">
                        <BarChart2 className="mr-2 h-4 w-4" />
                        Reporte de Productividad
                    </Button>
                    <Button onClick={onNavigateToDispatchDashboard} className="bg-amber-600 hover:bg-amber-700 text-white">
                        <Truck className="mr-2 h-4 w-4" />
                        Generar Despacho
                    </Button>
                    <Button onClick={onNavigateToPackedOrdersDashboard} variant="outline">
                        <Compass className="mr-2 h-4 w-4" />
                        Ver Analíticas
                    </Button>
                </>
            )}
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
              <TabsList className="grid w-full grid-cols-6">
                <TabsTrigger value="Pte Empaque">Pendiente Empaque ({ordersByStatus['Pte Empaque']?.length || 0})</TabsTrigger>
                <TabsTrigger value="En Empaque">En Empaque ({ordersByStatus['En Empaque']?.length || 0})</TabsTrigger>
                <TabsTrigger value="Empacado">Empacado ({ordersByStatus['Empacado']?.length || 0})</TabsTrigger>
                <TabsTrigger value="En Cargue">En Cargue ({ordersByStatus['En Cargue']?.length || 0})</TabsTrigger>
                <TabsTrigger value="Despachado">Despachado ({ordersByStatus['Despachado']?.length || 0})</TabsTrigger>
                <TabsTrigger value="Cancelado">Cancelado ({ordersByStatus['Cancelado']?.length || 0})</TabsTrigger>
              </TabsList>
              <TabsContent value="Pte Empaque" className="mt-4">
                  <OrderTable orders={ordersByStatus['Pte Empaque'] || []} sessions={new Map()} allPackedItems={allPackedItems} selectedOrders={selectedOrders} onOrderSelect={handleOrderSelect} onStartPacking={onStartPacking} onOpenPrintDialog={handleOpenPrintDialog} onForceCloseOrder={handleForceClose} onOpenAuditDialog={handleOpenAuditDialog} onForceDispatchOrder={handleForceDispatch} role={role} />
              </TabsContent>
              <TabsContent value="En Empaque" className="mt-4">
                  <OrderTable orders={ordersByStatus['En Empaque'] || []} sessions={new Map()} allPackedItems={allPackedItems} selectedOrders={selectedOrders} onOrderSelect={handleOrderSelect} onStartPacking={onStartPacking} onOpenPrintDialog={handleOpenPrintDialog} onForceCloseOrder={handleForceClose} onOpenAuditDialog={handleOpenAuditDialog} onForceDispatchOrder={handleForceDispatch} role={role} />
              </TabsContent>
              <TabsContent value="Empacado" className="mt-4">
                  <OrderTable orders={ordersByStatus['Empacado'] || []} sessions={new Map()} allPackedItems={allPackedItems} selectedOrders={selectedOrders} onOrderSelect={handleOrderSelect} onStartPacking={onStartPacking} onOpenPrintDialog={handleOpenPrintDialog} onForceCloseOrder={handleForceClose} onOpenAuditDialog={handleOpenAuditDialog} onForceDispatchOrder={handleForceDispatch} role={role} />
              </TabsContent>
              <TabsContent value="En Cargue" className="mt-4">
                  <OrderTable orders={ordersByStatus['En Cargue'] || []} sessions={new Map()} allPackedItems={allPackedItems} selectedOrders={selectedOrders} onOrderSelect={handleOrderSelect} onStartPacking={onStartPacking} onOpenPrintDialog={handleOpenPrintDialog} onForceCloseOrder={handleForceClose} onOpenAuditDialog={handleOpenAuditDialog} onForceDispatchOrder={handleForceDispatch} role={role} />
              </TabsContent>
              <TabsContent value="Despachado" className="mt-4">
                  <OrderTable orders={ordersByStatus['Despachado'] || []} sessions={new Map()} allPackedItems={allPackedItems} selectedOrders={selectedOrders} onOrderSelect={handleOrderSelect} onStartPacking={onStartPacking} onOpenPrintDialog={handleOpenPrintDialog} onForceCloseOrder={handleForceClose} onOpenAuditDialog={handleOpenAuditDialog} onForceDispatchOrder={handleForceDispatch} role={role} />
              </TabsContent>
               <TabsContent value="Cancelado" className="mt-4">
                  <OrderTable orders={ordersByStatus['Cancelado'] || []} sessions={new Map()} allPackedItems={allPackedItems} selectedOrders={selectedOrders} onOrderSelect={handleOrderSelect} onStartPacking={onStartPacking} onOpenPrintDialog={handleOpenPrintDialog} onForceCloseOrder={handleForceClose} onOpenAuditDialog={handleOpenAuditDialog} onForceDispatchOrder={handleForceDispatch} role={role} />
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

const PackingProductivityDialog: React.FC<{ isOpen: boolean; onOpenChange: (open: boolean) => void }> = ({ isOpen, onOpenChange }) => {
    const [isLoading, setIsLoading] = useState(false);
    const [debugInfo, setDebugInfo] = useState<any>(null);
    const [reportData, setReportData] = useState<any[]>([]);
    const { toast } = useToast();

    const fetchReportData = async () => {
        setIsLoading(true);
        try {
            const today = new Date().toLocaleDateString('sv-SE');
            const [sessionsRes, itemsRes, mappingsRes] = await Promise.all([
                loadAllPackingSessions(),
                getPackedItemsForDate(today),
                loadOperatorMappings()
            ]);

            if (sessionsRes.error) throw new Error(sessionsRes.error);
            if (itemsRes.error) throw new Error(itemsRes.error);

            const sessions = sessionsRes.data || [];
            const allItems = itemsRes.data || [];
            const mappings = mappingsRes.data || {};

            // Group by packer
            const packerMap = new Map<string, { id: string, name: string, items: PackedItem[], sessions: PackingSession[] }>();

            // Collect all unique packers from sessions and items
            sessions.forEach(s => {
                if (!s.packerId) return;
                if (!packerMap.has(s.packerId)) {
                    packerMap.set(s.packerId, { id: s.packerId, name: s.packerName || 'Operario', items: [], sessions: [] });
                }
                packerMap.get(s.packerId)!.sessions.push(s);
            });

            allItems.forEach(i => {
                if (!i.packerId) return;
                if (!packerMap.has(i.packerId)) {
                    packerMap.set(i.packerId, { id: i.packerId, name: 'Operario', items: [], sessions: [] });
                }
                packerMap.get(i.packerId)!.items.push(i);
            });

            const processedData = [];
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            const todayStartTime = todayStart.getTime();

            for (const [packerId, data] of packerMap.entries()) {
                const pulsesRes = await getUserPulsesForDay(packerId, today);
                const pulses = pulsesRes.data || [];
                
                // Better name retrieval: Priority: Mappings > Pulse Name > Session Name > Default
                let bestName = data.name;
                
                if (mappings[packerId]) {
                    bestName = mappings[packerId];
                } else if (bestName === 'Operario' || bestName.includes('@')) {
                    const pulseWithName = pulses.find(p => p.userName && p.userName !== 'Operario' && !p.userName.includes('@'));
                    if (pulseWithName) bestName = pulseWithName.userName;
                }

                // Find first scan strictly today
                const scanTimes = data.items.map(i => {
                    const d = (i.scannedAt as any)?.toDate?.() || new Date(i.scannedAt);
                    return d.getTime();
                }).filter(t => !isNaN(t) && t >= todayStartTime);
                
                const sessionTimes = data.sessions.flatMap(s => (s.units || []).map(u => u.createdAt ? new Date(u.createdAt).getTime() : 0))
                    .filter(t => t >= todayStartTime);
                
                let totalEffectiveMs = 0;
                let units = 0;

                // Group activity by orderId to calculate per-operation time
                const ordersWorked = new Set([...data.items.map(i => i.orderId), ...data.sessions.map(s => s.orderId)]);
                
                ordersWorked.forEach(orderId => {
                    const orderItems = data.items.filter(i => i.orderId === orderId);
                    const orderSessions = data.sessions.filter(s => s.orderId === orderId);
                    
                    const orderScanTimes = orderItems.map(i => {
                        const d = (i.scannedAt as any)?.toDate?.() || new Date(i.scannedAt);
                        return d.getTime();
                    }).filter(t => !isNaN(t) && t >= todayStartTime);

                    const orderSessionTimes = orderSessions.flatMap(s => (s.units || []).map(u => u.createdAt ? new Date(u.createdAt).getTime() : 0))
                        .filter(t => t >= todayStartTime);

                    if (orderScanTimes.length === 0 && orderSessionTimes.length === 0) return;

                    const opStart = Math.min(...orderScanTimes, ...orderSessionTimes);
                    const opEnd = Math.max(...orderScanTimes, ...orderSessionTimes, opStart + 1000);
                    
                    // If the operation was recent (within last 30 mins), consider it ongoing
                    const finalOpEnd = (Date.now() - opEnd < 1800000) ? Date.now() : opEnd;
                    
                    const opElapsedMs = finalOpEnd - opStart;
                    
                    // Calculate pauses within this specific operation
                    const opPauses = [
                        ...orderSessions.flatMap(s => (s.pauses || [])).filter(p => p.userId === packerId).map(p => ({ 
                            start: new Date(p.startTime).getTime(), 
                            end: p.endTime ? new Date(p.endTime).getTime() : Date.now() 
                        })),
                        ...pulses
                            .filter(p => {
                                const pulseStart = p.startTime instanceof Date ? p.startTime.getTime() : (p.startTime as any).toDate?.()?.getTime() || new Date(p.startTime).getTime();
                                return pulseStart >= opStart && pulseStart <= finalOpEnd;
                            })
                            .map(p => ({ 
                                start: p.startTime instanceof Date ? p.startTime.getTime() : (p.startTime as any).toDate?.()?.getTime() || new Date(p.startTime).getTime(), 
                                end: p.endTime ? (p.endTime instanceof Date ? p.endTime.getTime() : (p.endTime as any).toDate?.()?.getTime() || new Date(p.endTime).getTime()) : Date.now() 
                            }))
                    ];

                    opPauses.sort((a,b) => a.start - b.start);
                    let opPauseMs = 0;
                    if (opPauses.length > 0) {
                        let curr = { ...opPauses[0] };
                        const merged = [];
                        for (let i = 1; i < opPauses.length; i++) {
                            if (opPauses[i].start <= curr.end) curr.end = Math.max(curr.end, opPauses[i].end);
                            else { merged.push(curr); curr = { ...opPauses[i] }; }
                        }
                        merged.push(curr);
                        
                        merged.forEach(p => {
                            const intersectionStart = Math.max(p.start, opStart);
                            const intersectionEnd = Math.min(p.end, finalOpEnd);
                            if (intersectionEnd > intersectionStart) opPauseMs += (intersectionEnd - intersectionStart);
                        });
                    }

                    totalEffectiveMs += Math.max(0, opElapsedMs - opPauseMs);
                    units += orderItems.reduce((sum, i) => sum + (i.quantity || 1), 0);
                });

                const firstScanTime = Math.min(...data.items.map(i => {
                    const d = (i.scannedAt as any)?.toDate?.() || new Date(i.scannedAt);
                    return d.getTime();
                }).filter(t => !isNaN(t) && t >= todayStartTime));

                const uph = totalEffectiveMs > 0 ? (units / (totalEffectiveMs / 1000)) * 3600 : 0;
                
                // Current status from last pulse
                const lastPulse = pulses.sort((a,b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())[0];

                if (units > 0) {
                    processedData.push({
                        packerId,
                        name: bestName,
                        firstScanTime,
                        totalItems: units,
                        effectiveMs: totalEffectiveMs,
                        uph,
                        status: lastPulse?.status || 'Activo',
                        isPaused: lastPulse?.type === 'pause' && !lastPulse.endTime
                    });
                }
            }

            setDebugInfo({
                itemsCount: allItems.length,
                sessionsCount: sessions.length,
                packerMapSize: packerMap.size,
                processedLength: processedData.length,
                sampleItemScanAt: allItems[0]?.scannedAt,
                sampleType: typeof allItems[0]?.scannedAt
            });
            setReportData(processedData.sort((a,b) => b.totalItems - a.totalItems));
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Error', description: err.message });
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) fetchReportData();
    }, [isOpen]);

    const formatMs = (ms: number) => {
        const s = Math.floor(ms / 1000);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        return `${h}h ${m}m`;
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <BarChart2 className="w-6 h-6 text-primary" />
                        Reporte de Productividad de Empaque (Hoy)
                    </DialogTitle>
                    <DialogDescription>Resumen consolidado de todos los operarios que han empacado el día de hoy.</DialogDescription>
                </DialogHeader>

                {isLoading ? (
                    <div className="flex-grow flex flex-col items-center justify-center p-12 gap-4">
                        <Loader2 className="w-10 h-10 animate-spin text-primary" />
                        <p className="text-muted-foreground">Procesando métricas de todos los trabajadores...</p>
                    </div>
                ) : (
                    <div className="py-4 flex-grow overflow-y-auto pr-2">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                            <Card className="bg-primary/5">
                                <CardContent className="pt-6">
                                    <p className="text-sm font-medium text-muted-foreground">Total Ítems Empacados</p>
                                    <p className="text-3xl font-bold">{reportData.reduce((sum, d) => sum + d.totalItems, 0)}</p>
                                </CardContent>
                            </Card>
                            <Card className="bg-secondary/50">
                                <CardContent className="pt-6">
                                    <p className="text-sm font-medium text-muted-foreground">Operarios Activos</p>
                                    <p className="text-3xl font-bold text-blue-600">{reportData.length}</p>
                                </CardContent>
                            </Card>
                            <Card className="bg-green-500/5">
                                <CardContent className="pt-6">
                                    <p className="text-sm font-medium text-muted-foreground">Promedio Unidades/hr</p>
                                    <p className="text-3xl font-bold text-green-600">
                                        {reportData.length > 0 ? (reportData.reduce((sum, d) => sum + d.uph, 0) / reportData.length).toFixed(1) : '0.0'}
                                    </p>
                                </CardContent>
                            </Card>
                        </div>

                        <div className="border rounded-md overflow-hidden">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Operario</TableHead>
                                        <TableHead>Estado</TableHead>
                                        <TableHead>Inicio</TableHead>
                                        <TableHead className="text-right">Ítems</TableHead>
                                        <TableHead className="text-right">T. Efectivo</TableHead>
                                        <TableHead className="text-right font-bold text-primary">Unidades/hr</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {reportData.map(d => (
                                        <TableRow key={d.packerId}>
                                            <TableCell className="font-medium">{d.name}</TableCell>
                                            <TableCell>
                                                <Badge variant={d.isPaused ? 'warning' : 'outline'} className={cn(!d.isPaused && "border-green-200 text-green-700 bg-green-50")}>
                                                    {d.status}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-xs text-muted-foreground">{new Date(d.firstScanTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</TableCell>
                                            <TableCell className="text-right font-bold">{d.totalItems}</TableCell>
                                            <TableCell className="text-right">{formatMs(d.effectiveMs)}</TableCell>
                                            <TableCell className="text-right font-bold text-lg text-primary">{d.uph.toFixed(1)}</TableCell>
                                        </TableRow>
                                    ))}
                                    {reportData.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No se detectó actividad de empaque hoy.</TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                        {debugInfo && (
                            <div className="mt-4 p-2 bg-gray-100 text-xs text-black rounded break-all">
                                Debug: {JSON.stringify(debugInfo)}
                            </div>
                        )}
                    </div>
                )}

                <DialogFooter className="gap-2 mt-4">
                    <Button variant="outline" onClick={fetchReportData} disabled={isLoading}>
                        <RotateCcw className="w-4 h-4 mr-2" />
                        Actualizar
                    </Button>
                    <Button onClick={() => onOpenChange(false)}>Cerrar</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

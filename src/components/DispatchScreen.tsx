
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { WholesaleOrder, PackingSession, PreprintedLabel, DispatchSessionInfo, BoxToDispatch, LabelValidationResult, PackedItem } from '@/types';
import { getPackingSession, getLabelsForOrder, getShipments, addScannedLabelToShipment, removeScannedLabelFromShipment, validateLabel, loadWholesaleOrders, closeShipment } from '@/app/actions';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft, Loader2, ScanLine, Truck, Check, X, Trash2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { DispatchReport } from './DispatchReport';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';


interface DispatchScreenProps {
  shipmentId: string;
  onReturnToDispatchDashboard: () => void;
}

export const DispatchScreen: React.FC<DispatchScreenProps> = ({ shipmentId, onReturnToDispatchDashboard }) => {
  const [sessionInfo, setSessionInfo] = useState<DispatchSessionInfo | null>(null);
  const [scannedLabel, setScannedLabel] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();
  const scanInputRef = React.useRef<HTMLInputElement>(null);
  const [view, setView] = useState<'scanning' | 'report'>('scanning');
  const [reportData, setReportData] = useState<{ sessionInfo: DispatchSessionInfo; boxes: BoxToDispatch[] } | null>(null);
  const [allOrders, setAllOrders] = useState<WholesaleOrder[]>([]);
  const [allLabels, setAllLabels] = useState<PreprintedLabel[]>([]);


  const fetchShipmentData = useCallback(async () => {
    const result = await getShipments();
    if (result.success && result.data) {
      const currentShipment = result.data.find(s => s.id === shipmentId);
      if (currentShipment) {
        setSessionInfo(currentShipment);
      } else {
        toast({ variant: 'destructive', title: 'Error', description: `No se encontró el envío con ID ${shipmentId}` });
      }
    } else {
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudo cargar la información del envío.' });
    }
    setIsLoading(false);
  }, [shipmentId, toast]);
  
  useEffect(() => {
    const fetchInitialData = async () => {
        setIsLoading(true);
        await fetchShipmentData();
        const ordersResult = await loadWholesaleOrders();
        if (ordersResult.data) {
            setAllOrders(ordersResult.data);
        }
        // In a real scenario with many labels, this should be more targeted
        const allLabelsResult = await getLabelsForOrder(''); // This is a placeholder, a better function would be needed
        // setAllLabels(allLabelsResult.data || []);
        setIsLoading(false);
    }
    fetchInitialData();
  }, [fetchShipmentData]);

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scannedLabel.trim() || isProcessing) return;
    
    setIsProcessing(true);
    const labelId = scannedLabel.trim().toUpperCase();
    
    // First, validate the label
    const validationResult = await validateLabel(labelId, ''); // Pass empty orderId for general validation
    if (!validationResult.isValid) {
      toast({ variant: 'destructive', title: 'Etiqueta no válida', description: validationResult.message });
      setIsProcessing(false);
      setScannedLabel('');
      scanInputRef.current?.focus();
      return;
    }

    const result = await addScannedLabelToShipment(shipmentId, labelId);

    if(result.success) {
        toast({ title: 'Éxito', description: `Etiqueta ${labelId} añadida al envío.` });
        setScannedLabel('');
        fetchShipmentData(); 
    } else {
        toast({ variant: 'destructive', title: 'Error al Añadir Etiqueta', description: result.error });
    }

    setIsProcessing(false);
    scanInputRef.current?.focus();
  };
  
  const handleRemove = async (labelIdToRemove: string) => {
    const result = await removeScannedLabelFromShipment(shipmentId, labelIdToRemove);
    if(result.success) {
        toast({ title: 'Etiqueta Eliminada', description: `Se quitó la etiqueta ${labelIdToRemove} del envío.` });
        fetchShipmentData(); // Refresh data
    } else {
        toast({ variant: 'destructive', title: 'Error al Eliminar', description: result.error });
    }
  }

  const handleFinalize = async () => {
    if (!sessionInfo || !sessionInfo.scannedLabels) return;
    setIsProcessing(true);
    
    // Close the shipment in the backend
    const closeResult = await closeShipment(sessionInfo.id!);
    if(!closeResult.success) {
        toast({ variant: 'destructive', title: 'Error', description: `No se pudo cerrar el envío: ${closeResult.error}` });
        setIsProcessing(false);
        return;
    }
    
    toast({ title: "Envío Cerrado", description: "El envío ha sido finalizado y no aceptará más cajas." });

    const labelIds = Object.keys(sessionInfo.scannedLabels);
    const tempLabels: PreprintedLabel[] = [];
    const tempPackedItems: PackedItem[] = [];

    // This is inefficient and should be replaced by better server actions
    for(const orderId of sessionInfo.orderIds || []) {
      const labelsRes = await getLabelsForOrder(orderId);
      const itemsRes = await getPackedItemsForOrder(orderId);
      if(labelsRes.data) tempLabels.push(...labelsRes.data);
      if(itemsRes.data) tempPackedItems.push(...itemsRes.data);
    }
    
    const boxesForReport: BoxToDispatch[] = labelIds.map(labelId => {
      const labelInfo = tempLabels.find(l => l.id === labelId);
      const orderInfo = allOrders.find(o => o.id === labelInfo?.orderId);
      const itemsInBox = tempPackedItems.filter(p => p.packingUnitId === labelInfo?.unitId?.toString());
      const totalItems = itemsInBox.reduce((sum, item) => sum + item.quantity, 0);

      return {
        labelId: labelId,
        orderId: orderInfo?.ordenDeCompra || labelInfo?.orderId || 'N/A',
        customer: orderInfo?.cliente || 'N/A',
        totalItems: totalItems,
      };
    });
    
    setReportData({ sessionInfo: { ...sessionInfo, status: 'closed' }, boxes: boxesForReport });
    setView('report');
    setIsProcessing(false);
  };


  const scannedLabelsArray = useMemo(() => {
    if (!sessionInfo?.scannedLabels) return [];
    return Object.entries(sessionInfo.scannedLabels)
        .map(([labelId, timestamp]) => ({ labelId, timestamp: new Date(timestamp.seconds * 1000) }))
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }, [sessionInfo?.scannedLabels]);

  if (isLoading || !sessionInfo) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="ml-4">Cargando información del despacho...</p>
      </div>
    );
  }
  
  if (view === 'report' && reportData) {
      return <DispatchReport sessionInfo={reportData.sessionInfo} boxes={reportData.boxes} onReturn={() => setView('scanning')} />;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row justify-between items-center">
            <div>
              <CardTitle>Despacho de Envío #{shipmentId.slice(-6)}</CardTitle>
              <CardDescription>Escanee las etiquetas de las cajas para verificar y registrar la salida.</CardDescription>
            </div>
            <Button onClick={onReturnToDispatchDashboard} variant="outline">
                <ArrowLeft className="mr-2 h-4 w-4" /> Volver a Despachos
            </Button>
        </CardHeader>
        <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 p-4 border rounded-md bg-muted/50">
                <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground">Placa del Camión</p>
                    <p className="font-semibold">{sessionInfo.truckPlate}</p>
                </div>
                <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground">Nombre Conductor</p>
                    <p className="font-semibold">{sessionInfo.driverName}</p>
                </div>
                <div className="space-y-1">
                     <p className="text-sm font-medium text-muted-foreground">Número de Precinto</p>
                    <p className="font-semibold">{sessionInfo.sealNumber || 'N/A'}</p>
                </div>
            </div>

            <form onSubmit={handleScan}>
                <div className="flex items-center gap-4">
                    <div className="flex-grow space-y-1">
                        <Label htmlFor="label-scan" className="sr-only">Escanear Etiqueta</Label>
                        <Input
                            ref={scanInputRef}
                            id="label-scan"
                            type="text"
                            value={scannedLabel}
                            onChange={e => setScannedLabel(e.target.value)}
                            placeholder="Escanear o digitar etiqueta de la caja..."
                            className="w-full text-lg h-12"
                            disabled={isProcessing || sessionInfo.status !== 'open'}
                        />
                    </div>
                    <Button type="submit" className="h-12" disabled={isProcessing || !scannedLabel.trim() || sessionInfo.status !== 'open'}>
                        {isProcessing ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <ScanLine className="mr-2 h-5 w-5"/>}
                         Añadir Caja
                    </Button>
                </div>
                 {sessionInfo.status !== 'open' && (
                    <p className="text-sm text-destructive mt-2">Este envío ya está cerrado y no se pueden añadir más cajas.</p>
                )}
            </form>
        </CardContent>
      </Card>
      
      <Card>
          <CardHeader>
              <CardTitle>Cajas Escaneadas ({scannedLabelsArray.length})</CardTitle>
          </CardHeader>
          <CardContent className="max-h-[40vh] overflow-y-auto">
            {scannedLabelsArray.length > 0 ? (
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>#</TableHead>
                            <TableHead>ID Etiqueta</TableHead>
                            <TableHead>Hora Escaneo</TableHead>
                            <TableHead className="text-right">Acción</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {scannedLabelsArray.map((item, index) => (
                           <TableRow key={item.labelId}>
                               <TableCell>{scannedLabelsArray.length - index}</TableCell>
                               <TableCell className="font-mono">{item.labelId}</TableCell>
                               <TableCell>{item.timestamp.toLocaleTimeString()}</TableCell>
                               <TableCell className="text-right">
                                  <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                       <Button variant="ghost" size="icon" disabled={sessionInfo.status !== 'open'}>
                                            <Trash2 className="h-4 w-4 text-destructive" />
                                       </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>¿Eliminar Etiqueta del Envío?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                Esta acción quitará la etiqueta <strong>{item.labelId}</strong> de este envío. La etiqueta volverá a estar disponible.
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                            <AlertDialogAction onClick={() => handleRemove(item.labelId)}>Confirmar Eliminación</AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                  </AlertDialog>
                               </TableCell>
                           </TableRow>
                        ))}
                    </TableBody>
                </Table>
            ) : (
                 <p className="text-muted-foreground text-center py-8">Aún no se han escaneado cajas para este envío.</p>
            )}
          </CardContent>
      </Card>
      
       <div className="flex justify-end">
        <Button size="lg" disabled={scannedLabelsArray.length === 0 || sessionInfo.status !== 'open' || isProcessing} onClick={handleFinalize}>
          {isProcessing && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
          <Truck className="mr-2 h-5 w-5" />
          Finalizar y Generar Despacho
        </Button>
      </div>
    </div>
  );
};

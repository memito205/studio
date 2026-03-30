
"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { WholesaleOrder, PreprintedLabel, DispatchSessionInfo, BoxToDispatch, PackedItem } from '@/types';
import { getLabelsForOrder, getShipments, addScannedLabelToShipment, removeScannedLabelFromShipment, loadWholesaleOrders, closeShipment, getPackedItemsForOrder } from '@/app/actions';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft, Loader2, ScanLine, Truck, Check, X, Trash2, AlertTriangle, Package, CheckCircle2, XCircle } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { DispatchReport } from './DispatchReport';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

interface DispatchScreenProps {
  shipmentId: string;
  onReturnToDispatchDashboard: () => void;
}

type ScanStatus = 'success' | 'duplicate' | 'error' | null;

interface ScanOverlayData {
  status: ScanStatus;
  labelId: string;
  orderId?: string;
  message?: string;
}

export const DispatchScreen: React.FC<DispatchScreenProps> = ({ shipmentId, onReturnToDispatchDashboard }) => {
  const [sessionInfo, setSessionInfo] = useState<DispatchSessionInfo | null>(null);
  const [scannedLabel, setScannedLabel] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();
  const scanInputRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<'scanning' | 'report'>('scanning');
  const [reportData, setReportData] = useState<{ sessionInfo: DispatchSessionInfo; boxes: BoxToDispatch[] } | null>(null);
  const [allOrders, setAllOrders] = useState<WholesaleOrder[]>([]);
  const [allLabels, setAllLabels] = useState<PreprintedLabel[]>([]);
  const [scanOverlay, setScanOverlay] = useState<ScanOverlayData | null>(null);
  const overlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showOverlay = useCallback((data: ScanOverlayData) => {
    if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
    setScanOverlay(data);
    overlayTimerRef.current = setTimeout(() => {
      setScanOverlay(null);
      scanInputRef.current?.focus();
    }, 2200);
  }, []);

  const fetchShipmentData = useCallback(async () => {
    const result = await getShipments();
    if (result.success && result.data) {
      const currentShipment = result.data.find(s => s.id === shipmentId);
      if (currentShipment) {
        setSessionInfo(currentShipment);
        return currentShipment;
      }
    }
    return null;
  }, [shipmentId]);

  useEffect(() => {
    const fetchInitialData = async () => {
      setIsLoading(true);
      const shipment = await fetchShipmentData();
      const ordersResult = await loadWholesaleOrders();
      if (ordersResult.data) setAllOrders(ordersResult.data);

      // Load labels for all allowed orders
      if (shipment?.allowedOrderIds && shipment.allowedOrderIds.length > 0) {
        const labelsArr: PreprintedLabel[] = [];
        for (const ordId of shipment.allowedOrderIds) {
          const labelsRes = await getLabelsForOrder(ordId);
          if (labelsRes.data) labelsArr.push(...labelsRes.data);
        }
        setAllLabels(labelsArr);
      }
      setIsLoading(false);
    };
    fetchInitialData();
    return () => { if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current); };
  }, [fetchShipmentData]);

  // Focus input on mount
  useEffect(() => {
    if (!isLoading) {
      setTimeout(() => scanInputRef.current?.focus(), 200);
    }
  }, [isLoading]);

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    const inputVal = scannedLabel.trim();
    if (!inputVal || isProcessing) return;

    setIsProcessing(true);
    setScannedLabel('');

    const labelId = inputVal.toUpperCase().replace(/\s+/g, '').replace(/'/g, '-').replace(/_/g, '-');

    // Check if already scanned in this session
    if (sessionInfo?.scannedLabels && sessionInfo.scannedLabels[labelId]) {
      showOverlay({ status: 'duplicate', labelId, message: 'Esta etiqueta ya fue escaneada en este despacho.' });
      setIsProcessing(false);
      return;
    }

    const result = await addScannedLabelToShipment(shipmentId, labelId);

    if (result.success) {
      // Find which order this label belongs to
      const matchedLabel = allLabels.find(l => (l.id || '').toUpperCase() === labelId);
      const matchedOrder = allOrders.find(o => o.id === matchedLabel?.orderId);

      // Show warning if it was an available label (not packed properly)
      if (result.auditWarning) {
        showOverlay({
          status: 'warning',
          labelId,
          orderId: matchedOrder?.ordenDeCompra || matchedLabel?.orderId,
          message: `${matchedOrder?.cliente} (Cargada, pero no figura como empacada. Requiere Auditoría)`,
        });
      } else {
        showOverlay({
          status: 'success',
          labelId,
          orderId: matchedOrder?.ordenDeCompra || matchedLabel?.orderId,
          message: matchedOrder?.cliente,
        });
      }
      
      // Refresh session data so pending/dispatched split updates
      const updated = await fetchShipmentData();
      if (updated) setSessionInfo(updated);
    } else {
      // Determine if it's a duplicate-type error or a different error
      const isDuplicate = result.error?.toLowerCase().includes('ya fue') || result.error?.toLowerCase().includes('already been used');
      showOverlay({
        status: isDuplicate ? 'duplicate' : 'error',
        labelId,
        message: result.error,
      });
    }

    setIsProcessing(false);
  };

  const handleRemove = async (labelIdToRemove: string) => {
    const result = await removeScannedLabelFromShipment(shipmentId, labelIdToRemove);
    if (result.success) {
      toast({ title: 'Etiqueta Eliminada', description: `Se quitó la etiqueta ${labelIdToRemove} del envío.` });
      await fetchShipmentData();
    } else {
      toast({ variant: 'destructive', title: 'Error al Eliminar', description: result.error });
    }
  };

  const handleFinalize = async () => {
    if (!sessionInfo?.scannedLabels) return;
    setIsProcessing(true);

    const closeResult = await closeShipment(sessionInfo.id!);
    if (!closeResult.success) {
      toast({ variant: 'destructive', title: 'Error', description: `No se pudo cerrar el envío: ${closeResult.error}` });
      setIsProcessing(false);
      return;
    }

    toast({ title: 'Envío Cerrado', description: 'El envío ha sido finalizado.' });

    const labelIds = Object.keys(sessionInfo.scannedLabels);
    const tempLabels: PreprintedLabel[] = [];
    const tempPackedItems: PackedItem[] = [];

    for (const orderId of sessionInfo.orderIds || []) {
      const labelsRes = await getLabelsForOrder(orderId);
      const itemsRes = await getPackedItemsForOrder(orderId);
      if (labelsRes.data) tempLabels.push(...labelsRes.data);
      if (itemsRes.data) tempPackedItems.push(...itemsRes.data);
    }

    const boxesForReport: BoxToDispatch[] = labelIds.map(labelId => {
      const labelInfo = tempLabels.find(l => l.id === labelId);
      const orderInfo = allOrders.find(o => o.id === labelInfo?.orderId);
      const itemsInBox = tempPackedItems.filter(p => p.packingUnitId === labelInfo?.unitId?.toString());
      const totalItems = itemsInBox.reduce((sum, item) => sum + item.quantity, 0);
      return {
        labelId,
        orderId: orderInfo?.ordenDeCompra || labelInfo?.orderId || 'N/A',
        customer: orderInfo?.cliente || 'N/A',
        totalItems,
      };
    });

    setReportData({ sessionInfo: { ...sessionInfo, status: 'closed' }, boxes: boxesForReport });
    setView('report');
    setIsProcessing(false);
  };

  // --- Derived State ---

  const scannedLabelsSet = useMemo(() => new Set(Object.keys(sessionInfo?.scannedLabels || {})), [sessionInfo?.scannedLabels]);

  const scannedLabelsArray = useMemo(() => {
    if (!sessionInfo?.scannedLabels) return [];
    return Object.entries(sessionInfo.scannedLabels)
      .map(([labelId, timestamp]) => ({ labelId, timestamp: new Date((timestamp as any).seconds ? (timestamp as any).seconds * 1000 : timestamp) }))
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }, [sessionInfo?.scannedLabels]);

  const pendingLabels = useMemo(() =>
    allLabels.filter(l => l.status === 'used' && !scannedLabelsSet.has((l.id || '').toUpperCase())),
    [allLabels, scannedLabelsSet]
  );

  const allowedOrdersList = useMemo(() => {
    if (!sessionInfo?.allowedOrderIds || sessionInfo.allowedOrderIds.length === 0) return null;
    return allOrders.filter(o => sessionInfo.allowedOrderIds?.includes(o.id));
  }, [allOrders, sessionInfo?.allowedOrderIds]);

  const totalExpected = allLabels.filter(l => l.status !== 'void').length;
  const totalDispatched = scannedLabelsArray.length;
  const progressPercent = totalExpected > 0 ? (totalDispatched / totalExpected) * 100 : 0;

  // --- Render ---

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
    <div className="space-y-6 relative">

      {/* ──── SCAN OVERLAY ──── */}
      {scanOverlay && (
        <div className={cn(
          "fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 animate-in fade-in duration-150",
          scanOverlay.status === 'success' ? 'bg-green-600/95' :
          scanOverlay.status === 'duplicate' ? 'bg-red-600/95' :
          'bg-amber-500/95'
        )}>
          {scanOverlay.status === 'success' && <CheckCircle2 className="w-32 h-32 text-white drop-shadow-lg" />}
          {scanOverlay.status === 'duplicate' && <XCircle className="w-32 h-32 text-white drop-shadow-lg" />}
          {scanOverlay.status === 'error' && <AlertTriangle className="w-32 h-32 text-white drop-shadow-lg" />}

          <div className="text-center text-white space-y-2 px-8">
            <p className="text-5xl font-black font-mono tracking-widest drop-shadow">{scanOverlay.labelId}</p>
            {scanOverlay.orderId && (
              <p className="text-2xl font-semibold opacity-90">Pedido: {scanOverlay.orderId}</p>
            )}
            {scanOverlay.message && (
              <p className="text-xl opacity-80 max-w-lg">{scanOverlay.message}</p>
            )}
            <p className="text-sm opacity-60 mt-4">
              {scanOverlay.status === 'success' ? '✓ Cargada correctamente' :
               scanOverlay.status === 'duplicate' ? '✗ Etiqueta duplicada' :
               '⚠ Error de validación'}
            </p>
          </div>
        </div>
      )}

      {/* ──── HEADER CARD ──── */}
      <Card>
        <CardHeader className="flex flex-row justify-between items-center flex-wrap gap-4">
          <div>
            <CardTitle>Despacho #{shipmentId.slice(-6)}</CardTitle>
            <CardDescription>
              🚛 {sessionInfo.truckPlate} · {sessionInfo.driverName}
              {sessionInfo.sealNumber ? ` · Precinto: ${sessionInfo.sealNumber}` : ''}
            </CardDescription>
          </div>

          {/* Progress summary */}
          <div className="flex-1 max-w-xs space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Cajas Cargadas</span>
              <span className="font-bold">{totalDispatched} / {totalExpected}</span>
            </div>
            <Progress value={progressPercent} className="h-3" />
          </div>

          <Button onClick={onReturnToDispatchDashboard} variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" /> Volver
          </Button>
        </CardHeader>

        <CardContent className="space-y-4">
          {allowedOrdersList && (
            <div className="p-3 border rounded-md bg-primary/5 border-primary/20 flex flex-wrap gap-2 items-center">
              <span className="text-sm font-semibold mr-1">Pedidos permitidos:</span>
              {allowedOrdersList.map(o => (
                <Badge key={o.id} variant="secondary">{o.cliente} ({o.id.slice(-6)})</Badge>
              ))}
            </div>
          )}

          {/* Scanner input */}
          <form onSubmit={handleScan}>
            <div className="flex items-center gap-3">
              <Input
                ref={scanInputRef}
                type="text"
                value={scannedLabel}
                onChange={e => setScannedLabel(e.target.value)}
                placeholder="Escanear etiqueta de la caja..."
                className="flex-1 text-lg h-12"
                disabled={isProcessing || sessionInfo.status !== 'open'}
                autoFocus
              />
              <Button type="submit" className="h-12 px-6" disabled={isProcessing || !scannedLabel.trim() || sessionInfo.status !== 'open'}>
                {isProcessing ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <ScanLine className="mr-2 h-5 w-5" />}
                Leer
              </Button>
            </div>
            {sessionInfo.status !== 'open' && (
              <p className="text-sm text-destructive mt-2">Este envío está cerrado.</p>
            )}
          </form>
        </CardContent>
      </Card>

      {/* ──── TWO-PANEL LABEL VIEW ──── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Pending */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Package className="h-5 w-5 text-muted-foreground" />
              Por Cargar
              <Badge variant="outline" className="ml-auto">{pendingLabels.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-[50vh] overflow-y-auto">
            {pendingLabels.length === 0 ? (
              <div className="text-center py-12">
                <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  {allLabels.length === 0
                    ? 'No hay etiquetas cargadas para los pedidos de este despacho.'
                    : '¡Todas las etiquetas han sido despachadas!'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {pendingLabels.map(label => {
                  const order = allOrders.find(o => o.id === label.orderId);
                  return (
                    <div
                      key={label.id}
                      className="p-2 rounded-md border border-border bg-muted/40 hover:bg-muted/70 transition-colors"
                    >
                      <p className="text-xs font-mono font-bold truncate">{label.id}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{order?.cliente || label.orderId}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Dispatched */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Truck className="h-5 w-5 text-green-600" />
              Despachadas
              <Badge variant="outline" className="ml-auto bg-green-50 text-green-700 border-green-200">{scannedLabelsArray.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-[50vh] overflow-y-auto">
            {scannedLabelsArray.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-12">Aún no se han escaneado cajas.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Etiqueta</TableHead>
                    <TableHead>Hora</TableHead>
                    <TableHead className="text-right">Quitar</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scannedLabelsArray.map(item => (
                    <TableRow key={item.labelId} className="animate-in fade-in slide-in-from-top-1 duration-200">
                      <TableCell className="font-mono text-xs">{item.labelId}</TableCell>
                      <TableCell className="text-xs tabular-nums">{item.timestamp.toLocaleTimeString()}</TableCell>
                      <TableCell className="text-right">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" disabled={sessionInfo.status !== 'open'}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>¿Quitar esta etiqueta?</AlertDialogTitle>
                              <AlertDialogDescription>
                                La etiqueta <strong>{item.labelId}</strong> volverá a la lista de por cargar (empacada).
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleRemove(item.labelId)}>Confirmar</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ──── FINALIZE ──── */}
      <div className="flex justify-end">
        <Button
          size="lg"
          disabled={scannedLabelsArray.length === 0 || sessionInfo.status !== 'open' || isProcessing}
          onClick={handleFinalize}
        >
          {isProcessing && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
          <Truck className="mr-2 h-5 w-5" />
          Finalizar y Generar Despacho
        </Button>
      </div>
    </div>
  );
};

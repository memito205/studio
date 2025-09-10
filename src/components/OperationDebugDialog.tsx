/** @jsxImportSource react */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2 } from 'lucide-react';
import type { ScannedItem, OperationPause } from '@/types';
import { getScannedItemsByReception, getPausesForOperation } from '@/app/actions';
import { showError } from '@/lib/toast';

interface OperationDebugDialogProps {
  operationId: string;
  children: React.ReactNode;
}

export const OperationDebugDialog: React.FC<OperationDebugDialogProps> = ({ operationId, children }) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([]);
  const [pauses, setPauses] = useState<OperationPause[]>([]);

  const fetchData = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    try {
      const [itemsResult, pausesResult] = await Promise.all([
        getScannedItemsByReception(operationId),
        getPausesForOperation(operationId),
      ]);
      
      if (itemsResult.success) {
        setScannedItems(itemsResult.data || []);
      } else {
        showError("Error al cargar items escaneados", itemsResult.error);
      }
      
      if (pausesResult.success) {
        // Ensure dates are converted for this specific function as the dialog expects Date objects
        const convertedPauses = (pausesResult.data || []).map(p => ({
            ...p,
            start_time: new Date(p.start_time),
            end_time: p.end_time ? new Date(p.end_time) : null
        }));
        setPauses(convertedPauses);
      } else {
        showError("Error al cargar pausas", pausesResult.error);
      }

    } catch (e: any) {
      showError("Error inesperado al cargar datos de depuración.", e.message);
    } finally {
      setLoading(false);
    }
  }, [operationId, open]);

  useEffect(() => {
    if (open) {
      fetchData();
    }
  }, [open, fetchData]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Depuración de Datos de Operación</DialogTitle>
          <DialogDescription>
            Visualización de los datos crudos obtenidos de Firestore para la operación {operationId}.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
            <div className="flex justify-center items-center h-full">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        ) : (
            <Tabs defaultValue="scannedItems" className="w-full flex-grow flex flex-col overflow-hidden">
                <TabsList className="w-full">
                    <TabsTrigger value="scannedItems">Items Escaneados ({scannedItems.length})</TabsTrigger>
                    <TabsTrigger value="pauses">Pausas Registradas ({pauses.length})</TabsTrigger>
                </TabsList>
                <TabsContent value="scannedItems" className="flex-grow mt-2 overflow-hidden">
                    <ScrollArea className="h-full pr-4">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>user_id</TableHead>
                                    <TableHead>barcode</TableHead>
                                    <TableHead>packing_unit_id</TableHead>
                                    <TableHead>scanned_at</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {scannedItems.map(item => (
                                    <TableRow key={item.id}>
                                        <TableCell>{item.user_id}</TableCell>
                                        <TableCell>{item.barcode}</TableCell>
                                        <TableCell>{item.packing_unit_id}</TableCell>
                                        <TableCell>{new Date(item.scanned_at).toLocaleString()}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </ScrollArea>
                </TabsContent>
                <TabsContent value="pauses" className="flex-grow mt-2 overflow-hidden">
                    <ScrollArea className="h-full pr-4">
                       <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>user_id</TableHead>
                                    <TableHead>start_time</TableHead>
                                    <TableHead>end_time</TableHead>
                                    <TableHead>reason</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {pauses.map(pause => (
                                    <TableRow key={pause.id}>
                                        <TableCell>{pause.user_id}</TableCell>
                                        <TableCell>{pause.start_time.toLocaleString()}</TableCell>
                                        <TableCell>{pause.end_time ? pause.end_time.toLocaleString() : 'ACTIVA'}</TableCell>
                                        <TableCell>{pause.pause_reason}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </ScrollArea>
                </TabsContent>
            </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
};

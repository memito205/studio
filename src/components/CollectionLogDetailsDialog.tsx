
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, FileDown } from 'lucide-react';
import { getTransfersByIds } from '@/app/actions';
import { exportToXlsx } from '@/services/export';
import { useToast } from '@/hooks/use-toast';
import type { CollectionLog, TransferEntry } from '@/types';

interface CollectionLogDetailsDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  log: CollectionLog | null;
}

export const CollectionLogDetailsDialog: React.FC<CollectionLogDetailsDialogProps> = ({ isOpen, onOpenChange, log }) => {
  const [transfers, setTransfers] = useState<TransferEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const fetchDetails = useCallback(async () => {
    if (!log) return;
    setIsLoading(true);
    const result = await getTransfersByIds(log.transferIds);
    if (result.success && result.data) {
      setTransfers(result.data);
    } else {
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudo cargar el detalle de las transferencias.' });
    }
    setIsLoading(false);
  }, [log, toast]);

  useEffect(() => {
    if (isOpen) {
      fetchDetails();
    }
  }, [isOpen, fetchDetails]);

  const handleExport = () => {
    if (transfers.length === 0) {
      toast({ variant: 'destructive', title: 'Sin datos', description: 'No hay transferencias para exportar.' });
      return;
    }
    const dataToExport = transfers.map(t => ({
      'Numero TF': t.numeroTF,
      'Origen': t.bodegaOrigen,
      'Destino': t.bodegaDestino,
      'Fecha TF': t.fecha.toLocaleDateString('es-CO'),
    }));
    exportToXlsx(dataToExport, `Detalle_Recoleccion_${log?.placa}_${log?.createdAt.toISOString().split('T')[0]}`);
  };

  if (!log) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Detalle de Recolección - Placa: {log.placa}</DialogTitle>
          <DialogDescription>
            Mostrando {log.summary.totalTransfers} transferencia(s) recolectada(s) el {new Date(log.createdAt).toLocaleString('es-CO')}.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <ScrollArea className="h-96 border rounded-md">
            {isLoading ? (
              <div className="flex justify-center items-center h-full">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Número TF</TableHead>
                    <TableHead>Origen</TableHead>
                    <TableHead>Destino</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transfers.map(t => (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">{t.numeroTF}</TableCell>
                      <TableCell>{t.bodegaOrigen}</TableCell>
                      <TableCell>{t.bodegaDestino}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </ScrollArea>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cerrar</Button>
          <Button onClick={handleExport} disabled={isLoading || transfers.length === 0}>
            <FileDown className="mr-2 h-4 w-4" /> Exportar a Excel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

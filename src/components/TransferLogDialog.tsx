/** @jsxImportSource react */
import React, { useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { TransferEntry } from '@/types';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface TransferLogDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  transfer: TransferEntry | null;
}

interface LogEvent {
  date: Date;
  description: string;
}

export const TransferLogDialog: React.FC<TransferLogDialogProps> = ({ isOpen, onOpenChange, transfer }) => {
  const logEvents = useMemo(() => {
    if (!transfer) return [];

    const events: LogEvent[] = [];

    // Initial creation
    if (transfer.fecha) {
      events.push({ date: new Date(transfer.fecha), description: 'Transferencia creada (En Tránsito).' });
    }

    // Collection in route
    if (transfer.recibidoAt && transfer.status === 'Recolectado en Ruta') {
        events.push({ date: new Date(transfer.recibidoAt), description: 'Recolectado en Ruta.' });
    }
    
    // Supervisor validation
    if (transfer.validatedAt) {
      events.push({ date: new Date(transfer.validatedAt), description: 'Validado por Supervisor.' });
    }
    
    // Received at warehouse (different from collection)
    if (transfer.recibidoAt && transfer.status === 'Recibido en Bodega') {
        events.push({ date: new Date(transfer.recibidoAt), description: 'Recibido en Bodega Central.' });
    }

    // Sent to destination
    if (transfer.enviadoAt) {
      events.push({ date: new Date(transfer.enviadoAt), description: 'Enviado a Destino (Manifiesto).' });
    }
    
    // Delivered in route
    if (transfer.deliveredAt) {
        events.push({ date: new Date(transfer.deliveredAt), description: 'Entregado en Ruta.' });
    }

    return events.sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [transfer]);

  if (!transfer) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Historial de Transferencia</DialogTitle>
          <DialogDescription>
            Trazabilidad completa para el TF: <span className="font-mono font-bold">{transfer.numeroTF}</span>
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <div className="border rounded-md max-h-96 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha y Hora</TableHead>
                  <TableHead>Evento</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logEvents.length > 0 ? (
                  logEvents.map((event, index) => (
                    <TableRow key={index}>
                      <TableCell>{format(event.date, "PPP p", { locale: es })}</TableCell>
                      <TableCell>{event.description}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={2} className="text-center text-muted-foreground h-24">
                      No hay eventos de historial para esta transferencia.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

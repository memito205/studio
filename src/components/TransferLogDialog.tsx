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
import type { CollectionLog, TransferEntry } from '@/types';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface TransferLogDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  transfer: TransferEntry | null;
  usersMap?: Map<string, string>;
  collectionLogs?: CollectionLog[];
}

interface LogEvent {
  date: Date;
  description: string;
  userName?: string;
}

function resolveUserLabel(
  storedName?: string,
  storedUid?: string,
  usersMap?: Map<string, string>
): string | undefined {
  const name = storedName?.trim();
  if (name) return name;
  if (storedUid && usersMap?.has(storedUid)) return usersMap.get(storedUid);
  if (storedUid) return storedUid;
  return undefined;
}

function getTransferLineIds(transfer: TransferEntry): string[] {
  const grouped = transfer as TransferEntry & { allIds?: string[] };
  return grouped.allIds?.length ? grouped.allIds : [transfer.id];
}

export const TransferLogDialog: React.FC<TransferLogDialogProps> = ({
  isOpen,
  onOpenChange,
  transfer,
  usersMap,
  collectionLogs,
}) => {
  const logEvents = useMemo(() => {
    if (!transfer) return [];

    const events: LogEvent[] = [];
    const lineIds = getTransferLineIds(transfer);

    const collectionLog = collectionLogs?.find((log) =>
      log.transferIds.some((id) => lineIds.includes(id))
    );
    const collectionUserName =
      resolveUserLabel(transfer.recolectadoByName, transfer.recolectadoBy, usersMap) ||
      (collectionLog
        ? resolveUserLabel(undefined, collectionLog.recolectadoPor, usersMap)
        : undefined);

    if (transfer.fecha) {
      events.push({
        date: new Date(transfer.fecha),
        description: 'Transferencia creada (En Tránsito).',
      });
    }

    const hasCollectionEvidence =
      Boolean(transfer.recolectadoBy || transfer.recolectadoByName || collectionLog);
    if (hasCollectionEvidence) {
      events.push({
        date: transfer.recibidoAt ? new Date(transfer.recibidoAt) : new Date(transfer.fecha),
        description: 'Recolectado en Ruta.',
        userName: collectionUserName,
      });
    }

    if (transfer.validatedAt) {
      events.push({
        date: new Date(transfer.validatedAt),
        description: 'Validado por Supervisor.',
        userName: resolveUserLabel(transfer.validatedByName, transfer.validatedBy, usersMap),
      });
    }

    if (transfer.recibidoBodegaBy || transfer.recibidoBodegaByName) {
      const bodegaDate = transfer.recibidoAt || transfer.validatedAt;
      if (bodegaDate) {
        events.push({
          date: new Date(bodegaDate),
          description: 'Recibido en Bodega Central.',
          userName: resolveUserLabel(transfer.recibidoBodegaByName, transfer.recibidoBodegaBy, usersMap),
        });
      }
    } else if (transfer.recibidoAt && transfer.status === 'Recibido en Bodega') {
      events.push({
        date: new Date(transfer.recibidoAt),
        description: 'Recibido en Bodega Central.',
        userName: resolveUserLabel(transfer.recibidoBodegaByName, transfer.recibidoBodegaBy, usersMap),
      });
    }

    if (transfer.enviadoAt) {
      events.push({
        date: new Date(transfer.enviadoAt),
        description: 'Enviado a Destino (Manifiesto).',
        userName: resolveUserLabel(transfer.enviadoByName, transfer.enviadoBy, usersMap),
      });
    }

    if (transfer.deliveredAt) {
      events.push({
        date: new Date(transfer.deliveredAt),
        description: 'Entregado en Ruta.',
        userName: resolveUserLabel(transfer.deliveredByName, transfer.deliveredBy, usersMap),
      });
    }

    if (transfer.manualStatusChangeJustification) {
      const manualDate =
        transfer.deliveredAt ||
        transfer.enviadoAt ||
        transfer.validatedAt ||
        transfer.recibidoAt ||
        transfer.fecha;
      if (manualDate) {
        events.push({
          date: new Date(manualDate),
          description: `Cambio manual de estado: ${transfer.manualStatusChangeJustification}`,
          userName: resolveUserLabel(
            transfer.manualStatusChangedByName,
            transfer.manualStatusChangedBy,
            usersMap
          ),
        });
      }
    }

    return events.sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [transfer, usersMap, collectionLogs]);

  if (!transfer) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
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
                  <TableHead>Usuario</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logEvents.length > 0 ? (
                  logEvents.map((event, index) => (
                    <TableRow key={index}>
                      <TableCell>{format(event.date, "PPP p", { locale: es })}</TableCell>
                      <TableCell>{event.description}</TableCell>
                      <TableCell className="font-medium">
                        {event.userName || '—'}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground h-24">
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

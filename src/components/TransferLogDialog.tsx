/** @jsxImportSource react */
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2 } from 'lucide-react';
import type { CollectionLog, TransferEntry, TransferStatus } from '@/types';
import { getTransferTraceability } from '@/app/actions';
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

const STATUS_EVENT_LABELS: Record<TransferStatus, string> = {
  'En Tránsito': 'Transferencia creada (En Tránsito).',
  'Recolectado en Ruta': 'Recolectado en Ruta.',
  'Entregado en Ruta': 'Entregado en Ruta.',
  'Recibido en Bodega': 'Recibido en Bodega Central.',
  'Validado Supervisor': 'Validado por Supervisor.',
  'Enviado a Destino': 'Enviado a Destino (Manifiesto).',
};

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

function buildLogEvents(
  transfer: TransferEntry,
  usersMap?: Map<string, string>,
  collectionLogs?: CollectionLog[]
): LogEvent[] {
  const events: LogEvent[] = [];
  const lineIds = getTransferLineIds(transfer);

  if (transfer.statusHistory && transfer.statusHistory.length > 0) {
    for (const entry of transfer.statusHistory) {
      const at = entry.at instanceof Date ? entry.at : new Date(entry.at as unknown as string);
      events.push({
        date: at,
        description: STATUS_EVENT_LABELS[entry.status] || entry.status,
        userName:
          entry.userName?.trim() ||
          resolveUserLabel(undefined, entry.userId, usersMap),
      });
    }
    return events.sort((a, b) => a.date.getTime() - b.date.getTime());
  }

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
}

export const TransferLogDialog: React.FC<TransferLogDialogProps> = ({
  isOpen,
  onOpenChange,
  transfer,
  usersMap,
  collectionLogs,
}) => {
  const [resolvedTransfer, setResolvedTransfer] = useState<TransferEntry | null>(transfer);
  const [isLoadingTrace, setIsLoadingTrace] = useState(false);

  useEffect(() => {
    if (!isOpen || !transfer) {
      setResolvedTransfer(transfer);
      return;
    }

    const lineIds = getTransferLineIds(transfer);
    setIsLoadingTrace(true);
    setResolvedTransfer(transfer);

    getTransferTraceability(lineIds)
      .then((result) => {
        if (result.success && result.data) {
          setResolvedTransfer(result.data);
        }
      })
      .finally(() => setIsLoadingTrace(false));
  }, [isOpen, transfer]);

  const logEvents = useMemo(() => {
    if (!resolvedTransfer) return [];
    return buildLogEvents(resolvedTransfer, usersMap, collectionLogs);
  }, [resolvedTransfer, usersMap, collectionLogs]);

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
            {isLoadingTrace ? (
              <div className="flex items-center justify-center gap-2 h-24 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Cargando historial...
              </div>
            ) : (
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
                          {event.userName || (
                            <span className="text-muted-foreground text-sm">Sin registro</span>
                          )}
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
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

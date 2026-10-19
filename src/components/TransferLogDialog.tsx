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
import { getTransferDeliveryProofs, getTransferTraceability, type TransferDeliveryProofLeg } from '@/app/actions';
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
  'Entregado en Tienda': 'Entregado en Tienda (prueba de entrega).',
  'Novedad de Entrega': 'Novedad de Entrega (no entregada).',
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

function enviadoDestinoLabel(manifestId?: number): string {
  return manifestId && manifestId > 0
    ? `Enviado a Destino (Manifiesto #${manifestId}).`
    : 'Enviado a Destino (Manifiesto).';
}

function buildLogEvents(
  transfer: TransferEntry,
  usersMap?: Map<string, string>,
  collectionLogs?: CollectionLog[]
): LogEvent[] {
  const events: LogEvent[] = [];
  const lineIds = getTransferLineIds(transfer);
  const manifestId = Number(transfer.manifestId || 0) || undefined;

  if (transfer.statusHistory && transfer.statusHistory.length > 0) {
    for (const entry of transfer.statusHistory) {
      const at = entry.at instanceof Date ? entry.at : new Date(entry.at as unknown as string);
      const description =
        entry.status === 'Enviado a Destino'
          ? enviadoDestinoLabel(manifestId)
          : STATUS_EVENT_LABELS[entry.status] || entry.status;
      events.push({
        date: at,
        description,
        userName:
          entry.userName?.trim() ||
          resolveUserLabel(undefined, entry.userId, usersMap),
      });
    }
  } else {
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
        description: enviadoDestinoLabel(manifestId),
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

    if (transfer.novedadEntregaAt) {
      events.push({
        date: new Date(transfer.novedadEntregaAt),
        description: 'Novedad de Entrega (no entregada).',
        userName: resolveUserLabel(transfer.novedadEntregaByName, transfer.novedadEntregaBy, usersMap),
      });
    }

    if (transfer.entregadoTiendaAt) {
      events.push({
        date: new Date(transfer.entregadoTiendaAt),
        description: 'Entregado en Tienda (prueba de entrega).',
        userName: resolveUserLabel(transfer.entregadoTiendaByName, transfer.entregadoTiendaBy, usersMap),
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
  }

  if (transfer.handoffAt) {
    const already = events.some((e) => /Handoff camión/i.test(e.description));
    if (!already) {
      events.push({
        date: new Date(transfer.handoffAt),
        description: `Handoff camión → mensajero${
          transfer.handoffReceivedByName ? ` (recibió: ${transfer.handoffReceivedByName})` : ''
        }.`,
        userName: resolveUserLabel(transfer.handoffByName, transfer.handoffBy, usersMap),
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
  const [proofs, setProofs] = useState<TransferDeliveryProofLeg[]>([]);
  const [isLoadingTrace, setIsLoadingTrace] = useState(false);

  useEffect(() => {
    if (!isOpen || !transfer) {
      setResolvedTransfer(transfer);
      setProofs([]);
      return;
    }

    const lineIds = getTransferLineIds(transfer);
    setIsLoadingTrace(true);
    setResolvedTransfer(transfer);

    Promise.all([getTransferTraceability(lineIds), getTransferDeliveryProofs(lineIds)])
      .then(([trace, proofRes]) => {
        if (trace.success && trace.data) {
          setResolvedTransfer(trace.data);
        }
        if (proofRes.success && proofRes.data) {
          setProofs(proofRes.data);
        } else {
          setProofs([]);
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
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Historial de Transferencia</DialogTitle>
          <DialogDescription>
            Trazabilidad completa para el TF: <span className="font-mono font-bold">{transfer.numeroTF}</span>
            {resolvedTransfer?.manifestId ? (
              <>
                {' · '}
                Manifiesto <span className="font-mono font-bold">#{resolvedTransfer.manifestId}</span>
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <div className="py-2 space-y-4">
          {isLoadingTrace ? (
            <div className="flex items-center justify-center gap-2 h-24 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando historial y pruebas...
            </div>
          ) : (
            <>
              {proofs.length > 0 && (
                <div className="space-y-3">
                  <p className="text-sm font-semibold">Pruebas de entrega (ciclo completo)</p>
                  {proofs.map((leg) => (
                    <div
                      key={leg.kind}
                      className="rounded-md border p-3 space-y-2 bg-muted/30"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm font-medium">{leg.label}</p>
                        {leg.at && (
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(leg.at), "dd/MM/yyyy HH:mm", { locale: es })}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {leg.detail ? `${leg.detail} · ` : ''}
                        {leg.byName ? `Registró: ${leg.byName}` : ''}
                        {leg.receivedByName ? ` · Recibió: ${leg.receivedByName}` : ''}
                        {leg.photos.length === 0 ? ' · Sin fotos' : ` · ${leg.photos.length} foto(s)`}
                      </p>
                      {leg.photos.length > 0 && (
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                          {leg.photos.map((p, i) => (
                            <a
                              key={`${leg.kind}-${i}-${p.url}`}
                              href={p.url}
                              target="_blank"
                              rel="noreferrer"
                              className="aspect-square overflow-hidden rounded border bg-background"
                              title={p.category || 'foto'}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={p.url} alt={p.category || leg.kind} className="h-full w-full object-cover" />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="border rounded-md max-h-72 overflow-y-auto">
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
                        <TableRow key={`${event.date.getTime()}-${index}`}>
                          <TableCell className="whitespace-nowrap text-xs">
                            {format(event.date, "dd/MM/yyyy HH:mm", { locale: es })}
                          </TableCell>
                          <TableCell className="text-sm">{event.description}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{event.userName || '—'}</TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                          Sin eventos de trazabilidad.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

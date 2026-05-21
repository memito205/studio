"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Loader2, RefreshCcw, Search } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth-context';
import {
  cancelSamplePhotoReception,
  closeSamplePhotoTransfer,
  loadSamplePhotoTransferSummary,
  loadSamplePhotoReceptions,
  scanSamplePhotoReception,
  updateSamplePhotoReceptionStatus,
  type LoadSamplePhotoReceptionsOptions,
} from '@/app/actions';
import type { SamplePhotoReception, SamplePhotoReceptionStatus, SamplePhotoTransferSummary } from '@/types';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

const STATUS_LABEL: Record<SamplePhotoReceptionStatus, string> = {
  pending: 'Pendiente',
  in_progress: 'En proceso',
  received: 'Recibida',
  cancelled: 'Cancelada',
};

export const PhotoReceptionQueue: React.FC = () => {
  const [receptions, setReceptions] = useState<SamplePhotoReception[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<LoadSamplePhotoReceptionsOptions['status']>('pending');
  const [scanValue, setScanValue] = useState('');
  const [activeTransferNumber, setActiveTransferNumber] = useState('');
  const [isTransferLockedMode, setIsTransferLockedMode] = useState(false);
  const [transferSummary, setTransferSummary] = useState<SamplePhotoTransferSummary | null>(null);
  const [isLoadingTransferSummary, setIsLoadingTransferSummary] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isClosingTransfer, setIsClosingTransfer] = useState(false);
  const { toast } = useToast();
  const { user, userName, role } = useAuth();
  const normalizedActiveTf = activeTransferNumber.trim().toUpperCase();

  const filteredCountLabel = useMemo(() => `${receptions.length} registro(s)`, [receptions.length]);

  const fetchQueue = useCallback(async () => {
    setIsLoading(true);
    const result = await loadSamplePhotoReceptions({
      status: statusFilter,
      search,
      maxItems: 1000,
    });
    if (result.success && result.data) {
      setReceptions(result.data);
    } else {
      toast({
        variant: 'destructive',
        title: 'Error al cargar recepciones',
        description: result.error || 'No se pudo cargar la cola de recepcion.',
      });
    }
    setIsLoading(false);
  }, [search, statusFilter, toast]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchQueue();
    }, 300);
    return () => clearTimeout(timer);
  }, [fetchQueue]);

  const fetchTransferSummary = useCallback(async () => {
    if (!isTransferLockedMode || !normalizedActiveTf) {
      setTransferSummary(null);
      return;
    }
    setIsLoadingTransferSummary(true);
    const result = await loadSamplePhotoTransferSummary(normalizedActiveTf);
    if (result.success && result.data) {
      setTransferSummary(result.data);
    } else {
      setTransferSummary(null);
      toast({
        variant: 'destructive',
        title: 'No se pudo leer estado de la TF',
        description: result.error || 'Error cargando resumen de la TF activa.',
      });
    }
    setIsLoadingTransferSummary(false);
  }, [isTransferLockedMode, normalizedActiveTf, toast]);

  useEffect(() => {
    void fetchTransferSummary();
  }, [fetchTransferSummary]);

  const handleCloseTransfer = async () => {
    if (!normalizedActiveTf) return;
    setIsClosingTransfer(true);
    const result = await closeSamplePhotoTransfer({
      transferNumber: normalizedActiveTf,
      closedById: user?.uid,
      closedByName: userName ?? user?.displayName ?? user?.email ?? undefined,
    });
    if (!result.success) {
      toast({
        variant: 'destructive',
        title: 'No se pudo cerrar la TF',
        description: result.error || 'Error cerrando la TF activa.',
      });
      setIsClosingTransfer(false);
      return;
    }
    toast({
      title: result.unchanged ? 'TF ya cerrada' : 'TF cerrada',
      description: `TF ${normalizedActiveTf} marcada como cerrada.`,
    });
    await Promise.all([fetchQueue(), fetchTransferSummary()]);
    setIsClosingTransfer(false);
  };

  const handleScanReception = async () => {
    const normalized = scanValue.trim();
    if (!normalized) return;
    setIsScanning(true);
    const result = await scanSamplePhotoReception({
      scanValue: normalized,
      updatedById: user?.uid,
      updatedByName: userName ?? user?.displayName ?? user?.email ?? undefined,
      activeTransferNumber: isTransferLockedMode ? normalizedActiveTf : undefined,
    });
    if (!result.success) {
      toast({
        variant: 'destructive',
        title: 'Escaneo sin resultado',
        description: result.error || 'No fue posible registrar el escaneo.',
      });
      setIsScanning(false);
      return;
    }
    toast({
      title: result.unchanged ? 'Sin cambios' : 'Escaneo aplicado',
      description: result.data
        ? `${result.data.reference} / ${result.data.transferNumber} marcada como recibida (${result.source || 'manual'}).`
        : 'Recepcion actualizada por escaneo.',
    });
    setScanValue('');
    await Promise.all([fetchQueue(), fetchTransferSummary()]);
    setIsScanning(false);
  };

  const handleUpdateStatus = async (id: string, nextStatus: SamplePhotoReceptionStatus) => {
    setSavingId(id);
    const result = await updateSamplePhotoReceptionStatus({
      id,
      nextStatus,
      updatedById: user?.uid,
      updatedByName: userName ?? user?.displayName ?? user?.email ?? undefined,
      activeTransferNumber: isTransferLockedMode ? normalizedActiveTf : undefined,
    });
    if (!result.success) {
      toast({
        variant: 'destructive',
        title: 'No se pudo actualizar',
        description: result.error || 'Error al actualizar el estado.',
      });
      setSavingId(null);
      return;
    }

    toast({
      title: result.unchanged ? 'Sin cambios' : 'Recepcion actualizada',
      description: result.unchanged
        ? 'El registro ya tenia ese estado.'
        : `Estado actualizado a ${STATUS_LABEL[nextStatus]}.`,
    });
    await Promise.all([fetchQueue(), fetchTransferSummary()]);
    setSavingId(null);
  };

  const handleCancelReception = async (id: string) => {
    if (role !== 'admin') return;
    const note = window.prompt('Motivo de cancelacion (obligatorio):', '');
    if (!note || !note.trim()) {
      toast({
        variant: 'destructive',
        title: 'Cancelacion requerida',
        description: 'Debe ingresar motivo para cancelar la recepcion.',
      });
      return;
    }
    setSavingId(id);
    const result = await cancelSamplePhotoReception({
      id,
      note: note.trim(),
      updatedById: user?.uid,
      updatedByName: userName ?? user?.displayName ?? user?.email ?? undefined,
      updatedByRole: role,
    });
    if (!result.success) {
      toast({
        variant: 'destructive',
        title: 'No se pudo cancelar',
        description: result.error || 'Error al cancelar recepcion.',
      });
      setSavingId(null);
      return;
    }
    toast({
      title: 'Recepcion cancelada',
      description: 'La recepcion fue cancelada por administracion.',
    });
    await Promise.all([fetchQueue(), fetchTransferSummary()]);
    setSavingId(null);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recepcion Foto - Cola operativa</CardTitle>
        <CardDescription>
          Gestiona recepciones de muestras por referencia/TF sin salir de Control de muestras.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex items-center gap-2 w-full lg:max-w-md">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por referencia o TF"
            />
          </div>
          <div className="flex items-center gap-2 w-full lg:max-w-md">
            <Input
              value={scanValue}
              onChange={(e) => setScanValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleScanReception();
                }
              }}
              placeholder="Pistoleo rapido (barcode, TF__REF, referencia o TF)"
            />
            <Button
              size="sm"
              onClick={handleScanReception}
              disabled={
                isScanning ||
                !scanValue.trim() ||
                (isTransferLockedMode && (!normalizedActiveTf || transferSummary?.isClosed))
              }
            >
              {isScanning ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Escanear'}
            </Button>
          </div>
          <div className="flex items-center gap-2 w-full lg:max-w-md">
            <Input
              value={activeTransferNumber}
              onChange={(e) => setActiveTransferNumber(e.target.value)}
              placeholder="TF activa (ej: TFT-0060051)"
            />
            <div className="flex items-center space-x-2 whitespace-nowrap">
              <Switch id="tf-lock-mode" checked={isTransferLockedMode} onCheckedChange={setIsTransferLockedMode} />
              <Label htmlFor="tf-lock-mode">Bloquear por TF</Label>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={statusFilter === 'pending' ? 'default' : 'outline'}
              onClick={() => setStatusFilter('pending')}
            >
              Pendientes
            </Button>
            <Button
              size="sm"
              variant={statusFilter === 'in_progress' ? 'default' : 'outline'}
              onClick={() => setStatusFilter('in_progress')}
            >
              En proceso
            </Button>
            <Button
              size="sm"
              variant={statusFilter === 'received' ? 'default' : 'outline'}
              onClick={() => setStatusFilter('received')}
            >
              Recibidas
            </Button>
            <Button
              size="sm"
              variant={statusFilter === 'all' ? 'default' : 'outline'}
              onClick={() => setStatusFilter('all')}
            >
              Todas
            </Button>
            <Button size="sm" variant="ghost" onClick={fetchQueue} disabled={isLoading}>
              <RefreshCcw className="mr-2 h-4 w-4" />
              Refrescar
            </Button>
          </div>
        </div>

        {isTransferLockedMode && (
          <div className="text-xs text-amber-600">
            Modo TF bloqueada activo: {normalizedActiveTf || 'defina una TF para habilitar recepcion'}
          </div>
        )}

        {isTransferLockedMode && normalizedActiveTf && (
          <div className="border rounded-md p-3 text-xs">
            {isLoadingTransferSummary || !transferSummary ? (
              <div className="text-muted-foreground">Cargando resumen de TF...</div>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-muted-foreground">
                  <span className="mr-3">Total: {transferSummary.total}</span>
                  <span className="mr-3">Pend: {transferSummary.pending}</span>
                  <span className="mr-3">Proc: {transferSummary.inProgress}</span>
                  <span className="mr-3">Rec: {transferSummary.received}</span>
                  <span>Cancel: {transferSummary.cancelled}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={transferSummary.isClosed ? 'secondary' : 'outline'}>
                    {transferSummary.isClosed ? 'TF cerrada' : 'TF abierta'}
                  </Badge>
                  <Button
                    size="sm"
                    onClick={handleCloseTransfer}
                    disabled={
                      isClosingTransfer ||
                      transferSummary.isClosed ||
                      !transferSummary.canClose ||
                      role !== 'admin'
                    }
                  >
                    {isClosingTransfer ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Cerrar TF'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="text-xs text-muted-foreground">{filteredCountLabel}</div>

        <div className="border rounded-md max-h-[65vh] overflow-y-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-secondary">
              <TableRow>
                <TableHead>Referencia</TableHead>
                <TableHead>TF</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Actualizado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
                  </TableCell>
                </TableRow>
              ) : receptions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    No hay registros para este filtro.
                  </TableCell>
                </TableRow>
              ) : (
                receptions.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono">{item.reference}</TableCell>
                    <TableCell className="font-mono">{item.transferNumber}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{STATUS_LABEL[item.status]}</Badge>
                    </TableCell>
                    <TableCell>
                      {item.updatedAt ? format(item.updatedAt, 'PPP p', { locale: es }) : 'Sin fecha'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            savingId === item.id ||
                            item.status !== 'pending' ||
                            (isTransferLockedMode && transferSummary?.isClosed) ||
                            (isTransferLockedMode &&
                              (!normalizedActiveTf || item.transferNumber.trim().toUpperCase() !== normalizedActiveTf))
                          }
                          onClick={() => handleUpdateStatus(item.id, 'in_progress')}
                        >
                          {savingId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Iniciar'}
                        </Button>
                        <Button
                          size="sm"
                          disabled={
                            savingId === item.id ||
                            item.status !== 'in_progress' ||
                            (isTransferLockedMode && transferSummary?.isClosed) ||
                            (isTransferLockedMode &&
                              (!normalizedActiveTf || item.transferNumber.trim().toUpperCase() !== normalizedActiveTf))
                          }
                          onClick={() => handleUpdateStatus(item.id, 'received')}
                        >
                          {savingId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Marcar recibida'}
                        </Button>
                        {role === 'admin' && item.status !== 'cancelled' && (
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={savingId === item.id}
                            onClick={() => handleCancelReception(item.id)}
                          >
                            {savingId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Cancelar'}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};

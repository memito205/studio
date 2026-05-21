"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCcw, Search } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth-context';
import {
  loadSamplePhotoReceptions,
  updateSamplePhotoReceptionStatus,
  type LoadSamplePhotoReceptionsOptions,
} from '@/app/actions';
import type { SamplePhotoReception, SamplePhotoReceptionStatus } from '@/types';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

const STATUS_LABEL: Record<SamplePhotoReceptionStatus, string> = {
  pending: 'Pendiente',
  in_progress: 'En proceso',
  received: 'Recibida',
};

export const PhotoReceptionQueue: React.FC = () => {
  const [receptions, setReceptions] = useState<SamplePhotoReception[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<LoadSamplePhotoReceptionsOptions['status']>('pending');
  const [isLoading, setIsLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const { toast } = useToast();
  const { user, userName } = useAuth();

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
    fetchQueue();
  }, [fetchQueue]);

  const handleUpdateStatus = async (id: string, nextStatus: SamplePhotoReceptionStatus) => {
    setSavingId(id);
    const result = await updateSamplePhotoReceptionStatus({
      id,
      nextStatus,
      updatedById: user?.uid,
      updatedByName: userName ?? user?.displayName ?? user?.email ?? undefined,
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
    await fetchQueue();
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
                          disabled={savingId === item.id || item.status !== 'pending'}
                          onClick={() => handleUpdateStatus(item.id, 'in_progress')}
                        >
                          {savingId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Iniciar'}
                        </Button>
                        <Button
                          size="sm"
                          disabled={savingId === item.id || item.status !== 'in_progress'}
                          onClick={() => handleUpdateStatus(item.id, 'received')}
                        >
                          {savingId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Marcar recibida'}
                        </Button>
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

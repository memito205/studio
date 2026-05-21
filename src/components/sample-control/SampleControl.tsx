

"use client";

import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft,
  Database,
  ShieldCheck,
  History,
  Eye,
  Loader2,
  FlaskConical,
  Boxes,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth-context';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { SavedSampleVerification } from '@/types';

const tabLoading = () => (
  <div className="flex justify-center py-16">
    <Loader2 className="h-10 w-10 animate-spin text-primary" />
  </div>
);

const SampleVerification = dynamic(
  () => import('./SampleVerification').then((mod) => ({ default: mod.SampleVerification })),
  { loading: tabLoading }
);

const AdminDataManagement = dynamic(
  () => import('./AdminDataManagement').then((mod) => ({ default: mod.AdminDataManagement })),
  { loading: tabLoading }
);

const SampleFollowUpReport = dynamic(
  () => import('./SampleFollowUpReport').then((mod) => ({ default: mod.SampleFollowUpReport })),
  { loading: tabLoading }
);

const PhotoReceptionQueue = dynamic(
  () => import('./photo-reception').then((mod) => ({ default: mod.PhotoReceptionQueue })),
  { loading: tabLoading }
);

const ReceptionSamplesAuditReport = dynamic(
  () =>
    import('@/components/ReceptionSamplesAuditReport').then((mod) => ({
      default: mod.ReceptionSamplesAuditReport,
    })),
  { loading: tabLoading }
);
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SampleControlProps {
  onReturnToSuite: () => void;
}

const SavedVerificationDetailsDialog: React.FC<{
    verification: SavedSampleVerification | null;
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
}> = ({ verification, isOpen, onOpenChange }) => {
    if (!verification) return null;

    const getStatusBadge = (status: 'En Base de Datos' | 'Muestra Nueva Requerida' | 'Advertencia: Entregada pero sin Foto') => {
        switch (status) {
            case 'En Base de Datos':
                return <Badge variant="success"><CheckCircle className="mr-1 h-3 w-3" />En Base de Datos</Badge>;
            case 'Advertencia: Entregada pero sin Foto':
                return <Badge variant="warning"><AlertCircle className="mr-1 h-3 w-3" />Entregada sin Foto</Badge>;
            case 'Muestra Nueva Requerida':
            default:
                return <Badge variant="destructive"><AlertCircle className="mr-1 h-3 w-3" />Muestra Nueva Requerida</Badge>;
        }
    };


    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl">
                <DialogHeader>
                    <DialogTitle>{verification.name}</DialogTitle>
                    <DialogDescription>
                        Resultados de la verificación guardada el {format(verification.createdAt, "PPP p", { locale: es })}.
                    </DialogDescription>
                </DialogHeader>
                <ScrollArea className="h-[60vh] mt-4">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Referencia</TableHead>
                                <TableHead>Estado</TableHead>
                                <TableHead>Historial de Entrega</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {verification.results.map(res => (
                                <TableRow key={res.reference}>
                                    <TableCell className="font-mono">{res.reference}</TableCell>
                                    <TableCell>{getStatusBadge(res.status)}</TableCell>
                                    <TableCell>
                                         {res.deliveryHistory && res.deliveryHistory.length > 0 ? (
                                            <ul className="list-disc list-inside space-y-1">
                                                {res.deliveryHistory.map(d => (
                                                    <li key={d.id} className="text-xs text-muted-foreground">
                                                        TF: <span className="font-semibold text-foreground">{d.transferNumber}</span> el {d.deliveryDate ? format(new Date(d.deliveryDate), "dd/MM/yyyy") : 'Fecha Inválida'}
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <span className="text-xs text-muted-foreground">N/A</span>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    )
}

export const SampleControl: React.FC<SampleControlProps> = ({ onReturnToSuite }) => {
  const { role } = useAuth();
  const { toast } = useToast();
  const [savedVerifications, setSavedVerifications] = useState<SavedSampleVerification[]>([]);
  const [isLoadingSaved, setIsLoadingSaved] = useState(false);
  const [selectedSavedVerification, setSelectedSavedVerification] = useState<SavedSampleVerification | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const isAdmin = role === 'admin';
  const isSupervisor = role === 'supervisor';
  const isOffice = role === 'office';
  const isFullSampleAdmin = isAdmin || isSupervisor;

  const [activeTab, setActiveTab] = useState('verification');

  const fetchSavedVerifications = React.useCallback(async () => {
    if (!isFullSampleAdmin) return;
    setIsLoadingSaved(true);
    const { loadSampleVerifications } = await import('@/app/actions');
    const result = await loadSampleVerifications({ maxSessions: 3500 });
    if (result.success && result.data) {
        setSavedVerifications(result.data);
    } else {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
    }
    setIsLoadingSaved(false);
  }, [isFullSampleAdmin, toast]);

  useEffect(() => {
    fetchSavedVerifications();
  }, [fetchSavedVerifications]);

  const handleViewDetails = (verification: SavedSampleVerification) => {
    setSelectedSavedVerification(verification);
    setIsDetailsOpen(true);
  };

  const headerCard = (
    <Card>
      <CardHeader className="flex flex-row justify-between items-center">
        <div>
          <CardTitle>Módulo de Control de Muestras</CardTitle>
          <CardDescription>
            {isOffice
              ? 'Verificación de referencias de muestras.'
              : 'Verifique muestras y administre datos.'}
          </CardDescription>
        </div>
        <Button onClick={onReturnToSuite} variant="outline">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Volver a la Suite
        </Button>
      </CardHeader>
    </Card>
  );

  if (isOffice) {
    return (
      <>
        <SavedVerificationDetailsDialog
          isOpen={isDetailsOpen}
          onOpenChange={setIsDetailsOpen}
          verification={selectedSavedVerification}
        />
        <div className="space-y-8 max-w-7xl mx-auto">
          {headerCard}
          <SampleVerification onVerificationSaved={() => {}} />
        </div>
      </>
    );
  }

  if (isFullSampleAdmin) {
    return (
      <>
        <SavedVerificationDetailsDialog
          isOpen={isDetailsOpen}
          onOpenChange={setIsDetailsOpen}
          verification={selectedSavedVerification}
        />
        <div className="space-y-8 max-w-7xl mx-auto">
          {headerCard}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-1 h-auto py-2">
              <TabsTrigger value="verification">
                <ShieldCheck className="mr-2 h-4 w-4" />
                Verificación
              </TabsTrigger>
              <TabsTrigger value="followUp">
                <FlaskConical className="mr-2 h-4 w-4" />
                Seguimiento nuevas
              </TabsTrigger>
              <TabsTrigger value="receptionAudit">
                <Boxes className="mr-2 h-4 w-4" />
                vs Recepción
              </TabsTrigger>
              <TabsTrigger value="admin">
                <Database className="mr-2 h-4 w-4" />
                Administración
              </TabsTrigger>
              <TabsTrigger value="photoReceptionOps">
                <Boxes className="mr-2 h-4 w-4" />
                Recepción foto
              </TabsTrigger>
              <TabsTrigger value="history">
                <History className="mr-2 h-4 w-4" />
                Historial
              </TabsTrigger>
            </TabsList>
            <TabsContent value="verification" className="mt-6">
              {activeTab === 'verification' && (
                <SampleVerification onVerificationSaved={fetchSavedVerifications} />
              )}
            </TabsContent>
            <TabsContent value="followUp" className="mt-6">
              {activeTab === 'followUp' && <SampleFollowUpReport />}
            </TabsContent>
            <TabsContent value="receptionAudit" className="mt-6">
              {activeTab === 'receptionAudit' && <ReceptionSamplesAuditReport />}
            </TabsContent>
            <TabsContent value="admin" className="mt-6">
              {activeTab === 'admin' && <AdminDataManagement />}
            </TabsContent>
            <TabsContent value="photoReceptionOps" className="mt-6">
              {activeTab === 'photoReceptionOps' && <PhotoReceptionQueue />}
            </TabsContent>
            <TabsContent value="history" className="mt-6">
              {activeTab === 'history' && (
              <Card>
                <CardHeader>
                  <CardTitle>Verificaciones Guardadas</CardTitle>
                  <CardDescription>
                    Historial de todas las verificaciones guardadas.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {isLoadingSaved ? (
                    <div className="flex justify-center items-center h-48">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                  ) : (
                    <div className="border rounded-md max-h-[60vh] overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Nombre de la Verificación</TableHead>
                            <TableHead>Fecha de Creación</TableHead>
                            <TableHead className="text-center"># de Referencias</TableHead>
                            <TableHead className="text-right">Acciones</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {savedVerifications.length > 0 ? (
                            savedVerifications.map((v) => (
                              <TableRow key={v.id}>
                                <TableCell className="font-medium">{v.name}</TableCell>
                                <TableCell>{format(v.createdAt, 'PPP p', { locale: es })}</TableCell>
                                <TableCell className="text-center">{v.results.length}</TableCell>
                                <TableCell className="text-right">
                                  <Button variant="outline" size="sm" onClick={() => handleViewDetails(v)}>
                                    <Eye className="mr-2 h-4 w-4" /> Ver Detalles
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))
                          ) : (
                            <TableRow>
                              <TableCell colSpan={4} className="text-center text-muted-foreground h-24">
                                No hay verificaciones guardadas.
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </>
    );
  }

  return null;
};

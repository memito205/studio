
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, PlusCircle, ArrowLeft, Send } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { DispatchSessionInfo } from '@/types';
import { getShipments, createShipment } from '@/app/actions';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from './ui/badge';


interface CreateShipmentDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onShipmentCreated: (shipmentId: string) => void;
}

const CreateShipmentDialog: React.FC<CreateShipmentDialogProps> = ({ isOpen, onOpenChange, onShipmentCreated }) => {
    const [truckPlate, setTruckPlate] = useState('');
    const [driverName, setDriverName] = useState('');
    const [sealNumber, setSealNumber] = useState('');
    const [isCreating, setIsCreating] = useState(false);
    const { toast } = useToast();

    const handleCreate = async () => {
        if (!truckPlate || !driverName) {
            toast({ variant: 'destructive', title: 'Campos requeridos', description: 'La placa y el nombre del conductor son obligatorios.' });
            return;
        }
        setIsCreating(true);
        const result = await createShipment({ truckPlate, driverName, sealNumber });
        if (result.success && result.shipmentId) {
            toast({ title: 'Éxito', description: `Nuevo envío #${result.shipmentId.slice(-6)} creado.` });
            onShipmentCreated(result.shipmentId);
            onOpenChange(false);
            // Reset fields
            setTruckPlate('');
            setDriverName('');
            setSealNumber('');
        } else {
            toast({ variant: 'destructive', title: 'Error', description: result.error });
        }
        setIsCreating(false);
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Crear Nuevo Envío/Despacho</DialogTitle>
                    <DialogDescription>Introduzca la información del transporte para iniciar un nuevo despacho.</DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="plate">Placa del Camión</Label>
                        <Input id="plate" value={truckPlate} onChange={e => setTruckPlate(e.target.value.toUpperCase())} placeholder="Ej: FLL491" />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="driver">Nombre del Conductor</Label>
                        <Input id="driver" value={driverName} onChange={e => setDriverName(e.target.value)} placeholder="Ej: Juan Perez" />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="seal">Número de Precinto (Opcional)</Label>
                        <Input id="seal" value={sealNumber} onChange={e => setSealNumber(e.target.value)} placeholder="Ej: P123456" />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button onClick={handleCreate} disabled={isCreating}>
                        {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Crear Envío
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};


interface DispatchDashboardProps {
    onReturnToWholesale: () => void;
    onStartDispatching: (shipmentId: string) => void;
}

export const DispatchDashboard: React.FC<DispatchDashboardProps> = ({ onReturnToWholesale, onStartDispatching }) => {
    const [shipments, setShipments] = useState<DispatchSessionInfo[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
    const { toast } = useToast();

    const fetchShipments = useCallback(async () => {
        setIsLoading(true);
        const result = await getShipments();
        if (result.success && result.data) {
            setShipments(result.data);
        } else {
            toast({ variant: 'destructive', title: 'Error', description: result.error });
        }
        setIsLoading(false);
    }, [toast]);

    useEffect(() => {
        fetchShipments();
    }, [fetchShipments]);
    
    const handleShipmentCreated = (shipmentId: string) => {
        fetchShipments(); // Refresh the list
        onStartDispatching(shipmentId); // Navigate to the scanning screen
    }

    return (
        <>
            <CreateShipmentDialog 
                isOpen={isCreateDialogOpen} 
                onOpenChange={setIsCreateDialogOpen}
                onShipmentCreated={handleShipmentCreated}
            />
            <div className="space-y-6">
                <Card>
                    <CardHeader className="flex flex-row justify-between items-center">
                        <div>
                            <CardTitle>Gestión de Despachos</CardTitle>
                            <CardDescription>Cree y administre los envíos a transportadoras.</CardDescription>
                        </div>
                        <div className="flex gap-2">
                             <Button onClick={() => setIsCreateDialogOpen(true)}>
                                <PlusCircle className="mr-2 h-4 w-4" />
                                Crear Nuevo Envío
                            </Button>
                            <Button onClick={onReturnToWholesale} variant="outline">
                                <ArrowLeft className="mr-2 h-4 w-4" /> Volver a Pedidos
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {isLoading ? (
                            <div className="flex items-center justify-center h-48">
                                <Loader2 className="h-12 w-12 animate-spin text-primary" />
                            </div>
                        ) : shipments.length === 0 ? (
                            <p className="text-muted-foreground text-center py-8">No hay despachos creados. Haga clic en "Crear Nuevo Envío" para comenzar.</p>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Fecha Creación</TableHead>
                                        <TableHead>Placa Camión</TableHead>
                                        <TableHead>Conductor</TableHead>
                                        <TableHead>Precinto</TableHead>
                                        <TableHead># Cajas</TableHead>
                                        <TableHead>Estado</TableHead>
                                        <TableHead className="text-right">Acción</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {shipments.map(shipment => (
                                        <TableRow key={shipment.id}>
                                            <TableCell>{new Date(shipment.createdAt!).toLocaleString('es-CO')}</TableCell>
                                            <TableCell>{shipment.truckPlate}</TableCell>
                                            <TableCell>{shipment.driverName}</TableCell>
                                            <TableCell>{shipment.sealNumber || 'N/A'}</TableCell>
                                            <TableCell>{Object.keys(shipment.scannedLabels || {}).length}</TableCell>
                                            <TableCell>
                                                <Badge variant={shipment.status === 'open' ? 'default' : 'secondary'}>
                                                    {shipment.status === 'open' ? 'Abierto' : 'Cerrado'}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Button onClick={() => onStartDispatching(shipment.id!)} variant="outline" size="sm">
                                                    {shipment.status === 'open' ? 'Escanear' : 'Ver'}
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </CardContent>
                </Card>
            </div>
        </>
    );
};

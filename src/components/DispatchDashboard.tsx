
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, PlusCircle, ArrowLeft, Send, Trash2, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { DispatchSessionInfo, WholesaleOrder } from '@/types';
import { getShipments, createShipment, deleteShipment, closeShipment } from '@/app/actions';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from './ui/badge';
import { Checkbox } from './ui/checkbox';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';


interface CreateShipmentDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onShipmentCreated: (shipmentId: string) => void;
    orders: WholesaleOrder[];
}

const CreateShipmentDialog: React.FC<CreateShipmentDialogProps> = ({ isOpen, onOpenChange, onShipmentCreated, orders }) => {
    const [truckPlate, setTruckPlate] = useState('');
    const [driverName, setDriverName] = useState('');
    const [sealNumber, setSealNumber] = useState('');
    const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
    const [isCreating, setIsCreating] = useState(false);
    const { toast } = useToast();

    const packedOrders = orders.filter(o => o.status === 'Empacado' || o.status === 'En Empaque');

    const handleCreate = async () => {
        if (!truckPlate || !driverName) {
            toast({ variant: 'destructive', title: 'Campos requeridos', description: 'La placa y el nombre del conductor son obligatorios.' });
            return;
        }
        setIsCreating(true);
        const result = await createShipment({ 
            truckPlate, 
            driverName, 
            sealNumber,
            allowedOrderIds: selectedOrderIds
        });
        if (result.success && result.shipmentId) {
            toast({ title: 'Éxito', description: `Nuevo envío #${result.shipmentId.slice(-6)} creado.` });
            onShipmentCreated(result.shipmentId);
            onOpenChange(false);
            // Reset fields
            setTruckPlate('');
            setDriverName('');
            setSealNumber('');
            setSelectedOrderIds([]);
        } else {
            toast({ variant: 'destructive', title: 'Error', description: result.error });
        }
        setIsCreating(false);
    };

    const toggleOrderSelection = (orderId: string) => {
        setSelectedOrderIds(prev => 
            prev.includes(orderId) 
            ? prev.filter(id => id !== orderId) 
            : [...prev, orderId]
        );
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
                    <div className="space-y-4 pt-4 border-t">
                        <Label className="flex justify-between items-center">
                            <span>Seleccionar Pedidos (Clientes)</span>
                            {selectedOrderIds.length > 0 && <Badge variant="secondary">{selectedOrderIds.length} selec.</Badge>}
                        </Label>
                        <div className="max-h-48 overflow-y-auto border rounded-md p-2 space-y-2">
                            {packedOrders.length > 0 ? packedOrders.map(order => (
                                <div key={order.id} className="flex items-center space-x-2">
                                    <Checkbox 
                                        id={`order-${order.id}`} 
                                        checked={selectedOrderIds.includes(order.id)}
                                        onCheckedChange={() => toggleOrderSelection(order.id)}
                                    />
                                    <Label htmlFor={`order-${order.id}`} className="flex-1 cursor-pointer text-sm">
                                        <div className="flex justify-between items-center">
                                            <span className="font-medium truncate max-w-[180px]">{order.cliente}</span>
                                            <span className="text-[10px] text-muted-foreground font-mono bg-muted px-1 rounded">{order.id.slice(-6)}</span>
                                        </div>
                                    </Label>
                                </div>
                            )) : (
                                <p className="text-xs text-muted-foreground text-center py-4 italic">No hay pedidos empacados disponibles.</p>
                            )}
                        </div>
                        <p className="text-[10px] text-muted-foreground italic">
                          * Puede incluir varios pedidos del mismo cliente en un envío. Si no selecciona ninguno, se permitirán todos los pedidos empacados.
                        </p>
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
    orders: WholesaleOrder[];
    onReturnToWholesale: () => void;
    onStartDispatching: (shipmentId: string) => void;
}

export const DispatchDashboard: React.FC<DispatchDashboardProps> = ({ orders, onReturnToWholesale, onStartDispatching }) => {
    const [shipments, setShipments] = useState<DispatchSessionInfo[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isDeletingId, setIsDeletingId] = useState<string | null>(null);
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

    const handleDeleteShipment = async (shipmentId: string) => {
        setIsDeletingId(shipmentId);
        const result = await deleteShipment(shipmentId);
        if (result.success) {
            toast({ title: 'Envío Eliminado', description: 'El despacho ha sido borrado y sus etiquetas liberadas.' });
            fetchShipments();
        } else {
            toast({ variant: 'destructive', title: 'Error', description: result.error });
        }
        setIsDeletingId(null);
    };

    const handleManualCloseShipment = async (shipmentId: string) => {
        setIsLoading(true);
        const result = await closeShipment(shipmentId);
        if (result.success) {
            toast({ title: 'Envío Cerrado', description: 'El despacho ha sido cerrado exitosamente.' });
            fetchShipments();
        } else {
            toast({ variant: 'destructive', title: 'Error al Cerrar', description: result.error });
            setIsLoading(false);
        }
    };

    return (
        <>
            <CreateShipmentDialog 
                isOpen={isCreateDialogOpen} 
                onOpenChange={setIsCreateDialogOpen}
                onShipmentCreated={handleShipmentCreated}
                orders={orders}
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
                                            <TableCell className="text-right space-x-2">
                                                <Button onClick={() => onStartDispatching(shipment.id!)} variant="outline" size="sm">
                                                    {shipment.status === 'open' ? 'Escanear' : 'Ver'}
                                                </Button>
                                                {shipment.status === 'open' && (
                                                    <AlertDialog>
                                                        <AlertDialogTrigger asChild>
                                                            <Button variant="outline" size="sm" className="text-amber-600 hover:text-amber-700 hover:bg-amber-50" title="Cerrar Manualmente">
                                                                <Check className="h-4 w-4" />
                                                            </Button>
                                                        </AlertDialogTrigger>
                                                        <AlertDialogContent>
                                                            <AlertDialogHeader>
                                                                <AlertDialogTitle>¿Cerrar envío manualmente?</AlertDialogTitle>
                                                                <AlertDialogDescription>
                                                                    Esto marcará el envío como "Cerrado" sin necesidad de escanear. Útil si las cajas ya se fueron o el pedido se forzó desde otra pantalla.
                                                                </AlertDialogDescription>
                                                            </AlertDialogHeader>
                                                            <AlertDialogFooter>
                                                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                                                <AlertDialogAction onClick={() => handleManualCloseShipment(shipment.id!)} className="bg-amber-600 hover:bg-amber-700">
                                                                    Cerrar Envío
                                                                </AlertDialogAction>
                                                            </AlertDialogFooter>
                                                        </AlertDialogContent>
                                                    </AlertDialog>
                                                )}
                                                <AlertDialog>
                                                    <AlertDialogTrigger asChild>
                                                        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10">
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </AlertDialogTrigger>
                                                    <AlertDialogContent>
                                                        <AlertDialogHeader>
                                                            <AlertDialogTitle>¿Eliminar despacho {shipment.truckPlate}?</AlertDialogTitle>
                                                            <AlertDialogDescription>
                                                                Esta acción liberará todas las etiquetas escaneadas en este envío para que puedan ser despachadas en otro camión. No se puede deshacer.
                                                            </AlertDialogDescription>
                                                        </AlertDialogHeader>
                                                        <AlertDialogFooter>
                                                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                                            <AlertDialogAction onClick={() => handleDeleteShipment(shipment.id!)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                                                {isDeletingId === shipment.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Eliminar Permanentemente'}
                                                            </AlertDialogAction>
                                                        </AlertDialogFooter>
                                                    </AlertDialogContent>
                                                </AlertDialog>
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

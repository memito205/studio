
"use client";

import React, { useState, useMemo, ChangeEvent, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { ArrowLeft, UploadCloud, Truck, Search, Loader2, Download, Settings, ChevronsUpDown, Check, X, Plus, AlertTriangle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from './ui/card';
import { Input } from './ui/input';
import { useToast } from '@/hooks/use-toast';
import type { RouteEntry, RouteStatus } from '@/types';
import { parseFlexibleDate } from '@/lib/parsingUtils';
import { saveRoutes, loadAllRoutes, updateRouteStatus, createManualRouteEntry } from '@/app/actions';
import { useAuth } from '@/hooks/use-auth-context';
import { RoutesDashboard } from './RoutesDashboard';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Checkbox } from './ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Label } from './ui/label';
import {
    Table,
    TableBody,
    TableCell,
    TableFooter,
    TableHead,
    TableHeader,
    TableRow,
  } from "@/components/ui/table"

const FAILURE_REASONS = ["No lo tienen listo", "Ya se envio", "TF que no se va enviar"];

const DESTINOS_PREDEFINIDOS = [
    "B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9", "B10",
    "B11", "B12", "B13", "B14", "B15", "B16", "B17", "B18", "B19", "B20",
    "B21", "B22", "B23", "MOLINOS", "BODEGA PIONEROS", "OFICINA"
].sort();


const FailureDialog: React.FC<{
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: (reason: string) => void;
}> = ({ isOpen, onOpenChange, onConfirm }) => {
    const [reason, setReason] = useState("");
    const [otherReason, setOtherReason] = useState("");

    const handleConfirm = () => {
        const finalReason = reason === 'Otro' ? otherReason : reason;
        if (finalReason) {
            onConfirm(finalReason);
        }
    };

    return (
        <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Registrar Fallo</AlertDialogTitle>
                    <AlertDialogDescription>Seleccione o ingrese el motivo del fallo.</AlertDialogDescription>
                </AlertDialogHeader>
                <div className="space-y-4 py-4">
                    <Select value={reason} onValueChange={(value) => setReason(value)}>
                        <SelectTrigger><SelectValue placeholder="Seleccione un motivo..." /></SelectTrigger>
                        <SelectContent>
                            {FAILURE_REASONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                            <SelectItem value="Otro">Otro</SelectItem>
                        </SelectContent>
                    </Select>
                    {reason === 'Otro' && (
                        <Input value={otherReason} onChange={(e) => setOtherReason(e.target.value)} placeholder="Especifique el motivo..." />
                    )}
                </div>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={handleConfirm} disabled={!reason || (reason === 'Otro' && !otherReason)}>Confirmar</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

const AddManualEntryDialog: React.FC<{
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: (numeroTF: string, almacenDestino: string) => void;
    route: RouteEntry[];
}> = ({ isOpen, onOpenChange, onConfirm, route }) => {
    const [numeroTF, setNumeroTF] = useState("");
    const [almacenDestino, setAlmacenDestino] = useState("");
    
    return (
        <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Agregar Entrada Manual</AlertDialogTitle>
                </AlertDialogHeader>
                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label htmlFor="tf-manual">Número TF</Label>
                        <Input id="tf-manual" value={numeroTF} onChange={(e) => setNumeroTF(e.target.value)} />
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="destino-manual">Almacén Destino</Label>
                         <Select value={almacenDestino} onValueChange={setAlmacenDestino}>
                            <SelectTrigger><SelectValue placeholder="Seleccionar destino..." /></SelectTrigger>
                            <SelectContent>
                                {DESTINOS_PREDEFINIDOS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                                <SelectItem value="OTRO">OTRO (Especificar)</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => onConfirm(numeroTF, almacenDestino)} disabled={!numeroTF || !almacenDestino}>Agregar</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}

const FinalizeDestinationDialog: React.FC<{
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: (personName: string) => void;
}> = ({ isOpen, onOpenChange, onConfirm }) => {
    const [personName, setPersonName] = useState("");

    return (
        <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Finalizar Destino</AlertDialogTitle>
                    <AlertDialogDescription>Ingrese el nombre de la persona que recibió o entregó la mercancía.</AlertDialogDescription>
                </AlertDialogHeader>
                <div className="py-4">
                    <Input value={personName} onChange={(e) => setPersonName(e.target.value)} placeholder="Nombre completo..." />
                </div>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => onConfirm(personName)} disabled={!personName}>Confirmar Finalización</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}

const OperatorView: React.FC<{}> = () => {
    const [selectedVehicle, setSelectedVehicle] = useState<string>('');
    const [searchPlate, setSearchPlate] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [routeForVehicle, setRouteForVehicle] = useState<RouteEntry[]>([]);
    const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
    const [dialogState, setDialogState] = useState<{ isOpen: boolean; tasks: RouteEntry[]; status: RouteStatus; reason?: string }>({ isOpen: false, tasks: [], status: 'Programado' });
    const [manualEntryState, setManualEntryState] = useState<{isOpen: boolean, type: 'ENTREGA' | 'RECOLECCION'}>({isOpen: false, type: 'ENTREGA'});
    const [finalizeDestState, setFinalizeDestState] = useState<{isOpen: boolean, destination: string | null}>({isOpen: false, destination: null});

    const { toast } = useToast();

    const fetchRoute = async (plate: string) => {
        setIsLoading(true);
        const plateToSearch = plate.trim().toUpperCase();
        const { data, error } = await loadAllRoutes();
        if (error) {
            toast({ variant: 'destructive', title: 'Error', description: error });
        } else {
            const vehicleRoutes = (data || []).filter(r =>
                r.vehiculo.toUpperCase() === plateToSearch &&
                r.status === 'Programado'
            );
            setRouteForVehicle(vehicleRoutes);
            setSelectedVehicle(plateToSearch);
        }
        setIsLoading(false);
    };

    const handleSearch = () => {
        if (!searchPlate.trim()) return;
        fetchRoute(searchPlate);
    };

    const handleUpdateStatus = async (tasksToUpdate: RouteEntry[], newStatus: RouteStatus, reason?: string) => {
        const promises = tasksToUpdate.map(task => updateRouteStatus(task.id, newStatus, reason));
        await Promise.all(promises);
        toast({ title: 'Éxito', description: `${tasksToUpdate.length} tarea(s) actualizada(s) a ${newStatus}.` });
        fetchRoute(selectedVehicle); // Refresh view
        setSelectedTasks(new Set()); // Clear selection
    };

    const openFailureDialog = (tasks: RouteEntry[]) => {
        setDialogState({ isOpen: true, tasks, status: tasks[0].tipoServicio === 'ENTREGA' ? 'Entrega Fallida' : 'Recolección Fallida' });
    };

    const openConfirmationDialog = (tasks: RouteEntry[], status: RouteStatus) => {
        setDialogState({ isOpen: true, tasks, status });
    };

    const handleConfirmDialog = (reason?: string) => {
        handleUpdateStatus(dialogState.tasks, dialogState.status, reason);
        setDialogState({ isOpen: false, tasks: [], status: 'Programado' });
    };

    const handleManualEntry = async (numeroTF: string, almacenDestino: string) => {
      if (!selectedVehicle || !numeroTF || !almacenDestino) return;
  
      await createManualRouteEntry({
          vehiculo: selectedVehicle,
          numeroTF,
          tipoServicio: manualEntryState.type,
          almacenDestino,
          allRoutes: routeForVehicle
      });
  
      toast({ title: 'Éxito', description: 'Entrada manual agregada.'});
      fetchRoute(selectedVehicle); // Refresh
      setManualEntryState({ isOpen: false, type: 'ENTREGA' });
    };
    
    const handleFinalizeDestination = (destination: string, tasks: {entregas: RouteEntry[], recolecciones: RouteEntry[]}) => {
        const allTasks = [...tasks.entregas, ...tasks.recolecciones];
        const allCompleted = allTasks.every(t => t.status !== 'Programado');
        if(allCompleted) {
            setFinalizeDestState({isOpen: true, destination});
        }
    };
    
    const confirmFinalizeDestination = (personName: string) => {
        console.log(`Destino ${finalizeDestState.destination} finalizado por ${personName}`);
        setFinalizeDestState({isOpen: false, destination: null});
    }

    const groupedByDestination = useMemo(() => {
        return routeForVehicle.reduce((acc, route) => {
            const dest = route.almacenDestino;
            if (!acc[dest]) {
                acc[dest] = { entregas: [], recolecciones: [] };
            }
            if (route.tipoServicio.toUpperCase() === 'ENTREGA') {
                acc[dest].entregas.push(route);
            } else {
                acc[dest].recolecciones.push(route);
            }
            return acc;
        }, {} as Record<string, { entregas: RouteEntry[], recolecciones: RouteEntry[] }>);
    }, [routeForVehicle]);

    return (
        <Card>
            <FailureDialog 
                isOpen={dialogState.isOpen && (dialogState.status === 'Entrega Fallida' || dialogState.status === 'Recolección Fallida')} 
                onOpenChange={() => setDialogState({ isOpen: false, tasks: [], status: 'Programado' })}
                onConfirm={handleConfirmDialog}
            />
            <AddManualEntryDialog
                isOpen={manualEntryState.isOpen}
                onOpenChange={() => setManualEntryState({ isOpen: false, type: 'ENTREGA' })}
                onConfirm={handleManualEntry}
                route={routeForVehicle}
            />
            <FinalizeDestinationDialog
                isOpen={finalizeDestState.isOpen}
                onOpenChange={() => setFinalizeDestState({isOpen: false, destination: null})}
                onConfirm={confirmFinalizeDestination}
            />
            <CardHeader>
                <CardTitle>Vista de Ruta del Operador</CardTitle>
                <CardDescription>
                    {selectedVehicle ? `Mostrando ruta para el vehículo: ${selectedVehicle}` : 'Ingrese la placa de su vehículo para ver la ruta.'}
                </CardDescription>
            </CardHeader>
            <CardContent>
                {selectedVehicle ? (
                    <div className="space-y-4">
                        <Button variant="outline" onClick={() => { setSelectedVehicle(''); setSearchPlate(''); setRouteForVehicle([]); }}>
                            <ArrowLeft className="mr-2 h-4 w-4" /> Buscar otra placa
                        </Button>
                        {Object.keys(groupedByDestination).length > 0 ? (
                            Object.entries(groupedByDestination).map(([destination, tasks]) => {
                                const allTasks = [...tasks.entregas, ...tasks.recolecciones];
                                const selectedInDest = allTasks.filter(t => selectedTasks.has(t.id));

                                return (
                                <Collapsible key={destination} className="space-y-2" defaultOpen>
                                    <CollapsibleTrigger asChild>
                                        <div className="flex w-full items-center justify-between rounded-lg bg-muted p-4 font-semibold text-lg cursor-pointer">
                                            <span>{destination}</span>
                                            <ChevronsUpDown className="h-5 w-5" />
                                        </div>
                                    </CollapsibleTrigger>
                                    <CollapsibleContent className="space-y-4 p-4 border rounded-lg">
                                        {selectedInDest.length > 0 && (
                                            <div className="flex gap-2">
                                                <Button size="sm" onClick={() => openConfirmationDialog(selectedInDest, 'Entregado')}>Marcar {selectedInDest.length} como OK</Button>
                                                <Button size="sm" variant="destructive" onClick={() => openFailureDialog(selectedInDest)}>Marcar {selectedInDest.length} como Fallo</Button>
                                            </div>
                                        )}
                                        {tasks.entregas.length > 0 && (
                                            <div>
                                                <div className="flex justify-between items-center mb-2">
                                                    <h4 className="font-semibold">Entregas ({tasks.entregas.length})</h4>
                                                    <Button size="sm" variant="secondary" onClick={() => setManualEntryState({ isOpen: true, type: 'ENTREGA' })}><Plus className="mr-1 h-4 w-4"/> Agregar Entrega Manual</Button>
                                                </div>
                                                <div className="border rounded-md">
                                                    <Table>
                                                        <TableBody>
                                                        {tasks.entregas.map(tf => (
                                                            <TableRow key={tf.id}>
                                                                <TableCell className="w-10"><Checkbox checked={selectedTasks.has(tf.id)} onCheckedChange={(checked) => setSelectedTasks(prev => { const next = new Set(prev); if(checked) next.add(tf.id); else next.delete(tf.id); return next; })} /></TableCell>
                                                                <TableCell className="p-2">
                                                                    {tf.numeroTF}
                                                                    {tf.originalAlmacenDestino && <span className="text-xs text-muted-foreground ml-2">(Destino: {tf.originalAlmacenDestino})</span>}
                                                                </TableCell>
                                                                <TableCell className="p-2 text-right space-x-2">
                                                                    <Button size="sm" variant="outline" className="bg-red-100 text-red-700 hover:bg-red-200" onClick={() => openFailureDialog([tf])}><X className="mr-1 h-4 w-4"/> Fallo</Button>
                                                                    <Button size="sm" variant="outline" className="bg-green-100 text-green-700 hover:bg-green-200" onClick={() => handleUpdateStatus([tf], 'Entregado')}><Check className="mr-1 h-4 w-4"/> OK</Button>
                                                                </TableCell>
                                                            </TableRow>
                                                        ))}
                                                        </TableBody>
                                                    </Table>
                                                </div>
                                            </div>
                                        )}
                                        {tasks.recolecciones.length > 0 && (
                                            <div>
                                                <div className="flex justify-between items-center mb-2">
                                                    <h4 className="font-semibold">Recolecciones ({tasks.recolecciones.length})</h4>
                                                    <Button size="sm" variant="secondary" onClick={() => setManualEntryState({ isOpen: true, type: 'RECOLECCION' })}><Plus className="mr-1 h-4 w-4"/> Agregar Recolección Manual</Button>
                                                </div>
                                                <div className="border rounded-md">
                                                     <Table>
                                                        <TableBody>
                                                        {tasks.recolecciones.map(tf => (
                                                            <TableRow key={tf.id}>
                                                                 <TableCell className="w-10"><Checkbox checked={selectedTasks.has(tf.id)} onCheckedChange={(checked) => setSelectedTasks(prev => { const next = new Set(prev); if(checked) next.add(tf.id); else next.delete(tf.id); return next; })} /></TableCell>
                                                                <TableCell className="p-2">{tf.numeroTF}</TableCell>
                                                                <TableCell className="p-2 text-right space-x-2">
                                                                    <Button size="sm" variant="outline" className="bg-red-100 text-red-700 hover:bg-red-200" onClick={() => openFailureDialog([tf])}><X className="mr-1 h-4 w-4"/> Fallo</Button>
                                                                    <Button size="sm" variant="outline" className="bg-green-100 text-green-700 hover:bg-green-200" onClick={() => handleUpdateStatus([tf], 'Recogido')}><Check className="mr-1 h-4 w-4"/> OK</Button>
                                                                </TableCell>
                                                            </TableRow>
                                                        ))}
                                                        </TableBody>
                                                    </Table>
                                                </div>
                                            </div>
                                        )}
                                        {allTasks.every(t => t.status !== 'Programado') && (
                                            <Button className="mt-4 w-full" onClick={() => handleFinalizeDestination(destination, tasks)}>Finalizar Destino</Button>
                                        )}
                                    </CollapsibleContent>
                                </Collapsible>
                                )
                            })
                        ) : (
                            <p className="text-center text-muted-foreground py-8">No hay paradas programadas pendientes para este vehículo.</p>
                        )}
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center text-center gap-6 py-8">
                        <Truck className="w-16 h-16 text-primary" />
                        <div className="space-y-2">
                            <h2 className="text-2xl font-bold">Consulte su Ruta</h2>
                            <p className="text-muted-foreground">Ingrese la placa de su vehículo para ver el plan de entregas del día.</p>
                        </div>
                        <div className="flex w-full max-w-sm items-center space-x-2">
                            <Input
                                type="text"
                                placeholder="Ej: FLL491"
                                value={searchPlate}
                                onChange={(e) => setSearchPlate(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                                className="text-center text-lg h-12 uppercase"
                                aria-label="Placa del vehículo"
                            />
                            <Button type="button" onClick={handleSearch} size="lg" disabled={!searchPlate.trim() || isLoading}>
                                {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                                {isLoading ? '' : 'Buscar'}
                            </Button>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
};


export const RoutesModule: React.FC<{ onReturnToSuite: () => void }> = ({ onReturnToSuite }) => {
    const { role } = useAuth();
    const isAdminOrSupervisor = role === 'admin' || role === 'supervisor';
    const [needsRefresh, setNeedsRefresh] = useState(false);
    
    const handleRoutesUpdated = () => {
        setNeedsRefresh(prev => !prev);
    };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <Card>
        <CardHeader className="flex flex-row justify-between items-center">
          <div>
            <CardTitle>Módulo de Rutas</CardTitle>
            <CardDescription>
              Planifique y consulte las rutas de entrega y recolección.
            </CardDescription>
          </div>
          <Button onClick={onReturnToSuite} variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver a la Suite
          </Button>
        </CardHeader>
      </Card>
      
      {isAdminOrSupervisor ? (
        <Tabs defaultValue="dashboard">
            <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="dashboard">Panel de Administración</TabsTrigger>
                <TabsTrigger value="operator_view">Vista de Operador</TabsTrigger>
            </TabsList>
            <TabsContent value="dashboard" className="mt-6">
                <RoutesDashboard onRoutesUpdated={handleRoutesUpdated} />
            </TabsContent>
            <TabsContent value="operator_view" className="mt-6">
                <OperatorView />
            </TabsContent>
        </Tabs>
      ) : (
        <OperatorView />
      )}
    </div>
  );
};

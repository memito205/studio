"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft, LayoutGrid, Package, Check, AlertTriangle, ScanLine, Clock, X, Archive, ArchiveRestore, Tag, Search, Pencil, Trash2, FileDown, Timer, BarChartHorizontal, Play, Pause, Loader2, Trophy, AlarmClockOff, Eye, RotateCcw, History } from 'lucide-react';
import type { WholesaleOrder, ProductDatabaseItem, PackingScanResult, PackingSession, PackingUnit, PackedItem, UnitSearchResult, WholesaleOrderDetail, PauseReason, LabelValidationResult, PackingPause, OperationPulse, PreprintedLabel } from '@/types';
import { onSnapshot, doc, collection, query, where, Timestamp, deleteField } from 'firebase/firestore';
import { firestore } from '@/services/firebase';
import { 
    validateLabel, 
    markLabelAsUsed, 
    updateOrderStatus, 
    addPackedItem, 
    getPackedItemsForOrder, 
    deletePackedItem, 
    updatePackedItem, 
    createPackingUnit, 
    lookupBarcode, 
    getUserPulsesForDay, 
    bulkDeletePackedItems, 
    revertLabelStatus, 
    deletePackingUnit, 
    associateOrphanToUnit,
    secureCloseUnitAction,
    repairSessionUnitsAction
} from '@/app/actions';
import { useSuitePulse } from '@/hooks/useSuitePulse';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { exportToXlsx } from '@/services/export';
import { useToast } from '@/hooks/use-toast';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from '@/components/ui/carousel';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/use-auth-context'; // Import useAuth hook
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UnitContentDialog } from './UnitContentDialog';
import { OrphanContentDialog } from './OrphanContentDialog';

interface PackingScreenProps {
  packingOrder: { order: WholesaleOrder; details: any[] };
  onReturnToOrders: () => void;
  onReturnToSuite: () => void;
  initialSession: PackingSession;
  onSessionChange: (newSession: PackingSession) => void;
  productivityGoal: number;
}

interface GroupedReference {
    referencia: string;
    item: string;
    sizes: {
        [talla: string]: {
            ordered: number;
            packed: number;
        }
    }
}

interface OverpackAlertState {
    isOpen: boolean;
    itemKey: string;
    packed: number;
    ordered: number;
}

const pauseReasons: PauseReason[] = [
    'BREAKFAST', 'LUNCH', 'SNACK', 'BATHROOM',
    'SUPPLIES', 'FAILURE', 'RECYCLING', 'OTHER'
];

const pauseReasonLabels: Record<PauseReason, string> = {
    BREAKFAST: 'Desayuno',
    LUNCH: 'Almuerzo',
    SNACK: 'Refrigerio',
    BATHROOM: 'Baño',
    SUPPLIES: 'Falta de Insumos',
    FAILURE: 'Falla de Máquina/Sistema',
    RECYCLING: 'Reciclaje/Orden',
    OTHER: 'Otra Actividad'
};


const createItemKey = (ref: any, talla: any) => {
    const r = (ref || '').toString().trim();
    const t = (talla || '').toString().trim();
    return `${r}-${t}`;
};

const PauseDialog: React.FC<{
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: (reason: PauseReason, justification?: string) => void;
}> = ({ isOpen, onOpenChange, onConfirm }) => {
    const [reason, setReason] = useState<PauseReason | ''>('');
    const [justification, setJustification] = useState('');

    const handleConfirm = () => {
        if (reason) {
            onConfirm(reason, reason === 'OTHER' ? justification : undefined);
            setReason('');
            setJustification('');
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Pausar Operación</DialogTitle>
                    <DialogDescription>Seleccione el motivo de la pausa. El tiempo se registrará.</DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-4">
                    <div className="space-y-2">
                        <Label>Motivo de la Pausa</Label>
                        <Select value={reason} onValueChange={(value) => setReason(value as PauseReason)}>
                            <SelectTrigger>
                                <SelectValue placeholder="Seleccione un motivo..." />
                            </SelectTrigger>
                            <SelectContent>
                                {pauseReasons.map(r => (
                                    <SelectItem key={r} value={r}>{pauseReasonLabels[r]}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {reason === 'OTHER' && (
                        <div className="space-y-2 animate-in fade-in slide-in-from-top-1">
                            <Label>Especifique la actividad (Justificación)</Label>
                            <Input 
                                value={justification}
                                onChange={(e) => setJustification(e.target.value)}
                                placeholder="Ej: Apoyo en otra área, reunión..."
                                className="w-full"
                            />
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button onClick={handleConfirm} disabled={!reason || (reason === 'OTHER' && !justification.trim())}>Confirmar Pausa</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const CloseUnitDialog: React.FC<{ 
    onConfirm: (label: string) => void; 
    isOpen: boolean; 
    onOpenChange: (open: boolean) => void;
    isLoading: boolean;
}> = ({ onConfirm, isOpen, onOpenChange, isLoading }) => {
    const [label, setLabel] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen) {
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [isOpen]);

    const handleConfirm = () => {
        if (label.trim() && !isLoading) {
            onConfirm(label);
            setLabel('');
        }
    };
    
    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Cerrar Unidad de Empaque</DialogTitle>
                    <DialogDescription>Escanee o digite el código de barras de la etiqueta para esta caja.</DialogDescription>
                </DialogHeader>
                <div className="py-4">
                    <Input
                        ref={inputRef}
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        placeholder="Código de la etiqueta..."
                        onKeyDown={(e) => { if (e.key === 'Enter') handleConfirm(); }}
                        disabled={isLoading}
                    />
                </div>
                <DialogFooter>
                    <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={isLoading}>Cancelar</Button>
                    <Button onClick={handleConfirm} disabled={!label.trim() || isLoading}>
                        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Confirmar y Cerrar
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

interface UnitSummarySearchResult {
    unitId: number;
    unitLabel: string;
    totalItems: number;
    unitObject: PackingUnit | null;
    isOrphan?: boolean;
    firestoreId?: string;
}


export const PackingScreen: React.FC<PackingScreenProps> = ({
  packingOrder,
  onReturnToOrders,
  onReturnToSuite,
  initialSession,
  onSessionChange,
  productivityGoal,
}) => {
    const { toast } = useToast();
    const { user, role, userName: contextUserName } = useAuth(); // Get current user and role
    const [session, setSession] = useState<PackingSession>(() => ({
        ...initialSession,
        units: initialSession.units || [],
        pauses: initialSession.pauses || [],
        status: initialSession.status || 'active',
    }));
    
    const [allPackedItems, setAllPackedItems] = useState<PackedItem[]>([]);
    const [lastScan, setLastScan] = React.useState<PackingScanResult | null>(null);
    const [isCloseUnitDialogOpen, setIsCloseUnitDialogOpen] = useState(false);
    const [unitToCloseId, setUnitToCloseId] = useState<number | null>(null);
    const [isLoading, setIsLoading] = React.useState(false);
    const [isClosingUnit, setIsClosingUnit] = useState(false);
    const [isUnitContentDialogOpen, setIsUnitContentDialogOpen] = useState(false);
    const [isPauseDialogOpen, setIsPauseDialogOpen] = useState(false);
    const [selectedUnit, setSelectedUnit] = useState<PackingUnit | null>(null);
    const [isOrphanDialogOpen, setIsOrphanDialogOpen] = useState(false);
    const [orphanToView, setOrphanToView] = useState<{ id: string, label: string } | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [referenciaFilter, setReferenciaFilter] = useState('');
    const [itemFilter, setItemFilter] = useState('');
    const barcodeInputRef = React.useRef<HTMLInputElement>(null);
    const [overpackAlert, setOverpackAlert] = useState<OverpackAlertState>({ isOpen: false, itemKey: '', packed: 0, ordered: 0 });
    const [mixedReferenceError, setMixedReferenceError] = useState<{ show: boolean, expected: string, scanned: string } | null>(null);
    const [packerPulses, setPackerPulses] = useState<OperationPulse[]>([]);
    const [isFetchingPulses, setIsFetchingPulses] = useState(false);
    const [isTimelineDialogOpen, setIsTimelineDialogOpen] = useState(false);
    const { isPaused, currentPulse, globalPulse, allPulses } = useSuitePulse();
    
    // State for productivity timer
    const [elapsedTime, setElapsedTime] = useState(0);
    const [manualLabelToRelease, setManualLabelToRelease] = useState('');
    
    const fetchPackedItems = useCallback(async () => {
        const result = await getPackedItemsForOrder(packingOrder.order.id);
        if(result.data){
            setAllPackedItems(result.data);
        }
    }, [packingOrder.order.id]);

    // 1. Sincronización Real-time de la Sesión
    useEffect(() => {
        if (!packingOrder?.order?.id) return;
        const sessionRef = doc(firestore, 'packingSessions', packingOrder.order.id);
        const unsubscribe = onSnapshot(sessionRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data() as PackingSession;
                setSession(data);
            }
        });
        return () => unsubscribe();
    }, [packingOrder?.order?.id]);

    // 2. Sincronización Real-time de Ítems Empacados
    useEffect(() => {
        if (!packingOrder?.order?.id) return;
        const q = query(
            collection(firestore, 'packedItems'),
            where('orderId', '==', packingOrder.order.id)
        );
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const items: PackedItem[] = [];
            snapshot.forEach((doc) => {
                items.push({ id: doc.id, ...doc.data() } as PackedItem);
            });
            setAllPackedItems(items);
        });
        return () => unsubscribe();
    }, [packingOrder?.order?.id]);

    // Remover el guardado automático de la sesión completa
    // (Ya no se necesita porque cada cambio es atómico en el servidor)

    useEffect(() => {
        fetchPackedItems();
    }, [fetchPackedItems]);


    // useEffect para guardar la sesión - ELIMINADO para evitar conflictos de concurrencia

    useEffect(() => {
        if (!isLoading && session.status === 'active') {
            const timer = setTimeout(() => {
                barcodeInputRef.current?.focus();
            }, 50);
            return () => clearTimeout(timer);
        }
    }, [isLoading, session.status]);
    
    const activeUnit = useMemo(() => {
        if (!user) return null;
        return session.units.find(u => u.status === 'open' && u.createdBy === user.uid) || null;
    }, [session.units, user?.uid]);
    
    const userUnits = useMemo(() => {
        if (!user) return [];
        // Show only the active unit for the current user.
        const activeUserUnit = session.units.find(u => u.status === 'open' && u.createdBy === user.uid);
        return activeUserUnit ? [activeUserUnit] : [];
    }, [session.units, user?.uid]);
    
    // Timer effect now depends on current user first scan time
    useEffect(() => {
        let timer: NodeJS.Timeout;
        const targetPackerId = user?.uid || session.packerId;
        
        const userFirstScanTime = session.units
            .filter(u => u.createdBy === targetPackerId && u.createdAt)
            .map(u => new Date(u.createdAt!).getTime())
            .filter(t => !isNaN(t))
            .sort((a,b)=>a-b)[0];
            
        if (userFirstScanTime) {
            timer = setInterval(() => {
                setElapsedTime(Date.now() - userFirstScanTime);
            }, 1000);
        }
        return () => clearInterval(timer);
    }, [session.units, session.packerId, user?.uid]);

    // Fetch pulses for the current user (if operario) or session owner (if admin/supervisor observing)
    useEffect(() => {
        const fetchTargetPulses = async () => {
            const targetPackerId = user?.uid || session.packerId;
            if (!targetPackerId) return;
            
            // If the current user is the target, we use allPulses from useSuitePulse
            if (user?.uid === targetPackerId) {
                setPackerPulses(allPulses);
                return;
            }
 
            // Otherwise (supervisor/admin observing another user's session), fetch the pulses for that user
            setIsFetchingPulses(true);
            const today = new Date().toLocaleDateString('sv-SE'); // e.g. "2024-04-29"
            const result = await getUserPulsesForDay(targetPackerId, today);
            if (result.data) {
                setPackerPulses(result.data);
            }
            setIsFetchingPulses(false);
        };
 
        fetchTargetPulses();
    }, [session.packerId, user?.uid, allPulses]);


    const userPackingProgress = useMemo(() => {
        const targetPackerId = user?.uid || session.packerId;
        const progress: { [key: string]: number } = {};
        allPackedItems
            .filter(item => item.packerId === targetPackerId)
            .forEach(item => {
                progress[item.itemKey] = (progress[item.itemKey] || 0) + item.quantity;
            });
        return progress;
    }, [allPackedItems, session.packerId, user?.uid]);

    const globalPackingProgress = useMemo(() => {
        const progress: { [key: string]: number } = {};
        allPackedItems.forEach(item => {
            progress[item.itemKey] = (progress[item.itemKey] || 0) + item.quantity;
        });
        return progress;
    }, [allPackedItems]);
    
    const totalUserPackedQuantity = useMemo(() => {
        const targetPackerId = user?.uid || session.packerId;
        return allPackedItems
            .filter(item => item.packerId === targetPackerId)
            .reduce((total, item) => total + item.quantity, 0);
    }, [allPackedItems, session.packerId, user?.uid]);


    const handleBarcodeSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const barcodeInput = barcodeInputRef.current;
        if (!user || !barcodeInput || !barcodeInput.value.trim() || isLoading || session.status === 'paused') {
            if (session.status === 'paused') {
                toast({ variant: 'destructive', title: 'Operación Pausada', description: 'Reanude la operación para continuar escaneando.' });
            }
            return;
        }

        const barcode = barcodeInput.value.trim();
        setIsLoading(true);

        try {
            const result = await lookupBarcode(barcode, packingOrder.order.id);
            setLastScan(result);

            if (result.status === 'success' && result.item && (result.item.referencia || result.item.reference)) {
                const itemKey = createItemKey(result.item.referencia, result.item.talla);
                const detail = packingOrder.order.details.find(d => createItemKey(d.referencia, d.talla) === itemKey);
                const orderedQty = detail?.cantidad || 0;
                const scannedReference = (result.item.referencia || result.item.reference || '').toString().trim();
                const totalOrderedForRef = packingOrder.order.details
                    .filter(d => ((d as any).referencia || (d as any).reference || '').toString().trim() === scannedReference)
                    .reduce((sum, d) => sum + (d.cantidad || 0), 0);
                
                // Safety check for progress object
                const safeProgress = globalPackingProgress || {};
                
                const totalPackedForRef = Object.entries(safeProgress)
                    .filter(([key]) => key.split('-')[0].trim() === scannedReference)
                    .reduce((sum, [, qty]) => sum + qty, 0);
                    
                const packedQty = safeProgress[itemKey] || 0;

                // Block if total for reference is exceeded
                if (totalPackedForRef + 1 > totalOrderedForRef) {
                    toast({ 
                        variant: 'destructive', 
                        title: 'Límite de Referencia Superado', 
                        description: `Ya se completó el total pedido para la referencia ${scannedReference} (${totalOrderedForRef} unidades).` 
                    });
                    setIsLoading(false);
                    return;
                }

                if (packedQty + 1 > orderedQty) {
                    setOverpackAlert({ isOpen: true, itemKey, packed: packedQty + 1, ordered: orderedQty });
                }

                let unitToUse = activeUnit;
                if (unitToUse && !unitToUse.firestoreId) {
                    await repairSessionUnitsAction(session.orderId);
                    toast({ title: 'Sincronizando Unidad', description: 'Se ha actualizado la unidad. Por favor, escanee de nuevo.' });
                    setIsLoading(false);
                    return;
                }

                if (!unitToUse) {
                    // Use userName from context (fetched from Firestore) as priority
                    const userName = contextUserName || user?.displayName || user?.email || session.packerName || 'Usuario';
                    const newUnitResult = await createPackingUnit(session.orderId, user?.uid || 'Unknown', userName);
                    if (newUnitResult.success && newUnitResult.newUnit) {
                        // Optimistic update - now includes firestoreId from server
                        setSession(prev => ({ ...prev, units: [...prev.units, newUnitResult.newUnit!] }));
                        unitToUse = newUnitResult.newUnit;
                    } else {
                        throw new Error(`No se pudo crear una nueva unidad de empaque: ${newUnitResult.error}`);
                    }
                }

                if (!unitToUse?.firestoreId) {
                    throw new Error(`La unidad de empaque activa no tiene un ID de base de datos válido.`);
                }

                const itemsInActiveUnit = allPackedItems.filter(item => item.packingUnitId === unitToUse?.firestoreId);
                if (itemsInActiveUnit.length > 0) {
                    // Find the first item that has a reference (the part before the hyphen)
                    const itemWithRef = itemsInActiveUnit.find(i => i.itemKey.split('-')[0].trim().length > 0);
                    const expectedReference = itemWithRef ? itemWithRef.itemKey.split('-')[0].trim() : '';
                    const newReference = (result.item.referencia || '').toString().trim();
                    
                    if (newReference && expectedReference && newReference !== expectedReference) {
                        setMixedReferenceError({ show: true, expected: expectedReference, scanned: newReference });
                        return;
                    }
                }

                const itemData: Omit<PackedItem, 'id' | 'scannedAt' | 'quantity'> = {
                    orderId: session.orderId,
                    packingUnitId: unitToUse.firestoreId,
                    itemKey,
                    barcode: result.item.codigoBarras,
                    packerId: user.uid,
                    item: result.item,
                };

                const addResult = await addPackedItem(itemData);
                if (addResult.success) {
                    fetchPackedItems();
                } else {
                    throw new Error(addResult.error);
                }
            }
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error en Escaneo', description: error.message });
        } finally {
            setIsLoading(false);
            if (barcodeInput) {
                barcodeInput.value = '';
            }
        }
    };


    const handleResume = async () => {
        if (!user) return;
        setIsLoading(true);
        try {
            const now = new Date();
            setSession(prev => {
                const lastPause = prev.pauses?.slice().reverse().find(p => p.userId === user.uid && !p.endTime);
                if (lastPause) {
                    lastPause.endTime = now;
                }
                return { ...prev, status: 'active', lastActivity: now };
            });

            // Sync with global pulse system
            await import('@/app/actions').then(m => m.createPulse({
                userId: user.uid,
                userName: contextUserName || user.displayName || user.email || 'Operario',
                email: user.email || undefined,
                type: 'status_change',
                status: 'Disponible',
                startTime: now,
                endTime: null
            } as any));

            toast({ title: 'Operación Reanudada', description: 'El tiempo efectivo se está contabilizando nuevamente.' });
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error', description: error.message });
        } finally {
            setIsLoading(false);
        }
    };

    const handleOpenCloseUnitDialog = (unitId: number) => {
        setUnitToCloseId(unitId);
        setIsCloseUnitDialogOpen(true);
    };
    
    const handleCloseUnit = async (scannedLabel: string) => {
        const targetUnitId = unitToCloseId || activeUnit?.id;
        if (!targetUnitId) return;
        
        const unit = session.units.find(u => u.id === targetUnitId);
        if (!unit) return;

        if (!scannedLabel.trim()) {
            toast({ variant: 'destructive', title: 'Error', description: 'Debe escanear una etiqueta para cerrar la caja.' });
            return;
        }

        setIsClosingUnit(true);

        try {
            const packerName = contextUserName || user?.displayName || user?.email || 'Operario';
            const normalizedLabel = scannedLabel.trim().toUpperCase();

            // Usar la nueva acción segura y atómica que valida y cierra en un solo paso
            const result = await secureCloseUnitAction(
                packingOrder.order.id,
                targetUnitId,
                normalizedLabel,
                packerName
            );

            if (result.success) {
                toast({
                    title: "Unidad Cerrada",
                    description: `La unidad #${targetUnitId} ha sido cerrada con la etiqueta ${normalizedLabel}.`,
                });
                
                // Reiniciar estados de cierre
                setUnitToCloseId(null);
                setIsCloseUnitDialogOpen(false);
                setLastScan(null);
                
                // Refrescar ítems (aunque el listener debería hacerlo, esto asegura consistencia inmediata)
                fetchPackedItems();
            } else {
                toast({
                    variant: "destructive",
                    title: "Error al cerrar",
                    description: result.error || "No se pudo cerrar la unidad.",
                });
            }
        } catch (error: any) {
            console.error("Error closing unit:", error);
            toast({
                variant: 'destructive',
                title: 'Error Crítico',
                description: error.message || 'Ocurrió un error inesperado al cerrar la unidad.',
            });
        } finally {
            setIsClosingUnit(false);
        }
    };


    const handleReturnToOrders = () => {
        // No longer need to save the full session here as it is synced in real-time
        onReturnToOrders();
    };

    const handleResetLabel = async (labelId: string) => {
        if (!labelId || labelId.length < 3) return;
        
        setIsLoading(true);
        try {
            const result = await revertLabelStatus(labelId.trim().toUpperCase());
            if (result.success) {
                toast({
                    title: "Etiqueta Destrabada",
                    description: `La etiqueta ${labelId} ha sido marcada como disponible nuevamente.`,
                });
            } else {
                toast({
                    variant: "destructive",
                    title: "Error",
                    description: result.error || "No se pudo liberar la etiqueta.",
                });
            }
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "Error",
                description: error.message || "Error al conectar con el servidor.",
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleViewUnitContent = (unit: PackingUnit) => {
        setSelectedUnit(unit);
        setIsUnitContentDialogOpen(true);
    };
    
    const handleDeleteUnit = async (unitIdToDelete: number) => {
        const unitToDelete = session.units.find(u => u.id === unitIdToDelete);
        if (!unitToDelete || !unitToDelete.firestoreId) return;

        try {
            const result = await deletePackingUnit(packingOrder.order.id, unitToDelete.firestoreId, unitToDelete.labelBarcode);
            
            if (result.success) {
                // Optimistic UI update
                const updatedUnits = session.units.filter(u => u.id !== unitIdToDelete);
                const updatedSession = { ...session, units: updatedUnits };
                setSession(updatedSession);
                
                // Refresh local items
                fetchPackedItems();
                
                toast({
                    title: "Unidad Eliminada",
                    description: `La unidad #${unitIdToDelete} y su contenido han sido eliminados correctamente.`,
                });
                setIsUnitContentDialogOpen(false);
            } else {
                toast({
                    variant: "destructive",
                    title: "Error al eliminar",
                    description: result.error || "No se pudo eliminar la unidad.",
                });
            }
        } catch (error: any) {
            console.error("Error deleting unit:", error);
            toast({
                variant: "destructive",
                title: "Error Crítico",
            });
        }
    };

    const handleDeleteItem = async (unitId: number, itemKey: string) => {
        const unit = session.units.find(u => u.id === unitId);
        if (!unit) return;
        
        const itemsToDelete = allPackedItems.filter(item => item.packingUnitId === unit.firestoreId && item.itemKey === itemKey);
        if (itemsToDelete.length > 0) {
            const result = await bulkDeletePackedItems(itemsToDelete.map(i => i.id));
            if (result.success) {
                fetchPackedItems();
                toast({ title: 'Ítems Eliminados', description: `Se eliminaron ${itemsToDelete.length} unidades de la caja.` });
            } else {
                toast({ variant: 'destructive', title: 'Error de Borrado', description: result.error });
            }
        }
    };

    const handleCleanupOrphans = async (firestoreId: string) => {
        const itemsToDelete = allPackedItems.filter(item => item.packingUnitId === firestoreId);
        if (itemsToDelete.length > 0) {
            setIsLoading(true);
            const result = await bulkDeletePackedItems(itemsToDelete.map(i => i.id));
            setIsLoading(false);
            if (result.success) {
                fetchPackedItems();
                toast({ 
                    title: 'Registros Huérfanos Eliminados', 
                    description: `Se eliminaron ${itemsToDelete.length} ítems que no estaban asociados a ninguna caja activa.` 
                });
            } else {
                toast({ variant: 'destructive', title: 'Error al limpiar', description: result.error });
            }
        }
    };

    const handleRecoverOrphan = async (orphanFirestoreId: string, label: string) => {
        if (!user) return;
        
        setIsLoading(true);
        try {
            // 1. Create a new "empty" unit to host these items
            const userName = contextUserName || user?.displayName || user?.email || session.packerName || 'Usuario';
            const newUnitResult = await createPackingUnit(session.orderId, user.uid, userName);
            
            if (!newUnitResult.success || !newUnitResult.newUnit) {
                throw new Error(newUnitResult.error || "No se pudo crear la unidad de recuperación.");
            }

            const newUnit = newUnitResult.newUnit;

            // 2. Reassociate items in Firestore
            const assocResult = await associateOrphanToUnit(session.orderId, orphanFirestoreId, newUnit.firestoreId);
            
            if (!assocResult.success) {
                throw new Error(assocResult.error || "No se pudieron reasociar los ítems.");
            }

            // 3. Update local state
            setSession(prev => ({
                ...prev,
                units: [...prev.units, newUnit]
            }));

            // 4. Refresh items
            await fetchPackedItems();

            toast({
                title: "Unidad Recuperada",
                description: `Los ítems de "${label}" han sido movidos a la nueva Unidad #${newUnit.id}.`
            });

        } catch (error: any) {
            console.error("Error recovering orphan:", error);
            toast({ variant: 'destructive', title: 'Error de Recuperación', description: error.message });
        } finally {
            setIsLoading(false);
        }
    };

    const handleEditItemQuantity = async (unitId: number, itemKey: string, newQuantity: number) => {
        const unit = session.units.find(u => u.id === unitId);
        if (!unit) return;

        const itemsToUpdate = allPackedItems.filter(i => i.packingUnitId === unit.firestoreId && i.itemKey === itemKey);
        
        if (newQuantity > 0) {
            if (itemsToUpdate.length > 0) {
                const totalCurrent = itemsToUpdate.reduce((sum, i) => sum + i.quantity, 0);
                if (totalCurrent === newQuantity) return;

                const firstItem = itemsToUpdate[0];
                const [ref, tallaPart] = itemKey.split('-');
                const updateData: any = { quantity: newQuantity };

                if (!firstItem.item) {
                     updateData.item = {
                        referencia: ref,
                        talla: tallaPart,
                        codigoBarras: firstItem.barcode
                     };
                }

                const result = await updatePackedItem(firstItem.id, updateData);
                
                if (itemsToUpdate.length > 1) {
                    for (let i = 1; i < itemsToUpdate.length; i++) {
                        await deletePackedItem(itemsToUpdate[i].id);
                    }
                }

                if (result.success) {
                    fetchPackedItems();
                } else {
                    toast({ variant: 'destructive', title: 'Error', description: result.error });
                }
            }
        } else {
            if (itemsToUpdate.length > 0) {
                for (const item of itemsToUpdate) {
                    await deletePackedItem(item.id);
                }
                fetchPackedItems();
            }
        }
    };

    const handleEditItemTalla = async (unitId: number, itemKey: string, newTalla: string) => {
        if (!newTalla.trim()) return;
        
        const unit = session.units.find(u => u.id === unitId);
        if (!unit) return;

        const itemsToUpdate = allPackedItems.filter(i => i.packingUnitId === unit.firestoreId && i.itemKey === itemKey);
        if (itemsToUpdate.length === 0) return;

        const firstItem = itemsToUpdate[0];
        const [oldRef, oldTallaPart] = itemKey.split('-');
        
        const currentTalla = firstItem.item?.talla || firstItem.item?.size || oldTallaPart || '';
        if (currentTalla.trim().toLowerCase() === newTalla.trim().toLowerCase()) return;

        const reference = firstItem.item?.referencia || firstItem.item?.reference || oldRef || '';
        const newItemKey = createItemKey(reference, newTalla);

        setIsLoading(true);
        try {
            for (const item of itemsToUpdate) {
                // If item object exists, update it. If not, create a minimal one.
                const updatedItemData = item.item ? { 
                    ...item.item,
                    talla: newTalla,
                    size: newTalla 
                } : {
                    referencia: reference,
                    talla: newTalla,
                    codigoBarras: item.barcode,
                };

                await updatePackedItem(item.id, { 
                    itemKey: newItemKey,
                    item: updatedItemData as any
                });
            }
            toast({ title: 'Talla Actualizada', description: `Se cambió de ${currentTalla} a ${newTalla}` });
            fetchPackedItems();
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error', description: error.message });
        } finally {
            setIsLoading(false);
        }
    };

    const handlePause = async (reason: PauseReason, justification?: string) => {
        if (!user) return;
        setIsLoading(true);
        try {
            const now = new Date();
            const newPuases = [...session.pauses, { 
                startTime: now, 
                reason, 
                userId: user.uid,
                justification // Optional field for pulses
            }];
            
            setSession(prev => ({ ...prev, status: 'paused', pauses: newPuases }));
            
            // Sync with global pulse system
            const pulseReasonMap: Record<PauseReason, any> = {
                BREAKFAST: 'Desayuno',
                LUNCH: 'Almuerzo',
                SNACK: 'Refrigerio',
                BATHROOM: 'Baño',
                SUPPLIES: 'Falta de Insumos',
                FAILURE: 'Falla de Máquina/Sistema',
                RECYCLING: 'Reciclaje/Orden',
                OTHER: 'Otro'
            };

            await import('@/app/actions').then(m => m.createPulse({
                userId: user.uid,
                userName: contextUserName || user.displayName || user.email || 'Operario',
                email: user.email || undefined,
                type: 'pause',
                status: 'Pausado',
                reason: pulseReasonMap[reason],
                startTime: now,
                endTime: null,
                justification // Pass the justification to the backend action
            } as any));

            toast({ title: 'Operación Pausada', description: `Motivo: ${pauseReasonLabels[reason]}` });
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error', description: error.message });
        } finally {
            setIsLoading(false);
            setIsPauseDialogOpen(false);
        }
    };

    const handleAddManualItem = async (unitId: number, reference: string, talla: string, quantity: number) => {
        if (!reference || !talla || quantity <= 0) return;

        const unit = session.units.find(u => u.id === unitId);
        if (!unit) return;

        setIsLoading(true);
        try {
            // Try to find a barcode for this ref-talla in order details or existing items
            let barcode = '';
            const detail = packingOrder.order.details.find(d => 
                (d.referencia || '').toString().trim() === reference.trim() && 
                (d.talla || '').toString().trim() === talla.trim()
            );
            
            if (detail) {
                const existingItem = allPackedItems.find(p => 
                    (p.item?.referencia || p.itemKey.split('-')[0]) === reference && 
                    (p.item?.talla || p.itemKey.split('-')[1]) === talla
                );
                barcode = existingItem?.barcode || detail.item || ''; 
            }

            const itemKey = createItemKey(reference, talla);
            const itemData: Omit<PackedItem, 'id' | 'scannedAt' | 'quantity'> = {
                orderId: session.orderId,
                packingUnitId: unit.firestoreId,
                itemKey,
                barcode,
                packerId: user?.uid || 'manual-admin',
                item: {
                    codigoBarras: barcode,
                    referencia: reference,
                    talla: talla,
                    id: barcode
                } as ProductDatabaseItem
            };

            const result = await addPackedItem(itemData);
            if (result.success && result.itemId && quantity > 1) {
                await updatePackedItem(result.itemId, { quantity });
            }

            if (result.success) {
                toast({ title: 'Ítem Agregado', description: `${quantity} x ${reference} - ${talla} agregados a la caja.` });
                fetchPackedItems();
            } else {
                throw new Error(result.error);
            }
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error', description: error.message });
        } finally {
            setIsLoading(false);
        }
    };

     const handleReopenUnit = async (unitIdToReopen: number) => {
        if(activeUnit) {
            toast({ variant: 'destructive', title: 'Acción no permitida', description: `Primero debe cerrar la unidad activa #${activeUnit.id}.`});
            return;
        }

        const unitToReopen = session.units.find(u => u.id === unitIdToReopen);
        if (!unitToReopen || !unitToReopen.labelBarcode) return;
        
        // await markLabelAsUsed(unitToReopen.labelBarcode, -1, 'available'); 
        
        setSession(prev => {
            const newUnits = prev.units.map(u => {
                if (u.id === unitIdToReopen) {
                    return { ...u, status: 'open' as 'open', labelBarcode: undefined, closed_at: undefined };
                }
                return u;
            });
            return { ...prev, units: newUnits };
        });
        toast({ title: 'Unidad Reabierta', description: `La unidad #${unitIdToReopen} está abierta para edición.` });
        setIsUnitContentDialogOpen(false); // Close the dialog
    };

    const allUnitsSummary = useMemo<UnitSummarySearchResult[]>(() => {
        const results: UnitSummarySearchResult[] = [];
        const unitFirestoreIds = new Set(session.units.map(u => u.firestoreId));

        // 1. Add all valid units from session
        session.units.forEach(unit => {
            const itemsInUnit = allPackedItems.filter(p => p.packingUnitId === unit.firestoreId);
            results.push({
                unitId: unit.id,
                unitLabel: unit.labelBarcode || (unit.status === 'open' ? 'Abierta' : 'Sin Etiqueta'),
                totalItems: itemsInUnit.reduce((sum, item) => sum + item.quantity, 0),
                unitObject: unit,
                isOrphan: false,
                firestoreId: unit.firestoreId
            });
        });

        // 2. Identify and group orphan items (items pointing to a unit ID that no longer exists in session)
        const orphanItems = allPackedItems.filter(p => p.packingUnitId && !unitFirestoreIds.has(p.packingUnitId));
        
        if (orphanItems.length > 0) {
            const orphanGroups = new Map<string, PackedItem[]>();
            orphanItems.forEach(p => {
                if (!orphanGroups.has(p.packingUnitId)) orphanGroups.set(p.packingUnitId, []);
                orphanGroups.get(p.packingUnitId)!.push(p);
            });

            orphanGroups.forEach((items, firestoreId) => {
                results.push({
                    unitId: -1,
                    unitLabel: 'CAJA ELIMINADA (Huérfana)',
                    totalItems: items.reduce((sum, item) => sum + item.quantity, 0),
                    unitObject: null,
                    isOrphan: true,
                    firestoreId: firestoreId
                });
            });
        }

        // 3. Handle items with NO packingUnitId (truly abandoned items)
        const abandonedItems = allPackedItems.filter(p => !p.packingUnitId);
        if (abandonedItems.length > 0) {
            results.push({
                unitId: -2,
                unitLabel: 'ITEMS SIN ASOCIAR (Huérfanos)',
                totalItems: abandonedItems.reduce((sum, item) => sum + item.quantity, 0),
                unitObject: null,
                isOrphan: true,
                firestoreId: 'unassociated'
            });
        }

        return results.sort((a, b) => b.unitId - a.unitId);
    }, [session.units, allPackedItems]);

    const { validHistoryResults, orphanHistoryResults } = useMemo(() => {
        const query = searchQuery.toLowerCase().trim();
        
        const valid = allUnitsSummary.filter(res => !res.isOrphan);
        const orphans = allUnitsSummary.filter(res => res.isOrphan);

        if (!query) return { validHistoryResults: valid, orphanHistoryResults: orphans };

        const filterFn = (res: UnitSummarySearchResult) => {
            if (res.unitLabel.toLowerCase().includes(query)) return true;
            const itemsInUnit = allPackedItems.filter(p => 
                (res.isOrphan && res.firestoreId === 'unassociated' ? !p.packingUnitId : p.packingUnitId === res.firestoreId)
            );
            return itemsInUnit.some(p => p.itemKey.toLowerCase().includes(query) || (p.item?.referencia || '').toLowerCase().includes(query));
        };

        return {
            validHistoryResults: valid.filter(filterFn),
            orphanHistoryResults: orphans.filter(filterFn)
        };
    }, [searchQuery, allUnitsSummary, allPackedItems]);
    
    const totalOrdered = useMemo(() => packingOrder.order.details.reduce((sum, detail) => sum + detail.cantidad, 0), [packingOrder.order.details]);
    const totalPackedGlobal = useMemo(() => Object.values(globalPackingProgress).reduce((sum, count) => sum + count, 0), [globalPackingProgress]);
    const overallProgress = totalOrdered > 0 ? (totalPackedGlobal / totalOrdered) * 100 : 0;
    
    const productivityStats = useMemo(() => {
        const targetPackerId = user?.uid || session.packerId;
        if (!targetPackerId) return { totalElapsedTimeFormatted: '00:00:00', effectiveWorkTimeFormatted: '00:00:00', unitsPerHour: '0.0', compliance: '0.0' };
        
        const times: number[] = [];
        
        // 1. From session units
        session.units
            .filter(u => u.createdBy === targetPackerId && u.createdAt)
            .forEach(u => {
                const t = new Date(u.createdAt!).getTime();
                if (!isNaN(t)) times.push(t);
            });

        // 2. From packed items
        allPackedItems
            .filter(i => i.packerId === targetPackerId && i.scannedAt)
            .forEach(i => {
                const scannedAt = i.scannedAt as any;
                // Handle both Date and Firestore Timestamp
                const t = scannedAt?.toDate ? scannedAt.toDate().getTime() : new Date(scannedAt).getTime();
                if (!isNaN(t)) times.push(t);
            });

        // 3. From session startTime as ultimate fallback
        if (session.startTime) {
            const t = session.startTime instanceof Date ? session.startTime.getTime() : (session.startTime as any).toDate?.()?.getTime() || new Date(session.startTime).getTime();
            if (!isNaN(t)) times.push(t);
        }

        const userFirstScan = times.length > 0 ? Math.min(...times) : null;
            
        if (!userFirstScan) return { totalElapsedTimeFormatted: '00:00:00', effectiveWorkTimeFormatted: '00:00:00', unitsPerHour: '0.0', compliance: '0.0' };
        
        const now = Date.now();
        const totalElapsedTimeMs = now - userFirstScan;
        
        // 1. Collect all pause intervals for the target packer
        const activePulseFromContext = globalPulse || (user?.uid === targetPackerId ? currentPulse : null);
        
        // Use the packerPulses state if current user is not the packer
        const relevantPulses = user?.uid === targetPackerId ? allPulses : packerPulses;

        const rawIntervals = [
            ...session.pauses.filter(p => p.userId === targetPackerId).map(p => ({ 
                start: new Date(p.startTime).getTime(), 
                end: p.endTime ? new Date(p.endTime).getTime() : now 
            })),
            ...relevantPulses
                .filter(p => {
                    const pulseStart = p.startTime instanceof Date ? p.startTime.getTime() : (p.startTime as any).toDate?.()?.getTime() || new Date(p.startTime).getTime();
                    // IMPORTANT: Only count suite pauses that START after the user started this order
                    return pulseStart >= userFirstScan;
                })
                .map(p => ({ 
                    start: p.startTime instanceof Date ? p.startTime.getTime() : (p.startTime as any).toDate?.()?.getTime() || new Date(p.startTime).getTime(), 
                    end: p.endTime ? (p.endTime instanceof Date ? p.endTime.getTime() : (p.endTime as any).toDate?.()?.getTime() || new Date(p.endTime).getTime()) : now 
                }))
        ];

        // Explicitly add the current active pulse interval IF it started after the first scan
        if (isPaused && activePulseFromContext) {
            const activeStart = activePulseFromContext.startTime instanceof Date ? activePulseFromContext.startTime.getTime() : (activePulseFromContext.startTime as any).toDate?.()?.getTime() || new Date(activePulseFromContext.startTime).getTime();
            if (activeStart >= userFirstScan) {
                rawIntervals.push({
                    start: activeStart,
                    end: now
                });
            }
        }

        // 2. Sort and Merge Overlapping Intervals
        rawIntervals.sort((a, b) => a.start - b.start);
        const mergedIntervals: {start: number, end: number}[] = [];
        
        if (rawIntervals.length > 0) {
            let current = { ...rawIntervals[0] };
            for (let i = 1; i < rawIntervals.length; i++) {
                if (rawIntervals[i].start <= current.end) {
                    current.end = Math.max(current.end, rawIntervals[i].end);
                } else {
                    mergedIntervals.push(current);
                    current = { ...rawIntervals[i] };
                }
            }
            mergedIntervals.push(current);
        }

        // 3. Sum non-overlapping pause durations within the work window
        let totalPauseMs = 0;
        mergedIntervals.forEach(p => {
            const effectiveStart = Math.max(p.start, userFirstScan);
            const effectiveEnd = Math.min(p.end, now);
            if (effectiveEnd > effectiveStart) {
                totalPauseMs += (effectiveEnd - effectiveStart);
            }
        });

        const effectiveWorkTimeMs = Math.max(0, totalElapsedTimeMs - totalPauseMs);
        const effectiveSeconds = effectiveWorkTimeMs / 1000;
        
        const unitsPackedByUser = totalUserPackedQuantity;
        const unitsPerHour = effectiveSeconds > 0 ? (unitsPackedByUser / effectiveSeconds) * 3600 : 0;
        const compliance = productivityGoal > 0 ? (unitsPerHour / productivityGoal) * 100 : 0;

        const formatElapsedTime = (ms: number) => {
            if (ms < 0) ms = 0;
            const totalSeconds = Math.floor(ms / 1000);
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            const seconds = totalSeconds % 60;
            return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        };

        const targetPackerName = targetPackerId === user?.uid ? (contextUserName || user?.displayName || user?.email || 'Mí') : (session.packerName || 'Operario');
 
        return {
            totalElapsedTimeFormatted: formatElapsedTime(totalElapsedTimeMs),
            effectiveWorkTimeFormatted: formatElapsedTime(effectiveWorkTimeMs),
            unitsPerHour: unitsPerHour.toFixed(1),
            compliance: compliance.toFixed(1),
            userFirstScan,
            relevantPulses,
            totalPauseMs,
            targetPackerId,
            targetPackerName
        };
    }, [session, user, totalUserPackedQuantity, productivityGoal, elapsedTime, packerPulses, contextUserName]);

    const lastScanInfo = useMemo(() => {
        if (lastScan?.status === 'success' && lastScan.item) {
            const itemKey = createItemKey(lastScan.item.referencia, lastScan.item.talla);
            const detail = packingOrder.order.details.find(d => 
                (d.referencia || '').toString().trim() === (lastScan.item?.referencia || '').toString().trim() && 
                (d.talla || '').toString().trim() === (lastScan.item?.talla || '').toString().trim()
            );
            const ordered = detail?.cantidad || 0;
            const packedGlobal = globalPackingProgress[itemKey] || 0;
            const packedUser = userPackingProgress[itemKey] || 0;
            return { ordered, packedGlobal, packedUser, remaining: ordered - packedGlobal };
        }
        return null;
    }, [lastScan, globalPackingProgress, userPackingProgress, packingOrder.order.details]);
    
    const groupedAndFilteredDetails = useMemo<GroupedReference[]>(() => {
        const grouped = packingOrder.order.details.reduce((acc, detail) => {
            const refKey = (detail.referencia || '').toString().trim();
            if (!acc[refKey]) {
                acc[refKey] = {
                    referencia: refKey,
                    item: (detail.item || '').trim(),
                    sizes: {}
                };
            }
            
            const tallaKey = (detail.talla || '').toString().trim();
            const packedKey = createItemKey(refKey, tallaKey);
            const packed = globalPackingProgress[packedKey] || 0;
            
            acc[refKey].sizes[tallaKey] = { ordered: detail.cantidad, packed };
            return acc;
        }, {} as { [key: string]: GroupedReference });
        
        let filtered = Object.values(grouped) as GroupedReference[];
        
        if (referenciaFilter) {
            filtered = filtered.filter(g => g.referencia.toLowerCase().includes(referenciaFilter.toLowerCase()));
        }
        if (itemFilter) {
            filtered = filtered.filter(g => g.item.toLowerCase().includes(itemFilter.toLowerCase()));
        }

        return filtered.sort((a,b) => a.referencia.localeCompare(b.referencia));
    }, [packingOrder.order.details, globalPackingProgress, referenciaFilter, itemFilter]);


    const handleExport = (type: 'general' | 'detailed') => {
        const packedByRefTalla = globalPackingProgress; // Use global progress
        const packedRefs = new Set<string>();
        Object.keys(packedByRefTalla).forEach(key => packedRefs.add(key.split('-')[0]));
    
        const dataToExport = Array.from(packedRefs).map(ref => {
            const orderedTotal = packingOrder.order.details
                .filter(d => (d.referencia || '').toString().trim() === ref)
                .reduce((sum, d) => sum + d.cantidad, 0);
            
            const packedTotal = Object.entries(packedByRefTalla)
                .filter(([key]) => key.startsWith(`${ref}-`))
                .reduce((sum, [, qty]) => sum + qty, 0);
    
            return {
                'Referencia': ref,
                'Pedido': orderedTotal,
                'Leido (Total)': packedTotal,
            };
        });
    
        if (type === 'general') {
            exportToXlsx(dataToExport, `Reporte_General_Pedido_${packingOrder.order.id}`);
        } else { // detailed
            const detailedData = [];
            for (const refData of dataToExport) {
                const ref = refData.Referencia;
                const detailsForRef = packingOrder.order.details.filter(d => (d.referencia || '').toString().trim() === ref);
                for (const detail of detailsForRef) {
                    const talla = (detail.talla || '').toString().trim();
                    const itemKey = createItemKey(ref, talla);
                    const packedQty = packedByRefTalla[itemKey] || 0;
                    const diff = packedQty - detail.cantidad;
                    detailedData.push({
                        'Referencia': ref,
                        'Talla': talla,
                        'Item': detail.item,
                        'Pedido': detail.cantidad,
                        'Leido': packedQty,
                        'Diferencia': diff,
                        'Estado': diff === 0 ? 'Completo' : diff > 0 ? 'Sobrante' : 'Faltante',
                    });
                }
            }
             exportToXlsx(detailedData, `Reporte_Detallado_Pedido_${packingOrder.order.id}`);
        }

        toast({
            title: "Reporte Generado",
            description: `El archivo de Excel se ha descargado.`,
        });
    };

    const getComplianceColor = (compliance: number): string => {
        if (compliance >= 100) return 'text-green-500';
        if (compliance >= 85) return 'text-amber-500';
        return 'text-red-500';
    };

  return (
    <div className="space-y-6">
       <AlertDialog open={overpackAlert.isOpen} onOpenChange={(open) => !open && setOverpackAlert({ isOpen: false, itemKey: '', packed: 0, ordered: 0 })}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center text-red-600">
                        <AlertTriangle className="mr-2 h-8 w-8" />
                        ¡Alerta de Exceso de Empaque!
                    </AlertDialogTitle>
                    <AlertDialogDescription className="text-lg pt-4 text-foreground">
                        Estás a punto de empacar la unidad <strong className="text-2xl">{overpackAlert.packed}</strong> de la referencia <strong className="text-xl">{overpackAlert.itemKey}</strong>, pero solo se pidieron <strong className="text-2xl">{overpackAlert.ordered}</strong>.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogAction onClick={() => setOverpackAlert({ isOpen: false, itemKey: '', packed: 0, ordered: 0 })}>
                        Entendido
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
       </AlertDialog>
        <AlertDialog open={mixedReferenceError?.show} onOpenChange={() => setMixedReferenceError(null)}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center text-destructive">
                        <AlertTriangle className="mr-2 h-8 w-8" />
                        ¡Alerta: Referencia Incorrecta!
                    </AlertDialogTitle>
                    <AlertDialogDescription className="text-lg pt-4 text-foreground">
                        Esta caja es para la referencia <strong className="text-xl text-primary">{mixedReferenceError?.expected}</strong>.
                        <br />
                        No puedes empacar la referencia <strong className="text-xl text-destructive">{mixedReferenceError?.scanned}</strong> aquí.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogAction onClick={() => setMixedReferenceError(null)}>Entendido</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
       <CloseUnitDialog isOpen={isCloseUnitDialogOpen} onOpenChange={setIsCloseUnitDialogOpen} onConfirm={handleCloseUnit} isLoading={isClosingUnit} />
       <PauseDialog isOpen={isPauseDialogOpen} onOpenChange={setIsPauseDialogOpen} onConfirm={handlePause} />
       <UnitContentDialog
                    isOpen={isUnitContentDialogOpen}
                    onOpenChange={setIsUnitContentDialogOpen}
                    unit={selectedUnit}
                    session={session}
                    allPackedItems={allPackedItems}
                    onDeleteItem={handleDeleteItem}
                    onEditItemQuantity={handleEditItemQuantity}
                    onEditItemTalla={handleEditItemTalla}
                    onAddItem={handleAddManualItem}
                    onCloseUnit={handleOpenCloseUnitDialog}
                    onReopenUnit={handleReopenUnit}
                    onDeleteUnit={handleDeleteUnit}
                    role={role}
                />
       <Card>
        <CardHeader className="flex flex-row justify-between items-center flex-wrap gap-4">
          <div>
            <CardTitle>Módulo de Empaque</CardTitle>
            <CardDescription>
                Empacando pedido <span className="font-bold text-primary">{packingOrder.order.id}</span> para <span className="font-bold text-primary">{packingOrder.order.cliente}</span>.
            </CardDescription>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button onClick={onReturnToOrders} variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Volver a Pedidos
            </Button>
            <Button onClick={onReturnToSuite} variant="secondary">
              <LayoutGrid className="mr-2 h-4 w-4" />
              Volver a la Suite
            </Button>
          </div>
        </CardHeader>
      </Card>

      <Tabs defaultValue="operation" className="w-full">
            <TabsList className="grid w-full grid-cols-2 max-w-md mb-4">
                <TabsTrigger value="operation">Operación</TabsTrigger>
                {role === 'admin' && <TabsTrigger value="history">Historial de Unidades</TabsTrigger>}
            </TabsList>

            <TabsContent value="operation" className="space-y-6">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2 space-y-6">
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <ScanLine className="w-6 h-6 text-primary" />
                                    Escanear Código de Barras
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <form onSubmit={handleBarcodeSubmit}>
                                    <Input
                                        ref={barcodeInputRef}
                                        type="text"
                                        defaultValue=""
                                        placeholder={session.status === 'paused' ? "Operación Pausada" : "Esperando escaneo..."}
                                        className="w-full text-center text-lg h-12"
                                        disabled={isLoading || session.status === 'paused'}
                                    />
                                </form>
                            </CardContent>
                        </Card>

                        {lastScan && (
                            <Card className={cn(
                                'border-l-4',
                                lastScan.status === 'success' && 'border-green-500',
                                lastScan.status === 'warning' && 'border-yellow-500',
                                lastScan.status === 'error' && 'border-red-500',
                            )}>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-3">
                                       {lastScan.status === 'success' && <Check className="w-6 h-6 text-green-500" />}
                                       {lastScan.status === 'error' && <AlertTriangle className="w-6 h-6 text-red-500" />}
                                       <span>Último Escaneo</span>
                                    </CardTitle>
                                     <CardDescription>{lastScan.message}</CardDescription>
                                </CardHeader>
                                {lastScan.status === 'success' && lastScan.item && lastScanInfo && (
                                    <CardContent className="space-y-4">
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <p className="text-3xl font-bold text-foreground">{lastScan.item.referencia}</p>
                                                <p className="text-2xl text-muted-foreground">{lastScan.item.talla}</p>
                                            </div>
                                            <div className="text-right">
                                                <Badge variant="outline" className="text-lg py-1 px-3">
                                                    Escaneo: {lastScanInfo.packedGlobal} / {lastScanInfo.ordered}
                                                </Badge>
                                            </div>
                                        </div>
                                        
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                            <StatDisplay title="Pedido (Talla)" value={lastScanInfo.ordered} />
                                            <StatDisplay title="Leído (Talla)" value={lastScanInfo.packedGlobal} />
                                            <StatDisplay title="Mi Conteo" value={lastScanInfo.packedUser} />
                                        </div>

                                        <div className="p-3 bg-muted rounded-lg">
                                            <p className="text-sm font-medium mb-1">Total Referencia {lastScan.item.referencia}</p>
                                            <div className="flex items-center gap-4">
                                                <Progress 
                                                    value={((groupedAndFilteredDetails.find(g => g.referencia === lastScan.item?.referencia)?.sizes && Object.values(groupedAndFilteredDetails.find(g => g.referencia === lastScan.item?.referencia)!.sizes).reduce((sum, s) => sum + s.packed, 0)) || 0) / 
                                                           ((groupedAndFilteredDetails.find(g => g.referencia === lastScan.item?.referencia)?.sizes && Object.values(groupedAndFilteredDetails.find(g => g.referencia === lastScan.item?.referencia)!.sizes).reduce((sum, s) => sum + s.ordered, 0)) || 1) * 100} 
                                                    className="h-2 flex-1" 
                                                />
                                                <span className="text-sm font-bold whitespace-nowrap">
                                                    {Object.values(groupedAndFilteredDetails.find(g => g.referencia === lastScan.item?.referencia)?.sizes || {}).reduce((sum, s) => sum + s.packed, 0)} / {Object.values(groupedAndFilteredDetails.find(g => g.referencia === lastScan.item?.referencia)?.sizes || {}).reduce((sum, s) => sum + s.ordered, 0)}
                                                </span>
                                            </div>
                                        </div>
                                    </CardContent>
                                )}
                            </Card>
                        )}
                        
                        <Card>
                            <CardHeader>
                                <CardTitle>Mi Unidad Activa</CardTitle>
                                <CardDescription>Caja actual abierta para tu sesión.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                {activeUnit ? (
                                    <Card className="border-primary border-2">
                                        <CardHeader className="flex-row justify-between items-center pb-2">
                                            <CardTitle className="text-lg">Unidad #{activeUnit.id}</CardTitle>
                                            <Badge variant={'default'}>Abierta</Badge>
                                        </CardHeader>
                                        <CardContent>
                                            <p className="text-2xl font-bold">
                                                {allPackedItems.filter(i => i.packingUnitId === activeUnit.firestoreId).reduce((sum, item) => sum + item.quantity, 0)} items
                                            </p>
                                        </CardContent>
                                        <CardFooter className="grid grid-cols-2 gap-2">
                                            <Button onClick={() => setIsCloseUnitDialogOpen(true)} disabled={allPackedItems.filter(i => i.packingUnitId === activeUnit.firestoreId).length === 0}>Cerrar Caja</Button>
                                            <Button variant="outline" onClick={() => handleViewUnitContent(activeUnit)}>Ver Contenido</Button>
                                        </CardFooter>
                                    </Card>
                                ) : (
                                    <div className="text-center py-8 bg-muted/20 rounded-lg border-2 border-dashed">
                                        <p className="text-muted-foreground">No tienes una unidad abierta.</p>
                                        <p className="text-xs text-muted-foreground mt-1">Escanea un artículo para crear una automáticamente.</p>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>

                    <div className="space-y-6">
                        <Card className="flex flex-col">
                            <CardHeader>
                                <CardTitle className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Timer className="w-5 h-5 text-primary" />
                                        Productividad
                                    </div>
                                    <Button 
                                        variant="ghost" 
                                        size="sm" 
                                        className="h-8 text-[11px] uppercase tracking-wider flex items-center gap-1"
                                        onClick={() => setIsTimelineDialogOpen(true)}
                                    >
                                        <History className="w-3.5 h-3.5" />
                                        Detalle
                                    </Button>
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex justify-between items-center p-3 bg-muted/50 rounded-md">
                                    <div className="flex flex-col">
                                        <span className="text-sm font-medium text-muted-foreground mr-2">
                                            {user?.uid === (user?.uid || session.packerId) ? 'Items Empacados (Míos)' : `Items Empacados (${session.packerName || 'Operario'})`}
                                        </span>
                                        <div className="flex gap-2">
                                            <Badge variant="outline" className="text-[10px] h-4">
                                                Inició: {productivityStats.userFirstScan ? new Date(productivityStats.userFirstScan).toLocaleTimeString() : 'N/A'}
                                            </Badge>
                                        </div>
                                    </div>
                                    <span className="font-bold text-lg">{totalUserPackedQuantity}</span>
                                </div>
                                <div className="flex justify-between items-center p-3 bg-muted/50 rounded-md">
                                    <span className="text-sm font-medium text-muted-foreground">Tiempo Efectivo</span>
                                    <div className="flex flex-col items-end">
                                        <span className="font-bold font-mono text-green-600">{productivityStats.effectiveWorkTimeFormatted}</span>
                                        {isFetchingPulses && <span className="text-[10px] text-muted-foreground animate-pulse">Cargando pausas...</span>}
                                    </div>
                                </div>
                                <div className="flex justify-between items-center p-3 bg-muted/50 rounded-md">
                                    <span className="text-sm font-medium text-muted-foreground">Unidades/hr</span>
                                    <span className="font-bold">{productivityStats.unitsPerHour}</span>
                                </div>
                                <div className={cn("flex justify-between items-center p-3 rounded-md", getComplianceColor(parseFloat(productivityStats.compliance)).replace('text-', 'bg-') + '/20')}>
                                    <span className="text-sm font-medium text-muted-foreground">Cumplimiento</span>
                                    <span className={cn("font-bold", getComplianceColor(parseFloat(productivityStats.compliance)))}>{productivityStats.compliance}%</span>
                                </div>
                            </CardContent>
                            <CardFooter>
                                {session.status === 'active' ? (
                                    <Button className="w-full" variant="destructive" onClick={() => setIsPauseDialogOpen(true)}>
                                        <Pause className="mr-2 h-4 w-4"/> Pausar
                                    </Button>
                                ) : (
                                    <Button className="w-full" variant="secondary" onClick={handleResume}>
                                        <Play className="mr-2 h-4 w-4"/> Reanudar
                                    </Button>
                                )}
                            </CardFooter>
                        </Card>
                    </div>
                </div>

                <Card>
                    <CardHeader>
                        <div className="flex justify-between items-center flex-wrap gap-4">
                            <div>
                                <CardTitle>Resumen del Pedido</CardTitle>
                                <CardDescription>Consolidado global de empaque.</CardDescription>
                            </div>
                            <div className="flex items-center gap-4 min-w-[300px]">
                                <div className="flex-1">
                                    <div className="flex justify-between text-xs mb-1">
                                        <span>{overallProgress.toFixed(1)}%</span>
                                        <span>{totalPackedGlobal}/{totalOrdered}</span>
                                    </div>
                                    <Progress value={overallProgress} className="h-2" />
                                </div>
                                <div className="flex gap-1">
                                    <Button onClick={() => handleExport('general')} variant="outline" size="sm" title="Excel General"><FileDown className="h-4 w-4" /></Button>
                                    <Button onClick={() => handleExport('detailed')} variant="outline" size="sm" title="Excel Detallado"><FileDown className="h-4 w-4 text-green-600" /></Button>
                                </div>
                            </div>
                        </div>
                        <div className="flex gap-4 pt-4 border-t mt-4">
                            <Input
                                placeholder="Filtrar Referencia..."
                                value={referenciaFilter}
                                onChange={(e) => setReferenciaFilter(e.target.value)}
                                className="max-w-[200px]"
                            />
                            <Input
                                placeholder="Filtrar Item..."
                                value={itemFilter}
                                onChange={(e) => setItemFilter(e.target.value)}
                                className="max-w-[200px]"
                            />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-2">
                            {groupedAndFilteredDetails.map((group) => {
                                const sortedSizes = Object.keys(group.sizes).sort((a,b) => {
                                    const numA = Number(String(a).replace(/[^0-9.]/g, ''));
                                    const numB = Number(String(b).replace(/[^0-9.]/g, ''));
                                    return numA - numB;
                                });
                                const totalOrderedForRef = Object.values(group.sizes).reduce((sum, s) => sum + s.ordered, 0);
                                const totalPackedForRef = Object.values(group.sizes).reduce((sum, s) => sum + s.packed, 0);
                                const isRefComplete = totalPackedForRef === totalOrderedForRef && totalOrderedForRef > 0;
                                const isRefOverpacked = totalPackedForRef > totalOrderedForRef;

                                return (
                                    <div key={`${group.referencia}-${group.item}`} className="p-3 border rounded-lg hover:bg-muted/30 transition-colors">
                                        <div className="flex justify-between items-start mb-2">
                                            <div>
                                                <p className="font-bold text-primary">{group.referencia}</p>
                                                <p className="text-xs text-muted-foreground">{group.item}</p>
                                            </div>
                                            <div className="text-right flex flex-col items-end">
                                                <span className="text-[10px] uppercase font-bold text-muted-foreground mb-0.5 tracking-wider">Total Ref</span>
                                                <div className={cn(
                                                    "font-bold text-sm px-2 py-0.5 rounded-md border inline-flex items-center gap-1",
                                                    isRefOverpacked ? "bg-red-100 text-red-700 border-red-200" :
                                                    isRefComplete ? "bg-green-100 text-green-700 border-green-200" :
                                                    "bg-muted border-transparent text-muted-foreground"
                                                )}>
                                                    <span>{totalPackedForRef}</span>
                                                    <span className="opacity-50 font-normal">/</span>
                                                    <span>{totalOrderedForRef}</span>
                                                    {isRefOverpacked && <AlertTriangle className="h-3 w-3 ml-1" />}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            {sortedSizes.map(talla => {
                                                const { ordered, packed } = group.sizes[talla];
                                                const isOverpacked = packed > ordered;
                                                const isComplete = packed === ordered && ordered > 0;
                                                const isPartial = packed > 0 && packed < ordered;
                                                
                                                const status = isOverpacked 
                                                    ? 'bg-red-600 text-white border-red-800 shadow-sm animate-pulse' 
                                                    : isComplete 
                                                        ? 'bg-green-100 text-green-700 border-green-200' 
                                                        : isPartial 
                                                            ? 'bg-amber-100 text-amber-700 border-amber-200' 
                                                            : 'bg-muted text-muted-foreground border-transparent';
                                                
                                                return (
                                                    <div key={talla} className={cn(
                                                        "px-2 py-1 rounded-md text-xs font-bold flex gap-2 items-center border transition-all", 
                                                        status,
                                                        isOverpacked && "ring-2 ring-red-200"
                                                    )}>
                                                        <span>{talla}</span>
                                                        <span className={cn("px-1.5 py-0.5 rounded-sm bg-white/20 ml-1")}>
                                                            {packed}/{ordered}
                                                        </span>
                                                        {isOverpacked && <AlertTriangle className="h-3 w-3" />}
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </CardContent>
                </Card>
            </TabsContent>

            {role === 'admin' && (
                <TabsContent value="history" className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Seguimiento e Integridad de Unidades</CardTitle>
                            <CardDescription>Consulte el estado de las cajas y limpie registros inconsistentes.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="flex gap-2 mb-6">
                                <Search className="w-5 h-5 text-muted-foreground mt-2" />
                                <Input
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    placeholder="Buscar por referencia, ítem o etiqueta..."
                                    className="flex-1"
                                />
                            </div>

                            <div className="space-y-8">
                                {/* SECTION 1: VALID UNITS */}
                                <div>
                                    <div className="flex items-center gap-2 mb-3">
                                        <Package className="w-5 h-5 text-primary" />
                                        <h3 className="text-lg font-semibold">Seguimiento de Cajas (Válidas)</h3>
                                    </div>
                                    <div className="max-h-[40vh] overflow-y-auto border rounded-md shadow-sm">
                                        <Table>
                                            <TableHeader className="bg-muted/50 sticky top-0 z-10">
                                                <TableRow>
                                                    <TableHead className="w-20">ID</TableHead>
                                                    <TableHead>Etiqueta</TableHead>
                                                    <TableHead>Usuario</TableHead>
                                                    <TableHead>Fecha/Hora</TableHead>
                                                    <TableHead className="text-right">Items</TableHead>
                                                    <TableHead className="text-center">Acción</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {validHistoryResults.length > 0 ? validHistoryResults.map((res, index) => {
                                                    const unitObj = res.unitObject;
                                                    return (
                                                        <TableRow key={res.firestoreId || `unit-${res.unitId}-${index}`}>
                                                            <TableCell className="font-bold">#{res.unitId}</TableCell>
                                                            <TableCell><Badge variant="outline" className="font-mono">{res.unitLabel}</Badge></TableCell>
                                                            <TableCell className="text-sm">
                                                                {unitObj ? (
                                                                    unitObj.createdByName && unitObj.createdByName !== unitObj.createdBy ? unitObj.createdByName : 
                                                                    (unitObj.createdBy === user?.uid ? (contextUserName || user?.displayName || user?.email || 'Mí') : 
                                                                    (unitObj.createdBy === (session as any).packerId ? session.packerName : unitObj.createdBy))
                                                                ) : 'N/A'}
                                                            </TableCell>
                                                            <TableCell className="text-xs text-muted-foreground">
                                                                {unitObj?.createdAt ? new Date(unitObj.createdAt).toLocaleString() : 'N/A'}
                                                            </TableCell>
                                                            <TableCell className="text-right font-medium">{res.totalItems}</TableCell>
                                                            <TableCell className="text-center">
                                                                {unitObj && (
                                                                    <Button variant="ghost" size="sm" onClick={() => handleViewUnitContent(unitObj)}>
                                                                        <Eye className="h-4 w-4" />
                                                                    </Button>
                                                                )}
                                                            </TableCell>
                                                        </TableRow>
                                                    );
                                                }) : (
                                                    <TableRow>
                                                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground italic">
                                                            {searchQuery ? 'No se encontraron cajas que coincidan con la búsqueda.' : 'No hay cajas registradas aún.'}
                                                        </TableCell>
                                                    </TableRow>
                                                )}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </div>

                                {/* SECTION 2: ORPHAN UNITS/INCONSISTENCIES */}
                                {orphanHistoryResults.length > 0 && (
                                    <div className="space-y-4 pt-6 border-t border-destructive/20">
                                        <Alert variant="destructive" className="bg-destructive/5 border-destructive/30">
                                            <AlertTriangle className="h-5 w-5" />
                                            <AlertTitle className="text-destructive font-bold">Inconsistencias Detectadas (Registros Huérfanos)</AlertTitle>
                                            <AlertDescription className="text-sm">
                                                Estos registros corresponden a artículos leídos que han perdido su asociación con una caja física (posiblemente por eliminaciones accidentales o errores de sincronización). **No pertenecen a las cajas mostradas arriba.**
                                            </AlertDescription>
                                        </Alert>
                                        
                                        <div className="max-h-[30vh] overflow-y-auto border rounded-md border-destructive/10 shadow-sm">
                                            <Table>
                                                <TableHeader className="bg-destructive/5 sticky top-0 z-10">
                                                    <TableRow>
                                                        <TableHead className="text-destructive">Estado</TableHead>
                                                        <TableHead>Origen / Descripción</TableHead>
                                                        <TableHead className="text-right">Items</TableHead>
                                                        <TableHead className="text-center">Acción</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {orphanHistoryResults.map((res, index) => (
                                                        <TableRow key={`orphan-${res.firestoreId}-${index}`} className="hover:bg-destructive/5 transition-colors">
                                                            <TableCell><Badge variant="destructive" className="animate-pulse">HUÉRFANO</Badge></TableCell>
                                                            <TableCell className="text-sm font-semibold">{res.unitLabel}</TableCell>
                                                            <TableCell className="text-right font-bold text-destructive text-lg">{res.totalItems}</TableCell>
                                                            <TableCell className="text-center">
                                                                <div className="flex justify-center gap-1">
                                                                    <Button variant="ghost" size="sm" onClick={() => { setOrphanToView({ id: res.firestoreId!, label: res.unitLabel }); setIsOrphanDialogOpen(true); }} title="Ver descripción de items">
                                                                        <Eye className="h-4 w-4" />
                                                                    </Button>

                                                                    {res.unitLabel && res.unitLabel.startsWith('VXM') && (
                                                                        <Button 
                                                                            variant="ghost" 
                                                                            size="sm" 
                                                                            className="h-8 w-8 p-0 text-amber-600 hover:text-amber-700 hover:bg-amber-50" 
                                                                            onClick={() => handleResetLabel(res.unitLabel)} 
                                                                            title="Liberar etiqueta bloqueada"
                                                                        >
                                                                            <Tag className="h-4 w-4" />
                                                                        </Button>
                                                                    )}

                                                                    <Button variant="outline" size="sm" className="h-8 w-8 p-0 text-blue-600 hover:text-blue-700 border-blue-200" onClick={() => handleRecoverOrphan(res.firestoreId!, res.unitLabel)} title="Recuperar como nueva unidad">
                                                                        <ArchiveRestore className="h-4 w-4" />
                                                                    </Button>

                                                                    <AlertDialog>
                                                                        <AlertDialogTrigger asChild>
                                                                            <Button variant="destructive" size="sm" className="h-8 w-8 p-0" title="Limpiar registros huérfanos">
                                                                                <Trash2 className="h-4 w-4" />
                                                                            </Button>
                                                                        </AlertDialogTrigger>
                                                                        <AlertDialogContent>
                                                                            <AlertDialogHeader>
                                                                                <AlertDialogTitle className="text-destructive flex items-center gap-2">
                                                                                    <AlertTriangle className="h-6 w-6" />
                                                                                    Confirmar Limpieza Definitiva
                                                                                </AlertDialogTitle>
                                                                                <AlertDialogDescription>
                                                                                    Estás a punto de borrar los registros de <strong className="text-foreground">{res.totalItems}</strong> ítems que NO tienen caja física asociada. 
                                                                                    <br /><br />
                                                                                    <span className="font-bold text-destructive">ADVERTENCIA:</span> Esta acción restará estas unidades del total leído del pedido y no se puede deshacer. Solo proceda si está seguro de que estos artículos no están empacados en ninguna de las cajas válidas de arriba.
                                                                                </AlertDialogDescription>
                                                                            </AlertDialogHeader>
                                                                            <AlertDialogFooter>
                                                                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                                                                <AlertDialogAction onClick={() => handleCleanupOrphans(res.firestoreId!)} className="bg-destructive text-white hover:bg-destructive/90">
                                                                                    Sí, Limpiar Registros
                                                                                </AlertDialogAction>
                                                                            </AlertDialogFooter>
                                                                        </AlertDialogContent>
                                                                    </AlertDialog>
                                                                </div>
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        </div>
                                    </div>
                                )}

                                {/* SECTION 3: EMERGENCY TOOLS */}
                                <div className="mt-8 pt-6 border-t border-muted">
                                    <div className="flex items-center gap-2 mb-3">
                                        <Tag className="w-5 h-5 text-amber-500" />
                                        <h3 className="text-lg font-semibold text-amber-900">Herramientas de Emergencia (Etiquetas)</h3>
                                    </div>
                                    <p className="text-sm text-muted-foreground mb-4 max-w-2xl">
                                        Si una etiqueta aparece como <strong>"Ya utilizada"</strong> pero la caja no figura en el seguimiento superior, ingrese el código de barras aquí para desbloquearla manualmente.
                                    </p>
                                    <div className="flex gap-2 max-w-md">
                                        <Input 
                                            value={manualLabelToRelease}
                                            onChange={(e) => setManualLabelToRelease(e.target.value.toUpperCase())}
                                            placeholder="Ej: VXM-0000..."
                                            className="font-mono uppercase bg-amber-50/30 border-amber-200"
                                        />
                                        <Button 
                                            variant="outline" 
                                            className="text-amber-600 border-amber-200 hover:bg-amber-100 whitespace-nowrap"
                                            onClick={() => {
                                                handleResetLabel(manualLabelToRelease);
                                                setManualLabelToRelease('');
                                            }}
                                            disabled={manualLabelToRelease.length < 5 || isLoading}
                                        >
                                            Liberar Etiqueta
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Vista de Tarjetas de Unidades</CardTitle>
                            <CardDescription>Resumen visual por caja.</CardDescription>
                        </CardHeader>
                        <CardContent>
                             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {session.units.sort((a,b) => b.id - a.id).map(unit => {
                                    const itemsCount = allPackedItems.filter(i => i.packingUnitId === unit.firestoreId).reduce((sum, item) => sum + item.quantity, 0);
                                    return (
                                        <Card key={unit.id} className="cursor-pointer hover:border-primary transition-colors" onClick={() => handleViewUnitContent(unit)}>
                                            <CardHeader className="p-4 pb-2 flex-row justify-between items-center">
                                                <CardTitle className="text-md">Unidad #{unit.id}</CardTitle>
                                                <Badge variant={unit.status === 'open' ? 'default' : 'secondary'}>{unit.status}</Badge>
                                            </CardHeader>
                                            <CardContent className="p-4 pt-0">
                                                <p className="text-sm text-muted-foreground font-mono">{unit.labelBarcode || 'Sin etiqueta'}</p>
                                                <div className="flex justify-between items-end mt-2">
                                                    <p className="text-lg font-bold">{itemsCount} items</p>
                                                    <div className="text-right">
                                                        <p className="text-[10px] font-medium text-primary uppercase">
                                                            {unit.createdByName && unit.createdByName !== unit.createdBy ? unit.createdByName : 
                                                            (unit.createdBy === user?.uid ? (contextUserName || user?.displayName || 'Mí') : 'Usuario')}
                                                        </p>
                                                        {unit.createdAt && <p className="text-[9px] text-muted-foreground">{new Date(unit.createdAt).toLocaleString()}</p>}
                                                    </div>
                                                </div>
                                                {unit.closed_at && <p className="text-[10px] text-muted-foreground mt-1 border-t pt-1 italic">Cerrada: {new Date(unit.closed_at).toLocaleString()}</p>}
                                            </CardContent>
                                        </Card>
                                    );
                                })}
                             </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            )}
        </Tabs>

        <TimelineDialog 
            isOpen={isTimelineDialogOpen}
            onOpenChange={setIsTimelineDialogOpen}
            stats={productivityStats}
            session={session}
        />
    </div>
  );
};

const TimelineDialog: React.FC<{
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    stats: any;
    session: PackingSession;
}> = ({ isOpen, onOpenChange, stats, session }) => {
    const sortedTimeline = useMemo(() => {
        if (!stats.userFirstScan) return [];
        
        const events: { time: number, type: string, label: string, color: string }[] = [];
        
        // Start Work
        events.push({ 
            time: stats.userFirstScan, 
            type: 'start', 
            label: 'Inicio de Actividad',
            color: 'bg-green-500'
        });

        // Pauses from session
        session.pauses.forEach(p => {
            if (p.userId === stats.targetPackerId) {
                const startTime = new Date(p.startTime).getTime();
                if (startTime >= stats.userFirstScan) {
                    events.push({ 
                        time: startTime, 
                        type: 'pause_start', 
                        label: `Pausa: ${pauseReasonLabels[p.reason as PauseReason] || p.reason}`,
                        color: 'bg-amber-500'
                    });
                    if (p.endTime) {
                        events.push({ 
                            time: new Date(p.endTime).getTime(), 
                            type: 'pause_end', 
                            label: 'Reanudación',
                            color: 'bg-blue-500'
                        });
                    }
                }
            }
        });

        // Pulses (Global or User)
        stats.relevantPulses.forEach((p: any) => {
            const pulseStart = p.startTime instanceof Date ? p.startTime.getTime() : p.startTime.toDate().getTime();
            // ONLY show pulses that happened after the first scan
            if (pulseStart >= stats.userFirstScan) {
                events.push({ 
                    time: pulseStart, 
                    type: 'pulse_start', 
                    label: `Estado Suite: ${p.status} ${p.reason ? `(${p.reason})` : ''}`,
                    color: 'bg-indigo-500'
                });
                if (p.endTime) {
                    const pulseEnd = p.endTime instanceof Date ? p.endTime.getTime() : p.endTime.toDate().getTime();
                    events.push({ 
                        time: pulseEnd, 
                        type: 'pulse_end', 
                        label: 'Fin Estado Suite',
                        color: 'bg-slate-500'
                    });
                }
            }
        });

        // Deduplicate events that happen at the same time and have same label
        return events
            .sort((a,b) => a.time - b.time)
            .filter((e, idx, self) => 
                idx === 0 || !(e.time === self[idx-1].time && e.label === self[idx-1].label)
            );
    }, [stats, session.pauses]);

    const formatTime = (time: number) => new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl sm:max-h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <History className="w-5 h-5 text-primary" />
                        Línea de Tiempo de Productividad
                    </DialogTitle>
                    <DialogDescription>
                        Desglose detallado de la jornada para {stats.targetPackerName || 'el operario'}.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-grow overflow-y-auto pr-2 my-4">
                    {sortedTimeline.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">No hay eventos registrados.</div>
                    ) : (
                        <div className="relative pl-6 border-l border-muted space-y-6 ml-4 mt-2">
                            {sortedTimeline.map((item, idx) => (
                                <div key={idx} className="relative">
                                    <div className={cn("absolute -left-[31px] top-1 w-[12px] h-[12px] rounded-full border-2 border-background", item.color)} />
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <p className="text-sm font-bold leading-tight">{item.label}</p>
                                            <p className="text-[11px] text-muted-foreground">{new Date(item.time).toLocaleDateString()}</p>
                                        </div>
                                        <Badge variant="secondary" className="font-mono text-xs">{formatTime(item.time)}</Badge>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-2 gap-4 mt-4 p-4 bg-secondary rounded-lg">
                    <div>
                        <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Tiempo Efectivo</p>
                        <p className="text-xl font-bold font-mono text-green-600">{stats.effectiveWorkTimeFormatted}</p>
                    </div>
                    <div>
                        <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Total Pausas</p>
                        <p className="text-xl font-bold font-mono text-amber-600">
                            {Math.floor(stats.totalPauseMs / 60000)}m {(Math.floor(stats.totalPauseMs / 1000) % 60)}s
                        </p>
                    </div>
                </div>

                <DialogFooter className="mt-4">
                    <Button onClick={() => onOpenChange(false)}>Cerrar</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const StatDisplay: React.FC<{title: string, value: string | number, variant?: 'default' | 'success'}> = ({ title, value, variant='default' }) => (
    <div className={cn("rounded-lg p-4 text-center", variant === 'success' ? 'bg-green-500/10' : 'bg-secondary')}>
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <p className={cn("text-4xl font-bold", variant === 'success' ? 'text-green-600' : 'text-foreground')}>{value}</p>
    </div>
);

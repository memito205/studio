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
import { validateLabel, markLabelAsUsed, savePackingSession, updateOrderStatus, addPackedItem, getPackedItemsForOrder, deletePackedItem, updatePackedItem, createPackingUnit, lookupBarcode, getUserPulsesForDay, bulkDeletePackedItems, revertLabelStatus } from '@/app/actions';
import { useSuitePulse } from '@/hooks/useSuitePulse';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { exportToXlsx } from '@/services/export';
import { useToast } from '@/hooks/use-toast';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from '@/components/ui/carousel';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/use-auth-context'; // Import useAuth hook
import { UnitContentDialog } from './UnitContentDialog';

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
    onConfirm: (reason: PauseReason) => void;
}> = ({ isOpen, onOpenChange, onConfirm }) => {
    const [reason, setReason] = useState<PauseReason | ''>('');

    const handleConfirm = () => {
        if (reason) {
            onConfirm(reason);
            setReason('');
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Pausar Operación</DialogTitle>
                    <DialogDescription>Seleccione el motivo de la pausa. El tiempo se registrará.</DialogDescription>
                </DialogHeader>
                <div className="py-4">
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
                <DialogFooter>
                    <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button onClick={handleConfirm} disabled={!reason}>Confirmar Pausa</Button>
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
    unitObject: PackingUnit; // Pass the whole unit object for the detail view
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
    const { user } = useAuth(); // Get current user
    const [session, setSession] = useState<PackingSession>(() => ({
        ...initialSession,
        units: initialSession.units || [],
        pauses: initialSession.pauses || [],
        status: initialSession.status || 'active',
    }));
    
    const [allPackedItems, setAllPackedItems] = useState<PackedItem[]>([]);
    const [lastScan, setLastScan] = React.useState<PackingScanResult | null>(null);
    const [isLoading, setIsLoading] = React.useState(false);
    const [isClosingUnit, setIsClosingUnit] = useState(false);
    const [isCloseUnitDialogOpen, setIsCloseUnitDialogOpen] = useState(false);
    const [isUnitContentDialogOpen, setIsUnitContentDialogOpen] = useState(false);
    const [isPauseDialogOpen, setIsPauseDialogOpen] = useState(false);
    const [selectedUnit, setSelectedUnit] = useState<PackingUnit | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [referenciaFilter, setReferenciaFilter] = useState('');
    const [itemFilter, setItemFilter] = useState('');
    const barcodeInputRef = React.useRef<HTMLInputElement>(null);
    const [overpackAlert, setOverpackAlert] = useState<OverpackAlertState>({ isOpen: false, itemKey: '', packed: 0, ordered: 0 });
    const [mixedReferenceError, setMixedReferenceError] = useState<{ show: boolean, expected: string, scanned: string } | null>(null);
    const [externalPulses, setExternalPulses] = useState<OperationPulse[]>([]);
    const { isPaused, currentPulse, globalPulse, allPulses } = useSuitePulse();
    
    // State for productivity timer
    const [elapsedTime, setElapsedTime] = useState(0);
    
    const fetchPackedItems = useCallback(async () => {
        const result = await getPackedItemsForOrder(packingOrder.order.id);
        if(result.data){
            setAllPackedItems(result.data);
        } else {
            toast({ variant: "destructive", title: "Error", description: "No se pudieron cargar los ítems empacados." });
        }
    }, [packingOrder.order.id, toast]);

    useEffect(() => {
        if (!session.startTime) {
            const now = new Date();
            const updatedSession = { ...session, startTime: now };
            setSession(updatedSession);
            onSessionChange(updatedSession);
        }
    }, [session.startTime, onSessionChange]);

    useEffect(() => {
        fetchPackedItems();
    }, [fetchPackedItems]);


    useEffect(() => {
        onSessionChange(session);
    }, [session, onSessionChange]);

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
    
    // Timer effect now depends on user-specific first scan time
    useEffect(() => {
        let timer: NodeJS.Timeout;
        const userFirstScanTime = session.units
            .filter(u => u.createdBy === user?.uid && u.createdAt)
            .map(u => new Date(u.createdAt!).getTime())
            .filter(t => !isNaN(t))
            .sort((a,b)=>a-b)[0];
            
        if (userFirstScanTime) {
            timer = setInterval(() => {
                setElapsedTime(Date.now() - userFirstScanTime);
            }, 1000);
        }
        return () => clearInterval(timer);
    }, [session.units, user?.uid]);


    const userPackingProgress = useMemo(() => {
        if (!user) return {};
        const progress: { [key: string]: number } = {};
        allPackedItems
            .filter(item => item.packerId === user.uid)
            .forEach(item => {
                progress[item.itemKey] = (progress[item.itemKey] || 0) + item.quantity;
            });
        return progress;
    }, [allPackedItems, user]);

    const globalPackingProgress = useMemo(() => {
        const progress: { [key: string]: number } = {};
        allPackedItems.forEach(item => {
            progress[item.itemKey] = (progress[item.itemKey] || 0) + item.quantity;
        });
        return progress;
    }, [allPackedItems]);
    
    const totalUserPackedQuantity = useMemo(() => {
        if (!user) return 0;
        return allPackedItems
            .filter(item => item.packerId === user.uid)
            .reduce((total, item) => total + item.quantity, 0);
    }, [allPackedItems, user]);


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
                const packedQty = globalPackingProgress[itemKey] || 0;

                if (packedQty + 1 > orderedQty) {
                    setOverpackAlert({ isOpen: true, itemKey, packed: packedQty + 1, ordered: orderedQty });
                }

                let unitToUse = activeUnit;
                if (!unitToUse) {
                    const newUnitResult = await createPackingUnit(session.orderId, user.uid);
                    if (newUnitResult.success && newUnitResult.newUnit) {
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
                    const firstItemKey = itemsInActiveUnit[0].itemKey;
                    const expectedReference = firstItemKey.split('-')[0];
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

    const handlePause = (reason: PauseReason) => {
        if (!user) return;
        setSession(prev => {
            const now = new Date();
            const newPauses = [...(prev.pauses || [])];
            const newPause: PackingPause = { startTime: now, reason, userId: user.uid };
            newPauses.push(newPause);
            return { ...prev, status: 'paused', pauses: newPauses, lastActivity: now };
        });
        setIsPauseDialogOpen(false);
    };

    const handleResume = () => {
        if (!user) return;
        setSession(prev => {
            const now = new Date();
            const lastPause = prev.pauses?.slice().reverse().find(p => p.userId === user.uid && !p.endTime);
            if (lastPause) {
                lastPause.endTime = now;
            }
            return { ...prev, status: 'active', lastActivity: now };
        });
    };
    
    const handleCloseUnit = async (scannedLabel: string) => {
        if (!activeUnit) return;
        setIsClosingUnit(true);

        // Integration: Real validation would happen here. For now, mocking success.
        const validationResult: LabelValidationResult = { isValid: true, label: { id: scannedLabel } as PreprintedLabel };

        if (!validationResult.isValid) {
            const errorMsg = (validationResult as any).message || 'Etiqueta no válida';
            toast({ variant: 'destructive', title: 'Error', description: errorMsg });
            setIsClosingUnit(false);
            return;
        }
        
        const validLabelId = validationResult.label.id;
        // const markUsedResult = await markLabelAsUsed(validLabelId, activeUnit.id, session.packerName);
        // if(!markUsedResult.success){
        //     toast({ variant: 'destructive', title: 'Error al actualizar etiqueta', description: markUsedResult.error });
        //     setIsClosingUnit(false);
        //     return;
        // }

        setSession(prev => {
            const newUnits = prev.units.map(u => 
                u.id === activeUnit?.id 
                ? { ...u, status: 'closed' as 'closed', labelBarcode: validLabelId, closedAt: new Date().toISOString() }
                : u
            );
            return { ...prev, units: newUnits };
        });

        setIsClosingUnit(false);
        setIsCloseUnitDialogOpen(false);
    };


    const handleViewUnitContent = (unit: PackingUnit) => {
        setSelectedUnit(unit);
        setIsUnitContentDialogOpen(true);
    };
    
    const handleDeleteUnit = async (unitIdToDelete: number) => {
        const unitToDelete = session.units.find(u => u.id === unitIdToDelete);
      
        const newUnits = session.units.filter(u => u.id !== unitIdToDelete);
        const newSessionState = { ...session, units: newUnits };
    
        // Update UI immediately
        setSession(newSessionState);
    
        // Perform DB operations
        if (unitToDelete?.labelBarcode) {
            await revertLabelStatus(unitToDelete.labelBarcode);
        }
    
        const saveResult = await savePackingSession(newSessionState);
    
        if (saveResult.success) {
            // Also delete all packedItems associated with this unit
            const itemsToDelete = allPackedItems.filter(item => item.packingUnitId === unitToDelete?.firestoreId).map(item => item.id);
            if (itemsToDelete.length > 0) {
                await bulkDeletePackedItems(itemsToDelete);
            }
            fetchPackedItems(); // Refresh data
            toast({ title: 'Unidad Eliminada', description: `La unidad #${unitIdToDelete} ha sido eliminada.` });
            setIsUnitContentDialogOpen(false); // Close dialog if open
        } else {
            toast({ variant: "destructive", title: "Error de Guardado", description: `No se pudo guardar la eliminación: ${saveResult.error}. Refrescando datos para evitar inconsistencias.` });
            setSession(prev => ({...prev, units: session.units}));
        }
    };
    
    const handleDeleteItem = async (unitId: number, itemKey: string) => {
        const unit = session.units.find(u => u.id === unitId);
        if (!unit) return;
        
        const itemToDelete = allPackedItems.find(item => item.packingUnitId === unit.firestoreId && item.itemKey === itemKey);
        if (itemToDelete) {
            const result = await deletePackedItem(itemToDelete.id);
            if (result.success) {
                fetchPackedItems();
                toast({ title: 'Ítem Eliminado', description: 'El ítem fue eliminado de la caja.' });
            } else {
                toast({ variant: 'destructive', title: 'Error de Borrado', description: result.error });
            }
        }
    };

    const handleEditItemQuantity = async (unitId: number, itemKey: string, newQuantity: number) => {
        const unit = session.units.find(u => u.id === unitId);
        if (!unit) return;

        // Find all packed items for this unit and itemKey
        const itemsToUpdate = allPackedItems.filter(i => i.packingUnitId === unit.firestoreId && i.itemKey === itemKey);
        
        if (newQuantity > 0) {
            // In this specific system, we might have multiple PackedItem docs for the same itemKey.
            // Simplified: we update the first one's quantity to match the total requested, 
            // or we adjust across all of them. Usually, there's only one entry per itemKey per box.
            if (itemsToUpdate.length > 0) {
                const totalCurrent = itemsToUpdate.reduce((sum, i) => sum + i.quantity, 0);
                if (totalCurrent === newQuantity) return;

                // For simplicity, we'll update the first one and delete the rest, or just adjust the first one.
                const firstItem = itemsToUpdate[0];
                const result = await updatePackedItem(firstItem.id, { quantity: newQuantity });
                
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
        const oldTalla = firstItem.item?.talla || firstItem.item?.size || '';
        if (oldTalla.trim().toLowerCase() === newTalla.trim().toLowerCase()) return;

        // Calculate new itemKey
        const reference = firstItem.item?.referencia || firstItem.item?.reference || '';
        const newItemKey = createItemKey(reference, newTalla);

        setIsLoading(true);
        try {
            for (const item of itemsToUpdate) {
                const updatedItemData = { 
                    ...item.item,
                    talla: newTalla,
                    size: newTalla // ensure both are updated
                } as ProductDatabaseItem;

                await updatePackedItem(item.id, { 
                    itemKey: newItemKey,
                    item: updatedItemData
                });
            }
            toast({ title: 'Talla Actualizada', description: `Se cambió de ${oldTalla} a ${newTalla}` });
            fetchPackedItems();
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
                    return { ...u, status: 'open' as 'open', labelBarcode: undefined, closedAt: undefined };
                }
                return u;
            });
            return { ...prev, units: newUnits };
        });
        toast({ title: 'Unidad Reabierta', description: `La unidad #${unitIdToReopen} está abierta para edición.` });
        setIsUnitContentDialogOpen(false); // Close the dialog
    };

    const searchResults = useMemo((): UnitSummarySearchResult[] => {
        if (!searchQuery.trim()) return [];
        const query = searchQuery.toLowerCase();
        const resultsMap = new Map<number, UnitSummarySearchResult>();

        session.units.forEach(unit => {
            let unitContainsQueryItem = false;
            const itemsInUnit = allPackedItems.filter(p => p.packingUnitId === unit.firestoreId);

            for (const packedItem of itemsInUnit) {
                const [ref, talla] = packedItem.itemKey.split('-');
                 if (ref.toLowerCase().includes(query)) {
                    unitContainsQueryItem = true;
                    break;
                }
            }


            if (unitContainsQueryItem) {
                const totalItemsInUnit = itemsInUnit.reduce((sum, item) => sum + item.quantity, 0);
                resultsMap.set(unit.id, {
                    unitId: unit.id,
                    unitLabel: unit.labelBarcode || (unit.status === 'open' ? 'Abierta' : 'Sin Etiqueta'),
                    totalItems: totalItemsInUnit,
                    unitObject: unit,
                });
            }
        });
        return Array.from(resultsMap.values()).sort((a,b) => a.unitId - b.unitId);
    }, [searchQuery, session.units, allPackedItems]);
    
    const totalOrdered = useMemo(() => packingOrder.order.details.reduce((sum, detail) => sum + detail.cantidad, 0), [packingOrder.order.details]);
    const totalPackedGlobal = useMemo(() => Object.values(globalPackingProgress).reduce((sum, count) => sum + count, 0), [globalPackingProgress]);
    const overallProgress = totalOrdered > 0 ? (totalPackedGlobal / totalOrdered) * 100 : 0;
    
    const productivityStats = useMemo(() => {
        if (!user) return { totalElapsedTimeFormatted: '00:00:00', effectiveWorkTimeFormatted: '00:00:00', unitsPerHour: '0.0', compliance: '0.0' };
        
        const userFirstScan = session.units
            .filter(u => u.createdBy === user.uid && u.createdAt)
            .map(u => new Date(u.createdAt!).getTime())
            .filter(t => !isNaN(t))
            .sort((a,b)=>a-b)[0];
            
        if (!userFirstScan) return { totalElapsedTimeFormatted: '00:00:00', effectiveWorkTimeFormatted: '00:00:00', unitsPerHour: '0.0', compliance: '0.0' };
        
        const now = Date.now();
        const totalElapsedTimeMs = now - userFirstScan;
        
        // 1. Collect all pause intervals
        const activePulseFromContext = globalPulse || currentPulse;
        const rawIntervals = [
            ...session.pauses.map(p => ({ start: new Date(p.startTime).getTime(), end: p.endTime ? new Date(p.endTime).getTime() : now })),
            ...allPulses.map(p => ({ start: new Date(p.startTime).getTime(), end: p.endTime ? new Date(p.endTime).getTime() : now }))
        ];

        // Explicitly add the current active pulse interval if we are paused
        if (isPaused && activePulseFromContext) {
            rawIntervals.push({
                start: activePulseFromContext.startTime.getTime(),
                end: now
            });
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

        return {
            totalElapsedTimeFormatted: formatElapsedTime(totalElapsedTimeMs),
            effectiveWorkTimeFormatted: formatElapsedTime(effectiveWorkTimeMs),
            unitsPerHour: unitsPerHour.toFixed(1),
            compliance: compliance.toFixed(1),
        };
    }, [session, user, totalUserPackedQuantity, productivityGoal, elapsedTime]);

    const lastScanInfo = useMemo(() => {
        if (lastScan?.status === 'success' && lastScan.item) {
            const itemKey = createItemKey(lastScan.item.referencia, lastScan.item.talla);
            const detail = packingOrder.order.details.find(d => 
                (d.referencia || '').toString().trim() === (lastScan.item?.referencia || '').toString().trim() && 
                (d.talla || '').toString().trim() === (lastScan.item?.talla || '').toString().trim()
            );
            const ordered = detail?.cantidad || 0;
            const packed = userPackingProgress[itemKey] || 0;
            return { ordered, packed, remaining: ordered - packed };
        }
        return null;
    }, [lastScan, userPackingProgress, packingOrder.order.details]);
    
    const groupedAndFilteredDetails = useMemo(() => {
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
        
        let filtered = Object.values(grouped);
        
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
             unit={selectedUnit}
             session={session}
             isOpen={isUnitContentDialogOpen}
             onOpenChange={setIsUnitContentDialogOpen}
             onDeleteItem={handleDeleteItem}
             onEditItemQuantity={handleEditItemQuantity}
             onEditItemTalla={handleEditItemTalla}
             onReopenUnit={handleReopenUnit}
             onDeleteUnit={handleDeleteUnit}
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
            <Button onClick={() => handleExport('general')} variant="outline">
              <FileDown className="mr-2 h-4 w-4" />
              Exportar General
            </Button>
             <Button onClick={() => handleExport('detailed')} variant="outline">
              <FileDown className="mr-2 h-4 w-4" />
              Exportar Detallado
            </Button>
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
        <CardContent>
            <div className="space-y-2">
                <div className="flex justify-between text-sm font-medium text-muted-foreground">
                    <span>Progreso General del Pedido ({overallProgress.toFixed(1)}%)</span>
                    <span>Total Empacado: {totalPackedGlobal} / {totalOrdered}</span>
                </div>
                <Progress value={overallProgress} />
            </div>
        </CardContent>
      </Card>
      
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
                        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="col-span-1 md:col-span-3">
                                <p className="text-3xl font-bold text-foreground">{lastScan.item.referencia}</p>
                                <p className="text-2xl text-muted-foreground">{lastScan.item.talla}</p>
                            </div>
                            <StatDisplay title="Pedido" value={lastScanInfo.ordered} />
                            <StatDisplay title="Mi Conteo" value={lastScanInfo.packed} />
                            <StatDisplay title="Faltante" value={lastScanInfo.remaining} variant={lastScanInfo.remaining === 0 ? 'success' : 'default'} />
                        </CardContent>
                    )}
                </Card>
            )}
        </div>

        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
                <Timer className="w-6 h-6" />
                Mi Productividad
            </CardTitle>
             <CardDescription>Métricas de rendimiento para tu sesión en este pedido.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 flex-grow">
             <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Meta de Productividad</p>
                <p className="text-lg font-semibold">{productivityGoal} <span className="text-sm font-normal text-muted-foreground">u/hr</span></p>
            </div>
            <div className="flex justify-between items-center p-3 bg-muted/50 rounded-md">
                <span className="font-medium text-muted-foreground">Tiempo Total</span>
                <span className="font-bold text-lg font-mono">{productivityStats.totalElapsedTimeFormatted}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-muted/50 rounded-md">
                <span className="font-medium text-muted-foreground">Tiempo Efectivo</span>
                <span className="font-bold text-lg font-mono text-green-600">{productivityStats.effectiveWorkTimeFormatted}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-muted/50 rounded-md">
                <span className="font-medium text-muted-foreground">Mi Productividad</span>
                <span className="font-bold text-lg">{productivityStats.unitsPerHour} <span className="text-sm font-normal text-muted-foreground">u/hr</span></span>
            </div>
            <div className={cn("flex justify-between items-center p-3 rounded-md", getComplianceColor(parseFloat(productivityStats.compliance)).replace('text-', 'bg-') + '/20')}>
                <span className="font-medium text-muted-foreground flex items-center gap-2"><Trophy /> Mi Cumplimiento</span>
                <span className={cn("font-bold text-lg", getComplianceColor(parseFloat(productivityStats.compliance)))}>{productivityStats.compliance}%</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-muted/50 rounded-md">
                <span className="font-medium text-muted-foreground">Mis Unidades</span>
                <span className="font-bold text-lg">{totalUserPackedQuantity}</span>
            </div>
          </CardContent>
           <CardFooter>
            {session.status === 'active' ? (
                <Button className="w-full" variant="destructive" onClick={() => setIsPauseDialogOpen(true)} disabled={!session.startTime}>
                    <Pause className="mr-2"/> Pausar Operación
                </Button>
            ) : (
                 <Button className="w-full" variant="secondary" onClick={handleResume} disabled={!session.startTime}>
                    <Play className="mr-2"/> Reanudar Operación
                </Button>
            )}
           </CardFooter>
        </Card>
      </div>

       <Card>
        <CardHeader>
          <CardTitle>Mi Unidad de Empaque Activa</CardTitle>
           <CardDescription>Aquí se muestra la caja que tienes actualmente abierta.</CardDescription>
        </CardHeader>
        <CardContent>
            {activeUnit ? (
                <div className="p-1 h-full">
                    <Card className="flex flex-col h-full border-primary border-2">
                        <CardHeader className="flex-row justify-between items-center">
                            <CardTitle className="text-lg">Mi Unidad #{activeUnit.id}</CardTitle>
                            <Badge variant={'default'}>
                                Abierta
                            </Badge>
                        </CardHeader>
                        <CardContent className="flex-grow space-y-3">
                                <p>Items: <span className="font-bold">{allPackedItems.filter(i => i.packingUnitId === activeUnit.firestoreId).reduce((sum, item) => sum + item.quantity, 0)}</span></p>
                        </CardContent>
                        <CardFooter className="mt-auto grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <Button className="w-full" onClick={() => setIsCloseUnitDialogOpen(true)} disabled={allPackedItems.filter(i => i.packingUnitId === activeUnit.firestoreId).length === 0}>Cerrar Unidad</Button>
                            <Button className="w-full" variant="outline" onClick={() => handleViewUnitContent(activeUnit)}>Ver Contenido</Button>
                        </CardFooter>
                    </Card>
                </div>
            ) : (
               <p className="text-muted-foreground text-center col-span-full py-8">Aún no has creado una unidad. Escanea un artículo para comenzar.</p>
           )}
        </CardContent>
       </Card>

         <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <History className="w-6 h-6 text-primary" />
                    Historial de Unidades del Pedido
                </CardTitle>
                <CardDescription>Todas las cajas creadas para este pedido.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="max-h-80 overflow-y-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>ID</TableHead>
                                <TableHead>Estado</TableHead>
                                <TableHead>Etiqueta</TableHead>
                                <TableHead className="text-right">Items</TableHead>
                                <TableHead className="text-center">Acciones</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {[...session.units].sort((a,b) => b.id - a.id).map((unit) => {
                                const unitItems = allPackedItems.filter(i => i.packingUnitId === unit.firestoreId);
                                const totalQty = unitItems.reduce((sum, i) => sum + i.quantity, 0);
                                return (
                                    <TableRow key={unit.firestoreId}>
                                        <TableCell className="font-bold">#{unit.id}</TableCell>
                                        <TableCell>
                                            <Badge variant={unit.status === 'open' ? 'default' : 'secondary'}>
                                                {unit.status === 'open' ? 'Abierta' : 'Cerrada'}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="font-mono text-xs">{unit.labelBarcode || '-'}</TableCell>
                                        <TableCell className="text-right font-bold">{totalQty}</TableCell>
                                        <TableCell className="text-center space-x-2">
                                            <Button variant="outline" size="sm" onClick={() => handleViewUnitContent(unit)}>
                                                <Eye className="mr-2 h-4 w-4" /> Ver/Editar
                                            </Button>
                                            <AlertDialog>
                                                <AlertDialogTrigger asChild>
                                                    <Button variant="destructive" size="sm">
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </AlertDialogTrigger>
                                                <AlertDialogContent>
                                                    <AlertDialogHeader>
                                                        <AlertDialogTitle>¿Eliminar Unidad #{unit.id}?</AlertDialogTitle>
                                                        <AlertDialogDescription>Esta acción borrará la caja y todos sus productos de forma permanente.</AlertDialogDescription>
                                                    </AlertDialogHeader>
                                                    <AlertDialogFooter>
                                                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                                        <AlertDialogAction onClick={() => handleDeleteUnit(unit.id)}>Eliminar</AlertDialogAction>
                                                    </AlertDialogFooter>
                                                </AlertDialogContent>
                                            </AlertDialog>
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                            {session.units.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">No hay unidades creadas aún.</TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>

        <Card>
            <CardHeader>
                <CardTitle>Búsqueda de Artículos en Unidades</CardTitle>
                <CardDescription>Encuentre rápidamente en qué caja se empacó un artículo (incluye todas las cajas del pedido).</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="flex gap-2 mb-4">
                    <Search className="w-5 h-5 text-muted-foreground mt-2" />
                    <Input
                        type="text"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="Buscar por referencia o item..."
                        className="w-full"
                    />
                </div>

                <div className="max-h-60 overflow-y-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Unidad ID</TableHead>
                                <TableHead>Etiqueta Unidad</TableHead>
                                <TableHead className="text-right">Items Totales en Caja</TableHead>
                                <TableHead className="text-center">Acciones de Caja</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {searchResults.map((result, index) => (
                                <TableRow key={index}>
                                    <TableCell className="font-medium">{result.unitId}</TableCell>
                                    <TableCell>{result.unitLabel}</TableCell>
                                    <TableCell className="text-right font-bold">{result.totalItems}</TableCell>
                                    <TableCell className="text-center">
                                        <Button variant="outline" size="sm" className="mr-2" onClick={() => handleViewUnitContent(result.unitObject)}>
                                            <Eye className="mr-2 h-4 w-4" />
                                            Ver/Editar
                                        </Button>
                                         <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button variant="destructive" size="sm">
                                                    <Trash2 className="mr-2 h-4 w-4" />
                                                    Eliminar
                                                </Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader>
                                                <AlertDialogTitle>¿Está seguro?</AlertDialogTitle>
                                                <AlertDialogDescription>
                                                    Esta acción eliminará permanentemente la Unidad #{result.unitId} y todos sus artículos. No se puede deshacer.
                                                </AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                                <AlertDialogAction onClick={() => handleDeleteUnit(result.unitId)}>Eliminar</AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    </TableCell>
                                </TableRow>
                            ))}
                             {searchQuery.trim() && searchResults.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                                        No se encontraron unidades con ese artículo.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>

       <Card>
        <CardHeader>
            <CardTitle>Resumen General del Pedido</CardTitle>
            <CardDescription>Progreso consolidado del empaque para la orden actual.</CardDescription>
            <div className="flex gap-4 pt-4">
                <Input
                    placeholder="Filtrar por Referencia..."
                    value={referenciaFilter}
                    onChange={(e) => setReferenciaFilter(e.target.value)}
                    className="max-w-xs"
                />
                <Input
                    placeholder="Filtrar por Item..."
                    value={itemFilter}
                    onChange={(e) => setItemFilter(e.target.value)}
                    className="max-w-xs"
                />
            </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-2">
            {groupedAndFilteredDetails.map((group) => {
                const sortedSizes = Object.keys(group.sizes).sort((a, b) => {
                    const numA = Number(String(a).replace(/[^0-9.]/g, ''));
                    const numB = Number(String(b).replace(/[^0-9.]/g, ''));
                    return numA - numB;
                });

                return (
                    <div key={`${group.referencia}-${group.item}`} className="p-4 border rounded-lg bg-background shadow-sm">
                        <div className="mb-3">
                            <p className="font-bold text-lg text-primary">{group.referencia}</p>
                            <p className="text-sm text-muted-foreground">Item: {group.item || '-'}</p>
                        </div>
                        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-x-4 gap-y-3">
                            {sortedSizes.map(talla => {
                                const { ordered, packed } = group.sizes[talla];
                                const statusColor = packed > ordered ? 'text-blue-600'
                                    : packed === ordered && packed > 0 ? 'text-green-600'
                                    : packed < ordered && packed > 0 ? 'text-amber-600'
                                    : 'text-muted-foreground';

                                return (
                                    <div key={talla} className="text-center bg-muted/50 p-2 rounded-md">
                                        <p className="font-semibold text-sm text-card-foreground">{talla}</p>
                                        <p className={cn("text-lg font-bold", statusColor)}>
                                            {packed}/{ordered}
                                        </p>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                )
            })}
             {groupedAndFilteredDetails.length === 0 && (
                <p className="text-center text-muted-foreground py-4">No se encontraron productos con los filtros actuales.</p>
             )}
          </div>
        </CardContent>
       </Card>
    </div>
  );
};

const StatDisplay: React.FC<{title: string, value: string | number, variant?: 'default' | 'success'}> = ({ title, value, variant='default' }) => (
    <div className={cn("rounded-lg p-4 text-center", variant === 'success' ? 'bg-green-500/10' : 'bg-secondary')}>
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <p className={cn("text-4xl font-bold", variant === 'success' ? 'text-green-600' : 'text-foreground')}>{value}</p>
    </div>
)

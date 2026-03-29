"use client";

import React, { useMemo } from 'react';
import type { PackingUnit, PackingSession, PackedItem, PackedItemInUnit } from '@/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Trash2, RotateCcw, Plus, Check } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';


interface UnitContentDialogProps { 
    unit: PackingUnit | null;
    session: PackingSession;
    allPackedItems: PackedItem[];
    isOpen: boolean; 
    onOpenChange: (open: boolean) => void;
    onDeleteItem: (unitId: number, itemKey: string) => void;
    onEditItemQuantity: (unitId: number, itemKey: string, newQuantity: number) => void;
    onEditItemTalla: (unitId: number, itemKey: string, newTalla: string) => void;
    onAddItem: (unitId: number, reference: string, talla: string, quantity: number) => void;
    onCloseUnit: (unitId: number) => void;
    onReopenUnit: (unitId: number) => void;
    onDeleteUnit: (unitId: number) => void;
    role?: any;
}

export const UnitContentDialog: React.FC<UnitContentDialogProps> = ({ 
    unit, 
    session, 
    allPackedItems,
    isOpen, 
    onOpenChange, 
    onDeleteItem, 
    onEditItemQuantity, 
    onEditItemTalla, 
    onAddItem,
    onCloseUnit,
    onReopenUnit, 
    onDeleteUnit,
    role
}) => {

    const [isAdding, setIsAdding] = React.useState(false);
    const [newTalla, setNewTalla] = React.useState('');
    const [newQuantity, setNewQuantity] = React.useState(1);

    const unitToShow = useMemo(() => session.units.find(u => u.id === unit?.id), [session.units, unit?.id]);

    const itemsInUnit = useMemo(() => {
        if (!unitToShow || !unitToShow.firestoreId) return [];
        
        // Filter items belonging to this unit
        const filtered = allPackedItems.filter(p => p.packingUnitId === unitToShow.firestoreId);
        
        // Group by itemKey
        const grouped: { [key: string]: { item?: any, packedQuantity: number } } = {};
        
        filtered.forEach(p => {
            if (!grouped[p.itemKey]) {
                grouped[p.itemKey] = {
                    item: p.item,
                    packedQuantity: 0
                };
            }
            grouped[p.itemKey].packedQuantity += p.quantity;
        });
        
        return Object.entries(grouped);
    }, [unitToShow, allPackedItems]);

    if (!unitToShow) return null;

    const isUnitOpen = unitToShow.status === 'open';

    const handleAddManual = () => {
        if (!newTalla.trim()) return;
        
        // Find reference from existing items if possible
        const itemWithRef = allPackedItems.find(p => p.packingUnitId === unitToShow.firestoreId && p.itemKey.split('-')[0].trim().length > 0);
        const ref = itemWithRef ? itemWithRef.itemKey.split('-')[0].trim() : '';
        
        onAddItem(unitToShow.id, ref, newTalla.trim(), newQuantity);
        setIsAdding(false);
        setNewTalla('');
        setNewQuantity(1);
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle className="flex justify-between items-center">
                        Contenido de la Unidad #{unitToShow.id}
                        {isUnitOpen && !isAdding && (
                            <Button size="sm" onClick={() => setIsAdding(true)} className="ml-4">
                                <Plus className="mr-2 h-4 w-4" /> Agregar Talla
                            </Button>
                        )}
                    </DialogTitle>
                    <DialogDescription>
                        {unitToShow.status === 'closed' ? `Etiqueta: ${unitToShow.labelBarcode}` : 'Unidad actualmente abierta.'}
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4 max-h-[60vh] overflow-y-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Referencia</TableHead>
                                <TableHead>Talla</TableHead>
                                <TableHead className="text-center">Cantidad</TableHead>
                                <TableHead className="text-right">Acciones</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {itemsInUnit.length > 0 ? (
                                itemsInUnit.map(([key, packedData]) => {
                                    const [refFallback, tallaFallback] = key.split('-');
                                    return (
                                        <TableRow key={key}>
                                            <TableCell className="font-medium">{packedData.item?.referencia || packedData.item?.reference || refFallback || 'N/A'}</TableCell>
                                            <TableCell>
                                                <Input
                                                    type="text"
                                                    defaultValue={packedData.item?.talla || packedData.item?.size || tallaFallback || ''}
                                                    onBlur={(e) => onEditItemTalla(unitToShow.id, key, e.target.value)}
                                                    className="w-20 text-center"
                                                    disabled={!isUnitOpen}
                                                />
                                            </TableCell>
                                            <TableCell className="text-center">
                                               <Input
                                                    type="number"
                                                    defaultValue={packedData.packedQuantity}
                                                    onBlur={(e) => onEditItemQuantity(unitToShow.id, key, parseInt(e.target.value, 10) || 0)}
                                                    className="w-20 mx-auto text-center"
                                                    min="0"
                                                    disabled={!isUnitOpen}
                                               />
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <AlertDialog>
                                                    <AlertDialogTrigger asChild>
                                                        <Button variant="ghost" size="icon" disabled={!isUnitOpen}>
                                                            <Trash2 className={cn("h-4 w-4", isUnitOpen ? "text-destructive" : "text-muted-foreground")} />
                                                        </Button>
                                                    </AlertDialogTrigger>
                                                    <AlertDialogContent>
                                                        <AlertDialogHeader>
                                                            <AlertDialogTitle>¿Confirmar Eliminación?</AlertDialogTitle>
                                                            <AlertDialogDescription>
                                                                Esta acción eliminará todos los items de la referencia {packedData.item?.referencia || refFallback} de esta caja. No se puede deshacer.
                                                            </AlertDialogDescription>
                                                        </AlertDialogHeader>
                                                        <AlertDialogFooter>
                                                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                                            <AlertDialogAction onClick={() => onDeleteItem(unitToShow.id, key)}>Eliminar</AlertDialogAction>
                                                        </AlertDialogFooter>
                                                    </AlertDialogContent>
                                                </AlertDialog>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })
                            ) : (
                                !isAdding && (
                                    <TableRow>
                                        <TableCell colSpan={4} className="text-center text-muted-foreground py-4">Esta unidad está vacía.</TableCell>
                                    </TableRow>
                                )
                            )}
                            
                            {isAdding && (
                                <TableRow className="bg-muted/30">
                                    <TableCell className="font-medium italic">Nueva Talla...</TableCell>
                                    <TableCell>
                                        <Input
                                            type="text"
                                            value={newTalla}
                                            onChange={(e) => setNewTalla(e.target.value)}
                                            placeholder="Talla"
                                            className="w-20 text-center border-primary"
                                            autoFocus
                                        />
                                    </TableCell>
                                    <TableCell className="text-center">
                                        <Input
                                            type="number"
                                            value={newQuantity}
                                            onChange={(e) => setNewQuantity(parseInt(e.target.value, 10) || 1)}
                                            className="w-20 mx-auto text-center border-primary"
                                            min="1"
                                        />
                                    </TableCell>
                                    <TableCell className="text-right flex justify-end gap-1">
                                        <Button size="sm" variant="ghost" onClick={() => setIsAdding(false)}>
                                            <RotateCcw className="h-4 w-4" />
                                        </Button>
                                        <Button size="sm" onClick={handleAddManual}>
                                            <Check className="h-4 w-4" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
                <DialogFooter className="justify-between">
                    <div className="flex gap-2">
                        {!isUnitOpen ? (
                            <Button variant="outline" onClick={() => onReopenUnit(unitToShow.id)}>
                                <RotateCcw className="mr-2 h-4 w-4" /> Reabrir para Editar
                            </Button>
                        ) : (
                            <Button variant="default" onClick={() => { onCloseUnit(unitToShow.id); onOpenChange(false); }} className="bg-green-600 hover:bg-green-700">
                                <Check className="mr-2 h-4 w-4" /> Cerrar y Etiquetar
                            </Button>
                        )}
                         <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="destructive" disabled={role !== 'admin'}>
                                    <Trash2 className="mr-2 h-4 w-4" /> Eliminar Caja Completa
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                <AlertDialogTitle>¿Eliminar la caja #{unitToShow.id}?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    Esta acción es permanente y eliminará la caja y todos los artículos que contiene. La etiqueta asociada, si existe, quedará disponible nuevamente.
                                </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction onClick={() => onDeleteUnit(unitToShow.id)}>Sí, Eliminar Caja</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </div>
                    <Button onClick={() => onOpenChange(false)} className="ml-auto">Cerrar</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

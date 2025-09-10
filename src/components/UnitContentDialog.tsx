"use client";

import React from 'react';
import type { PackingUnit, PackingSession, PackedItem } from '@/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Trash2, RotateCcw } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';


interface UnitContentDialogProps { 
    unit: PackingUnit | null;
    session: PackingSession;
    isOpen: boolean; 
    onOpenChange: (open: boolean) => void;
    onDeleteItem: (unitId: number, itemKey: string) => void;
    onEditItemQuantity: (item: PackedItem, newQuantity: number) => void;
    onReopenUnit: (unitId: number) => void;
    onDeleteUnit: (unitId: number) => void; // Add this prop
}

export const UnitContentDialog: React.FC<UnitContentDialogProps> = ({ unit, session, isOpen, onOpenChange, onDeleteItem, onEditItemQuantity, onReopenUnit, onDeleteUnit }) => {

    const unitToShow = session.units.find(u => u.id === unit?.id);

    if (!unitToShow) return null;

    const isUnitOpen = unitToShow.status === 'open';
    const itemsInUnit = Object.entries(unitToShow.items || {});

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Contenido de la Unidad #{unitToShow.id}</DialogTitle>
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
                                itemsInUnit.map(([key, packedItem]) => (
                                    <TableRow key={key}>
                                        <TableCell className="font-medium">{packedItem.item.referencia}</TableCell>
                                        <TableCell>{packedItem.item.talla}</TableCell>
                                        <TableCell className="text-center">
                                           <Input
                                                type="number"
                                                defaultValue={packedItem.packedQuantity}
                                                onBlur={(e) => onEditItemQuantity(packedItem, parseInt(e.target.value, 10) || 0)}
                                                className="w-20 mx-auto text-center"
                                                min="0"
                                           />
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <AlertDialog>
                                                <AlertDialogTrigger asChild>
                                                    <Button variant="ghost" size="icon">
                                                        <Trash2 className="h-4 w-4 text-destructive" />
                                                    </Button>
                                                </AlertDialogTrigger>
                                                <AlertDialogContent>
                                                    <AlertDialogHeader>
                                                        <AlertDialogTitle>¿Confirmar Eliminación?</AlertDialogTitle>
                                                        <AlertDialogDescription>
                                                            Esta acción eliminará todos los items de la referencia {packedItem.item.referencia} - Talla {packedItem.item.talla} de esta caja. No se puede deshacer.
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
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={4} className="text-center text-muted-foreground py-4">Esta unidad está vacía.</TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
                <DialogFooter className="justify-between">
                    <div className="flex gap-2">
                        {!isUnitOpen && (
                            <Button variant="outline" onClick={() => onReopenUnit(unitToShow.id)}>
                                <RotateCcw className="mr-2 h-4 w-4" /> Reabrir para Editar
                            </Button>
                        )}
                         <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="destructive">
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

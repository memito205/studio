"use client";

import React, { useMemo } from 'react';
import type { PackedItem } from '@/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface OrphanContentDialogProps {
    firestoreId: string | null;
    unitLabel: string;
    allPackedItems: PackedItem[];
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
}

export const OrphanContentDialog: React.FC<OrphanContentDialogProps> = ({
    firestoreId,
    unitLabel,
    allPackedItems,
    isOpen,
    onOpenChange
}) => {
    const items = useMemo(() => {
        if (!firestoreId) return [];

        // Filter items belonging to this "orphan" ID
        // If firestoreId is 'unassociated', we look for items with NO packingUnitId
        const filtered = allPackedItems.filter(p => 
            firestoreId === 'unassociated' ? !p.packingUnitId : p.packingUnitId === firestoreId
        );

        // Group by itemKey
        const grouped: { [key: string]: { reference: string, talla: string, quantity: number } } = {};
        
        filtered.forEach(p => {
            if (!grouped[p.itemKey]) {
                const [ref, talla] = p.itemKey.split('-');
                grouped[p.itemKey] = {
                    reference: p.item?.referencia || ref || 'N/A',
                    talla: p.item?.talla || talla || 'N/A',
                    quantity: 0
                };
            }
            grouped[p.itemKey].quantity += p.quantity;
        });

        return Object.values(grouped);
    }, [firestoreId, allPackedItems]);

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="text-destructive">Detalle de Registros Huérfanos</DialogTitle>
                    <DialogDescription>
                        Contenido detectado para: <span className="font-bold">{unitLabel}</span>
                    </DialogDescription>
                </DialogHeader>
                
                <div className="py-4 max-h-[50vh] overflow-y-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Referencia</TableHead>
                                <TableHead>Talla</TableHead>
                                <TableHead className="text-right">Cant.</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {items.length > 0 ? items.map((item, idx) => (
                                <TableRow key={`${item.reference}-${item.talla}-${idx}`}>
                                    <TableCell className="font-medium">{item.reference}</TableCell>
                                    <TableCell>{item.talla}</TableCell>
                                    <TableCell className="text-right font-bold">{item.quantity}</TableCell>
                                </TableRow>
                            )) : (
                                <TableRow>
                                    <TableCell colSpan={3} className="text-center py-4 text-muted-foreground">No se encontraron artículos.</TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>

                <DialogFooter>
                    <Button onClick={() => onOpenChange(false)}>Cerrar</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

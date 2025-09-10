
"use client";

import React from 'react';
import type { RemisionEntry } from '@/types';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface ClassificationDetailsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  items: RemisionEntry[];
}

export const ClassificationDetailsDialog: React.FC<ClassificationDetailsDialogProps> = ({ isOpen, onClose, title, items }) => {
  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Detalle de Clasificación: {title}</DialogTitle>
          <DialogDescription>
            Mostrando {items.length} registro(s) que cayeron en esta categoría.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto mt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empacador</TableHead>
                <TableHead>Cód. Barras</TableHead>
                <TableHead>Descripción</TableHead>
                <TableHead>Referencia</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, index) => (
                <TableRow key={`${item.codigoBarras}-${index}`}>
                  <TableCell>{item.empacador}</TableCell>
                  <TableCell className="font-mono">{item.codigoBarras}</TableCell>
                  <TableCell>{item.descripcion}</TableCell>
                  <TableCell>{item.referencia}</TableCell>
                  <TableCell className="text-right">{item.cantidad}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button">Cerrar</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

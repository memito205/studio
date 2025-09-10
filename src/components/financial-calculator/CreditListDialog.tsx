
"use client";

import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Eye } from "lucide-react";
import type { CreditCalculationResult } from "@/types";
import { ScrollArea } from "@/components/ui/scroll-area";

interface CreditListDialogProps {
  credits: CreditCalculationResult[];
  isOpen: boolean;
  onClose: () => void;
  onViewAmortization: (credit: CreditCalculationResult) => void;
}

export const CreditListDialog: React.FC<CreditListDialogProps> = ({ credits, isOpen, onClose, onViewAmortization }) => {
  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Créditos que Contribuyen al Costo del Mes</DialogTitle>
          <DialogDescription>
            Esta es la lista de créditos individuales que generaron costos de gracia durante este mes.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="mt-4 border rounded-md">
          <div className="max-h-[60vh]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID Crédito</TableHead>
                  <TableHead>Punto de Venta</TableHead>
                  <TableHead>Fecha Crédito</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="text-center">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {credits.map((credit) => (
                  <TableRow key={credit.creditId}>
                    <TableCell>{credit.creditId}</TableCell>
                    <TableCell>{credit.puntoDeVenta}</TableCell>
                    <TableCell>{credit.fechaCredito}</TableCell>
                    <TableCell className="text-right">${credit.valorCredito.toLocaleString('es-CO')}</TableCell>
                    <TableCell className="text-center">
                      <Button variant="ghost" size="icon" onClick={() => onViewAmortization(credit)} title="Ver amortización detallada">
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};

/** @jsxImportSource react */
"use client";

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { LabelingOperation } from '@/types';

interface FinishWorkDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  task: LabelingOperation;
  onConfirm: (completedUnits: number) => void;
  isSubmitting: boolean;
}

export const FinishWorkDialog: React.FC<FinishWorkDialogProps> = ({ isOpen, onOpenChange, task, onConfirm, isSubmitting }) => {
  const [completedUnits, setCompletedUnits] = useState(task.totalUnits);

  const handleConfirm = () => {
    if (completedUnits > task.totalUnits) {
      alert(`La cantidad completada no puede ser mayor a la asignada (${task.totalUnits}).`);
      return;
    }
    if (completedUnits < 0) {
      alert("La cantidad no puede ser negativa.");
      return;
    }
    onConfirm(completedUnits);
  };
  
  useEffect(() => {
    if (isOpen) {
      setCompletedUnits(task.totalUnits);
    }
  }, [isOpen, task.totalUnits]);


  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Finalizar Sesión de Trabajo</DialogTitle>
          <DialogDescription>
            Reporte cuántas unidades de la referencia <span className="font-bold">{task.reference}</span> completó en esta sesión.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <p>Unidades totales asignadas para esta tarea: <span className="font-bold">{task.totalUnits}</span></p>
          <div>
            <Label htmlFor="completed-units">Unidades Completadas</Label>
            <Input
              id="completed-units"
              type="number"
              value={completedUnits}
              onChange={(e) => setCompletedUnits(Number(e.target.value))}
              max={task.totalUnits}
              min="0"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleConfirm} disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
            Confirmar y Finalizar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

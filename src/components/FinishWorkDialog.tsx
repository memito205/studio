/** @jsxImportSource react */
"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, AlertTriangle, Package } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { LabelingOperation } from '@/types';
import { summarizePackPlanProgress } from '@/lib/labelingPackPlan';

interface FinishWorkDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  task: LabelingOperation;
  onConfirm: (completedUnits: number) => void;
  isSubmitting: boolean;
}

export const FinishWorkDialog: React.FC<FinishWorkDialogProps> = ({ isOpen, onOpenChange, task, onConfirm, isSubmitting }) => {
  const [completedUnits, setCompletedUnits] = useState(task.totalUnits);

  const isPackMode =
    task.trackingMode === 'pack_units' && (task.labelingPackPlan?.length || 0) > 0;

  const packProgress = useMemo(
    () => (isPackMode ? summarizePackPlanProgress(task.labelingPackPlan) : null),
    [isPackMode, task.labelingPackPlan]
  );

  const handleConfirm = () => {
    if (isPackMode && packProgress) {
      if (packProgress.confirmedBoxes === 0) {
        alert('Confirme al menos una caja antes de finalizar.');
        return;
      }
      onConfirm(packProgress.confirmedUnits);
      return;
    }
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
      if (isPackMode && packProgress) {
        setCompletedUnits(packProgress.confirmedUnits);
      } else {
        const live =
          task.trackingMode === 'pack_units' && (task.completedUnitsLive ?? 0) > 0
            ? task.completedUnitsLive!
            : task.totalUnits;
        setCompletedUnits(live);
      }
    }
  }, [isOpen, task.totalUnits, task.trackingMode, task.completedUnitsLive, isPackMode, packProgress]);

  const remaining = task.totalUnits - completedUnits;
  const isPartial = remaining > 0 && completedUnits > 0;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Finalizar Sesión de Trabajo</DialogTitle>
          <DialogDescription>
            {isPackMode ? (
              <>
                Cierre de <span className="font-bold">{task.reference}</span> según cajas confirmadas.
              </>
            ) : (
              <>
                Reporte cuántas unidades de la referencia <span className="font-bold">{task.reference}</span> completó en esta sesión.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          {isPackMode && packProgress ? (
            <>
              <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
                <p className="flex items-center gap-2 font-medium">
                  <Package className="h-4 w-4" />
                  {packProgress.confirmedBoxes}/{packProgress.totalBoxes} cajas confirmadas
                </p>
                <p>
                  Unidades a registrar: <span className="font-bold">{packProgress.confirmedUnits.toLocaleString()}</span>
                </p>
                {packProgress.pendingBoxes > 0 ? (
                  <p className="text-muted-foreground">
                    Remanente: {packProgress.pendingBoxes} cajas ({packProgress.pendingUnits.toLocaleString()} und) → nueva tarea Pendiente.
                  </p>
                ) : (
                  <p className="text-emerald-700">Todas las cajas confirmadas. No habrá remanente.</p>
                )}
              </div>
              {packProgress.confirmedBoxes === 0 ? (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-md p-3 text-sm text-amber-800">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
                  <p>Debe confirmar al menos una caja (digite el #) antes de finalizar.</p>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <p>Unidades asignadas para esta tarea: <span className="font-bold">{task.totalUnits}</span></p>
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

              {isPartial && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-md p-3 text-sm text-amber-800">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
                  <p>
                    Se reportarán <strong>{completedUnits}</strong> unidades como completadas. Las <strong>{remaining}</strong> unidades restantes quedarán registradas como una nueva tarea en estado <strong>Pendiente</strong>.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            onClick={handleConfirm}
            disabled={
              isSubmitting ||
              (isPackMode ? !packProgress || packProgress.confirmedBoxes === 0 : completedUnits <= 0)
            }
          >
            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
            Confirmar y Finalizar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

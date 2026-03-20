/** @jsxImportSource react */
"use client";

import React, { useState } from 'react';
import type { LabelingOperation, LabelingOperationStatus } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Play, Pause, Check, RotateCcw, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { logLabelingActivity, finishLabelingTaskSession } from '@/app/reception/actions';
import { useAuth } from '@/hooks/use-auth-context';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface FinishWorkDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  task: LabelingOperation;
  onConfirm: (completedUnits: number) => void;
  isSubmitting: boolean;
}

const FinishWorkDialog: React.FC<FinishWorkDialogProps> = ({ isOpen, onOpenChange, task, onConfirm, isSubmitting }) => {
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
  
  React.useEffect(() => {
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


interface LabelingOperatorViewProps {
    operations: LabelingOperation[];
    onRefresh: () => void;
}

const getStatusVariant = (status: LabelingOperationStatus) => {
    switch (status) {
        case 'Pendiente': return 'secondary';
        case 'Asignada': return 'default';
        case 'En Progreso': return 'default';
        case 'Completada': return 'success';
        case 'Pausada': return 'warning';
        default: return 'outline';
    }
};

const OperatorTaskCard: React.FC<{ 
    operation: LabelingOperation; 
    onAction: (opId: string, action: 'START' | 'PAUSE' | 'RESUME' | 'FINISH', reason?: string) => void;
    onOpenFinishDialog: (operation: LabelingOperation) => void;
    isSubmitting: boolean; 
}> = ({ operation, onAction, onOpenFinishDialog, isSubmitting }) => {
    
    return (
        <Card className="flex flex-col">
            <CardHeader>
                <div className="flex justify-between items-start">
                    <div>
                        <CardTitle>{operation.reference}</CardTitle>
                        <CardDescription>RK: {operation.rk_identifier} - {operation.supplier}</CardDescription>
                    </div>
                    <Badge variant={getStatusVariant(operation.status)}>{operation.status}</Badge>
                </div>
            </CardHeader>
            <CardContent className="flex-grow space-y-2">
                <p><strong>Cantidad Total:</strong> {operation.totalUnits.toLocaleString()} unidades</p>
                <p className="text-sm text-muted-foreground">
                    Desglose: {Object.entries(operation.sizes).map(([s, q]) => `${s}: ${q}`).join(', ')}
                </p>
                <p className="text-sm text-muted-foreground">
                    Estándar: {operation.standard_units_per_hour || 'N/A'} u/h
                </p>
            </CardContent>
            <CardFooter className="flex justify-end gap-2">
                {operation.status === 'Asignada' && (
                    <Button onClick={() => onAction(operation.id, 'START')} disabled={isSubmitting}>
                        {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Play className="mr-2 h-4 w-4"/>}
                        Iniciar Tarea
                    </Button>
                )}
                {operation.status === 'En Progreso' && (
                    <>
                        <Button variant="outline" onClick={() => onAction(operation.id, 'PAUSE', 'Descanso voluntario')} disabled={isSubmitting}>
                           {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Pause className="mr-2 h-4 w-4"/>}
                           Pausar
                        </Button>
                        <Button variant="default" onClick={() => onOpenFinishDialog(operation)} disabled={isSubmitting}>
                           {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Check className="mr-2 h-4 w-4"/>}
                           Finalizar
                        </Button>
                    </>
                )}
                {operation.status === 'Pausada' && (
                    <Button onClick={() => onAction(operation.id, 'RESUME')} disabled={isSubmitting}>
                        {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <RotateCcw className="mr-2 h-4 w-4"/>}
                        Reanudar
                    </Button>
                )}
                {operation.status === 'Completada' && (
                    <p className="text-sm text-green-600 font-semibold">¡Tarea Completada!</p>
                )}
            </CardFooter>
        </Card>
    )
};


const LabelingOperatorView: React.FC<LabelingOperatorViewProps> = ({ operations, onRefresh }) => {
    const { toast } = useToast();
    const { user } = useAuth();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [taskToFinish, setTaskToFinish] = useState<LabelingOperation | null>(null);
    const [isFinishDialogOpen, setIsFinishDialogOpen] = useState(false);

    const handleAction = async (operationId: string, actionType: 'START' | 'PAUSE' | 'RESUME' | 'FINISH', reason?: string) => {
        if (!user) return;
        setIsSubmitting(true);
        
        const result = await logLabelingActivity(operationId, user.uid, actionType, reason);

        if (result.success) {
            toast({ title: 'Éxito', description: `Acción '${actionType}' registrada.` });
            onRefresh();
        } else {
            toast({ variant: 'destructive', title: 'Error', description: result.error });
        }
        setIsSubmitting(false);
    };

    const handleOpenFinishDialog = (operation: LabelingOperation) => {
        setTaskToFinish(operation);
        setIsFinishDialogOpen(true);
    };

    const handleConfirmFinish = async (completedUnits: number) => {
        if (!taskToFinish) return;
        setIsSubmitting(true);
        const result = await finishLabelingTaskSession(taskToFinish.id, completedUnits);
        if (result.success) {
            toast({ title: 'Tarea Finalizada', description: `Se ha registrado el trabajo para la referencia ${taskToFinish.reference}.` });
            onRefresh();
        } else {
            toast({ variant: 'destructive', title: 'Error al Finalizar', description: result.error });
        }
        setIsSubmitting(false);
        setIsFinishDialogOpen(false);
        setTaskToFinish(null);
    };

    if (operations.length === 0) {
        return <p className="text-center text-muted-foreground py-8">No tienes tareas de etiquetado asignadas.</p>;
    }

    return (
        <>
            {taskToFinish && (
                <FinishWorkDialog
                    isOpen={isFinishDialogOpen}
                    onOpenChange={setIsFinishDialogOpen}
                    task={taskToFinish}
                    onConfirm={handleConfirmFinish}
                    isSubmitting={isSubmitting}
                />
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {operations.map((op) => (
                    <OperatorTaskCard 
                        key={op.id} 
                        operation={op} 
                        onAction={handleAction} 
                        onOpenFinishDialog={handleOpenFinishDialog}
                        isSubmitting={isSubmitting} 
                    />
                ))}
            </div>
        </>
    );
};

export default LabelingOperatorView;

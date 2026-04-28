/** @jsxImportSource react */
"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Play, Pause, Check, RotateCcw, Loader2, Lock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { logLabelingActivity, finishLabelingTaskSession, getLabelingOperationsForExternal } from '@/app/reception/actions';
import { useAuth } from '@/hooks/use-auth-context';
import type { LabelingOperation, LabelingOperationStatus, ExternalVendor } from '@/types';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FinishWorkDialog } from './FinishWorkDialog';


interface ValidatedActionDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: (pin: string) => void;
    operatorName: string;
    actionLabel: string;
    isSubmitting: boolean;
}

const ValidatedActionDialog: React.FC<ValidatedActionDialogProps> = ({ 
    isOpen, onOpenChange, onConfirm, operatorName, actionLabel, isSubmitting 
}) => {
    const [pin, setPin] = useState('');
    
    const handleConfirm = () => {
        if (pin.length === 4) {
            onConfirm(pin);
            setPin('');
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md border-primary/20 shadow-2xl">
                <DialogHeader>
                    <div className="mx-auto bg-primary/10 w-12 h-12 rounded-full flex items-center justify-center mb-2">
                        <Lock className="h-6 w-6 text-primary" />
                    </div>
                    <DialogTitle className="text-center text-xl">Validación de Seguridad</DialogTitle>
                    <DialogDescription className="text-center pt-2">
                        <span className="font-bold text-foreground block mb-2">{operatorName}</span>
                        ¿Confirmas que deseas <strong>{actionLabel}</strong> esta tarea?
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col items-center py-6">
                    <p className="text-xs text-muted-foreground mb-4">Ingresa el PIN de 4 dígitos para confirmar</p>
                    <div className="flex items-center gap-2 mb-6">
                        {[0, 1, 2, 3].map((i) => (
                            <div 
                                key={i}
                                className={`w-3 h-3 rounded-full border-2 border-primary ${pin.length > i ? 'bg-primary' : 'bg-transparent'}`}
                            />
                        ))}
                    </div>
                    <div className="grid grid-cols-3 gap-2 w-full max-w-[200px]">
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((num) => (
                            <Button 
                                key={num} 
                                variant="outline" 
                                className={`h-10 text-lg font-bold ${num === 0 ? 'col-start-2' : ''}`}
                                onClick={() => pin.length < 4 && setPin(p => p + num)}
                            >
                                {num}
                            </Button>
                        ))}
                        <Button variant="ghost" className="h-10" onClick={() => setPin('')}>C</Button>
                    </div>
                </div>
                <DialogFooter className="sm:justify-center">
                    <Button 
                        onClick={handleConfirm} 
                        className="w-full" 
                        disabled={pin.length !== 4 || isSubmitting}
                    >
                        {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Confirmar Acción
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

interface PauseReasonDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
}

const PauseReasonDialog: React.FC<PauseReasonDialogProps> = ({ isOpen, onOpenChange, onConfirm }) => {
  const [selectedReason, setSelectedReason] = useState('Almuerzo');
  const reasons = ['Almuerzo', 'Baño', 'Ajuste de Puesto', 'Falla Técnica', 'Otro'];

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Motivo de la Pausa</DialogTitle>
          <DialogDescription>
            Seleccione el motivo por el cual va a pausar su actividad.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
            <Label>Razón</Label>
            <Select value={selectedReason} onValueChange={setSelectedReason}>
                <SelectTrigger>
                    <SelectValue placeholder="Seleccione motivo..." />
                </SelectTrigger>
                <SelectContent>
                    {reasons.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
            </Select>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => onConfirm(selectedReason)}>Confirmar Motivo</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

interface LabelingOperatorViewProps {
    operations?: LabelingOperation[];
    onRefresh?: () => void;
    isExternalPortal?: boolean;
    externalVendor?: (ExternalVendor & { operatorName?: string }) | null;
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
                        <Button variant="outline" onClick={() => onAction(operation.id, 'PAUSE')} disabled={isSubmitting}>
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


export const LabelingOperatorView: React.FC<LabelingOperatorViewProps> = ({ 
    operations: propOperations, 
    onRefresh: propOnRefresh,
    isExternalPortal = false,
    externalVendor = null
}) => {
    const { toast } = useToast();
    const { user } = useAuth();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [taskToFinish, setTaskToFinish] = useState<LabelingOperation | null>(null);
    const [isFinishDialogOpen, setIsFinishDialogOpen] = useState(false);
    
    // Security verification state
    const [isPinDialogOpen, setIsPinDialogOpen] = useState(false);
    const [pendingAction, setPendingAction] = useState<{ 
        operationId: string, 
        actionType: 'START' | 'PAUSE' | 'RESUME' | 'FINISH', 
        reason?: string,
        completedUnits?: number
    } | null>(null);
    const [actionLabel, setActionLabel] = useState('');
    const [isPauseReasonDialogOpen, setIsPauseReasonDialogOpen] = useState(false);
    const [pausePendingOpId, setPausePendingOpId] = useState<string | null>(null);
    
    // Internal state for external portal mode
    const [externalOperations, setExternalOperations] = useState<LabelingOperation[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const fetchExternalTasks = React.useCallback(async () => {
        if (!isExternalPortal || !externalVendor) return;
        setIsLoading(true);
        const result = await getLabelingOperationsForExternal(externalVendor.id, externalVendor.operatorName);
        if (result.success && result.data) {
            setExternalOperations(result.data);
        } else if (!result.success) {
            toast({ variant: 'destructive', title: 'Error al cargar tareas', description: result.error });
        }
        setIsLoading(false);
    }, [isExternalPortal, externalVendor]);

    React.useEffect(() => {
        if (isExternalPortal) {
            fetchExternalTasks();
        }
    }, [isExternalPortal, fetchExternalTasks]);

    const activeOperations = isExternalPortal ? externalOperations : (propOperations || []);
    const handleRefresh = isExternalPortal ? fetchExternalTasks : (propOnRefresh || (() => {}));

    const initiateAction = (operationId: string, actionType: 'START' | 'PAUSE' | 'RESUME' | 'FINISH', reason?: string, completedUnits?: number) => {
        if (!isExternalPortal) {
            if (actionType === 'FINISH' && completedUnits !== undefined) {
                handleConfirmFinish(completedUnits);
            } else {
                handleAction(operationId, actionType, reason);
            }
            return;
        }

        if (actionType === 'PAUSE' && !reason) {
            setPausePendingOpId(operationId);
            setIsPauseReasonDialogOpen(true);
            return;
        }

        const labels: Record<string, string> = {
            'START': 'INICIAR',
            'PAUSE': `PAUSAR (${reason || 'Descanso'})`,
            'RESUME': 'REANUDAR',
            'FINISH': 'FINALIZAR'
        };

        setPendingAction({ operationId, actionType, reason, completedUnits });
        setActionLabel(labels[actionType] || 'ejecutar');
        setIsPinDialogOpen(true);
    };

    const handlePauseReasonConfirm = (reason: string) => {
        if (!pausePendingOpId) return;
        const opId = pausePendingOpId;
        setPausePendingOpId(null);
        setIsPauseReasonDialogOpen(false);
        initiateAction(opId, 'PAUSE', reason);
    };

    const handlePinConfirm = (pin: string) => {
        if (!pendingAction) return;
        
        if (pendingAction.actionType === 'FINISH' && pendingAction.completedUnits !== undefined) {
            performFinish(pendingAction.operationId, pendingAction.completedUnits, pin);
        } else {
            handleAction(pendingAction.operationId, pendingAction.actionType, pendingAction.reason, pin);
        }
        setIsPinDialogOpen(false);
    };

    const handleAction = async (operationId: string, actionType: 'START' | 'PAUSE' | 'RESUME' | 'FINISH', reason?: string, providedPin?: string) => {
        const operatorId = isExternalPortal ? externalVendor?.id : user?.uid;
        if (!operatorId) return;

        setIsSubmitting(true);
        const result = await logLabelingActivity(
            operationId, 
            operatorId, 
            actionType, 
            reason, 
            isExternalPortal, 
            providedPin,
            externalVendor?.operatorName
        );

        if (result.success) {
            toast({ title: 'Éxito', description: `Acción '${actionType}' registrada.` });
            handleRefresh();
        } else {
            toast({ variant: 'destructive', title: 'Error', description: result.error });
        }
        setIsSubmitting(false);
    };

    const handleOpenFinishDialog = (operation: LabelingOperation) => {
        setTaskToFinish(operation);
        setIsFinishDialogOpen(true);
    };

    const handleConfirmFinish = (completedUnits: number) => {
        if (!taskToFinish) return;
        
        if (isExternalPortal) {
            setIsFinishDialogOpen(false);
            initiateAction(taskToFinish.id, 'FINISH', undefined, completedUnits);
        } else {
            performFinish(taskToFinish.id, completedUnits);
            setIsFinishDialogOpen(false);
        }
    };

    const performFinish = async (operationId: string, completedUnits: number, providedPin?: string) => {
        setIsSubmitting(true);
        const result = await finishLabelingTaskSession(
            operationId, 
            completedUnits, 
            isExternalPortal, 
            providedPin, 
            externalVendor?.operatorName
        );
        if (result.success) {
            toast({ title: 'Tarea Finalizada', description: `Se ha registrado el trabajo.` });
            handleRefresh();
        } else {
            toast({ variant: 'destructive', title: 'Error al Finalizar', description: result.error });
        }
        setIsSubmitting(false);
        setIsFinishDialogOpen(false);
        setTaskToFinish(null);
    };

    if (isLoading) {
        return <div className="flex justify-center p-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
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
            {isExternalPortal && externalVendor && (
                <ValidatedActionDialog
                    isOpen={isPinDialogOpen}
                    onOpenChange={setIsPinDialogOpen}
                    onConfirm={handlePinConfirm}
                    operatorName={externalVendor.operatorName || 'Operario'}
                    actionLabel={actionLabel}
                    isSubmitting={isSubmitting}
                />
            )}
            <PauseReasonDialog 
                isOpen={isPauseReasonDialogOpen}
                onOpenChange={setIsPauseReasonDialogOpen}
                onConfirm={handlePauseReasonConfirm}
            />
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {activeOperations.map((op) => (
                    <OperatorTaskCard 
                        key={op.id} 
                        operation={op} 
                        onAction={initiateAction} 
                        onOpenFinishDialog={handleOpenFinishDialog}
                        isSubmitting={isSubmitting} 
                    />
                ))}
            </div>
        </>
    );
};

export default LabelingOperatorView;

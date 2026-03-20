/** @jsxImportSource react */
import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { AppUser, LabelingOperation } from '@/types';
import { bulkCreateLabelingTasks } from '@/app/reception/actions';

interface GroupedItem {
  reference: string;
  item: string;
  totalQuantity: number;
  sizes: { [size: string]: number };
}

interface AssignOperatorsDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  itemsToAssign?: GroupedItem[];
  operators: AppUser[];
  isLoading: boolean;
  onAssign: (operatorIds: string[]) => void;
  onTasksCreated?: () => void; // For bulk creation
  operationId?: string; // For bulk creation
  rkIdentifier?: string; // For bulk creation
  supplier?: string; // For bulk creation
  isSingleTaskReassign?: boolean;
  initialAssignedIds?: string[];
}

export const AssignOperatorsDialog: React.FC<AssignOperatorsDialogProps> = ({
  isOpen,
  onOpenChange,
  itemsToAssign,
  operators,
  isLoading,
  onAssign,
  onTasksCreated,
  operationId,
  rkIdentifier,
  supplier,
  isSingleTaskReassign = false,
  initialAssignedIds = [],
}) => {
  const [assignments, setAssignments] = useState<Map<string, string>>(new Map());
  const [singleAssignment, setSingleAssignment] = useState<string>(initialAssignedIds[0] || '');
  const [globalStandard, setGlobalStandard] = useState<number>(150);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen) {
      if (isSingleTaskReassign) {
        setSingleAssignment(initialAssignedIds[0] || '');
      } else {
        setAssignments(new Map());
        setGlobalStandard(150);
      }
    }
  }, [isOpen, isSingleTaskReassign, initialAssignedIds]);

  const handleAssignmentChange = (reference: string, operatorId: string) => {
    setAssignments(prev => {
        const newMap = new Map(prev);
        if (operatorId) {
            newMap.set(reference, operatorId);
        } else {
            newMap.delete(reference);
        }
        return newMap;
    });
  };
  
  const handleConfirm = async () => {
    if (isSingleTaskReassign) {
        onAssign([singleAssignment]);
        return;
    }

    if (!itemsToAssign || assignments.size === 0) {
        toast({ variant: "destructive", title: "Sin asignaciones", description: "Por favor, asigne al menos una referencia." });
        return;
    }
    
    if(!operationId || !rkIdentifier || !supplier || !onTasksCreated) {
        toast({ variant: "destructive", title: "Error de configuración", description: "Faltan datos de la operación para crear tareas."});
        return;
    }

    setIsSubmitting(true);
    
    const tasksToCreate: Omit<LabelingOperation, 'id' | 'createdAt' | 'updatedAt' | 'status'>[] = [];
    
    assignments.forEach((operatorId, reference) => {
        const itemData = itemsToAssign.find(i => i.reference === reference);
        if(itemData) {
            tasksToCreate.push({
                receptionOperationId: operationId,
                rk_identifier: rkIdentifier,
                supplier: supplier,
                reference: itemData.reference,
                sizes: itemData.sizes,
                totalUnits: itemData.totalQuantity,
                assignedOperatorId: operatorId,
                standard_units_per_hour: globalStandard,
            });
        }
    });

    const result = await bulkCreateLabelingTasks(tasksToCreate);

    if(result.success) {
        toast({ title: "Tareas Creadas", description: `Se han creado ${result.createdCount} tareas de etiquetado.` });
        onTasksCreated();
        onOpenChange(false);
    } else {
        toast({ variant: "destructive", title: "Error al crear tareas", description: result.error });
    }

    setIsSubmitting(false);
  };

  if (isSingleTaskReassign) {
    return (
      <Dialog open={isOpen} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reasignar Operario</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Select value={singleAssignment} onValueChange={setSingleAssignment} disabled={isLoading}>
              <SelectTrigger>
                  <SelectValue placeholder={isLoading ? "Cargando..." : "Seleccionar operario..."} />
              </SelectTrigger>
              <SelectContent>
                  {operators.map(op => (
                      <SelectItem key={op.uid} value={op.uid}>{op.displayName || op.email}</SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={handleConfirm} disabled={isLoading || !singleAssignment}>Confirmar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Asignar Tareas de Etiquetado en Lote</DialogTitle>
          <DialogDescription>
            Asigne operarios a las referencias disponibles. Las tareas se crearán al confirmar.
          </DialogDescription>
        </DialogHeader>
        
        <div className="py-4">
            <Label htmlFor="global-standard">Estándar Global (unidades por hora)</Label>
            <Input
                id="global-standard"
                type="number"
                value={globalStandard}
                onChange={(e) => setGlobalStandard(Number(e.target.value))}
                className="mt-1 w-full md:w-1/3"
            />
        </div>

        <div className="flex-grow overflow-hidden border rounded-md">
            <ScrollArea className="h-full">
            <Table>
                <TableHeader className="sticky top-0 bg-secondary">
                    <TableRow>
                        <TableHead>Referencia</TableHead>
                        <TableHead>Item</TableHead>
                        <TableHead>Cantidad</TableHead>
                        <TableHead className="w-[250px]">Asignar a</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                {itemsToAssign?.map(item => (
                    <TableRow key={item.reference}>
                        <TableCell className="font-medium">{item.reference}</TableCell>
                        <TableCell>{item.item}</TableCell>
                        <TableCell>{item.totalQuantity}</TableCell>
                        <TableCell>
                            <Select
                                value={assignments.get(item.reference) || ''}
                                onValueChange={(operatorId) => handleAssignmentChange(item.reference, operatorId)}
                                disabled={isLoading}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder={isLoading ? "Cargando..." : "Seleccionar..."} />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="">-- Sin Asignar --</SelectItem>
                                    {operators.map(op => (
                                        <SelectItem key={op.uid} value={op.uid}>{op.displayName || op.email}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </TableCell>
                    </TableRow>
                ))}
                </TableBody>
            </Table>
             {!itemsToAssign || itemsToAssign.length === 0 && <p className="text-center p-8 text-muted-foreground">No hay referencias disponibles para asignar.</p>}
            </ScrollArea>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleConfirm} disabled={isSubmitting || assignments.size === 0}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirmar y Crear {assignments.size} Tarea(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

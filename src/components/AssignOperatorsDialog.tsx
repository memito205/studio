/** @jsxImportSource react */
"use client";

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
import { Loader2, User } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { AppUser, LabelingOperation, ExternalVendor } from '@/types';
import { bulkCreateLabelingTasks } from '@/app/reception/actions';

interface GroupedItem {
  reference: string;
  item: string;
  totalQuantity: number;
  sizes: { [size: string]: number };
}

interface AssignmentData {
    operatorId: string;
    externalOperatorName?: string;
}

interface AssignOperatorsDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  itemsToAssign?: GroupedItem[];
  operators: AppUser[];
  externalVendors?: ExternalVendor[];
  isLoading: boolean;
  onAssign: (operatorIds: string[]) => void;
  onTasksCreated?: () => void; 
  operationId?: string; 
  rkIdentifier?: string; 
  supplier?: string; 
  isSingleTaskReassign?: boolean;
  initialAssignedIds?: string[];
}

export const AssignOperatorsDialog: React.FC<AssignOperatorsDialogProps> = ({
  isOpen,
  onOpenChange,
  itemsToAssign,
  operators,
  externalVendors = [],
  isLoading,
  onAssign,
  onTasksCreated,
  operationId,
  rkIdentifier,
  supplier,
  isSingleTaskReassign = false,
  initialAssignedIds = [],
}) => {
  const [assignments, setAssignments] = useState<Map<string, AssignmentData>>(new Map());
  const [singleAssignment, setSingleAssignment] = useState<string>(initialAssignedIds[0] || '');
  const [singleExtName, setSingleExtName] = useState<string>('');
  const [globalStandard, setGlobalStandard] = useState<number>(150);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen) {
      if (isSingleTaskReassign) {
        setSingleAssignment(initialAssignedIds[0] || '');
        setSingleExtName('');
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
            newMap.set(reference, { operatorId, externalOperatorName: '' });
        } else {
            newMap.delete(reference);
        }
        return newMap;
    });
  };

  const handleExternalNameChange = (reference: string, name: string) => {
      setAssignments(prev => {
          const newMap = new Map(prev);
          const current = newMap.get(reference);
          if (current) {
              newMap.set(reference, { ...current, externalOperatorName: name });
          }
          return newMap;
      });
  };
  
  const handleConfirm = async () => {
    if (isSingleTaskReassign) {
        // Warning: Local state only supports ID for onAssign. 
        // If reassign needs external name, onAssign should be updated too.
        onAssign([singleAssignment]);
        return;
    }

    if (!itemsToAssign || assignments.size === 0) {
        toast({ variant: "destructive", title: "Sin asignaciones", description: "Por favor, asigne al menos una referencia." });
        return;
    }

    // Validation for external names
    let allValid = true;
    assignments.forEach((v) => {
        if (v.operatorId.startsWith('ext_') && !v.externalOperatorName) {
            allValid = false;
        }
    });

    if (!allValid) {
        toast({ variant: "destructive", title: "Incompleto", description: "Debe seleccionar el operario específico para las asignaciones externas." });
        return;
    }
    
    if(!operationId || !rkIdentifier || !supplier || !onTasksCreated) {
        toast({ variant: "destructive", title: "Error de configuración", description: "Faltan datos de la operación para crear tareas."});
        return;
    }

    setIsSubmitting(true);
    const tasksToCreate: Omit<LabelingOperation, 'id' | 'createdAt' | 'updatedAt' | 'status'>[] = [];
    
    assignments.forEach((v, reference) => {
        const itemData = itemsToAssign.find(i => i.reference === reference);
        if(itemData) {
            const isExternal = v.operatorId.startsWith('ext_');
            const cleanId = v.operatorId.replace('ext_', '');
            
            tasksToCreate.push({
                receptionOperationId: operationId,
                rk_identifier: rkIdentifier,
                supplier: supplier,
                reference: itemData.reference,
                sizes: itemData.sizes,
                totalUnits: itemData.totalQuantity,
                assignedOperatorId: isExternal ? '' : v.operatorId,
                assignedExternalVendorId: isExternal ? cleanId : undefined,
                assignedExternalOperatorName: isExternal ? v.externalOperatorName : undefined,
                isExternal: isExternal,
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
    const isSingleExt = singleAssignment.startsWith('ext_');
    const singleVendor = isSingleExt ? externalVendors.find(v => `ext_${v.id}` === singleAssignment) : null;

    return (
      <Dialog open={isOpen} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reasignar Operario</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Select value={singleAssignment} onValueChange={setSingleAssignment} disabled={isLoading}>
              <SelectTrigger>
                  <SelectValue placeholder={isLoading ? "Cargando..." : "Seleccionar..."} />
              </SelectTrigger>
              <SelectContent>
                  {operators.map(op => (
                      <SelectItem key={op.uid} value={op.uid}>[Interno] {op.displayName || op.email}</SelectItem>
                  ))}
                  {externalVendors?.map(vendor => (
                      <SelectItem key={vendor.id} value={`ext_${vendor.id}`}>[Externo] {vendor.name}</SelectItem>
                  ))}
              </SelectContent>
            </Select>

            {isSingleExt && singleVendor && (
                <div className="animate-in fade-in slide-in-from-top-1">
                    <Label className="text-[10px] text-amber-600 mb-1 block">Elegir Operario</Label>
                    <Select value={singleExtName} onValueChange={setSingleExtName}>
                        <SelectTrigger className="h-9 text-sm border-amber-200">
                            <SelectValue placeholder="Elegir trabajador..." />
                        </SelectTrigger>
                        <SelectContent>
                            {singleVendor.operators?.map((op, i) => (
                                <SelectItem key={i} value={op.name}>{op.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={handleConfirm} disabled={isLoading || !singleAssignment || (isSingleExt && !singleExtName)}>Confirmar</Button>
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
            Asigne operarios a las referencias disponibles.
          </DialogDescription>
        </DialogHeader>
        
        <div className="py-4 border-b">
            <Label htmlFor="global-standard">Estándar Global (unidades por hora)</Label>
            <Input
                id="global-standard"
                type="number"
                value={globalStandard}
                onChange={(e) => setGlobalStandard(Number(e.target.value))}
                className="mt-1 w-full md:w-1/3 h-9"
            />
        </div>

        <div className="flex-grow overflow-hidden border rounded-md mt-4">
            <ScrollArea className="h-full">
            <Table>
                <TableHeader className="sticky top-0 bg-secondary z-10">
                    <TableRow>
                        <TableHead>Referencia</TableHead>
                        <TableHead>Item</TableHead>
                        <TableHead>Cantidad</TableHead>
                        <TableHead className="w-[300px]">Asignar a</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                {itemsToAssign?.map(item => {
                    const currentAssignment = assignments.get(item.reference);
                    const isExtRow = currentAssignment?.operatorId?.startsWith('ext_');
                    const vendorRow = isExtRow ? externalVendors.find(v => `ext_${v.id}` === currentAssignment?.operatorId) : null;

                    return (
                        <TableRow key={item.reference}>
                            <TableCell className="font-medium text-xs">{item.reference}</TableCell>
                            <TableCell className="text-xs">{item.item}</TableCell>
                            <TableCell className="text-xs font-bold">{item.totalQuantity}</TableCell>
                            <TableCell>
                                <div className="space-y-2 py-1">
                                    <Select
                                        value={currentAssignment?.operatorId || ''}
                                        onValueChange={(val) => handleAssignmentChange(item.reference, val)}
                                        disabled={isLoading}
                                    >
                                        <SelectTrigger className="h-8 text-[11px]">
                                            <SelectValue placeholder={isLoading ? "Cargando..." : "Seleccionar..."} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {operators.map(op => (
                                                <SelectItem key={op.uid} value={op.uid}>[Int] {op.displayName || op.email}</SelectItem>
                                            ))}
                                            {externalVendors.map(vendor => (
                                                <SelectItem key={vendor.id} value={`ext_${vendor.id}`}>[Ext] {vendor.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>

                                    {isExtRow && vendorRow && (
                                        <div className="flex items-center gap-1 animate-in fade-in slide-in-from-left-1">
                                            <User className="h-3 w-3 text-amber-600" />
                                            <Select
                                                value={currentAssignment?.externalOperatorName || ''}
                                                onValueChange={(val) => handleExternalNameChange(item.reference, val)}
                                            >
                                                <SelectTrigger className="h-7 text-[10px] border-amber-200 bg-amber-50/20">
                                                    <SelectValue placeholder="Elegir operario..." />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {vendorRow.operators?.map((op, i) => (
                                                        <SelectItem key={i} value={op.name}>{op.name}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    )}
                                </div>
                            </TableCell>
                        </TableRow>
                    );
                })}
                </TableBody>
            </Table>
             {!itemsToAssign || itemsToAssign.length === 0 && <p className="text-center p-8 text-muted-foreground">No hay referencias disponibles para asignar.</p>}
            </ScrollArea>
        </div>

        <DialogFooter className="mt-4">
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

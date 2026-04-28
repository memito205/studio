/** @jsxImportSource react */
"use client";

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft, Loader2, Tag, Users } from 'lucide-react';
import type { ReceptionOperation, ReceptionExpectedItem, AppUser, LabelingOperation } from '@/types';
import { CreateLabelingTaskDialog } from './CreateLabelingTaskDialog';
import { AssignOperatorsDialog } from './AssignOperatorsDialog';
import { getAllUserProfiles, loadLabelingOperations, getExternalVendors } from '@/app/reception/actions';
import { useToast } from '@/hooks/use-toast';
import { Badge } from './ui/badge';
import type { ExternalVendor } from '@/types';

interface LabelingPreparationScreenProps {
  operation: ReceptionOperation;
  onReturn: () => void;
}

export interface GroupedItem {
  reference: string;
  item: string;
  totalQuantity: number;
  sizes: { [size: string]: number };
  status: 'Disponible' | 'Asignada';
}

export const LabelingPreparationScreen: React.FC<LabelingPreparationScreenProps> = ({ operation, onReturn }) => {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isAssignDialogOpen, setIsAssignDialogOpen] = useState(false);
  const [selectedReference, setSelectedReference] = useState<GroupedItem | null>(null);
  const [operators, setOperators] = useState<AppUser[]>([]);
  const [externalVendors, setExternalVendors] = useState<ExternalVendor[]>([]);
  const [loadingOperators, setLoadingOperators] = useState(true);
  const [loadingVendors, setLoadingVendors] = useState(true);
  const [existingTasks, setExistingTasks] = useState<LabelingOperation[]>([]);
  const { toast } = useToast();

  const fetchDependencies = useCallback(async () => {
    setLoadingOperators(true);
    setLoadingVendors(true);
    const [tasksResult, usersResult, vendorsResult] = await Promise.all([
      loadLabelingOperations(),
      getAllUserProfiles(),
      getExternalVendors()
    ]);
    
    if(tasksResult.data) {
        setExistingTasks(tasksResult.data.filter(task => task.receptionOperationId === operation.id));
    }

    if(usersResult) {
        setOperators(usersResult);
    } else {
        toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar los operarios.' });
    }

    if (vendorsResult.success && vendorsResult.data) {
        setExternalVendors(vendorsResult.data);
    }
    
    setLoadingVendors(false);
    setLoadingOperators(false);
  }, [operation.id, toast]);

  useEffect(() => {
    fetchDependencies();
  }, [fetchDependencies]);


  const groupedItems = useMemo((): GroupedItem[] => {
    const map = new Map<string, Omit<GroupedItem, 'status'>>();
    (operation.expectedItems || []).forEach(item => {
      const refKey = item.reference;
      if (!map.has(refKey)) {
        map.set(refKey, {
          reference: item.reference,
          item: item.item,
          totalQuantity: 0,
          sizes: {},
        });
      }
      const grouped = map.get(refKey)!;
      grouped.totalQuantity += item.expected_quantity;
      grouped.sizes[item.size] = (grouped.sizes[item.size] || 0) + item.expected_quantity;
    });

    const assignedReferences = new Set(existingTasks.map(task => task.reference));

    return Array.from(map.values()).map(item => ({
        ...item,
        status: assignedReferences.has(item.reference) ? 'Asignada' : 'Disponible'
    }));
  }, [operation.expectedItems, existingTasks]);

  const handleCreateTaskClick = async (item: GroupedItem) => {
    if (item.status === 'Asignada') {
        toast({
            variant: "default",
            title: "Referencia ya asignada",
            description: "Esta referencia ya tiene una tarea de etiquetado creada.",
        });
        return;
    }
    setSelectedReference(item);
    setIsCreateDialogOpen(true);
  };

  const onTaskCreated = () => {
    toast({
      title: 'Tarea de Etiquetado Creada',
      description: 'La tarea ahora está visible en el módulo de etiquetado.',
    });
    fetchDependencies();
  };

  const availableItemsForBulkAssign = useMemo(() => {
      return groupedItems.filter(item => item.status === 'Disponible');
  }, [groupedItems]);

  return (
    <>
      <CreateLabelingTaskDialog
        isOpen={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        referenceData={selectedReference}
        operators={operators}
        externalVendors={externalVendors}
        isLoadingOperators={loadingOperators || loadingVendors}
        operationId={operation.id}
        rkIdentifier={operation.rk_identifier}
        supplier={operation.supplier}
        onTaskCreated={onTaskCreated}
      />
      <AssignOperatorsDialog
        isOpen={isAssignDialogOpen}
        onOpenChange={setIsAssignDialogOpen}
        itemsToAssign={availableItemsForBulkAssign}
        operators={operators}
        externalVendors={externalVendors}
        isLoading={loadingOperators || loadingVendors}
        onTasksCreated={fetchDependencies}
        operationId={operation.id}
        rkIdentifier={operation.rk_identifier}
        supplier={operation.supplier}
        onAssign={() => {}} // Not used for bulk
      />
      <Card>
        <CardHeader className="flex flex-row justify-between items-center">
          <div>
            <CardTitle>Preparar Tareas de Etiquetado</CardTitle>
            <CardDescription>RK: {operation.rk_identifier} - {operation.supplier}</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setIsAssignDialogOpen(true)} disabled={loadingOperators || availableItemsForBulkAssign.length === 0}>
                <Users className="mr-2 h-4 w-4" /> Asignar Tareas en Lote
            </Button>
            <Button onClick={onReturn} variant="outline">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Volver a Operaciones
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            A continuación se muestra un resumen de las referencias en esta operación. Haga clic en "Crear Tarea" para una asignación individual o use la opción de lote.
          </p>
          <div className="border rounded-md">
            {loadingOperators ? (
                 <div className="flex justify-center items-center h-64"><Loader2 className="h-8 w-8 animate-spin" /></div>
            ) : (
                <Table>
                <TableHeader>
                    <TableRow>
                    <TableHead>Referencia</TableHead>
                    <TableHead>Ítem</TableHead>
                    <TableHead>Tallas y Cantidades</TableHead>
                    <TableHead className="text-right">Cantidad Total</TableHead>
                    <TableHead className="text-center">Estado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {groupedItems.map((item) => (
                    <TableRow key={item.reference}>
                        <TableCell className="font-medium">{item.reference}</TableCell>
                        <TableCell>{item.item}</TableCell>
                        <TableCell>
                        <div className="flex flex-wrap gap-x-4 gap-y-1">
                            {Object.entries(item.sizes).map(([size, qty]) => (
                            <span key={size} className="text-xs text-muted-foreground">
                                {size}: <span className="font-semibold text-foreground">{qty}</span>
                            </span>
                            ))}
                        </div>
                        </TableCell>
                        <TableCell className="text-right font-bold">{item.totalQuantity}</TableCell>
                        <TableCell className="text-center">
                            <Badge variant={item.status === 'Disponible' ? 'secondary' : 'default'}>{item.status}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                        <Button size="sm" onClick={() => handleCreateTaskClick(item)} disabled={loadingOperators || item.status === 'Asignada'}>
                            {loadingOperators && selectedReference?.reference === item.reference ? <Loader2 className="h-4 w-4 animate-spin" /> : <Tag className="mr-2 h-4 w-4" />}
                            Crear Tarea
                        </Button>
                        </TableCell>
                    </TableRow>
                    ))}
                </TableBody>
                </Table>
            )}
             {groupedItems.length === 0 && !loadingOperators && (
                <p className="text-center py-8 text-muted-foreground">Esta operación no tiene ítems esperados definidos.</p>
             )}
          </div>
        </CardContent>
      </Card>
    </>
  );
};

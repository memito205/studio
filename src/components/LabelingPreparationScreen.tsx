/** @jsxImportSource react */
"use client";

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft, Loader2, Package, Tag, Users } from 'lucide-react';
import type { ReceptionOperation, AppUser, LabelingOperation, LabelingOperationStatus } from '@/types';
import { CreateLabelingTaskDialog } from './CreateLabelingTaskDialog';
import { AssignOperatorsDialog } from './AssignOperatorsDialog';
import { getAllUserProfiles, loadLabelingOperations, getExternalVendors, rebuildReceptionPackSummaries, getReceptionPackSummaries, convertPendingLabelingTaskToPackUnits, convertPendingPackUnitsForReception } from '@/app/reception/actions';
import { useToast } from '@/hooks/use-toast';
import { Badge } from './ui/badge';
import type { ExternalVendor } from '@/types';
import { normalizeReceptionReference } from '@/lib/receptionReference';

interface LabelingPreparationScreenProps {
  operation: ReceptionOperation;
  onReturn: () => void;
}

/** Estado agregado de la referencia según sus tareas de etiquetado. */
export type PrepReferenceStatus =
  | 'Disponible'
  | 'Pendiente'
  | 'Asignada'
  | 'En Progreso'
  | 'Pausada'
  | 'Completada'
  | 'Parcial';

export interface GroupedItem {
  reference: string;
  item: string;
  totalQuantity: number;
  sizes: { [size: string]: number };
  status: PrepReferenceStatus;
  /** Unidades aún no cubiertas por tareas activas + completadas. */
  remainingUnits: number;
  /** Hay tarea residual (parentTaskId) pendiente de reasignar en Etiquetado. */
  hasResidual: boolean;
  openTaskCount: number;
  /** Tiene resumen de cajas (packUnitsById) → nuevas tareas irán en modo pack_units. */
  hasPackPlan: boolean;
  packUnitCount: number;
}

function badgeVariantForPrepStatus(
  status: PrepReferenceStatus
): 'secondary' | 'default' | 'outline' | 'destructive' | 'success' | 'warning' {
  switch (status) {
    case 'Disponible':
      return 'secondary';
    case 'Pendiente':
      return 'warning';
    case 'Asignada':
      return 'default';
    case 'En Progreso':
      return 'default';
    case 'Pausada':
      return 'outline';
    case 'Completada':
      return 'success';
    case 'Parcial':
      return 'warning';
    default:
      return 'secondary';
  }
}

function deriveReferenceStatus(
  totalQuantity: number,
  tasks: LabelingOperation[],
  packMeta?: { hasPackPlan: boolean; packUnitCount: number }
): Pick<GroupedItem, 'status' | 'remainingUnits' | 'hasResidual' | 'openTaskCount' | 'hasPackPlan' | 'packUnitCount'> {
  const hasPackPlan = Boolean(packMeta?.hasPackPlan);
  const packUnitCount = packMeta?.packUnitCount || 0;
  if (!tasks.length) {
    return {
      status: 'Disponible',
      remainingUnits: totalQuantity,
      hasResidual: false,
      openTaskCount: 0,
      hasPackPlan,
      packUnitCount,
    };
  }

  const openStatuses: LabelingOperationStatus[] = [
    'Pendiente',
    'Asignada',
    'En Progreso',
    'Pausada',
  ];
  const openTasks = tasks.filter((t) => openStatuses.includes(t.status));
  const completedTasks = tasks.filter((t) => t.status === 'Completada');

  const doneUnits = completedTasks.reduce(
    (s, t) => s + (Number(t.completedUnits) || Number(t.totalUnits) || 0),
    0
  );
  const openUnits = openTasks.reduce((s, t) => s + (Number(t.totalUnits) || 0), 0);
  const covered = doneUnits + openUnits;
  const remainingUnits = Math.max(0, totalQuantity - covered);
  const hasResidual = tasks.some(
    (t) => Boolean(t.parentTaskId) && t.status !== 'Completada'
  );

  if (openTasks.some((t) => t.status === 'En Progreso')) {
    return { status: 'En Progreso', remainingUnits, hasResidual, openTaskCount: openTasks.length, hasPackPlan, packUnitCount };
  }
  if (openTasks.some((t) => t.status === 'Pausada')) {
    return { status: 'Pausada', remainingUnits, hasResidual, openTaskCount: openTasks.length, hasPackPlan, packUnitCount };
  }
  if (openTasks.some((t) => t.status === 'Asignada')) {
    return { status: 'Asignada', remainingUnits, hasResidual, openTaskCount: openTasks.length, hasPackPlan, packUnitCount };
  }
  if (openTasks.some((t) => t.status === 'Pendiente')) {
    return { status: 'Pendiente', remainingUnits, hasResidual, openTaskCount: openTasks.length, hasPackPlan, packUnitCount };
  }

  if (remainingUnits > 0) {
    return {
      status: 'Parcial',
      remainingUnits,
      hasResidual,
      openTaskCount: 0,
      hasPackPlan,
      packUnitCount,
    };
  }
  return {
    status: 'Completada',
    remainingUnits: 0,
    hasResidual: false,
    openTaskCount: 0,
    hasPackPlan,
    packUnitCount,
  };
}

export const LabelingPreparationScreen: React.FC<LabelingPreparationScreenProps> = ({
  operation,
  onReturn,
}) => {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isAssignDialogOpen, setIsAssignDialogOpen] = useState(false);
  const [selectedReference, setSelectedReference] = useState<GroupedItem | null>(null);
  const [operators, setOperators] = useState<AppUser[]>([]);
  const [externalVendors, setExternalVendors] = useState<ExternalVendor[]>([]);
  const [loadingOperators, setLoadingOperators] = useState(true);
  const [loadingVendors, setLoadingVendors] = useState(true);
  const [existingTasks, setExistingTasks] = useState<LabelingOperation[]>([]);
  const [loadingPackSummary, setLoadingPackSummary] = useState(false);
  const [convertingPack, setConvertingPack] = useState<string | null>(null);
  /** ref normalizada → cantidad de cajas en plan */
  const [packPlanByRef, setPackPlanByRef] = useState<Record<string, number>>({});
  const { toast } = useToast();

  const refreshPackPlanMeta = useCallback(async () => {
    const res = await getReceptionPackSummaries(operation.id);
    if (!res.success || !res.data) {
      setPackPlanByRef({});
      return;
    }
    const next: Record<string, number> = {};
    for (const [refKey, list] of Object.entries(res.data)) {
      next[normalizeReceptionReference(refKey)] = list.length;
    }
    setPackPlanByRef(next);
  }, [operation.id]);

  const fetchDependencies = useCallback(async () => {
    setLoadingOperators(true);
    setLoadingVendors(true);
    const [tasksResult, usersResult, vendorsResult] = await Promise.all([
      loadLabelingOperations({ receptionOperationId: operation.id, limitN: 200 }),
      getAllUserProfiles(),
      getExternalVendors(),
    ]);

    if (tasksResult.data) {
      setExistingTasks(tasksResult.data);
    }

    if (usersResult) {
      setOperators(usersResult);
    } else {
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar los operarios.' });
    }

    if (vendorsResult.success && vendorsResult.data) {
      setExternalVendors(vendorsResult.data);
    }

    await refreshPackPlanMeta();

    setLoadingVendors(false);
    setLoadingOperators(false);
  }, [operation.id, toast, refreshPackPlanMeta]);

  useEffect(() => {
    fetchDependencies();
  }, [fetchDependencies]);

  const groupedItems = useMemo((): GroupedItem[] => {
    const map = new Map<string, Omit<GroupedItem, 'status' | 'remainingUnits' | 'hasResidual' | 'openTaskCount' | 'hasPackPlan' | 'packUnitCount'>>();
    (operation.expectedItems || []).forEach((item) => {
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

    const tasksByRef = new Map<string, LabelingOperation[]>();
    for (const task of existingTasks) {
      const list = tasksByRef.get(task.reference) || [];
      list.push(task);
      tasksByRef.set(task.reference, list);
    }

    return Array.from(map.values()).map((item) => {
      const packKey = normalizeReceptionReference(item.reference);
      const packUnitCount = packPlanByRef[packKey] || 0;
      const derived = deriveReferenceStatus(item.totalQuantity, tasksByRef.get(item.reference) || [], {
        hasPackPlan: packUnitCount > 0,
        packUnitCount,
      });
      return { ...item, ...derived };
    });
  }, [operation.expectedItems, existingTasks, packPlanByRef]);

  const canCreateTask = (item: GroupedItem) => {
    // Solo crear desde prep si no hay trabajo abierto y aún falta cantidad
    // (Disponible o Completada/Parcial sin residual pendiente).
    if (item.openTaskCount > 0) return false;
    if (item.status === 'Completada') return false;
    if (item.status === 'Pendiente' || item.hasResidual) return false;
    return item.status === 'Disponible' || (item.status === 'Parcial' && item.remainingUnits > 0);
  };

  const handleCreateTaskClick = async (item: GroupedItem) => {
    if (!canCreateTask(item)) {
      const msg =
        item.status === 'Pendiente' || item.hasResidual
          ? 'Hay un remanente Pendiente. Reasigne la tarea residual en el módulo Etiquetado (⋯ → Reasignar Operario).'
          : item.status === 'Completada'
            ? 'Esta referencia ya está completamente etiquetada.'
            : `Esta referencia está en estado “${item.status}”. Gestione la tarea en el módulo Etiquetado.`;
      toast({
        variant: 'default',
        title: 'No se puede crear otra tarea aquí',
        description: msg,
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

  /** Fase 1/3: solo reconstruye resumen de cajas. No cambia tareas en curso. */
  const handleLoadPackUnits = async () => {
    setLoadingPackSummary(true);
    try {
      const res = await rebuildReceptionPackSummaries(operation.id);
      if (!res.success) {
        toast({
          variant: 'destructive',
          title: 'No se pudieron cargar unidades',
          description: res.error || 'Error desconocido.',
        });
        return;
      }
      toast({
        title: 'Unidades de empaque cargadas',
        description: `Referencias: ${res.references || 0} · Cajas: ${res.packUnits || 0}${
          res.scannedItems != null ? ` · Escaneos leídos: ${res.scannedItems}` : ''
        }. Las tareas ya en proceso no se modifican.`,
      });
      await refreshPackPlanMeta();

      // Fase 3: ofrecer convertir solo Pendiente (sin labor iniciada).
      const pendingLegacy = existingTasks.filter(
        (t) =>
          t.status === 'Pendiente' &&
          !(t.trackingMode === 'pack_units' && (t.labelingPackPlan?.length || 0) > 0)
      );
      if (pendingLegacy.length > 0) {
        const ok = window.confirm(
          `Hay ${pendingLegacy.length} tarea(s) Pendiente sin seguimiento por cajas. ¿Convertirlas ahora a pack_units? (No afecta Asignada/En Progreso/Pausada.)`
        );
        if (ok) {
          const conv = await convertPendingPackUnitsForReception(operation.id);
          if (conv.success) {
            toast({
              title: 'Pendientes convertidas',
              description: `Convertidas: ${conv.converted || 0} · Omitidas: ${conv.skipped || 0}.`,
            });
            await fetchDependencies();
          } else {
            toast({
              variant: 'destructive',
              title: 'Conversión',
              description: conv.error || 'No se pudieron convertir.',
            });
          }
        }
      }
    } finally {
      setLoadingPackSummary(false);
    }
  };

  const handleConvertPendingRef = async (item: GroupedItem) => {
    const pending = existingTasks.filter(
      (t) =>
        t.reference === item.reference &&
        t.status === 'Pendiente' &&
        !(t.trackingMode === 'pack_units' && (t.labelingPackPlan?.length || 0) > 0)
    );
    if (pending.length === 0) {
      toast({
        title: 'Nada que convertir',
        description: 'No hay tareas Pendiente de esta referencia en modo legado.',
      });
      return;
    }
    setConvertingPack(item.reference);
    try {
      let okCount = 0;
      for (const t of pending) {
        const res = await convertPendingLabelingTaskToPackUnits(t.id);
        if (res.success) okCount += 1;
      }
      toast({
        title: 'Seguimiento por cajas',
        description: `Convertidas ${okCount} de ${pending.length} tarea(s) Pendiente.`,
      });
      await fetchDependencies();
    } finally {
      setConvertingPack(null);
    }
  };

  const availableItemsForBulkAssign = useMemo(() => {
    return groupedItems.filter((item) => canCreateTask(item) && item.status === 'Disponible');
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
        onAssign={() => {}}
      />
      <Card>
        <CardHeader className="flex flex-row justify-between items-center">
          <div>
            <CardTitle>Preparar Tareas de Etiquetado</CardTitle>
            <CardDescription>
              RK: {operation.rk_identifier} - {operation.supplier}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleLoadPackUnits()}
              disabled={loadingOperators || loadingPackSummary}
            >
              {loadingPackSummary ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Package className="mr-2 h-4 w-4" />
              )}
              Cargar unidades de empaque a esta recepción
            </Button>
            <Button
              onClick={() => setIsAssignDialogOpen(true)}
              disabled={loadingOperators || availableItemsForBulkAssign.length === 0}
            >
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
            El estado refleja las tareas reales de etiquetado. Si un operario finaliza solo una parte, el
            remanente queda como tarea <strong>Pendiente</strong> en el módulo{' '}
            <strong>Etiquetado</strong> (no aquí): filtre por la referencia y use ⋯ → Reasignar Operario.
            Use <strong>Cargar unidades de empaque</strong> para guardar el resumen de cajas de esta
            recepción (no modifica tareas ya en proceso).
          </p>
          <div className="border rounded-md">
            {loadingOperators ? (
              <div className="flex justify-center items-center h-64">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
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
                      <TableCell className="text-center space-y-1">
                        <Badge variant={badgeVariantForPrepStatus(item.status)}>{item.status}</Badge>
                        {item.hasPackPlan ? (
                          <div className="text-[10px] text-emerald-700 dark:text-emerald-400">
                            {item.status === 'Disponible'
                              ? `Plan cajas (${item.packUnitCount}) · nuevas tareas = por caja`
                              : item.status === 'Pendiente'
                                ? `Plan cajas (${item.packUnitCount}) · se puede activar en Pendiente`
                                : `Plan cajas (${item.packUnitCount}) · info; labor abierta no se cambia`}
                          </div>
                        ) : (
                          <div className="text-[10px] text-muted-foreground">
                            Sin plan de cajas · nuevas tareas = legado
                          </div>
                        )}
                        {item.hasResidual ? (
                          <div className="text-[10px] text-muted-foreground">Remanente en Etiquetado</div>
                        ) : null}
                        {item.status === 'Parcial' && item.remainingUnits > 0 ? (
                          <div className="text-[10px] text-muted-foreground">
                            Faltan {item.remainingUnits.toLocaleString()} und
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-col items-end gap-1">
                          <Button
                            size="sm"
                            onClick={() => handleCreateTaskClick(item)}
                            disabled={loadingOperators || !canCreateTask(item)}
                          >
                            {loadingOperators && selectedReference?.reference === item.reference ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Tag className="mr-2 h-4 w-4" />
                            )}
                            Crear Tarea
                          </Button>
                          {item.status === 'Pendiente' && item.hasPackPlan ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={convertingPack === item.reference || loadingPackSummary}
                              onClick={() => void handleConvertPendingRef(item)}
                            >
                              {convertingPack === item.reference ? (
                                <Loader2 className="h-3 w-3 animate-spin mr-1" />
                              ) : null}
                              Activar seguimiento por cajas
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {groupedItems.length === 0 && !loadingOperators && (
              <p className="text-center py-8 text-muted-foreground">
                Esta operación no tiene ítems esperados definidos.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
};

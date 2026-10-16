/** @jsxImportSource react */
"use client";

import React, { useState, useEffect, useMemo } from 'react';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, User, Search } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { AppUser, LabelingOperation, ExternalVendor } from '@/types';
import { bulkCreateLabelingTasks } from '@/app/reception/actions';
import { buildAssigneeWriteFields } from '@/lib/labelingAssignees';

interface GroupedItem {
  reference: string;
  item: string;
  totalQuantity: number;
  sizes: { [size: string]: number };
  location?: string;
}

/** Asignación por referencia: un solo lado (interno XOR externo), 1 o más personas. */
interface AssignmentData {
  operatorId: string; // uid interno o ext_{vendorId}
  externalOperatorNames: string[];
  internalIds: string[];
}

export type LabelingAssigneeAssignPayload = {
  assignedOperatorId: string;
  assignedOperatorIds?: string[];
  assignedExternalVendorId?: string;
  assignedExternalOperatorName?: string;
  assignedExternalOperatorNames?: string[];
  isExternal: boolean;
};

interface AssignOperatorsDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  itemsToAssign?: GroupedItem[];
  operators: AppUser[];
  externalVendors?: ExternalVendor[];
  isLoading: boolean;
  /** Reasignar una tarea: recibe payload completo (interno o externo, multi OK). */
  onAssign: (payload: LabelingAssigneeAssignPayload) => void;
  onTasksCreated?: () => void;
  operationId?: string;
  rkIdentifier?: string;
  supplier?: string;
  isSingleTaskReassign?: boolean;
  initialAssignedIds?: string[];
  initialExternalNames?: string[];
  initialExternalVendorId?: string;
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
  initialExternalNames = [],
  initialExternalVendorId = '',
}) => {
  const [assignments, setAssignments] = useState<Map<string, AssignmentData>>(new Map());
  const [singleAssignment, setSingleAssignment] = useState<string>(
    initialExternalVendorId ? `ext_${initialExternalVendorId}` : initialAssignedIds[0] || ''
  );
  const [singleExtNames, setSingleExtNames] = useState<string[]>(initialExternalNames);
  const [singleInternalIds, setSingleInternalIds] = useState<string[]>(
    initialExternalVendorId ? [] : initialAssignedIds.filter(Boolean)
  );
  const [globalStandard, setGlobalStandard] = useState<number>(150);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [referenceFilter, setReferenceFilter] = useState('');
  const [operatorFilter, setOperatorFilter] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen) {
      if (isSingleTaskReassign) {
        const extId = initialExternalVendorId ? `ext_${initialExternalVendorId}` : '';
        setSingleAssignment(extId || initialAssignedIds[0] || '');
        setSingleExtNames(initialExternalNames.length ? initialExternalNames : []);
        setSingleInternalIds(extId ? [] : initialAssignedIds.filter(Boolean));
        setOperatorFilter('');
      } else {
        setAssignments(new Map());
        setGlobalStandard(150);
        setReferenceFilter('');
        setOperatorFilter('');
      }
    }
  }, [isOpen, isSingleTaskReassign, initialAssignedIds, initialExternalNames, initialExternalVendorId]);

  const filteredItemsToAssign = useMemo(() => {
    const tokens = referenceFilter.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return itemsToAssign || [];
    return (itemsToAssign || []).filter((item) => {
      const hay = `${item.reference} ${item.item} ${item.location || ''}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [itemsToAssign, referenceFilter]);

  const filteredOperators = useMemo(() => {
    const tokens = operatorFilter.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return operators;
    return operators.filter((op) => {
      const hay = `${op.displayName || ''} ${op.email || ''}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [operators, operatorFilter]);

  const filteredVendors = useMemo(() => {
    const tokens = operatorFilter.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return externalVendors;
    return externalVendors.filter((v) => {
      const opNames = (v.operators || []).map((o) => o.name).join(' ');
      const hay = `${v.name || ''} ${opNames}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [externalVendors, operatorFilter]);

  const filterExternalNames = (names: { name: string }[] | undefined) => {
    const list = names || [];
    const tokens = operatorFilter.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return list;
    return list.filter((op) => tokens.every((t) => op.name.toLowerCase().includes(t)));
  };

  const handleAssignmentChange = (reference: string, operatorId: string) => {
    setAssignments((prev) => {
      const newMap = new Map(prev);
      if (!operatorId) {
        newMap.delete(reference);
        return newMap;
      }
      const isExt = operatorId.startsWith('ext_');
      newMap.set(reference, {
        operatorId,
        externalOperatorNames: [],
        internalIds: isExt ? [] : [operatorId],
      });
      return newMap;
    });
  };

  const toggleExtName = (reference: string, name: string, checked: boolean) => {
    setAssignments((prev) => {
      const newMap = new Map(prev);
      const current = newMap.get(reference);
      if (!current) return prev;
      const set = new Set(current.externalOperatorNames);
      if (checked) set.add(name);
      else set.delete(name);
      newMap.set(reference, { ...current, externalOperatorNames: Array.from(set) });
      return newMap;
    });
  };

  const toggleInternalId = (reference: string, uid: string, checked: boolean) => {
    setAssignments((prev) => {
      const newMap = new Map(prev);
      const current = newMap.get(reference);
      if (!current || current.operatorId.startsWith('ext_')) return prev;
      const set = new Set(current.internalIds.length ? current.internalIds : [current.operatorId]);
      if (checked) set.add(uid);
      else set.delete(uid);
      const ids = Array.from(set);
      if (ids.length === 0) {
        newMap.delete(reference);
        return newMap;
      }
      newMap.set(reference, {
        operatorId: ids[0],
        internalIds: ids,
        externalOperatorNames: [],
      });
      return newMap;
    });
  };

  const toggleSingleExtName = (name: string, checked: boolean) => {
    setSingleExtNames((prev) => {
      const set = new Set(prev);
      if (checked) set.add(name);
      else set.delete(name);
      return Array.from(set);
    });
  };

  const toggleSingleInternal = (uid: string, checked: boolean) => {
    setSingleInternalIds((prev) => {
      const set = new Set(prev);
      if (checked) set.add(uid);
      else set.delete(uid);
      return Array.from(set);
    });
  };

  const handleConfirm = async () => {
    if (isSingleTaskReassign) {
      const isExt = singleAssignment.startsWith('ext_');
      const built = buildAssigneeWriteFields(
        isExt
          ? {
              isExternal: true,
              externalVendorId: singleAssignment.replace('ext_', ''),
              externalNames: singleExtNames,
            }
          : { isExternal: false, internalIds: singleInternalIds.length ? singleInternalIds : [singleAssignment].filter(Boolean) }
      );
      if (!built.ok) {
        toast({ variant: 'destructive', title: 'Incompleto', description: built.error });
        return;
      }
      onAssign({
        assignedOperatorId: built.fields.assignedOperatorId || '',
        assignedOperatorIds: built.fields.assignedOperatorIds,
        assignedExternalVendorId: built.fields.assignedExternalVendorId,
        assignedExternalOperatorName: built.fields.assignedExternalOperatorName,
        assignedExternalOperatorNames: built.fields.assignedExternalOperatorNames,
        isExternal: !!built.fields.isExternal,
      });
      return;
    }

    if (!itemsToAssign || assignments.size === 0) {
      toast({
        variant: 'destructive',
        title: 'Sin asignaciones',
        description: 'Por favor, asigne al menos una referencia.',
      });
      return;
    }

    let allValid = true;
    let errMsg = '';
    assignments.forEach((v) => {
      if (v.operatorId.startsWith('ext_')) {
        if (!v.externalOperatorNames.length) {
          allValid = false;
          errMsg = 'Seleccione al menos un operario externo por referencia.';
        }
      } else if (!(v.internalIds?.length || v.operatorId)) {
        allValid = false;
        errMsg = 'Seleccione al menos un operario interno.';
      }
    });

    if (!allValid) {
      toast({ variant: 'destructive', title: 'Incompleto', description: errMsg });
      return;
    }

    if (!operationId || !rkIdentifier || !supplier || !onTasksCreated) {
      toast({
        variant: 'destructive',
        title: 'Error de configuración',
        description: 'Faltan datos de la operación para crear tareas.',
      });
      return;
    }

    setIsSubmitting(true);
    const tasksToCreate: Omit<LabelingOperation, 'id' | 'createdAt' | 'updatedAt' | 'status'>[] = [];

    for (const [reference, v] of assignments.entries()) {
      const itemData = itemsToAssign.find((i) => i.reference === reference);
      if (!itemData) continue;
      const isExternal = v.operatorId.startsWith('ext_');
      const built = buildAssigneeWriteFields(
        isExternal
          ? {
              isExternal: true,
              externalVendorId: v.operatorId.replace('ext_', ''),
              externalNames: v.externalOperatorNames,
            }
          : {
              isExternal: false,
              internalIds: v.internalIds.length ? v.internalIds : [v.operatorId],
            }
      );
      if (!built.ok) {
        toast({ variant: 'destructive', title: 'Asignación inválida', description: built.error });
        setIsSubmitting(false);
        return;
      }
      tasksToCreate.push({
        receptionOperationId: operationId,
        rk_identifier: rkIdentifier,
        supplier: supplier,
        reference: itemData.reference,
        sizes: itemData.sizes,
        totalUnits: itemData.totalQuantity,
        assignedOperatorId: built.fields.assignedOperatorId || '',
        assignedOperatorIds: built.fields.assignedOperatorIds,
        assignedExternalVendorId: built.fields.assignedExternalVendorId,
        assignedExternalOperatorName: built.fields.assignedExternalOperatorName,
        assignedExternalOperatorNames: built.fields.assignedExternalOperatorNames,
        isExternal: !!built.fields.isExternal,
        standard_units_per_hour: globalStandard,
      });
    }

    const result = await bulkCreateLabelingTasks(tasksToCreate);

    if (result.success) {
      toast({
        title: 'Tareas Creadas',
        description: `Se han creado ${result.createdCount} tareas.${
          result.packUnitsCount
            ? ` ${result.packUnitsCount} con plan de cajas (seguimiento pack_units).`
            : ''
        }`,
      });
      onTasksCreated();
      onOpenChange(false);
    } else {
      toast({ variant: 'destructive', title: 'Error al crear tareas', description: result.error });
    }
    setIsSubmitting(false);
  };

  if (isSingleTaskReassign) {
    const isSingleExt = singleAssignment.startsWith('ext_');
    const singleVendor = isSingleExt
      ? externalVendors.find((v) => `ext_${v.id}` === singleAssignment)
      : null;

    return (
      <Dialog open={isOpen} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reasignar Operario(s)</DialogTitle>
            <DialogDescription>
              Solo un lado: varios internos o varios del mismo proveedor. No mezclar interno y externo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={operatorFilter}
                onChange={(e) => setOperatorFilter(e.target.value)}
                placeholder="Filtrar por nombre de operario o empresa…"
                className="pl-9 h-9"
                autoFocus
              />
            </div>
            <Select
              value={singleAssignment}
              onValueChange={(v) => {
                setSingleAssignment(v);
                setSingleExtNames([]);
                setSingleInternalIds(v.startsWith('ext_') ? [] : v ? [v] : []);
              }}
              disabled={isLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder={isLoading ? 'Cargando...' : 'Seleccionar...'} />
              </SelectTrigger>
              <SelectContent>
                {filteredOperators.map((op) => (
                  <SelectItem key={op.uid} value={op.uid}>
                    [Interno] {op.displayName || op.email}
                  </SelectItem>
                ))}
                {filteredVendors.map((vendor) => (
                  <SelectItem key={vendor.id} value={`ext_${vendor.id}`}>
                    [Externo] {vendor.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {isSingleExt && singleVendor && (
              <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50/40 p-2 max-h-40 overflow-y-auto">
                <Label className="text-[10px] text-amber-700">Operarios (puede marcar varios)</Label>
                {filterExternalNames(singleVendor.operators).map((op, i) => (
                  <label key={i} className="flex items-center gap-2 text-xs">
                    <Checkbox
                      checked={singleExtNames.includes(op.name)}
                      onCheckedChange={(c) => toggleSingleExtName(op.name, !!c)}
                    />
                    {op.name}
                  </label>
                ))}
              </div>
            )}

            {!isSingleExt && singleAssignment && (
              <div className="space-y-2 rounded-md border p-2 max-h-40 overflow-y-auto">
                <Label className="text-[10px] text-muted-foreground">
                  Internos adicionales (mismo lado)
                </Label>
                {filteredOperators.map((op) => (
                  <label key={op.uid} className="flex items-center gap-2 text-xs">
                    <Checkbox
                      checked={singleInternalIds.includes(op.uid)}
                      onCheckedChange={(c) => toggleSingleInternal(op.uid, !!c)}
                    />
                    {op.displayName || op.email}
                  </label>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={
                isLoading ||
                !singleAssignment ||
                (isSingleExt ? singleExtNames.length === 0 : singleInternalIds.length === 0)
              }
            >
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Asignar Tareas de Etiquetado en Lote</DialogTitle>
          <DialogDescription>
            Un solo lado por tarea: varios internos o varios del mismo proveedor. Estándar compartido.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 border-b space-y-3">
          <div>
            <Label htmlFor="global-standard">Estándar Global (unidades por hora)</Label>
            <Input
              id="global-standard"
              type="number"
              value={globalStandard}
              onChange={(e) => setGlobalStandard(Number(e.target.value))}
              className="mt-1 w-full md:w-1/3 h-9"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={referenceFilter}
                onChange={(e) => setReferenceFilter(e.target.value)}
                placeholder="Filtrar referencia, nombre (ítem) o ubicación…"
                className="pl-9 h-9"
                autoFocus
              />
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={operatorFilter}
                onChange={(e) => setOperatorFilter(e.target.value)}
                placeholder="Filtrar operario o empresa por nombre…"
                className="pl-9 h-9"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Mostrando {filteredItemsToAssign.length} de {(itemsToAssign || []).length} referencia(s)
            {operatorFilter.trim()
              ? ` · operarios: ${filteredOperators.length} int. / ${filteredVendors.length} ext.`
              : ''}
          </p>
        </div>

        <div className="flex-grow overflow-hidden border rounded-md mt-4">
          <ScrollArea className="h-full">
            <Table>
              <TableHeader className="sticky top-0 bg-secondary z-10">
                <TableRow>
                  <TableHead>Referencia</TableHead>
                  <TableHead>Ítem</TableHead>
                  <TableHead>Ubicación</TableHead>
                  <TableHead>Cantidad</TableHead>
                  <TableHead className="w-[340px]">Asignar a</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItemsToAssign.map((item) => {
                  const currentAssignment = assignments.get(item.reference);
                  const isExtRow = currentAssignment?.operatorId?.startsWith('ext_');
                  const vendorRow = isExtRow
                    ? externalVendors.find((v) => `ext_${v.id}` === currentAssignment?.operatorId)
                    : null;
                  const internalSelected = currentAssignment?.internalIds || [];

                  return (
                    <TableRow key={item.reference}>
                      <TableCell className="font-medium text-xs">{item.reference}</TableCell>
                      <TableCell className="text-xs">{item.item}</TableCell>
                      <TableCell className="text-xs font-medium">
                        {item.location ? item.location : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-xs font-bold">{item.totalQuantity}</TableCell>
                      <TableCell>
                        <div className="space-y-2 py-1">
                          <Select
                            value={currentAssignment?.operatorId || ''}
                            onValueChange={(val) => handleAssignmentChange(item.reference, val)}
                            disabled={isLoading}
                          >
                            <SelectTrigger className="h-8 text-[11px]">
                              <SelectValue placeholder={isLoading ? 'Cargando...' : 'Seleccionar...'} />
                            </SelectTrigger>
                            <SelectContent>
                              {filteredOperators.map((op) => (
                                <SelectItem key={op.uid} value={op.uid}>
                                  [Int] {op.displayName || op.email}
                                </SelectItem>
                              ))}
                              {filteredVendors.map((vendor) => (
                                <SelectItem key={vendor.id} value={`ext_${vendor.id}`}>
                                  [Ext] {vendor.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                          {isExtRow && vendorRow && (
                            <div className="space-y-1 rounded border border-amber-200 bg-amber-50/30 p-1.5 max-h-28 overflow-y-auto">
                              <div className="flex items-center gap-1 text-[10px] text-amber-700 font-medium">
                                <User className="h-3 w-3" /> Operarios (varios OK)
                              </div>
                              {filterExternalNames(vendorRow.operators).map((op, i) => (
                                <label key={i} className="flex items-center gap-1.5 text-[10px]">
                                  <Checkbox
                                    checked={currentAssignment?.externalOperatorNames?.includes(op.name)}
                                    onCheckedChange={(c) => toggleExtName(item.reference, op.name, !!c)}
                                  />
                                  {op.name}
                                </label>
                              ))}
                            </div>
                          )}

                          {!isExtRow && currentAssignment?.operatorId && (
                            <div className="space-y-1 rounded border p-1.5 max-h-28 overflow-y-auto">
                              <p className="text-[10px] text-muted-foreground">+ Internos (mismo lado)</p>
                              {filteredOperators.map((op) => (
                                <label key={op.uid} className="flex items-center gap-1.5 text-[10px]">
                                  <Checkbox
                                    checked={internalSelected.includes(op.uid)}
                                    onCheckedChange={(c) => toggleInternalId(item.reference, op.uid, !!c)}
                                  />
                                  {op.displayName || op.email}
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {filteredItemsToAssign.length === 0 && (
              <p className="text-center p-8 text-muted-foreground">
                {referenceFilter.trim()
                  ? 'No hay referencias que coincidan con la búsqueda.'
                  : 'No hay referencias disponibles para asignar.'}
              </p>
            )}
          </ScrollArea>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={isSubmitting || assignments.size === 0}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirmar y Crear {assignments.size} Tarea(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

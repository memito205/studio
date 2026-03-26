/** @jsxImportSource react */
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2, MoreHorizontal, Users, Target, FileDown, Tag } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { LabelingOperation, LabelingOperationStatus, LabelingActivityLog, AppUser, ReceptionExpectedItem, OperationPulse } from '@/types';
import { loadLabelingOperations, updateLabelingOperation, getExpectedItemsForLabeling, getAllUserProfiles, getLabelingActivityLog } from '@/app/reception/actions';
import { getUserGoals, getProductivitySettings, getPulsesByDate } from '@/app/actions';
import { useSuitePulse } from '@/hooks/useSuitePulse';
import { AssignOperatorsDialog } from './AssignOperatorsDialog';
import { SetLabelingStandardDialog } from './SetLabelingStandardDialog';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { useAuth } from '@/hooks/use-auth-context';
import LabelingOperatorView from './LabelingOperatorView';
import { LabelingActivityLogDialog } from './LabelingActivityLogDialog'; // Importar el nuevo diálogo


interface MerchandiseLabelingProps {
  onReturnToSuite: () => void;
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

interface ProductivityMetrics {
    productiveTimeMinutes: number;
    unitsPerHour: number;
    compliance: number;
}

const AdminDashboard: React.FC<{
    operations: LabelingOperation[];
    productivityData: Map<string, ProductivityMetrics>;
    isSubmitting: boolean;
    onOpenDialog: (operation: LabelingOperation, dialog: 'assign' | 'standard' | 'log') => void;
    onGenerateExcel: (operation: LabelingOperation) => void;
    users: AppUser[];
}> = ({ operations, productivityData, isSubmitting, onOpenDialog, onGenerateExcel, users }) => {
    
    const userMap = useMemo(() => new Map(users.map(u => [u.uid, u.displayName || u.email])), [users]);
    
    return (
    <div className="border rounded-md">
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>RK / Referencia</TableHead>
                    <TableHead>Operario</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Progreso</TableHead>
                    <TableHead>Estándar</TableHead>
                    <TableHead>T. Productivo</TableHead>
                    <TableHead>Prod. Real</TableHead>
                    <TableHead>Cumplimiento</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {operations.map((op) => {
                    const metrics = productivityData.get(op.id);
                    const assignedUserName = op.assignedOperatorId ? userMap.get(op.assignedOperatorId) : 'Ninguno';
                    return (
                        <TableRow key={op.id}>
                            <TableCell>
                                <div className="font-medium">{op.rk_identifier}</div>
                                <div className="text-sm text-muted-foreground">{op.reference}</div>
                            </TableCell>
                            <TableCell>{assignedUserName}</TableCell>
                            <TableCell>
                                <Badge variant={getStatusVariant(op.status)}>{op.status}</Badge>
                            </TableCell>
                            <TableCell>
                                {op.status === 'Completada' ? `${op.completedUnits || 0} / ${op.totalUnits}` : op.totalUnits.toLocaleString()}
                            </TableCell>
                            <TableCell>{op.standard_units_per_hour || 'N/A'}</TableCell>
                            <TableCell>{metrics ? `${metrics.productiveTimeMinutes.toFixed(0)} min` : '-'}</TableCell>
                            <TableCell>{metrics ? `${metrics.unitsPerHour.toFixed(1)} u/h` : '-'}</TableCell>
                            <TableCell>
                                {metrics ? (
                                    <Badge variant={metrics.compliance >= 95 ? 'success' : metrics.compliance >= 85 ? 'warning' : 'destructive'}>
                                        {metrics.compliance.toFixed(1)}%
                                    </Badge>
                                ) : '-'}
                            </TableCell>
                            <TableCell className="text-right">
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        <DropdownMenuItem onClick={() => onOpenDialog(op, 'log')}>Ver Actividad</DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => onOpenDialog(op, 'assign')} disabled={op.status === 'En Progreso' || op.status === 'Completada'}>
                                            <Users className="mr-2 h-4 w-4" /> Reasignar Operario
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => onOpenDialog(op, 'standard')}>
                                            <Target className="mr-2 h-4 w-4" /> Definir Estándar
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => onGenerateExcel(op)} disabled={isSubmitting}>
                                            <FileDown className="mr-2 h-4 w-4" /> Generar Excel de Trabajo
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </TableCell>
                        </TableRow>
                    )
                })}
            </TableBody>
        </Table>
    </div>
);
}

export const MerchandiseLabeling: React.FC<MerchandiseLabelingProps> = ({ onReturnToSuite }) => {
  const [operations, setOperations] = useState<LabelingOperation[]>([]);
  const [allUsers, setAllUsers] = useState<AppUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [productivityData, setProductivityData] = useState<Map<string, ProductivityMetrics>>(new Map());
  const [externalPulses, setExternalPulses] = useState<OperationPulse[]>([]);
  
  const [isAssignDialogOpen, setIsAssignDialogOpen] = useState(false);
  const [isStandardDialogOpen, setIsStandardDialogOpen] = useState(false);
  const [isActivityLogOpen, setIsActivityLogOpen] = useState(false);
  const [selectedOperation, setSelectedOperation] = useState<LabelingOperation | null>(null);
  const [selectedLog, setSelectedLog] = useState<LabelingActivityLog[]>([]);


  const { toast } = useToast();
  const { user, role } = useAuth();
  const { allPulses } = useSuitePulse();


  const calculateProductivity = (logs: LabelingActivityLog[], operation: LabelingOperation, allExternalPulses: OperationPulse[]): ProductivityMetrics | null => {
      const startLog = logs.find(l => l.type === 'START');
      const finishLog = logs.find(l => l.type === 'FINISH');
      
      if (!startLog || !finishLog) return null;

      const startTime = new Date(startLog.timestamp).getTime();
      const finishTime = new Date(finishLog.timestamp).getTime();
      
      // 1. Collect all pause intervals
      const relevantPulses = allExternalPulses.filter(p => p.isGlobal || p.userId === operation.assignedOperatorId);
      const activePulseFromContext = allExternalPulses.find(p => !p.endTime && (p.isGlobal || p.userId === operation.assignedOperatorId));
      const rawIntervals = [
          ...logs.filter(l => l.type === 'PAUSE').map(p => {
              const res = logs.find(l => l.type === 'RESUME' && new Date(l.timestamp).getTime() > new Date(p.timestamp).getTime());
              return { start: new Date(p.timestamp).getTime(), end: res ? new Date(res.timestamp).getTime() : finishTime };
          }),
          ...relevantPulses.map((p: OperationPulse) => ({ start: new Date(p.startTime).getTime(), end: p.endTime ? new Date(p.endTime).getTime() : finishTime }))
      ];

      // Explicitly add the active pulse if it's not already in relevantPulses or if it's missing end time
      if (activePulseFromContext && !rawIntervals.some(r => r.start === activePulseFromContext.startTime.getTime())) {
          rawIntervals.push({
              start: activePulseFromContext.startTime.getTime(),
              end: finishTime
          });
      }

      // 2. Sort and Merge Overlapping Intervals
      rawIntervals.sort((a, b) => a.start - b.start);
      const mergedIntervals: {start: number, end: number}[] = [];
      
      if (rawIntervals.length > 0) {
          let current = { ...rawIntervals[0] };
          for (let i = 1; i < rawIntervals.length; i++) {
              if (rawIntervals[i].start <= current.end) {
                  current.end = Math.max(current.end, rawIntervals[i].end);
              } else {
                  mergedIntervals.push(current);
                  current = { ...rawIntervals[i] };
              }
          }
          mergedIntervals.push(current);
      }

      // 3. Sum non-overlapping pause durations within the operational window
      let totalPauseMillis = 0;
      mergedIntervals.forEach(p => {
          const effStart = Math.max(p.start, startTime);
          const effEnd = Math.min(p.end, finishTime);
          if (effEnd > effStart) {
              totalPauseMillis += (effEnd - effStart);
          }
      });
      
      const totalMillis = finishTime - startTime;
      const productiveMillis = totalMillis - totalPauseMillis;
      const productiveMinutes = productiveMillis / 60000;
      
      if (productiveMinutes <= 0) return { productiveTimeMinutes: 0, unitsPerHour: 0, compliance: 0 };
      
      // Use completedUnits for accurate calculation
      const unitsCompleted = operation.completedUnits ?? operation.totalUnits;
      const unitsPerHour = (unitsCompleted / productiveMinutes) * 60;
      const standard = operation.standard_units_per_hour || 0;
      const compliance = standard > 0 ? (unitsPerHour / standard) * 100 : 0;
      
      return {
          productiveTimeMinutes: productiveMinutes,
          unitsPerHour: unitsPerHour,
          compliance: compliance
      };
  };

  const fetchOperationsAndProductivity = useCallback(async () => {
    setIsLoading(true);
    const [opsResult, usersResult] = await Promise.all([
      loadLabelingOperations(),
      getAllUserProfiles()
    ]);
    
    if (usersResult) {
      setAllUsers(usersResult);
    } else {
       toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar los perfiles de usuario.' });
    }

    if (opsResult.success && opsResult.data) {
      const fetchedOps = opsResult.data;
      setOperations(fetchedOps);

      // Real-time pulses are now provided by useSuitePulse

      const completedOps = fetchedOps.filter(op => op.status === 'Completada');
      const newProductivityData = new Map<string, ProductivityMetrics>();

      for (const op of completedOps) {
          const logResult = await getLabelingActivityLog(op.id);
          if (logResult.success && logResult.data) {
              const metrics = calculateProductivity(logResult.data, op, allPulses);
              if (metrics) {
                  newProductivityData.set(op.id, metrics);
              }
          }
      }
      setProductivityData(newProductivityData);

    } else {
      toast({ variant: 'destructive', title: 'Error', description: opsResult.error });
    }
    setIsLoading(false);
  }, [toast]);

  useEffect(() => {
    fetchOperationsAndProductivity();
  }, [fetchOperationsAndProductivity, allPulses]);
  
  const handleOpenDialog = async (operation: LabelingOperation, dialog: 'assign' | 'standard' | 'log') => {
    setSelectedOperation(operation);
    if (dialog === 'assign') setIsAssignDialogOpen(true);
    if (dialog === 'standard') setIsStandardDialogOpen(true);
    if (dialog === 'log') {
        const logResult = await getLabelingActivityLog(operation.id);
        if (logResult.data) {
            setSelectedLog(logResult.data);
            setIsActivityLogOpen(true);
        } else {
            toast({ variant: 'destructive', title: "Error", description: "No se pudo cargar el log de actividad." });
        }
    }
  };
  
  const handleAssignOperator = async (operatorIds: string[]) => {
    if (!selectedOperation) return;
    setIsSubmitting(true);
    const operatorId = operatorIds[0] || ''; 
    const result = await updateLabelingOperation(selectedOperation.id, { 
      assignedOperatorId: operatorId,
      status: operatorId && selectedOperation.status === 'Pendiente' ? 'Asignada' : selectedOperation.status
    });
    if (result.success) {
      toast({ title: 'Éxito', description: 'Operario asignado correctamente.' });
      fetchOperationsAndProductivity();
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.error });
    }
    setIsSubmitting(false);
    setIsAssignDialogOpen(false);
  };

  const handleSetStandard = async (standard: number) => {
    if (!selectedOperation) return;
    setIsSubmitting(true);
    const result = await updateLabelingOperation(selectedOperation.id, { standard_units_per_hour: standard });
     if (result.success) {
      toast({ title: 'Éxito', description: 'Estándar de productividad actualizado.' });
      fetchOperationsAndProductivity();
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.error });
    }
    setIsSubmitting(false);
    setIsStandardDialogOpen(false);
  };
  
  const handleGenerateExcel = async (operation: LabelingOperation) => {
    setIsSubmitting(true);
    const result = await getExpectedItemsForLabeling(operation.receptionOperationId);
    if (result.success && result.data) {
        const itemsForReference = result.data.filter(item => item.reference === operation.reference);

        const dataToExport = itemsForReference.map(item => ({
            'Referencia': item.reference,
            'Talla': item.size,
            'Descripción': item.item,
            'Código Barras': item.barcode,
            'Cantidad': item.expected_quantity
        }));
        const worksheet = XLSX.utils.json_to_sheet(dataToExport);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Items a Etiquetar");
        XLSX.writeFile(workbook, `Etiquetado_${operation.rk_identifier}_${operation.reference}.xlsx`);
        toast({ title: 'Éxito', description: 'El archivo Excel ha sido generado.' });
    } else {
        toast({ variant: 'destructive', title: 'Error al generar Excel', description: result.error });
    }
    setIsSubmitting(false);
  };

  const isManager = role === 'admin' || role === 'supervisor';
  
  const userOperations = useMemo(() => {
    if (!user) return [];
    return operations.filter(op => op.assignedOperatorId === user.uid && op.status !== 'Completada');
  }, [operations, user]);

  return (
    <>
      <AssignOperatorsDialog 
        isOpen={isAssignDialogOpen}
        onOpenChange={setIsAssignDialogOpen}
        onAssign={handleAssignOperator}
        isLoading={isSubmitting}
        operators={allUsers.filter(u => u.role === 'operator' || u.role === 'supervisor')}
        initialAssignedIds={selectedOperation?.assignedOperatorId ? [selectedOperation.assignedOperatorId] : []}
        isSingleTaskReassign={true}
      />
      <SetLabelingStandardDialog
        isOpen={isStandardDialogOpen}
        onOpenChange={setIsStandardDialogOpen}
        onConfirm={handleSetStandard}
        isLoading={isSubmitting}
        currentValue={selectedOperation?.standard_units_per_hour}
      />
       <LabelingActivityLogDialog 
        isOpen={isActivityLogOpen}
        onOpenChange={setIsActivityLogOpen}
        logs={selectedLog}
        taskTitle={selectedOperation ? `${selectedOperation.rk_identifier} - ${selectedOperation.reference}` : ''}
       />
      <div className="space-y-8 max-w-7xl mx-auto">
        <Card>
          <CardHeader className="flex flex-row justify-between items-center">
            <div>
              <CardTitle>Módulo de Etiquetado de Mercancía</CardTitle>
              <CardDescription>Gestione y supervise el progreso de las operaciones de etiquetado.</CardDescription>
            </div>
            <Button onClick={onReturnToSuite} variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Volver a la Suite
            </Button>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center items-center h-64">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
              </div>
            ) : isManager ? (
                 operations.length === 0 ? (
                 <p className="text-center text-muted-foreground py-8">No hay operaciones de etiquetado. Envíe una desde el módulo de recepción.</p>
               ) : (
                <AdminDashboard 
                    operations={operations}
                    productivityData={productivityData}
                    isSubmitting={isSubmitting}
                    onOpenDialog={handleOpenDialog}
                    onGenerateExcel={handleGenerateExcel}
                    users={allUsers}
                />
               )
            ) : (
                 <LabelingOperatorView operations={userOperations} onRefresh={fetchOperationsAndProductivity} />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
};

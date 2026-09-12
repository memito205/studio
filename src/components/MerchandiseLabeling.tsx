/** @jsxImportSource react */
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2, MoreHorizontal, Users, Target, FileDown, Tag, Pause, Search, Play, RotateCcw, Check, Pencil, Trash2, UserMinus, Package } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import type { LabelingOperation, LabelingOperationStatus, LabelingActivityLog, AppUser, ReceptionExpectedItem, OperationPulse, ExternalVendor } from '@/types';
import { loadLabelingOperations, updateLabelingOperation, unassignLabelingOperation, getExpectedItemsForLabeling, getAllUserProfiles, getLabelingActivityLog, logLabelingActivity, finishLabelingTaskSession, getExternalVendors, correctLabelingTaskQuantity, purgeAllLabelingOperations, deleteSelectedLabelingOperations } from '@/app/reception/actions';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FinishWorkDialog } from './FinishWorkDialog';
import { getUserGoals, getProductivitySettings, getPulsesByDate } from '@/app/actions';
import { useSuitePulse } from '@/hooks/useSuitePulse';
import { AssignOperatorsDialog } from './AssignOperatorsDialog';
import { SetLabelingStandardDialog } from './SetLabelingStandardDialog';
import { CorrectLabelingQuantityDialog } from './CorrectLabelingQuantityDialog';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { useAuth } from '@/hooks/use-auth-context';
import LabelingOperatorView from './LabelingOperatorView';
import { LabelingActivityLogDialog } from './LabelingActivityLogDialog'; // Importar el nuevo diálogo
import { computeLabelingProductivity } from '@/lib/labelingProductivity';


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

interface AdminPauseDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string, startTime: string) => void;
  operation: LabelingOperation | null;
}

const AdminPauseDialog: React.FC<AdminPauseDialogProps> = ({ isOpen, onOpenChange, onConfirm, operation }) => {
  const [reason, setReason] = useState('Almuerzo');
  const [otherReason, setOtherReason] = useState('');
  const [pauseTime, setPauseTime] = useState(new Date().toISOString().slice(0, 16));
  const reasons = ['Almuerzo', 'Baño', 'Ajuste de Puesto', 'Falla Técnica', 'Otro'];

  useEffect(() => {
     if (isOpen) {
         setPauseTime(new Date().toISOString().slice(0, 16));
         setReason('Almuerzo');
         setOtherReason('');
     }
  }, [isOpen]);

  const handleConfirm = () => {
    const finalReason = reason === 'Otro' ? `Otro: ${otherReason}` : reason;
    onConfirm(finalReason, new Date(pauseTime).toISOString());
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pausa Administrativa</DialogTitle>
          <DialogDescription>
            Registrar pausa manual para {operation?.reference}. Solo use esta opción si el operario olvidó registrarla.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Motivo</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {reasons.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          
          {reason === 'Otro' && (
            <div className="space-y-2 animate-in fade-in slide-in-from-top-1">
                <Label>Especifique Actividad (Justificación)</Label>
                <Input 
                    placeholder="¿Cuál es la actividad?"
                    value={otherReason}
                    onChange={(e) => setOtherReason(e.target.value)}
                />
            </div>
          )}

          <div className="space-y-2">
            <Label>Hora de Inicio (Referencia)</Label>
            <Input 
              type="datetime-local" 
              value={pauseTime} 
              onChange={(e) => setPauseTime(e.target.value)} 
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleConfirm} disabled={reason === 'Otro' && !otherReason}>Registrar Pausa</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

interface ProductivityMetrics {
    productiveTimeMinutes: number;
    unitsPerHour: number;
    compliance: number;
}

interface AdminDashboardProps {
    operations: LabelingOperation[];
    productivityData: Map<string, ProductivityMetrics>;
    isSubmitting: boolean;
    onOpenDialog: (operation: LabelingOperation, dialog: 'assign' | 'standard' | 'log' | 'quantity' | 'boxes') => void | Promise<void>;
    onGenerateExcel: (operation: LabelingOperation) => void | Promise<void>;
    users: AppUser[];
    vendors: ExternalVendor[];
    onAdminPause: (operation: LabelingOperation) => void;
    onAction: (operationId: string, actionType: 'START' | 'PAUSE' | 'RESUME' | 'FINISH', reason?: string) => void;
    onFinish: (operation: LabelingOperation) => void;
    onUnassign: (operation: LabelingOperation) => void;
    selectedIds: Set<string>;
    onToggleSelect: (id: string) => void;
    onToggleAll: (ids: string[]) => void;
}

const canUnassignLabelingOp = (op: LabelingOperation): boolean => {
  const hasAssignee = Boolean(
    (op.assignedOperatorId && String(op.assignedOperatorId).trim()) ||
      (op.assignedExternalVendorId && String(op.assignedExternalVendorId).trim())
  );
  if (!hasAssignee) return false;
  if (op.status === 'Asignada' || op.status === 'Pendiente') return true;
  if (op.status === 'Pausada') {
    const liveUnits = Number(op.completedUnitsLive) || 0;
    const confirmedBoxes = Array.isArray(op.labelingPackPlan)
      ? op.labelingPackPlan.filter((u) => u.confirmed).length
      : 0;
    return liveUnits <= 0 && confirmedBoxes <= 0;
  }
  return false;
};

const AdminDashboard: React.FC<AdminDashboardProps> = ({ operations, productivityData, isSubmitting, onOpenDialog, onGenerateExcel, users, vendors, onAdminPause, onAction, onFinish, onUnassign, selectedIds, onToggleSelect, onToggleAll }) => {
    
    const userMap = useMemo(() => new Map(users.map(u => [u.uid, u.displayName || u.email])), [users]);
    const vendorMap = useMemo(() => new Map(vendors.map(v => [v.id, v.name])), [vendors]);
    const allIds = operations.map(op => op.id);
    const allSelected = allIds.length > 0 && allIds.every(id => selectedIds.has(id));
    const someSelected = allIds.some(id => selectedIds.has(id));
    
    return (
    <div className="border rounded-md">
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead className="w-10">
                        <Checkbox
                            checked={allSelected}
                            data-state={someSelected && !allSelected ? 'indeterminate' : undefined}
                            onCheckedChange={() => onToggleAll(allIds)}
                            aria-label="Seleccionar todas"
                        />
                    </TableHead>
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
                    let displayOperator = 'Ninguno';
                    
                    if (op.isExternal) {
                        const vendorName = op.assignedExternalVendorId ? vendorMap.get(op.assignedExternalVendorId) : 'Ext';
                        displayOperator = `[EXT] ${vendorName}${op.assignedExternalOperatorName ? ` - ${op.assignedExternalOperatorName}` : ''}`;
                    } else if (op.assignedOperatorId) {
                        displayOperator = userMap.get(op.assignedOperatorId) || 'Interno';
                    }
                    return (
                        <TableRow key={op.id} data-state={selectedIds.has(op.id) ? 'selected' : undefined}>
                            <TableCell>
                                <Checkbox
                                    checked={selectedIds.has(op.id)}
                                    onCheckedChange={() => onToggleSelect(op.id)}
                                    aria-label={`Seleccionar ${op.rk_identifier}`}
                                />
                            </TableCell>
                            <TableCell>
                                <div className="font-medium">{op.rk_identifier}</div>
                                <div className="text-sm text-muted-foreground">{op.reference}</div>
                            </TableCell>
                            <TableCell className="text-xs uppercase font-semibold">{displayOperator}</TableCell>
                            <TableCell>
                                <div className="flex flex-col items-start gap-1">
                                  <Badge variant={getStatusVariant(op.status)}>{op.status}</Badge>
                                  {op.parentTaskId ? (
                                    <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                                      Remanente
                                    </span>
                                  ) : null}
                                </div>
                            </TableCell>
                            <TableCell>
                                {op.status === 'Completada'
                                  ? `${op.completedUnits || 0} / ${op.totalUnits}`
                                  : op.trackingMode === 'pack_units'
                                    ? (() => {
                                        const plan = op.labelingPackPlan || [];
                                        const confirmed = plan.filter((u) => u.confirmed);
                                        const pending = plan.filter((u) => !u.confirmed);
                                        return (
                                          <button
                                            type="button"
                                            className="space-y-1 max-w-[220px] text-left hover:underline decoration-dotted"
                                            onClick={() => onOpenDialog(op, 'boxes')}
                                            title="Ver cajas confirmadas y pendientes"
                                          >
                                            <div>
                                              {(op.completedUnitsLive || 0).toLocaleString()} / {op.totalUnits.toLocaleString()}
                                              {plan.length > 0
                                                ? ` · ${confirmed.length}/${plan.length} cajas`
                                                : ''}
                                            </div>
                                            {pending.length > 0 ? (
                                              <div className="text-[10px] text-amber-700 leading-snug">
                                                Faltan: {pending
                                                  .slice(0, 8)
                                                  .map((u) => `#${u.unitNumber}`)
                                                  .join(', ')}
                                                {pending.length > 8 ? ` +${pending.length - 8}` : ''}
                                              </div>
                                            ) : plan.length > 0 ? (
                                              <div className="text-[10px] text-emerald-700">Todas confirmadas</div>
                                            ) : null}
                                            {op.status === 'En Progreso' || op.status === 'Pausada' ? (
                                              <div className="text-[10px] text-emerald-700">LIVE</div>
                                            ) : null}
                                          </button>
                                        );
                                      })()
                                    : op.totalUnits.toLocaleString()}
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
                                        {op.trackingMode === 'pack_units' && (op.labelingPackPlan?.length || 0) > 0 ? (
                                          <DropdownMenuItem onClick={() => onOpenDialog(op, 'boxes')}>
                                            <Package className="mr-2 h-4 w-4" /> Ver cajas (OK / faltan)
                                          </DropdownMenuItem>
                                        ) : null}
                                        <DropdownMenuItem onClick={() => onOpenDialog(op, 'assign')} disabled={op.status === 'En Progreso' || op.status === 'Completada'}>
                                            <Users className="mr-2 h-4 w-4" /> Reasignar Operario
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          onClick={() => onUnassign(op)}
                                          disabled={isSubmitting || !canUnassignLabelingOp(op)}
                                          className="text-destructive focus:text-destructive"
                                        >
                                            <UserMinus className="mr-2 h-4 w-4" /> Desasignar
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => onOpenDialog(op, 'standard')}>
                                            <Target className="mr-2 h-4 w-4" /> Definir Estándar
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => onOpenDialog(op, 'quantity')}>
                                            <Pencil className="mr-2 h-4 w-4" /> Corregir cantidad
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => onGenerateExcel(op)} disabled={isSubmitting}>
                                            <FileDown className="mr-2 h-4 w-4" /> Generar Excel de Trabajo
                                        </DropdownMenuItem>
                                        {op.status === 'En Progreso' && (
                                            <DropdownMenuItem onClick={() => onAdminPause(op)} className="text-warning-foreground bg-warning/10">
                                                <Pause className="mr-2 h-4 w-4" /> Pausar Tarea (Admin)
                                            </DropdownMenuItem>
                                        )}
                                        {op.status === 'En Progreso' && (
                                            <DropdownMenuItem onClick={() => onFinish(op)}>
                                                <Check className="mr-2 h-4 w-4" /> Finalizar Tarea
                                            </DropdownMenuItem>
                                        )}
                                        {op.status === 'Asignada' && (
                                            <DropdownMenuItem onClick={() => onAction(op.id, 'START')}>
                                                <Play className="mr-2 h-4 w-4" /> Iniciar Tarea
                                            </DropdownMenuItem>
                                        )}
                                        {op.status === 'Pausada' && (
                                            <DropdownMenuItem onClick={() => onAction(op.id, 'RESUME')}>
                                                <RotateCcw className="mr-2 h-4 w-4" /> Reanudar Tarea
                                            </DropdownMenuItem>
                                        )}
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
  const [isAdminPauseDialogOpen, setIsAdminPauseDialogOpen] = useState(false);
  const [operationToPause, setOperationToPause] = useState<LabelingOperation | null>(null);
  const [externalVendors, setExternalVendors] = useState<ExternalVendor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingVendors, setLoadingVendors] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [productivityData, setProductivityData] = useState<Map<string, ProductivityMetrics>>(new Map());
  const [externalPulses, setExternalPulses] = useState<OperationPulse[]>([]);
  
  // Dashboard Filters
  const [searchRK, setSearchRK] = useState('');
  const [searchRef, setSearchRef] = useState('');
  const [searchOp, setSearchOp] = useState('');

  const [isAssignDialogOpen, setIsAssignDialogOpen] = useState(false);
  const [isStandardDialogOpen, setIsStandardDialogOpen] = useState(false);
  const [isQuantityDialogOpen, setIsQuantityDialogOpen] = useState(false);
  const [isActivityLogOpen, setIsActivityLogOpen] = useState(false);
  const [isBoxesDialogOpen, setIsBoxesDialogOpen] = useState(false);
  const [selectedOperation, setSelectedOperation] = useState<LabelingOperation | null>(null);
  const [selectedLog, setSelectedLog] = useState<LabelingActivityLog[]>([]);
  const [purgingHistory, setPurgingHistory] = useState(false);
  const [purgeDialogOpen, setPurgeDialogOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteSelectedDialogOpen, setDeleteSelectedDialogOpen] = useState(false);

  const [viewMode, setViewMode] = useState<'admin' | 'operator'>('admin');
  const [taskToFinish, setTaskToFinish] = useState<LabelingOperation | null>(null);
  const [isFinishDialogOpen, setIsFinishDialogOpen] = useState(false);


  const { toast } = useToast();
  const { user, role } = useAuth();
  const { allPulses } = useSuitePulse();
  const activityLogsRef = React.useRef<Map<string, LabelingActivityLog[]>>(new Map());
  const usersLoadedRef = React.useRef(false);
  const vendorsLoadedRef = React.useRef(false);
  const allPulsesRef = React.useRef(allPulses);
  allPulsesRef.current = allPulses;

  const calculateProductivity = (
    logs: LabelingActivityLog[],
    operation: LabelingOperation,
    allExternalPulses: OperationPulse[]
  ): ProductivityMetrics | null => {
    return computeLabelingProductivity(logs, operation, allExternalPulses);
  };

  const recalculateProductivity = useCallback(
    (ops: LabelingOperation[], pulses: OperationPulse[]) => {
      const activeOrCompletedOps = ops.filter(
        (op) => op.status !== 'Pendiente' && op.status !== 'Asignada'
      );
      const newProductivityData = new Map<string, ProductivityMetrics>();
      for (const op of activeOrCompletedOps) {
        const logs = activityLogsRef.current.get(op.id);
        if (!logs?.length) continue;
        const metrics = calculateProductivity(logs, op, pulses);
        if (metrics) newProductivityData.set(op.id, metrics);
      }
      setProductivityData(newProductivityData);
    },
    // calculateProductivity is pure and recreated each render; keep this stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const fetchOperationsAndProductivity = useCallback(async (opts?: { soft?: boolean }) => {
    const soft = Boolean(opts?.soft);
    if (!soft) setIsLoading(true);
    if (!vendorsLoadedRef.current) setLoadingVendors(true);

    try {
      const usersPromise = usersLoadedRef.current
        ? Promise.resolve(null as AppUser[] | null)
        : getAllUserProfiles();
      const vendorsPromise = vendorsLoadedRef.current
        ? Promise.resolve(null as Awaited<ReturnType<typeof getExternalVendors>> | null)
        : getExternalVendors();

      const [opsResult, usersResult, vendorsResult] = await Promise.all([
        loadLabelingOperations({ limitN: 150 }),
        usersPromise,
        vendorsPromise,
      ]);

      if (usersResult) {
        setAllUsers(usersResult);
        usersLoadedRef.current = true;
      } else if (!usersLoadedRef.current) {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'No se pudieron cargar los perfiles de usuario.',
        });
      }

      if (vendorsResult?.success && vendorsResult.data) {
        setExternalVendors(vendorsResult.data);
        vendorsLoadedRef.current = true;
      }

      if (opsResult.success && opsResult.data) {
        const fetchedOps = opsResult.data;
        setOperations(fetchedOps);
        // Mostrar tabla ya; métricas en segundo plano (no bloquear spinner).
        if (!soft) setIsLoading(false);
        setLoadingVendors(false);

        const forMetrics = fetchedOps
          .filter((op) => op.status !== 'Pendiente' && op.status !== 'Asignada')
          .slice(0, soft ? 25 : 40);

        const logResults = await Promise.all(
          forMetrics.map(async (op) => {
            const logResult = await getLabelingActivityLog(op.id, { limitN: soft ? 40 : 80 });
            return { id: op.id, logs: logResult.success && logResult.data ? logResult.data : [] };
          })
        );

        const nextLogs = soft
          ? new Map(activityLogsRef.current)
          : new Map<string, LabelingActivityLog[]>();
        for (const row of logResults) {
          if (row.logs.length) nextLogs.set(row.id, row.logs);
        }
        activityLogsRef.current = nextLogs;
        recalculateProductivity(fetchedOps, allPulsesRef.current);
      } else {
        toast({
          variant: 'destructive',
          title: 'Error',
          description:
            opsResult.error ||
            'No se pudieron cargar tareas. Si acaba de desplegarse la app, recargue con Ctrl+F5.',
        });
      }
    } catch (e: any) {
      const msg = String(e?.message || e || '');
      const isSkew =
        msg.includes('Server Action') ||
        msg.includes('was not found on the server') ||
        msg.includes('Failed to find Server Action');
      toast({
        variant: 'destructive',
        title: isSkew ? 'Versión desactualizada' : 'Error al cargar etiquetado',
        description: isSkew
          ? 'El navegador tiene una versión vieja de la app. Recargue con Ctrl+F5 (o cierre pestañas viejas) y vuelva a entrar.'
          : msg || 'Fallo inesperado al cargar el módulo.',
      });
    } finally {
      setIsLoading(false);
      setLoadingVendors(false);
    }
  }, [recalculateProductivity, toast]);

  const handleOperationUpdated = useCallback(
    (updated: LabelingOperation) => {
      setOperations((prev) => {
        const next = prev.map((op) => (op.id === updated.id ? { ...op, ...updated } : op));
        // Recalcular con logs actuales (sin nuevas lecturas masivas).
        queueMicrotask(() => recalculateProductivity(next, allPulsesRef.current));
        return next;
      });
    },
    [recalculateProductivity]
  );

  const handleAdminPauseConfirm = async (reason: string, startTime: string) => {
    if (!operationToPause) return;
    setIsSubmitting(true);
    const result = await logLabelingActivity(
      operationToPause.id,
      operationToPause.isExternal
        ? operationToPause.assignedExternalVendorId!
        : operationToPause.assignedOperatorId || 'system',
      'PAUSE',
      reason,
      false,
      undefined,
      operationToPause.assignedExternalOperatorName,
      startTime
    );

    if (result.success) {
      toast({ title: 'Éxito', description: 'Pausa administrativa registrada correctamente.' });
      void fetchOperationsAndProductivity();
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.error });
    }
    setIsSubmitting(false);
    setIsAdminPauseDialogOpen(false);
  };

  const handleAdminPauseClick = (op: LabelingOperation) => {
    setOperationToPause(op);
    setIsAdminPauseDialogOpen(true);
  };

  useEffect(() => {
    void fetchOperationsAndProductivity();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (operations.length === 0) return;
    recalculateProductivity(operations, allPulses);
  }, [allPulses, operations, recalculateProductivity]);

  // KPIs live: refrescar solo tareas (soft), sin bloquear UI ni re-leer toda la productividad pesada igual
  useEffect(() => {
    const hasLivePack = operations.some(
      (op) =>
        op.trackingMode === 'pack_units' &&
        (op.status === 'En Progreso' || op.status === 'Pausada')
    );
    if (!hasLivePack) return;
    const id = window.setInterval(() => {
      void fetchOperationsAndProductivity({ soft: true });
    }, 45000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    operations
      .filter(
        (op) =>
          op.trackingMode === 'pack_units' &&
          (op.status === 'En Progreso' || op.status === 'Pausada')
      )
      .map((op) => op.id)
      .join(','),
  ]);

  const handleOpenDialog = async (
    operation: LabelingOperation,
    dialog: 'assign' | 'standard' | 'log' | 'quantity' | 'boxes'
  ) => {
    setSelectedOperation(operation);
    if (dialog === 'assign') setIsAssignDialogOpen(true);
    if (dialog === 'standard') setIsStandardDialogOpen(true);
    if (dialog === 'quantity') setIsQuantityDialogOpen(true);
    if (dialog === 'boxes') setIsBoxesDialogOpen(true);
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

  const handleUnassignOperator = async (operation: LabelingOperation) => {
    const ok = window.confirm(
      `¿Desasignar la referencia ${operation.reference} (RK ${operation.rk_identifier})?\n\nQuedará en Pendiente sin operario.`
    );
    if (!ok) return;
    setIsSubmitting(true);
    const result = await unassignLabelingOperation(operation.id);
    if (result.success) {
      toast({ title: 'Desasignada', description: 'La tarea quedó en Pendiente sin operario.' });
      await fetchOperationsAndProductivity();
    } else {
      toast({ variant: 'destructive', title: 'No se pudo desasignar', description: result.error });
    }
    setIsSubmitting(false);
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

  const handleCorrectQuantity = async (quantity: number) => {
    if (!selectedOperation) return;
    setIsSubmitting(true);
    const result = await correctLabelingTaskQuantity(selectedOperation.id, quantity);
    if (result.success) {
      toast({
        title: 'Cantidad corregida',
        description: `Nueva cantidad: ${quantity.toLocaleString()}. La productividad se recalculará con este valor.`,
      });
      await fetchOperationsAndProductivity();
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.error });
    }
    setIsSubmitting(false);
    setIsQuantityDialogOpen(false);
  };

  const handlePurgeAllLabelingHistory = async () => {
    setPurgingHistory(true);
    const result = await purgeAllLabelingOperations();
    setPurgingHistory(false);
    if (!result.success) {
      toast({ variant: 'destructive', title: 'No se pudo borrar', description: result.error });
      return;
    }
    setPurgeDialogOpen(false);
    setOperations([]);
    setProductivityData(new Map());
    setSelectedOperation(null);
    toast({
      title: 'Histórico de etiquetado reiniciado',
      description: `Tareas borradas: ${result.deletedOperations || 0}. Logs: ${result.deletedLogs || 0}. El tablero de etiquetado queda en cero.`,
    });
    await fetchOperationsAndProductivity();
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    setPurgingHistory(true);
    const result = await deleteSelectedLabelingOperations(Array.from(selectedIds));
    setPurgingHistory(false);
    if (!result.success) {
      toast({ variant: 'destructive', title: 'No se pudieron borrar', description: result.error });
      return;
    }
    setDeleteSelectedDialogOpen(false);
    setSelectedIds(new Set());
    toast({
      title: 'Tareas borradas',
      description: `Se eliminaron ${result.deletedOperations || 0} tarea(s) y ${result.deletedLogs || 0} registro(s) de actividad.`,
    });
    await fetchOperationsAndProductivity();
  };

    const handleAdminAction = async (operationId: string, actionType: 'START' | 'PAUSE' | 'RESUME' | 'FINISH', reason?: string) => {
        const operation = operations.find(o => o.id === operationId);
        if (!operation) return;

        const operatorId = operation.isExternal ? operation.assignedExternalVendorId! : (operation.assignedOperatorId || 'system');
        const operatorName = operation.isExternal ? operation.assignedExternalOperatorName : undefined;

        setIsSubmitting(true);
        const result = await logLabelingActivity(
            operationId,
            operatorId,
            actionType,
            reason,
            operation.isExternal,
            undefined, // No PIN required for Admin
            operatorName
        );

        if (result.success) {
            toast({ title: 'Éxito', description: `Acción '${actionType}' registrada.` });
            fetchOperationsAndProductivity();
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
        const result = await finishLabelingTaskSession(
            taskToFinish.id,
            completedUnits,
            taskToFinish.isExternal,
            undefined, // No PIN
            taskToFinish.assignedExternalOperatorName
        );
        if (result.success) {
            const residualNote =
              result.residualCreated && result.residualBoxes
                ? ` Remanente: ${result.residualBoxes} cajas → Pendiente.`
                : '';
            toast({ title: 'Tarea Finalizada', description: `Se ha registrado el trabajo.${residualNote}` });
            fetchOperationsAndProductivity();
        } else {
            toast({ variant: 'destructive', title: 'Error al Finalizar', description: result.error });
        }
        setIsSubmitting(false);
        setIsFinishDialogOpen(false);
        setTaskToFinish(null);
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
        isLoading={isSubmitting || loadingVendors}
        operators={allUsers}
        externalVendors={externalVendors}
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
      <CorrectLabelingQuantityDialog
        isOpen={isQuantityDialogOpen}
        onOpenChange={setIsQuantityDialogOpen}
        onConfirm={handleCorrectQuantity}
        isLoading={isSubmitting}
        operation={selectedOperation}
      />
       <LabelingActivityLogDialog 
        isOpen={isActivityLogOpen}
        onOpenChange={setIsActivityLogOpen}
        logs={selectedLog}
        taskTitle={selectedOperation ? `${selectedOperation.rk_identifier} - ${selectedOperation.reference}` : ''}
       />
      <Dialog open={isBoxesDialogOpen} onOpenChange={setIsBoxesDialogOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Estado de cajas</DialogTitle>
            <DialogDescription>
              {selectedOperation
                ? `${selectedOperation.rk_identifier} · ${selectedOperation.reference}`
                : 'Detalle confirmadas vs pendientes'}
            </DialogDescription>
          </DialogHeader>
          {selectedOperation?.labelingPackPlan?.length ? (
            (() => {
              const plan = [...selectedOperation.labelingPackPlan].sort(
                (a, b) => (a.unitNumber || 0) - (b.unitNumber || 0)
              );
              const confirmed = plan.filter((u) => u.confirmed);
              const pending = plan.filter((u) => !u.confirmed);
              return (
                <div className="space-y-4 overflow-y-auto pr-1 text-sm">
                  <p className="text-muted-foreground">
                    {confirmed.length}/{plan.length} cajas confirmadas ·{' '}
                    {(selectedOperation.completedUnitsLive || 0).toLocaleString()} und
                  </p>
                  <div>
                    <p className="font-medium text-amber-800 mb-1">
                      Pendientes ({pending.length})
                    </p>
                    {pending.length === 0 ? (
                      <p className="text-emerald-700 text-xs">Ninguna — todas confirmadas.</p>
                    ) : (
                      <ul className="space-y-1 max-h-48 overflow-y-auto rounded border bg-amber-50/50 p-2">
                        {pending.map((u) => (
                          <li key={u.packingUnitId || `${u.unitNumber}-${u.locationId}`}>
                            <span className="font-semibold">#{u.unitNumber}</span>
                            {u.locationName || u.locationId
                              ? ` · ${u.locationName || u.locationId}`
                              : ''}
                            {u.qty ? ` · ${u.qty} und` : ''}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <p className="font-medium text-emerald-800 mb-1">
                      Confirmadas ({confirmed.length})
                    </p>
                    {confirmed.length === 0 ? (
                      <p className="text-muted-foreground text-xs">Aún no hay cajas OK.</p>
                    ) : (
                      <ul className="space-y-1 max-h-48 overflow-y-auto rounded border bg-emerald-50/50 p-2">
                        {confirmed.map((u) => (
                          <li key={u.packingUnitId || `ok-${u.unitNumber}-${u.locationId}`}>
                            <span className="font-semibold">#{u.unitNumber}</span>
                            {u.locationName || u.locationId
                              ? ` · ${u.locationName || u.locationId}`
                              : ''}
                            {u.qty ? ` · ${u.qty} und` : ''}
                            {u.confirmedAt
                              ? ` · ${format(new Date(u.confirmedAt), 'HH:mm', { locale: es })}`
                              : ''}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              );
            })()
          ) : (
            <p className="text-sm text-muted-foreground">Esta tarea no tiene plan de cajas.</p>
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setIsBoxesDialogOpen(false)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div className="space-y-6 max-w-7xl mx-auto">
        <Card>
          <CardHeader className="flex flex-row justify-between items-center pb-2">
            <div>
              <CardTitle>Módulo de Etiquetado de Mercancía</CardTitle>
              <CardDescription>Gestione y supervise el progreso de las operaciones de etiquetado.</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {isManager && selectedIds.size > 0 ? (
                <>
                  <span className="text-sm text-muted-foreground">{selectedIds.size} tarea(s) seleccionada(s)</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedIds(new Set())}
                    disabled={purgingHistory}
                  >
                    Cancelar selección
                  </Button>
                  <AlertDialog open={deleteSelectedDialogOpen} onOpenChange={setDeleteSelectedDialogOpen}>
                    <AlertDialogTrigger asChild>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={purgingHistory}
                      >
                        {purgingHistory ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="mr-2 h-4 w-4" />
                        )}
                        Borrar {selectedIds.size} tarea(s)
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>¿Borrar las tareas seleccionadas?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Se eliminarán permanentemente {selectedIds.size} tarea(s) y todos sus registros de actividad de la base de datos.
                          Esto también afectará el tablero de control de etiquetado. Esta acción no se puede deshacer.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel disabled={purgingHistory}>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                          disabled={purgingHistory}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={(e) => { e.preventDefault(); void handleDeleteSelected(); }}
                        >
                          {purgingHistory ? 'Borrando…' : `Sí, borrar ${selectedIds.size} tarea(s)`}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              ) : null}
              <Button onClick={onReturnToSuite} variant="outline">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Volver a la Suite
              </Button>
            </div>
          </CardHeader>
          
          {isManager && (
            <div className="px-6 pb-4">
              <div className="flex flex-wrap gap-4 items-end bg-muted/30 p-4 rounded-lg border">
                <div className="flex-1 min-w-[200px] space-y-1.5">
                  <Label htmlFor="searchRK" className="text-xs font-semibold uppercase text-muted-foreground">RK / Identificador</Label>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="searchRK"
                      placeholder="Ej: RK-001..."
                      className="pl-9 bg-background"
                      value={searchRK}
                      onChange={(e) => setSearchRK(e.target.value)}
                    />
                  </div>
                </div>
                
                <div className="flex-1 min-w-[200px] space-y-1.5">
                  <Label htmlFor="searchRef" className="text-xs font-semibold uppercase text-muted-foreground">Referencia</Label>
                  <Input
                    id="searchRef"
                    placeholder="Filtrar por referencia..."
                    className="bg-background"
                    value={searchRef}
                    onChange={(e) => setSearchRef(e.target.value)}
                  />
                </div>

                <div className="flex-1 min-w-[200px] space-y-1.5">
                  <Label htmlFor="searchOp" className="text-xs font-semibold uppercase text-muted-foreground">Operario / Proveedor</Label>
                  <Input
                    id="searchOp"
                    placeholder="Buscar nombre..."
                    className="bg-background"
                    value={searchOp}
                    onChange={(e) => setSearchOp(e.target.value)}
                  />
                </div>

                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => { setSearchRK(''); setSearchRef(''); setSearchOp(''); }}
                  className="h-10 px-3"
                >
                  Limpiar
                </Button>
              </div>
            </div>
          )}

          <CardContent>
            {isLoading ? (
              <div className="flex justify-center items-center h-64">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
              </div>
            ) : isManager ? (
               <div className="space-y-4">
                 {userOperations.length > 0 && (
                   <div className="flex justify-center mb-4">
                     <Tabs value={viewMode} onValueChange={(val: any) => setViewMode(val)} className="w-full max-w-[400px]">
                        <TabsList className="grid w-full grid-cols-2">
                           <TabsTrigger value="admin">Vista Supervisor</TabsTrigger>
                           <TabsTrigger value="operator">Mis Tareas ({userOperations.length})</TabsTrigger>
                        </TabsList>
                     </Tabs>
                   </div>
                 )}

                 {viewMode === 'admin' ? (
                    operations.length === 0 ? (
                      <p className="text-center text-muted-foreground py-8">No hay operaciones de etiquetado. Envíe una desde el módulo de recepción.</p>
                    ) : (
                    <AdminDashboard 
                        operations={operations.filter(op => {
                          const matchRK = op.rk_identifier.toLowerCase().includes(searchRK.toLowerCase());
                          const matchRef = op.reference.toLowerCase().includes(searchRef.toLowerCase());
                          
                          let opName = 'Ninguno';
                          if (op.isExternal) {
                              const vendorName = externalVendors.find(v => v.id === op.assignedExternalVendorId)?.name || 'Ext';
                              opName = `[EXT] ${vendorName}${op.assignedExternalOperatorName ? ` - ${op.assignedExternalOperatorName}` : ''}`;
                          } else if (op.assignedOperatorId) {
                              opName = allUsers.find(u => u.uid === op.assignedOperatorId)?.displayName || 'Interno';
                          }
                          const matchOp = opName.toLowerCase().includes(searchOp.toLowerCase());
                          
                          return matchRK && matchRef && matchOp;
                        })}
                        productivityData={productivityData}
                        isSubmitting={isSubmitting}
                        onOpenDialog={handleOpenDialog}
                        onGenerateExcel={handleGenerateExcel}
                        users={allUsers}
                        vendors={externalVendors}
                        onAdminPause={handleAdminPauseClick}
                        onAction={handleAdminAction}
                        onFinish={handleOpenFinishDialog}
                        onUnassign={handleUnassignOperator}
                        selectedIds={selectedIds}
                        onToggleSelect={(id) => setSelectedIds(prev => {
                          const next = new Set(prev);
                          next.has(id) ? next.delete(id) : next.add(id);
                          return next;
                        })}
                        onToggleAll={(ids) => setSelectedIds(prev => {
                          const allSelected = ids.every(id => prev.has(id));
                          if (allSelected) return new Set();
                          return new Set(ids);
                        })}
                    />
                    )
                 ) : (
                    <LabelingOperatorView
                      operations={userOperations}
                      onRefresh={fetchOperationsAndProductivity}
                      onOperationUpdated={handleOperationUpdated}
                    />
                 )}
               </div>
            ) : (
                 <LabelingOperatorView
                   operations={userOperations}
                   onRefresh={fetchOperationsAndProductivity}
                   onOperationUpdated={handleOperationUpdated}
                 />
            )}
          </CardContent>
        </Card>
        <AdminPauseDialog 
            isOpen={isAdminPauseDialogOpen}
            onOpenChange={setIsAdminPauseDialogOpen}
            onConfirm={handleAdminPauseConfirm}
            operation={operationToPause}
        />
        {taskToFinish && (
            <FinishWorkDialog 
                isOpen={isFinishDialogOpen}
                onOpenChange={setIsFinishDialogOpen}
                task={taskToFinish}
                onConfirm={handleConfirmFinish}
                isSubmitting={isSubmitting}
            />
        )}
      </div>
    </>
  );
};

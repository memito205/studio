'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  PackageSearch,
  RefreshCw,
  Scale,
  Trash2,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/hooks/use-auth-context';
import { useToast } from '@/hooks/use-toast';
import {
  assignDistributionRemainders,
  claimDistributionRemainder,
  createDistributionCompare,
  deleteDistributionCompare,
  getDistributionCompare,
  listAssignableOperatorsForRemainders,
  listAvailableRemainderClaims,
  listMyRemainderTasks,
  listPendingValidationRemainderTasks,
  listRemainderAssignmentBoard,
  listRemainderTasksByCompare,
  rejectRemainderTask,
  submitRemainderReturn,
  supervisorConfirmRemaindersDirect,
  validateRemainderTask,
  type DistributionPlanRowInput,
  type DistributionStockRowInput,
} from '@/app/distributionCompareActions';
import type {
  DistributionCompareOperation,
  DistributionRemainderAvailableClaim,
  DistributionRemainderTask,
} from '@/types';
import { parseExcelFile } from '@/components/distributor-module/services/parser';
import {
  fetchDistributionCompareSummariesClient,
  ensureCompareSummaryMirrors,
  fetchReceptionOptionsForCompareClient,
  parsePhysicalExcelForCompare,
  validateComparePhysicalRows,
  withTimeout,
} from '@/lib/distributionCompareClient';

interface Props {
  onReturnToSuite: () => void;
}

/** Plan de cruce: REFERENCIA + CANT (BODEGA opcional). No altera el validador del Distribuidor IA. */
function validateComparePlanData(data: any[]): data is DistributionPlanRowInput[] {
  if (!data || data.length === 0) return true;
  const first = data[0] || {};
  const hasRef = 'REFERENCIA' in first;
  const hasCant = 'CANT' in first || 'CANTIDAD' in first;
  return hasRef && hasCant;
}

function fmt(n: number) {
  return (Number(n) || 0).toLocaleString('es-CO');
}

function taskStatusLabel(status: DistributionRemainderTask['status']) {
  switch (status) {
    case 'assigned':
      return 'Asignada';
    case 'submitted':
      return 'Por validar';
    case 'validated':
      return 'Validada';
    case 'rejected':
      return 'Rechazada';
    default:
      return status;
  }
}

function compareStatusLabel(status: DistributionCompareOperation['status']) {
  switch (status) {
    case 'open':
      return 'Abierta';
    case 'in_progress':
      return 'En proceso';
    case 'pending_validation':
      return 'Por validar';
    case 'completed':
      return 'Completada';
    case 'archived':
      return 'Archivada';
    default:
      return status;
  }
}

export default function DistributionCompareModule({ onReturnToSuite }: Props) {
  const { user, role } = useAuth();
  const { toast } = useToast();
  const isManager = role === 'admin' || role === 'supervisor';

  const [tab, setTab] = useState<
    'compares' | 'myTasks' | 'available' | 'pendingValidation' | 'assignments'
  >('compares');
  const [view, setView] = useState<'list' | 'new' | 'detail'>('list');
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<DistributionCompareOperation[]>([]);
  const [selected, setSelected] = useState<DistributionCompareOperation | null>(null);
  const [tasks, setTasks] = useState<DistributionRemainderTask[]>([]);
  const [myTasks, setMyTasks] = useState<DistributionRemainderTask[]>([]);
  const [availableClaims, setAvailableClaims] = useState<DistributionRemainderAvailableClaim[]>([]);
  const [assignmentBoard, setAssignmentBoard] = useState<DistributionRemainderTask[]>([]);
  const [pendingTasks, setPendingTasks] = useState<DistributionRemainderTask[]>([]);
  const [operators, setOperators] = useState<
    Array<{ uid: string; displayName: string; role: string }>
  >([]);
  const [claimingKey, setClaimingKey] = useState<string | null>(null);

  const [receptions, setReceptions] = useState<
    Array<{
      id: string;
      rk_identifier: string;
      supplier: string;
      status: string;
      totalScannedQuantity: number;
      expected_quantity: number;
      created_at: string;
    }>
  >([]);
  const [receptionId, setReceptionId] = useState<string>('');
  const [planRows, setPlanRows] = useState<DistributionPlanRowInput[] | null>(null);
  const [planFileName, setPlanFileName] = useState('');
  const [stockRows, setStockRows] = useState<DistributionStockRowInput[] | null>(null);
  const [stockFileName, setStockFileName] = useState('');
  const [notes, setNotes] = useState('');
  const [onlyRemainder, setOnlyRemainder] = useState(true);

  const [selectedRefs, setSelectedRefs] = useState<Set<string>>(new Set());
  const [rowOperatorByRef, setRowOperatorByRef] = useState<Record<string, string>>({});
  const [assignOperatorId, setAssignOperatorId] = useState('');
  const [returnDrafts, setReturnDrafts] = useState<Record<string, string>>({});
  const [rejectDrafts, setRejectDrafts] = useState<Record<string, string>>({});
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const receptionsLoadedRef = React.useRef(false);
  const operatorsLoadedRef = React.useRef(false);
  const loadGenRef = React.useRef(0);
  const userUidRef = React.useRef<string | undefined>(user?.uid);
  const isManagerRef = React.useRef(isManager);
  userUidRef.current = user?.uid;
  isManagerRef.current = isManager;
  const toastRef = React.useRef(toast);
  toastRef.current = toast;

  /**
   * Listado liviano (REST field-mask / colección espejo).
   * Timeout duro: el spinner NUNCA puede quedar pegado.
   * Tareas de pestañas en segundo plano (no bloquean).
   */
  const reloadList = useCallback(async () => {
    const gen = ++loadGenRef.current;
    setLoading(true);
    setListError(null);

    const safetyMs = 12000;
    const safety = window.setTimeout(() => {
      if (gen !== loadGenRef.current) return;
      setLoading(false);
      setListError((prev) => prev || 'La carga tardó demasiado. Reintenta.');
    }, safetyMs);

    try {
      const data = await withTimeout(
        fetchDistributionCompareSummariesClient(30),
        10000,
        'listado comparaciones'
      );
      if (gen !== loadGenRef.current) return;
      setItems(data);
      // Espejos livianos en background (no bloquea UI).
      void ensureCompareSummaryMirrors(data).catch(() => undefined);
    } catch (e: any) {
      if (gen !== loadGenRef.current) return;
      setItems([]);
      const msg = e?.message || 'No se pudo cargar el listado.';
      setListError(msg);
      toastRef.current({
        variant: 'destructive',
        title: 'Comparaciones',
        description: msg,
      });
    } finally {
      window.clearTimeout(safety);
      if (gen === loadGenRef.current) setLoading(false);
    }

    const uid = userUidRef.current;
    if (uid) {
      void listMyRemainderTasks(uid)
        .then((res) => {
          if (gen === loadGenRef.current && res.success) setMyTasks(res.data || []);
        })
        .catch(() => undefined);
      void listAvailableRemainderClaims(25)
        .then((res) => {
          if (gen === loadGenRef.current && res.success) setAvailableClaims(res.data || []);
        })
        .catch(() => undefined);
    }
    if (isManagerRef.current) {
      void listPendingValidationRemainderTasks()
        .then((res) => {
          if (gen === loadGenRef.current && res.success) setPendingTasks(res.data || []);
        })
        .catch(() => undefined);
      void listRemainderAssignmentBoard(300)
        .then((res) => {
          if (gen === loadGenRef.current && res.success) setAssignmentBoard(res.data || []);
        })
        .catch(() => undefined);
    }
  }, []);

  const ensureReceptionsLoaded = useCallback(async () => {
    if (receptionsLoadedRef.current) return;
    try {
      const data = await withTimeout(
        fetchReceptionOptionsForCompareClient(40),
        8000,
        'listado recepciones'
      );
      setReceptions(data);
    } catch (e: any) {
      toastRef.current({
        variant: 'destructive',
        title: 'Recepciones',
        description: e?.message || 'No se pudo cargar el listado de RK (solo nombres).',
      });
      setReceptions([]);
    }
    receptionsLoadedRef.current = true;
  }, []);

  const ensureOperatorsLoaded = useCallback(async () => {
    if (operatorsLoadedRef.current) return;
    const opRes = await listAssignableOperatorsForRemainders();
    if (opRes.success) setOperators(opRes.data || []);
    operatorsLoadedRef.current = true;
  }, []);

  const loadDetailTasks = useCallback(async (compareId: string) => {
    const res = await listRemainderTasksByCompare(compareId);
    if (res.success) setTasks(res.data || []);
    else setTasks([]);
  }, []);

  // Una sola carga al montar (reloadList es estable).
  useEffect(() => {
    void reloadList();
  }, [reloadList]);

  useEffect(() => {
    if (view === 'new') void ensureReceptionsLoaded();
    if (view === 'new' || view === 'detail') void ensureOperatorsLoaded();
  }, [view, ensureReceptionsLoaded, ensureOperatorsLoaded]);

  const taskByRef = useMemo(() => {
    const m = new Map<string, DistributionRemainderTask>();
    for (const t of tasks) m.set(t.reference, t);
    return m;
  }, [tasks]);

  const detailLines = useMemo(() => {
    const lines = selected?.lines || [];
    if (!onlyRemainder) return lines;
    return lines.filter((l) => l.remainderQty !== 0);
  }, [selected, onlyRemainder]);

  const onPlanFile = async (file: File | null) => {
    if (!file) return;
    try {
      const data = await parseExcelFile<DistributionPlanRowInput>(file);
      if (!validateComparePlanData(data as any[])) {
        throw new Error('Columnas requeridas: REFERENCIA y CANT (o CANTIDAD). BODEGA es opcional.');
      }
      setPlanRows(data);
      setPlanFileName(file.name);
      toast({ title: 'Distribución cargada', description: `${data.length} filas` });
    } catch (e: any) {
      setPlanRows(null);
      setPlanFileName('');
      toast({
        variant: 'destructive',
        title: 'Archivo de distribución',
        description: e?.message || 'No se pudo leer el Excel.',
      });
    }
  };

  const onStockFile = async (file: File | null) => {
    if (!file) return;
    try {
      const { rows, sheetName } = await parsePhysicalExcelForCompare(file);
      if (!validateComparePhysicalRows(rows)) {
        throw new Error(
          'Columnas requeridas: Referencia + Cant. Leída (o Total Leído / CANTD LEIDA).'
        );
      }
      setStockRows(rows as DistributionStockRowInput[]);
      setStockFileName(`${file.name} · ${sheetName}`);
      toast({
        title: 'Físico cargado',
        description: `${rows.length} filas (${sheetName})`,
      });
    } catch (e: any) {
      setStockRows(null);
      setStockFileName('');
      toast({
        variant: 'destructive',
        title: 'Excel de recepción / existencias',
        description: e?.message || 'No se pudo leer el Excel.',
      });
    }
  };

  const handleCreate = async () => {
    if (!user?.uid) {
      toast({ variant: 'destructive', title: 'Sesión', description: 'Inicie sesión.' });
      return;
    }
    if (!stockRows?.length) {
      toast({
        variant: 'destructive',
        title: 'Físico',
        description:
          'Suba el Excel de recepción (Reporte completo: Referencia + Cant. Leída) o existencias.',
      });
      return;
    }
    if (!planRows?.length) {
      toast({
        variant: 'destructive',
        title: 'Distribución',
        description: 'Suba el Excel de reparto (REFERENCIA, CANT).',
      });
      return;
    }
    setSaving(true);
    const res = await createDistributionCompare({
      receptionOperationId: receptionId || null,
      physicalSource: 'excel_stock',
      planRows,
      stockRows,
      planFileName,
      stockFileName: stockFileName || undefined,
      notes: notes || undefined,
      createdBy: user.uid,
      createdByName: user.displayName || user.email || user.uid,
    });
    setSaving(false);
    if (!res.success || !res.data) {
      toast({
        variant: 'destructive',
        title: 'No se guardó',
        description: res.error || 'Error al comparar.',
      });
      return;
    }
    toast({
      title: 'Comparación guardada',
      description: `Remanente total: ${fmt(res.data.totals.remainderQty)} und.`,
    });
    setSelected(res.data);
    setItems((prev) => [ { ...res.data!, lines: [] }, ...prev.filter((x) => x.id !== res.data!.id) ]);
    setSelectedRefs(new Set());
    setView('detail');
    setTab('compares');
    setOnlyRemainder(true);
    await loadDetailTasks(res.data.id);
  };

  const openDetail = async (it: DistributionCompareOperation) => {
    setView('detail');
    setTab('compares');
    setSelectedRefs(new Set());
    setAssignOperatorId('');
    setDetailLoading(true);
    setSelected({ ...it, lines: it.lines || [] });
    try {
      const [full, _tasks] = await Promise.all([
        getDistributionCompare(it.id),
        loadDetailTasks(it.id),
        ensureOperatorsLoaded(),
      ]);
      if (full.success && full.data) setSelected(full.data);
      else if (!full.success) {
        toast({
          variant: 'destructive',
          title: 'Detalle',
          description: full.error || 'No se pudo cargar el detalle.',
        });
      }
    } finally {
      setDetailLoading(false);
    }
  };

  const handleDeleteCompare = async (id: string) => {
    if (!isManager) return;
    const ok = window.confirm(
      '¿Eliminar esta comparación y sus tareas de remanente? No afecta recepción ni Distribuidor IA.'
    );
    if (!ok) return;
    setDeletingId(id);
    // UI optimista: quitar del listado de inmediato.
    setItems((prev) => prev.filter((x) => x.id !== id));
    if (selected?.id === id) {
      setSelected(null);
      setView('list');
      setTasks([]);
    }
    const res = await deleteDistributionCompare(id);
    setDeletingId(null);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'Eliminar', description: res.error });
      await reloadList();
      return;
    }
    toast({
      title: 'Comparación eliminada',
      description: `Tareas: ${res.deletedTasks || 0} · Líneas: ${res.deletedLines || 0}`,
    });
    // Solo refrescar pestañas livianas de tareas (no recepciones/usuarios).
    if (user?.uid) {
      const myRes = await listMyRemainderTasks(user.uid);
      if (myRes.success) setMyTasks(myRes.data || []);
    }
    if (isManager) {
      const pendRes = await listPendingValidationRemainderTasks();
      if (pendRes.success) setPendingTasks(pendRes.data || []);
    }
  };

  const toggleRef = (reference: string, checked: boolean) => {
    setSelectedRefs((prev) => {
      const next = new Set(prev);
      if (checked) next.add(reference);
      else next.delete(reference);
      return next;
    });
  };

  const handleAssign = async () => {
    if (!selected || !user?.uid) return;

    // Preferir operario por fila; si hay seleccionadas sin fila, usar el dropdown global.
    const refs = selectedRefs.size
      ? [...selectedRefs]
      : Object.keys(rowOperatorByRef).filter((r) => rowOperatorByRef[r]);

    const assignments = refs
      .map((reference) => {
        const operatorId = rowOperatorByRef[reference] || assignOperatorId;
        const op = operators.find((o) => o.uid === operatorId);
        return {
          reference,
          operatorId,
          operatorName: op?.displayName || operatorId,
        };
      })
      .filter((a) => a.operatorId);

    if (!assignments.length) {
      toast({
        variant: 'destructive',
        title: 'Asignación',
        description: 'Elija operario por referencia (o seleccione filas + operario).',
      });
      return;
    }

    setSaving(true);
    const res = await assignDistributionRemainders({
      compareId: selected.id,
      assignments,
      assignedBy: user.uid,
      assignedByName: user.displayName || user.email || user.uid,
    });
    setSaving(false);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'Asignación', description: res.error });
      return;
    }
    toast({
      title: 'Remanentes asignados',
      description: `Creadas: ${res.created || 0} · Actualizadas: ${res.updated || 0}`,
    });
    setSelectedRefs(new Set());
    await loadDetailTasks(selected.id);
    await reloadList();
  };

  const handleAssignOne = async (reference: string) => {
    if (!selected || !user?.uid) return;
    const operatorId = rowOperatorByRef[reference];
    if (!operatorId) {
      toast({
        variant: 'destructive',
        title: 'Asignación',
        description: 'Seleccione el operario de esa referencia.',
      });
      return;
    }
    const op = operators.find((o) => o.uid === operatorId);
    setSaving(true);
    const res = await assignDistributionRemainders({
      compareId: selected.id,
      assignments: [
        {
          reference,
          operatorId,
          operatorName: op?.displayName || operatorId,
        },
      ],
      assignedBy: user.uid,
      assignedByName: user.displayName || user.email || user.uid,
    });
    setSaving(false);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'Asignación', description: res.error });
      return;
    }
    toast({ title: 'Asignada', description: `${reference} → ${op?.displayName || operatorId}` });
    await loadDetailTasks(selected.id);
    await reloadList();
  };

  const handleClaim = async (compareId: string, reference: string) => {
    if (!user?.uid) return;
    const key = `${compareId}:${reference}`;
    setClaimingKey(key);
    const res = await claimDistributionRemainder({
      compareId,
      reference,
      operatorId: user.uid,
      operatorName: user.displayName || user.email || user.uid,
    });
    setClaimingKey(null);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'Tomar referencia', description: res.error });
      return;
    }
    toast({ title: 'Referencia tomada', description: `${reference} quedó en sus remanentes.` });
    if (selected?.id === compareId) await loadDetailTasks(compareId);
    await reloadList();
    setTab('myTasks');
  };

  /** Supervisor confirma en bodega lo entregado, sin asignar a operario. */
  const handleSupervisorDirectConfirm = async () => {
    if (!selected || !user?.uid) return;
    if (selectedRefs.size === 0) {
      toast({
        variant: 'destructive',
        title: 'Validación',
        description: 'Marque las referencias remanentes que recibió/confirmó.',
      });
      return;
    }
    const items = [...selectedRefs].map((reference) => {
      const line = (selected.lines || []).find((l) => l.reference === reference);
      const draft = returnDrafts[`direct:${reference}`];
      const confirmedQty =
        draft === undefined || draft === ''
          ? line?.remainderQty || 0
          : Number(String(draft).replace(/,/g, ''));
      return { reference, confirmedQty };
    });
    setSaving(true);
    const res = await supervisorConfirmRemaindersDirect({
      compareId: selected.id,
      items,
      validatorId: user.uid,
      validatorName: user.displayName || user.email || user.uid,
    });
    setSaving(false);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'Validación directa', description: res.error });
      return;
    }
    toast({
      title: 'Confirmado por supervisor',
      description: `${res.confirmed || 0} referencia(s) validadas sin asignación.`,
    });
    setSelectedRefs(new Set());
    await loadDetailTasks(selected.id);
    await reloadList();
  };

  const handleSubmitReturn = async (task: DistributionRemainderTask) => {
    if (!user?.uid) return;
    const raw = returnDrafts[task.id];
    const qty =
      raw === undefined || raw === ''
        ? task.expectedRemainderQty
        : Number(String(raw).replace(/,/g, ''));
    setBusyTaskId(task.id);
    const res = await submitRemainderReturn({
      taskId: task.id,
      returnedQty: qty,
      operatorId: user.uid,
      operatorName: user.displayName || user.email || user.uid,
    });
    setBusyTaskId(null);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'Devolución', description: res.error });
      return;
    }
    toast({
      title: 'Devolución enviada',
      description: `${task.reference}: ${fmt(qty)} und. esperando validación.`,
    });
    await reloadList();
    if (selected) await loadDetailTasks(selected.id);
  };

  const handleValidate = async (task: DistributionRemainderTask) => {
    if (!user?.uid) return;
    setBusyTaskId(task.id);
    const res = await validateRemainderTask({
      taskId: task.id,
      validatorId: user.uid,
      validatorName: user.displayName || user.email || user.uid,
    });
    setBusyTaskId(null);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'Validación', description: res.error });
      return;
    }
    toast({ title: 'Validado', description: `${task.reference} cerrado.` });
    await reloadList();
    if (selected) await loadDetailTasks(selected.id);
  };

  const handleReject = async (task: DistributionRemainderTask) => {
    if (!user?.uid) return;
    const reason = String(rejectDrafts[task.id] || '').trim();
    if (!reason) {
      toast({
        variant: 'destructive',
        title: 'Rechazo',
        description: 'Escriba el motivo (ej. faltan unidades).',
      });
      return;
    }
    setBusyTaskId(task.id);
    const res = await rejectRemainderTask({
      taskId: task.id,
      validatorId: user.uid,
      validatorName: user.displayName || user.email || user.uid,
      reason,
    });
    setBusyTaskId(null);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'Rechazo', description: res.error });
      return;
    }
    toast({ title: 'Rechazado', description: 'El operario debe volver a reportar.' });
    await reloadList();
    if (selected) await loadDetailTasks(selected.id);
  };

  const resetNewForm = () => {
    setReceptionId('');
    setPlanRows(null);
    setPlanFileName('');
    setStockRows(null);
    setStockFileName('');
    setNotes('');
  };

  const back = () => {
    if (view === 'list') onReturnToSuite();
    else {
      setView('list');
      setSelected(null);
      setTasks([]);
    }
  };

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-4 max-w-7xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button type="button" variant="outline" size="icon" onClick={back}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Scale className="h-6 w-6 text-primary" />
              Físico vs Distribución
            </h1>
            <p className="text-sm text-muted-foreground">
              Cruce por referencia y cantidad · Remanente · Asignación / validación supervisor
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => void reloadList()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
          {view === 'list' && isManager ? (
            <Button
              type="button"
              onClick={() => {
                resetNewForm();
                setView('new');
              }}
            >
              Nueva comparación
            </Button>
          ) : null}
        </div>
      </div>

      {view === 'list' ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={tab === 'compares' ? 'default' : 'outline'}
            onClick={() => setTab('compares')}
          >
            Comparaciones
          </Button>
          <Button
            type="button"
            size="sm"
            variant={tab === 'myTasks' ? 'default' : 'outline'}
            onClick={() => setTab('myTasks')}
          >
            Mis remanentes ({myTasks.length})
          </Button>
          <Button
            type="button"
            size="sm"
            variant={tab === 'available' ? 'default' : 'outline'}
            onClick={() => setTab('available')}
          >
            Disponibles ({availableClaims.length})
          </Button>
          {isManager ? (
            <>
              <Button
                type="button"
                size="sm"
                variant={tab === 'assignments' ? 'default' : 'outline'}
                onClick={() => setTab('assignments')}
              >
                Asignaciones ({assignmentBoard.length})
              </Button>
              <Button
                type="button"
                size="sm"
                variant={tab === 'pendingValidation' ? 'default' : 'outline'}
                onClick={() => setTab('pendingValidation')}
              >
                Por validar ({pendingTasks.length})
              </Button>
            </>
          ) : null}
        </div>
      ) : null}

      {view === 'list' && tab === 'compares' ? (
        <Card>
          <CardHeader>
            <CardTitle>Comparaciones guardadas</CardTitle>
            <CardDescription>
              Módulo aislado: no modifica Recepción ni Distribuidor IA.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-10 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : listError ? (
              <div className="text-center py-10 text-muted-foreground space-y-3">
                <p className="text-sm text-destructive">{listError}</p>
                <Button type="button" variant="outline" size="sm" onClick={() => void reloadList()}>
                  Reintentar
                </Button>
              </div>
            ) : items.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground space-y-3">
                <PackageSearch className="h-10 w-10 mx-auto opacity-50" />
                <p>Aún no hay comparaciones.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>RK / Recepción</TableHead>
                      <TableHead className="text-right">Físico</TableHead>
                      <TableHead className="text-right">Distribuido</TableHead>
                      <TableHead className="text-right">Remanente</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((it) => (
                      <TableRow key={it.id}>
                        <TableCell className="whitespace-nowrap text-sm">
                          {it.createdAt ? new Date(it.createdAt).toLocaleString('es-CO') : '—'}
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{it.rkIdentifier || '—'}</div>
                          <div className="text-xs text-muted-foreground">
                            {it.receptionSupplier || it.createdByName || ''}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmt(it.totals?.physicalQty)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmt(it.totals?.distributedQty)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">
                          {fmt(it.totals?.remainderQty)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{compareStatusLabel(it.status)}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() => void openDetail(it)}
                            >
                              Ver / asignar
                            </Button>
                            {isManager ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={deletingId === it.id}
                                onClick={() => void handleDeleteCompare(it.id)}
                              >
                                {deletingId === it.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Trash2 className="h-4 w-4" />
                                )}
                              </Button>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {view === 'list' && tab === 'myTasks' ? (
        <Card>
          <CardHeader>
            <CardTitle>Mis remanentes asignados</CardTitle>
            <CardDescription>
              Referencias que le asignó un supervisor o que usted tomó. Registre la devolución a bodega.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {myTasks.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No tiene tareas pendientes. Revise la pestaña <strong>Disponibles</strong> para tomar una
                referencia.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>RK</TableHead>
                    <TableHead>Referencia</TableHead>
                    <TableHead className="text-right">Esperado</TableHead>
                    <TableHead>Devuelto</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Origen</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {myTasks.map((task) => (
                    <TableRow key={task.id}>
                      <TableCell className="text-sm">{task.rkIdentifier || '—'}</TableCell>
                      <TableCell className="font-medium">{task.reference}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmt(task.expectedRemainderQty)}
                      </TableCell>
                      <TableCell>
                        {task.status === 'assigned' || task.status === 'rejected' ? (
                          <Input
                            className="h-9 w-28"
                            type="number"
                            min={0}
                            placeholder={String(task.expectedRemainderQty)}
                            value={returnDrafts[task.id] ?? ''}
                            onChange={(e) =>
                              setReturnDrafts((prev) => ({ ...prev, [task.id]: e.target.value }))
                            }
                          />
                        ) : (
                          <span className="tabular-nums">{fmt(task.returnedQty || 0)}</span>
                        )}
                        {task.rejectionReason ? (
                          <div className="text-xs text-red-600 mt-1">{task.rejectionReason}</div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{taskStatusLabel(task.status)}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {task.claimedBySelf ? 'Tomada por usted' : 'Asignada'}
                      </TableCell>
                      <TableCell className="text-right">
                        {task.status === 'assigned' || task.status === 'rejected' ? (
                          <Button
                            type="button"
                            size="sm"
                            disabled={busyTaskId === task.id}
                            onClick={() => void handleSubmitReturn(task)}
                          >
                            {busyTaskId === task.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              'Enviar devolución'
                            )}
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">En revisión</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}

      {view === 'list' && tab === 'available' ? (
        <Card>
          <CardHeader>
            <CardTitle>Referencias disponibles</CardTitle>
            <CardDescription>
              Remanentes sin asignar. Puede tomar una referencia y luego registrarla en Mis remanentes.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {availableClaims.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No hay referencias sin asignar por ahora.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>RK</TableHead>
                    <TableHead>Referencia</TableHead>
                    <TableHead className="text-right">Remanente</TableHead>
                    <TableHead>Comparación</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {availableClaims.map((row) => {
                    const key = `${row.compareId}:${row.reference}`;
                    return (
                      <TableRow key={key}>
                        <TableCell className="text-sm">{row.rkIdentifier || '—'}</TableCell>
                        <TableCell className="font-medium">{row.reference}</TableCell>
                        <TableCell className="text-right tabular-nums text-amber-600">
                          {fmt(row.remainderQty)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {compareStatusLabel(row.compareStatus)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            size="sm"
                            disabled={claimingKey === key}
                            onClick={() => void handleClaim(row.compareId, row.reference)}
                          >
                            {claimingKey === key ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              'Tomar'
                            )}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}

      {view === 'list' && tab === 'assignments' && isManager ? (
        <Card>
          <CardHeader>
            <CardTitle>Quién tiene cada referencia</CardTitle>
            <CardDescription>
              Tablero de asignaciones: operario, si tomó/asignaron, devolución y si ya se validó el remanente.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {assignmentBoard.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">Aún no hay asignaciones.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>RK</TableHead>
                    <TableHead>Referencia</TableHead>
                    <TableHead>Operario</TableHead>
                    <TableHead className="text-right">Esperado</TableHead>
                    <TableHead className="text-right">Devuelto</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Validado</TableHead>
                    <TableHead>Origen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assignmentBoard.map((task) => (
                    <TableRow key={task.id}>
                      <TableCell className="text-sm">{task.rkIdentifier || '—'}</TableCell>
                      <TableCell className="font-medium">{task.reference}</TableCell>
                      <TableCell className="text-sm">
                        {task.assignedOperatorName || task.assignedOperatorId}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmt(task.expectedRemainderQty)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {typeof task.returnedQty === 'number' ? fmt(task.returnedQty) : '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{taskStatusLabel(task.status)}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {task.status === 'validated' ? (
                          <span className="text-emerald-700">
                            Sí
                            {task.validatedByName ? ` · ${task.validatedByName}` : ''}
                          </span>
                        ) : task.status === 'submitted' ? (
                          <span className="text-amber-700">Pendiente</span>
                        ) : (
                          <span className="text-muted-foreground">No</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {task.claimedBySelf ? 'Auto' : 'Supervisor'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}

      {view === 'list' && tab === 'pendingValidation' && isManager ? (
        <Card>
          <CardHeader>
            <CardTitle>Devoluciones por validar</CardTitle>
            <CardDescription>
              Confirme que devolvieron la cantidad completa del remanente (ej. 20 de 20).
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {pendingTasks.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No hay pendientes.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>RK</TableHead>
                    <TableHead>Referencia</TableHead>
                    <TableHead>Operario</TableHead>
                    <TableHead className="text-right">Esperado</TableHead>
                    <TableHead className="text-right">Devuelto</TableHead>
                    <TableHead>Validar</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingTasks.map((task) => {
                    const match = (task.returnedQty || 0) === task.expectedRemainderQty;
                    return (
                      <TableRow key={task.id}>
                        <TableCell>{task.rkIdentifier || '—'}</TableCell>
                        <TableCell className="font-medium">{task.reference}</TableCell>
                        <TableCell className="text-sm">
                          {task.assignedOperatorName || task.assignedOperatorId}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmt(task.expectedRemainderQty)}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums font-semibold ${
                            match ? 'text-emerald-600' : 'text-amber-600'
                          }`}
                        >
                          {fmt(task.returnedQty || 0)}
                          {!match ? ' ≠' : ' ✓'}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              type="button"
                              size="sm"
                              disabled={busyTaskId === task.id}
                              onClick={() => void handleValidate(task)}
                            >
                              <CheckCircle2 className="h-4 w-4 mr-1" />
                              Validar
                            </Button>
                            <Input
                              className="h-9 w-40"
                              placeholder="Motivo rechazo"
                              value={rejectDrafts[task.id] || ''}
                              onChange={(e) =>
                                setRejectDrafts((prev) => ({ ...prev, [task.id]: e.target.value }))
                              }
                            />
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busyTaskId === task.id}
                              onClick={() => void handleReject(task)}
                            >
                              <XCircle className="h-4 w-4 mr-1" />
                              Rechazar
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}

      {view === 'new' && isManager ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>1. Físico recibido</CardTitle>
              <CardDescription>
                Suba el mismo Excel de recepción (<strong>Reporte completo</strong>: Referencia +
                Cant. Leída / Total Leído). Firebase solo guarda el nombre de la operación vinculada;
                no lee escaneos.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Excel de recepción / existencias *</Label>
                <Input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => void onStockFile(e.target.files?.[0] || null)}
                />
                {stockFileName ? (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <FileSpreadsheet className="h-3 w-3" /> {stockFileName} (
                    {stockRows?.length || 0} filas)
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label>Vincular operación (solo nombre RK, opcional)</Label>
                <Select
                  value={receptionId || undefined}
                  onValueChange={setReceptionId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccione RK / recepción" />
                  </SelectTrigger>
                  <SelectContent>
                    {receptions.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.rk_identifier}
                        {r.supplier ? ` · ${r.supplier}` : ''} · {r.status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Solo se lee el nombre/proveedor (1 documento). Las cantidades vienen del Excel.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Notas</Label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>2. Distribución comercial</CardTitle>
              <CardDescription>
                Excel mínimo: <strong>REFERENCIA</strong> + <strong>CANT</strong> (o CANTIDAD).{' '}
                <strong>BODEGA</strong> es opcional.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Archivo de distribución *</Label>
                <Input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => void onPlanFile(e.target.files?.[0] || null)}
                />
                {planFileName ? (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <FileSpreadsheet className="h-3 w-3" /> {planFileName} ({planRows?.length || 0}{' '}
                    filas)
                  </p>
                ) : null}
              </div>
              <Button type="button" className="w-full" disabled={saving} onClick={() => void handleCreate()}>
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Comparando…
                  </>
                ) : (
                  'Comparar y guardar'
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {view === 'detail' && selected ? (
        <div className="space-y-4">
          {detailLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando detalle por referencia…
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Físico</CardDescription>
                <CardTitle className="text-3xl tabular-nums">{fmt(selected.totals.physicalQty)}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Distribuido</CardDescription>
                <CardTitle className="text-3xl tabular-nums">
                  {fmt(selected.totals.distributedQty)}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Remanente bodega</CardDescription>
                <CardTitle className="text-3xl tabular-nums text-amber-600">
                  {fmt(selected.totals.remainderQty)}
                </CardTitle>
              </CardHeader>
            </Card>
          </div>

          {isManager && selected.status !== 'archived' ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <UserCheck className="h-5 w-5" /> Remanente · asignación o validación directa
                </CardTitle>
                <CardDescription>
                  Cada referencia puede ir a un operario distinto (elige en la fila). También puede
                  marcar varias y usar un operario común, o confirmar usted mismo sin asignar.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1 min-w-[220px]">
                    <Label>Operario común (opcional, para selección múltiple)</Label>
                    <Select
                      value={assignOperatorId || undefined}
                      onValueChange={(v) => {
                        setAssignOperatorId(v);
                        // Aplica el mismo operario a las filas marcadas
                        setRowOperatorByRef((prev) => {
                          const next = { ...prev };
                          for (const ref of selectedRefs) next[ref] = v;
                          return next;
                        });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Seleccionar…" />
                      </SelectTrigger>
                      <SelectContent>
                        {operators.map((o) => (
                          <SelectItem key={o.uid} value={o.uid}>
                            {o.displayName} ({o.role})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button type="button" disabled={saving} onClick={() => void handleAssign()}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Asignar configuradas
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={saving}
                    onClick={() => void handleSupervisorDirectConfirm()}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1" />
                    Confirmar yo mismo ({selectedRefs.size})
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const refs = (selected.lines || [])
                        .filter((l) => l.remainderQty > 0)
                        .filter((l) => {
                          const t = taskByRef.get(l.reference);
                          return !t || t.status === 'assigned' || t.status === 'rejected';
                        })
                        .map((l) => l.reference);
                      setSelectedRefs(new Set(refs));
                    }}
                  >
                    Seleccionar remanentes
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={deletingId === selected.id}
                    onClick={() => void handleDeleteCompare(selected.id)}
                  >
                    {deletingId === selected.id ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    ) : (
                      <Trash2 className="h-4 w-4 mr-1" />
                    )}
                    Eliminar comparación
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  En cada fila con remanente &gt; 0 elija el operario y pulse Asignar, o configure varias
                  y use &quot;Asignar configuradas&quot;.
                </p>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>
                  Detalle {selected.rkIdentifier ? `· ${selected.rkIdentifier}` : ''}
                </CardTitle>
                <CardDescription>
                  Estado: {compareStatusLabel(selected.status)}
                  {selected.notes ? ` · ${selected.notes}` : ''}
                </CardDescription>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={onlyRemainder}
                  onCheckedChange={(v) => setOnlyRemainder(Boolean(v))}
                />
                Solo diferencias ≠ 0
              </label>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {isManager ? <TableHead className="w-10" /> : null}
                    <TableHead>Referencia</TableHead>
                    <TableHead className="text-right">Físico</TableHead>
                    <TableHead className="text-right">Distribuido</TableHead>
                    <TableHead className="text-right">Remanente</TableHead>
                    <TableHead>Asignación / validación</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailLines.map((line) => {
                    const task = taskByRef.get(line.reference);
                    const canSelect =
                      isManager &&
                      line.remainderQty > 0 &&
                      (!task || task.status === 'assigned' || task.status === 'rejected');
                    return (
                      <TableRow key={line.reference}>
                        {isManager ? (
                          <TableCell>
                            {canSelect ? (
                              <Checkbox
                                checked={selectedRefs.has(line.reference)}
                                onCheckedChange={(v) => toggleRef(line.reference, Boolean(v))}
                              />
                            ) : null}
                          </TableCell>
                        ) : null}
                        <TableCell className="font-medium">{line.reference}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmt(line.physicalQty)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmt(line.distributedQty)}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums font-semibold ${
                            line.remainderQty > 0
                              ? 'text-amber-600'
                              : line.remainderQty < 0
                                ? 'text-red-600'
                                : ''
                          }`}
                        >
                          {fmt(line.remainderQty)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {!task ? (
                            line.remainderQty > 0 ? (
                              <div className="space-y-1">
                                {isManager && canSelect ? (
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Select
                                      value={rowOperatorByRef[line.reference] || undefined}
                                      onValueChange={(v) =>
                                        setRowOperatorByRef((prev) => ({
                                          ...prev,
                                          [line.reference]: v,
                                        }))
                                      }
                                    >
                                      <SelectTrigger className="h-8 w-[180px]">
                                        <SelectValue placeholder="Operario…" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {operators.map((o) => (
                                          <SelectItem key={o.uid} value={o.uid}>
                                            {o.displayName}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    <Button
                                      type="button"
                                      size="sm"
                                      disabled={saving || !rowOperatorByRef[line.reference]}
                                      onClick={() => void handleAssignOne(line.reference)}
                                    >
                                      Asignar
                                    </Button>
                                    {selectedRefs.has(line.reference) ? (
                                      <Input
                                        className="h-8 w-24"
                                        type="number"
                                        min={0}
                                        placeholder={`${line.remainderQty}`}
                                        title="Cantidad para confirmar yo mismo"
                                        value={returnDrafts[`direct:${line.reference}`] ?? ''}
                                        onChange={(e) =>
                                          setReturnDrafts((prev) => ({
                                            ...prev,
                                            [`direct:${line.reference}`]: e.target.value,
                                          }))
                                        }
                                      />
                                    ) : null}
                                  </div>
                                ) : !isManager && selected ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={
                                      claimingKey === `${selected.id}:${line.reference}` ||
                                      selected.status === 'archived'
                                    }
                                    onClick={() => void handleClaim(selected.id, line.reference)}
                                  >
                                    {claimingKey === `${selected.id}:${line.reference}` ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      'Tomar'
                                    )}
                                  </Button>
                                ) : (
                                  <span className="text-muted-foreground">Sin asignar</span>
                                )}
                              </div>
                            ) : (
                              '—'
                            )
                          ) : (
                            <div className="space-y-0.5">
                              <Badge variant="outline">{taskStatusLabel(task.status)}</Badge>
                              <div className="text-xs text-muted-foreground">
                                {task.assignedOperatorName || task.assignedOperatorId}
                                {task.claimedBySelf ? ' · auto' : ''}
                                {typeof task.returnedQty === 'number'
                                  ? ` · devuelto ${fmt(task.returnedQty)}/${fmt(task.expectedRemainderQty)}`
                                  : ''}
                                {task.status === 'validated'
                                  ? ` · validado${task.validatedByName ? ` (${task.validatedByName})` : ''}`
                                  : task.status === 'submitted'
                                    ? ' · pendiente validar'
                                    : ''}
                              </div>
                              {isManager && task.status === 'submitted' ? (
                                <div className="flex flex-wrap gap-2 pt-1">
                                  <Button
                                    type="button"
                                    size="sm"
                                    disabled={busyTaskId === task.id}
                                    onClick={() => void handleValidate(task)}
                                  >
                                    Validar
                                  </Button>
                                  <Input
                                    className="h-8 w-36"
                                    placeholder="Motivo rechazo"
                                    value={rejectDrafts[task.id] || ''}
                                    onChange={(e) =>
                                      setRejectDrafts((prev) => ({
                                        ...prev,
                                        [task.id]: e.target.value,
                                      }))
                                    }
                                  />
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={busyTaskId === task.id}
                                    onClick={() => void handleReject(task)}
                                  >
                                    Rechazar
                                  </Button>
                                </div>
                              ) : null}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

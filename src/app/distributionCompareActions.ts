'use server';

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { firestore } from '@/services/firebase';
import type {
  AppUser,
  DistributionCompareLine,
  DistributionCompareOperation,
  DistributionComparePhysicalSource,
  DistributionCompareTotals,
  DistributionRemainderTask,
  DistributionRemainderTaskStatus,
  ReceptionOperation,
  ScannedItem,
} from '@/types';

const COL = 'distributionCompares';
const TASKS_COL = 'distributionRemainderTasks';
const RECEPTION_COL = 'receptionOperations';
const SCANNED_COL = 'scannedItems';
const USERS_COL = 'users';

function stripUndefinedDeep(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map(stripUndefinedDeep).filter((v) => v !== undefined);
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const next = stripUndefinedDeep(v);
    if (next !== undefined) out[k] = next;
  }
  return out;
}

function normRef(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const n = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

export type DistributionPlanRowInput = {
  REFERENCIA: string;
  BODEGA?: string;
  CANT?: number | string;
  CANTIDAD?: number | string;
};

export type DistributionStockRowInput = {
  REFERENCIA: string;
  TALLA?: string;
  'CANTD LEIDA'?: number | string;
  CANTD_LEIDA?: number | string;
  CANT?: number | string;
};

function buildTotals(lines: DistributionCompareLine[]): DistributionCompareTotals {
  return {
    physicalQty: lines.reduce((s, l) => s + l.physicalQty, 0),
    distributedQty: lines.reduce((s, l) => s + l.distributedQty, 0),
    remainderQty: lines.reduce((s, l) => s + l.remainderQty, 0),
    referencesWithRemainder: lines.filter((l) => l.remainderQty > 0).length,
  };
}

/** Agrega físico por referencia desde filas tipo existencias. */
function aggregatePhysicalFromStockRows(
  rows: DistributionStockRowInput[]
): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows || []) {
    const ref = normRef(row.REFERENCIA);
    if (!ref) continue;
    const qty =
      toNumber(row['CANTD LEIDA']) || toNumber(row.CANTD_LEIDA) || toNumber(row.CANT);
    if (qty === 0) continue;
    map.set(ref, (map.get(ref) || 0) + qty);
  }
  return map;
}

/** Agrega reparto por referencia (BODEGA opcional). */
function aggregateDistributedFromPlanRows(rows: DistributionPlanRowInput[]): {
  byRef: Map<string, number>;
  byRefBodega: Map<string, Map<string, number>>;
} {
  const byRef = new Map<string, number>();
  const byRefBodega = new Map<string, Map<string, number>>();
  for (const row of rows || []) {
    const ref = normRef(row.REFERENCIA);
    const bodegaRaw = String(row.BODEGA ?? '').trim();
    const bodega = bodegaRaw || 'TOTAL';
    const qty = toNumber(row.CANT) || toNumber(row.CANTIDAD);
    if (!ref || qty === 0) continue;
    byRef.set(ref, (byRef.get(ref) || 0) + qty);
    if (!byRefBodega.has(ref)) byRefBodega.set(ref, new Map());
    const bm = byRefBodega.get(ref)!;
    bm.set(bodega, (bm.get(bodega) || 0) + qty);
  }
  return { byRef, byRefBodega };
}

function buildCompareLines(opts: {
  physicalByRef: Map<string, number>;
  distributedByRef: Map<string, number>;
  byRefBodega: Map<string, Map<string, number>>;
}): DistributionCompareLine[] {
  const refs = new Set<string>([
    ...opts.physicalByRef.keys(),
    ...opts.distributedByRef.keys(),
  ]);
  const lines: DistributionCompareLine[] = [];
  for (const reference of [...refs].sort()) {
    const physicalQty = opts.physicalByRef.get(reference) || 0;
    const distributedQty = opts.distributedByRef.get(reference) || 0;
    const remainderQty = physicalQty - distributedQty;
    const bodegaMap = opts.byRefBodega.get(reference) || new Map();
    const byBodega = [...bodegaMap.entries()]
      .map(([bodega, qty]) => ({ bodega, qty }))
      .sort((a, b) => a.bodega.localeCompare(b.bodega, 'es'));
    lines.push({ reference, physicalQty, distributedQty, remainderQty, byBodega });
  }
  return lines;
}

async function loadReceptionPhysicalByRef(
  receptionOperationId: string
): Promise<{
  success: boolean;
  physicalByRef?: Map<string, number>;
  operation?: ReceptionOperation;
  scanDocCount?: number;
  physicalRawQty?: number;
  skippedNoQty?: number;
  error?: string;
}> {
  try {
    const opSnap = await getDoc(doc(firestore, RECEPTION_COL, receptionOperationId));
    if (!opSnap.exists()) {
      return { success: false, error: 'No se encontró la operación de recepción.' };
    }
    const operation = { id: opSnap.id, ...opSnap.data() } as ReceptionOperation;

    // Sin limit artificial: Cant. Leída de recepción suma TODOS los scannedItems.
    const scansSnap = await getDocs(
      query(collection(firestore, SCANNED_COL), where('reception_id', '==', receptionOperationId))
    );
    const physicalByRef = new Map<string, number>();
    let physicalRawQty = 0;
    let skippedNoQty = 0;

    scansSnap.forEach((d) => {
      const item = d.data() as ScannedItem;
      const qty = toNumber(item.quantity);
      if (!qty) {
        skippedNoQty += 1;
        return;
      }
      physicalRawQty += qty;
      // Misma base que recepción: no descartar lecturas sin referencia.
      const ref =
        normRef(item.reference) ||
        normRef(item.barcode) ||
        'SIN_REFERENCIA';
      physicalByRef.set(ref, (physicalByRef.get(ref) || 0) + qty);
    });

    // Solo si no hay ningún escaneo: respaldo con expectedItems (esperado, no leído).
    if (scansSnap.size === 0 && Array.isArray(operation.expectedItems)) {
      for (const ei of operation.expectedItems) {
        const ref = normRef((ei as any).reference) || normRef((ei as any).barcode) || 'SIN_REFERENCIA';
        const qty = toNumber((ei as any).expected_quantity);
        if (!qty) continue;
        physicalByRef.set(ref, (physicalByRef.get(ref) || 0) + qty);
        physicalRawQty += qty;
      }
    }

    return {
      success: true,
      physicalByRef,
      operation,
      scanDocCount: scansSnap.size,
      physicalRawQty,
      skippedNoQty,
    };
  } catch (e: any) {
    console.error('loadReceptionPhysicalByRef:', e);
    return { success: false, error: e?.message || 'Error al leer recepción.' };
  }
}

export async function listReceptionOptionsForCompare(limitN = 80): Promise<{
  success: boolean;
  data?: Array<{
    id: string;
    rk_identifier: string;
    supplier: string;
    status: string;
    totalScannedQuantity: number;
    expected_quantity: number;
    created_at: string;
  }>;
  error?: string;
}> {
  try {
    const snap = await getDocs(
      query(collection(firestore, RECEPTION_COL), orderBy('created_at', 'desc'), limit(limitN))
    );
    const data = snap.docs.map((d) => {
      const o = d.data() as ReceptionOperation;
      return {
        id: d.id,
        rk_identifier: o.rk_identifier || d.id,
        supplier: o.supplier || '',
        status: o.status,
        totalScannedQuantity: Number(o.totalScannedQuantity) || 0,
        expected_quantity: Number(o.expected_quantity) || 0,
        created_at: String(o.created_at || ''),
      };
    });
    return { success: true, data };
  } catch (e: any) {
    console.error('listReceptionOptionsForCompare:', e);
    return { success: false, error: e?.message || 'No se pudieron listar recepciones.' };
  }
}

export async function createDistributionCompare(input: {
  receptionOperationId?: string | null;
  physicalSource: DistributionComparePhysicalSource;
  planRows: DistributionPlanRowInput[];
  stockRows?: DistributionStockRowInput[];
  planFileName?: string;
  stockFileName?: string;
  notes?: string;
  createdBy: string;
  createdByName?: string;
}): Promise<{ success: boolean; id?: string; data?: DistributionCompareOperation; error?: string }> {
  try {
    if (!input.planRows?.length) {
      return { success: false, error: 'Suba el archivo de distribución (REFERENCIA, BODEGA, CANT).' };
    }
    if (!input.createdBy) {
      return { success: false, error: 'Usuario no autenticado.' };
    }

    const { byRef: distributedByRef, byRefBodega } = aggregateDistributedFromPlanRows(input.planRows);
    if (distributedByRef.size === 0) {
      return { success: false, error: 'El archivo de distribución no tiene cantidades válidas.' };
    }

    let physicalByRef = new Map<string, number>();
    let receptionOperationId: string | undefined;
    let rkIdentifier: string | undefined;
    let receptionSupplier: string | undefined;
    let notes = input.notes || '';

    if (input.physicalSource === 'reception_scan') {
      if (!input.receptionOperationId) {
        return { success: false, error: 'Seleccione la operación de recepción.' };
      }
      const loaded = await loadReceptionPhysicalByRef(input.receptionOperationId);
      if (!loaded.success || !loaded.physicalByRef) {
        return { success: false, error: loaded.error || 'No se pudo cargar el físico de recepción.' };
      }
      physicalByRef = loaded.physicalByRef;
      receptionOperationId = input.receptionOperationId;
      rkIdentifier = loaded.operation?.rk_identifier;
      receptionSupplier = loaded.operation?.supplier;
      if (physicalByRef.size === 0) {
        return {
          success: false,
          error: 'La recepción no tiene escaneos ni ítems esperados para comparar por referencia.',
        };
      }
      const reported = Number(loaded.operation?.totalScannedQuantity) || 0;
      const raw = Number(loaded.physicalRawQty) || 0;
      notes = [
        notes,
        `Físico = suma de scannedItems (${loaded.scanDocCount || 0} lecturas → ${raw} und).`,
        reported > 0 ? `Recepción reporta Cant. Leída ${reported}.` : '',
        reported > 0 && raw !== reported
          ? `AVISO: diferencia físico vs Cant. Leída (${raw} vs ${reported}).`
          : '',
        (Number(loaded.operation?.totalScannedQuantity) || 0) === 0 && (loaded.scanDocCount || 0) === 0
          ? 'Físico tomado de ítems esperados (sin escaneos en recepción).'
          : '',
      ]
        .filter(Boolean)
        .join(' ');
    } else {
      if (!input.stockRows?.length) {
        return { success: false, error: 'Suba el archivo de existencias físicas (REFERENCIA, TALLA, CANTD LEIDA).' };
      }
      physicalByRef = aggregatePhysicalFromStockRows(input.stockRows);
      if (physicalByRef.size === 0) {
        return { success: false, error: 'El archivo de existencias no tiene cantidades válidas.' };
      }
      if (input.receptionOperationId) {
        receptionOperationId = input.receptionOperationId;
        const opSnap = await getDoc(doc(firestore, RECEPTION_COL, input.receptionOperationId));
        if (opSnap.exists()) {
          const op = opSnap.data() as ReceptionOperation;
          rkIdentifier = op.rk_identifier;
          receptionSupplier = op.supplier;
        }
      }
    }

    const lines = buildCompareLines({ physicalByRef, distributedByRef, byRefBodega });
    const totals = buildTotals(lines);
    const now = new Date().toISOString();
    const ref = doc(collection(firestore, COL));
    const payload: DistributionCompareOperation = {
      id: ref.id,
      receptionOperationId,
      rkIdentifier,
      receptionSupplier,
      physicalSource: input.physicalSource,
      planFileName: input.planFileName,
      stockFileName: input.stockFileName,
      notes: notes || undefined,
      lines,
      totals,
      status: 'open',
      createdAt: now,
      updatedAt: now,
      createdBy: input.createdBy,
      createdByName: input.createdByName,
    };

    await setDoc(ref, stripUndefinedDeep(payload));
    return { success: true, id: ref.id, data: payload };
  } catch (e: any) {
    console.error('createDistributionCompare:', e);
    return { success: false, error: e?.message || 'No se pudo guardar la comparación.' };
  }
}

export async function listDistributionCompares(limitN = 50): Promise<{
  success: boolean;
  data?: DistributionCompareOperation[];
  error?: string;
}> {
  try {
    const snap = await getDocs(
      query(collection(firestore, COL), orderBy('createdAt', 'desc'), limit(limitN))
    );
    const data = snap.docs.map((d) => ({ id: d.id, ...d.data() } as DistributionCompareOperation));
    return { success: true, data };
  } catch (e: any) {
    console.error('listDistributionCompares:', e);
    return { success: false, error: e?.message || 'No se pudieron listar comparaciones.' };
  }
}

export async function getDistributionCompare(id: string): Promise<{
  success: boolean;
  data?: DistributionCompareOperation;
  error?: string;
}> {
  try {
    const snap = await getDoc(doc(firestore, COL, id));
    if (!snap.exists()) return { success: false, error: 'Comparación no encontrada.' };
    return { success: true, data: { id: snap.id, ...snap.data() } as DistributionCompareOperation };
  } catch (e: any) {
    return { success: false, error: e?.message || 'Error al cargar comparación.' };
  }
}

export async function archiveDistributionCompare(
  id: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await updateDoc(doc(firestore, COL, id), {
      status: 'archived',
      updatedAt: new Date().toISOString(),
    });
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e?.message || 'No se pudo archivar.' };
  }
}

async function refreshCompareWorkflowStatus(compareId: string): Promise<void> {
  const compareSnap = await getDoc(doc(firestore, COL, compareId));
  if (!compareSnap.exists()) return;
  const compare = compareSnap.data() as DistributionCompareOperation;
  if (compare.status === 'archived') return;

  const remainderRefs = new Set(
    (compare.lines || []).filter((l) => (l.remainderQty || 0) > 0).map((l) => l.reference)
  );
  if (remainderRefs.size === 0) {
    await updateDoc(doc(firestore, COL, compareId), {
      status: 'completed',
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  const tasksSnap = await getDocs(
    query(collection(firestore, TASKS_COL), where('compareId', '==', compareId), limit(500))
  );
  const tasks = tasksSnap.docs.map((d) => d.data() as DistributionRemainderTask);
  const active = tasks.filter((t) => remainderRefs.has(t.reference) && t.status !== 'rejected');

  let status: DistributionCompareOperation['status'] = 'open';
  if (active.some((t) => t.status === 'submitted')) status = 'pending_validation';
  else if (active.length > 0 && active.every((t) => t.status === 'validated')) status = 'completed';
  else if (active.length > 0) status = 'in_progress';

  await updateDoc(doc(firestore, COL, compareId), {
    status,
    updatedAt: new Date().toISOString(),
  });
}

export async function listAssignableOperatorsForRemainders(): Promise<{
  success: boolean;
  data?: Array<{ uid: string; displayName: string; role: string }>;
  error?: string;
}> {
  try {
    const snap = await getDocs(collection(firestore, USERS_COL));
    const users = snap.docs.map((d) => ({ uid: d.id, ...d.data() } as AppUser));
    const data = users
      .filter((u) => !u.disabled)
      .filter((u) => {
        const role = String(u.role || '').toLowerCase();
        return role === 'operator' || role === 'supervisor' || role === 'admin';
      })
      .map((u) => ({
        uid: u.uid,
        displayName: u.displayName || u.email || u.uid,
        role: String(u.role || ''),
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'es'));
    return { success: true, data };
  } catch (e: any) {
    return { success: false, error: e?.message || 'No se pudieron cargar operarios.' };
  }
}

export async function listRemainderTasksByCompare(compareId: string): Promise<{
  success: boolean;
  data?: DistributionRemainderTask[];
  error?: string;
}> {
  try {
    const snap = await getDocs(
      query(collection(firestore, TASKS_COL), where('compareId', '==', compareId), limit(500))
    );
    const data = snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as DistributionRemainderTask))
      .sort((a, b) => a.reference.localeCompare(b.reference, 'es'));
    return { success: true, data };
  } catch (e: any) {
    return { success: false, error: e?.message || 'No se pudieron cargar tareas.' };
  }
}

export async function listMyRemainderTasks(operatorId: string): Promise<{
  success: boolean;
  data?: DistributionRemainderTask[];
  error?: string;
}> {
  try {
    if (!operatorId) return { success: false, error: 'Operario no indicado.' };
    const snap = await getDocs(
      query(
        collection(firestore, TASKS_COL),
        where('assignedOperatorId', '==', operatorId),
        limit(200)
      )
    );
    const data = snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as DistributionRemainderTask))
      .filter((t) => t.status === 'assigned' || t.status === 'submitted' || t.status === 'rejected')
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    return { success: true, data };
  } catch (e: any) {
    return { success: false, error: e?.message || 'No se pudieron cargar sus tareas.' };
  }
}

export async function listPendingValidationRemainderTasks(): Promise<{
  success: boolean;
  data?: DistributionRemainderTask[];
  error?: string;
}> {
  try {
    const snap = await getDocs(
      query(collection(firestore, TASKS_COL), where('status', '==', 'submitted'), limit(200))
    );
    const data = snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as DistributionRemainderTask))
      .sort((a, b) => String(b.submittedAt || '').localeCompare(String(a.submittedAt || '')));
    return { success: true, data };
  } catch (e: any) {
    return { success: false, error: e?.message || 'No se pudieron cargar pendientes.' };
  }
}

/** Asigna remanentes (>0) de una comparación a un operario. */
export async function assignDistributionRemainders(input: {
  compareId: string;
  references: string[];
  operatorId: string;
  operatorName: string;
  assignedBy: string;
  assignedByName?: string;
}): Promise<{ success: boolean; created?: number; updated?: number; error?: string }> {
  try {
    if (!input.compareId || !input.operatorId || !input.assignedBy) {
      return { success: false, error: 'Faltan datos de asignación.' };
    }
    if (!input.references?.length) {
      return { success: false, error: 'Seleccione al menos una referencia con remanente.' };
    }

    const compareSnap = await getDoc(doc(firestore, COL, input.compareId));
    if (!compareSnap.exists()) return { success: false, error: 'Comparación no encontrada.' };
    const compare = { id: compareSnap.id, ...compareSnap.data() } as DistributionCompareOperation;
    if (compare.status === 'archived') {
      return { success: false, error: 'La comparación está archivada.' };
    }

    const lineByRef = new Map((compare.lines || []).map((l) => [l.reference, l]));
    const existingSnap = await getDocs(
      query(collection(firestore, TASKS_COL), where('compareId', '==', input.compareId), limit(500))
    );
    const existingByRef = new Map<string, { id: string; data: DistributionRemainderTask }>();
    existingSnap.forEach((d) => {
      const data = d.data() as DistributionRemainderTask;
      existingByRef.set(data.reference, { id: d.id, data });
    });

    const now = new Date().toISOString();
    let created = 0;
    let updated = 0;

    for (const reference of input.references) {
      const line = lineByRef.get(reference);
      if (!line || !(line.remainderQty > 0)) continue;

      const prev = existingByRef.get(reference);
      if (prev && (prev.data.status === 'submitted' || prev.data.status === 'validated')) {
        continue; // no reasignar en flujo avanzado
      }

      if (prev) {
        await updateDoc(doc(firestore, TASKS_COL, prev.id), {
          expectedRemainderQty: line.remainderQty,
          status: 'assigned' satisfies DistributionRemainderTaskStatus,
          assignedOperatorId: input.operatorId,
          assignedOperatorName: input.operatorName,
          assignedAt: now,
          assignedBy: input.assignedBy,
          assignedByName: input.assignedByName || null,
          returnedQty: null,
          submittedAt: null,
          submittedBy: null,
          submittedByName: null,
          validatedAt: null,
          validatedBy: null,
          validatedByName: null,
          rejectionReason: null,
          updatedAt: now,
        });
        updated += 1;
      } else {
        const ref = doc(collection(firestore, TASKS_COL));
        const payload: DistributionRemainderTask = {
          id: ref.id,
          compareId: input.compareId,
          rkIdentifier: compare.rkIdentifier,
          reference,
          expectedRemainderQty: line.remainderQty,
          status: 'assigned',
          assignedOperatorId: input.operatorId,
          assignedOperatorName: input.operatorName,
          assignedAt: now,
          assignedBy: input.assignedBy,
          assignedByName: input.assignedByName,
          createdAt: now,
          updatedAt: now,
        };
        await setDoc(ref, stripUndefinedDeep(payload));
        created += 1;
      }
    }

    if (created + updated === 0) {
      return {
        success: false,
        error: 'No hay referencias asignables (remanente ≤ 0 o ya enviadas/validadas).',
      };
    }

    await refreshCompareWorkflowStatus(input.compareId);
    return { success: true, created, updated };
  } catch (e: any) {
    console.error('assignDistributionRemainders:', e);
    return { success: false, error: e?.message || 'No se pudo asignar.' };
  }
}

export async function submitRemainderReturn(input: {
  taskId: string;
  returnedQty: number;
  operatorId: string;
  operatorName?: string;
  notes?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const qty = Number(input.returnedQty);
    if (!input.taskId || !input.operatorId) {
      return { success: false, error: 'Faltan datos de devolución.' };
    }
    if (!Number.isFinite(qty) || qty < 0) {
      return { success: false, error: 'Indique una cantidad válida (≥ 0).' };
    }

    const taskRef = doc(firestore, TASKS_COL, input.taskId);
    const snap = await getDoc(taskRef);
    if (!snap.exists()) return { success: false, error: 'Tarea no encontrada.' };
    const task = snap.data() as DistributionRemainderTask;

    if (task.assignedOperatorId !== input.operatorId) {
      return { success: false, error: 'Esta tarea no está asignada a usted.' };
    }
    if (task.status !== 'assigned' && task.status !== 'rejected') {
      return { success: false, error: 'La tarea ya fue enviada o validada.' };
    }

    const now = new Date().toISOString();
    await updateDoc(taskRef, {
      returnedQty: qty,
      status: 'submitted',
      submittedAt: now,
      submittedBy: input.operatorId,
      submittedByName: input.operatorName || null,
      notes: input.notes || null,
      rejectionReason: null,
      updatedAt: now,
    });
    await refreshCompareWorkflowStatus(task.compareId);
    return { success: true };
  } catch (e: any) {
    console.error('submitRemainderReturn:', e);
    return { success: false, error: e?.message || 'No se pudo registrar la devolución.' };
  }
}

export async function validateRemainderTask(input: {
  taskId: string;
  validatorId: string;
  validatorName?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    if (!input.taskId || !input.validatorId) {
      return { success: false, error: 'Faltan datos de validación.' };
    }
    const taskRef = doc(firestore, TASKS_COL, input.taskId);
    const snap = await getDoc(taskRef);
    if (!snap.exists()) return { success: false, error: 'Tarea no encontrada.' };
    const task = snap.data() as DistributionRemainderTask;
    if (task.status !== 'submitted') {
      return { success: false, error: 'Solo se validan devoluciones enviadas.' };
    }

    const now = new Date().toISOString();
    await updateDoc(taskRef, {
      status: 'validated',
      validatedAt: now,
      validatedBy: input.validatorId,
      validatedByName: input.validatorName || null,
      rejectionReason: null,
      updatedAt: now,
    });
    await refreshCompareWorkflowStatus(task.compareId);
    return { success: true };
  } catch (e: any) {
    console.error('validateRemainderTask:', e);
    return { success: false, error: e?.message || 'No se pudo validar.' };
  }
}

export async function rejectRemainderTask(input: {
  taskId: string;
  validatorId: string;
  validatorName?: string;
  reason: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    if (!input.taskId || !input.validatorId) {
      return { success: false, error: 'Faltan datos.' };
    }
    if (!String(input.reason || '').trim()) {
      return { success: false, error: 'Indique el motivo del rechazo.' };
    }
    const taskRef = doc(firestore, TASKS_COL, input.taskId);
    const snap = await getDoc(taskRef);
    if (!snap.exists()) return { success: false, error: 'Tarea no encontrada.' };
    const task = snap.data() as DistributionRemainderTask;
    if (task.status !== 'submitted') {
      return { success: false, error: 'Solo se rechazan devoluciones enviadas.' };
    }

    const now = new Date().toISOString();
    await updateDoc(taskRef, {
      status: 'assigned',
      rejectionReason: String(input.reason).trim(),
      validatedAt: now,
      validatedBy: input.validatorId,
      validatedByName: input.validatorName || null,
      updatedAt: now,
    });
    await refreshCompareWorkflowStatus(task.compareId);
    return { success: true };
  } catch (e: any) {
    console.error('rejectRemainderTask:', e);
    return { success: false, error: e?.message || 'No se pudo rechazar.' };
  }
}

/**
 * Validación directa del supervisor/admin sobre remanentes,
 * sin necesidad de asignar a un operario ni esperar envío.
 */
export async function supervisorConfirmRemaindersDirect(input: {
  compareId: string;
  items: Array<{ reference: string; confirmedQty: number }>;
  validatorId: string;
  validatorName?: string;
  notes?: string;
}): Promise<{ success: boolean; confirmed?: number; error?: string }> {
  try {
    if (!input.compareId || !input.validatorId) {
      return { success: false, error: 'Faltan datos de validación.' };
    }
    if (!input.items?.length) {
      return { success: false, error: 'Seleccione al menos una referencia a confirmar.' };
    }

    const compareSnap = await getDoc(doc(firestore, COL, input.compareId));
    if (!compareSnap.exists()) return { success: false, error: 'Comparación no encontrada.' };
    const compare = { id: compareSnap.id, ...compareSnap.data() } as DistributionCompareOperation;
    if (compare.status === 'archived') {
      return { success: false, error: 'La comparación está archivada.' };
    }

    const lineByRef = new Map((compare.lines || []).map((l) => [l.reference, l]));
    const existingSnap = await getDocs(
      query(collection(firestore, TASKS_COL), where('compareId', '==', input.compareId), limit(500))
    );
    const existingByRef = new Map<string, { id: string; data: DistributionRemainderTask }>();
    existingSnap.forEach((d) => {
      const data = d.data() as DistributionRemainderTask;
      existingByRef.set(data.reference, { id: d.id, data });
    });

    const now = new Date().toISOString();
    let confirmed = 0;

    for (const item of input.items) {
      const line = lineByRef.get(item.reference);
      if (!line || !(line.remainderQty > 0)) continue;
      const qty = Number(item.confirmedQty);
      if (!Number.isFinite(qty) || qty < 0) continue;

      const prev = existingByRef.get(item.reference);
      if (prev?.data.status === 'validated') continue;

      const baseNotes = [
        input.notes,
        'Validación directa supervisor (sin asignación a operario).',
      ]
        .filter(Boolean)
        .join(' ');

      if (prev) {
        await updateDoc(doc(firestore, TASKS_COL, prev.id), {
          expectedRemainderQty: line.remainderQty,
          returnedQty: qty,
          status: 'validated',
          assignedOperatorId: input.validatorId,
          assignedOperatorName: input.validatorName || null,
          assignedAt: now,
          assignedBy: input.validatorId,
          assignedByName: input.validatorName || null,
          submittedAt: now,
          submittedBy: input.validatorId,
          submittedByName: input.validatorName || null,
          validatedAt: now,
          validatedBy: input.validatorId,
          validatedByName: input.validatorName || null,
          rejectionReason: null,
          notes: baseNotes,
          updatedAt: now,
        });
      } else {
        const ref = doc(collection(firestore, TASKS_COL));
        const payload: DistributionRemainderTask = {
          id: ref.id,
          compareId: input.compareId,
          rkIdentifier: compare.rkIdentifier,
          reference: item.reference,
          expectedRemainderQty: line.remainderQty,
          returnedQty: qty,
          status: 'validated',
          assignedOperatorId: input.validatorId,
          assignedOperatorName: input.validatorName,
          assignedAt: now,
          assignedBy: input.validatorId,
          assignedByName: input.validatorName,
          submittedAt: now,
          submittedBy: input.validatorId,
          submittedByName: input.validatorName,
          validatedAt: now,
          validatedBy: input.validatorId,
          validatedByName: input.validatorName,
          notes: baseNotes,
          createdAt: now,
          updatedAt: now,
        };
        await setDoc(ref, stripUndefinedDeep(payload));
      }
      confirmed += 1;
    }

    if (confirmed === 0) {
      return {
        success: false,
        error: 'No se confirmó ninguna referencia (sin remanente o ya validadas).',
      };
    }

    await refreshCompareWorkflowStatus(input.compareId);
    return { success: true, confirmed };
  } catch (e: any) {
    console.error('supervisorConfirmRemaindersDirect:', e);
    return { success: false, error: e?.message || 'No se pudo confirmar.' };
  }
}

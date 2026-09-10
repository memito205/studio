'use server';

import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { firestore } from '@/services/firebase';
import { normalizeReceptionReference } from '@/lib/receptionReference';
import type {
  AppUser,
  DistributionCompareLine,
  DistributionCompareOperation,
  DistributionComparePhysicalSource,
  DistributionCompareTotals,
  DistributionRemainderTask,
  DistributionRemainderTaskStatus,
  ReceptionOperation,
} from '@/types';

const COL = 'distributionCompares';
/** Espejo liviano para listados (nunca incluye `lines`). */
const SUMMARY_COL = 'distributionCompareSummaries';
const TASKS_COL = 'distributionRemainderTasks';
const RECEPTION_COL = 'receptionOperations';
const USERS_COL = 'users';

async function upsertCompareSummary(data: DistributionCompareOperation): Promise<void> {
  const payload = stripUndefinedDeep({
    id: data.id,
    receptionOperationId: data.receptionOperationId,
    rkIdentifier: data.rkIdentifier,
    receptionSupplier: data.receptionSupplier,
    physicalSource: data.physicalSource,
    planFileName: data.planFileName,
    stockFileName: data.stockFileName,
    notes: data.notes,
    lineCount: data.lineCount ?? 0,
    linesInSubcollection: data.linesInSubcollection ?? true,
    totals: data.totals,
    status: data.status,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    createdBy: data.createdBy,
    createdByName: data.createdByName,
  }) as Record<string, unknown>;
  await setDoc(doc(firestore, SUMMARY_COL, data.id), payload, { merge: true });
}

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
  // Misma normalización que recepción (referenceStats), para que el cruce cuadre.
  return normalizeReceptionReference(String(value ?? ''));
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
  REFERENCIA?: string;
  Referencia?: string;
  referencia?: string;
  TALLA?: string;
  Talla?: string;
  'CANTD LEIDA'?: number | string;
  CANTD_LEIDA?: number | string;
  CANT?: number | string;
  CANTIDAD?: number | string;
  'Cant. Leída'?: number | string;
  'Cantidad Leída'?: number | string;
  'Total Leído'?: number | string;
  [key: string]: unknown;
};

function buildTotals(lines: DistributionCompareLine[]): DistributionCompareTotals {
  return {
    physicalQty: lines.reduce((s, l) => s + l.physicalQty, 0),
    distributedQty: lines.reduce((s, l) => s + l.distributedQty, 0),
    remainderQty: lines.reduce((s, l) => s + l.remainderQty, 0),
    referencesWithRemainder: lines.filter((l) => l.remainderQty > 0).length,
  };
}

function lineDocId(reference: string): string {
  // IDs seguros para Firestore (alineado a normalizeReceptionReference).
  return normalizeReceptionReference(reference).replace(/[/#[\]]/g, '_').slice(0, 700) || 'UNKNOWN';
}

function slimLineForStorage(line: DistributionCompareLine): DistributionCompareLine {
  const byBodega = (line.byBodega || []).filter(
    (b) => b.bodega && b.bodega !== 'TOTAL' && b.qty !== 0
  );
  return {
    reference: line.reference,
    physicalQty: line.physicalQty,
    distributedQty: line.distributedQty,
    remainderQty: line.remainderQty,
    byBodega,
  };
}

async function writeCompareLinesSubcollection(
  compareId: string,
  lines: DistributionCompareLine[]
): Promise<void> {
  let batch = writeBatch(firestore);
  let ops = 0;
  for (const line of lines) {
    const slim = slimLineForStorage(line);
    const lineRef = doc(firestore, COL, compareId, 'lines', lineDocId(slim.reference));
    batch.set(lineRef, stripUndefinedDeep(slim));
    ops += 1;
    if (ops >= 400) {
      await batch.commit();
      batch = writeBatch(firestore);
      ops = 0;
    }
  }
  if (ops > 0) await batch.commit();
}

async function loadCompareLines(compareId: string): Promise<DistributionCompareLine[]> {
  const sub = await getDocs(collection(firestore, COL, compareId, 'lines'));
  if (!sub.empty) {
    return sub.docs
      .map((d) => d.data() as DistributionCompareLine)
      .sort((a, b) => a.reference.localeCompare(b.reference, 'es'));
  }
  // Legacy: líneas embebidas en el documento padre (docs antiguos pesados).
  const parent = await getDoc(doc(firestore, COL, compareId));
  if (!parent.exists()) return [];
  const embedded = (parent.data() as DistributionCompareOperation).lines;
  return Array.isArray(embedded) ? embedded : [];
}

async function deleteCompareLinesSubcollection(compareId: string): Promise<number> {
  const sub = await getDocs(collection(firestore, COL, compareId, 'lines'));
  if (sub.empty) return 0;
  let batch = writeBatch(firestore);
  let ops = 0;
  let deleted = 0;
  for (const d of sub.docs) {
    batch.delete(d.ref);
    ops += 1;
    deleted += 1;
    if (ops >= 400) {
      await batch.commit();
      batch = writeBatch(firestore);
      ops = 0;
    }
  }
  if (ops > 0) await batch.commit();
  return deleted;
}

/** Migra líneas embebidas a subcolección para que el listado deje de bajar docs gigantes. */
async function migrateEmbeddedLinesIfNeeded(
  compareId: string,
  data: DistributionCompareOperation
): Promise<DistributionCompareOperation> {
  const embedded = data.lines;
  if (!Array.isArray(embedded) || embedded.length === 0) return data;
  if (data.linesInSubcollection) {
    return { ...data, lines: [] };
  }
  try {
    await writeCompareLinesSubcollection(compareId, embedded);
    const updatedAt = new Date().toISOString();
    await updateDoc(doc(firestore, COL, compareId), {
      lines: deleteField(),
      lineCount: embedded.length,
      linesInSubcollection: true,
      updatedAt,
    });
    const slimmed: DistributionCompareOperation = {
      ...data,
      lines: [],
      lineCount: embedded.length,
      linesInSubcollection: true,
      updatedAt,
    };
    await upsertCompareSummary(slimmed);
    return slimmed;
  } catch (e) {
    console.error('migrateEmbeddedLinesIfNeeded:', e);
    return data;
  }
}

/** Agrega físico por referencia desde Excel de recepción / existencias. */
function aggregatePhysicalFromStockRows(
  rows: DistributionStockRowInput[]
): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows || []) {
    const anyRow = row as Record<string, unknown>;
    const ref = normRef(
      anyRow.REFERENCIA ?? anyRow.Referencia ?? anyRow.referencia ?? anyRow.Reference
    );
    if (!ref) continue;
    const qty =
      toNumber(anyRow['CANTD LEIDA']) ||
      toNumber(anyRow.CANTD_LEIDA) ||
      toNumber(anyRow['Cant. Leída']) ||
      toNumber(anyRow['Cantidad Leída']) ||
      toNumber(anyRow['Total Leído']) ||
      toNumber(anyRow.CANT) ||
      toNumber(anyRow.CANTIDAD);
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

/** Solo metadatos de la operación (nombre RK / proveedor). No lee escaneos. */
async function getReceptionMetaForCompare(receptionOperationId: string): Promise<{
  success: boolean;
  rkIdentifier?: string;
  receptionSupplier?: string;
  error?: string;
}> {
  try {
    const opSnap = await getDoc(doc(firestore, RECEPTION_COL, receptionOperationId));
    if (!opSnap.exists()) {
      return { success: false, error: 'No se encontró la operación de recepción.' };
    }
    const operation = opSnap.data() as ReceptionOperation;
    return {
      success: true,
      rkIdentifier: operation.rk_identifier || receptionOperationId,
      receptionSupplier: operation.supplier || '',
    };
  } catch (e: any) {
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

    // Físico SOLO desde Excel (reporte de recepción / existencias).
    // No leemos scannedItems ni referenceStats: evita lecturas masivas en Firebase.
    if (!input.stockRows?.length) {
      return {
        success: false,
        error:
          'Suba el Excel de recepción (Referencia + Cant. Leída / Total Leído) o el de existencias. Ya no se cargan escaneos desde Firebase.',
      };
    }
    physicalByRef = aggregatePhysicalFromStockRows(input.stockRows);
    if (physicalByRef.size === 0) {
      return {
        success: false,
        error:
          'El Excel de físico no tiene cantidades válidas (use columnas Referencia y Cant. Leída / Total Leído / CANTD LEIDA).',
      };
    }

    if (input.receptionOperationId) {
      receptionOperationId = input.receptionOperationId;
      const meta = await getReceptionMetaForCompare(input.receptionOperationId);
      if (!meta.success) {
        return { success: false, error: meta.error || 'No se pudo leer el nombre de la recepción.' };
      }
      rkIdentifier = meta.rkIdentifier;
      receptionSupplier = meta.receptionSupplier;
    }

    const physicalSource: DistributionComparePhysicalSource = 'excel_stock';
    notes = [notes, `Físico desde Excel (${physicalByRef.size} refs).`]
      .filter(Boolean)
      .join(' ');

    const lines = buildCompareLines({ physicalByRef, distributedByRef, byRefBodega });
    const totals = buildTotals(lines);
    const now = new Date().toISOString();
    const ref = doc(collection(firestore, COL));
    // Documento padre liviano: el detalle va a subcolección `lines` (evita lecturas enormes al listar).
    const payload: DistributionCompareOperation = {
      id: ref.id,
      receptionOperationId,
      rkIdentifier,
      receptionSupplier,
      physicalSource,
      planFileName: input.planFileName,
      stockFileName: input.stockFileName,
      notes: notes || undefined,
      lines: [],
      lineCount: lines.length,
      linesInSubcollection: true,
      totals,
      status: 'open',
      createdAt: now,
      updatedAt: now,
      createdBy: input.createdBy,
      createdByName: input.createdByName,
    };

    await setDoc(ref, stripUndefinedDeep({ ...payload, lines: undefined }));
    await writeCompareLinesSubcollection(ref.id, lines);
    await upsertCompareSummary(payload);
    return { success: true, id: ref.id, data: { ...payload, lines } };
  } catch (e: any) {
    console.error('createDistributionCompare:', e);
    return { success: false, error: e?.message || 'No se pudo guardar la comparación.' };
  }
}

export async function listDistributionCompares(limitN = 40): Promise<{
  success: boolean;
  data?: DistributionCompareOperation[];
  error?: string;
}> {
  try {
    let snap;
    try {
      snap = await getDocs(
        query(collection(firestore, COL), orderBy('createdAt', 'desc'), limit(limitN))
      );
    } catch (orderErr) {
      // Fallback si falta índice / createdAt: listado simple sin orden.
      console.warn('listDistributionCompares orderBy fallback:', orderErr);
      snap = await getDocs(query(collection(firestore, COL), limit(limitN)));
    }
    const data = snap.docs.map((d) => {
      const raw = d.data() as DistributionCompareOperation;
      // No materializar lines en memoria del listado (docs legacy pesados).
      const lineCount = raw.lineCount ?? (Array.isArray(raw.lines) ? raw.lines.length : 0);
      return {
        id: d.id,
        receptionOperationId: raw.receptionOperationId,
        rkIdentifier: raw.rkIdentifier,
        receptionSupplier: raw.receptionSupplier,
        physicalSource: raw.physicalSource,
        planFileName: raw.planFileName,
        stockFileName: raw.stockFileName,
        notes: raw.notes,
        lines: [],
        lineCount,
        linesInSubcollection: raw.linesInSubcollection,
        totals: raw.totals || {
          physicalQty: 0,
          distributedQty: 0,
          remainderQty: 0,
          referencesWithRemainder: 0,
        },
        status: raw.status || 'open',
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
        createdBy: raw.createdBy,
        createdByName: raw.createdByName,
      } as DistributionCompareOperation;
    });
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
    let data = { id: snap.id, ...snap.data() } as DistributionCompareOperation;

    // Si el doc legacy trae lines embebidas, migrar a subcolección (una vez).
    if (Array.isArray(data.lines) && data.lines.length > 0 && !data.linesInSubcollection) {
      data = await migrateEmbeddedLinesIfNeeded(id, data);
    }

    const lines = await loadCompareLines(id);
    return {
      success: true,
      data: {
        ...data,
        lines,
        lineCount: lines.length,
        linesInSubcollection: true,
      },
    };
  } catch (e: any) {
    return { success: false, error: e?.message || 'Error al cargar comparación.' };
  }
}

export async function archiveDistributionCompare(
  id: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const updatedAt = new Date().toISOString();
    await updateDoc(doc(firestore, COL, id), {
      status: 'archived',
      updatedAt,
    });
    await setDoc(doc(firestore, SUMMARY_COL, id), { status: 'archived', updatedAt }, { merge: true });
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e?.message || 'No se pudo archivar.' };
  }
}

/** Elimina comparación, líneas y tareas. No toca recepción. */
export async function deleteDistributionCompare(
  id: string
): Promise<{ success: boolean; deletedTasks?: number; deletedLines?: number; error?: string }> {
  try {
    if (!id) return { success: false, error: 'ID requerido.' };

    // Borrar subtareas y líneas en paralelo (docs livianos).
    const [tasksSnap, deletedLines] = await Promise.all([
      getDocs(query(collection(firestore, TASKS_COL), where('compareId', '==', id), limit(500))),
      deleteCompareLinesSubcollection(id),
    ]);

    let deletedTasks = 0;
    let batch = writeBatch(firestore);
    let ops = 0;
    for (const d of tasksSnap.docs) {
      batch.delete(d.ref);
      deletedTasks += 1;
      ops += 1;
      if (ops >= 400) {
        await batch.commit();
        batch = writeBatch(firestore);
        ops = 0;
      }
    }
    batch.delete(doc(firestore, COL, id));
    batch.delete(doc(firestore, SUMMARY_COL, id));
    await batch.commit();
    return { success: true, deletedTasks, deletedLines };
  } catch (e: any) {
    console.error('deleteDistributionCompare:', e);
    return { success: false, error: e?.message || 'No se pudo eliminar.' };
  }
}

async function refreshCompareWorkflowStatus(compareId: string): Promise<void> {
  const compareSnap = await getDoc(doc(firestore, COL, compareId));
  if (!compareSnap.exists()) return;
  const compare = compareSnap.data() as DistributionCompareOperation;
  if (compare.status === 'archived') return;

  const tasksSnap = await getDocs(
    query(collection(firestore, TASKS_COL), where('compareId', '==', compareId), limit(500))
  );
  const tasks = tasksSnap.docs.map((d) => d.data() as DistributionRemainderTask);
  const active = tasks.filter((t) => t.status !== 'rejected');

  const remainderCount = Number(compare.totals?.referencesWithRemainder) || 0;

  let status: DistributionCompareOperation['status'] = 'open';
  if (active.some((t) => t.status === 'submitted')) status = 'pending_validation';
  else if (active.length > 0 && active.every((t) => t.status === 'validated')) status = 'completed';
  else if (active.length > 0) status = 'in_progress';
  else if (remainderCount <= 0) status = 'completed';
  else status = 'open';

  const updatedAt = new Date().toISOString();
  await updateDoc(doc(firestore, COL, compareId), {
    status,
    updatedAt,
  });
  await setDoc(doc(firestore, SUMMARY_COL, compareId), { status, updatedAt }, { merge: true });
}

/** Remanente asignable: sobrante (>0) o confirmación en cero (===0). No negativos. */
function isAssignableRemainderQty(qty: number): boolean {
  return Number.isFinite(qty) && qty >= 0;
}

/**
 * Ubicación predominante de la ref en reception referenceStats.packUnitsById.
 * Fallback: escaneos de la recepción (location_id) para esa referencia.
 */
export async function resolveReceptionLocationForReference(
  receptionOperationId: string | undefined,
  reference: string
): Promise<{ locationId?: string; locationName?: string }> {
  if (!receptionOperationId || !reference) return {};
  try {
    const safeRef = normalizeReceptionReference(reference);
    const statsSnap = await getDoc(
      doc(firestore, RECEPTION_COL, receptionOperationId, 'referenceStats', safeRef)
    );
    if (statsSnap.exists()) {
      const packUnitsById = (statsSnap.data() as {
        packUnitsById?: Record<string, { locationId?: string; locationName?: string }>;
      }).packUnitsById;
      if (packUnitsById && typeof packUnitsById === 'object') {
        const counts = new Map<string, { n: number; locationId?: string; locationName?: string }>();
        for (const u of Object.values(packUnitsById)) {
          const label = String(u.locationName || u.locationId || '').trim();
          if (!label) continue;
          const prev = counts.get(label) || {
            n: 0,
            locationId: u.locationId,
            locationName: u.locationName || u.locationId,
          };
          prev.n += 1;
          counts.set(label, prev);
        }
        const best = [...counts.values()].sort((a, b) => b.n - a.n)[0];
        if (best?.locationName || best?.locationId) {
          return {
            locationId: best.locationId,
            locationName: best.locationName,
          };
        }
      }
    }

    // Fallback: ubicación desde escaneos de mercancía de esa recepción + ref.
    const itemsSnap = await getDocs(
      query(
        collection(firestore, 'scannedItems'),
        where('reception_id', '==', receptionOperationId),
        limit(400)
      )
    );
    if (itemsSnap.empty) return {};

    const locCounts = new Map<string, number>();
    for (const d of itemsSnap.docs) {
      const item = d.data() as { reference?: string; location_id?: string };
      if (normalizeReceptionReference(String(item.reference || '')) !== safeRef) continue;
      const locId = String(item.location_id || '').trim();
      if (!locId) continue;
      locCounts.set(locId, (locCounts.get(locId) || 0) + 1);
    }
    const topLoc = [...locCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!topLoc) return {};

    const locSnap = await getDoc(doc(firestore, 'locations', topLoc));
    const locationName = locSnap.exists()
      ? String((locSnap.data() as { name?: string }).name || topLoc)
      : topLoc;
    return { locationId: topLoc, locationName };
  } catch {
    return {};
  }
}

/**
 * Resuelve ubicaciones de varias refs de una misma recepción (1 pasada de escaneos si hace falta).
 */
export async function resolveReceptionLocationsForReferences(
  receptionOperationId: string | undefined,
  references: string[]
): Promise<Map<string, { locationId?: string; locationName?: string }>> {
  const out = new Map<string, { locationId?: string; locationName?: string }>();
  if (!receptionOperationId || !references.length) return out;

  const uniqueRefs = [...new Set(references.map((r) => String(r || '').trim()).filter(Boolean))];
  const pending: string[] = [];

  await Promise.all(
    uniqueRefs.map(async (reference) => {
      const safeRef = normalizeReceptionReference(reference);
      try {
        const statsSnap = await getDoc(
          doc(firestore, RECEPTION_COL, receptionOperationId, 'referenceStats', safeRef)
        );
        if (!statsSnap.exists()) {
          pending.push(reference);
          return;
        }
        const packUnitsById = (statsSnap.data() as {
          packUnitsById?: Record<string, { locationId?: string; locationName?: string }>;
        }).packUnitsById;
        if (!packUnitsById || typeof packUnitsById !== 'object') {
          pending.push(reference);
          return;
        }
        const counts = new Map<string, { n: number; locationId?: string; locationName?: string }>();
        for (const u of Object.values(packUnitsById)) {
          const label = String(u.locationName || u.locationId || '').trim();
          if (!label) continue;
          const prev = counts.get(label) || {
            n: 0,
            locationId: u.locationId,
            locationName: u.locationName || u.locationId,
          };
          prev.n += 1;
          counts.set(label, prev);
        }
        const best = [...counts.values()].sort((a, b) => b.n - a.n)[0];
        if (best?.locationName || best?.locationId) {
          out.set(reference, {
            locationId: best.locationId,
            locationName: best.locationName,
          });
        } else {
          pending.push(reference);
        }
      } catch {
        pending.push(reference);
      }
    })
  );

  if (pending.length === 0) return out;

  try {
    const itemsSnap = await getDocs(
      query(
        collection(firestore, 'scannedItems'),
        where('reception_id', '==', receptionOperationId),
        limit(800)
      )
    );
    if (itemsSnap.empty) return out;

    const pendingNorm = new Map(
      pending.map((r) => [normalizeReceptionReference(r), r] as const)
    );
    const locCountsByRef = new Map<string, Map<string, number>>();

    for (const d of itemsSnap.docs) {
      const item = d.data() as { reference?: string; location_id?: string };
      const norm = normalizeReceptionReference(String(item.reference || ''));
      const originalRef = pendingNorm.get(norm);
      if (!originalRef) continue;
      const locId = String(item.location_id || '').trim();
      if (!locId) continue;
      if (!locCountsByRef.has(originalRef)) locCountsByRef.set(originalRef, new Map());
      const m = locCountsByRef.get(originalRef)!;
      m.set(locId, (m.get(locId) || 0) + 1);
    }

    const allLocIds = [
      ...new Set(
        [...locCountsByRef.values()].flatMap((m) => [...m.keys()])
      ),
    ].slice(0, 80);
    const nameById = new Map<string, string>();
    await Promise.all(
      allLocIds.map(async (id) => {
        const s = await getDoc(doc(firestore, 'locations', id));
        nameById.set(
          id,
          s.exists() ? String((s.data() as { name?: string }).name || id) : id
        );
      })
    );

    for (const [reference, counts] of locCountsByRef) {
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (!top) continue;
      out.set(reference, {
        locationId: top,
        locationName: nameById.get(top) || top,
      });
    }
  } catch {
    /* ignore fallback errors */
  }

  return out;
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

/**
 * Remanentes ≥0 sin tarea activa (para que el operario tome la referencia).
 * Incluye ubicación de recepción para no buscar a ciegas.
 */
export async function listAvailableRemainderClaims(limitCompares = 25): Promise<{
  success: boolean;
  data?: import('@/types').DistributionRemainderAvailableClaim[];
  error?: string;
}> {
  try {
    const listRes = await listDistributionCompares(Math.min(Math.max(limitCompares, 5), 40));
    if (!listRes.success || !listRes.data) {
      return { success: false, error: listRes.error || 'No se pudieron cargar comparaciones.' };
    }
    const compares = listRes.data.filter((c) => c.status !== 'archived');
    const out: import('@/types').DistributionRemainderAvailableClaim[] = [];

    await Promise.all(
      compares.map(async (c) => {
        const [lines, tasksSnap] = await Promise.all([
          loadCompareLines(c.id),
          getDocs(
            query(collection(firestore, TASKS_COL), where('compareId', '==', c.id), limit(500))
          ),
        ]);
        const taken = new Set<string>();
        tasksSnap.forEach((d) => {
          const t = d.data() as DistributionRemainderTask;
          if (t.reference) taken.add(t.reference);
        });

        const availableLines = lines.filter(
          (line) => isAssignableRemainderQty(line.remainderQty) && !taken.has(line.reference)
        );
        if (availableLines.length === 0) return;

        const locByRef = await resolveReceptionLocationsForReferences(
          c.receptionOperationId,
          availableLines.map((l) => l.reference)
        );

        for (const line of availableLines) {
          const loc = locByRef.get(line.reference);
          out.push({
            compareId: c.id,
            rkIdentifier: c.rkIdentifier,
            reference: line.reference,
            remainderQty: line.remainderQty,
            compareStatus: c.status,
            updatedAt: c.updatedAt,
            locationId: loc?.locationId,
            locationName: loc?.locationName,
          });
        }
      })
    );

    out.sort((a, b) => {
      const loc = String(a.locationName || 'ZZZ').localeCompare(String(b.locationName || 'ZZZ'), 'es');
      if (loc !== 0) return loc;
      const rk = String(a.rkIdentifier || '').localeCompare(String(b.rkIdentifier || ''), 'es');
      if (rk !== 0) return rk;
      return a.reference.localeCompare(b.reference, 'es');
    });
    return { success: true, data: out };
  } catch (e: any) {
    console.error('listAvailableRemainderClaims:', e);
    return { success: false, error: e?.message || 'No se pudieron cargar disponibles.' };
  }
}

/**
 * Tablero supervisor/admin: quién tiene cada referencia y si ya validó el remanente.
 */
export async function listRemainderAssignmentBoard(limitN = 300): Promise<{
  success: boolean;
  data?: DistributionRemainderTask[];
  error?: string;
}> {
  try {
    const snap = await getDocs(
      query(
        collection(firestore, TASKS_COL),
        orderBy('updatedAt', 'desc'),
        limit(Math.min(limitN, 500))
      )
    );
    const data = snap.docs.map((d) => ({ id: d.id, ...d.data() } as DistributionRemainderTask));
    return { success: true, data };
  } catch (e: any) {
    // Fallback sin índice compuesto / orderBy si falla.
    try {
      const snap = await getDocs(query(collection(firestore, TASKS_COL), limit(Math.min(limitN, 500))));
      const data = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as DistributionRemainderTask))
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
      return { success: true, data };
    } catch (e2: any) {
      return { success: false, error: e2?.message || e?.message || 'No se pudo cargar el tablero.' };
    }
  }
}

/**
 * Operario toma una referencia sin asignar (self-claim).
 * No roba tareas ya asignadas a otro.
 */
export async function claimDistributionRemainder(input: {
  compareId: string;
  reference: string;
  operatorId: string;
  operatorName?: string;
}): Promise<{ success: boolean; taskId?: string; error?: string }> {
  try {
    if (!input.compareId || !input.reference || !input.operatorId) {
      return { success: false, error: 'Faltan datos para tomar la referencia.' };
    }

    const compareSnap = await getDoc(doc(firestore, COL, input.compareId));
    if (!compareSnap.exists()) return { success: false, error: 'Comparación no encontrada.' };
    const compare = { id: compareSnap.id, ...compareSnap.data() } as DistributionCompareOperation;
    if (compare.status === 'archived') {
      return { success: false, error: 'La comparación está archivada.' };
    }

    const lines = await loadCompareLines(input.compareId);
    const line = lines.find((l) => l.reference === input.reference);
    if (!line || !isAssignableRemainderQty(line.remainderQty)) {
      return {
        success: false,
        error: 'Esa referencia no es asignable (solo remanente ≥ 0; no sobredistribución).',
      };
    }

    const existingSnap = await getDocs(
      query(
        collection(firestore, TASKS_COL),
        where('compareId', '==', input.compareId),
        where('reference', '==', input.reference),
        limit(5)
      )
    );
    if (!existingSnap.empty) {
      const existing = existingSnap.docs[0].data() as DistributionRemainderTask;
      if (existing.assignedOperatorId === input.operatorId) {
        return { success: true, taskId: existingSnap.docs[0].id };
      }
      return {
        success: false,
        error: `Ya está asignada a ${existing.assignedOperatorName || 'otro operario'}.`,
      };
    }

    const loc = await resolveReceptionLocationForReference(
      compare.receptionOperationId,
      input.reference
    );
    const now = new Date().toISOString();
    const ref = doc(collection(firestore, TASKS_COL));
    const payload: DistributionRemainderTask = stripUndefinedDeep({
      id: ref.id,
      compareId: input.compareId,
      rkIdentifier: compare.rkIdentifier,
      reference: input.reference,
      expectedRemainderQty: line.remainderQty,
      status: 'assigned',
      assignedOperatorId: input.operatorId,
      assignedOperatorName: input.operatorName || input.operatorId,
      assignedAt: now,
      assignedBy: input.operatorId,
      assignedByName: input.operatorName || input.operatorId,
      claimedBySelf: true,
      receptionOperationId: compare.receptionOperationId,
      locationId: loc.locationId,
      locationName: loc.locationName,
      createdAt: now,
      updatedAt: now,
    });
    await setDoc(ref, payload);
    await refreshCompareWorkflowStatus(input.compareId);
    return { success: true, taskId: ref.id };
  } catch (e: any) {
    console.error('claimDistributionRemainder:', e);
    return { success: false, error: e?.message || 'No se pudo tomar la referencia.' };
  }
}

/**
 * Asigna remanentes. Cada referencia puede ir a un operario distinto.
 * Acepta `assignments: [{ reference, operatorId, operatorName }]`
 * o el modo legado references[] + un solo operatorId.
 */
export async function assignDistributionRemainders(input: {
  compareId: string;
  assignments?: Array<{ reference: string; operatorId: string; operatorName: string }>;
  /** @deprecated Preferir assignments[] por referencia. */
  references?: string[];
  operatorId?: string;
  operatorName?: string;
  assignedBy: string;
  assignedByName?: string;
}): Promise<{ success: boolean; created?: number; updated?: number; error?: string }> {
  try {
    if (!input.compareId || !input.assignedBy) {
      return { success: false, error: 'Faltan datos de asignación.' };
    }

    const assignments =
      input.assignments && input.assignments.length > 0
        ? input.assignments
        : (input.references || []).map((reference) => ({
            reference,
            operatorId: String(input.operatorId || ''),
            operatorName: String(input.operatorName || input.operatorId || ''),
          }));

    if (!assignments.length) {
      return { success: false, error: 'Indique al menos una referencia con operario.' };
    }
    if (assignments.some((a) => !a.reference || !a.operatorId)) {
      return { success: false, error: 'Cada referencia debe tener operario asignado.' };
    }

    const compareSnap = await getDoc(doc(firestore, COL, input.compareId));
    if (!compareSnap.exists()) return { success: false, error: 'Comparación no encontrada.' };
    const compare = { id: compareSnap.id, ...compareSnap.data() } as DistributionCompareOperation;
    if (compare.status === 'archived') {
      return { success: false, error: 'La comparación está archivada.' };
    }

    const lines = await loadCompareLines(input.compareId);
    const lineByRef = new Map(lines.map((l) => [l.reference, l]));
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

    for (const a of assignments) {
      const line = lineByRef.get(a.reference);
      if (!line || !isAssignableRemainderQty(line.remainderQty)) continue;

      const prev = existingByRef.get(a.reference);
      if (prev && (prev.data.status === 'submitted' || prev.data.status === 'validated')) {
        continue;
      }

      const loc = await resolveReceptionLocationForReference(
        compare.receptionOperationId,
        a.reference
      );

      if (prev) {
        await updateDoc(doc(firestore, TASKS_COL, prev.id), {
          expectedRemainderQty: line.remainderQty,
          status: 'assigned' satisfies DistributionRemainderTaskStatus,
          assignedOperatorId: a.operatorId,
          assignedOperatorName: a.operatorName,
          assignedAt: now,
          assignedBy: input.assignedBy,
          assignedByName: input.assignedByName || null,
          claimedBySelf: false,
          receptionOperationId: compare.receptionOperationId || null,
          locationId: loc.locationId || null,
          locationName: loc.locationName || null,
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
          reference: a.reference,
          expectedRemainderQty: line.remainderQty,
          status: 'assigned',
          assignedOperatorId: a.operatorId,
          assignedOperatorName: a.operatorName,
          assignedAt: now,
          assignedBy: input.assignedBy,
          assignedByName: input.assignedByName,
          claimedBySelf: false,
          receptionOperationId: compare.receptionOperationId,
          locationId: loc.locationId,
          locationName: loc.locationName,
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
        error:
          'No hay referencias asignables (remanente negativo, o ya enviadas/validadas). Remanente 0 sí se puede asignar.',
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

    const lines = await loadCompareLines(input.compareId);
    const lineByRef = new Map(lines.map((l) => [l.reference, l]));
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
      if (!line || !isAssignableRemainderQty(line.remainderQty)) continue;
      const qty = Number(item.confirmedQty);
      if (!Number.isFinite(qty) || qty < 0) continue;

      const prev = existingByRef.get(item.reference);
      if (prev?.data.status === 'validated') continue;

      const loc = await resolveReceptionLocationForReference(
        compare.receptionOperationId,
        item.reference
      );

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
          receptionOperationId: compare.receptionOperationId || null,
          locationId: loc.locationId || null,
          locationName: loc.locationName || null,
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
          receptionOperationId: compare.receptionOperationId,
          locationId: loc.locationId,
          locationName: loc.locationName,
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

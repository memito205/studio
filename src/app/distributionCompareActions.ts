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
  DistributionCompareLine,
  DistributionCompareOperation,
  DistributionComparePhysicalSource,
  DistributionCompareTotals,
  ReceptionOperation,
  ScannedItem,
} from '@/types';

const COL = 'distributionCompares';
const RECEPTION_COL = 'receptionOperations';
const SCANNED_COL = 'scannedItems';

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
  BODEGA: string;
  CANT: number | string;
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
export function aggregatePhysicalFromStockRows(
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

/** Agrega reparto por referencia y detalle por bodega. */
export function aggregateDistributedFromPlanRows(rows: DistributionPlanRowInput[]): {
  byRef: Map<string, number>;
  byRefBodega: Map<string, Map<string, number>>;
} {
  const byRef = new Map<string, number>();
  const byRefBodega = new Map<string, Map<string, number>>();
  for (const row of rows || []) {
    const ref = normRef(row.REFERENCIA);
    const bodega = String(row.BODEGA ?? '').trim() || 'SIN BODEGA';
    const qty = toNumber(row.CANT);
    if (!ref || qty === 0) continue;
    byRef.set(ref, (byRef.get(ref) || 0) + qty);
    if (!byRefBodega.has(ref)) byRefBodega.set(ref, new Map());
    const bm = byRefBodega.get(ref)!;
    bm.set(bodega, (bm.get(bodega) || 0) + qty);
  }
  return { byRef, byRefBodega };
}

export function buildCompareLines(opts: {
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
  error?: string;
}> {
  try {
    const opSnap = await getDoc(doc(firestore, RECEPTION_COL, receptionOperationId));
    if (!opSnap.exists()) {
      return { success: false, error: 'No se encontró la operación de recepción.' };
    }
    const operation = { id: opSnap.id, ...opSnap.data() } as ReceptionOperation;

    const scansSnap = await getDocs(
      query(collection(firestore, SCANNED_COL), where('reception_id', '==', receptionOperationId), limit(5000))
    );
    const physicalByRef = new Map<string, number>();
    scansSnap.forEach((d) => {
      const item = d.data() as ScannedItem;
      const ref = normRef(item.reference);
      if (!ref) return;
      const qty = toNumber(item.quantity);
      if (!qty) return;
      physicalByRef.set(ref, (physicalByRef.get(ref) || 0) + qty);
    });

    // Si no hay escaneos, usar expectedItems como respaldo informativo (sigue siendo "planificado" no físico).
    // Fase 1: preferir escaneos; si vacío, sumar totalScannedQuantity no desagrega por ref.
    // Mejor: si no hay scans, usar expectedItems como físico estimado y marcar en notes en el caller.
    if (physicalByRef.size === 0 && Array.isArray(operation.expectedItems)) {
      for (const ei of operation.expectedItems) {
        const ref = normRef((ei as any).reference);
        if (!ref) continue;
        const qty = toNumber((ei as any).expected_quantity);
        if (!qty) continue;
        physicalByRef.set(ref, (physicalByRef.get(ref) || 0) + qty);
      }
    }

    return { success: true, physicalByRef, operation };
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
      // Detectar si vinimos de expected (sin scans): heurística — si totalScanned es 0
      if ((Number(loaded.operation?.totalScannedQuantity) || 0) === 0) {
        notes = [notes, 'Físico tomado de ítems esperados (sin escaneos en recepción).']
          .filter(Boolean)
          .join(' ');
      }
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

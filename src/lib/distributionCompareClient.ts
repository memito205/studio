'use client';

/**
 * Listado liviano de comparaciones vía Firestore REST + field mask.
 * Así no se descargan docs legacy con miles de `lines` embebidas
 * (getDocs del SDK siempre trae el documento completo → UI pegada).
 */

import { auth, firebaseProjectId, firestore } from '@/services/firebase';
import type { DistributionCompareOperation, DistributionCompareTotals } from '@/types';
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
  writeBatch,
} from 'firebase/firestore';

const COL = 'distributionCompares';
const SUMMARY_COL = 'distributionCompareSummaries';
const LINES_SUB = 'lines';

const SUMMARY_FIELDS = [
  'receptionOperationId',
  'rkIdentifier',
  'receptionSupplier',
  'physicalSource',
  'planFileName',
  'stockFileName',
  'notes',
  'lineCount',
  'linesInSubcollection',
  'totals',
  'status',
  'createdAt',
  'updatedAt',
  'createdBy',
  'createdByName',
] as const;

function emptyTotals(): DistributionCompareTotals {
  return {
    physicalQty: 0,
    distributedQty: 0,
    remainderQty: 0,
    referencesWithRemainder: 0,
  };
}

function mapSummary(
  id: string,
  raw: Partial<DistributionCompareOperation>
): DistributionCompareOperation {
  const lineCount = raw.lineCount ?? (Array.isArray(raw.lines) ? raw.lines.length : 0);
  return {
    id,
    receptionOperationId: raw.receptionOperationId,
    rkIdentifier: raw.rkIdentifier,
    receptionSupplier: raw.receptionSupplier,
    physicalSource: raw.physicalSource || 'excel_stock',
    planFileName: raw.planFileName,
    stockFileName: raw.stockFileName,
    notes: raw.notes,
    lines: [],
    lineCount,
    linesInSubcollection: raw.linesInSubcollection,
    totals: raw.totals || emptyTotals(),
    status: raw.status || 'open',
    createdAt: raw.createdAt || '',
    updatedAt: raw.updatedAt || '',
    createdBy: raw.createdBy || '',
    createdByName: raw.createdByName,
  };
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`Tiempo agotado (${label}, ${ms / 1000}s)`)),
      ms
    );
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

function readRestValue(node: any): unknown {
  if (node == null || typeof node !== 'object') return undefined;
  if ('nullValue' in node) return null;
  if ('stringValue' in node) return node.stringValue;
  if ('booleanValue' in node) return node.booleanValue;
  if ('integerValue' in node) return Number(node.integerValue);
  if ('doubleValue' in node) return Number(node.doubleValue);
  if ('timestampValue' in node) return node.timestampValue;
  if ('arrayValue' in node) {
    const values = node.arrayValue?.values || [];
    return values.map(readRestValue);
  }
  if ('mapValue' in node) {
    const fields = node.mapValue?.fields || {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) out[k] = readRestValue(v);
    return out;
  }
  return undefined;
}

function restDocToSummary(docBody: any): DistributionCompareOperation | null {
  const name = String(docBody?.name || '');
  const id = name.split('/').pop();
  if (!id) return null;
  const fields = docBody?.fields || {};
  const raw: Record<string, unknown> = {};
  for (const key of SUMMARY_FIELDS) {
    if (fields[key] != null) raw[key] = readRestValue(fields[key]);
  }
  return mapSummary(id, raw as Partial<DistributionCompareOperation>);
}

async function waitForIdToken(timeoutMs = 8000): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const user = auth?.currentUser;
    if (user) return user.getIdToken();
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Sesión no lista para leer Firestore.');
}

/** Listado con proyección (sin campo `lines`) vía runQuery REST. */
async function fetchSummariesViaRest(limitN: number): Promise<DistributionCompareOperation[]> {
  const token = await waitForIdToken();
  const url = `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/(default)/documents:runQuery`;
  const structuredQuery = {
    from: [{ collectionId: COL }],
    orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
    limit: limitN,
    select: {
      fields: SUMMARY_FIELDS.map((fieldPath) => ({ fieldPath })),
    },
  };

  let res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ structuredQuery }),
  });

  // Sin índice / sin createdAt: reintentar sin orderBy.
  if (!res.ok) {
    const fallback = {
      from: [{ collectionId: COL }],
      limit: limitN,
      select: {
        fields: SUMMARY_FIELDS.map((fieldPath) => ({ fieldPath })),
      },
    };
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ structuredQuery: fallback }),
    });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Firestore REST ${res.status}: ${text.slice(0, 180) || res.statusText}`);
  }

  const rows = (await res.json()) as Array<{ document?: any; readTime?: string }>;
  const items: DistributionCompareOperation[] = [];
  for (const row of rows) {
    if (!row?.document) continue;
    const mapped = restDocToSummary(row.document);
    if (mapped) items.push(mapped);
  }
  return items;
}

/** Colección espejo liviana (docs nuevos / ya migrados). */
async function fetchSummariesCollection(limitN: number): Promise<DistributionCompareOperation[]> {
  if (!firestore) throw new Error('Firestore no inicializado en el cliente.');
  let snap;
  try {
    snap = await getDocs(
      query(collection(firestore, SUMMARY_COL), orderBy('createdAt', 'desc'), limit(limitN))
    );
  } catch {
    snap = await getDocs(query(collection(firestore, SUMMARY_COL), limit(limitN)));
  }
  return snap.docs.map((d) =>
    mapSummary(d.id, d.data() as Partial<DistributionCompareOperation>)
  );
}

/**
 * Preferir colección de resúmenes; si está vacía, REST con field mask
 * sobre la colección principal (seguro con docs legacy pesados).
 */
export async function fetchDistributionCompareSummariesClient(
  limitN = 30
): Promise<DistributionCompareOperation[]> {
  try {
    const mirrored = await withTimeout(
      fetchSummariesCollection(limitN),
      6000,
      'resúmenes'
    );
    if (mirrored.length > 0) return mirrored;
  } catch {
    // Seguir con REST sobre la colección principal.
  }

  return fetchSummariesViaRest(limitN);
}

function lineDocId(reference: string): string {
  return encodeURIComponent(String(reference || '').trim()).slice(0, 700) || 'ref';
}

/**
 * Migra un doc legacy con `lines` embebidas → subcolección + resumen liviano.
 * Se ejecuta en segundo plano; no bloquea el listado.
 */
export async function slimLegacyCompareDocClient(compareId: string): Promise<boolean> {
  if (!firestore || !compareId) return false;
  const parentRef = doc(firestore, COL, compareId);
  const snap = await getDoc(parentRef);
  if (!snap.exists()) return false;
  const data = snap.data() as DistributionCompareOperation;
  const embedded = data.lines;
  if (!Array.isArray(embedded) || embedded.length === 0) {
    // Igual asegurar espejo de resumen.
    await setDoc(
      doc(firestore, SUMMARY_COL, compareId),
      {
        ...mapSummary(compareId, data),
        lines: undefined,
      },
      { merge: true }
    );
    return true;
  }

  let batch = writeBatch(firestore);
  let ops = 0;
  for (const line of embedded) {
    const ref = String((line as any)?.reference || '').trim();
    if (!ref) continue;
    const lineRef = doc(firestore, COL, compareId, LINES_SUB, lineDocId(ref));
    batch.set(lineRef, line as any);
    ops += 1;
    if (ops >= 400) {
      await batch.commit();
      batch = writeBatch(firestore);
      ops = 0;
    }
  }
  if (ops > 0) await batch.commit();

  const summary = mapSummary(compareId, {
    ...data,
    lineCount: embedded.length,
    linesInSubcollection: true,
  });
  await updateDoc(parentRef, {
    lines: deleteField(),
    lineCount: embedded.length,
    linesInSubcollection: true,
    updatedAt: new Date().toISOString(),
  });
  await setDoc(doc(firestore, SUMMARY_COL, compareId), { ...summary, lines: undefined }, {
    merge: true,
  });
  return true;
}

/** Tras listar: escribe espejos livianos para próximas cargas aún más rápidas. */
export async function ensureCompareSummaryMirrors(
  items: DistributionCompareOperation[]
): Promise<void> {
  if (!firestore || items.length === 0) return;
  await Promise.all(
    items.slice(0, 30).map(async (it) => {
      try {
        await setDoc(
          doc(firestore, SUMMARY_COL, it.id),
          {
            id: it.id,
            receptionOperationId: it.receptionOperationId || null,
            rkIdentifier: it.rkIdentifier || null,
            receptionSupplier: it.receptionSupplier || null,
            physicalSource: it.physicalSource,
            planFileName: it.planFileName || null,
            stockFileName: it.stockFileName || null,
            notes: it.notes || null,
            lineCount: it.lineCount ?? 0,
            linesInSubcollection: it.linesInSubcollection ?? true,
            totals: it.totals,
            status: it.status,
            createdAt: it.createdAt,
            updatedAt: it.updatedAt,
            createdBy: it.createdBy,
            createdByName: it.createdByName || null,
          },
          { merge: true }
        );
      } catch {
        // ignore mirror errors
      }
    })
  );
}

const RECEPTION_COL = 'receptionOperations';
const RECEPTION_LIST_FIELDS = [
  'rk_identifier',
  'supplier',
  'status',
  'totalScannedQuantity',
  'expected_quantity',
  'created_at',
] as const;

export type ReceptionOptionForCompare = {
  id: string;
  rk_identifier: string;
  supplier: string;
  status: string;
  totalScannedQuantity: number;
  expected_quantity: number;
  created_at: string;
};

/** Listado liviano de recepciones (solo nombre/estado; sin expectedItems ni escaneos). */
export async function fetchReceptionOptionsForCompareClient(
  limitN = 40
): Promise<ReceptionOptionForCompare[]> {
  const token = await waitForIdToken();
  const url = `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/(default)/documents:runQuery`;
  const structuredQuery = {
    from: [{ collectionId: RECEPTION_COL }],
    orderBy: [{ field: { fieldPath: 'created_at' }, direction: 'DESCENDING' }],
    limit: limitN,
    select: {
      fields: RECEPTION_LIST_FIELDS.map((fieldPath) => ({ fieldPath })),
    },
  };

  let res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ structuredQuery }),
  });

  if (!res.ok) {
    const fallback = {
      from: [{ collectionId: RECEPTION_COL }],
      limit: limitN,
      select: {
        fields: RECEPTION_LIST_FIELDS.map((fieldPath) => ({ fieldPath })),
      },
    };
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ structuredQuery: fallback }),
    });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Recepciones REST ${res.status}: ${text.slice(0, 160) || res.statusText}`);
  }

  const rows = (await res.json()) as Array<{ document?: any }>;
  const items: ReceptionOptionForCompare[] = [];
  for (const row of rows) {
    const name = String(row?.document?.name || '');
    const id = name.split('/').pop();
    if (!id || !row.document) continue;
    const fields = row.document.fields || {};
    const raw: Record<string, unknown> = {};
    for (const key of RECEPTION_LIST_FIELDS) {
      if (fields[key] != null) raw[key] = readRestValue(fields[key]);
    }
    items.push({
      id,
      rk_identifier: String(raw.rk_identifier || id),
      supplier: String(raw.supplier || ''),
      status: String(raw.status || ''),
      totalScannedQuantity: Number(raw.totalScannedQuantity) || 0,
      expected_quantity: Number(raw.expected_quantity) || 0,
      created_at: String(raw.created_at || ''),
    });
  }
  return items;
}

function sheetHasPhysicalColumns(rows: Record<string, unknown>[]): boolean {
  if (!rows.length) return false;
  const keys = Object.keys(rows[0] || {}).map((k) => k.toLowerCase());
  const hasRef = keys.some((k) => k === 'referencia' || k === 'reference');
  const hasQty = keys.some(
    (k) =>
      k.includes('cant. leída') ||
      k.includes('cantidad leída') ||
      k.includes('total leído') ||
      k === 'cantd leida' ||
      k === 'cantd_leida' ||
      k === 'cant' ||
      k === 'cantidad'
  );
  return hasRef && hasQty;
}

/**
 * Lee el Excel de recepción (Reporte_Completo) o existencias.
 * Prefiere hoja "Detalle…" / "Resumen…"; acepta Cant. Leída / Total Leído.
 */
export async function parsePhysicalExcelForCompare(
  file: File
): Promise<{ rows: Record<string, unknown>[]; sheetName: string }> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const workbook = XLSX.read(new Uint8Array(buf), { type: 'array' });
  const names = workbook.SheetNames || [];
  if (!names.length) throw new Error('El Excel no tiene hojas.');

  const preferred =
    names.find((n) => /detalle/i.test(n)) ||
    names.find((n) => /resumen/i.test(n) && /referencia/i.test(n)) ||
    names.find((n) => /resumen/i.test(n)) ||
    names[0];

  const tryOrder = [preferred, ...names.filter((n) => n !== preferred)];
  for (const sheetName of tryOrder) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet);
    if (sheetHasPhysicalColumns(rows)) {
      return { rows, sheetName };
    }
  }

  throw new Error(
    'No se encontraron columnas de físico. Use el Reporte completo de recepción (Referencia + Cant. Leída / Total Leído) o existencias (REFERENCIA + CANTD LEIDA).'
  );
}

export function validateComparePhysicalRows(rows: Record<string, unknown>[]): boolean {
  return sheetHasPhysicalColumns(rows);
}

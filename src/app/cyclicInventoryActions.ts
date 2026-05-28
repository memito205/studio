'use server';

import { firestore } from '@/services/firebase';
import {
  collection,
  deleteDoc,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  setDoc,
  startAfter,
  Timestamp,
  where,
  writeBatch,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import type { CyclicInventoryCountRecord, CyclicInventoryDayMeta, CyclicInventoryLine } from '@/types';
import { isValidInventoryDateKey } from '@/lib/cyclicInventoryDate';

const LINES_BATCH = 400;
const DELETE_CHUNK = 450;
const LINES_COL = 'cyclicInventoryLines';
const DAYS_COL = 'cyclicInventoryDays';
const COUNT_RECORDS_COL = 'cyclicInventoryCountRecords';
const ADJUSTMENTS_COL = 'inventoryAdjustments';

function convertTimestampsToDates(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const key of Object.keys(out)) {
    const v = out[key];
    if (v && typeof v === 'object' && 'toDate' in v && typeof (v as { toDate: () => Date }).toDate === 'function') {
      out[key] = (v as { toDate: () => Date }).toDate().toISOString();
    }
  }
  return out;
}

function normRef(s: string) {
  return String(s || '')
    .trim()
    .toUpperCase();
}
function normLoc(s: string) {
  return String(s || '').trim();
}
function normSize(s: string) {
  return String(s || '').trim();
}

function lineRefLocKey(reference: string, location: string): string {
  return `${normRef(reference)}|${normLoc(location)}`;
}

function adjustmentRefLocKey(reference: string, location: string): string {
  return `${normRef(reference)}|${normLoc(location)}`;
}

type InventoryAdjustmentRecord = {
  id: string;
  inventoryDate: string;
  reference: string;
  size?: string;
  location: string;
  deltaQty: number;
  reason?: string;
  createdAt: string | Date;
  createdBy: string;
  createdByName?: string;
};

async function deleteAllLinesForDate(inventoryDate: string): Promise<void> {
  const col = collection(firestore, LINES_COL);
  for (;;) {
    const qy = query(col, where('inventoryDate', '==', inventoryDate), limit(DELETE_CHUNK));
    const snap = await getDocs(qy);
    if (snap.empty) return;
    const batch = writeBatch(firestore);
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

type LatestCountState = { countedQty: number; countedAt: Timestamp; countedBy: string };

/** Último conteo por ref + ubicación (v1 sin talla) desde la colección inmutable. */
async function fetchLatestCountStatePerKey(inventoryDate: string): Promise<Map<string, LatestCountState>> {
  const latest = new Map<string, LatestCountState>();
  const col = collection(firestore, COUNT_RECORDS_COL);
  let last: QueryDocumentSnapshot | undefined;
  for (;;) {
    const qy = last
      ? query(
          col,
          where('inventoryDate', '==', inventoryDate),
          orderBy(documentId()),
          startAfter(last),
          limit(500)
        )
      : query(col, where('inventoryDate', '==', inventoryDate), orderBy(documentId()), limit(500));
    const snap = await getDocs(qy);
    if (snap.empty) break;
    for (const d of snap.docs) {
      const x = d.data();
      const key = lineRefLocKey(String(x.reference ?? ''), String(x.location ?? ''));
      const ca = x.countedAt as Timestamp | undefined;
      const t = ca?.toMillis?.() ?? 0;
      const prev = latest.get(key);
      if (!prev || t > prev.countedAt.toMillis()) {
        latest.set(key, {
          countedQty: Math.max(0, Math.floor(Number(x.countedQty) || 0)),
          countedAt: ca ?? Timestamp.now(),
          countedBy: String(x.countedBy ?? ''),
        });
      }
    }
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < 500) break;
  }
  return latest;
}

async function mergeLatestCountsOntoLines(inventoryDate: string): Promise<void> {
  const latest = await fetchLatestCountStatePerKey(inventoryDate);
  if (latest.size === 0) return;

  const linesCol = collection(firestore, LINES_COL);
  let last: QueryDocumentSnapshot | undefined;
  for (;;) {
    const qy = last
      ? query(
          linesCol,
          where('inventoryDate', '==', inventoryDate),
          orderBy(documentId()),
          startAfter(last),
          limit(400)
        )
      : query(linesCol, where('inventoryDate', '==', inventoryDate), orderBy(documentId()), limit(400));
    const snap = await getDocs(qy);
    if (snap.empty) break;

    const batch = writeBatch(firestore);
    let n = 0;
    for (const d of snap.docs) {
      const data = d.data();
      const key = lineRefLocKey(String(data.reference ?? ''), String(data.location ?? ''));
      const st = latest.get(key);
      if (!st) continue;
      batch.update(d.ref, {
        countedQty: st.countedQty,
        countedAt: st.countedAt,
        countedBy: st.countedBy,
      });
      n += 1;
    }
    if (n > 0) await batch.commit();

    last = snap.docs[snap.docs.length - 1];
    if (snap.size < 400) break;
  }
}

/**
 * Reemplaza las líneas de inventario esperado del día. Los conteos no se borran: viven en `cyclicInventoryCountRecords`
 * y se vuelven a aplicar a las líneas nuevas por referencia y ubicación (v1 sin talla).
 */
export async function importCyclicInventoryForDate(input: {
  inventoryDate: string;
  lines: { reference: string; size: string; location: string; expectedQty: number }[];
  uploadedBy: string;
  uploadedByName?: string;
  fileName?: string;
}): Promise<{ success: boolean; imported?: number; error?: string }> {
  try {
    const dateKey = String(input.inventoryDate || '').trim();
    if (!isValidInventoryDateKey(dateKey)) {
      return { success: false, error: 'Fecha inválida. Use formato AAAA-MM-DD.' };
    }
    if (!input.uploadedBy?.trim()) {
      return { success: false, error: 'Usuario no identificado.' };
    }

    const normalized: { reference: string; size: string; location: string; expectedQty: number }[] = [];
    for (const row of input.lines || []) {
      const reference = normRef(row.reference);
      if (!reference) continue;
      normalized.push({
        reference,
        size: normSize(row.size),
        location: normLoc(row.location),
        expectedQty: Math.max(0, Math.floor(Number(row.expectedQty) || 0)),
      });
    }
    if (normalized.length === 0) {
      return { success: false, error: 'No hay filas válidas para importar.' };
    }

    const merged = new Map<string, { reference: string; location: string; expectedQty: number }>();
    for (const row of normalized) {
      const k = lineRefLocKey(row.reference, row.location);
      const cur = merged.get(k);
      if (!cur) {
        merged.set(k, { reference: row.reference, location: row.location, expectedQty: row.expectedQty });
      } else {
        cur.expectedQty += row.expectedQty;
      }
    }
    const consolidatedRows = [...merged.values()];

    await deleteAllLinesForDate(dateKey);

    let imported = 0;
    for (let i = 0; i < consolidatedRows.length; i += LINES_BATCH) {
      const chunk = consolidatedRows.slice(i, i + LINES_BATCH);
      const batch = writeBatch(firestore);
      for (const row of chunk) {
        const lineRef = doc(collection(firestore, LINES_COL));
        batch.set(lineRef, {
          inventoryDate: dateKey,
          reference: row.reference,
          size: '',
          location: row.location,
          expectedQty: row.expectedQty,
          countedQty: null,
          countedAt: null,
          countedBy: null,
          createdAt: Timestamp.now(),
        });
        imported += 1;
      }
      await batch.commit();
    }

    await mergeLatestCountsOntoLines(dateKey);

    await setDoc(
      doc(firestore, DAYS_COL, dateKey),
      {
        lastUploadedAt: Timestamp.now(),
        lastUploadedBy: input.uploadedBy.trim(),
        lastUploadedByName: (input.uploadedByName || '').trim(),
        lastFileName: (input.fileName || '').trim(),
        lineCount: imported,
      },
      { merge: true }
    );

    return { success: true, imported };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error al importar.';
    return { success: false, error: msg };
  }
}

export async function listCyclicInventoryDayMeta(max = 60): Promise<{
  success: boolean;
  data?: CyclicInventoryDayMeta[];
  error?: string;
}> {
  try {
    const q = query(collection(firestore, DAYS_COL), orderBy('lastUploadedAt', 'desc'), limit(max));
    const snap = await getDocs(q);
    const data: CyclicInventoryDayMeta[] = snap.docs.map((d) => {
      const raw = convertTimestampsToDates({ id: d.id, ...d.data() } as Record<string, unknown>);
      return raw as unknown as CyclicInventoryDayMeta;
    });
    return { success: true, data };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error al listar días.';
    if (String(msg).includes('failed-precondition')) {
      return {
        success: false,
        error:
          'Firestore requiere un índice: cyclicInventoryDays (lastUploadedAt descendente). Cree el índice desde el enlace en la consola de Firebase.',
      };
    }
    return { success: false, error: msg };
  }
}

function countedAtMillis(v: string | Date | null | undefined): number {
  if (v === null || v === undefined || v === '') return -1;
  const t = typeof v === 'string' ? new Date(v).getTime() : v instanceof Date ? v.getTime() : -1;
  return Number.isNaN(t) ? -1 : t;
}

/** Una fila por referencia + ubicación: suma esperados y conserva el conteo más reciente del grupo. */
function consolidateLinesByRefLoc(raw: CyclicInventoryLine[]): CyclicInventoryLine[] {
  const groups = new Map<string, { ids: string[]; lines: CyclicInventoryLine[] }>();
  for (const line of raw) {
    const key = lineRefLocKey(line.reference, line.location);
    if (!groups.has(key)) {
      groups.set(key, { ids: [], lines: [] });
    }
    const g = groups.get(key)!;
    g.ids.push(line.id);
    g.lines.push(line);
  }

  const out: CyclicInventoryLine[] = [];
  for (const g of groups.values()) {
    const sumExpected = g.lines.reduce((s, l) => s + Math.max(0, Math.floor(Number(l.expectedQty) || 0)), 0);
    let bestQty: number | null = null;
    let bestAt = -1;
    let bestCountedBy: string | null = null;
    let bestCountedAt: string | Date | null | undefined = null;
    for (const l of g.lines) {
      if (l.countedQty === null || l.countedQty === undefined) continue;
      const m = countedAtMillis(l.countedAt);
      if (m > bestAt) {
        bestAt = m;
        bestQty = l.countedQty;
        bestCountedBy = l.countedBy ?? null;
        bestCountedAt = l.countedAt;
      }
    }
    const sortedLines = [...g.lines].sort((a, b) => a.id.localeCompare(b.id));
    const primary = sortedLines[0];
    out.push({
      ...primary,
      expectedQty: sumExpected,
      size: '',
      countedQty: bestQty,
      countedAt: bestCountedAt ?? null,
      countedBy: bestCountedBy,
      consolidatedLineIds: g.ids.length > 1 ? g.ids : undefined,
    });
  }
  out.sort((a, b) => `${a.reference}|${a.location}`.localeCompare(`${b.reference}|${b.location}`));
  return out;
}

async function fetchAdjustmentDeltaPerKey(inventoryDate: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const qy = query(collection(firestore, ADJUSTMENTS_COL), where('inventoryDate', '==', inventoryDate));
  const snap = await getDocs(qy);
  for (const d of snap.docs) {
    const x = d.data() as Record<string, unknown>;
    const key = adjustmentRefLocKey(String(x.reference ?? ''), String(x.location ?? ''));
    const prev = out.get(key) ?? 0;
    const delta = Number(x.deltaQty) || 0;
    out.set(key, prev + Math.trunc(delta));
  }
  return out;
}

export async function getCyclicInventoryLinesForDate(inventoryDate: string): Promise<{
  success: boolean;
  data?: CyclicInventoryLine[];
  error?: string;
}> {
  try {
    const dateKey = String(inventoryDate || '').trim();
    if (!isValidInventoryDateKey(dateKey)) {
      return { success: false, error: 'Fecha inválida. Use AAAA-MM-DD.' };
    }
    const q = query(collection(firestore, LINES_COL), where('inventoryDate', '==', dateKey));
    const snap = await getDocs(q);
    const data: CyclicInventoryLine[] = snap.docs.map((d) => {
      const raw = convertTimestampsToDates({ id: d.id, ...d.data() } as Record<string, unknown>);
      return raw as unknown as CyclicInventoryLine;
    });
    const consolidated = consolidateLinesByRefLoc(data);
    const adjustmentMap = await fetchAdjustmentDeltaPerKey(dateKey);
    const withAdjustments = consolidated.map((line) => {
      const delta = adjustmentMap.get(adjustmentRefLocKey(line.reference, line.location)) ?? 0;
      const adjustedExpected = Math.max(0, Math.floor(Number(line.expectedQty) || 0) + delta);
      return {
        ...line,
        expectedQty: adjustedExpected,
        expectedQtyBase: Math.max(0, Math.floor(Number(line.expectedQty) || 0)),
        expectedQtyDelta: delta,
      };
    });
    return { success: true, data: withAdjustments as CyclicInventoryLine[] };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error al cargar líneas.';
    if (String(msg).includes('failed-precondition')) {
      return {
        success: false,
        error:
          'Firestore puede requerir un índice para cyclicInventoryLines (inventoryDate). Revise el enlace en la consola de Firebase.',
      };
    }
    return { success: false, error: msg };
  }
}

export async function saveCyclicInventoryLineCount(input: {
  lineIds: string[];
  countedQty: number;
  countedBy: string;
  countedByName?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const ids = [...new Set((input.lineIds || []).map((x) => String(x).trim()).filter(Boolean))];
    if (ids.length === 0) {
      return { success: false, error: 'Línea no identificada.' };
    }
    const n = Math.max(0, Math.floor(Number(input.countedQty)));
    const recRef = doc(collection(firestore, COUNT_RECORDS_COL));
    const now = Timestamp.now();
    const firstLineRef = doc(firestore, LINES_COL, ids[0]);
    const firstLineSnap = await getDoc(firstLineRef);
    if (!firstLineSnap.exists()) {
      return { success: false, error: 'Línea no encontrada.' };
    }
    const inventoryDate = String(firstLineSnap.data().inventoryDate ?? '').trim();
    const adjustmentMap = isValidInventoryDateKey(inventoryDate)
      ? await fetchAdjustmentDeltaPerKey(inventoryDate)
      : new Map<string, number>();

    await runTransaction(firestore, async (tx) => {
      const lineRefs = ids.map((id) => doc(firestore, LINES_COL, id));
      const snaps = [];
      for (const lr of lineRefs) {
        snaps.push(await tx.get(lr));
      }
      for (const s of snaps) {
        if (!s.exists()) {
          throw new Error('Línea no encontrada.');
        }
      }
      const first = snaps[0].data() as Record<string, unknown>;
      const inv = String(first.inventoryDate ?? '');
      if (!isValidInventoryDateKey(inv)) {
        throw new Error('Línea sin fecha de inventario válida.');
      }
      const wantRef = normRef(String(first.reference ?? ''));
      const wantLoc = normLoc(String(first.location ?? ''));
      let sumExpected = 0;
      let sumExpectedAdjusted = 0;
      for (let i = 0; i < snaps.length; i++) {
        const d = snaps[i].data() as Record<string, unknown>;
        if (String(d.inventoryDate ?? '') !== inv) {
          throw new Error('Las líneas no comparten la misma fecha de inventario.');
        }
        if (normRef(String(d.reference ?? '')) !== wantRef || normLoc(String(d.location ?? '')) !== wantLoc) {
          throw new Error('Las líneas no comparten la misma referencia y ubicación.');
        }
        sumExpected += Math.max(0, Math.floor(Number(d.expectedQty) || 0));
      }
      const delta = adjustmentMap.get(adjustmentRefLocKey(wantRef, wantLoc)) ?? 0;
      sumExpectedAdjusted = Math.max(0, sumExpected + delta);
      for (const lr of lineRefs) {
        tx.update(lr, {
          countedQty: n,
          countedAt: now,
          countedBy: input.countedBy,
        });
      }
      const recordPayload: Record<string, unknown> = {
        inventoryDate: inv,
        reference: wantRef,
        size: '',
        location: wantLoc,
        expectedQtyAtSave: sumExpectedAdjusted,
        countedQty: n,
        countedAt: now,
        countedBy: input.countedBy,
        countedByName: (input.countedByName || '').trim(),
        lineId: ids[0],
      };
      if (ids.length > 1) {
        recordPayload.consolidatedLineIds = ids;
      }
      tx.set(recRef, recordPayload);
    });

    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error al guardar conteo.';
    return { success: false, error: msg };
  }
}

export async function listInventoryAdjustmentsForDate(input: {
  inventoryDate: string;
  maxRecords?: number;
}): Promise<{ success: boolean; data?: InventoryAdjustmentRecord[]; error?: string }> {
  try {
    const dateKey = String(input.inventoryDate || '').trim();
    if (!isValidInventoryDateKey(dateKey)) {
      return { success: false, error: 'Fecha inválida. Use AAAA-MM-DD.' };
    }
    const max = Math.min(1000, Math.max(20, input.maxRecords ?? 300));
    const qy = query(
      collection(firestore, ADJUSTMENTS_COL),
      where('inventoryDate', '==', dateKey),
      orderBy('createdAt', 'desc'),
      limit(max)
    );
    const snap = await getDocs(qy);
    const rows: InventoryAdjustmentRecord[] = snap.docs.map((d) => {
      const raw = convertTimestampsToDates({ id: d.id, ...d.data() } as Record<string, unknown>);
      return raw as unknown as InventoryAdjustmentRecord;
    });
    return { success: true, data: rows };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error al cargar ajustes.';
    if (String(msg).includes('failed-precondition')) {
      return {
        success: false,
        error:
          'Firestore puede requerir índice en inventoryAdjustments (inventoryDate asc, createdAt desc). Cree el índice desde el enlace de Firebase.',
      };
    }
    return { success: false, error: msg };
  }
}

export async function createInventoryAdjustment(input: {
  inventoryDate: string;
  reference: string;
  size?: string;
  location?: string;
  discountQty: number;
  reason?: string;
  createdBy: string;
  createdByName?: string;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const inventoryDate = String(input.inventoryDate || '').trim();
    if (!isValidInventoryDateKey(inventoryDate)) {
      return { success: false, error: 'Fecha inválida. Use AAAA-MM-DD.' };
    }
    const reference = normRef(input.reference);
    const location = normLoc(input.location || '');
    const size = normSize(input.size || '');
    const discountQty = Math.max(0, Math.floor(Number(input.discountQty) || 0));
    if (!reference) return { success: false, error: 'La referencia es obligatoria.' };
    if (!location) return { success: false, error: 'La ubicación es obligatoria.' };
    if (discountQty <= 0) return { success: false, error: 'El descuento debe ser mayor que cero.' };
    if (!String(input.createdBy || '').trim()) return { success: false, error: 'Usuario no identificado.' };

    const ref = doc(collection(firestore, ADJUSTMENTS_COL));
    await setDoc(ref, {
      inventoryDate,
      reference,
      size,
      location,
      deltaQty: -discountQty,
      reason: String(input.reason || '').trim(),
      source: 'manual_discount',
      createdAt: Timestamp.now(),
      createdBy: String(input.createdBy).trim(),
      createdByName: String(input.createdByName || '').trim(),
    });
    return { success: true, id: ref.id };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error al crear ajuste.';
    return { success: false, error: msg };
  }
}

export async function deleteInventoryAdjustment(input: {
  adjustmentId: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const id = String(input.adjustmentId || '').trim();
    if (!id) return { success: false, error: 'Ajuste no identificado.' };
    await deleteDoc(doc(firestore, ADJUSTMENTS_COL, id));
    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error al eliminar ajuste.';
    return { success: false, error: msg };
  }
}

export async function resolveCyclicInventoryBarcode(input: {
  barcode: string;
}): Promise<{
  success: boolean;
  data?: {
    barcode: string;
    reference: string;
    size: string;
    productName: string;
  };
  error?: string;
}> {
  try {
    const barcode = String(input.barcode || '').trim();
    if (!barcode) return { success: false, error: 'Código de barras vacío.' };

    const direct = await getDoc(doc(firestore, 'productDatabase', barcode));
    if (direct.exists()) {
      const raw = direct.data() as Record<string, unknown>;
      const reference = normRef(String(raw.referencia ?? raw.reference ?? ''));
      if (!reference) {
        return { success: false, error: 'El código existe pero no tiene referencia asociada.' };
      }
      return {
        success: true,
        data: {
          barcode,
          reference,
          size: normSize(String(raw.talla ?? raw.size ?? '')),
          productName: String(raw.descripcion_del_producto ?? raw.name ?? raw.nombre_rk ?? '').trim(),
        },
      };
    }

    const qy = query(collection(firestore, 'productDatabase'), where('barcode', '==', barcode), limit(1));
    const snap = await getDocs(qy);
    if (!snap.empty) {
      const raw = snap.docs[0].data() as Record<string, unknown>;
      const reference = normRef(String(raw.referencia ?? raw.reference ?? ''));
      if (!reference) {
        return { success: false, error: 'El código existe pero no tiene referencia asociada.' };
      }
      return {
        success: true,
        data: {
          barcode,
          reference,
          size: normSize(String(raw.talla ?? raw.size ?? '')),
          productName: String(raw.descripcion_del_producto ?? raw.name ?? raw.nombre_rk ?? '').trim(),
        },
      };
    }

    return { success: false, error: 'Código no catalogado en productDatabase.' };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error al resolver código de barras.';
    return { success: false, error: msg };
  }
}

export async function listCyclicInventoryCountRecordsForReport(input: {
  dateFrom: string;
  dateTo: string;
  referenceContains?: string;
  locationContains?: string;
  maxRecords?: number;
}): Promise<{ success: boolean; data?: CyclicInventoryCountRecord[]; error?: string }> {
  try {
    let from = String(input.dateFrom || '').trim();
    let to = String(input.dateTo || '').trim();
    if (!isValidInventoryDateKey(from) || !isValidInventoryDateKey(to)) {
      return { success: false, error: 'Indique fecha desde y hasta válidas (AAAA-MM-DD).' };
    }
    if (from > to) {
      const t = from;
      from = to;
      to = t;
    }

    const refSub = normRef(input.referenceContains || '');
    const locSub = normLoc(input.locationContains || '').toUpperCase();
    const max = Math.min(2500, Math.max(50, input.maxRecords ?? 1000));

    const col = collection(firestore, COUNT_RECORDS_COL);
    const collected: CyclicInventoryCountRecord[] = [];
    let last: QueryDocumentSnapshot | undefined;

    for (;;) {
      const remaining = max - collected.length;
      if (remaining <= 0) break;
      const pageSize = Math.min(400, remaining);
      const qy = last
        ? query(
            col,
            where('inventoryDate', '>=', from),
            where('inventoryDate', '<=', to),
            orderBy('inventoryDate'),
            orderBy(documentId()),
            startAfter(last),
            limit(pageSize)
          )
        : query(
            col,
            where('inventoryDate', '>=', from),
            where('inventoryDate', '<=', to),
            orderBy('inventoryDate'),
            orderBy(documentId()),
            limit(pageSize)
          );

      const snap = await getDocs(qy);
      if (snap.empty) break;

      for (const d of snap.docs) {
        const raw = convertTimestampsToDates({ id: d.id, ...d.data() } as Record<string, unknown>) as unknown as CyclicInventoryCountRecord;
        if (refSub && !raw.reference.includes(refSub)) continue;
        if (locSub && !(raw.location || '').toUpperCase().includes(locSub)) continue;
        collected.push(raw);
        if (collected.length >= max) break;
      }

      last = snap.docs[snap.docs.length - 1];
      if (snap.size < pageSize || collected.length >= max) break;
    }

    collected.sort((a, b) => {
      const ta = new Date(String(a.countedAt)).getTime();
      const tb = new Date(String(b.countedAt)).getTime();
      return tb - ta;
    });

    return { success: true, data: collected };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error al cargar reporte.';
    if (String(msg).includes('failed-precondition')) {
      return {
        success: false,
        error:
          'Firestore requiere un índice compuesto en cyclicInventoryCountRecords: inventoryDate (asc) + documentId (asc). Use el enlace de la consola de Firebase.',
      };
    }
    return { success: false, error: msg };
  }
}

'use server';

import {
  collection,
  addDoc,
  getDocs,
  Timestamp,
  doc,
  updateDoc,
  where,
  query,
  orderBy,
  writeBatch,
  documentId,
  deleteField,
} from 'firebase/firestore';
import { parse } from 'date-fns';
import { firestore } from '@/services/firebase';
import type { TransferNovelty } from '@/types';
import { createActivityLog } from './actions';

const TF_DAILY_COL = 'transferNoveltyTfDailyStats';
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Serializa fechas de Firestore a ISO para el cliente (evita `Invalid time value` en date-fns). */
function firestoreDateToIso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : v.toISOString();
  }
  if (typeof v === 'object' && v !== null && typeof (v as { toDate?: () => Date }).toDate === 'function') {
    try {
      const d = (v as { toDate: () => Date }).toDate();
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    } catch {
      return null;
    }
  }
  const sec =
    typeof v === 'object' && v !== null
      ? (v as { seconds?: number; _seconds?: number }).seconds ??
        (v as { _seconds?: number })._seconds
      : undefined;
  if (typeof sec === 'number' && Number.isFinite(sec)) {
    const d = new Date(sec * 1000);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

function mapNoveltyDoc(docSnap: { id: string; data: () => Record<string, unknown> }): TransferNovelty {
  const raw = docSnap.data();
  const createdAt = firestoreDateToIso(raw.createdAt);
  const fechaEntregaTienda = firestoreDateToIso(raw.fechaEntregaTienda);
  const fechaReporteTienda = firestoreDateToIso(raw.fechaReporteTienda);
  const fechaTf = firestoreDateToIso(raw.fechaTf);
  return {
    ...(raw as unknown as TransferNovelty),
    id: docSnap.id,
    createdAt: createdAt ?? '',
    fechaEntregaTienda: fechaEntregaTienda ?? '',
    fechaReporteTienda: fechaReporteTienda ?? '',
    fechaTf: fechaTf ?? undefined,
  };
}

/** Evita desfase por `new Date('AAAA-MM-DD')` (UTC medianoche). */
function toLocalDateFromDateish(v: unknown): Date {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  if (typeof v === 'string' && YMD_RE.test(v.trim())) {
    return parse(v.trim(), 'yyyy-MM-dd', new Date());
  }
  const d = new Date(v as string | number);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function toTimestampFromDateish(v: unknown): Timestamp {
  return Timestamp.fromDate(toLocalDateFromDateish(v));
}

export async function isEntryOnTime(deliveryDate: any, reportDate: any) {
  const d1 = new Date(deliveryDate);
  const d2 = new Date(reportDate);
  let businessDays = 0;
  let current = new Date(d1);
  while (current < d2) {
    current.setDate(current.getDate() + 1);
    const day = current.getDay();
    if (day !== 0 && day !== 6) {
      businessDays++;
    }
    if (businessDays > 3) return false;
  }
  return businessDays <= 3;
}

export async function saveTransferNovelty(novelty: any) {
  try {
    const {
      fechaEntregaTienda: feRaw,
      fechaReporteTienda: frRaw,
      fechaTf: ftfRaw,
      ...rest
    } = novelty as Record<string, unknown>;
    const enTiempo = await isEntryOnTime(toLocalDateFromDateish(feRaw), toLocalDateFromDateish(frRaw));
    const docData: Record<string, unknown> = {
      ...rest,
      enTiempo,
      createdAt: Timestamp.now(),
      fechaEntregaTienda: toTimestampFromDateish(feRaw),
      fechaReporteTienda: toTimestampFromDateish(frRaw),
    };
    if (ftfRaw != null && String(ftfRaw).trim() !== '') {
      docData.fechaTf = toTimestampFromDateish(ftfRaw);
    }
    const docRef = await addDoc(collection(firestore, "transferNovelties"), docData);
    await createActivityLog({
      user_id: novelty.packerId || 'system',
      action_type: `NOVEDAD_TF_${novelty.numeroTF}`,
      details: {
        info: `Novedad tipo ${novelty.tipo} para TF ${novelty.numeroTF} (${novelty.almacen})`,
        packerName: novelty.packerName
      }
    });
    return { success: true, id: docRef.id };
  } catch (error: any) {
    console.error("Error saving transfer novelty:", error);
    return { success: false, error: error.message };
  }
}

export async function getTransferNovelties() {
  try {
    const q = query(collection(firestore, "transferNovelties"), orderBy("createdAt", "desc"));
    const snapshot = await getDocs(q);
    const data = snapshot.docs.map((d) => mapNoveltyDoc(d));
    return { data };
  } catch (error: any) {
    console.error("Error fetching transfer novelties:", error);
    return { error: error.message };
  }
}

const DATE_UPDATE_FIELDS = new Set(['fechaTf', 'fechaReporteTienda', 'fechaEntregaTienda']);

function coerceUpdateValue(key: string, v: unknown): unknown {
  if (!DATE_UPDATE_FIELDS.has(key)) return v;
  if (v === null || v === '') return deleteField();
  if (typeof v === 'string' && YMD_RE.test(v.trim())) {
    return Timestamp.fromDate(parse(v.trim(), 'yyyy-MM-dd', new Date()));
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) return Timestamp.fromDate(v);
  return v;
}

export async function updateTransferNoveltyStatus(id: string, updates: Record<string, unknown>) {
  try {
    const docRef = doc(firestore, 'transferNovelties', id);
    const cleaned = Object.fromEntries(
      Object.entries(updates)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, coerceUpdateValue(k, v)])
    ) as Record<string, unknown>;
    await updateDoc(docRef, { ...cleaned, updatedAt: Timestamp.now() });
    return { success: true };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Error al actualizar';
    console.error('Error updating transfer novelty:', error);
    return { success: false, error: msg };
  }
}

export async function getTransferNoveltiesByDateRange(startDate: Date, endDate: Date) {
  try {
    const q = query(
      collection(firestore, "transferNovelties"),
      where("createdAt", ">=", Timestamp.fromDate(startDate)),
      where("createdAt", "<=", Timestamp.fromDate(endDate)),
      orderBy("createdAt", "desc")
    );
    const snapshot = await getDocs(q);
    const data = snapshot.docs.map((d) => mapNoveltyDoc(d));
    return { data };
  } catch (error: any) {
    console.error("Error fetching transfer novelties by range:", error);
    return { error: error.message };
  }
}

/** Totales diarios de TF (documento id = AAAA-MM-DD) para calcular efectividad vs novedades. */
export async function upsertTransferDailyTfCounts(
  rows: { dateKey: string; totalTfs: number }[]
): Promise<{ success: boolean; upserted?: number; error?: string }> {
  try {
    const normalized: { dateKey: string; totalTfs: number }[] = [];
    for (const r of rows || []) {
      const dk = String(r.dateKey || '').trim();
      if (!YMD_RE.test(dk)) continue;
      normalized.push({ dateKey: dk, totalTfs: Math.max(0, Math.floor(Number(r.totalTfs) || 0)) });
    }
    if (normalized.length === 0) {
      return { success: false, error: 'No hay filas válidas. Use columnas Fecha y Total de TF (AAAA-MM-DD).' };
    }
    let upserted = 0;
    const BATCH = 400;
    for (let i = 0; i < normalized.length; i += BATCH) {
      const chunk = normalized.slice(i, i + BATCH);
      const batch = writeBatch(firestore);
      for (const row of chunk) {
        batch.set(
          doc(firestore, TF_DAILY_COL, row.dateKey),
          { totalTfs: row.totalTfs, updatedAt: Timestamp.now() },
          { merge: true }
        );
        upserted += 1;
      }
      await batch.commit();
    }
    return { success: true, upserted };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error al guardar totales TF.';
    return { success: false, error: msg };
  }
}

export async function listTransferDailyTfCounts(
  dateFrom: string,
  dateTo: string
): Promise<{ success: boolean; data?: { dateKey: string; totalTfs: number }[]; error?: string }> {
  try {
    const from = String(dateFrom || '').trim();
    const to = String(dateTo || '').trim();
    if (!YMD_RE.test(from) || !YMD_RE.test(to)) {
      return { success: false, error: 'Use fechas AAAA-MM-DD en el rango.' };
    }
    const col = collection(firestore, TF_DAILY_COL);
    const q = query(col, where(documentId(), '>=', from), where(documentId(), '<=', to), orderBy(documentId()));
    const snap = await getDocs(q);
    const data = snap.docs.map((d) => ({
      dateKey: d.id,
      totalTfs: Math.max(0, Math.floor(Number(d.data().totalTfs) || 0)),
    }));
    return { success: true, data };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error al leer totales TF.';
    if (String(msg).includes('failed-precondition')) {
      return {
        success: false,
        error:
          'Firestore requiere un índice compuesto en transferNoveltyTfDailyStats (documentId). Use el enlace de la consola de Firebase.',
      };
    }
    return { success: false, error: msg };
  }
}

function normTfKey(s: unknown): string {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function normAlmKey(s: unknown): string {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

/**
 * Asigna `fechaTf` a novedades existentes según número de TF (y opcionalmente almacén) en un listado importado.
 * Filas válidas: `numeroTF` + `fechaKey` (AAAA-MM-DD). Si `overwriteExisting` es false, no pisa `fechaTf` ya guardada.
 */
export async function applyFechaTfFromMatches(
  rows: { numeroTF: string; fechaKey: string; almacen?: string }[],
  opts?: { overwriteExisting?: boolean }
): Promise<{ success: boolean; updated?: number; error?: string }> {
  try {
    const normRows = (rows || [])
      .map((r) => ({
        numeroTF: normTfKey(r.numeroTF),
        fechaKey: String(r.fechaKey || '').trim(),
        almacen: r.almacen ? normAlmKey(r.almacen) : '',
      }))
      .filter((r) => r.numeroTF && YMD_RE.test(r.fechaKey))
      .sort((a, b) => (b.almacen ? 1 : 0) - (a.almacen ? 1 : 0));
    if (normRows.length === 0) {
      return { success: false, error: 'No hay filas válidas (TF + fecha AAAA-MM-DD). Opcional: columna almacén/tienda.' };
    }
    const snap = await getDocs(collection(firestore, 'transferNovelties'));
    let updated = 0;
    const BATCH = 400;
    let batch = writeBatch(firestore);
    let inBatch = 0;

    const flush = async () => {
      if (inBatch === 0) return;
      await batch.commit();
      batch = writeBatch(firestore);
      inBatch = 0;
    };

    for (const docSnap of snap.docs) {
      const raw = docSnap.data();
      const nTf = normTfKey(raw.numeroTF);
      const nAlm = normAlmKey(raw.almacen);
      const row = normRows.find((r) => r.numeroTF === nTf && (!r.almacen || r.almacen === nAlm));
      if (!row) continue;
      if (raw.fechaTf && !opts?.overwriteExisting) continue;
      const ts = Timestamp.fromDate(parse(row.fechaKey, 'yyyy-MM-dd', new Date()));
      batch.update(docSnap.ref, { fechaTf: ts, updatedAt: Timestamp.now() });
      inBatch += 1;
      updated += 1;
      if (inBatch >= BATCH) await flush();
    }
    await flush();
    return { success: true, updated };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error al aplicar fechas TF.';
    return { success: false, error: msg };
  }
}

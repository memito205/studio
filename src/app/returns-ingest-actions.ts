'use server';

/**
 * Persistencia del reporte de devoluciones (buckets opción B).
 * Reglas Firestore: fusionar `firestore/returnsPeriods.rules.fragment` en su ruleset
 * (instrucciones en `firestore/README-returnsPeriods.txt`).
 */

import { createHash } from 'crypto';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  Timestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { firestore } from '@/services/firebase';
import type { Transaction } from '@/types';
import {
  transactionsToBucketDocs,
  transactionLocalDayKey,
  bucketDocsToTransactions,
} from '@/lib/returnsIngest/bucketUtils';
import type { ReturnsBucketDoc, ReturnsPeriodMetaDoc, ReturnsPeriodStatus } from '@/lib/returnsIngest/types';

const RETURNS_PERIODS = 'returnsPeriods';
const BUCKETS_SUB = 'buckets';

const PERIOD_ID_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function bucketDocId(bucket: ReturnsBucketDoc): string {
  const payload = JSON.stringify(bucket);
  return createHash('sha256').update(payload).digest('hex');
}

function parsePeriodId(periodId: string): { year: number; month: number } | null {
  if (!PERIOD_ID_RE.test(periodId)) return null;
  const [y, m] = periodId.split('-').map(Number);
  if (!y || m < 1 || m > 12) return null;
  return { year: y, month: m };
}

function reviveTransactions(rows: Transaction[]): Transaction[] {
  return rows.map((t) => ({
    ...t,
    date: t.date instanceof Date ? t.date : new Date(String((t as { date?: unknown }).date)),
  }));
}

/** Lista metadatos de períodos guardados (orden por periodId desc). */
export async function listReturnsPeriods(): Promise<{
  success: boolean;
  data?: ReturnsPeriodMetaDoc[];
  error?: string;
}> {
  try {
    if (!firestore) {
      return { success: false, error: 'Firestore no está inicializado.' };
    }
    const snap = await getDocs(collection(firestore, RETURNS_PERIODS));
    const data: ReturnsPeriodMetaDoc[] = snap.docs.map((d) => {
      const raw = d.data() as Record<string, unknown>;
      return {
        periodId: d.id,
        year: Number(raw.year ?? 0),
        month: Number(raw.month ?? 0),
        status: (raw.status as ReturnsPeriodStatus) || 'partial',
        lastIngestAt: raw.lastIngestAt,
        lastIngestBy: raw.lastIngestBy != null ? String(raw.lastIngestBy) : undefined,
        coversThrough: raw.coversThrough != null ? String(raw.coversThrough) : undefined,
        bucketCount: raw.bucketCount != null ? Number(raw.bucketCount) : undefined,
      };
    });
    data.sort((a, b) => b.periodId.localeCompare(a.periodId));
    return { success: true, data };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error al listar períodos.';
    console.error('[listReturnsPeriods]', e);
    return { success: false, error: msg };
  }
}

/**
 * Lee todos los buckets de los períodos cuyo año está en `years` y devuelve `Transaction[]`
 * (reconstrucción opción B, misma semántica que el dashboard con filas sintéticas).
 */
export async function getReturnsTransactionsForYears(
  years: number[],
): Promise<{ success: boolean; data?: Transaction[]; error?: string }> {
  try {
    if (!firestore) {
      return { success: false, error: 'Firestore no está inicializado.' };
    }
    const yearSet = new Set(years.filter((y) => Number.isFinite(y)));
    if (yearSet.size === 0) {
      return { success: true, data: [] };
    }

    const periodsSnap = await getDocs(collection(firestore, RETURNS_PERIODS));
    const periodIds = periodsSnap.docs
      .map((d) => d.id)
      .filter((id) => {
        const p = parsePeriodId(id);
        return p && yearSet.has(p.year);
      });

    const allBuckets: ReturnsBucketDoc[] = [];
    for (const periodId of periodIds) {
      const bSnap = await getDocs(collection(firestore, RETURNS_PERIODS, periodId, BUCKETS_SUB));
      for (const bd of bSnap.docs) {
        const raw = bd.data() as ReturnsBucketDoc;
        allBuckets.push({
          dayKey: String(raw.dayKey ?? ''),
          type: String(raw.type ?? ''),
          pdv: String(raw.pdv ?? ''),
          brand: String(raw.brand ?? ''),
          gender: String(raw.gender ?? ''),
          group: String(raw.group ?? ''),
          returnReason: raw.returnReason != null ? String(raw.returnReason) : '',
          reference: String(raw.reference ?? ''),
          lineCount: Number(raw.lineCount ?? 0),
          sumValue: Number(raw.sumValue ?? 0),
          sumQuantity: Number(raw.sumQuantity ?? 0),
        });
      }
    }

    return { success: true, data: bucketDocsToTransactions(allBuckets) };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error al leer devoluciones desde Firestore.';
    console.error('[getReturnsTransactionsForYears]', e);
    return { success: false, error: msg };
  }
}

/**
 * Idempotencia por día: borra buckets de `returnsPeriods/{periodId}/buckets` cuyo `dayKey`
 * está en los días presentes en `transactions`, luego escribe los buckets agregados.
 */
export async function ingestReturnsPeriod(params: {
  periodId: string;
  transactions: Transaction[];
  status: ReturnsPeriodStatus;
  lastIngestBy?: string;
  /** Si el período ya está `complete`, solo admin puede pasar true. */
  forceReopenComplete?: boolean;
  callerRole?: string | null;
}): Promise<{ success: boolean; error?: string; bucketCount?: number; dayKeysTouched?: string[] }> {
  try {
    if (!firestore) {
      return { success: false, error: 'Firestore no está inicializado.' };
    }
    if (params.callerRole === 'office') {
      return { success: false, error: 'El perfil oficina no puede guardar datos en Firebase.' };
    }

    const transactions = reviveTransactions(params.transactions);

    if (transactions.length === 0) {
      return {
        success: false,
        error:
          'No hay filas para guardar. Importe un Excel o carpeta, confirme en la vista previa y use «Guardar datos actuales en Firebase» (solo subir archivos no escribe en Firestore).',
      };
    }

    const badDates = transactions.filter((t) => {
      const d = t.date instanceof Date ? t.date : new Date(String((t as { date?: unknown }).date));
      return Number.isNaN(d.getTime());
    });
    if (badDates.length > 0) {
      return {
        success: false,
        error: `Hay ${badDates.length} fila(s) con fecha inválida; corrija el Excel antes de guardar.`,
      };
    }

    const parsed = parsePeriodId(params.periodId);
    if (!parsed) {
      return { success: false, error: 'periodId debe ser YYYY-MM (ej. 2025-01).' };
    }

    const periodRef = doc(firestore, RETURNS_PERIODS, params.periodId);
    const metaSnap = await getDoc(periodRef);
    if (metaSnap.exists()) {
      const cur = metaSnap.data() as { status?: ReturnsPeriodStatus };
      if (cur.status === 'complete' && !params.forceReopenComplete) {
        return {
          success: false,
          error:
            'Este período está marcado como completo. Solo un administrador puede reabrirlo (forceReopenComplete).',
        };
      }
    }

    /** Documento padre temprano: la colección `returnsPeriods` aparece en consola aunque fallen batches posteriores. */
    await setDoc(
      periodRef,
      {
        periodId: params.periodId,
        year: parsed.year,
        month: parsed.month,
        status: params.status,
        lastIngestAt: Timestamp.now(),
        lastIngestBy: params.lastIngestBy ?? null,
        coversThrough: null,
        bucketCount: 0,
      },
      { merge: true },
    );

    const dayKeys = Array.from(
      new Set(transactions.map((t) => transactionLocalDayKey(t.date))),
    ).sort();

    const bucketsCol = collection(firestore, RETURNS_PERIODS, params.periodId, BUCKETS_SUB);

    for (const dk of dayKeys) {
      const q = query(bucketsCol, where('dayKey', '==', dk));
      const snap = await getDocs(q);
      for (const d of snap.docs) {
        await deleteDoc(d.ref);
      }
    }

    const bucketDocs = transactionsToBucketDocs(transactions);
    let coversThrough = '';
    for (const dk of dayKeys) {
      if (!coversThrough || dk > coversThrough) coversThrough = dk;
    }

    const CHUNK = 450;
    for (let i = 0; i < bucketDocs.length; i += CHUNK) {
      const batch = writeBatch(firestore);
      const slice = bucketDocs.slice(i, i + CHUNK);
      for (const b of slice) {
        const id = bucketDocId(b);
        const bref = doc(firestore, RETURNS_PERIODS, params.periodId, BUCKETS_SUB, id);
        batch.set(bref, { ...b });
      }
      if (slice.length) await batch.commit();
    }

    await setDoc(
      periodRef,
      {
        periodId: params.periodId,
        year: parsed.year,
        month: parsed.month,
        status: params.status,
        lastIngestAt: Timestamp.now(),
        lastIngestBy: params.lastIngestBy ?? null,
        coversThrough: coversThrough || null,
        bucketCount: bucketDocs.length,
      },
      { merge: true },
    );

    return { success: true, bucketCount: bucketDocs.length, dayKeysTouched: dayKeys };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error al guardar el período.';
    console.error('[ingestReturnsPeriod]', e);
    return { success: false, error: msg };
  }
}

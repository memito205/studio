/**
 * Lectura/escritura de `returnsPeriods` desde el navegador.
 * Las reglas suelen exigir `request.auth`; el SDK en server actions no envía el usuario,
 * por eso aquí se usa el mismo `firestore` que ya va con la sesión de Auth del cliente.
 */

import { FirebaseError } from 'firebase/app';
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
  setDoc,
  startAfter,
  Timestamp,
  where,
  writeBatch,
  type QueryDocumentSnapshot,
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

/** Paginación paso 5: evita un único snapshot enorme en raíz y en `buckets`. */
const PERIOD_ROOT_PAGE_SIZE = 200;
const BUCKET_SUBCOL_PAGE_SIZE = 350;

const PERIOD_ID_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function chunkArray<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Años enteros de `max` a `min` inclusive (orden descendente). */
export function yearsInclusive(minYear: number, maxYear: number): number[] {
  const lo = Math.min(minYear, maxYear);
  const hi = Math.max(minYear, maxYear);
  const out: number[] = [];
  for (let y = hi; y >= lo; y--) out.push(y);
  return out;
}

export function estimateReturnsReadsFromMeta(
  metas: ReturnsPeriodMetaDoc[],
  years: number[],
): { monthsInRange: number; estimatedBucketDocReads: number } {
  const set = new Set(years.filter((y) => Number.isFinite(y)));
  let monthsInRange = 0;
  let estimatedBucketDocReads = 0;
  for (const m of metas) {
    const p = parseReturnsPeriodId(m.periodId);
    if (!p || !set.has(p.year)) continue;
    monthsInRange += 1;
    estimatedBucketDocReads += Math.max(0, Number(m.bucketCount) || 0);
  }
  return { monthsInRange, estimatedBucketDocReads };
}

export function fingerprintReturnsMetaForYears(metas: ReturnsPeriodMetaDoc[], years: number[]): string {
  const set = new Set(years.filter((y) => Number.isFinite(y)));
  return metas
    .filter((m) => {
      const p = parseReturnsPeriodId(m.periodId);
      return p && set.has(p.year);
    })
    .sort((a, b) => a.periodId.localeCompare(b.periodId))
    .map((m) => {
      const ts = m.lastIngestAt as { seconds?: number; toMillis?: () => number } | undefined;
      let t = '0';
      if (ts && typeof ts.seconds === 'number') t = String(ts.seconds);
      else if (ts && typeof ts.toMillis === 'function') t = String(ts.toMillis());
      return `${m.periodId}:${m.bucketCount ?? 0}:${t}`;
    })
    .join('#');
}

function metaFromPeriodDoc(d: QueryDocumentSnapshot): ReturnsPeriodMetaDoc {
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
}

function bucketFromSnapshot(bd: QueryDocumentSnapshot): ReturnsBucketDoc {
  const raw = bd.data() as ReturnsBucketDoc;
  return {
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
  };
}

/** Itera documentos de la raíz `returnsPeriods` por páginas de `documentId`. */
async function forEachReturnsPeriodRootPage(
  fs: NonNullable<typeof firestore>,
  onPage: (docs: QueryDocumentSnapshot[]) => void,
): Promise<void> {
  const col = collection(fs, RETURNS_PERIODS);
  let last: QueryDocumentSnapshot | null = null;
  for (;;) {
    const q = last
      ? query(col, orderBy(documentId()), startAfter(last), limit(PERIOD_ROOT_PAGE_SIZE))
      : query(col, orderBy(documentId()), limit(PERIOD_ROOT_PAGE_SIZE));
    const snap = await getDocs(q);
    if (snap.empty) break;
    onPage(snap.docs);
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < PERIOD_ROOT_PAGE_SIZE) break;
  }
}

/** Itera `buckets` de un período por páginas de `documentId`. */
async function forEachBucketPage(
  fs: NonNullable<typeof firestore>,
  periodId: string,
  onEach: (bd: QueryDocumentSnapshot) => void,
): Promise<void> {
  const col = collection(fs, RETURNS_PERIODS, periodId, BUCKETS_SUB);
  let last: QueryDocumentSnapshot | null = null;
  for (;;) {
    const q = last
      ? query(col, orderBy(documentId()), startAfter(last), limit(BUCKET_SUBCOL_PAGE_SIZE))
      : query(col, orderBy(documentId()), limit(BUCKET_SUBCOL_PAGE_SIZE));
    const snap = await getDocs(q);
    if (snap.empty) break;
    for (const bd of snap.docs) onEach(bd);
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < BUCKET_SUBCOL_PAGE_SIZE) break;
  }
}

export function formatReturnsFirestoreError(e: unknown): string {
  if (e instanceof FirebaseError) {
    if (e.code === 'permission-denied') {
      return 'Firestore rechazó la operación (permission-denied). Debe estar logueado como administrador y las reglas deben permitir returnsPeriods para su usuario.';
    }
    if (e.code === 'failed-precondition') {
      return `${e.message} (Si pide índice, ábralo desde el enlace del mensaje en consola.)`;
    }
    return `${e.code}: ${e.message}`;
  }
  if (typeof e === 'object' && e !== null && 'code' in e && 'message' in e) {
    const code = String((e as { code: unknown }).code);
    const message = String((e as { message: unknown }).message);
    if (code === 'permission-denied') {
      return 'Firestore rechazó la operación (permission-denied). Debe estar logueado como administrador y las reglas deben permitir returnsPeriods para su usuario.';
    }
    return `${code}: ${message}`;
  }
  if (e instanceof Error) return e.message;
  return typeof e === 'string' ? e : 'Error desconocido al hablar con Firestore.';
}

async function bucketDocIdAsync(bucket: ReturnsBucketDoc): Promise<string> {
  const payload = JSON.stringify(bucket);
  const enc = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function parseReturnsPeriodId(periodId: string): { year: number; month: number } | null {
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

export async function listReturnsPeriods(): Promise<{
  success: boolean;
  data?: ReturnsPeriodMetaDoc[];
  error?: string;
}> {
  try {
    if (typeof window === 'undefined') {
      return { success: false, error: 'listReturnsPeriods solo puede ejecutarse en el navegador.' };
    }
    if (!firestore) {
      return { success: false, error: 'Firestore no está inicializado (revise firebase.ts).' };
    }
    const data: ReturnsPeriodMetaDoc[] = [];
    await forEachReturnsPeriodRootPage(firestore, (docs) => {
      data.push(...docs.map(metaFromPeriodDoc));
    });
    data.sort((a, b) => b.periodId.localeCompare(a.periodId));
    return { success: true, data };
  } catch (e: unknown) {
    console.error('[listReturnsPeriods]', e);
    return { success: false, error: formatReturnsFirestoreError(e) };
  }
}

/** Metadatos de períodos cuyo campo `year` está en la lista (menos lecturas que listar toda la raíz). */
export async function listReturnsPeriodMetaForYears(
  years: number[],
): Promise<{ success: boolean; data?: ReturnsPeriodMetaDoc[]; error?: string }> {
  try {
    if (typeof window === 'undefined') {
      return { success: false, error: 'listReturnsPeriodMetaForYears solo en navegador.' };
    }
    if (!firestore) {
      return { success: false, error: 'Firestore no está inicializado (revise firebase.ts).' };
    }
    const yearSet = new Set(years.filter((y) => Number.isFinite(y)));
    if (yearSet.size === 0) {
      return { success: true, data: [] };
    }
    const uniq = [...yearSet].sort((a, b) => a - b);
    const byId = new Map<string, ReturnsPeriodMetaDoc>();
    for (const ychunk of chunkArray(uniq, 10)) {
      if (ychunk.length === 0) continue;
      const qy = query(collection(firestore, RETURNS_PERIODS), where('year', 'in', ychunk));
      const snap = await getDocs(qy);
      for (const d of snap.docs) {
        byId.set(d.id, metaFromPeriodDoc(d));
      }
    }
    const data = [...byId.values()].sort((a, b) => b.periodId.localeCompare(a.periodId));
    return { success: true, data };
  } catch (e: unknown) {
    console.error('[listReturnsPeriodMetaForYears]', e);
    return { success: false, error: formatReturnsFirestoreError(e) };
  }
}

export async function getReturnsTransactionsForYears(
  years: number[],
): Promise<{ success: boolean; data?: Transaction[]; error?: string }> {
  try {
    if (typeof window === 'undefined') {
      return { success: false, error: 'getReturnsTransactionsForYears solo puede ejecutarse en el navegador.' };
    }
    if (!firestore) {
      return { success: false, error: 'Firestore no está inicializado (revise firebase.ts).' };
    }
    const yearSet = new Set(years.filter((y) => Number.isFinite(y)));
    if (yearSet.size === 0) {
      return { success: true, data: [] };
    }

    const uniqYears = [...yearSet].sort((a, b) => a - b);
    const periodIdSet = new Set<string>();
    for (const ychunk of chunkArray(uniqYears, 10)) {
      if (ychunk.length === 0) continue;
      const qy = query(collection(firestore, RETURNS_PERIODS), where('year', 'in', ychunk));
      const snapYears = await getDocs(qy);
      for (const d of snapYears.docs) {
        const p = parseReturnsPeriodId(d.id);
        if (p && yearSet.has(p.year)) periodIdSet.add(d.id);
      }
    }
    const periodIds = [...periodIdSet];

    const allBuckets: ReturnsBucketDoc[] = [];
    for (const periodId of periodIds) {
      await forEachBucketPage(firestore, periodId, (bd) => {
        allBuckets.push(bucketFromSnapshot(bd));
      });
    }

    return { success: true, data: bucketDocsToTransactions(allBuckets) };
  } catch (e: unknown) {
    console.error('[getReturnsTransactionsForYears]', e);
    return { success: false, error: formatReturnsFirestoreError(e) };
  }
}

export async function ingestReturnsPeriod(params: {
  periodId: string;
  transactions: Transaction[];
  status: ReturnsPeriodStatus;
  lastIngestBy?: string;
  forceReopenComplete?: boolean;
  callerRole?: string | null;
}): Promise<{ success: boolean; error?: string; bucketCount?: number; dayKeysTouched?: string[] }> {
  try {
    if (typeof window === 'undefined') {
      return { success: false, error: 'ingestReturnsPeriod solo puede ejecutarse en el navegador.' };
    }
    if (!firestore) {
      return { success: false, error: 'Firestore no está inicializado (revise firebase.ts).' };
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

    const parsed = parseReturnsPeriodId(params.periodId);
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
      const slice = bucketDocs.slice(i, i + CHUNK);
      const idPairs = await Promise.all(
        slice.map(async (b) => ({ b, id: await bucketDocIdAsync(b) })),
      );
      const batch = writeBatch(firestore);
      for (const { b, id } of idPairs) {
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
    console.error('[ingestReturnsPeriod]', e);
    return { success: false, error: formatReturnsFirestoreError(e) };
  }
}

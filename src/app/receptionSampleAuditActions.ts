'use server';

/**
 * Cruce recepción ↔ control de muestras.
 *
 * Modos:
 * - Rango de fechas sobre scanned_at (reduce lecturas si el rango es corto).
 * - Una operación: solo scannedItems con reception_id == operación (sin filtrar por fechas en Firestore).
 *
 * La columna "validación ≥ corte" sigue usando RECEPTION_SAMPLE_AUDIT_START_ISO para createdAt de verificaciones.
 */

import { firestore } from '@/services/firebase';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type QueryDocumentSnapshot,
  type DocumentData,
} from 'firebase/firestore';
import { normalizeReceptionReference } from '@/lib/receptionReference';
import { RECEPTION_SAMPLE_AUDIT_START_ISO } from '@/lib/receptionSampleAudit';
import type { ReceptionOperation, ScannedItem, SavedSampleVerification, SampleDelivery } from '@/types';
import {
  loadSampleVerificationsSince,
  getSampleReferencesExistence,
  getSampleDeliveriesByReferences,
} from '@/app/actions';

const SCANNED_PAGE_SIZE = 1800;
const RECEPTION_OP_LOOKUP_PARALLEL = 48;

export type ReceptionSamplesAuditQueryParams = {
  /** Inicio del rango (inclusive), ISO 8601 */
  scanDateFromIso?: string;
  /** Fin del rango (inclusive), ISO 8601 */
  scanDateToIso?: string;
  /** Si viene informado, solo esta recepción (ignora scanDate*) */
  receptionOperationId?: string | null;
};

async function mapReceptionOpIdsToRkLabels(opIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(opIds.filter(Boolean))];
  const out = new Map<string, string>();

  for (let i = 0; i < unique.length; i += RECEPTION_OP_LOOKUP_PARALLEL) {
    const chunk = unique.slice(i, i + RECEPTION_OP_LOOKUP_PARALLEL);
    await Promise.all(
      chunk.map(async (opId) => {
        try {
          const snap = await getDoc(doc(firestore, 'receptionOperations', opId));
          if (!snap.exists()) {
            out.set(opId, opId);
            return;
          }
          const data = snap.data() as ReceptionOperation;
          const rk = String(data.rk_identifier ?? '').trim();
          out.set(opId, rk || opId);
        } catch {
          out.set(opId, opId);
        }
      })
    );
  }

  return out;
}

function accumulateScan(
  refToOpIds: Map<string, Set<string>>,
  data: ScannedItem
): void {
  const ref = normalizeReceptionReference(data.reference || '');
  if (!ref || ref === 'UNKNOWN') return;
  const rid = String(data.reception_id || '').trim();
  if (!rid) return;
  let set = refToOpIds.get(ref);
  if (!set) {
    set = new Set<string>();
    refToOpIds.set(ref, set);
  }
  set.add(rid);
}

export interface ReceptionSampleAuditRow {
  reference: string;
  hasVerificationSinceCutoff: boolean;
  inSampleDatabase: boolean;
  hasTransferDelivery: boolean;
  transferNumbers: string;
  receptionOperationIds: string[];
  receptionOperationLabels: string[];
}

export interface ReceptionSamplesAuditStats {
  scannedItemDocsRead: number;
  verificationDocsRead: number;
  deliveryDocsRead: number;
  receptionOperationDocsRead: number;
  scannedQueryRounds: number;
}

export interface ReceptionSamplesAuditScanContext {
  type: 'date_range' | 'operation';
  /** Solo modo fecha */
  dateFromIso?: string;
  dateToIso?: string;
  /** Solo modo operación */
  receptionOperationId?: string;
}

async function paginateScannedItems(opts: {
  receptionOperationId?: string | null;
  scanDateFromIso: string;
  scanDateToIso: string;
}): Promise<{
  refToOpIds: Map<string, Set<string>>;
  scannedItemDocsRead: number;
  scannedQueryRounds: number;
}> {
  const refToOpIds = new Map<string, Set<string>>();
  let lastDoc: QueryDocumentSnapshot<DocumentData> | undefined;
  let scannedQueryRounds = 0;
  let scannedItemDocsRead = 0;

  const opId = opts.receptionOperationId?.trim();

  while (true) {
    const coll = collection(firestore, 'scannedItems');

    const baseConstraints = opId
      ? [where('reception_id', '==', opId), orderBy('scanned_at'), limit(SCANNED_PAGE_SIZE)]
      : [
          where('scanned_at', '>=', opts.scanDateFromIso),
          where('scanned_at', '<=', opts.scanDateToIso),
          orderBy('scanned_at'),
          limit(SCANNED_PAGE_SIZE),
        ];

    const q = lastDoc
      ? query(coll, ...baseConstraints, startAfter(lastDoc))
      : query(coll, ...baseConstraints);

    const snap = await getDocs(q);
    scannedQueryRounds += 1;
    scannedItemDocsRead += snap.size;
    if (snap.empty) break;

    snap.docs.forEach((docSnap) => {
      accumulateScan(refToOpIds, docSnap.data() as ScannedItem);
    });

    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < SCANNED_PAGE_SIZE) break;
  }

  return { refToOpIds, scannedItemDocsRead, scannedQueryRounds };
}

export async function getReceptionSamplesAuditReport(
  params?: ReceptionSamplesAuditQueryParams
): Promise<{
  success: boolean;
  /** Corte de validaciones de muestras (regla de negocio fija) */
  cutoffIso?: string;
  validationCutoffIso?: string;
  scanContext?: ReceptionSamplesAuditScanContext;
  rows?: ReceptionSampleAuditRow[];
  error?: string;
  scannedPages?: number;
  stats?: ReceptionSamplesAuditStats;
}> {
  try {
    const validationCutoffIso = RECEPTION_SAMPLE_AUDIT_START_ISO;
    const cutoffMs = Date.parse(validationCutoffIso);
    const sinceDate = new Date(validationCutoffIso);

    const opId = params?.receptionOperationId?.trim();
    let scanDateFromIso = params?.scanDateFromIso?.trim();
    let scanDateToIso = params?.scanDateToIso?.trim();

    let scanContext: ReceptionSamplesAuditScanContext;

    if (opId) {
      scanContext = { type: 'operation', receptionOperationId: opId };
      scanDateFromIso = '';
      scanDateToIso = '';
    } else {
      if (!scanDateFromIso || !scanDateToIso) {
        return {
          success: false,
          error: 'Indique fecha desde / hasta o una operación de recepción.',
        };
      }
      if (scanDateFromIso > scanDateToIso) {
        return { success: false, error: 'La fecha inicial no puede ser posterior a la fecha final.' };
      }
      scanContext = {
        type: 'date_range',
        dateFromIso: scanDateFromIso,
        dateToIso: scanDateToIso,
      };
    }

    const { refToOpIds, scannedItemDocsRead, scannedQueryRounds } = await paginateScannedItems({
      receptionOperationId: opId || undefined,
      scanDateFromIso: scanDateFromIso || '',
      scanDateToIso: scanDateToIso || '',
    });

    const refKeys = [...refToOpIds.keys()].sort((a, b) => a.localeCompare(b));
    if (refKeys.length === 0) {
      return {
        success: true,
        cutoffIso: validationCutoffIso,
        validationCutoffIso,
        scanContext,
        rows: [],
        scannedPages: scannedQueryRounds,
        stats: {
          scannedItemDocsRead,
          verificationDocsRead: 0,
          deliveryDocsRead: 0,
          receptionOperationDocsRead: 0,
          scannedQueryRounds,
        },
      };
    }

    const allReceptionOpIds: string[] = [];
    refToOpIds.forEach((set) => set.forEach((id) => allReceptionOpIds.push(id)));
    const opLabelMap = await mapReceptionOpIdsToRkLabels(allReceptionOpIds);
    const receptionOperationDocsRead = new Set(allReceptionOpIds).size;

    const [existenceRes, delRes, verRes] = await Promise.all([
      getSampleReferencesExistence(refKeys),
      getSampleDeliveriesByReferences(refKeys),
      loadSampleVerificationsSince(sinceDate),
    ]);

    if (!existenceRes.success || !existenceRes.data) {
      return { success: false, error: existenceRes.error || 'No se pudo consultar muestras en BD.' };
    }
    if (!delRes.success || !delRes.data) {
      return { success: false, error: delRes.error || 'No se pudieron cargar entregas (TF) por referencia.' };
    }
    if (!verRes.success || !verRes.data) {
      return { success: false, error: verRes.error || 'No se pudieron cargar verificaciones de muestras.' };
    }

    const existence = existenceRes.data;
    const deliveriesAll = delRes.data;
    const verificationDocsRead = verRes.data.length;
    const deliveryDocsRead = deliveriesAll.length;

    const deliveriesByRef = new Map<string, SampleDelivery[]>();
    deliveriesAll.forEach((del) => {
      const k = normalizeReceptionReference(del.reference || '');
      if (!k) return;
      const arr = deliveriesByRef.get(k) || [];
      arr.push(del);
      deliveriesByRef.set(k, arr);
    });

    const validatedRefs = new Set<string>();
    verRes.data.forEach((v: SavedSampleVerification) => {
      const created = new Date(v.createdAt).getTime();
      if (created < cutoffMs) return;
      v.results?.forEach((r) => {
        const nr = normalizeReceptionReference(r.reference || '');
        if (nr && nr !== 'UNKNOWN') validatedRefs.add(nr);
      });
      v.newSampleReferencesAtRun?.forEach((x) => {
        const nr = normalizeReceptionReference(x || '');
        if (nr && nr !== 'UNKNOWN') validatedRefs.add(nr);
      });
    });

    const rows: ReceptionSampleAuditRow[] = refKeys.map((ref) => {
      const opIds = [...(refToOpIds.get(ref) || [])].sort((a, b) => a.localeCompare(b));
      const labels = opIds.map((id) => opLabelMap.get(id) || id);

      const dlist = (deliveriesByRef.get(ref) || []).slice().sort((a, b) => {
        const ta = new Date(a.deliveryDate).getTime();
        const tb = new Date(b.deliveryDate).getTime();
        return tb - ta;
      });
      const tfNums = dlist.map((x) => x.transferNumber).filter(Boolean);
      return {
        reference: ref,
        hasVerificationSinceCutoff: validatedRefs.has(ref),
        inSampleDatabase: !!existence[ref],
        hasTransferDelivery: tfNums.length > 0,
        transferNumbers: tfNums.length ? [...new Set(tfNums)].join('; ') : '—',
        receptionOperationIds: opIds,
        receptionOperationLabels: labels,
      };
    });

    rows.sort((a, b) => a.reference.localeCompare(b.reference));

    return {
      success: true,
      cutoffIso: validationCutoffIso,
      validationCutoffIso,
      scanContext,
      rows,
      scannedPages: scannedQueryRounds,
      stats: {
        scannedItemDocsRead,
        verificationDocsRead,
        deliveryDocsRead,
        receptionOperationDocsRead,
        scannedQueryRounds,
      },
    };
  } catch (e: any) {
    console.error('getReceptionSamplesAuditReport', e);
    if (e?.code === 'failed-precondition') {
      return {
        success: false,
        error:
          'Firestore necesita un índice compuesto. Para rango de fechas: scannedItems (scanned_at). Para una operación: scannedItems (reception_id + scanned_at). Revise el enlace en la consola de Firebase.',
      };
    }
    return { success: false, error: e?.message || 'Error al generar el cruce recepción–muestras.' };
  }
}

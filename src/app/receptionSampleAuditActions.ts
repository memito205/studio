'use server';

/**
 * Cruce entre ítems contados en recepción (desde fecha de corte) y estado en control de muestras.
 *
 * Optimización de lecturas Firestore:
 * - Solo escaneos desde la fecha de corte (necesario para saber qué referencias pasaron por recepción).
 * - Entregas TF: solo referencias presentes (getSampleDeliveriesByReferences).
 * - Verificaciones: solo sesiones con createdAt ≥ corte (loadSampleVerificationsSince).
 * - Operaciones RK: solo IDs únicos vistos en escaneos → getDoc por operación (muchas menos que ítems escaneados).
 *
 * Nota: Quitar columnas de cantidad no reduce lecturas de scannedItems; cada escaneo sigue siendo un documento leído.
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

export interface ReceptionSampleAuditRow {
  reference: string;
  hasVerificationSinceCutoff: boolean;
  inSampleDatabase: boolean;
  hasTransferDelivery: boolean;
  transferNumbers: string;
  /** IDs Firestore de operaciones donde hubo al menos un escaneo desde el corte */
  receptionOperationIds: string[];
  /** rk_identifier (o fallback id) por cada receptionOperationIds */
  receptionOperationLabels: string[];
}

/** Lecturas de documentos relevantes para esta corrida (aprox. facturación Firebase). */
export interface ReceptionSamplesAuditStats {
  scannedItemDocsRead: number;
  verificationDocsRead: number;
  deliveryDocsRead: number;
  /** getDoc en receptionOperations por operación distinta */
  receptionOperationDocsRead: number;
  scannedQueryRounds: number;
}

export async function getReceptionSamplesAuditReport(): Promise<{
  success: boolean;
  cutoffIso?: string;
  rows?: ReceptionSampleAuditRow[];
  error?: string;
  scannedPages?: number;
  stats?: ReceptionSamplesAuditStats;
}> {
  try {
    const cutoffIso = RECEPTION_SAMPLE_AUDIT_START_ISO;
    const cutoffMs = Date.parse(cutoffIso);
    const sinceDate = new Date(cutoffIso);

    /** Referencia normalizada → conjunto de reception_id */
    const refToOpIds = new Map<string, Set<string>>();

    let lastDoc: QueryDocumentSnapshot<DocumentData> | undefined;
    let scannedQueryRounds = 0;
    let scannedItemDocsRead = 0;

    while (true) {
      const baseConstraints = [
        where('scanned_at', '>=', cutoffIso),
        orderBy('scanned_at'),
        limit(SCANNED_PAGE_SIZE),
      ];
      const q = lastDoc
        ? query(collection(firestore, 'scannedItems'), ...baseConstraints, startAfter(lastDoc))
        : query(collection(firestore, 'scannedItems'), ...baseConstraints);

      const snap = await getDocs(q);
      scannedQueryRounds += 1;
      scannedItemDocsRead += snap.size;
      if (snap.empty) break;

      snap.docs.forEach((docSnap) => {
        const d = docSnap.data() as ScannedItem;
        const ref = normalizeReceptionReference(d.reference || '');
        if (!ref || ref === 'UNKNOWN') return;
        const rid = String(d.reception_id || '').trim();
        if (!rid) return;
        let set = refToOpIds.get(ref);
        if (!set) {
          set = new Set<string>();
          refToOpIds.set(ref, set);
        }
        set.add(rid);
      });

      lastDoc = snap.docs[snap.docs.length - 1];
      if (snap.size < SCANNED_PAGE_SIZE) break;
    }

    const refKeys = [...refToOpIds.keys()].sort((a, b) => a.localeCompare(b));
    if (refKeys.length === 0) {
      return {
        success: true,
        cutoffIso,
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
      cutoffIso,
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
          'Firestore necesita un índice (scannedItems con scanned_at, o sampleVerifications con createdAt). Revise la consola de Firebase o cree los índices compuestos sugeridos.',
      };
    }
    return { success: false, error: e?.message || 'Error al generar el cruce recepción–muestras.' };
  }
}

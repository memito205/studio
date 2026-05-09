'use server';

/**
 * Cruce entre ítems contados en recepción (desde fecha de corte) y estado en control de muestras.
 *
 * Optimización de lecturas Firestore:
 * - Solo escaneos desde la fecha de corte (inevitable recorrer esos documentos para agrupar).
 * - Entregas TF: solo referencias presentes en recepción (getSampleDeliveriesByReferences), no toda la colección.
 * - Verificaciones: solo sesiones con createdAt ≥ corte (loadSampleVerificationsSince).
 */

import { firestore } from '@/services/firebase';
import {
  collection,
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
import type { ScannedItem, SavedSampleVerification, SampleDelivery } from '@/types';
import {
  loadSampleVerificationsSince,
  getSampleReferencesExistence,
  getSampleDeliveriesByReferences,
} from '@/app/actions';

/** Mayor tamaño de página = menos rondas de red ante la misma cantidad de documentos leídos. */
const SCANNED_PAGE_SIZE = 1800;

export interface ReceptionSampleAuditRow {
  reference: string;
  receptionQtySinceCutoff: number;
  receptionScanLinesSinceCutoff: number;
  hasVerificationSinceCutoff: boolean;
  inSampleDatabase: boolean;
  hasTransferDelivery: boolean;
  transferNumbers: string;
}

/** Aproximación de lecturas de documentos facturables por Firebase en esta corrida (solo lecturas principales). */
export interface ReceptionSamplesAuditStats {
  /** Documentos devueltos al paginar scannedItems */
  scannedItemDocsRead: number;
  /** Documentos en sampleVerifications que cumplen el filtro de fecha */
  verificationDocsRead: number;
  /** Documentos en sampleDeliveries devueltos por las consultas por referencia */
  deliveryDocsRead: number;
  /** Lotes de consulta sobre scannedItems (viajes de red; no es costo Firestore directo) */
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

    const refAgg = new Map<string, { qty: number; lines: number }>();

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
        const qty = typeof d.quantity === 'number' ? d.quantity : 1;
        const prev = refAgg.get(ref) || { qty: 0, lines: 0 };
        prev.qty += qty;
        prev.lines += 1;
        refAgg.set(ref, prev);
      });

      lastDoc = snap.docs[snap.docs.length - 1];
      if (snap.size < SCANNED_PAGE_SIZE) break;
    }

    const refKeys = [...refAgg.keys()].sort((a, b) => a.localeCompare(b));
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
          scannedQueryRounds,
        },
      };
    }

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
      const agg = refAgg.get(ref)!;
      const dlist = (deliveriesByRef.get(ref) || []).slice().sort((a, b) => {
        const ta = new Date(a.deliveryDate).getTime();
        const tb = new Date(b.deliveryDate).getTime();
        return tb - ta;
      });
      const tfNums = dlist.map((x) => x.transferNumber).filter(Boolean);
      return {
        reference: ref,
        receptionQtySinceCutoff: agg.qty,
        receptionScanLinesSinceCutoff: agg.lines,
        hasVerificationSinceCutoff: validatedRefs.has(ref),
        inSampleDatabase: !!existence[ref],
        hasTransferDelivery: tfNums.length > 0,
        transferNumbers: tfNums.length ? [...new Set(tfNums)].join('; ') : '—',
      };
    });

    rows.sort((a, b) => b.receptionQtySinceCutoff - a.receptionQtySinceCutoff);

    return {
      success: true,
      cutoffIso,
      rows,
      scannedPages: scannedQueryRounds,
      stats: {
        scannedItemDocsRead,
        verificationDocsRead,
        deliveryDocsRead,
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

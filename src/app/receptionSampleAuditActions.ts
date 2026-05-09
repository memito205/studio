'use server';

/**
 * Cruce entre ítems contados en recepción (desde fecha de corte) y estado en control de muestras.
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
  loadSampleVerifications,
  getSampleReferencesExistence,
} from '@/app/actions';

const PAGE = 450;

function convertDeliveryDates(data: Record<string, unknown>): SampleDelivery {
  const d = { ...data } as Record<string, unknown>;
  if (d.deliveryDate && typeof (d.deliveryDate as { toDate?: () => Date }).toDate === 'function') {
    d.deliveryDate = (d.deliveryDate as { toDate: () => Date }).toDate();
  }
  return { id: String(d.id || ''), ...(d as object) } as SampleDelivery;
}

async function loadAllDeliveriesLocal(): Promise<SampleDelivery[]> {
  const snap = await getDocs(collection(firestore, 'sampleDeliveries'));
  return snap.docs.map((docSnap) =>
    convertDeliveryDates({ id: docSnap.id, ...docSnap.data() })
  );
}

export interface ReceptionSampleAuditRow {
  reference: string;
  receptionQtySinceCutoff: number;
  receptionScanLinesSinceCutoff: number;
  hasVerificationSinceCutoff: boolean;
  inSampleDatabase: boolean;
  hasTransferDelivery: boolean;
  transferNumbers: string;
}

export async function getReceptionSamplesAuditReport(): Promise<{
  success: boolean;
  cutoffIso?: string;
  rows?: ReceptionSampleAuditRow[];
  error?: string;
  scannedPages?: number;
}> {
  try {
    const cutoffIso = RECEPTION_SAMPLE_AUDIT_START_ISO;
    const cutoffMs = Date.parse(cutoffIso);

    const refAgg = new Map<string, { qty: number; lines: number }>();

    let lastDoc: QueryDocumentSnapshot<DocumentData> | undefined;
    let pages = 0;

    while (true) {
      const baseConstraints = [
        where('scanned_at', '>=', cutoffIso),
        orderBy('scanned_at'),
        limit(PAGE),
      ];
      const q = lastDoc
        ? query(collection(firestore, 'scannedItems'), ...baseConstraints, startAfter(lastDoc))
        : query(collection(firestore, 'scannedItems'), ...baseConstraints);

      const snap = await getDocs(q);
      pages += 1;
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
      if (snap.size < PAGE) break;
    }

    const refKeys = [...refAgg.keys()].sort((a, b) => a.localeCompare(b));
    if (refKeys.length === 0) {
      return { success: true, cutoffIso, rows: [], scannedPages: pages };
    }

    const [existenceRes, deliveriesAll, verRes] = await Promise.all([
      getSampleReferencesExistence(refKeys),
      loadAllDeliveriesLocal(),
      loadSampleVerifications(),
    ]);

    if (!existenceRes.success || !existenceRes.data) {
      return { success: false, error: existenceRes.error || 'No se pudo consultar muestras en BD.' };
    }
    if (!verRes.success || !verRes.data) {
      return { success: false, error: verRes.error || 'No se pudieron cargar verificaciones de muestras.' };
    }

    const existence = existenceRes.data;

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

    return { success: true, cutoffIso, rows, scannedPages: pages };
  } catch (e: any) {
    console.error('getReceptionSamplesAuditReport', e);
    if (e?.code === 'failed-precondition') {
      return {
        success: false,
        error:
          'Firestore necesita un índice para scannedItems (scanned_at). Revise el enlace en la consola de Firebase o cree el índice compuesto.',
      };
    }
    return { success: false, error: e?.message || 'Error al generar el cruce recepción–muestras.' };
  }
}

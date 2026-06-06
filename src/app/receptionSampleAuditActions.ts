'use server';

/**
 * Cruce recepción ↔ control de muestras.
 *
 * Lista de referencias:
 * - Preferido: subcolección referenceStats (1 doc ≈ 1 referencia por operación), ya mantenida al escanear.
 * - Por fechas: collectionGroup(referenceStats) filtrando por last_scanned_at (se escribe en cada escaneo nuevo).
 * - Opcional legacyFullScan: recorrer cada línea de scannedItems (miles de lecturas).
 *
 * TF / entrega: además de sampleDeliveries se fusionan las entradas en results[].deliveryHistory de
 * sampleVerifications (misma lógica que SampleVerification para Adidas: TF virtual = nombre de sesión + fecha).
 */

import { firestore } from '@/services/firebase';
import {
  collection,
  collectionGroup,
  doc,
  documentId,
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
import {
  buildLatestValidationByRef,
  computeEffectiveReceptionAuditFlags,
  getRefStatusInSession,
  isAdidasVerificationSessionName,
  type AuditPhotoDisplayStatus,
  type ReceptionAuditExemptReason,
} from '@/lib/receptionSampleAuditRules';
import type {
  ReceptionOperation,
  SavedSampleVerification,
  SampleDelivery,
  SamplePhotoReception,
  SamplePhotoReceptionStatus,
  ScannedItem,
} from '@/types';
import {
  loadSampleVerificationsSince,
  getSampleReferencesExistence,
  getSampleDeliveriesByReferences,
  getSamplePhotoReceptionsByReferences,
} from '@/app/actions';

const LEGACY_SCAN_PAGE_SIZE = 1800;
const REF_STATS_PAGE_SIZE = 450;
const RECEPTION_OP_LOOKUP_PARALLEL = 48;

export type ReceptionSamplesAuditQueryParams = {
  scanDateFromIso?: string;
  scanDateToIso?: string;
  receptionOperationId?: string | null;
  /** Solo modo fechas: recorrer scannedItems línea a línea (muy costoso en lecturas) */
  legacyFullScan?: boolean;
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

function receptionOperationIdFromStatsDoc(docSnap: QueryDocumentSnapshot<DocumentData>): string | null {
  const rid = docSnap.data().reception_id;
  if (typeof rid === 'string' && rid.trim()) return rid.trim();
  const parts = docSnap.ref.path.split('/');
  const i = parts.indexOf('receptionOperations');
  if (i !== -1 && parts[i + 1]) return parts[i + 1];
  return null;
}

function accumulateRefOp(refToOpIds: Map<string, Set<string>>, refNorm: string, opId: string): void {
  if (!refNorm || refNorm === 'UNKNOWN' || !opId) return;
  let set = refToOpIds.get(refNorm);
  if (!set) {
    set = new Set<string>();
    refToOpIds.set(refNorm, set);
  }
  set.add(opId);
}

function accumulateScan(refToOpIds: Map<string, Set<string>>, data: ScannedItem): void {
  const ref = normalizeReceptionReference(data.reference || '');
  const rid = String(data.reception_id || '').trim();
  accumulateRefOp(refToOpIds, ref, rid);
}

function asSampleDeliveryDate(d: SampleDelivery): Date {
  const raw = d.deliveryDate as unknown;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
  if (typeof raw === 'string' || typeof raw === 'number') return new Date(raw);
  return new Date(0);
}

/**
 * Entregas guardadas solo dentro de la verificación (p. ej. Adidas: al guardar se inyecta deliveryHistory con
 * transferNumber = nombre de la sesión y deliveryDate = momento de validación; no se escribe en sampleDeliveries).
 */
function mergeDeliveriesFromSavedVerificationResults(
  deliveriesByRef: Map<string, SampleDelivery[]>,
  sessions: SavedSampleVerification[],
  allowedRefs: Set<string>
): number {
  let mergedEntries = 0;
  for (const session of sessions) {
    for (const res of session.results || []) {
      const nr = normalizeReceptionReference(res.reference || '');
      if (!nr || nr === 'UNKNOWN' || !allowedRefs.has(nr)) continue;
      const hist = res.deliveryHistory;
      if (!hist?.length) continue;
      const arr = deliveriesByRef.get(nr) || [];
      for (const d of hist) {
        arr.push({
          ...d,
          deliveryDate: asSampleDeliveryDate(d),
        });
        mergedEntries += 1;
      }
      deliveriesByRef.set(nr, arr);
    }
  }
  return mergedEntries;
}

function sessionMentionsRef(session: SavedSampleVerification, refNorm: string): boolean {
  const inResults =
    session.results?.some((r) => normalizeReceptionReference(r.reference) === refNorm) ?? false;
  const inNew =
    session.newSampleReferencesAtRun?.some((x) => normalizeReceptionReference(x) === refNorm) ??
    false;
  return inResults || inNew;
}

/**
 * Si la verificación Adidas incluyó la ref pero no quedó deliveryHistory persistido (histórico, flujos raros),
 * replica la TF virtual que sí habría generado el guardado en SampleVerification.
 */
function applyAdidasSyntheticTfGapFill(
  deliveriesByRef: Map<string, SampleDelivery[]>,
  sessions: SavedSampleVerification[],
  refKeys: string[],
  validatedRefs: Set<string>,
  cutoffMs: number
): number {
  let added = 0;
  const adidasSessions = sessions
    .filter((s) => s.name && isAdidasVerificationSessionName(s.name))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  if (adidasSessions.length === 0) return 0;

  for (const ref of refKeys) {
    if (!validatedRefs.has(ref)) continue;
    const list = deliveriesByRef.get(ref) || [];
    const hasTf = list.some((d) => String(d.transferNumber || '').trim());
    if (hasTf) continue;

    for (const session of adidasSessions) {
      const created = new Date(session.createdAt).getTime();
      if (created < cutoffMs) continue;
      if (!sessionMentionsRef(session, ref)) continue;
      if (getRefStatusInSession(session, ref) === 'En Base de Datos') continue;

      list.push({
        id: `synthetic-adidas-${ref}-${session.id}`,
        reference: ref,
        transferNumber: session.name,
        deliveryDate: new Date(session.createdAt),
        sourceWarehouse: 'VERIFICACIÓN MANUAL',
        destinationWarehouse: 'FOTOGRAFIA',
      });
      deliveriesByRef.set(ref, list);
      added += 1;
      break;
    }
  }

  return added;
}

export interface ReceptionSampleAuditRow {
  reference: string;
  hasVerificationSinceCutoff: boolean;
  inSampleDatabase: boolean;
  hasTransferDelivery: boolean;
  hasPhotoReceptionReceived: boolean;
  photoReceptionStatus: AuditPhotoDisplayStatus;
  photoReceptionReceivedCount: number;
  photoReceptionTotalCount: number;
  transferNumbers: string;
  receptionOperationIds: string[];
  receptionOperationLabels: string[];
  /** Exención TF: validada como ya en BD (histórico pre-sistema). */
  transferExemptReason?: ReceptionAuditExemptReason | null;
  /** Exención recepción foto: histórico BD o virtual Adidas. */
  photoExemptReason?: ReceptionAuditExemptReason | null;
  /** Último estado en verificación guardada (≥ corte), si existe. */
  latestValidationStatus?: string;
}

function aggregatePhotoReceptionStatus(list: SamplePhotoReception[]): {
  status: SamplePhotoReceptionStatus | 'none';
  receivedCount: number;
  totalCount: number;
} {
  if (!list.length) return { status: 'none', receivedCount: 0, totalCount: 0 };
  const totalCount = list.length;
  const receivedCount = list.filter((r) => r.status === 'received').length;
  const inProgressCount = list.filter((r) => r.status === 'in_progress').length;
  const pendingCount = list.filter((r) => r.status === 'pending').length;
  const cancelledCount = list.filter((r) => r.status === 'cancelled').length;

  if (receivedCount > 0) return { status: 'received', receivedCount, totalCount };
  if (inProgressCount > 0) return { status: 'in_progress', receivedCount, totalCount };
  if (pendingCount > 0) return { status: 'pending', receivedCount, totalCount };
  if (cancelledCount > 0) return { status: 'cancelled', receivedCount, totalCount };
  return { status: 'none', receivedCount, totalCount };
}

export interface ReceptionSamplesAuditStats {
  /** Docs leídos para armar la lista de referencias (referenceStats o scannedItems si legado) */
  receptionRefSourceDocsRead: number;
  usedLegacyFullScan: boolean;
  verificationDocsRead: number;
  deliveryDocsRead: number;
  receptionOperationDocsRead: number;
  queryRounds: number;
  /** Líneas fusionadas desde deliveryHistory en verificaciones (TF virtual / Adidas, etc.) */
  verificationDeliveryHistoryEntries?: number;
  /** TF virtual Adidas inferida cuando había validación + sesión AD pero sin historial persistido */
  adidasSyntheticTfFilled?: number;
  /** Refs exentas de TF/foto por validación "En Base de Datos" */
  legacyInDbExemptCount?: number;
  /** Refs con recepción foto virtual Adidas (sin muestra física) */
  adidasVirtualPhotoExemptCount?: number;
  /** Por operación: referenceStats vacío y se usaron scannedItems de esa OP */
  operationScannedItemsFallback?: boolean;
}

export interface ReceptionSamplesAuditScanContext {
  type: 'date_range' | 'operation';
  dateFromIso?: string;
  dateToIso?: string;
  receptionOperationId?: string;
  usedLegacyFullScan?: boolean;
  /**
   * Por operación: la subcolección referenceStats no tenía filas (operaciones antiguas); la lista salió de scannedItems.
   */
  operationUsedScannedItemsFallback?: boolean;
}

/** Índice referenceStats de una sola operación (≈ referencias distintas). */
async function loadRefMapFromReferenceStatsForOperation(opId: string): Promise<{
  refToOpIds: Map<string, Set<string>>;
  docsRead: number;
  rounds: number;
}> {
  const refToOpIds = new Map<string, Set<string>>();
  let rounds = 0;
  let docsRead = 0;
  let lastDoc: QueryDocumentSnapshot<DocumentData> | undefined;
  const coll = collection(firestore, 'receptionOperations', opId, 'referenceStats');

  while (true) {
    const base = [orderBy(documentId()), limit(REF_STATS_PAGE_SIZE)];
    const q = lastDoc ? query(coll, ...base, startAfter(lastDoc)) : query(coll, ...base);
    const snap = await getDocs(q);
    rounds += 1;
    docsRead += snap.size;
    if (snap.empty) break;

    snap.docs.forEach((d) => {
      const data = d.data();
      const total = typeof data.totalScanned === 'number' ? data.totalScanned : 0;
      if (total <= 0) return;
      const ref = normalizeReceptionReference(String(data.reference ?? d.id ?? ''));
      accumulateRefOp(refToOpIds, ref, opId);
    });

    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < REF_STATS_PAGE_SIZE) break;
  }

  return { refToOpIds, docsRead, rounds };
}

/** Todas las operaciones: stats con último escaneo en el rango (requiere last_scanned_at en docs). */
async function loadRefMapFromReferenceStatsDateRange(
  scanDateFromIso: string,
  scanDateToIso: string
): Promise<{ refToOpIds: Map<string, Set<string>>; docsRead: number; rounds: number }> {
  const refToOpIds = new Map<string, Set<string>>();
  let rounds = 0;
  let docsRead = 0;
  let lastDoc: QueryDocumentSnapshot<DocumentData> | undefined;
  const cg = collectionGroup(firestore, 'referenceStats');

  while (true) {
    const constraints = [
      where('last_scanned_at', '>=', scanDateFromIso),
      where('last_scanned_at', '<=', scanDateToIso),
      orderBy('last_scanned_at'),
      limit(REF_STATS_PAGE_SIZE),
    ];
    const q = lastDoc ? query(cg, ...constraints, startAfter(lastDoc)) : query(cg, ...constraints);
    const snap = await getDocs(q);
    rounds += 1;
    docsRead += snap.size;
    if (snap.empty) break;

    snap.docs.forEach((d) => {
      const data = d.data();
      const total = typeof data.totalScanned === 'number' ? data.totalScanned : 0;
      if (total <= 0) return;
      const ref = normalizeReceptionReference(String(data.reference ?? d.id ?? ''));
      const op = receptionOperationIdFromStatsDoc(d);
      if (op) accumulateRefOp(refToOpIds, ref, op);
    });

    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < REF_STATS_PAGE_SIZE) break;
  }

  return { refToOpIds, docsRead, rounds };
}

/** Legado: una lectura por línea de scannedItems. */
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
      ? [where('reception_id', '==', opId), orderBy('scanned_at'), limit(LEGACY_SCAN_PAGE_SIZE)]
      : [
          where('scanned_at', '>=', opts.scanDateFromIso),
          where('scanned_at', '<=', opts.scanDateToIso),
          orderBy('scanned_at'),
          limit(LEGACY_SCAN_PAGE_SIZE),
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
    if (snap.size < LEGACY_SCAN_PAGE_SIZE) break;
  }

  return { refToOpIds, scannedItemDocsRead, scannedQueryRounds };
}

export async function getReceptionSamplesAuditReport(
  params?: ReceptionSamplesAuditQueryParams
): Promise<{
  success: boolean;
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

    let refToOpIds = new Map<string, Set<string>>();
    let receptionRefSourceDocsRead = 0;
    let queryRounds = 0;
    let usedLegacyFullScan = false;

    let operationScannedItemsFallback = false;

    if (opId) {
      const r = await loadRefMapFromReferenceStatsForOperation(opId);
      refToOpIds = r.refToOpIds;
      receptionRefSourceDocsRead = r.docsRead;
      queryRounds = r.rounds;

      /** Operaciones previas al índice referenceStats por escaneo: solo existían líneas en scannedItems */
      if (refToOpIds.size === 0) {
        const legacy = await paginateScannedItems({
          receptionOperationId: opId,
          scanDateFromIso: '',
          scanDateToIso: '',
        });
        if (legacy.refToOpIds.size > 0) {
          refToOpIds = legacy.refToOpIds;
          receptionRefSourceDocsRead = legacy.scannedItemDocsRead;
          queryRounds = legacy.scannedQueryRounds;
          operationScannedItemsFallback = true;
          scanContext = {
            ...scanContext,
            operationUsedScannedItemsFallback: true,
          };
        }
      }
    } else if (params?.legacyFullScan) {
      usedLegacyFullScan = true;
      const r = await paginateScannedItems({
        scanDateFromIso: scanDateFromIso || '',
        scanDateToIso: scanDateToIso || '',
      });
      refToOpIds = r.refToOpIds;
      receptionRefSourceDocsRead = r.scannedItemDocsRead;
      queryRounds = r.scannedQueryRounds;
    } else {
      const r = await loadRefMapFromReferenceStatsDateRange(scanDateFromIso!, scanDateToIso!);
      refToOpIds = r.refToOpIds;
      receptionRefSourceDocsRead = r.docsRead;
      queryRounds = r.rounds;
    }

    if (!opId) {
      scanContext = { ...scanContext, usedLegacyFullScan };
    }

    const refKeys = [...refToOpIds.keys()].sort((a, b) => a.localeCompare(b));
    if (refKeys.length === 0) {
      return {
        success: true,
        cutoffIso: validationCutoffIso,
        validationCutoffIso,
        scanContext,
        rows: [],
        scannedPages: queryRounds,
        stats: {
          receptionRefSourceDocsRead,
          usedLegacyFullScan,
          verificationDocsRead: 0,
          deliveryDocsRead: 0,
          receptionOperationDocsRead: 0,
          queryRounds,
          verificationDeliveryHistoryEntries: 0,
          adidasSyntheticTfFilled: 0,
          legacyInDbExemptCount: 0,
          adidasVirtualPhotoExemptCount: 0,
          operationScannedItemsFallback: false,
        },
      };
    }

    const allReceptionOpIds: string[] = [];
    refToOpIds.forEach((set) => set.forEach((id) => allReceptionOpIds.push(id)));
    const opLabelMap = await mapReceptionOpIdsToRkLabels(allReceptionOpIds);
    const receptionOperationDocsRead = new Set(allReceptionOpIds).size;

    const [existenceRes, delRes, verRes, photoRes] = await Promise.all([
      getSampleReferencesExistence(refKeys),
      getSampleDeliveriesByReferences(refKeys),
      loadSampleVerificationsSince(sinceDate),
      getSamplePhotoReceptionsByReferences(refKeys),
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
    if (!photoRes.success || !photoRes.data) {
      return { success: false, error: photoRes.error || 'No se pudo cargar la recepción foto por referencia.' };
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

    const photoByRef = new Map<string, SamplePhotoReception[]>();
    photoRes.data.forEach((rec) => {
      const k = normalizeReceptionReference(rec.reference || '');
      if (!k) return;
      const arr = photoByRef.get(k) || [];
      arr.push(rec);
      photoByRef.set(k, arr);
    });

    const refKeySet = new Set(refKeys);
    const verificationDeliveryHistoryEntries = mergeDeliveriesFromSavedVerificationResults(
      deliveriesByRef,
      verRes.data,
      refKeySet
    );

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

    const latestValidationByRef = buildLatestValidationByRef(verRes.data, cutoffMs);

    const adidasSyntheticTfFilled = applyAdidasSyntheticTfGapFill(
      deliveriesByRef,
      verRes.data,
      refKeys,
      validatedRefs,
      cutoffMs
    );

    let legacyInDbExemptCount = 0;
    let adidasVirtualPhotoExemptCount = 0;

    const rows: ReceptionSampleAuditRow[] = refKeys.map((ref) => {
      const opIdsSet = refToOpIds.get(ref) || new Set();
      const opIds = [...opIdsSet].sort((a, b) => a.localeCompare(b));
      const labels = opIds.map((id) => opLabelMap.get(id) || id);

      const dlist = (deliveriesByRef.get(ref) || []).slice().sort((a, b) => {
        const ta = new Date(a.deliveryDate).getTime();
        const tb = new Date(b.deliveryDate).getTime();
        return tb - ta;
      });
      const tfNums = dlist.map((x) => x.transferNumber).filter(Boolean);
      const photoAgg = aggregatePhotoReceptionStatus(photoByRef.get(ref) || []);
      const effective = computeEffectiveReceptionAuditFlags({
        inSampleDatabase: !!existence[ref],
        latestValidation: latestValidationByRef.get(ref),
        deliveries: dlist,
        photoReceivedCount: photoAgg.receivedCount,
        photoTotalCount: photoAgg.totalCount,
        rawPhotoStatus: photoAgg.status,
      });

      if (effective.transferExemptReason === 'legacy_in_db') legacyInDbExemptCount += 1;
      if (effective.photoExemptReason === 'adidas_virtual') adidasVirtualPhotoExemptCount += 1;

      return {
        reference: ref,
        hasVerificationSinceCutoff: validatedRefs.has(ref),
        inSampleDatabase: !!existence[ref],
        hasTransferDelivery: effective.hasTransferDelivery,
        hasPhotoReceptionReceived: effective.hasPhotoReceptionReceived,
        photoReceptionStatus: effective.photoReceptionStatus,
        photoReceptionReceivedCount: photoAgg.receivedCount,
        photoReceptionTotalCount: photoAgg.totalCount,
        transferNumbers: tfNums.length ? [...new Set(tfNums)].join('; ') : '—',
        receptionOperationIds: opIds,
        receptionOperationLabels: labels,
        transferExemptReason: effective.transferExemptReason,
        photoExemptReason: effective.photoExemptReason,
        latestValidationStatus: latestValidationByRef.get(ref)?.status,
      };
    });

    rows.sort((a, b) => a.reference.localeCompare(b.reference));

    return {
      success: true,
      cutoffIso: validationCutoffIso,
      validationCutoffIso,
      scanContext,
      rows,
      scannedPages: queryRounds,
      stats: {
        receptionRefSourceDocsRead,
        usedLegacyFullScan,
        verificationDocsRead,
        deliveryDocsRead,
        receptionOperationDocsRead,
        queryRounds,
        verificationDeliveryHistoryEntries,
        adidasSyntheticTfFilled,
        legacyInDbExemptCount,
        adidasVirtualPhotoExemptCount,
        operationScannedItemsFallback,
      },
    };
  } catch (e: any) {
    console.error('getReceptionSamplesAuditReport', e);
    if (e?.code === 'failed-precondition') {
      return {
        success: false,
        error:
          'Firestore necesita un índice compuesto. Por fechas con índice: collectionGroup referenceStats (campo last_scanned_at). Legado escaneos: scanned_at o reception_id+scanned_at. Revise el enlace en la consola de Firebase.',
      };
    }
    return { success: false, error: e?.message || 'Error al generar el cruce recepción–muestras.' };
  }
}

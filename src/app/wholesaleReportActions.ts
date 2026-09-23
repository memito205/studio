'use server';

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  Timestamp,
  where,
} from 'firebase/firestore';
import { firestore } from '@/services/firebase';
import type { DispatchSessionInfo, OrderStatus, PackedItem, PackingSession, PreprintedLabel, WholesaleOrder } from '@/types';
import {
  buildBoxAuditLines,
  buildCargueLoadLookup,
  buildCargueProgress,
  buildOrderVsPackedLines,
  computeWholesalePackingTotals,
  type CargueProgressReport,
} from '@/lib/wholesalePacking';
import {
  WHOLESALE_REPORT_SNAPSHOTS_COL,
  deserializeCargueProgressFromSnapshot,
  isWholesaleReportSnapshotStale,
  isWholesaleReportTerminal,
  serializeCargueProgressForSnapshot,
  wholesaleReportSnapshotDocId,
  type BoxAuditSnapshotPayload,
  type PedidoVsLeidoSnapshotPayload,
  type WholesaleReportSnapshotDoc,
  type WholesaleReportSnapshotPayloadMap,
  type WholesaleReportSnapshotType,
} from '@/lib/wholesaleReportSnapshots';

type Actor = { uid?: string | null; name?: string | null };

function convertTimestampsToDates(data: unknown): unknown {
  if (data === null || data === undefined) return null;
  if (data instanceof Timestamp) return data.toDate();
  if (Array.isArray(data)) return data.map(convertTimestampsToDates);
  if (typeof data === 'object' && data !== null && Object.getPrototypeOf(data) === Object.prototype) {
    const newData: Record<string, unknown> = {};
    for (const key of Object.keys(data as object)) {
      newData[key] = convertTimestampsToDates((data as Record<string, unknown>)[key]);
    }
    return newData;
  }
  return data;
}

function toIso(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString();
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (typeof v === 'string' && v) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

/**
 * Shipments relevant to one wholesale order:
 * - all open dispatch sessions (allowedOrderIds may be empty → any order)
 * - closed/open sessions that already include this orderId in orderIds
 * Avoids loading the full dispatchSessions history.
 */
export async function getShipmentsForOrder(
  orderId: string
): Promise<{ success: boolean; data?: DispatchSessionInfo[]; error?: string }> {
  try {
    const oid = String(orderId || '').trim();
    if (!oid) return { success: true, data: [] };

    const sessionsRef = collection(firestore, 'dispatchSessions');
    const [openSnap, byOrderSnap] = await Promise.all([
      getDocs(query(sessionsRef, where('status', '==', 'open'))),
      getDocs(query(sessionsRef, where('orderIds', 'array-contains', oid))),
    ]);

    const byId = new Map<string, DispatchSessionInfo>();
    for (const snap of [openSnap, byOrderSnap]) {
      snap.docs.forEach((d) => {
        byId.set(
          d.id,
          convertTimestampsToDates({ id: d.id, ...d.data() }) as DispatchSessionInfo
        );
      });
    }
    return { success: true, data: Array.from(byId.values()) };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Failed to load shipments for order: ${message}` };
  }
}

export async function getWholesaleReportSnapshot<T extends WholesaleReportSnapshotType>(
  orderId: string,
  reportType: T
): Promise<{ data?: WholesaleReportSnapshotDoc<T> | null; error?: string }> {
  try {
    const id = wholesaleReportSnapshotDocId(orderId, reportType);
    const snap = await getDoc(doc(firestore, WHOLESALE_REPORT_SNAPSHOTS_COL, id));
    if (!snap.exists()) return { data: null };
    const raw = convertTimestampsToDates({ id: snap.id, ...snap.data() }) as Record<string, unknown>;
    return {
      data: {
        id: String(raw.id || id),
        orderId: String(raw.orderId || orderId),
        reportType: (raw.reportType || reportType) as T,
        orderStatusAtCapture: String(raw.orderStatusAtCapture || '') as OrderStatus,
        generatedAt: toIso(raw.generatedAt),
        generatedByUid: (raw.generatedByUid as string | null | undefined) ?? null,
        generatedByName: (raw.generatedByName as string | null | undefined) ?? null,
        payload: raw.payload as WholesaleReportSnapshotPayloadMap[T],
      },
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: message };
  }
}

export async function saveWholesaleReportSnapshot<T extends WholesaleReportSnapshotType>(params: {
  orderId: string;
  reportType: T;
  orderStatusAtCapture: string;
  payload: WholesaleReportSnapshotPayloadMap[T];
  actor?: Actor;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const id = wholesaleReportSnapshotDocId(params.orderId, params.reportType);
    const docData = {
      orderId: String(params.orderId).trim(),
      reportType: params.reportType,
      orderStatusAtCapture: params.orderStatusAtCapture,
      generatedAt: Timestamp.now(),
      generatedByUid: params.actor?.uid || null,
      generatedByName: params.actor?.name || null,
      payload: params.payload,
    };
    await setDoc(doc(firestore, WHOLESALE_REPORT_SNAPSHOTS_COL, id), docData, { merge: true });
    return { success: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

async function loadPackingBundle(orderId: string): Promise<{
  order: WholesaleOrder | null;
  packedItems: PackedItem[];
  session: PackingSession | null;
  labels: PreprintedLabel[];
  error?: string;
}> {
  const oid = String(orderId || '').trim();
  const orderRef = doc(firestore, 'wholesaleOrders', oid);
  const [orderSnap, packedSnap, sessionSnap, labelsSnap] = await Promise.all([
    getDoc(orderRef),
    getDocs(query(collection(firestore, 'packedItems'), where('orderId', '==', oid))),
    getDoc(doc(firestore, 'packingSessions', oid)),
    getDocs(query(collection(firestore, 'preprintedLabels'), where('orderId', '==', oid))),
  ]);

  if (!orderSnap.exists()) {
    return { order: null, packedItems: [], session: null, labels: [], error: 'Pedido no encontrado' };
  }

  const order = convertTimestampsToDates({ id: orderSnap.id, ...orderSnap.data() }) as WholesaleOrder;
  const packedItems = packedSnap.docs.map(
    (d) => convertTimestampsToDates({ id: d.id, ...d.data() }) as PackedItem
  );
  const session = sessionSnap.exists()
    ? (convertTimestampsToDates({ ...sessionSnap.data() }) as PackingSession)
    : null;
  const labels = labelsSnap.docs.map(
    (d) => convertTimestampsToDates({ id: d.id, ...d.data() }) as PreprintedLabel
  );

  return { order, packedItems, session, labels };
}

async function loadOrderBundle(orderId: string): Promise<{
  order: WholesaleOrder | null;
  packedItems: PackedItem[];
  session: PackingSession | null;
  labels: PreprintedLabel[];
  shipments: DispatchSessionInfo[];
  error?: string;
}> {
  const [packing, shipmentsRes] = await Promise.all([
    loadPackingBundle(orderId),
    getShipmentsForOrder(orderId),
  ]);
  return {
    ...packing,
    shipments: shipmentsRes.data || [],
    error: packing.error || shipmentsRes.error,
  };
}

function buildPedidoPayload(order: WholesaleOrder, packedItems: PackedItem[]): PedidoVsLeidoSnapshotPayload {
  const lines = buildOrderVsPackedLines(order, packedItems);
  const totals = computeWholesalePackingTotals(order, packedItems);
  return {
    lines,
    totals: {
      orderTotal: totals.orderTotal,
      packedTotal: totals.packedTotal,
      difference: totals.difference,
      isComplete: totals.isComplete,
    },
  };
}

function buildBoxAuditPayload(order: WholesaleOrder, packedItems: PackedItem[], session: PackingSession | null, labels: PreprintedLabel[]): BoxAuditSnapshotPayload {
  const totals = computeWholesalePackingTotals(order, packedItems);
  const lines = buildBoxAuditLines({
    orderId: order.id,
    packedItems,
    session,
    labels,
  });
  return {
    lines,
    totals: {
      orderTotal: totals.orderTotal,
      packedTotal: totals.packedTotal,
      difference: totals.difference,
      isComplete: totals.isComplete,
      packingForceClosed: !!order.packingForceClosed,
    },
  };
}

function buildCargueReportFromBundle(bundle: {
  order: WholesaleOrder;
  packedItems: PackedItem[];
  session: PackingSession | null;
  labels: PreprintedLabel[];
  shipments: DispatchSessionInfo[];
}): CargueProgressReport {
  const loadLookup = buildCargueLoadLookup(bundle.shipments);
  return buildCargueProgress({
    orderId: bundle.order.id,
    packedItems: bundle.packedItems,
    session: bundle.session,
    labels: bundle.labels,
    loadLookup,
  });
}

export async function getOrBuildPedidoVsLeidoReport(params: {
  orderId: string;
  orderStatus?: string | null;
  forceRegenerate?: boolean;
  /** If parent already has packed items for this order, skip packedItems fetch when building live. */
  packedItemsHint?: PackedItem[] | null;
  actor?: Actor;
}): Promise<{
  data?: PedidoVsLeidoSnapshotPayload;
  fromSnapshot?: boolean;
  generatedAt?: string | null;
  error?: string;
}> {
  try {
    const status = params.orderStatus;
    const terminal = isWholesaleReportTerminal('pedidoVsLeido', status);

    if (terminal && !params.forceRegenerate) {
      const existing = await getWholesaleReportSnapshot(params.orderId, 'pedidoVsLeido');
      if (existing.error) return { error: existing.error };
      if (
        existing.data &&
        !isWholesaleReportSnapshotStale({
          reportType: 'pedidoVsLeido',
          orderStatus: status,
          orderStatusAtCapture: existing.data.orderStatusAtCapture,
        })
      ) {
        return {
          data: existing.data.payload,
          fromSnapshot: true,
          generatedAt: existing.data.generatedAt,
        };
      }
    }

    const hint = (params.packedItemsHint || []).filter((p) => p.orderId === params.orderId);
    let order: WholesaleOrder | null = null;
    let packedItems: PackedItem[] = hint;

    if (hint.length > 0 && status) {
      const orderSnap = await getDoc(doc(firestore, 'wholesaleOrders', params.orderId));
      if (!orderSnap.exists()) return { error: 'Pedido no encontrado' };
      order = convertTimestampsToDates({ id: orderSnap.id, ...orderSnap.data() }) as WholesaleOrder;
    } else {
      const bundle = await loadPackingBundle(params.orderId);
      if (bundle.error && !bundle.order) return { error: bundle.error };
      if (!bundle.order) return { error: 'Pedido no encontrado' };
      order = bundle.order;
      packedItems = hint.length > 0 ? hint : bundle.packedItems;
    }

    const payload = buildPedidoPayload(order!, packedItems);
    const captureStatus = String(status || order!.status || '');

    if (isWholesaleReportTerminal('pedidoVsLeido', captureStatus)) {
      await saveWholesaleReportSnapshot({
        orderId: params.orderId,
        reportType: 'pedidoVsLeido',
        orderStatusAtCapture: captureStatus,
        payload,
        actor: params.actor,
      });
    }

    return { data: payload, fromSnapshot: false, generatedAt: new Date().toISOString() };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: message };
  }
}

export async function getOrBuildBoxAuditReport(params: {
  orderId: string;
  orderStatus?: string | null;
  forceRegenerate?: boolean;
  packedItemsHint?: PackedItem[] | null;
  actor?: Actor;
}): Promise<{
  data?: BoxAuditSnapshotPayload;
  fromSnapshot?: boolean;
  generatedAt?: string | null;
  error?: string;
}> {
  try {
    const status = params.orderStatus;
    const terminal = isWholesaleReportTerminal('boxAudit', status);

    if (terminal && !params.forceRegenerate) {
      const existing = await getWholesaleReportSnapshot(params.orderId, 'boxAudit');
      if (existing.error) return { error: existing.error };
      if (
        existing.data &&
        !isWholesaleReportSnapshotStale({
          reportType: 'boxAudit',
          orderStatus: status,
          orderStatusAtCapture: existing.data.orderStatusAtCapture,
        })
      ) {
        return {
          data: existing.data.payload,
          fromSnapshot: true,
          generatedAt: existing.data.generatedAt,
        };
      }
    }

    const hint = (params.packedItemsHint || []).filter((p) => p.orderId === params.orderId);
    const bundle = await loadPackingBundle(params.orderId);
    if (!bundle.order) return { error: bundle.error || 'Pedido no encontrado' };

    const packedItems = hint.length > 0 ? hint : bundle.packedItems;
    const payload = buildBoxAuditPayload(bundle.order, packedItems, bundle.session, bundle.labels);
    const captureStatus = String(status || bundle.order.status || '');

    if (isWholesaleReportTerminal('boxAudit', captureStatus)) {
      await saveWholesaleReportSnapshot({
        orderId: params.orderId,
        reportType: 'boxAudit',
        orderStatusAtCapture: captureStatus,
        payload,
        actor: params.actor,
      });
    }

    return { data: payload, fromSnapshot: false, generatedAt: new Date().toISOString() };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: message };
  }
}

export async function getOrBuildCargueProgressReport(params: {
  orderId: string;
  orderStatus?: string | null;
  forceRegenerate?: boolean;
  /** When true (En Cargue), never serve snapshot. */
  preferLive?: boolean;
  packedItemsHint?: PackedItem[] | null;
  labelsHint?: PreprintedLabel[] | null;
  sessionHint?: PackingSession | null;
  actor?: Actor;
}): Promise<{
  data?: CargueProgressReport;
  fromSnapshot?: boolean;
  generatedAt?: string | null;
  error?: string;
}> {
  try {
    const status = params.orderStatus;
    const preferLive =
      params.preferLive === true ||
      String(status || '') === 'En Cargue' ||
      !isWholesaleReportTerminal('cargueProgress', status);

    if (!preferLive && !params.forceRegenerate) {
      const existing = await getWholesaleReportSnapshot(params.orderId, 'cargueProgress');
      if (existing.error) return { error: existing.error };
      if (
        existing.data &&
        !isWholesaleReportSnapshotStale({
          reportType: 'cargueProgress',
          orderStatus: status,
          orderStatusAtCapture: existing.data.orderStatusAtCapture,
        })
      ) {
        return {
          data: deserializeCargueProgressFromSnapshot(existing.data.payload),
          fromSnapshot: true,
          generatedAt: existing.data.generatedAt,
        };
      }
    }

    const hintPacked = (params.packedItemsHint || []).filter((p) => p.orderId === params.orderId);
    const hintLabels = params.labelsHint || null;
    const hintSession = params.sessionHint;

    let order: WholesaleOrder;
    let packedItems: PackedItem[];
    let session: PackingSession | null;
    let labels: PreprintedLabel[];
    let shipments: DispatchSessionInfo[];

    if (hintPacked.length > 0 && hintLabels && hintSession !== undefined) {
      const [orderSnap, shipmentsRes] = await Promise.all([
        getDoc(doc(firestore, 'wholesaleOrders', params.orderId)),
        getShipmentsForOrder(params.orderId),
      ]);
      if (!orderSnap.exists()) return { error: 'Pedido no encontrado' };
      order = convertTimestampsToDates({ id: orderSnap.id, ...orderSnap.data() }) as WholesaleOrder;
      packedItems = hintPacked;
      session = hintSession;
      labels = hintLabels;
      shipments = shipmentsRes.data || [];
      if (shipmentsRes.error) return { error: shipmentsRes.error };
    } else {
      const bundle = await loadOrderBundle(params.orderId);
      if (!bundle.order) return { error: bundle.error || 'Pedido no encontrado' };
      order = bundle.order;
      packedItems = hintPacked.length > 0 ? hintPacked : bundle.packedItems;
      session = hintSession !== undefined && hintSession !== null ? hintSession : bundle.session;
      labels = hintLabels && hintLabels.length > 0 ? hintLabels : bundle.labels;
      shipments = bundle.shipments;
      if (bundle.error && shipments.length === 0) return { error: bundle.error };
    }

    const report = buildCargueReportFromBundle({ order, packedItems, session, labels, shipments });
    const captureStatus = String(status || order.status || '');

    if (isWholesaleReportTerminal('cargueProgress', captureStatus)) {
      await saveWholesaleReportSnapshot({
        orderId: params.orderId,
        reportType: 'cargueProgress',
        orderStatusAtCapture: captureStatus,
        payload: serializeCargueProgressForSnapshot(report),
        actor: params.actor,
      });
    }

    return { data: report, fromSnapshot: false, generatedAt: new Date().toISOString() };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: message };
  }
}

/** Fire-and-forget friendly: write snapshots when status hits Empacado / Despachado. */
export async function captureWholesaleReportSnapshotsForStatus(
  orderId: string,
  status: string,
  actor?: Actor
): Promise<{ success: boolean; error?: string }> {
  try {
    const oid = String(orderId || '').trim();
    if (!oid) return { success: false, error: 'orderId vacío' };

    if (status === 'Empacado') {
      const [pedido, box] = await Promise.all([
        getOrBuildPedidoVsLeidoReport({ orderId: oid, orderStatus: status, forceRegenerate: true, actor }),
        getOrBuildBoxAuditReport({ orderId: oid, orderStatus: status, forceRegenerate: true, actor }),
      ]);
      if (pedido.error || box.error) {
        return { success: false, error: pedido.error || box.error };
      }
      return { success: true };
    }

    if (status === 'Despachado') {
      const cargue = await getOrBuildCargueProgressReport({
        orderId: oid,
        orderStatus: status,
        forceRegenerate: true,
        preferLive: false,
        actor,
      });
      if (cargue.error) return { success: false, error: cargue.error };
      return { success: true };
    }

    return { success: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

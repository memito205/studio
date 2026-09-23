import type { OrderStatus } from '@/types';
import type { BoxAuditLine, CargueProgressReport, OrderVsPackedLine } from '@/lib/wholesalePacking';

export const WHOLESALE_REPORT_SNAPSHOTS_COL = 'wholesaleReportSnapshots';

export type WholesaleReportSnapshotType = 'pedidoVsLeido' | 'boxAudit' | 'cargueProgress';

export type PedidoVsLeidoSnapshotPayload = {
  lines: OrderVsPackedLine[];
  totals: {
    orderTotal: number;
    packedTotal: number;
    difference: number;
    isComplete: boolean;
  };
};

export type BoxAuditSnapshotPayload = {
  lines: BoxAuditLine[];
  totals: {
    orderTotal: number;
    packedTotal: number;
    difference: number;
    isComplete: boolean;
    packingForceClosed?: boolean;
  };
};

/** Dates stored as ISO strings for Firestore. */
export type CargueProgressSnapshotPayload = Omit<CargueProgressReport, 'units'> & {
  units: Array<
    Omit<CargueProgressReport['units'][number], 'loadedAt'> & {
      loadedAt: string | null;
    }
  >;
};

export type WholesaleReportSnapshotPayloadMap = {
  pedidoVsLeido: PedidoVsLeidoSnapshotPayload;
  boxAudit: BoxAuditSnapshotPayload;
  cargueProgress: CargueProgressSnapshotPayload;
};

export type WholesaleReportSnapshotDoc<T extends WholesaleReportSnapshotType = WholesaleReportSnapshotType> = {
  id: string;
  orderId: string;
  reportType: T;
  orderStatusAtCapture: OrderStatus | string;
  generatedAt: string;
  generatedByUid?: string | null;
  generatedByName?: string | null;
  payload: WholesaleReportSnapshotPayloadMap[T];
};

export function wholesaleReportSnapshotDocId(
  orderId: string,
  reportType: WholesaleReportSnapshotType
): string {
  return `${String(orderId).trim()}__${reportType}`;
}

/** Terminal status for serving a snapshot as truth (not live). */
export function isWholesaleReportTerminal(
  reportType: WholesaleReportSnapshotType,
  orderStatus: string | null | undefined
): boolean {
  const status = String(orderStatus || '');
  if (reportType === 'cargueProgress') return status === 'Despachado';
  return status === 'Empacado' || status === 'Despachado';
}

/**
 * Snapshot is stale when the order is no longer terminal for that report,
 * or cargue was captured before Despachado.
 */
export function isWholesaleReportSnapshotStale(params: {
  reportType: WholesaleReportSnapshotType;
  orderStatus: string | null | undefined;
  orderStatusAtCapture?: string | null;
}): boolean {
  if (!isWholesaleReportTerminal(params.reportType, params.orderStatus)) return true;
  if (
    params.reportType === 'cargueProgress' &&
    String(params.orderStatusAtCapture || '') !== 'Despachado'
  ) {
    return true;
  }
  return false;
}

export function serializeCargueProgressForSnapshot(
  report: CargueProgressReport
): CargueProgressSnapshotPayload {
  return {
    ...report,
    units: report.units.map((u) => ({
      ...u,
      loadedAt: u.loadedAt instanceof Date && !Number.isNaN(u.loadedAt.getTime())
        ? u.loadedAt.toISOString()
        : u.loadedAt
          ? new Date(u.loadedAt as unknown as string).toISOString()
          : null,
    })),
  };
}

export function deserializeCargueProgressFromSnapshot(
  payload: CargueProgressSnapshotPayload
): CargueProgressReport {
  return {
    ...payload,
    units: (payload.units || []).map((u) => ({
      ...u,
      loadedAt: u.loadedAt ? new Date(u.loadedAt) : null,
    })),
  };
}

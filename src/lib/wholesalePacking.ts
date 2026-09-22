import type { OrderStatus, PackedItem, PackingSession, PreprintedLabel, WholesaleOrder } from '@/types';

/**
 * Ventas x Mayor — contadores y auditoría de empaque.
 *
 * Fuente de verdad de unidades empacadas: colección `packedItems` (suma de `quantity`).
 * Total del pedido: suma de `order.details[].cantidad` cuando hay detalle;
 * si no, `order.cantidadTotal`.
 *
 * Gate Empacado: packedTotal === orderTotal (igualdad exacta).
 * Excepción intencional: cierre forzado (`packingForceClosed`) por admin/supervisor.
 */

export type WholesalePackingTotals = {
  orderTotal: number;
  packedTotal: number;
  detailsSum: number;
  cantidadTotal: number;
  /** True when header cantidadTotal disagrees with sum(details). */
  headerMismatch: boolean;
  isComplete: boolean;
  difference: number;
};

export type BoxAuditLine = {
  pedido: string;
  caja: string;
  etiqueta: string;
  packingUnitId: string;
  referencia: string;
  talla: string;
  cantidad: number;
};

export function sumOrderDetailsQuantity(order: Pick<WholesaleOrder, 'details'> | null | undefined): number {
  return (order?.details || []).reduce((sum, d) => sum + Number(d?.cantidad || 0), 0);
}

export function getCanonicalOrderTotal(order: Pick<WholesaleOrder, 'details' | 'cantidadTotal'> | null | undefined): number {
  const detailsSum = sumOrderDetailsQuantity(order);
  if (detailsSum > 0) return detailsSum;
  return Number(order?.cantidadTotal || 0);
}

export function sumPackedItemsQuantity(items: Array<Pick<PackedItem, 'quantity' | 'packedQuantity'> | null | undefined>): number {
  return items.reduce((sum, item) => {
    if (!item) return sum;
    const qty = item.quantity ?? item.packedQuantity ?? 0;
    return sum + Number(qty || 0);
  }, 0);
}

export function computeWholesalePackingTotals(
  order: Pick<WholesaleOrder, 'details' | 'cantidadTotal'> | null | undefined,
  packedItems: Array<Pick<PackedItem, 'quantity' | 'packedQuantity'> | null | undefined>
): WholesalePackingTotals {
  const detailsSum = sumOrderDetailsQuantity(order);
  const cantidadTotal = Number(order?.cantidadTotal || 0);
  const orderTotal = detailsSum > 0 ? detailsSum : cantidadTotal;
  const packedTotal = sumPackedItemsQuantity(packedItems);
  return {
    orderTotal,
    packedTotal,
    detailsSum,
    cantidadTotal,
    headerMismatch: detailsSum > 0 && cantidadTotal > 0 && detailsSum !== cantidadTotal,
    isComplete: orderTotal > 0 && packedTotal === orderTotal,
    difference: packedTotal - orderTotal,
  };
}

/**
 * Unidades de empaque (Ventas x Mayor) con mercancía pero sin etiqueta VXM.
 * Causa típica: el operario terminó de escanear sin pulsar "Cerrar Caja".
 */
export function findUnlabeledWholesaleUnits(
  session: PackingSession | null | undefined,
  packedItems: PackedItem[]
): Array<{ id: number; firestoreId: string; status: string; itemQty: number }> {
  const units = session?.units || [];
  const result: Array<{ id: number; firestoreId: string; status: string; itemQty: number }> = [];
  for (const unit of units) {
    if (!unit?.firestoreId) continue;
    const itemQty = packedItems
      .filter((p) => p.packingUnitId === unit.firestoreId)
      .reduce((sum, p) => sum + Number(p.quantity ?? p.packedQuantity ?? 0), 0);
    if (itemQty <= 0) continue;
    const label = String(unit.labelBarcode || '').trim();
    if (!label) {
      result.push({
        id: unit.id,
        firestoreId: unit.firestoreId,
        status: unit.status || 'open',
        itemQty,
      });
    }
  }
  return result;
}

export function hasUnlabeledWholesaleUnits(
  session: PackingSession | null | undefined,
  packedItems: PackedItem[]
): boolean {
  return findUnlabeledWholesaleUnits(session, packedItems).length > 0;
}


/** Statuses that must not be auto-moved by packing counters. */
const TERMINAL_OR_DISPATCH: ReadonlySet<OrderStatus> = new Set(['En Cargue', 'Despachado', 'Cancelado']);

/**
 * Derive next status from counters.
 * - Never auto-touch En Cargue / Despachado / Cancelado.
 * - Empacado only when packed === order total (exact).
 * - packingForceClosed keeps Empacado even if incomplete.
 */
export function resolveWholesaleOrderStatus(params: {
  currentStatus: OrderStatus;
  orderTotal: number;
  packedTotal: number;
  packingForceClosed?: boolean;
  /** Si false, no marcar Empacado aunque las cantidades cuadren (cajas sin VXM). */
  allUnitsLabeled?: boolean;
}): OrderStatus {
  const { currentStatus, orderTotal, packedTotal, packingForceClosed, allUnitsLabeled = true } = params;

  if (TERMINAL_OR_DISPATCH.has(currentStatus)) {
    return currentStatus;
  }

  if (packingForceClosed) {
    return 'Empacado';
  }

  if (orderTotal > 0 && packedTotal === orderTotal && allUnitsLabeled) {
    return 'Empacado';
  }

  if (packedTotal > 0) {
    return 'En Empaque';
  }

  // Incomplete / empty: leave already-advanced Empacado as En Empaque so UI/data stay honest.
  if (currentStatus === 'Empacado') {
    return 'En Empaque';
  }

  return 'Pte Empaque';
}

export function parsePackedItemKey(itemKey: string): { referencia: string; talla: string } {
  const key = String(itemKey || '').trim();
  const idx = key.lastIndexOf('-');
  if (idx < 0) return { referencia: key, talla: '' };
  return {
    referencia: key.slice(0, idx).trim(),
    talla: key.slice(idx + 1).trim(),
  };
}

export function resolvePackedItemRefTalla(item: PackedItem): { referencia: string; talla: string } {
  const fromItem = {
    referencia: String(item.item?.referencia || item.item?.reference || '').trim(),
    talla: String(item.item?.talla || item.item?.size || '').trim(),
  };
  if (fromItem.referencia) return fromItem;
  return parsePackedItemKey(item.itemKey);
}

type UnitMeta = {
  packingUnitId: string;
  caja: string;
  etiqueta: string;
};

/**
 * Build line-level box audit from packedItems + session units (+ optional labels).
 * Does not require preprinted labels; orphans appear as "Sin caja".
 */
export function buildBoxAuditLines(params: {
  orderId: string;
  packedItems: PackedItem[];
  session?: PackingSession | null;
  labels?: PreprintedLabel[] | null;
}): BoxAuditLine[] {
  const { orderId, packedItems, session, labels } = params;
  const unitMeta = new Map<string, UnitMeta>();

  (session?.units || []).forEach((unit) => {
    if (!unit?.firestoreId) return;
    unitMeta.set(unit.firestoreId, {
      packingUnitId: unit.firestoreId,
      caja: String(unit.id ?? '-'),
      etiqueta: String(unit.labelBarcode || ''),
    });
  });

  (labels || []).forEach((label) => {
    const unitIdStr = label.unitId != null ? String(label.unitId) : '';
    const byLabel = (session?.units || []).find(
      (u) => u.labelBarcode === label.id || (unitIdStr && String(u.id) === unitIdStr)
    );
    const packingUnitId = byLabel?.firestoreId || '';
    if (!packingUnitId) return;
    const prev = unitMeta.get(packingUnitId);
    unitMeta.set(packingUnitId, {
      packingUnitId,
      caja: prev?.caja || unitIdStr || String(label.unitId ?? '-'),
      etiqueta: label.id || prev?.etiqueta || '',
    });
  });

  const agg = new Map<string, BoxAuditLine>();
  packedItems.forEach((pi) => {
    const packingUnitId = String(pi.packingUnitId || '').trim();
    const meta = packingUnitId
      ? unitMeta.get(packingUnitId) || {
          packingUnitId,
          caja: packingUnitId.startsWith('unit-') ? 'Huérfana' : packingUnitId,
          etiqueta: '',
        }
      : { packingUnitId: '', caja: 'Sin caja', etiqueta: '' };

    const { referencia, talla } = resolvePackedItemRefTalla(pi);
    const qty = Number(pi.quantity ?? pi.packedQuantity ?? 0);
    const key = `${meta.packingUnitId}||${referencia}||${talla}`;
    const prev = agg.get(key);
    if (prev) {
      prev.cantidad += qty;
    } else {
      agg.set(key, {
        pedido: orderId,
        caja: meta.caja,
        etiqueta: meta.etiqueta || '-',
        packingUnitId: meta.packingUnitId,
        referencia: referencia || 'Desconocida',
        talla: talla || '-',
        cantidad: qty,
      });
    }
  });

  return Array.from(agg.values()).sort((a, b) => {
    const cajaCmp = String(a.caja).localeCompare(String(b.caja), undefined, { numeric: true });
    if (cajaCmp !== 0) return cajaCmp;
    const refCmp = a.referencia.localeCompare(b.referencia);
    if (refCmp !== 0) return refCmp;
    return a.talla.localeCompare(b.talla);
  });
}

export function boxAuditLinesToExcelRows(lines: BoxAuditLine[]) {
  return lines.map((l) => ({
    Pedido: l.pedido,
    Caja: l.caja,
    Etiqueta: l.etiqueta,
    Referencia: l.referencia,
    Talla: l.talla,
    Cantidad: l.cantidad,
  }));
}

/** Línea de comparación pedido (orden) vs leído/empacado, por referencia+talla. */
export type OrderVsPackedLine = {
  referencia: string;
  talla: string;
  item: string;
  ordered: number;
  packed: number;
  difference: number;
  status: 'Completo' | 'Sobrante' | 'Faltante';
};

/**
 * Relación pedido vs empacado (cantidades generales por ref/talla).
 * Incluye faltantes (ordered>0, packed=0) y sobrantes no pedidos.
 */
export function buildOrderVsPackedLines(
  order: Pick<WholesaleOrder, 'id' | 'details'> | null | undefined,
  packedItems: PackedItem[]
): OrderVsPackedLine[] {
  type Acc = { referencia: string; talla: string; item: string; ordered: number; packed: number };
  const byKey = new Map<string, Acc>();
  const makeKey = (referencia: string, talla: string) => `${referencia}||${talla}`;

  (order?.details || []).forEach((d) => {
    const referencia = String(d.referencia || '').trim();
    const talla = String(d.talla || '').trim();
    const item = String(d.item || '').trim();
    const key = makeKey(referencia, talla);
    const prev = byKey.get(key);
    if (prev) {
      prev.ordered += Number(d.cantidad || 0);
      if (!prev.item && item) prev.item = item;
    } else {
      byKey.set(key, { referencia, talla, item, ordered: Number(d.cantidad || 0), packed: 0 });
    }
  });

  packedItems.forEach((p) => {
    const { referencia, talla } = resolvePackedItemRefTalla(p);
    const key = makeKey(referencia, talla);
    const qty = Number(p.quantity ?? p.packedQuantity ?? 0);
    const prev = byKey.get(key);
    if (prev) {
      prev.packed += qty;
    } else {
      const item = String((p.item as { item?: string } | undefined)?.item || '').trim();
      byKey.set(key, { referencia: referencia || 'Desconocida', talla, item, ordered: 0, packed: qty });
    }
  });

  return Array.from(byKey.values())
    .sort((a, b) => {
      const byRef = a.referencia.localeCompare(b.referencia);
      if (byRef !== 0) return byRef;
      return a.talla.localeCompare(b.talla);
    })
    .map((r) => {
      const difference = r.packed - r.ordered;
      return {
        referencia: r.referencia || '-',
        talla: r.talla || '-',
        item: r.item || '-',
        ordered: r.ordered,
        packed: r.packed,
        difference,
        status: (difference === 0 ? 'Completo' : difference > 0 ? 'Sobrante' : 'Faltante') as OrderVsPackedLine['status'],
      };
    });
}

export function orderVsPackedLinesToExcelRows(orderId: string, lines: OrderVsPackedLine[]) {
  return lines.map((r) => ({
    Pedido: orderId,
    Referencia: r.referencia,
    Talla: r.talla,
    Item: r.item,
    'Cantidad Pedido': r.ordered,
    'Cantidad Leída': r.packed,
    Diferencia: r.difference,
    Estado: r.status,
  }));
}

const normalizeCargueLabelKey = (id: string) =>
  String(id || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/'/g, '-')
    .replace(/_/g, '-');

function coerceLoadedAt(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'object' && value !== null && 'seconds' in value) {
    const seconds = Number((value as { seconds?: number }).seconds);
    if (Number.isFinite(seconds)) return new Date(seconds * 1000);
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

export type CargueLoadLookup = {
  loadedAt: Date | null;
  shipmentId?: string;
  truckPlate?: string;
  driverName?: string;
};

/** Build labelId → load metadata from open/closed dispatch sessions. */
export function buildCargueLoadLookup(
  shipments: Array<{
    id?: string;
    truckPlate?: string;
    driverName?: string;
    scannedLabels?: Record<string, unknown>;
    orderIds?: string[];
  }>
): Map<string, CargueLoadLookup> {
  const map = new Map<string, CargueLoadLookup>();
  for (const shipment of shipments) {
    const scanned = shipment.scannedLabels || {};
    for (const [rawLabelId, ts] of Object.entries(scanned)) {
      const key = normalizeCargueLabelKey(rawLabelId);
      if (!key) continue;
      const loadedAt = coerceLoadedAt(ts);
      const prev = map.get(key);
      // Keep earliest load time if the same label appears in multiple sessions.
      if (prev?.loadedAt && loadedAt && prev.loadedAt.getTime() <= loadedAt.getTime()) continue;
      map.set(key, {
        loadedAt,
        shipmentId: shipment.id,
        truckPlate: shipment.truckPlate,
        driverName: shipment.driverName,
      });
    }
  }
  return map;
}

export type CargueProgressItem = {
  referencia: string;
  talla: string;
  cantidad: number;
};

export type CargueProgressUnit = {
  pedido: string;
  caja: string;
  etiqueta: string;
  packingUnitId: string;
  loaded: boolean;
  loadedAt: Date | null;
  shipmentId?: string;
  truckPlate?: string;
  driverName?: string;
  items: CargueProgressItem[];
  totalQty: number;
};

export type CargueProgressReport = {
  expectedBoxes: number;
  loadedBoxes: number;
  pendingBoxes: number;
  loadedUnitsQty: number;
  pendingUnitsQty: number;
  units: CargueProgressUnit[];
};

/**
 * Progreso de cargue por pedido: cajas esperadas (etiquetas used/dispatched)
 * vs cargadas (status dispatched o presentes en scannedLabels de un envío).
 * Funciona mientras el pedido está En Cargue (parcial) o ya Despachado.
 */
export function buildCargueProgress(params: {
  orderId: string;
  packedItems: PackedItem[];
  session?: PackingSession | null;
  labels?: PreprintedLabel[] | null;
  loadLookup?: Map<string, CargueLoadLookup>;
}): CargueProgressReport {
  const { orderId, packedItems, session, labels, loadLookup } = params;
  const orderLabels = (labels || []).filter((l) => l.orderId === orderId && l.status !== 'void');
  const expectedLabels = orderLabels.filter((l) => l.status === 'used' || l.status === 'dispatched');

  const unitMeta = new Map<string, UnitMeta>();
  (session?.units || []).forEach((unit) => {
    if (!unit?.firestoreId) return;
    unitMeta.set(unit.firestoreId, {
      packingUnitId: unit.firestoreId,
      caja: String(unit.id ?? '-'),
      etiqueta: String(unit.labelBarcode || ''),
    });
  });
  expectedLabels.forEach((label) => {
    const unitIdStr = label.unitId != null ? String(label.unitId) : '';
    const byLabel = (session?.units || []).find(
      (u) =>
        (u.labelBarcode && normalizeCargueLabelKey(u.labelBarcode) === normalizeCargueLabelKey(label.id)) ||
        (unitIdStr && String(u.id) === unitIdStr)
    );
    const packingUnitId = byLabel?.firestoreId || '';
    if (packingUnitId) {
      const prev = unitMeta.get(packingUnitId);
      unitMeta.set(packingUnitId, {
        packingUnitId,
        caja: prev?.caja || unitIdStr || String(label.unitId ?? '-'),
        etiqueta: label.id || prev?.etiqueta || '',
      });
    }
  });

  const itemsByUnit = new Map<string, CargueProgressItem[]>();
  packedItems
    .filter((p) => p.orderId === orderId)
    .forEach((pi) => {
      const packingUnitId = String(pi.packingUnitId || '').trim();
      if (!packingUnitId) return;
      const { referencia, talla } = resolvePackedItemRefTalla(pi);
      const qty = Number(pi.quantity ?? pi.packedQuantity ?? 0);
      const list = itemsByUnit.get(packingUnitId) || [];
      const existing = list.find((i) => i.referencia === referencia && i.talla === talla);
      if (existing) existing.cantidad += qty;
      else list.push({ referencia: referencia || 'Desconocida', talla: talla || '-', cantidad: qty });
      itemsByUnit.set(packingUnitId, list);
    });

  const units: CargueProgressUnit[] = expectedLabels.map((label) => {
    const labelKey = normalizeCargueLabelKey(label.id);
    const unitIdStr = label.unitId != null ? String(label.unitId) : '';
    const byLabel = (session?.units || []).find(
      (u) =>
        (u.labelBarcode && normalizeCargueLabelKey(u.labelBarcode) === labelKey) ||
        (unitIdStr && String(u.id) === unitIdStr)
    );
    const packingUnitId = byLabel?.firestoreId || '';
    const meta = packingUnitId
      ? unitMeta.get(packingUnitId)
      : { packingUnitId: '', caja: unitIdStr || '-', etiqueta: label.id };
    const loadInfo = loadLookup?.get(labelKey);
    const loaded = label.status === 'dispatched' || !!loadInfo;
    const items = (packingUnitId ? itemsByUnit.get(packingUnitId) : undefined) || [];
    const totalQty = items.reduce((s, i) => s + i.cantidad, 0);
    return {
      pedido: orderId,
      caja: meta?.caja || unitIdStr || '-',
      etiqueta: label.id,
      packingUnitId: packingUnitId || meta?.packingUnitId || '',
      loaded,
      loadedAt: loadInfo?.loadedAt || null,
      shipmentId: loadInfo?.shipmentId,
      truckPlate: loadInfo?.truckPlate,
      driverName: loadInfo?.driverName,
      items: items.sort((a, b) => {
        const byRef = a.referencia.localeCompare(b.referencia);
        if (byRef !== 0) return byRef;
        return a.talla.localeCompare(b.talla);
      }),
      totalQty,
    };
  });

  units.sort((a, b) => {
    if (a.loaded !== b.loaded) return a.loaded ? -1 : 1;
    return String(a.caja).localeCompare(String(b.caja), undefined, { numeric: true });
  });

  const loadedBoxes = units.filter((u) => u.loaded).length;
  const pendingBoxes = units.length - loadedBoxes;
  return {
    expectedBoxes: units.length,
    loadedBoxes,
    pendingBoxes,
    loadedUnitsQty: units.filter((u) => u.loaded).reduce((s, u) => s + u.totalQty, 0),
    pendingUnitsQty: units.filter((u) => !u.loaded).reduce((s, u) => s + u.totalQty, 0),
    units,
  };
}

export function cargueProgressToExcelRows(report: CargueProgressReport) {
  const rows: Array<Record<string, string | number>> = [];
  for (const unit of report.units) {
    const loadedAtStr = unit.loadedAt
      ? unit.loadedAt.toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'medium' })
      : '';
    const base = {
      Pedido: unit.pedido,
      Caja: unit.caja,
      'Etiqueta VXM': unit.etiqueta,
      Estado: unit.loaded ? 'Cargada' : 'Pendiente',
      LoadedAt: loadedAtStr,
      Envío: unit.shipmentId ? String(unit.shipmentId).slice(-6) : '',
      Placa: unit.truckPlate || '',
    };
    if (unit.items.length === 0) {
      rows.push({
        ...base,
        Referencia: '-',
        Talla: '-',
        Cantidad: unit.totalQty || 0,
      });
    } else {
      for (const item of unit.items) {
        rows.push({
          ...base,
          Referencia: item.referencia,
          Talla: item.talla,
          Cantidad: item.cantidad,
        });
      }
    }
  }
  return rows;
}

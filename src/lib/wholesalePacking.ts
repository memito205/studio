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

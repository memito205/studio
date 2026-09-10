import type { LabelingPackUnit, ReceptionPackUnitDetail, ScannedItem } from '@/types';
import { normalizeReceptionReference } from '@/lib/receptionReference';

/** Firestore no acepta `undefined` en writes. */
export function stripUndefinedDeep<T>(value: T): T {
  if (value === undefined) return value;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((v) => stripUndefinedDeep(v)).filter((v) => v !== undefined) as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined) continue;
    out[k] = stripUndefinedDeep(v);
  }
  return out as T;
}

/** Convierte el mapa packUnitsById de stats a lista ordenada por # caja. */
export function packUnitsByIdToList(
  packUnitsById: Record<string, ReceptionPackUnitDetail> | undefined | null
): ReceptionPackUnitDetail[] {
  if (!packUnitsById || typeof packUnitsById !== 'object') return [];
  return Object.values(packUnitsById).sort((a, b) => (a.unitNumber || 0) - (b.unitNumber || 0));
}

/** Snapshot liviano para copiar a una tarea de etiquetado (modo pack_units). */
export function toLabelingPackPlan(
  details: ReceptionPackUnitDetail[]
): LabelingPackUnit[] {
  return details
    .filter((d) => d.qty > 0)
    .map((d) =>
      stripUndefinedDeep({
        packingUnitId: d.packingUnitId,
        unitNumber: d.unitNumber,
        qty: d.qty,
        locationId: d.locationId,
        locationName: d.locationName,
        confirmed: false,
      })
    );
}

type UnitMeta = {
  unitNumber: number;
  status: 'open' | 'closed';
  closedAt?: string;
};

/**
 * Agrega escaneos por referencia + caja para armar packUnitsById.
 * No escribe a Firestore; solo estructura de datos.
 */
export function aggregatePackUnitsByReference(
  scannedItems: Array<Pick<ScannedItem, 'reference' | 'packing_unit_id' | 'quantity' | 'location_id'>>,
  unitMetaById: Map<string, UnitMeta>,
  locationNameById?: Map<string, string>
): Map<string, Record<string, ReceptionPackUnitDetail>> {
  const now = new Date().toISOString();
  type Acc = {
    qty: number;
    locationId?: string;
  };
  // ref -> packingUnitId -> acc
  const byRef = new Map<string, Map<string, Acc>>();

  for (const item of scannedItems) {
    const unitId = String(item.packing_unit_id || '').trim();
    if (!unitId) continue;
    const ref = normalizeReceptionReference(item.reference);
    const qty = Number(item.quantity) || 1;
    if (!byRef.has(ref)) byRef.set(ref, new Map());
    const unitMap = byRef.get(ref)!;
    const prev = unitMap.get(unitId) || { qty: 0 };
    prev.qty += qty;
    if (!prev.locationId && item.location_id) prev.locationId = String(item.location_id);
    unitMap.set(unitId, prev);
  }

  const out = new Map<string, Record<string, ReceptionPackUnitDetail>>();
  for (const [ref, unitMap] of byRef.entries()) {
    const packUnitsById: Record<string, ReceptionPackUnitDetail> = {};
    for (const [packingUnitId, acc] of unitMap.entries()) {
      const meta = unitMetaById.get(packingUnitId);
      const locationId = acc.locationId ? String(acc.locationId) : undefined;
      const locationName =
        locationId && locationNameById?.get(locationId)
          ? locationNameById.get(locationId)
          : undefined;
      packUnitsById[packingUnitId] = stripUndefinedDeep({
        packingUnitId,
        unitNumber: meta?.unitNumber ?? 0,
        qty: acc.qty,
        locationId,
        locationName,
        status: meta?.status || 'open',
        closedAt: meta?.closedAt || undefined,
        updatedAt: now,
      });
    }
    out.set(ref, packUnitsById);
  }
  return out;
}

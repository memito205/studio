import type { LabelingPackUnit, ReceptionPackUnitDetail, ScannedItem } from '@/types';
import { normalizeReceptionReference } from '@/lib/receptionReference';

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
    .map((d) => ({
      packingUnitId: d.packingUnitId,
      unitNumber: d.unitNumber,
      qty: d.qty,
      locationId: d.locationId,
      locationName: d.locationName,
      confirmed: false,
    }));
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
    const prev = unitMap.get(unitId) || { qty: 0, locationId: undefined };
    prev.qty += qty;
    if (!prev.locationId && item.location_id) prev.locationId = item.location_id;
    unitMap.set(unitId, prev);
  }

  const out = new Map<string, Record<string, ReceptionPackUnitDetail>>();
  for (const [ref, unitMap] of byRef.entries()) {
    const packUnitsById: Record<string, ReceptionPackUnitDetail> = {};
    for (const [packingUnitId, acc] of unitMap.entries()) {
      const meta = unitMetaById.get(packingUnitId);
      const locationId = acc.locationId;
      packUnitsById[packingUnitId] = {
        packingUnitId,
        unitNumber: meta?.unitNumber ?? 0,
        qty: acc.qty,
        locationId,
        locationName: locationId ? locationNameById?.get(locationId) : undefined,
        status: meta?.status || 'open',
        closedAt: meta?.closedAt,
        updatedAt: now,
      };
    }
    out.set(ref, packUnitsById);
  }
  return out;
}

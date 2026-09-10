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

export type ConfirmPackUnitLookup = {
  packingUnitId?: string;
  unitNumber?: number;
  /** Coincide con locationName o locationId (parcial, case-insensitive). */
  locationHint?: string;
};

function normLoc(s?: string | null): string {
  return String(s || '')
    .trim()
    .toLowerCase();
}

function locationMatches(unit: LabelingPackUnit, hint: string): boolean {
  const h = normLoc(hint);
  if (!h) return true;
  const name = normLoc(unit.locationName);
  const id = normLoc(unit.locationId);
  return (name && (name === h || name.includes(h))) || (id && (id === h || id.includes(h)));
}

/**
 * Resuelve una caja del plan para confirmación (UX C: digitar #; ubicación si hay ambigüedad).
 */
export function resolvePackUnitFromPlan(
  plan: LabelingPackUnit[],
  input: ConfirmPackUnitLookup
):
  | { ok: true; unit: LabelingPackUnit; index: number }
  | { ok: false; error: string; needsLocation?: boolean; candidates?: LabelingPackUnit[] } {
  if (!plan.length) {
    return { ok: false, error: 'Esta tarea no tiene plan de cajas.' };
  }

  if (input.packingUnitId) {
    const index = plan.findIndex((u) => u.packingUnitId === input.packingUnitId);
    if (index < 0) return { ok: false, error: 'Caja no encontrada en el plan.' };
    const unit = plan[index];
    if (unit.confirmed) return { ok: false, error: 'Esta caja ya fue confirmada.' };
    return { ok: true, unit, index };
  }

  const unitNumber = Number(input.unitNumber);
  if (!Number.isFinite(unitNumber) || unitNumber <= 0) {
    return { ok: false, error: 'Ingrese el número de caja.' };
  }

  const byNumber = plan.filter((u) => Number(u.unitNumber) === unitNumber);
  if (byNumber.length === 0) {
    return { ok: false, error: `No hay caja #${unitNumber} en esta tarea.` };
  }

  const pending = byNumber.filter((u) => !u.confirmed);
  if (pending.length === 0) {
    return { ok: false, error: `La caja #${unitNumber} ya fue confirmada.` };
  }

  const hint = String(input.locationHint || '').trim();
  if (pending.length > 1 && !hint) {
    return {
      ok: false,
      error: `Hay ${pending.length} cajas #${unitNumber}. Indique la ubicación.`,
      needsLocation: true,
      candidates: pending,
    };
  }

  const matched = hint ? pending.filter((u) => locationMatches(u, hint)) : pending;
  if (matched.length === 0) {
    return {
      ok: false,
      error: `No hay caja #${unitNumber} en esa ubicación.`,
      needsLocation: true,
      candidates: pending,
    };
  }
  if (matched.length > 1) {
    return {
      ok: false,
      error: `Varias cajas #${unitNumber} coinciden. Precise la ubicación.`,
      needsLocation: true,
      candidates: matched,
    };
  }

  const unit = matched[0];
  const index = plan.findIndex((u) => u.packingUnitId === unit.packingUnitId);
  return { ok: true, unit, index };
}

/** Und / cajas confirmadas vs pendientes (Fase 5 finish). */
export function summarizePackPlanProgress(plan: LabelingPackUnit[] | undefined | null) {
  const list = Array.isArray(plan) ? plan : [];
  const confirmed = list.filter((u) => u.confirmed);
  const pending = list.filter((u) => !u.confirmed);
  return {
    totalBoxes: list.length,
    confirmedBoxes: confirmed.length,
    pendingBoxes: pending.length,
    confirmedUnits: confirmed.reduce((s, u) => s + (Number(u.qty) || 0), 0),
    pendingUnits: pending.reduce((s, u) => s + (Number(u.qty) || 0), 0),
    confirmed,
    pending,
  };
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

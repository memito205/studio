import type { ProductivitySettings } from '@/types';
import { normalizeReceptionReference } from '@/lib/receptionReference';

function normKey(value?: string | null): string {
  return String(value || '')
    .trim()
    .toUpperCase();
}

function lookupGoal(map: Record<string, number> | undefined, key: string): number | undefined {
  if (!map || !key) return undefined;
  const direct = map[key];
  if (typeof direct === 'number' && direct > 0) return direct;
  // Tolerar claves guardadas con distinta capitalización.
  const found = Object.entries(map).find(([k, v]) => normKey(k) === key && Number(v) > 0);
  return found ? Number(found[1]) : undefined;
}

export type ReceptionGoalContext = {
  reference?: string | null;
  marca?: string | null;
  grupo?: string | null;
  operationStandard?: number | null;
  userHourlyGoal?: number | null;
  settings?: ProductivitySettings | null;
};

/**
 * Prioridad: referencia → marca → grupo → operación → usuario → meta general.
 */
export function resolveReceptionHourlyGoal(ctx: ReceptionGoalContext): number {
  const dim = ctx.settings?.receptionDimensionalGoals;
  const refRaw = String(ctx.reference || '').trim();
  const refNorm = refRaw ? normalizeReceptionReference(refRaw) : '';
  const refKey = normKey(refRaw);
  const marcaKey = normKey(ctx.marca);
  const grupoKey = normKey(ctx.grupo);

  const fromRef =
    lookupGoal(dim?.byReference, refKey) ??
    (refNorm ? lookupGoal(dim?.byReference, normKey(refNorm)) : undefined);
  if (fromRef) return fromRef;

  const fromBrand = lookupGoal(dim?.byBrand, marcaKey);
  if (fromBrand) return fromBrand;

  const fromGroup = lookupGoal(dim?.byGroup, grupoKey);
  if (fromGroup) return fromGroup;

  if (Number(ctx.operationStandard) > 0) return Number(ctx.operationStandard);
  if (Number(ctx.userHourlyGoal) > 0) return Number(ctx.userHourlyGoal);
  if (Number(ctx.settings?.standard_per_hour_goal) > 0) {
    return Number(ctx.settings!.standard_per_hour_goal);
  }
  return 0;
}

/** Meta ponderada por und según dimensión de cada ítem escaneado. */
export function weightedReceptionHourlyGoal(
  items: Array<{ quantity?: number; reference?: string | null; marca?: string | null; grupo?: string | null }>,
  base: Omit<ReceptionGoalContext, 'reference' | 'marca' | 'grupo'>
): number {
  let weighted = 0;
  let weight = 0;
  for (const it of items) {
    const qty = Number(it.quantity) || 0;
    if (qty <= 0) continue;
    const g = resolveReceptionHourlyGoal({
      ...base,
      reference: it.reference,
      marca: it.marca,
      grupo: it.grupo,
    });
    if (g > 0) {
      weighted += g * qty;
      weight += qty;
    }
  }
  if (weight > 0) return weighted / weight;
  return resolveReceptionHourlyGoal(base);
}

export function sanitizeDimensionalGoalsMap(
  entries: Array<{ key: string; value: number }>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of entries) {
    const key = normKey(row.key);
    const value = Number(row.value);
    if (!key || !Number.isFinite(value) || value <= 0) continue;
    out[key] = value;
  }
  return out;
}

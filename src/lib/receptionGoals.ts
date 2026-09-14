import type { ProductivitySettings, ReceptionDimensionalGoalMaps } from '@/types';
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
  const found = Object.entries(map).find(([k, v]) => normKey(k) === key && Number(v) > 0);
  return found ? Number(found[1]) : undefined;
}

function resolveFromMaps(
  maps: ReceptionDimensionalGoalMaps | undefined,
  refKey: string,
  refNormKey: string,
  marcaKey: string,
  grupoKey: string
): number | undefined {
  if (!maps) return undefined;
  const fromRef =
    lookupGoal(maps.byReference, refKey) ??
    (refNormKey ? lookupGoal(maps.byReference, refNormKey) : undefined);
  if (fromRef) return fromRef;
  const fromBrand = lookupGoal(maps.byBrand, marcaKey);
  if (fromBrand) return fromBrand;
  return lookupGoal(maps.byGroup, grupoKey);
}

export type ReceptionGoalContext = {
  reference?: string | null;
  marca?: string | null;
  grupo?: string | null;
  /** Si se informa, primero busca metas asociadas a esa operación. */
  operationId?: string | null;
  operationStandard?: number | null;
  userHourlyGoal?: number | null;
  settings?: ProductivitySettings | null;
};

/**
 * Prioridad:
 * 1) dimensión de la operación (ref → marca → grupo)
 * 2) dimensión global (ref → marca → grupo)
 * 3) meta de operación → usuario → meta general
 */
export function resolveReceptionHourlyGoal(ctx: ReceptionGoalContext): number {
  const dim = ctx.settings?.receptionDimensionalGoals;
  const refRaw = String(ctx.reference || '').trim();
  const refNorm = refRaw ? normalizeReceptionReference(refRaw) : '';
  const refKey = normKey(refRaw);
  const refNormKey = normKey(refNorm);
  const marcaKey = normKey(ctx.marca);
  const grupoKey = normKey(ctx.grupo);
  const opId = String(ctx.operationId || '').trim();

  if (opId && dim?.byOperationId?.[opId]) {
    const fromOp = resolveFromMaps(dim.byOperationId[opId], refKey, refNormKey, marcaKey, grupoKey);
    if (fromOp) return fromOp;
  }

  const fromGlobal = resolveFromMaps(dim, refKey, refNormKey, marcaKey, grupoKey);
  if (fromGlobal) return fromGlobal;

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

export type DimensionalGoalRow = {
  key: string;
  value: number;
  /** Vacío = aplica a todas las operaciones (global). */
  operationId?: string;
};

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

/** Convierte maps (global + por operación) a filas editables. */
export function dimensionalMapsToRows(
  dim: ProductivitySettings['receptionDimensionalGoals'] | undefined,
  kind: 'byBrand' | 'byGroup' | 'byReference'
): DimensionalGoalRow[] {
  const rows: DimensionalGoalRow[] = [];
  const globalMap = dim?.[kind];
  if (globalMap) {
    for (const [key, value] of Object.entries(globalMap)) {
      if (Number(value) > 0) rows.push({ key, value: Number(value), operationId: '' });
    }
  }
  const byOp = dim?.byOperationId || {};
  for (const [operationId, maps] of Object.entries(byOp)) {
    const map = maps?.[kind];
    if (!map) continue;
    for (const [key, value] of Object.entries(map)) {
      if (Number(value) > 0) rows.push({ key, value: Number(value), operationId });
    }
  }
  return rows.sort((a, b) => {
    const opCmp = (a.operationId || '').localeCompare(b.operationId || '');
    if (opCmp !== 0) return opCmp;
    return a.key.localeCompare(b.key);
  });
}

/** Agrupa filas editables en estructura persistible. */
export function rowsToDimensionalGoalsConfig(input: {
  brandRows: DimensionalGoalRow[];
  groupRows: DimensionalGoalRow[];
  referenceRows: DimensionalGoalRow[];
}): NonNullable<ProductivitySettings['receptionDimensionalGoals']> {
  const byBrand = sanitizeDimensionalGoalsMap(
    input.brandRows.filter((r) => !r.operationId?.trim()).map((r) => ({ key: r.key, value: r.value }))
  );
  const byGroup = sanitizeDimensionalGoalsMap(
    input.groupRows.filter((r) => !r.operationId?.trim()).map((r) => ({ key: r.key, value: r.value }))
  );
  const byReference = sanitizeDimensionalGoalsMap(
    input.referenceRows.filter((r) => !r.operationId?.trim()).map((r) => ({ key: r.key, value: r.value }))
  );

  const byOperationId: Record<string, ReceptionDimensionalGoalMaps> = {};
  const absorb = (rows: DimensionalGoalRow[], kind: keyof ReceptionDimensionalGoalMaps) => {
    for (const row of rows) {
      const opId = String(row.operationId || '').trim();
      if (!opId) continue;
      const key = normKey(row.key);
      const value = Number(row.value);
      if (!key || !Number.isFinite(value) || value <= 0) continue;
      if (!byOperationId[opId]) byOperationId[opId] = {};
      if (!byOperationId[opId][kind]) byOperationId[opId][kind] = {};
      byOperationId[opId][kind]![key] = value;
    }
  };
  absorb(input.brandRows, 'byBrand');
  absorb(input.groupRows, 'byGroup');
  absorb(input.referenceRows, 'byReference');

  return {
    byBrand,
    byGroup,
    byReference,
    ...(Object.keys(byOperationId).length > 0 ? { byOperationId } : {}),
  };
}

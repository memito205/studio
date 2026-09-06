import type {
  StoreCapacityProfile,
  StoreCapacityTotals,
  StoreDrawerCapacity,
  StoreFootwearBoxMixSuggestion,
  StoreFootwearCapacityBreakdown,
  StoreInventoryGrupo,
  StoreInventoryImportRow,
  StoreInventorySnapshot,
} from '@/types';
import { findCaseInsensitiveKey, normalizeHeader } from '@/lib/parsingUtils';

export const DEFAULT_GARMENTS_PER_DRAWER = 100;

export function emptyDrawerRow(partial?: Partial<StoreDrawerCapacity>): StoreDrawerCapacity {
  return {
    id: partial?.id || `d_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    measure: partial?.measure ?? '',
    capacityWithBox: partial?.capacityWithBox ?? 0,
    capacityWithoutBox: partial?.capacityWithoutBox ?? 0,
    drawerCount: partial?.drawerCount ?? 0,
  };
}

export function computeDrawerTotals(drawer: StoreDrawerCapacity): { withBox: number; withoutBox: number } {
  const count = Number(drawer.drawerCount) || 0;
  return {
    withBox: (Number(drawer.capacityWithBox) || 0) * count,
    withoutBox: (Number(drawer.capacityWithoutBox) || 0) * count,
  };
}

export function computeStoreCapacityTotals(drawers: StoreDrawerCapacity[]): StoreCapacityTotals {
  return drawers.reduce<StoreCapacityTotals>(
    (acc, d) => {
      const t = computeDrawerTotals(d);
      acc.totalWithBox += t.withBox;
      acc.totalWithoutBox += t.withoutBox;
      acc.totalDrawers += Number(d.drawerCount) || 0;
      return acc;
    },
    { totalWithBox: 0, totalWithoutBox: 0, totalDrawers: 0 }
  );
}

export function normalizePdvCode(raw: string): string {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

/**
 * Tras restar cajones ocupados por ropa, sugiere cuántos cajones de calzado
 * pueden quedar con caja y cuántos deben ir sin caja para el inventario actual.
 * Prioriza maximizar cajones con caja original.
 */
export function computeFootwearBoxMixSuggestion(args: {
  drawersAvailableForFootwear: number;
  avgCapWithBox: number;
  avgCapWithoutBox: number;
  calzadoPairs: number;
}): StoreFootwearBoxMixSuggestion {
  const available = Math.max(0, Number(args.drawersAvailableForFootwear) || 0);
  const avgWith = Math.max(0, Number(args.avgCapWithBox) || 0);
  const avgWithout = Math.max(0, Number(args.avgCapWithoutBox) || 0);
  const pairs = Math.max(0, Number(args.calzadoPairs) || 0);

  const maxPairsAllWithBox = available * avgWith;
  const maxPairsAllWithoutBox = available * avgWithout;

  const empty: StoreFootwearBoxMixSuggestion = {
    calzadoPairs: pairs,
    drawersAvailableForFootwear: available,
    avgCapWithBox: avgWith,
    avgCapWithoutBox: avgWithout,
    maxPairsAllWithBox,
    maxPairsAllWithoutBox,
    drawersWithBox: 0,
    drawersWithoutBox: 0,
    pairsInWithBox: 0,
    pairsInWithoutBox: 0,
    fitsAllWithBox: true,
    exceedsEvenWithoutBox: false,
    summary: 'Sin calzado a almacenar en cajones.',
  };

  if (pairs <= 0 || available <= 0 || (avgWith <= 0 && avgWithout <= 0)) {
    if (pairs > 0 && available <= 0) {
      return {
        ...empty,
        fitsAllWithBox: false,
        exceedsEvenWithoutBox: true,
        summary: 'No hay cajones libres para calzado (la ropa ocupó el pool).',
      };
    }
    return empty;
  }

  // Todo cabe en caja
  if (avgWith > 0 && pairs <= maxPairsAllWithBox + 1e-9) {
    const drawersWithBox = avgWith > 0 ? pairs / avgWith : 0;
    return {
      ...empty,
      drawersWithBox,
      drawersWithoutBox: 0,
      pairsInWithBox: pairs,
      pairsInWithoutBox: 0,
      fitsAllWithBox: true,
      exceedsEvenWithoutBox: false,
      summary: `El calzado actual (${Math.round(pairs).toLocaleString()} pares) cabe todo en caja: ~${drawersWithBox.toFixed(1)} cajones con caja (de ${available.toFixed(1)} disponibles tras ropa).`,
    };
  }

  // Ni sin caja alcanza
  if (avgWithout <= 0 || pairs > maxPairsAllWithoutBox + 1e-9) {
    return {
      ...empty,
      drawersWithBox: 0,
      drawersWithoutBox: available,
      pairsInWithBox: 0,
      pairsInWithoutBox: maxPairsAllWithoutBox,
      fitsAllWithBox: false,
      exceedsEvenWithoutBox: true,
      summary: `Aun usando los ${available.toFixed(1)} cajones sin caja (máx. ${Math.round(maxPairsAllWithoutBox).toLocaleString()} pares) no alcanza para ${Math.round(pairs).toLocaleString()} pares.`,
    };
  }

  // Mezcla: minimizar cajones sin caja (sin caja suele caber más por cajón).
  const delta = avgWithout - avgWith;
  let drawersWithoutBox = 0;
  if (delta > 1e-9) {
    drawersWithoutBox = (pairs - maxPairsAllWithBox) / delta;
  } else {
    // Capacidad sin caja no aporta más: usar todos sin caja
    drawersWithoutBox = available;
  }
  drawersWithoutBox = Math.min(available, Math.max(0, drawersWithoutBox));
  const drawersWithBox = Math.max(0, available - drawersWithoutBox);
  const pairsInWithBox = drawersWithBox * avgWith;
  const pairsInWithoutBox = Math.max(0, pairs - pairsInWithBox);

  return {
    ...empty,
    drawersWithBox,
    drawersWithoutBox,
    pairsInWithBox,
    pairsInWithoutBox,
    fitsAllWithBox: false,
    exceedsEvenWithoutBox: false,
    summary: `Para ${Math.round(pairs).toLocaleString()} pares (tras restar ropa): ~${drawersWithoutBox.toFixed(1)} cajones SIN caja (~${Math.round(pairsInWithoutBox).toLocaleString()} pares) y ~${drawersWithBox.toFixed(1)} cajones CON caja (~${Math.round(pairsInWithBox).toLocaleString()} pares).`,
  };
}

/**
 * La capacidad de cajones es de calzado. La ropa ocupa cajones a razón de
 * `garmentsPerDrawer` prendas/cajón y reduce el cupo efectivo de calzado.
 * Accesorios no afectan.
 *
 * Exhibición (Outlet): se resta del inventario (sala no consume cajones).
 * Comprometido (pedidos de salida): se resta del inventario (mercancía a sacar).
 */
export function computeFootwearCapacityBreakdown(args: {
  drawers: StoreDrawerCapacity[];
  ropaOnHand: number;
  calzadoOnHand: number;
  calzadoInTransit?: number;
  ropaInTransit?: number;
  garmentsPerDrawer: number;
  exhibitionAffectsCapacity?: boolean;
  exhibitionCalzado?: number;
  exhibitionRopa?: number;
  committedCalzado?: number;
  committedRopa?: number;
}): StoreFootwearCapacityBreakdown {
  const totals = computeStoreCapacityTotals(args.drawers || []);
  const rate = Math.max(1, Number(args.garmentsPerDrawer) || DEFAULT_GARMENTS_PER_DRAWER);

  const exhCalz = args.exhibitionAffectsCapacity
    ? Math.max(0, Number(args.exhibitionCalzado) || 0)
    : 0;
  const exhRopa = args.exhibitionAffectsCapacity
    ? Math.max(0, Number(args.exhibitionRopa) || 0)
    : 0;
  const committedCalz = Math.max(0, Number(args.committedCalzado) || 0);
  const committedRopa = Math.max(0, Number(args.committedRopa) || 0);

  const calzadoOnHand = Math.max(
    0,
    (Number(args.calzadoOnHand) || 0) - exhCalz - committedCalz
  );
  const ropaOnHand = Math.max(0, (Number(args.ropaOnHand) || 0) - exhRopa - committedRopa);
  const calzadoInTransit = Math.max(0, Number(args.calzadoInTransit) || 0);
  const ropaInTransit = Math.max(0, Number(args.ropaInTransit) || 0);

  const ropaForDrawers = ropaOnHand + ropaInTransit;
  const drawersUsedByClothing = ropaForDrawers / rate;
  const drawersAvailableForFootwear = Math.max(0, totals.totalDrawers - drawersUsedByClothing);

  const avgCapWithBox =
    totals.totalDrawers > 0 ? totals.totalWithBox / totals.totalDrawers : 0;
  const avgCapWithoutBox =
    totals.totalDrawers > 0 ? totals.totalWithoutBox / totals.totalDrawers : 0;
  const capacityLostToClothing = drawersUsedByClothing * avgCapWithBox;
  const effectiveCapacityWithBox = Math.max(0, totals.totalWithBox - capacityLostToClothing);

  const occupied = calzadoOnHand + calzadoInTransit;
  const available = effectiveCapacityWithBox - occupied;
  const occupancyPct =
    effectiveCapacityWithBox > 0
      ? (occupied / effectiveCapacityWithBox) * 100
      : occupied > 0
        ? 100
        : 0;

  const boxMix = computeFootwearBoxMixSuggestion({
    drawersAvailableForFootwear,
    avgCapWithBox,
    avgCapWithoutBox,
    calzadoPairs: occupied,
  });

  return {
    totalDrawers: totals.totalDrawers,
    drawersUsedByClothing,
    drawersAvailableForFootwear,
    grossCapacityWithBox: totals.totalWithBox,
    capacityLostToClothing,
    effectiveCapacityWithBox,
    calzadoOnHand,
    calzadoInTransit,
    ropaOnHand,
    ropaInTransit,
    exhibitionCalzadoApplied: exhCalz,
    exhibitionRopaApplied: exhRopa,
    committedCalzadoApplied: committedCalz,
    committedRopaApplied: committedRopa,
    occupied,
    available,
    occupancyPct,
    canReceive: available > 0,
    exceeds: available < 0,
    boxMix,
  };
}

/** @deprecated Prefer computeFootwearCapacityBreakdown */
export function computeFootwearHeadroom(args: {
  totalWithBox: number;
  calzadoOnHand: number;
  calzadoInTransit?: number;
}): {
  occupied: number;
  available: number;
  occupancyPct: number;
  canReceive: boolean;
} {
  const occupied = Math.max(0, (Number(args.calzadoOnHand) || 0) + (Number(args.calzadoInTransit) || 0));
  const cap = Math.max(0, Number(args.totalWithBox) || 0);
  const available = cap - occupied;
  const occupancyPct = cap > 0 ? (occupied / cap) * 100 : 0;
  return {
    occupied,
    available,
    occupancyPct,
    canReceive: available > 0,
  };
}

export function inventoryTotal(snap?: StoreInventorySnapshot | null): number {
  if (!snap) return 0;
  return (Number(snap.accesorios) || 0) + (Number(snap.calzado) || 0) + (Number(snap.ropa) || 0);
}

export function normalizeInventoryGrupo(raw: string): StoreInventoryGrupo | null {
  const n = normalizeHeader(String(raw || ''));
  if (!n) return null;
  if (n.includes('calzado') || n === 'calz' || n.includes('zapato')) return 'calzado';
  if (n.includes('ropa') || n.includes('prenda') || n.includes('textil')) return 'ropa';
  if (n.includes('accesorio') || n.includes('accesor')) return 'accesorios';
  return null;
}

/**
 * Excel global: BODEGA | GRUPO | CANTIDAD | CANT COMPROMETIDA (opcional).
 * Agrupa sumando por bodega+grupo. La comprometida es mercancía a sacar (resta del cupo).
 */
export function parseGlobalInventorySheet(
  rows: Record<string, unknown>[]
): { byBodega: Map<string, StoreInventorySnapshot>; rowCount: number; skipped: number } {
  const byBodega = new Map<string, StoreInventorySnapshot>();
  let rowCount = 0;
  let skipped = 0;
  const now = new Date().toISOString();

  const isCommittedHeader = (key: string) =>
    /compromet|comprimid/i.test(String(key || ''));

  const findQtyKey = (row: Record<string, unknown>): string | undefined => {
    const preferred = findCaseInsensitiveKey(row, 'cantidad', 'cant', 'qty', 'unidades', 'stock');
    if (preferred && !isCommittedHeader(preferred)) return preferred;
    return Object.keys(row).find((k) => {
      const n = normalizeHeader(k);
      return (
        (n === 'cantidad' || n === 'cant' || n.includes('cantidad') || n.includes('stock')) &&
        !isCommittedHeader(k)
      );
    });
  };

  const findCommittedKey = (row: Record<string, unknown>): string | undefined => {
    const preferred = findCaseInsensitiveKey(
      row,
      'cant comprometida',
      'cantidad comprometida',
      'comprometida',
      'comprometido',
      'cant comprimida',
      'cantidad comprimida',
      'comprometidas'
    );
    if (preferred) return preferred;
    return Object.keys(row).find((k) => isCommittedHeader(k));
  };

  const committedField = (grupo: StoreInventoryGrupo): keyof StoreInventorySnapshot => {
    if (grupo === 'calzado') return 'comprometidoCalzado';
    if (grupo === 'ropa') return 'comprometidoRopa';
    return 'comprometidoAccesorios';
  };

  for (const row of rows) {
    const bodegaKey = findCaseInsensitiveKey(row, 'bodega', 'pdv', 'tienda', 'codigo', 'código', 'almacen', 'almacén');
    const grupoKey = findCaseInsensitiveKey(row, 'grupo', 'categoria', 'categoría', 'tipo', 'linea', 'línea');
    const cantKey = bodegaKey && grupoKey ? findQtyKey(row) : undefined;
    const committedKey = findCommittedKey(row);

    if (!bodegaKey || !grupoKey || !cantKey) {
      skipped += 1;
      continue;
    }

    const bodega = normalizePdvCode(String(row[bodegaKey] ?? ''));
    const grupo = normalizeInventoryGrupo(String(row[grupoKey] ?? ''));
    const rawCant = row[cantKey];
    const cantidad = typeof rawCant === 'number' ? rawCant : Number(String(rawCant ?? '').replace(/,/g, ''));

    if (!bodega || !grupo || !Number.isFinite(cantidad)) {
      skipped += 1;
      continue;
    }

    let comprometida = 0;
    if (committedKey) {
      const rawC = row[committedKey];
      const n = typeof rawC === 'number' ? rawC : Number(String(rawC ?? '').replace(/,/g, ''));
      if (Number.isFinite(n) && n > 0) comprometida = n;
    }

    rowCount += 1;
    const prev = byBodega.get(bodega) || {
      accesorios: 0,
      calzado: 0,
      ropa: 0,
      comprometidoAccesorios: 0,
      comprometidoCalzado: 0,
      comprometidoRopa: 0,
      updatedAt: now,
      source: 'global_import' as const,
    };
    prev[grupo] = (Number(prev[grupo]) || 0) + Math.max(0, cantidad);
    if (comprometida > 0) {
      const field = committedField(grupo);
      prev[field] = (Number(prev[field]) || 0) + comprometida;
    }
    prev.updatedAt = now;
    prev.source = 'global_import';
    byBodega.set(bodega, prev);
  }

  return { byBodega, rowCount, skipped };
}

type SheetMatrix = unknown[][];

function cellStr(row: unknown[] | undefined, col: number): string {
  if (!row || col < 0 || col >= row.length) return '';
  const v = row[col];
  if (v == null) return '';
  return String(v).trim();
}

function cellNum(row: unknown[] | undefined, col: number): number {
  const s = cellStr(row, col).replace(/,/g, '');
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function findLabelRow(matrix: SheetMatrix, ...needles: string[]): number {
  const norms = needles.map((n) => n.toLowerCase().replace(/\s+/g, ''));
  for (let r = 0; r < Math.min(matrix.length, 40); r++) {
    const a = cellStr(matrix[r], 0).toLowerCase().replace(/\s+/g, '');
    if (norms.some((n) => a.includes(n))) return r;
  }
  return -1;
}

/**
 * Parsea una hoja estilo "CAPACIDAD DE TIENDAS" (una tienda por hoja).
 * Espera filas con etiquetas CAJON / CAPACIDAD CAJA / SIN CAJA / CANT CAJON,
 * y opcionalmente inventario ACCESORIOS / CALZADO / ROPA.
 */
export function parseStoreCapacitySheet(
  sheetName: string,
  matrix: SheetMatrix
): Omit<StoreCapacityProfile, 'createdAt' | 'updatedAt' | 'updatedBy'> | null {
  if (!matrix?.length) return null;

  let pdvCode = '';
  for (let r = 0; r < Math.min(8, matrix.length); r++) {
    const row = matrix[r] || [];
    for (let c = 0; c < Math.min(row.length, 8); c++) {
      const label = cellStr(row, c).toLowerCase();
      if (label === 'pdv' || label === 'tienda') {
        for (let k = c + 1; k < Math.min(row.length, c + 6); k++) {
          const v = cellStr(row, k);
          if (v && !/^pdv$/i.test(v)) {
            pdvCode = normalizePdvCode(v);
            break;
          }
        }
      }
    }
  }
  if (!pdvCode) {
    pdvCode = normalizePdvCode(sheetName);
  }
  if (!pdvCode) return null;

  const cajonRow = findLabelRow(matrix, 'cajon', 'cajón');
  const capCajaRow = findLabelRow(matrix, 'capacidadcaja', 'capacidad caja');
  const capSinRow = findLabelRow(matrix, 'capacidadsincaja', 'capacidad sin caja', 'sin caja');
  const cantRow = findLabelRow(matrix, 'cantcajon', 'cant cajon', 'cantcajón', 'cantidadcajon');

  const drawers: StoreDrawerCapacity[] = [];
  if (cajonRow >= 0) {
    const measureRow = matrix[cajonRow] || [];
    const maxCol = Math.max(
      measureRow.length,
      (matrix[capCajaRow] || []).length,
      (matrix[capSinRow] || []).length,
      (matrix[cantRow] || []).length
    );
    for (let c = 1; c < maxCol; c++) {
      const measure = cellStr(measureRow, c);
      if (!measure || /total/i.test(measure)) continue;
      const capacityWithBox = capCajaRow >= 0 ? cellNum(matrix[capCajaRow], c) : 0;
      const capacityWithoutBox = capSinRow >= 0 ? cellNum(matrix[capSinRow], c) : 0;
      const drawerCount = cantRow >= 0 ? cellNum(matrix[cantRow], c) : 0;
      if (!capacityWithBox && !capacityWithoutBox && !drawerCount) continue;
      drawers.push(
        emptyDrawerRow({
          measure,
          capacityWithBox,
          capacityWithoutBox,
          drawerCount,
        })
      );
    }
  }

  let accesorios = 0;
  let calzado = 0;
  let ropa = 0;
  let foundInv = false;
  for (let r = 0; r < matrix.length; r++) {
    const label = cellStr(matrix[r], 0).toLowerCase().replace(/\s+/g, '');
    if (label === 'accesorios' || label.includes('accesorio')) {
      accesorios = cellNum(matrix[r], 1);
      foundInv = true;
    } else if (label === 'calzado' || label.includes('calzado')) {
      calzado = cellNum(matrix[r], 1);
      foundInv = true;
    } else if (label === 'ropa' || label.includes('ropa')) {
      ropa = cellNum(matrix[r], 1);
      foundInv = true;
    }
  }

  const inventorySnapshot: StoreInventorySnapshot | undefined = foundInv
    ? {
        accesorios,
        calzado,
        ropa,
        updatedAt: new Date().toISOString(),
        source: 'import',
      }
    : undefined;

  return {
    id: pdvCode,
    pdvCode,
    pdvName: sheetName.trim() !== pdvCode ? sheetName.trim() : undefined,
    drawers,
    inventorySnapshot,
    active: true,
    notes: undefined,
  };
}

export type { StoreInventoryImportRow };

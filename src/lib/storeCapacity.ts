import type { StoreCapacityProfile, StoreCapacityTotals, StoreDrawerCapacity, StoreInventorySnapshot } from '@/types';

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

/** Capacidad libre de calzado (modo con caja) vs inventario + en tránsito. */
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
  // Buscar celda PDV cerca del encabezado
  for (let r = 0; r < Math.min(8, matrix.length); r++) {
    const row = matrix[r] || [];
    for (let c = 0; c < Math.min(row.length, 8); c++) {
      const label = cellStr(row, c).toLowerCase();
      if (label === 'pdv' || label === 'tienda') {
        // Valor suele estar a la derecha (a veces saltando columnas)
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

  // Inventario: buscar filas ACCESORIOS / CALZADO / ROPA
  let accesorios = 0;
  let calzado = 0;
  let ropa = 0;
  let foundInv = false;
  for (let r = 0; r < matrix.length; r++) {
    const label = cellStr(matrix[r], 0).toLowerCase().replace(/\s+/g, '');
    // Cantidad suele estar en col B (índice 1)
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

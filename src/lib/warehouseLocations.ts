import type { WarehouseLocationConfig } from '@/types';

export const EMPTY_WAREHOUSE_LOCATION_CONFIG: WarehouseLocationConfig = { codes: [], prefixes: {} };

export const normalizeLocationCode = (value: unknown): string =>
  String(value ?? '').trim().toUpperCase().replace(/\s+/g, ' ');

export const normalizeLocationDestino = (value: unknown): string =>
  String(value ?? '').trim().toUpperCase();

/** Ubicaciones del maestro cuyo código empieza por alguno de los prefijos del destino. */
export function suggestLocationsForDestino(
  config: WarehouseLocationConfig,
  destino: string | undefined
): string[] {
  const dest = normalizeLocationDestino(destino);
  if (!dest) return [];
  const prefixes = (config.prefixes[dest] || []).map(normalizeLocationCode).filter(Boolean);
  if (prefixes.length === 0) return [];
  return config.codes.filter((code) => prefixes.some((p) => code.startsWith(p)));
}

export function suggestLocationsForDestinos(
  config: WarehouseLocationConfig,
  destinos: Array<string | undefined>
): string[] {
  const out = new Set<string>();
  destinos.forEach((d) => suggestLocationsForDestino(config, d).forEach((c) => out.add(c)));
  return Array.from(out);
}

/**
 * Lee las ubicaciones de una hoja (filas como arreglos). Usa la columna cuyo encabezado
 * contenga "UBICACI"; si no hay, la primera columna.
 */
export function parseLocationRows(rows: unknown[][]): string[] {
  if (rows.length === 0) return [];
  const header = (rows[0] || []).map((h) => normalizeLocationCode(h));
  const headerIdx = header.findIndex((h) => h.includes('UBICACI'));
  const colIdx = headerIdx >= 0 ? headerIdx : 0;
  const startRow = headerIdx >= 0 ? 1 : 0;
  const codes = new Set<string>();
  for (let i = startRow; i < rows.length; i++) {
    const code = normalizeLocationCode((rows[i] || [])[colIdx]);
    if (code) codes.add(code);
  }
  return Array.from(codes).sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
}

/** "208-, 209-" → ["208-", "209-"] */
export const parsePrefixList = (value: string): string[] =>
  Array.from(
    new Set(
      String(value || '')
        .split(/[,;\s]+/)
        .map(normalizeLocationCode)
        .filter(Boolean)
    )
  );

const WEEKDAYS_ES = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];

export const weekdayShortEs = (date: Date): string => WEEKDAYS_ES[date.getDay()] || '';

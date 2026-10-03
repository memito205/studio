import type { DeliveryStore } from '@/types';

export const DEFAULT_STORE_RADIUS_M = 300;

/** Columnas de la plantilla, en orden. `key` es el campo de DeliveryStore que alimenta. */
export const STORE_TEMPLATE_COLUMNS = [
  { header: 'Codigo ERP', required: true, example: '21101' },
  { header: 'Nombre corto', required: true, example: 'BR 11' },
  { header: 'Nombre tienda', required: true, example: 'Tienda Centro Comercial X' },
  { header: 'Ciudad', required: true, example: 'Medellín' },
  { header: 'Direccion', required: true, example: 'Cra 43A # 1-50, local 210' },
  { header: 'Latitud', required: true, example: '6.200512' },
  { header: 'Longitud', required: true, example: '-75.574123' },
  { header: 'Codigos equivalentes', required: false, example: 'B11, 211, BR11' },
  { header: 'Radio validacion (m)', required: false, example: '300' },
  { header: 'Dias de visita', required: false, example: 'L, X, V' },
  { header: 'Horario de recibo', required: false, example: '8:00-11:00' },
  { header: 'Telefono tienda', required: false, example: '3001234567' },
  { header: 'Quienes reciben', required: false, example: 'Ana Gómez; Luis Ríos' },
  { header: 'Notas de acceso', required: false, example: 'Muelle por la calle 10' },
  { header: 'Activo', required: true, example: 'SI' },
] as const;

export const normalizeStoreCode = (v: unknown) => String(v ?? '').toUpperCase().replace(/\s+/g, '').trim();

const normHeader = (h: string) =>
  h
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

const splitList = (v: unknown, sep: RegExp) =>
  String(v ?? '')
    .split(sep)
    .map((s) => s.trim())
    .filter(Boolean);

const parseNumber = (v: unknown): number | null => {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

const parseBool = (v: unknown) => {
  const s = normHeader(String(v ?? ''));
  if (!s) return true;
  return !['NO', 'N', 'FALSE', '0', 'INACTIVO'].includes(s);
};

export type StoreRowIssue = { row: number; codigo: string; errors: string[]; warnings: string[] };

/** Convierte filas de Excel (objetos por encabezado) en tiendas + errores por fila. */
export function parseStoreRows(rows: Record<string, unknown>[]): { stores: DeliveryStore[]; issues: StoreRowIssue[] } {
  const stores: DeliveryStore[] = [];
  const issues: StoreRowIssue[] = [];
  const seen = new Set<string>();

  rows.forEach((raw, idx) => {
    const byHeader = new Map<string, unknown>();
    Object.entries(raw).forEach(([k, v]) => byHeader.set(normHeader(k), v));
    const get = (header: string) => byHeader.get(normHeader(header));

    const codigoErp = normalizeStoreCode(get('Codigo ERP'));
    const rowNum = idx + 2;
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!codigoErp && Object.values(raw).every((v) => String(v ?? '').trim() === '')) return;

    if (!codigoErp) errors.push('Falta Codigo ERP');
    else if (seen.has(codigoErp)) errors.push('Codigo ERP repetido en el archivo');
    seen.add(codigoErp);

    const nombreCorto = String(get('Nombre corto') ?? '').trim();
    const nombreTienda = String(get('Nombre tienda') ?? '').trim();
    const ciudad = String(get('Ciudad') ?? '').trim();
    const direccion = String(get('Direccion') ?? '').trim();
    if (!nombreCorto) errors.push('Falta Nombre corto');
    if (!nombreTienda) warnings.push('Sin Nombre tienda');
    if (!ciudad) warnings.push('Sin Ciudad');
    if (!direccion) warnings.push('Sin Direccion');

    const latitud = parseNumber(get('Latitud'));
    const longitud = parseNumber(get('Longitud'));
    if (latitud === null || longitud === null) {
      warnings.push('Sin coordenadas: no se podrá validar distancia');
    } else if (latitud < -5 || latitud > 14 || longitud < -82 || longitud > -66) {
      errors.push('Coordenadas fuera de Colombia (¿latitud y longitud invertidas o sin signo negativo?)');
    }

    const radio = parseNumber(get('Radio validacion (m)'));
    const equivalentes = splitList(get('Codigos equivalentes'), /[,;|]/).map(normalizeStoreCode);

    if (errors.length || warnings.length) issues.push({ row: rowNum, codigo: codigoErp, errors, warnings });
    if (errors.length) return;

    const optional = (h: string) => {
      const s = String(get(h) ?? '').trim();
      return s || undefined;
    };

    stores.push({
      id: codigoErp,
      codigoErp,
      nombreCorto,
      nombreTienda,
      ciudad,
      direccion,
      latitud,
      longitud,
      codigosEquivalentes: Array.from(new Set(equivalentes.filter((c) => c && c !== codigoErp))),
      radioValidacionM: radio && radio > 0 ? Math.round(radio) : DEFAULT_STORE_RADIUS_M,
      diasVisita: optional('Dias de visita'),
      horarioRecibo: optional('Horario de recibo'),
      telefono: optional('Telefono tienda'),
      quienesReciben: splitList(get('Quienes reciben'), /[;|\n]/),
      notasAcceso: optional('Notas de acceso'),
      activo: parseBool(get('Activo')),
    });
  });

  return { stores, issues };
}

/** Busca la tienda de un destino de TF por código ERP, nombre corto o códigos equivalentes. */
export function buildStoreMatcher(stores: DeliveryStore[]) {
  const map = new Map<string, DeliveryStore>();
  stores.forEach((s) => {
    [s.codigoErp, s.nombreCorto, ...s.codigosEquivalentes].forEach((c) => {
      const k = normalizeStoreCode(c);
      if (k && !map.has(k)) map.set(k, s);
    });
  });
  return (destino: unknown): DeliveryStore | undefined => map.get(normalizeStoreCode(destino));
}

export function storeToTemplateRow(s: DeliveryStore): Record<string, string | number> {
  return {
    'Codigo ERP': s.codigoErp,
    'Nombre corto': s.nombreCorto,
    'Nombre tienda': s.nombreTienda,
    Ciudad: s.ciudad,
    Direccion: s.direccion,
    Latitud: s.latitud ?? '',
    Longitud: s.longitud ?? '',
    'Codigos equivalentes': s.codigosEquivalentes.join(', '),
    'Radio validacion (m)': s.radioValidacionM,
    'Dias de visita': s.diasVisita || '',
    'Horario de recibo': s.horarioRecibo || '',
    'Telefono tienda': s.telefono || '',
    'Quienes reciben': s.quienesReciben.join('; '),
    'Notas de acceso': s.notasAcceso || '',
    Activo: s.activo ? 'SI' : 'NO',
  };
}

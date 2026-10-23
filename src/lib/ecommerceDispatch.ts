/** Destinos que salen de BODVI. El resto de tiendas no usa este despacho. */
export const ECOM_DISPATCH_BODEGA = 'BODVI';

export const ECOM_DISPATCH_DESTINOS = ['BRANCHOS', 'ADDI', 'MLB', 'DAF', 'FALABELLA'] as const;

export type EcomDispatchDestino = (typeof ECOM_DISPATCH_DESTINOS)[number];

export const isEcomDispatchDestino = (value: string): value is EcomDispatchDestino =>
  (ECOM_DISPATCH_DESTINOS as readonly string[]).includes(value.trim().toUpperCase());

export const orderMatchesDispatchDestino = (tienda: string, destino: string) =>
  String(tienda || '').toUpperCase().includes(destino.trim().toUpperCase());

/** Día calendario en Bogotá (YYYY-MM-DD) para agrupar la búsqueda sin índice compuesto. */
export const bogotaDayKey = (d: Date): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  return parts;
};

export const ecomDispatchDestDay = (destino: string, day: string) =>
  `${destino.trim().toUpperCase()}|${day}`;

/** Encabezados de guía del reporte, del más específico al genérico. */
export const ECOM_GUIDE_HEADER_ALIASES = [
  'PED_GUIA_TTE',
  'GUIA SIOP',
  'GUIA TTE',
  'PED_GUIA',
  'NRO GUIA',
  'N° GUIA',
  'Nº GUIA',
  'NUMERO DE GUIA',
  'NUMERO GUIA',
  'NUMERO 99',
  'GUIA',
] as const;

/**
 * Misma guía aunque el lector o Excel cambien espacios o guiones.
 * Los ceros a la izquierda se conservan: Envia siempre empieza en cero.
 */
export const normalizeEcommerceGuide = (value: unknown): string => {
  let guide = String(value ?? '').trim();
  if (!guide || guide.toLowerCase() === 'null' || guide.toLowerCase() === 'undefined') return '';
  guide = guide.replace(/[\s\-_/\\]/g, '').toUpperCase();
  guide = guide.replace(/\.0+$/g, '');
  return guide;
};

/** Texto de la celda. Si Excel la muestra con ceros (0123), se usa ese texto. */
export const ecommerceGuideText = (value: unknown, formatted?: string): string => {
  const shown = String(formatted ?? '').trim();
  if (shown && !/[eE]\+/.test(shown)) return shown.replace(/\.0+$/, '');
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Number.isInteger(value) ? value : value).replace(/\.0+$/, '');
  }
  return String(value ?? '').trim();
};

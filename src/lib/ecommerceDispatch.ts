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

/** Misma guía aunque el lector o Excel cambien espacios, guiones o ceros a la izquierda. */
export const normalizeEcommerceGuide = (value: unknown): string => {
  let guide = String(value ?? '').trim();
  if (!guide || guide.toLowerCase() === 'null' || guide.toLowerCase() === 'undefined') return '';
  guide = guide.replace(/[\s\-_/\\]/g, '').toUpperCase();
  guide = guide.replace(/\.0+$/g, '');
  if (/^\d+$/.test(guide)) guide = guide.replace(/^0+/, '');
  return guide;
};

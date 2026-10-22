/**
 * Normalización única para referencias en recepción (stats en Firestore, reportes Excel,
 * vista consolidada). Evita duplicar totales por diferencias de mayúsculas o barras en la ref.
 */
export function normalizeReceptionReference(ref: string | undefined | null): string {
  const s = String(ref ?? '').trim();
  if (!s) return 'UNKNOWN';
  return s.replace(/\//g, '-').toUpperCase();
}

export function normalizeReceptionSize(size: string | undefined | null): string {
  const s = String(size ?? '').trim();
  if (!s) return 'N/A';
  return s.toUpperCase();
}

/** Esperado cargado solo por referencia (sin código ni talla). No es un código de barras real. */
export const RECEPTION_REF_ONLY_BARCODE_PREFIX = 'POR-REF:';

export function receptionRefOnlyBarcode(ref: string | undefined | null): string {
  return `${RECEPTION_REF_ONLY_BARCODE_PREFIX}${normalizeReceptionReference(ref)}`;
}

export function isReceptionRefOnlyBarcode(barcode: string | undefined | null): boolean {
  return String(barcode || '').startsWith(RECEPTION_REF_ONLY_BARCODE_PREFIX);
}

/** Clave estable para cruzar esperado vs leído por referencia + talla */
export function receptionRefSizeKey(
  ref: string | undefined | null,
  talla: string | undefined | null
): string {
  return `${normalizeReceptionReference(ref)}|${normalizeReceptionSize(talla)}`;
}

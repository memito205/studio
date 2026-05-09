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

/** Clave estable para cruzar esperado vs leído por referencia + talla */
export function receptionRefSizeKey(
  ref: string | undefined | null,
  talla: string | undefined | null
): string {
  return `${normalizeReceptionReference(ref)}|${normalizeReceptionSize(talla)}`;
}

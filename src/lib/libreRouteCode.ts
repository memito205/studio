/** Código MSJ-AAAAMMDD-### de un envío sin TF. Vacío si no es ese código. */
export function normalizeLibreRouteCode(raw: string): string {
  const compact = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  const m = compact.match(/^MSJ-?(\d{8})-?(\d{1,4})$/);
  if (!m) return '';
  return `MSJ-${m[1]}-${m[2].padStart(3, '0')}`;
}

/**
 * Código visible del envío sin TF (el de la columna TF, ej. 1669491421137-01).
 * Un número corto (8389, 106322) sigue siendo una TF de plataforma.
 */
export function isExternalLibreCode(raw: string): boolean {
  const compact = String(raw || '').trim().replace(/\s+/g, '');
  if (!compact || normalizeLibreRouteCode(compact)) return false;
  const body = compact.replace(/^TF-?/i, '');
  if (/^\d+$/.test(body) && body.length < 10) return false;
  if (body.replace(/\D/g, '').length >= 10) return true;
  return /[^0-9]/.test(body);
}

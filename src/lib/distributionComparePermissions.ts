/**
 * Permiso «Por validar» / Validar-Rechazar en Físico vs Distribución.
 * Admin/supervisor siempre; operarios vía flag Firestore o allowlist de email.
 */

/** Fallback mientras se confirma el flag en users/{uid}. */
export const DISTRIBUTION_PENDING_VALIDATION_EMAIL_ALLOWLIST = new Set([
  'sosansa1211@gmail.com',
]);

export function coercePermissionFlag(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

export function emailAllowsPendingValidation(email: string | null | undefined): boolean {
  const e = String(email || '')
    .trim()
    .toLowerCase();
  return e.length > 0 && DISTRIBUTION_PENDING_VALIDATION_EMAIL_ALLOWLIST.has(e);
}

export function userDocAllowsPendingValidation(d: {
  role?: string;
  email?: string;
  canViewDistributionPendingValidation?: unknown;
}): boolean {
  const role = String(d.role || '')
    .trim()
    .toLowerCase();
  if (role === 'admin' || role === 'supervisor') return true;
  if (coercePermissionFlag(d.canViewDistributionPendingValidation)) return true;
  if (emailAllowsPendingValidation(d.email)) return true;
  return false;
}

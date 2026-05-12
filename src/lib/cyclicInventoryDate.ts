const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Fecha de inventario en calendario (AAAA-MM-DD), sin zona horaria de negocio. */
export function isValidInventoryDateKey(s: string): boolean {
  const t = String(s || '').trim();
  if (!YMD_RE.test(t)) return false;
  const [y, m, d] = t.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

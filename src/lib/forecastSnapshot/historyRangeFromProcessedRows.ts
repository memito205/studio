import type { ProcessedRow } from '@/types';

/** Rango yyyy-MM-dd del histórico cargado (min/max fecha en filas procesadas). */
export function historyRangeFromProcessedRows(rows: ProcessedRow[]): { from: string; to: string } | undefined {
  if (!rows?.length) return undefined;
  let minT = Infinity;
  let maxT = -Infinity;
  for (const r of rows) {
    const d = r.date instanceof Date ? r.date : new Date(r.date as unknown as string);
    const t = d.getTime();
    if (!Number.isNaN(t)) {
      minT = Math.min(minT, t);
      maxT = Math.max(maxT, t);
    }
  }
  if (!Number.isFinite(minT) || !Number.isFinite(maxT)) return undefined;
  const pad = (n: number) => String(n).padStart(2, '0');
  const toYmd = (ms: number) => {
    const x = new Date(ms);
    return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  };
  return { from: toYmd(minT), to: toYmd(maxT) };
}

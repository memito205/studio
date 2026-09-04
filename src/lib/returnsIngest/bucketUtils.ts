import type { ContraentregaFlag, Transaction } from '@/types';
import { TransactionType } from '@/types';
import type { ReturnsBucketDoc } from './types';

/** Fecha local YYYY-MM-DD (por si se necesita granularidad diaria en otro flujo). */
export function transactionLocalDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Mes local `YYYY-MM` — misma granularidad que los reportes del módulo (mensual). */
export function transactionLocalMonthKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Primer instante del mes siguiente (clave exclusiva alta para rangos en Firestore). */
export function nextCalendarMonthKey(ym: string): string {
  const m = ym.match(/^(\d{4})-(\d{2})$/);
  if (!m) return `${ym}~`;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (!y || mo < 1 || mo > 12) return `${ym}~`;
  const next = new Date(y, mo, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
}

function contraentregaBucketValue(row: Transaction): string {
  return row.contraentrega === 'SI' || row.contraentrega === 'NO' ? row.contraentrega : '';
}

function bucketAggregateKey(row: Transaction): string {
  return JSON.stringify({
    month: transactionLocalMonthKey(row.date),
    type: row.type,
    pdv: row.pdv,
    brand: row.brand,
    gender: row.gender,
    group: row.group,
    rr: row.returnReason ?? '',
    reference: row.reference,
    ce: contraentregaBucketValue(row),
  });
}

export function transactionsToBucketDocs(rows: Transaction[]): ReturnsBucketDoc[] {
  const map = new Map<
    string,
    {
      dayKey: string;
      type: string;
      pdv: string;
      brand: string;
      gender: string;
      group: string;
      returnReason: string;
      reference: string;
      contraentrega: string;
      lineCount: number;
      sumValue: number;
      sumQuantity: number;
    }
  >();

  for (const row of rows) {
    const key = bucketAggregateKey(row);
    const dayKey = transactionLocalMonthKey(row.date);
    const cur =
      map.get(key) ??
      {
        dayKey,
        type: row.type,
        pdv: row.pdv,
        brand: row.brand,
        gender: row.gender,
        group: row.group,
        returnReason: row.returnReason ?? '',
        reference: row.reference,
        contraentrega: contraentregaBucketValue(row),
        lineCount: 0,
        sumValue: 0,
        sumQuantity: 0,
      };
    cur.lineCount += 1;
    cur.sumValue += Number(row.value) || 0;
    cur.sumQuantity += Number(row.quantity) || 0;
    map.set(key, cur);
  }

  return Array.from(map.values()).map((b) => ({
    dayKey: b.dayKey,
    type: b.type,
    pdv: b.pdv,
    brand: b.brand,
    gender: b.gender,
    group: b.group,
    returnReason: b.returnReason,
    reference: b.reference,
    contraentrega: b.contraentrega,
    lineCount: b.lineCount,
    sumValue: b.sumValue,
    sumQuantity: b.sumQuantity,
  }));
}

/** Convierte clave guardada en `dayKey`: mensual `YYYY-MM` o legado diario `YYYY-MM-DD`. */
function parseBucketKeyToDate(dayKey: string): Date {
  const parts = dayKey.split('-').map(Number);
  if (parts.length === 2 && parts[0] && parts[1] >= 1 && parts[1] <= 12) {
    const [y, m] = parts;
    return new Date(y, m - 1, 1, 12, 0, 0, 0);
  }
  const [y, m, d] = parts;
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function parseContraentregaFromBucket(raw: string | undefined): ContraentregaFlag | null {
  if (raw === 'SI' || raw === 'NO') return raw;
  return null;
}

export function bucketDocsToTransactions(buckets: ReturnsBucketDoc[]): Transaction[] {
  const out: Transaction[] = [];
  for (const b of buckets) {
    const baseDate = parseBucketKeyToDate(b.dayKey);
    const lineCount = Math.max(0, Math.floor(b.lineCount));
    const v = lineCount > 0 ? b.sumValue / lineCount : 0;
    const q = lineCount > 0 ? b.sumQuantity / lineCount : 0;
    const contraentrega = parseContraentregaFromBucket(b.contraentrega);
    for (let i = 0; i < lineCount; i++) {
      const docType =
        b.type === TransactionType.Return || b.type === 'NCE'
          ? TransactionType.Return
          : TransactionType.Sale;
      out.push({
        date: new Date(baseDate),
        type: docType,
        value: v,
        quantity: q,
        brand: b.brand,
        gender: b.gender as Transaction['gender'],
        group: b.group as Transaction['group'],
        returnReason:
          b.returnReason === '' || b.returnReason === 'null'
            ? null
            : (b.returnReason as Transaction['returnReason']),
        pdv: b.pdv,
        reference: b.reference,
        contraentrega,
      });
    }
  }
  return out;
}

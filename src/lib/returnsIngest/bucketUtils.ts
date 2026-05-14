import type { Transaction } from '@/types';
import { TransactionType } from '@/types';
import type { ReturnsBucketDoc } from './types';

/** Fecha local YYYY-MM-DD (alineado a cómo agrupa el dashboard por `Date` local). */
export function transactionLocalDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function bucketAggregateKey(row: Transaction): string {
  return JSON.stringify({
    day: transactionLocalDayKey(row.date),
    type: row.type,
    pdv: row.pdv,
    brand: row.brand,
    gender: row.gender,
    group: row.group,
    rr: row.returnReason ?? '',
    reference: row.reference,
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
      lineCount: number;
      sumValue: number;
      sumQuantity: number;
    }
  >();

  for (const row of rows) {
    const key = bucketAggregateKey(row);
    const dayKey = transactionLocalDayKey(row.date);
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
    lineCount: b.lineCount,
    sumValue: b.sumValue,
    sumQuantity: b.sumQuantity,
  }));
}

function parseDayKeyToDate(dayKey: string): Date {
  const [y, m, d] = dayKey.split('-').map(Number);
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function bucketDocsToTransactions(buckets: ReturnsBucketDoc[]): Transaction[] {
  const out: Transaction[] = [];
  for (const b of buckets) {
    const baseDate = parseDayKeyToDate(b.dayKey);
    const lineCount = Math.max(0, Math.floor(b.lineCount));
    const v = lineCount > 0 ? b.sumValue / lineCount : 0;
    const q = lineCount > 0 ? b.sumQuantity / lineCount : 0;
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
      });
    }
  }
  return out;
}

'use server';

import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { firestore } from '@/services/firebase';

/** Precio Firestore (USD por 100.000 lecturas) y cuota gratis diaria. Ajustar si cambia la región/tarifa. */
const USD_PER_100K_READS = 0.06;
const FREE_READS_PER_DAY = 50_000;

export type UsageQueryRow = { key: string; side: 'servidor' | 'navegador'; calls: number; docs: number };
export type UsageDay = {
  day: string;
  total: number;
  servidor: number;
  navegador: number;
  estUsd: number;
  top: UsageQueryRow[];
};

const bogotaDay = (ms = Date.now()) => new Date(ms - 5 * 3600 * 1000).toISOString().slice(0, 10);
const estUsd = (reads: number) => (Math.max(0, reads - FREE_READS_PER_DAY) / 100_000) * USD_PER_100K_READS;

/** Suma los 20 shards de `readMeter` de un día. */
async function computeDay(day: string): Promise<UsageDay> {
  const snap = await getDocs(query(collection(firestore, 'readMeter'), where('day', '==', day)));
  const byKey = new Map<string, UsageQueryRow>();
  let servidor = 0;
  let navegador = 0;
  snap.forEach((d) => {
    const v = d.data() as { q?: Record<string, { calls?: number; docs?: number }>; servidor?: number; navegador?: number };
    servidor += Number(v.servidor || 0);
    navegador += Number(v.navegador || 0);
    Object.entries(v.q || {}).forEach(([k, s]) => {
      const side = k.startsWith('navegador|') ? 'navegador' : 'servidor';
      const key = k.replace(/^(servidor|navegador)\|/, '');
      const id = `${side}|${key}`;
      const cur = byKey.get(id) || { key, side, calls: 0, docs: 0 };
      cur.calls += Number(s.calls || 0);
      cur.docs += Number(s.docs || 0);
      byKey.set(id, cur);
    });
  });
  const top = Array.from(byKey.values()).sort((a, b) => b.docs - a.docs).slice(0, 25);
  const total = servidor + navegador || top.reduce((s, r) => s + r.docs, 0);
  return { day, total, servidor, navegador, estUsd: Number(estUsd(total).toFixed(3)), top };
}

/**
 * Consumo de lecturas por día (medidor `readMeter`). Los días cerrados se resumen una vez en
 * `readMeterDaily/{día}` (1 lectura por día después); hoy siempre se recalcula (~20 lecturas).
 * Lecturas por apertura: ~20 (hoy) + 1 por día anterior ya resumido.
 */
export async function getUsageDays(days = 14): Promise<{ data?: UsageDay[]; error?: string }> {
  try {
    const today = bogotaDay();
    const keys = Array.from({ length: Math.min(31, Math.max(1, days)) }, (_, i) => bogotaDay(Date.now() - i * 86_400_000));
    const out: UsageDay[] = [];
    for (const day of keys) {
      if (day === today) {
        out.push(await computeDay(day));
        continue;
      }
      const ref = doc(firestore, 'readMeterDaily', day);
      const cached = await getDoc(ref);
      if (cached.exists()) {
        out.push(cached.data() as UsageDay);
        continue;
      }
      const computed = await computeDay(day);
      out.push(computed);
      await setDoc(ref, computed).catch(() => undefined);
    }
    return { data: out };
  } catch (error: any) {
    return { error: error?.message || 'No se pudo leer el consumo.' };
  }
}

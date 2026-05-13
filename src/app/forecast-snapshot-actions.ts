'use server';

import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  Timestamp,
} from 'firebase/firestore';
import { firestore } from '@/services/firebase';
import { safeParseForecastRunPayload } from '@/lib/forecastSnapshot/validateForecastRunPayload';
import type { ForecastRunPayloadV1 } from '@/lib/forecastSnapshot/types';
import {
  SUPPLY_FORECAST_RUNS_COL,
  type GetForecastRunResult,
  type ListForecastRunsResult,
  type SaveForecastRunSnapshotResult,
} from '@/lib/forecastSnapshot/supplyForecastRunsMeta';

/**
 * Persiste un payload ya armado (p. ej. con `buildForecastRunPayload`).
 * No ejecuta el motor de pronóstico ni lee archivos de consumo.
 */
export async function saveForecastRunSnapshot(payload: unknown): Promise<SaveForecastRunSnapshotResult> {
  try {
    if (!firestore) {
      return { success: false, error: 'Firestore no está inicializado (revisar configuración en firebase.ts).' };
    }
    const parsed = safeParseForecastRunPayload(payload);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      return { success: false, error: msg || 'Payload inválido' };
    }
    const data = parsed.data as ForecastRunPayloadV1;
    if (data.header.itemCount !== data.forecastByItem.length) {
      return {
        success: false,
        error: `itemCount (${data.header.itemCount}) no coincide con forecastByItem.length (${data.forecastByItem.length}).`,
      };
    }
    if (data.header.distributionLineCount !== data.distributionByBodegaItem.length) {
      return {
        success: false,
        error: `distributionLineCount (${data.header.distributionLineCount}) no coincide con distributionByBodegaItem.length (${data.distributionByBodegaItem.length}).`,
      };
    }

    const docRef = await addDoc(collection(firestore, SUPPLY_FORECAST_RUNS_COL), {
      header: data.header,
      forecastByItem: data.forecastByItem,
      distributionByBodegaItem: data.distributionByBodegaItem,
      persistedAt: Timestamp.now(),
    });
    return { success: true, id: docRef.id };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error al guardar la corrida.';
    console.error('[saveForecastRunSnapshot]', e);
    return { success: false, error: msg };
  }
}

/** Lista las corridas más recientes (para historial / depuración). */
export async function listSupplyForecastRuns(max: number = 30): Promise<ListForecastRunsResult> {
  try {
    if (!firestore) {
      return { success: false, error: 'Firestore no está inicializado.' };
    }
    const cap = Math.min(Math.max(1, max), 100);
    const q = query(
      collection(firestore, SUPPLY_FORECAST_RUNS_COL),
      orderBy('persistedAt', 'desc'),
      limit(cap)
    );
    const snap = await getDocs(q);
    const items = snap.docs.map((d) => {
      const raw = d.data() as {
        header?: { generationDateIso?: string; itemCount?: number };
        persistedAt?: { toMillis: () => number };
      };
      const persistedAt = raw.persistedAt;
      const ms = typeof persistedAt?.toMillis === 'function' ? persistedAt.toMillis() : 0;
      return {
        id: d.id,
        generationDateIso: String(raw.header?.generationDateIso ?? ''),
        itemCount: Number(raw.header?.itemCount ?? 0),
        persistedAtMs: ms,
      };
    });
    return { success: true, items };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error al listar corridas.';
    if (String(msg).includes('failed-precondition') || String(msg).includes('index')) {
      return {
        success: false,
        error:
          'Firestore requiere índice para supplyForecastRuns ordenado por persistedAt. Cree el índice compuesto que sugiere la consola de Firebase.',
      };
    }
    console.error('[listSupplyForecastRuns]', e);
    return { success: false, error: msg };
  }
}

export async function getSupplyForecastRun(id: string): Promise<GetForecastRunResult> {
  try {
    if (!firestore) {
      return { success: false, error: 'Firestore no está inicializado.' };
    }
    const sid = String(id || '').trim();
    if (!sid) return { success: false, error: 'Id inválido.' };
    const snap = await getDoc(doc(firestore, SUPPLY_FORECAST_RUNS_COL, sid));
    if (!snap.exists()) {
      return { success: false, error: 'Corrida no encontrada.' };
    }
    return { success: true, id: snap.id, data: snap.data() as Record<string, unknown> };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error al leer la corrida.';
    console.error('[getSupplyForecastRun]', e);
    return { success: false, error: msg };
  }
}

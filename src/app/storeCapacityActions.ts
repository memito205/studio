'use server';

import { collection, deleteDoc, doc, getDoc, getDocs, limit, query, setDoc, where, writeBatch } from 'firebase/firestore';
import { firestore } from '@/services/firebase';
import type {
  StoreCapacityDailyHistory,
  StoreCapacityForecast,
  StoreCapacityProfile,
  StoreCapacitySettings,
  StoreCediEnProcesoSnapshot,
  StoreDrawerCapacity,
  StoreInboundQuantities,
  StoreInventorySnapshot,
  TransferEntry,
  TransferStatus,
  TfPlatformStatusRecord,
} from '@/types';
import { DEFAULT_GARMENTS_PER_DRAWER, normalizeInventoryGrupo, normalizePdvCode } from '@/lib/storeCapacity';

const COLLECTION = 'storeCapacityProfiles';
const SETTINGS_COLLECTION = 'storeCapacitySettings';
const SETTINGS_DOC_ID = 'global';
const HISTORY_COLLECTION = 'storeCapacityDailyHistory';
const TRANSFERS_COLLECTION = 'transfers';
const TF_PLATFORM_STATUS_COLLECTION = 'tf_platform_status';

const DEFAULT_FORECAST_HORIZON_DAYS = 7;
const DEFAULT_FORECAST_LOOKBACK_DAYS = 14;

/** Estados operativos que ocupan cupo futuro en destino. */
const INBOUND_TRANSFER_STATUSES: TransferStatus[] = [
  'En Tránsito',
  'Recibido en Bodega',
  'Enviado a Destino',
];

function stripUndefinedDeep(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => stripUndefinedDeep(item))
      .filter((item) => item !== undefined);
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined) continue;
    const cleaned = stripUndefinedDeep(v);
    if (cleaned !== undefined) out[k] = cleaned;
  }
  return out;
}

function localDateKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function upsertDailyHistoryPoint(
  pdvCode: string,
  snap: { calzado: number; ropa: number },
  source: StoreCapacityDailyHistory['source']
) {
  const date = localDateKey();
  const id = `${pdvCode}_${date}`;
  const row: StoreCapacityDailyHistory = {
    id,
    pdvCode,
    date,
    calzado: Math.max(0, Number(snap.calzado) || 0),
    ropa: Math.max(0, Number(snap.ropa) || 0),
    source,
    createdAt: new Date().toISOString(),
  };
  await setDoc(doc(firestore, HISTORY_COLLECTION, id), stripUndefinedDeep(row) as StoreCapacityDailyHistory, {
    merge: true,
  });
}

function sanitizeProfile(input: Partial<StoreCapacityProfile> & { pdvCode: string }): StoreCapacityProfile {
  const pdvCode = normalizePdvCode(input.pdvCode);
  const now = new Date().toISOString();
  const drawers: StoreDrawerCapacity[] = (input.drawers || [])
    .map((d, idx) => ({
      id: d.id || `d_${idx}_${pdvCode}`,
      measure: String(d.measure || '').trim(),
      capacityWithBox: Math.max(0, Number(d.capacityWithBox) || 0),
      capacityWithoutBox: Math.max(0, Number(d.capacityWithoutBox) || 0),
      drawerCount: Math.max(0, Number(d.drawerCount) || 0),
    }))
    .filter((d) => d.measure);

  const inventorySnapshot: StoreInventorySnapshot | undefined = input.inventorySnapshot
    ? {
        accesorios: Math.max(0, Number(input.inventorySnapshot.accesorios) || 0),
        calzado: Math.max(0, Number(input.inventorySnapshot.calzado) || 0),
        ropa: Math.max(0, Number(input.inventorySnapshot.ropa) || 0),
        comprometidoAccesorios: Math.max(0, Number(input.inventorySnapshot.comprometidoAccesorios) || 0),
        comprometidoCalzado: Math.max(0, Number(input.inventorySnapshot.comprometidoCalzado) || 0),
        comprometidoRopa: Math.max(0, Number(input.inventorySnapshot.comprometidoRopa) || 0),
        updatedAt: input.inventorySnapshot.updatedAt || now,
        source: input.inventorySnapshot.source || 'manual',
      }
    : undefined;

  const cediEnProceso: StoreCediEnProcesoSnapshot | undefined = input.cediEnProceso
    ? {
        calzado: Math.max(0, Number(input.cediEnProceso.calzado) || 0),
        ropa: Math.max(0, Number(input.cediEnProceso.ropa) || 0),
        updatedAt: input.cediEnProceso.updatedAt || now,
        source: input.cediEnProceso.source || 'manual',
      }
    : undefined;

  const pdvName = input.pdvName?.trim() || '';
  const notes = input.notes?.trim() || '';

  return {
    id: pdvCode,
    pdvCode,
    ...(pdvName ? { pdvName } : {}),
    drawers,
    ...(inventorySnapshot ? { inventorySnapshot } : {}),
    exhibitionAffectsCapacity: !!input.exhibitionAffectsCapacity,
    exhibitionCalzado: Math.max(0, Number(input.exhibitionCalzado) || 0),
    exhibitionRopa: Math.max(0, Number(input.exhibitionRopa) || 0),
    ...(cediEnProceso ? { cediEnProceso } : {}),
    ...(notes ? { notes } : {}),
    active: input.active ?? true,
    createdAt: input.createdAt || now,
    updatedAt: now,
    ...(input.updatedBy ? { updatedBy: input.updatedBy } : {}),
  };
}

function emptyInbound(): StoreInboundQuantities {
  return { calzado: 0, ropa: 0, accesorios: 0, transferLines: 0, enRutaHoyLines: 0 };
}

function transferRouteKey(numeroTF: unknown, bodegaDestino: unknown): string {
  const digits = String(numeroTF || '').replace(/\D/g, '');
  const tf = digits ? String(Number(digits)) : '';
  const whs = normalizePdvCode(String(bodegaDestino || ''));
  return tf && whs ? `${tf}|${whs}` : '';
}

function addGrupoQty(
  bucket: StoreInboundQuantities,
  grupoRaw: string | undefined,
  cantidad: number
) {
  const qty = Math.max(0, Number(cantidad) || 0);
  if (!qty) return;
  const grupo = normalizeInventoryGrupo(String(grupoRaw || '')) || 'calzado';
  bucket[grupo] += qty;
}

/**
 * Cantidades por bodega destino aún no entregadas / en camino:
 * - Transferencias: En Tránsito, Recibido en Bodega, Enviado a Destino
 * - Consulta TF: EN RUTA HOY (sin duplicar TF|DESTINO ya contado en transfers)
 */
export async function getInboundQuantitiesByWarehouse(): Promise<{
  success: boolean;
  data?: Record<string, StoreInboundQuantities>;
  error?: string;
}> {
  try {
    const byWhs: Record<string, StoreInboundQuantities> = {};
    const countedKeys = new Set<string>();

    const ensure = (code: string) => {
      if (!byWhs[code]) byWhs[code] = emptyInbound();
      return byWhs[code];
    };

    await Promise.all(
      INBOUND_TRANSFER_STATUSES.map(async (status) => {
        const q = query(
          collection(firestore, TRANSFERS_COLLECTION),
          where('status', '==', status),
          limit(3000)
        );
        const snap = await getDocs(q);
        snap.docs.forEach((d) => {
          const t = d.data() as TransferEntry;
          const dest = normalizePdvCode(t.bodegaDestino);
          if (!dest) return;
          const key = transferRouteKey(t.numeroTF, t.bodegaDestino);
          if (key) countedKeys.add(key);
          const bucket = ensure(dest);
          bucket.transferLines += 1;
          addGrupoQty(bucket, t.grupo, t.cantidad ?? 1);
        });
      })
    );

    const enRutaQ = query(
      collection(firestore, TF_PLATFORM_STATUS_COLLECTION),
      where('estadoPlataforma', '==', 'EN RUTA HOY'),
      limit(3000)
    );
    const enRutaSnap = await getDocs(enRutaQ);
    enRutaSnap.docs.forEach((d) => {
      const raw = d.data() as TfPlatformStatusRecord;
      const dest = normalizePdvCode(raw.bodegaDestino);
      if (!dest) return;
      const key = transferRouteKey(raw.numeroTF, raw.bodegaDestino);
      if (key && countedKeys.has(key)) return;
      if (key) countedKeys.add(key);
      const bucket = ensure(dest);
      bucket.enRutaHoyLines += 1;
      addGrupoQty(bucket, raw.grupo, raw.cantidad ?? 1);
    });

    return { success: true, data: byWhs };
  } catch (error: any) {
    console.error('getInboundQuantitiesByWarehouse:', error);
    return { success: false, error: error?.message || 'No se pudo cargar el inbound TF.' };
  }
}

export async function getStoreCapacitySettings(): Promise<{
  success: boolean;
  data?: StoreCapacitySettings;
  error?: string;
}> {
  try {
    const snap = await getDoc(doc(firestore, SETTINGS_COLLECTION, SETTINGS_DOC_ID));
    if (!snap.exists()) {
      const defaults: StoreCapacitySettings = {
        id: 'global',
        garmentsPerDrawerForClothing: DEFAULT_GARMENTS_PER_DRAWER,
        forecastHorizonDays: DEFAULT_FORECAST_HORIZON_DAYS,
        forecastLookbackDays: DEFAULT_FORECAST_LOOKBACK_DAYS,
        updatedAt: new Date().toISOString(),
      };
      return { success: true, data: defaults };
    }
    const data = snap.data() as StoreCapacitySettings;
    return {
      success: true,
      data: {
        id: 'global',
        garmentsPerDrawerForClothing: Math.max(
          1,
          Number(data.garmentsPerDrawerForClothing) || DEFAULT_GARMENTS_PER_DRAWER
        ),
        forecastHorizonDays: Math.max(
          1,
          Number(data.forecastHorizonDays) || DEFAULT_FORECAST_HORIZON_DAYS
        ),
        forecastLookbackDays: Math.max(
          2,
          Number(data.forecastLookbackDays) || DEFAULT_FORECAST_LOOKBACK_DAYS
        ),
        updatedAt: data.updatedAt || new Date().toISOString(),
        updatedBy: data.updatedBy,
      },
    };
  } catch (error: any) {
    return { success: false, error: error?.message || 'No se pudieron cargar los parámetros.' };
  }
}

export async function saveStoreCapacitySettings(
  garmentsPerDrawerForClothing: number,
  updatedBy?: string,
  forecastOpts?: { horizonDays?: number; lookbackDays?: number }
): Promise<{ success: boolean; data?: StoreCapacitySettings; error?: string }> {
  try {
    const rate = Math.max(1, Math.round(Number(garmentsPerDrawerForClothing) || DEFAULT_GARMENTS_PER_DRAWER));
    const data: StoreCapacitySettings = {
      id: 'global',
      garmentsPerDrawerForClothing: rate,
      forecastHorizonDays: Math.max(
        1,
        Math.round(Number(forecastOpts?.horizonDays) || DEFAULT_FORECAST_HORIZON_DAYS)
      ),
      forecastLookbackDays: Math.max(
        2,
        Math.round(Number(forecastOpts?.lookbackDays) || DEFAULT_FORECAST_LOOKBACK_DAYS)
      ),
      updatedAt: new Date().toISOString(),
      ...(updatedBy ? { updatedBy } : {}),
    };
    await setDoc(
      doc(firestore, SETTINGS_COLLECTION, SETTINGS_DOC_ID),
      stripUndefinedDeep(data) as StoreCapacitySettings,
      { merge: true }
    );
    return { success: true, data };
  } catch (error: any) {
    return { success: false, error: error?.message || 'No se pudo guardar el parámetro.' };
  }
}

export async function listStoreCapacityProfiles(): Promise<{
  success: boolean;
  data?: StoreCapacityProfile[];
  error?: string;
}> {
  try {
    const snap = await getDocs(collection(firestore, COLLECTION));
    const data = snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as StoreCapacityProfile))
      .sort((a, b) => a.pdvCode.localeCompare(b.pdvCode, undefined, { numeric: true }));
    return { success: true, data };
  } catch (error: any) {
    console.error('listStoreCapacityProfiles:', error);
    return { success: false, error: error?.message || 'No se pudieron cargar los perfiles.' };
  }
}

export async function getStoreCapacityProfile(
  pdvCode: string
): Promise<{ success: boolean; data?: StoreCapacityProfile | null; error?: string }> {
  try {
    const id = normalizePdvCode(pdvCode);
    if (!id) return { success: false, error: 'Código PDV inválido.' };
    const snap = await getDoc(doc(firestore, COLLECTION, id));
    if (!snap.exists()) return { success: true, data: null };
    return { success: true, data: { id: snap.id, ...snap.data() } as StoreCapacityProfile };
  } catch (error: any) {
    return { success: false, error: error?.message || 'Error al cargar el perfil.' };
  }
}

export async function saveStoreCapacityProfile(
  profile: Partial<StoreCapacityProfile> & { pdvCode: string },
  updatedBy?: string
): Promise<{ success: boolean; data?: StoreCapacityProfile; error?: string }> {
  try {
    const pdvCode = normalizePdvCode(profile.pdvCode);
    if (!pdvCode) return { success: false, error: 'Indique el código PDV / tienda.' };

    const existing = await getDoc(doc(firestore, COLLECTION, pdvCode));
    const createdAt = existing.exists()
      ? String((existing.data() as StoreCapacityProfile).createdAt || new Date().toISOString())
      : profile.createdAt || new Date().toISOString();

    const sanitized = sanitizeProfile({
      ...profile,
      pdvCode,
      createdAt,
      updatedBy,
    });

    const payload = stripUndefinedDeep({
      ...sanitized,
      ...(updatedBy ? { updatedBy } : {}),
    }) as StoreCapacityProfile;

    await setDoc(doc(firestore, COLLECTION, sanitized.id), payload, { merge: true });

    if (sanitized.inventorySnapshot) {
      try {
        await upsertDailyHistoryPoint(
          sanitized.pdvCode,
          {
            calzado: sanitized.inventorySnapshot.calzado,
            ropa: sanitized.inventorySnapshot.ropa,
          },
          sanitized.inventorySnapshot.source === 'global_import' ? 'global_import' : 'manual'
        );
      } catch (histErr) {
        console.warn('No se pudo guardar histórico diario:', histErr);
      }
    }

    return { success: true, data: sanitized };
  } catch (error: any) {
    console.error('saveStoreCapacityProfile:', error);
    return { success: false, error: error?.message || 'No se pudo guardar.' };
  }
}

export async function deleteStoreCapacityProfile(
  pdvCode: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const id = normalizePdvCode(pdvCode);
    if (!id) return { success: false, error: 'Código inválido.' };
    await deleteDoc(doc(firestore, COLLECTION, id));
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error?.message || 'No se pudo eliminar.' };
  }
}

/** Upsert masivo (importación Excel de capacidades). */
export async function upsertStoreCapacityProfiles(
  profiles: Array<Partial<StoreCapacityProfile> & { pdvCode: string }>,
  updatedBy?: string
): Promise<{ success: boolean; saved: number; error?: string }> {
  try {
    let saved = 0;
    for (const p of profiles) {
      const res = await saveStoreCapacityProfile(p, updatedBy);
      if (res.success) saved += 1;
    }
    return { success: true, saved };
  } catch (error: any) {
    return { success: false, saved: 0, error: error?.message || 'Error en importación.' };
  }
}

/**
 * Aplica inventario global por bodega.
 * Reemplaza el snapshot de cada bodega presente en el mapa.
 * Si la bodega no tiene maestro de cajones, crea un stub con drawers vacíos.
 */
export async function applyGlobalStoreInventory(
  byBodega: Record<string, StoreInventorySnapshot>,
  updatedBy?: string
): Promise<{ success: boolean; updated: number; created: number; error?: string }> {
  try {
    const entries = Object.entries(byBodega)
      .map(([raw, snap]) => [normalizePdvCode(raw), snap] as const)
      .filter(([code]) => !!code);
    if (entries.length === 0) {
      return { success: false, updated: 0, created: 0, error: 'No hay filas de inventario para aplicar.' };
    }

    const existingSnap = await getDocs(collection(firestore, COLLECTION));
    const existingIds = new Set(existingSnap.docs.map((d) => d.id));

    let updated = 0;
    let created = 0;
    const now = new Date().toISOString();

    const chunkSize = 400;
    for (let i = 0; i < entries.length; i += chunkSize) {
      const chunk = entries.slice(i, i + chunkSize);
      const batch = writeBatch(firestore);

      for (const [pdvCode, snap] of chunk) {
        const ref = doc(firestore, COLLECTION, pdvCode);
        const inventorySnapshot: StoreInventorySnapshot = {
          accesorios: Math.max(0, Number(snap.accesorios) || 0),
          calzado: Math.max(0, Number(snap.calzado) || 0),
          ropa: Math.max(0, Number(snap.ropa) || 0),
          comprometidoAccesorios: Math.max(0, Number(snap.comprometidoAccesorios) || 0),
          comprometidoCalzado: Math.max(0, Number(snap.comprometidoCalzado) || 0),
          comprometidoRopa: Math.max(0, Number(snap.comprometidoRopa) || 0),
          updatedAt: snap.updatedAt || now,
          source: 'global_import',
        };

        if (existingIds.has(pdvCode)) {
          batch.set(
            ref,
            stripUndefinedDeep({
              inventorySnapshot,
              updatedAt: now,
              updatedBy: updatedBy || null,
            }) as Record<string, unknown>,
            { merge: true }
          );
          updated += 1;
        } else {
          const stub: StoreCapacityProfile = {
            id: pdvCode,
            pdvCode,
            drawers: [],
            inventorySnapshot,
            active: true,
            createdAt: now,
            updatedAt: now,
            ...(updatedBy ? { updatedBy } : {}),
          };
          batch.set(ref, stripUndefinedDeep(stub) as StoreCapacityProfile);
          existingIds.add(pdvCode);
          created += 1;
        }
      }

      await batch.commit();
    }

    for (const [pdvCode, snap] of entries) {
      try {
        await upsertDailyHistoryPoint(
          pdvCode,
          { calzado: snap.calzado, ropa: snap.ropa },
          'global_import'
        );
      } catch (e) {
        console.warn('Histórico diario falló para', pdvCode, e);
      }
    }

    return { success: true, updated, created };
  } catch (error: any) {
    console.error('applyGlobalStoreInventory:', error);
    return {
      success: false,
      updated: 0,
      created: 0,
      error: error?.message || 'No se pudo aplicar el inventario global.',
    };
  }
}

/**
 * Aplica mercancía en proceso CEDI (próxima a llegar) por bodega.
 * Reemplaza el snapshot cediEnProceso de cada bodega del archivo.
 */
export async function applyCediEnProceso(
  byBodega: Record<string, { calzado: number; ropa: number }>,
  updatedBy?: string
): Promise<{ success: boolean; updated: number; created: number; error?: string }> {
  try {
    const entries = Object.entries(byBodega)
      .map(([raw, snap]) => [normalizePdvCode(raw), snap] as const)
      .filter(([code]) => !!code);
    if (entries.length === 0) {
      return { success: false, updated: 0, created: 0, error: 'No hay filas de CEDI en proceso.' };
    }

    const existingSnap = await getDocs(collection(firestore, COLLECTION));
    const existingIds = new Set(existingSnap.docs.map((d) => d.id));

    let updated = 0;
    let created = 0;
    const now = new Date().toISOString();

    const chunkSize = 400;
    for (let i = 0; i < entries.length; i += chunkSize) {
      const chunk = entries.slice(i, i + chunkSize);
      const batch = writeBatch(firestore);

      for (const [pdvCode, snap] of chunk) {
        const ref = doc(firestore, COLLECTION, pdvCode);
        const cediEnProceso: StoreCediEnProcesoSnapshot = {
          calzado: Math.max(0, Number(snap.calzado) || 0),
          ropa: Math.max(0, Number(snap.ropa) || 0),
          updatedAt: now,
          source: 'import',
        };

        if (existingIds.has(pdvCode)) {
          batch.set(
            ref,
            stripUndefinedDeep({
              cediEnProceso,
              updatedAt: now,
              updatedBy: updatedBy || null,
            }) as Record<string, unknown>,
            { merge: true }
          );
          updated += 1;
        } else {
          const stub: StoreCapacityProfile = {
            id: pdvCode,
            pdvCode,
            drawers: [],
            cediEnProceso,
            active: true,
            createdAt: now,
            updatedAt: now,
            ...(updatedBy ? { updatedBy } : {}),
          };
          batch.set(ref, stripUndefinedDeep(stub) as StoreCapacityProfile);
          existingIds.add(pdvCode);
          created += 1;
        }
      }

      await batch.commit();
    }

    return { success: true, updated, created };
  } catch (error: any) {
    console.error('applyCediEnProceso:', error);
    return {
      success: false,
      updated: 0,
      created: 0,
      error: error?.message || 'No se pudo aplicar CEDI en proceso.',
    };
  }
}

/**
 * Pronóstico de salidas por bodega a partir del histórico diario de inventario.
 * Usa caídas día-a-día de calzado/ropa (promedio de salidas positivas) × horizonte.
 */
export async function getCapacityForecastsByWarehouse(opts?: {
  horizonDays?: number;
  lookbackDays?: number;
}): Promise<{ success: boolean; data?: Record<string, StoreCapacityForecast>; error?: string }> {
  try {
    const settings = await getStoreCapacitySettings();
    const horizonDays = Math.max(
      1,
      Number(opts?.horizonDays) ||
        settings.data?.forecastHorizonDays ||
        DEFAULT_FORECAST_HORIZON_DAYS
    );
    const lookbackDays = Math.max(
      2,
      Number(opts?.lookbackDays) ||
        settings.data?.forecastLookbackDays ||
        DEFAULT_FORECAST_LOOKBACK_DAYS
    );

    const snap = await getDocs(collection(firestore, HISTORY_COLLECTION));
    const byPdv = new Map<string, StoreCapacityDailyHistory[]>();
    snap.docs.forEach((d) => {
      const row = { id: d.id, ...d.data() } as StoreCapacityDailyHistory;
      const code = normalizePdvCode(row.pdvCode || '');
      if (!code || !row.date) return;
      if (!byPdv.has(code)) byPdv.set(code, []);
      byPdv.get(code)!.push(row);
    });

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - lookbackDays);
    const cutoffKey = localDateKey(cutoff);

    const data: Record<string, StoreCapacityForecast> = {};
    byPdv.forEach((rows, pdvCode) => {
      const sorted = rows
        .filter((r) => r.date >= cutoffKey)
        .sort((a, b) => a.date.localeCompare(b.date));
      if (sorted.length < 2) {
        data[pdvCode] = {
          pdvCode,
          avgDailyCalzadoOutflow: 0,
          avgDailyRopaOutflow: 0,
          lookbackDays,
          horizonDays,
          forecastCalzadoOutflow: 0,
          forecastRopaOutflow: 0,
          samples: sorted.length,
        };
        return;
      }

      const calzOut: number[] = [];
      const ropaOut: number[] = [];
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];
        // Salida = inventario anterior − actual (si baja)
        const dCalz = (Number(prev.calzado) || 0) - (Number(curr.calzado) || 0);
        const dRopa = (Number(prev.ropa) || 0) - (Number(curr.ropa) || 0);
        if (dCalz > 0) calzOut.push(dCalz);
        if (dRopa > 0) ropaOut.push(dRopa);
      }

      const avg = (arr: number[]) =>
        arr.length ? arr.reduce((s, n) => s + n, 0) / arr.length : 0;
      const avgDailyCalzadoOutflow = avg(calzOut);
      const avgDailyRopaOutflow = avg(ropaOut);

      data[pdvCode] = {
        pdvCode,
        avgDailyCalzadoOutflow,
        avgDailyRopaOutflow,
        lookbackDays,
        horizonDays,
        forecastCalzadoOutflow: avgDailyCalzadoOutflow * horizonDays,
        forecastRopaOutflow: avgDailyRopaOutflow * horizonDays,
        samples: Math.max(calzOut.length, ropaOut.length),
      };
    });

    return { success: true, data };
  } catch (error: any) {
    console.error('getCapacityForecastsByWarehouse:', error);
    return { success: false, error: error?.message || 'No se pudo calcular el pronóstico.' };
  }
}

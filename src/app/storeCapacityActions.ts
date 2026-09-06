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
  StoreTfPendingReceiveSnapshot,
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

/** Siempre en Próxima: aún en CEDI / no salieron a tienda. */
const INBOUND_CEDI_STATUSES: TransferStatus[] = ['En Tránsito', 'Recibido en Bodega'];
/** Opcional (setting): ya salieron; pueden estar o no en inventario del PDV. */
const INBOUND_EN_RUTA_STATUSES: TransferStatus[] = ['Enviado a Destino'];

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

  const tfPendingReceive: StoreTfPendingReceiveSnapshot | undefined = input.tfPendingReceive
    ? {
        calzado: Math.max(0, Number(input.tfPendingReceive.calzado) || 0),
        ropa: Math.max(0, Number(input.tfPendingReceive.ropa) || 0),
        updatedAt: input.tfPendingReceive.updatedAt || now,
        source: input.tfPendingReceive.source || 'manual',
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
    ...(tfPendingReceive ? { tfPendingReceive } : {}),
    ...(notes ? { notes } : {}),
    active: input.active ?? true,
    createdAt: input.createdAt || now,
    updatedAt: now,
    ...(input.updatedBy ? { updatedBy: input.updatedBy } : {}),
  };
}

function emptyInbound(includeEnviadoDestino = false): StoreInboundQuantities {
  return {
    calzado: 0,
    ropa: 0,
    accesorios: 0,
    calzadoCedi: 0,
    ropaCedi: 0,
    calzadoEnRuta: 0,
    ropaEnRuta: 0,
    transferLines: 0,
    enRutaHoyLines: 0,
    skippedLines: 0,
    skippedQty: 0,
    includeEnviadoDestino,
  };
}

function transferRouteKey(numeroTF: unknown, bodegaDestino: unknown): string {
  const digits = String(numeroTF || '').replace(/\D/g, '');
  const tf = digits ? String(Number(digits)) : '';
  const whs = normalizePdvCode(String(bodegaDestino || ''));
  return tf && whs ? `${tf}|${whs}` : '';
}

/**
 * Solo calzado y ropa entran al cupo.
 * Accesorios y grupos desconocidos/vacíos NO se cuentan como calzado.
 */
function addCapacityInboundQty(
  bucket: StoreInboundQuantities,
  grupoRaw: string | undefined,
  cantidadRaw: unknown,
  layer: 'cedi' | 'en_ruta'
): void {
  const qty = Number(cantidadRaw);
  if (!Number.isFinite(qty) || qty <= 0) {
    bucket.skippedLines = (bucket.skippedLines || 0) + 1;
    return;
  }
  const grupo = normalizeInventoryGrupo(String(grupoRaw || ''));
  if (grupo === 'calzado') {
    bucket.calzado += qty;
    if (layer === 'cedi') bucket.calzadoCedi += qty;
    else bucket.calzadoEnRuta += qty;
    return;
  }
  if (grupo === 'ropa') {
    bucket.ropa += qty;
    if (layer === 'cedi') bucket.ropaCedi += qty;
    else bucket.ropaEnRuta += qty;
    return;
  }
  if (grupo === 'accesorios') {
    bucket.accesorios += qty;
  }
  bucket.skippedLines = (bucket.skippedLines || 0) + 1;
  bucket.skippedQty = (bucket.skippedQty || 0) + qty;
}

/**
 * Inbound TF por bodega destino para capacidad Próxima:
 * - Siempre: En Tránsito + Recibido en Bodega (aún en CEDI; no deberían estar en inventario tienda).
 * - Opcional (setting inboundIncludeEnviadoDestino): Enviado a Destino + EN RUTA HOY.
 *   Ojo: esos pueden ya haberse recibido en inventario → preferir Excel "TF pendiente recibir".
 * Solo suma calzado + ropa.
 */
export async function getInboundQuantitiesByWarehouse(): Promise<{
  success: boolean;
  data?: Record<string, StoreInboundQuantities>;
  error?: string;
}> {
  try {
    const settings = await getStoreCapacitySettings();
    const includeEnviadoDestino = !!settings.data?.inboundIncludeEnviadoDestino;

    const byWhs: Record<string, StoreInboundQuantities> = {};
    const countedKeys = new Set<string>();

    const ensure = (code: string) => {
      if (!byWhs[code]) byWhs[code] = emptyInbound(includeEnviadoDestino);
      return byWhs[code];
    };

    await Promise.all(
      INBOUND_CEDI_STATUSES.map(async (status) => {
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
          addCapacityInboundQty(bucket, t.grupo, t.cantidad, 'cedi');
        });
      })
    );

    if (includeEnviadoDestino) {
      await Promise.all(
        INBOUND_EN_RUTA_STATUSES.map(async (status) => {
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
            addCapacityInboundQty(bucket, t.grupo, t.cantidad, 'en_ruta');
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
        addCapacityInboundQty(bucket, raw.grupo, raw.cantidad, 'en_ruta');
      });
    }

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
        inboundIncludeEnviadoDestino: false,
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
        inboundIncludeEnviadoDestino: !!data.inboundIncludeEnviadoDestino,
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
  forecastOpts?: {
    horizonDays?: number;
    lookbackDays?: number;
    inboundIncludeEnviadoDestino?: boolean;
  }
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
      inboundIncludeEnviadoDestino: !!forecastOpts?.inboundIncludeEnviadoDestino,
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

/** Eliminación masiva de maestros de capacidad (por PDV). */
export async function deleteStoreCapacityProfiles(
  pdvCodes: string[]
): Promise<{ success: boolean; deleted: number; error?: string }> {
  try {
    const ids = Array.from(
      new Set(
        (pdvCodes || [])
          .map((c) => normalizePdvCode(c))
          .filter(Boolean)
      )
    );
    if (ids.length === 0) {
      return { success: false, deleted: 0, error: 'No hay tiendas seleccionadas.' };
    }

    let deleted = 0;
    const chunkSize = 400;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const batch = writeBatch(firestore);
      for (const id of chunk) {
        batch.delete(doc(firestore, COLLECTION, id));
      }
      await batch.commit();
      deleted += chunk.length;
    }

    return { success: true, deleted };
  } catch (error: any) {
    console.error('deleteStoreCapacityProfiles:', error);
    return {
      success: false,
      deleted: 0,
      error: error?.message || 'No se pudo eliminar masivamente.',
    };
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
 * Aplica inbound TF por Excel (BODEGA | CANTIDAD | GRUPO).
 * Reemplaza el snapshot: bodegas del archivo se actualizan; el resto se limpia a 0
 * para que una carga completa sea la única fuente de verdad (sin residuales ni doble conteo).
 */
export async function applyTfPendingReceive(
  byBodega: Record<string, { calzado: number; ropa: number }>,
  updatedBy?: string
): Promise<{ success: boolean; updated: number; created: number; cleared?: number; error?: string }> {
  try {
    const entries = Object.entries(byBodega)
      .map(([raw, snap]) => [normalizePdvCode(raw), snap] as const)
      .filter(([code]) => !!code);
    if (entries.length === 0) {
      return { success: false, updated: 0, created: 0, cleared: 0, error: 'No hay filas de inbound TF.' };
    }

    const incoming = new Map(entries);
    const existingSnap = await getDocs(collection(firestore, COLLECTION));
    const existingIds = new Set(existingSnap.docs.map((d) => d.id));

    let updated = 0;
    let created = 0;
    let cleared = 0;
    const now = new Date().toISOString();

    const writeChunk = async (
      items: Array<{ pdvCode: string; snap: { calzado: number; ropa: number }; isNew: boolean; isClear: boolean }>
    ) => {
      const batch = writeBatch(firestore);
      for (const item of items) {
        const ref = doc(firestore, COLLECTION, item.pdvCode);
        const tfPendingReceive: StoreTfPendingReceiveSnapshot = {
          calzado: Math.max(0, Number(item.snap.calzado) || 0),
          ropa: Math.max(0, Number(item.snap.ropa) || 0),
          updatedAt: now,
          source: 'import',
        };
        if (item.isNew) {
          const stub: StoreCapacityProfile = {
            id: item.pdvCode,
            pdvCode: item.pdvCode,
            drawers: [],
            tfPendingReceive,
            active: true,
            createdAt: now,
            updatedAt: now,
            ...(updatedBy ? { updatedBy } : {}),
          };
          batch.set(ref, stripUndefinedDeep(stub) as StoreCapacityProfile);
          existingIds.add(item.pdvCode);
          created += 1;
        } else {
          batch.set(
            ref,
            stripUndefinedDeep({
              tfPendingReceive,
              updatedAt: now,
              updatedBy: updatedBy || null,
            }) as Record<string, unknown>,
            { merge: true }
          );
          if (item.isClear) cleared += 1;
          else updated += 1;
        }
      }
      await batch.commit();
    };

    const ops: Array<{
      pdvCode: string;
      snap: { calzado: number; ropa: number };
      isNew: boolean;
      isClear: boolean;
    }> = [];

    incoming.forEach((snap, pdvCode) => {
      ops.push({
        pdvCode,
        snap,
        isNew: !existingIds.has(pdvCode),
        isClear: false,
      });
    });

    // Limpia inbound de tiendas que ya no vienen en el Excel
    existingSnap.docs.forEach((d) => {
      const code = d.id;
      if (incoming.has(code)) return;
      const prev = (d.data() as StoreCapacityProfile).tfPendingReceive;
      const had =
        (Number(prev?.calzado) || 0) > 0 || (Number(prev?.ropa) || 0) > 0;
      if (!had) return;
      ops.push({
        pdvCode: code,
        snap: { calzado: 0, ropa: 0 },
        isNew: false,
        isClear: true,
      });
    });

    const chunkSize = 400;
    for (let i = 0; i < ops.length; i += chunkSize) {
      await writeChunk(ops.slice(i, i + chunkSize));
    }

    return { success: true, updated, created, cleared };
  } catch (error: any) {
    console.error('applyTfPendingReceive:', error);
    return {
      success: false,
      updated: 0,
      created: 0,
      cleared: 0,
      error: error?.message || 'No se pudo aplicar inbound TF.',
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

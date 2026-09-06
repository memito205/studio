'use server';

import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, writeBatch } from 'firebase/firestore';
import { firestore } from '@/services/firebase';
import type { StoreCapacityProfile, StoreCapacitySettings, StoreDrawerCapacity, StoreInventorySnapshot } from '@/types';
import { DEFAULT_GARMENTS_PER_DRAWER, normalizePdvCode } from '@/lib/storeCapacity';

const COLLECTION = 'storeCapacityProfiles';
const SETTINGS_COLLECTION = 'storeCapacitySettings';
const SETTINGS_DOC_ID = 'global';

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
        updatedAt: input.inventorySnapshot.updatedAt || now,
        source: input.inventorySnapshot.source || 'manual',
      }
    : undefined;

  return {
    id: pdvCode,
    pdvCode,
    pdvName: input.pdvName?.trim() || undefined,
    drawers,
    inventorySnapshot,
    notes: input.notes?.trim() || undefined,
    active: input.active ?? true,
    createdAt: input.createdAt || now,
    updatedAt: now,
    updatedBy: input.updatedBy,
  };
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
  updatedBy?: string
): Promise<{ success: boolean; data?: StoreCapacitySettings; error?: string }> {
  try {
    const rate = Math.max(1, Math.round(Number(garmentsPerDrawerForClothing) || DEFAULT_GARMENTS_PER_DRAWER));
    const data: StoreCapacitySettings = {
      id: 'global',
      garmentsPerDrawerForClothing: rate,
      updatedAt: new Date().toISOString(),
      updatedBy,
    };
    await setDoc(doc(firestore, SETTINGS_COLLECTION, SETTINGS_DOC_ID), data, { merge: true });
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

    await setDoc(doc(firestore, COLLECTION, sanitized.id), sanitized, { merge: true });
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
          updatedAt: snap.updatedAt || now,
          source: 'global_import',
        };

        if (existingIds.has(pdvCode)) {
          batch.set(
            ref,
            {
              inventorySnapshot,
              updatedAt: now,
              updatedBy: updatedBy || null,
            },
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
            updatedBy,
          };
          batch.set(ref, stub);
          existingIds.add(pdvCode);
          created += 1;
        }
      }

      await batch.commit();
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

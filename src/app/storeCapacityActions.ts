'use server';

import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { firestore } from '@/services/firebase';
import type { StoreCapacityProfile, StoreDrawerCapacity, StoreInventorySnapshot } from '@/types';
import { normalizePdvCode } from '@/lib/storeCapacity';

const COLLECTION = 'storeCapacityProfiles';

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

/** Upsert masivo (importación Excel). */
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

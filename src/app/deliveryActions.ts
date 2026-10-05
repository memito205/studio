'use server';

import { collection, doc, getDocs, query, Timestamp, updateDoc, where, writeBatch } from 'firebase/firestore';
import { firestore } from '@/services/firebase';
import type { DeliveryStore, TransferActor } from '@/types';

const STORES_COLLECTION = 'deliveryStores';

const withoutUndefined = <T extends Record<string, unknown>>(obj: T) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;

export async function getDeliveryStores(): Promise<{ data?: DeliveryStore[]; error?: string }> {
  try {
    const snap = await getDocs(collection(firestore, STORES_COLLECTION));
    const data = snap.docs
      .map((d) => {
        const raw = d.data() as Record<string, any>;
        return {
          ...raw,
          id: d.id,
          codigosEquivalentes: Array.isArray(raw.codigosEquivalentes) ? raw.codigosEquivalentes : [],
          quienesReciben: Array.isArray(raw.quienesReciben) ? raw.quienesReciben : [],
          updatedAt: raw.updatedAt?.toDate ? raw.updatedAt.toDate() : undefined,
        } as DeliveryStore;
      })
      .sort((a, b) => a.nombreCorto.localeCompare(b.nombreCorto));
    return { data };
  } catch (error: any) {
    console.error('Error loading delivery stores:', error);
    return { error: error.message || 'No se pudo cargar el maestro de tiendas.' };
  }
}

export type StoreUser = { uid: string; displayName: string; email?: string; storeCode?: string };

/** Usuarios con rol tiendas y su tienda asignada. */
export async function getStoreUsers(): Promise<{ data?: StoreUser[]; error?: string }> {
  try {
    const snap = await getDocs(query(collection(firestore, 'users'), where('role', 'in', ['tiendas', 'TIENDAS', 'Tiendas'])));
    return {
      data: snap.docs
        .map((d) => {
          const r = d.data() as Record<string, any>;
          return {
            uid: d.id,
            displayName: String(r.displayName || r.email || d.id),
            email: r.email || undefined,
            storeCode: String(r.storeCode || '').trim() || undefined,
          };
        })
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    };
  } catch (error: any) {
    return { error: error.message || 'No se pudieron cargar los usuarios de tienda.' };
  }
}

/** Un usuario por tienda: si la tienda ya tiene otro usuario, no se asigna. */
export async function assignStoreToUser(input: {
  uid: string;
  storeCode: string | null;
  actor?: TransferActor;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const storeCode = String(input.storeCode || '').trim();
    if (storeCode) {
      const taken = await getDocs(query(collection(firestore, 'users'), where('storeCode', '==', storeCode)));
      const other = taken.docs.find((d) => d.id !== input.uid);
      if (other) {
        return { success: false, error: `La tienda ya está asignada a ${other.data().displayName || other.data().email || other.id}.` };
      }
    }
    await updateDoc(doc(firestore, 'users', input.uid), {
      storeCode: storeCode || null,
      storeAssignedAt: Timestamp.now(),
      storeAssignedByName: input.actor?.displayName || null,
    });
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || 'No se pudo asignar la tienda.' };
  }
}

const QUICK_LEGACY_COLLECTION = 'podLegacyQuick';

export type QuickLegacyRow = {
  numeroTF: string;
  bodegaDestino: string;
  evidenceLinks: string[];
  fechaFinalizado?: string;
  placaEntrega?: string;
};

const tsToIsoString = (v: any): string | undefined => {
  if (!v) return undefined;
  const d = typeof v.toDate === 'function' ? v.toDate() : new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};

/**
 * Copia las pruebas Quick (links de evidencia publicados por el analizador) a una base propia,
 * para no depender de volver a subir el Excel. Idempotente: une links nuevos con los ya guardados.
 */
export async function snapshotQuickLegacyEvidence(
  actor?: TransferActor
): Promise<{ success: boolean; saved?: number; total?: number; error?: string }> {
  try {
    const [statusSnap, legacySnap] = await Promise.all([
      getDocs(collection(firestore, 'tf_platform_status')),
      getDocs(collection(firestore, QUICK_LEGACY_COLLECTION)),
    ]);
    const existing = new Map(legacySnap.docs.map((d) => [d.id, d.data()]));
    const now = Timestamp.now();
    const writes: Array<{ id: string; data: Record<string, unknown> }> = [];

    statusSnap.docs.forEach((d) => {
      const raw = d.data() as Record<string, any>;
      const links: string[] = Array.isArray(raw.evidenceLinks) ? raw.evidenceLinks.filter((l: unknown) => typeof l === 'string' && l.startsWith('http')) : [];
      if (links.length === 0 || raw.source === 'pod_app') return;
      const prev = existing.get(d.id) as Record<string, any> | undefined;
      const prevLinks: string[] = Array.isArray(prev?.evidenceLinks) ? prev!.evidenceLinks : [];
      const merged = Array.from(new Set([...prevLinks, ...links]));
      if (prev && merged.length === prevLinks.length) return;
      writes.push({
        id: d.id,
        data: withoutUndefined({
          numeroTF: String(raw.numeroTF || ''),
          bodegaDestino: String(raw.bodegaDestino || ''),
          bodegaOrigen: raw.bodegaOrigen ? String(raw.bodegaOrigen) : undefined,
          evidenceLinks: merged,
          fechaFinalizado: raw.fechaFinalizado ?? undefined,
          fechaDocumento: raw.fechaDocumento ?? undefined,
          placaEntrega: raw.placaEntrega ? String(raw.placaEntrega) : undefined,
          cantidad: Number(raw.cantidad || 0) || 0,
          source: 'quick',
          snapshotAt: now,
          snapshotByName: actor?.displayName,
        }),
      });
    });

    for (let i = 0; i < writes.length; i += 450) {
      const batch = writeBatch(firestore);
      writes.slice(i, i + 450).forEach((w) => batch.set(doc(firestore, QUICK_LEGACY_COLLECTION, w.id), w.data, { merge: true }));
      await batch.commit();
    }
    return { success: true, saved: writes.length, total: existing.size + writes.filter((w) => !existing.has(w.id)).length };
  } catch (error: any) {
    console.error('Error snapshotting Quick evidence:', error);
    return { success: false, error: error.message || 'No se pudo guardar la base histórica Quick.' };
  }
}

export async function getQuickLegacyEvidence(): Promise<{ data?: QuickLegacyRow[]; error?: string }> {
  try {
    const snap = await getDocs(collection(firestore, QUICK_LEGACY_COLLECTION));
    return {
      data: snap.docs.map((d) => {
        const raw = d.data() as Record<string, any>;
        return {
          numeroTF: String(raw.numeroTF || ''),
          bodegaDestino: String(raw.bodegaDestino || ''),
          evidenceLinks: Array.isArray(raw.evidenceLinks) ? raw.evidenceLinks : [],
          fechaFinalizado: tsToIsoString(raw.fechaFinalizado),
          placaEntrega: raw.placaEntrega || undefined,
        };
      }),
    };
  } catch (error: any) {
    return { error: error.message || 'No se pudo leer la base histórica Quick.' };
  }
}

/** Crea o actualiza tiendas por Codigo ERP. No borra las que no vengan en el archivo. */
export async function saveDeliveryStores(
  stores: DeliveryStore[],
  actor?: TransferActor
): Promise<{ success: boolean; created?: number; updated?: number; error?: string }> {
  if (!stores.length) return { success: true, created: 0, updated: 0 };
  try {
    const existing = await getDocs(collection(firestore, STORES_COLLECTION));
    const existingIds = new Set(existing.docs.map((d) => d.id));
    const now = Timestamp.now();
    let created = 0;
    for (let i = 0; i < stores.length; i += 450) {
      const batch = writeBatch(firestore);
      stores.slice(i, i + 450).forEach((s) => {
        if (!existingIds.has(s.codigoErp)) created += 1;
        const { id: _id, updatedAt: _u, ...rest } = s;
        batch.set(
          doc(firestore, STORES_COLLECTION, s.codigoErp),
          withoutUndefined({
            ...rest,
            updatedAt: now,
            updatedBy: actor?.userId,
            updatedByName: actor?.displayName,
          })
        );
      });
      await batch.commit();
    }
    return { success: true, created, updated: stores.length - created };
  } catch (error: any) {
    console.error('Error saving delivery stores:', error);
    return { success: false, error: error.message || 'No se pudo guardar el maestro de tiendas.' };
  }
}

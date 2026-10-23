'use server';

import {
  collection,
  deleteField,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  query,
  Timestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { firestore } from '@/services/firebase';
import type { TransferActor } from '@/types';
import {
  bogotaDayKey,
  ecomDispatchDestDay,
  ECOM_DISPATCH_BODEGA,
  isEcomDispatchDestino,
  orderMatchesDispatchDestino,
} from '@/lib/ecommerceDispatch';

const COL = 'ecommerceDispatches';

export type EcomDispatchPhoto = { path: string; url: string };

export type EcomDispatchView = {
  id: string;
  destino: string;
  carrier: string;
  dispatchAt: string;
  orderIds: string[];
  photos: EcomDispatchPhoto[];
  closedByName: string;
  status: 'cerrado' | 'anulado';
  day: string;
};

const asDate = (v: unknown): Date | null => {
  if (!v) return null;
  if (v instanceof Timestamp) return v.toDate();
  if (v instanceof Date) return v;
  if (typeof v === 'object' && v && 'toDate' in v && typeof (v as { toDate: () => Date }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate();
  }
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d;
};

const toView = (id: string, data: Record<string, unknown>): EcomDispatchView => {
  const at = asDate(data.dispatchAt);
  const photos = Array.isArray(data.photos) ? data.photos : [];
  return {
    id,
    destino: String(data.destino || ''),
    carrier: String(data.carrier || ''),
    dispatchAt: at ? at.toISOString() : '',
    orderIds: Array.isArray(data.orderIds) ? data.orderIds.map(String) : [],
    photos: photos
      .map((p) => {
        const row = p as { path?: string; url?: string };
        return { path: String(row.path || ''), url: String(row.url || '') };
      })
      .filter((p) => p.url),
    closedByName: String(data.closedByName || ''),
    status: data.status === 'anulado' ? 'anulado' : 'cerrado',
    day: String(data.day || ''),
  };
};

export async function lookupEcommerceOrderForDispatch(
  orderId: string,
  destino: string
): Promise<{ id?: string; tienda?: string; estado?: string; error?: string }> {
  const id = String(orderId || '').trim();
  const dest = String(destino || '').trim().toUpperCase();
  if (!id) return { error: 'Escriba o escanee el pedido.' };
  if (!isEcomDispatchDestino(dest)) return { error: 'Destino no válido.' };
  try {
    const snap = await getDoc(doc(firestore, 'ecommerceOrders', id));
    if (!snap.exists()) return { error: `El pedido ${id} no está en el tablero.` };
    const data = snap.data();
    const tienda = String(data.tienda || '').trim();
    if (!orderMatchesDispatchDestino(tienda, dest)) {
      return { error: `El pedido ${id} es de ${tienda || 'otra tienda'}, no de ${dest}.` };
    }
    const linked = String(data.ecommerceDispatchId || '').trim();
    if (linked) {
      const prev = await getDoc(doc(firestore, COL, linked));
      if (prev.exists() && prev.data().status !== 'anulado') {
        return { error: `El pedido ${id} ya está en un despacho cerrado.` };
      }
    }
    return { id, tienda, estado: String(data.estado || '') };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'No se pudo leer el pedido.';
    return { error: message };
  }
}

export async function closeEcommerceDispatch(input: {
  destino: string;
  carrier: string;
  dispatchAt: string;
  orderIds: string[];
  photos: EcomDispatchPhoto[];
  actor?: TransferActor;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const dest = String(input.destino || '').trim().toUpperCase();
  const carrier = String(input.carrier || '').trim();
  const when = new Date(input.dispatchAt);
  const orderIds = Array.from(new Set((input.orderIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
  const photos = (input.photos || []).filter((p) => p?.url && String(p.path || '').startsWith('despachos-ecommerce/'));
  if (!input.actor?.userId) return { success: false, error: 'Sesión no válida. Vuelva a iniciar sesión.' };
  if (!isEcomDispatchDestino(dest)) return { success: false, error: 'Destino no válido.' };
  if (carrier.length < 2) return { success: false, error: 'Escriba la transportadora.' };
  if (Number.isNaN(when.getTime())) return { success: false, error: 'Fecha y hora no válidas.' };
  if (Date.now() - when.getTime() > 120 * 86400000) return { success: false, error: 'La fecha no puede ser de hace más de 120 días.' };
  if (when.getTime() - Date.now() > 24 * 3600 * 1000) return { success: false, error: 'La hora no puede pasar de mañana.' };
  if (orderIds.length === 0) return { success: false, error: 'Escanee al menos un pedido.' };
  if (photos.length === 0) return { success: false, error: 'Suba la foto de las hojas firmadas.' };
  if (photos.length > 40) return { success: false, error: 'Máximo 40 fotos por despacho.' };

  try {
    const found = new Map<string, { tienda: string; linked: string }>();
    for (let i = 0; i < orderIds.length; i += 30) {
      const chunk = orderIds.slice(i, i + 30);
      const snap = await getDocs(query(collection(firestore, 'ecommerceOrders'), where(documentId(), 'in', chunk)));
      snap.docs.forEach((d) => {
        const data = d.data();
        found.set(d.id, { tienda: String(data.tienda || ''), linked: String(data.ecommerceDispatchId || '') });
      });
    }
    for (const id of orderIds) {
      const row = found.get(id);
      if (!row) return { success: false, error: `El pedido ${id} no está en el tablero.` };
      if (!orderMatchesDispatchDestino(row.tienda, dest)) {
        return { success: false, error: `El pedido ${id} es de ${row.tienda || 'otra tienda'}, no de ${dest}.` };
      }
    }
    const linkedIds = Array.from(new Set(Array.from(found.values()).map((r) => r.linked).filter(Boolean)));
    const openLinks = new Set<string>();
    for (let i = 0; i < linkedIds.length; i += 30) {
      const chunk = linkedIds.slice(i, i + 30);
      const snap = await getDocs(query(collection(firestore, COL), where(documentId(), 'in', chunk)));
      snap.docs.forEach((d) => {
        if (d.data().status !== 'anulado') openLinks.add(d.id);
      });
    }
    const busy = orderIds.find((id) => openLinks.has(found.get(id)?.linked || ''));
    if (busy) return { success: false, error: `El pedido ${busy} ya está en un despacho cerrado.` };

    const day = bogotaDayKey(when);
    const ref = doc(collection(firestore, COL));
    const stamp = Timestamp.fromDate(when);
    const now = Timestamp.now();
    const payload = {
      id: ref.id,
      bodega: ECOM_DISPATCH_BODEGA,
      destino: dest,
      carrier,
      dispatchAt: stamp,
      day,
      monthKey: day.slice(0, 7),
      destDay: ecomDispatchDestDay(dest, day),
      orderIds,
      photos: photos.map((p) => ({ path: p.path, url: p.url })),
      status: 'cerrado',
      closedById: input.actor.userId,
      closedByName: (input.actor.displayName || '').trim() || input.actor.userId,
      createdAt: now,
    };

    let batch = writeBatch(firestore);
    let ops = 0;
    const commit = async () => {
      if (ops === 0) return;
      await batch.commit();
      batch = writeBatch(firestore);
      ops = 0;
    };
    batch.set(ref, payload);
    ops++;
    for (const id of orderIds) {
      batch.update(doc(firestore, 'ecommerceOrders', id), {
        dispatchDate: stamp,
        ecommerceDispatchId: ref.id,
      });
      ops++;
      if (ops >= 400) await commit();
    }
    await commit();
    return { success: true, id: ref.id };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'No se pudo cerrar el despacho.';
    return { success: false, error: message };
  }
}

export async function annulEcommerceDispatch(
  dispatchId: string,
  actor?: TransferActor
): Promise<{ success: boolean; error?: string }> {
  if (!actor?.userId) return { success: false, error: 'Sesión no válida. Vuelva a iniciar sesión.' };
  const id = String(dispatchId || '').trim();
  if (!id) return { success: false, error: 'Falta el despacho.' };
  try {
    const ref = doc(firestore, COL, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return { success: false, error: 'Ese despacho ya no existe.' };
    if (snap.data().status === 'anulado') return { success: true };
    const orderIds: string[] = Array.isArray(snap.data().orderIds) ? snap.data().orderIds.map(String) : [];
    let batch = writeBatch(firestore);
    let ops = 0;
    const commit = async () => {
      if (ops === 0) return;
      await batch.commit();
      batch = writeBatch(firestore);
      ops = 0;
    };
    batch.update(ref, {
      status: 'anulado',
      annulledAt: Timestamp.now(),
      annulledById: actor.userId,
      annulledByName: (actor.displayName || '').trim() || actor.userId,
    });
    ops++;
    for (let i = 0; i < orderIds.length; i += 30) {
      const chunk = orderIds.slice(i, i + 30);
      const orders = await getDocs(query(collection(firestore, 'ecommerceOrders'), where(documentId(), 'in', chunk)));
      for (const d of orders.docs) {
        if (String(d.data().ecommerceDispatchId || '') !== id) continue;
        batch.update(d.ref, { dispatchDate: deleteField(), ecommerceDispatchId: deleteField() });
        ops++;
        if (ops >= 400) await commit();
      }
    }
    await commit();
    return { success: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'No se pudo anular el despacho.';
    return { success: false, error: message };
  }
}

export async function searchEcommerceDispatchByOrder(
  orderId: string
): Promise<{ data?: EcomDispatchView; error?: string }> {
  const id = String(orderId || '').trim();
  if (!id) return { error: 'Escriba el número de pedido.' };
  try {
    const order = await getDoc(doc(firestore, 'ecommerceOrders', id));
    if (!order.exists()) return { error: `El pedido ${id} no está en el tablero.` };
    const dispatchId = String(order.data().ecommerceDispatchId || '').trim();
    if (!dispatchId) return { error: `El pedido ${id} no tiene prueba de despacho.` };
    const dispatch = await getDoc(doc(firestore, COL, dispatchId));
    if (!dispatch.exists()) return { error: 'La prueba de ese pedido ya no está.' };
    return { data: toView(dispatch.id, dispatch.data()) };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'No se pudo buscar la prueba.';
    return { error: message };
  }
}

export async function searchEcommerceDispatchesByDay(
  destino: string,
  day: string
): Promise<{ data?: EcomDispatchView[]; error?: string }> {
  const dest = String(destino || '').trim().toUpperCase();
  if (!isEcomDispatchDestino(dest)) return { error: 'Destino no válido.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { error: 'Día no válido.' };
  try {
    const snap = await getDocs(
      query(collection(firestore, COL), where('destDay', '==', ecomDispatchDestDay(dest, day)), limit(40))
    );
    const data = snap.docs.map((d) => toView(d.id, d.data()));
    return { data };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'No se pudieron buscar los despachos.';
    return { error: message };
  }
}

/** Respaldo del mes: solo los despachos de ese mes (tope 200). */
export async function listEcommerceDispatchesByMonth(
  month: string
): Promise<{ data?: EcomDispatchView[]; error?: string }> {
  if (!/^\d{4}-\d{2}$/.test(month)) return { error: 'Mes no válido.' };
  try {
    const snap = await getDocs(query(collection(firestore, COL), where('monthKey', '==', month), limit(200)));
    return { data: snap.docs.map((d) => toView(d.id, d.data())) };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'No se pudo listar el mes.';
    return { error: message };
  }
}

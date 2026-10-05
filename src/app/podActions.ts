'use server';

import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  Timestamp,
  where,
  documentId,
  type DocumentData,
} from 'firebase/firestore';
import { firestore } from '@/services/firebase';
import { buildStoreMatcher } from '@/lib/deliveryStores';
import { MAX_DELIVERY_PHOTOS } from '@/lib/pod';
import type {
  DeliveryManifest,
  DeliveryManifestStop,
  DeliveryPhoto,
  DeliveryStopStatus,
  DeliveryStopTf,
  DeliveryStore,
  TransferActor,
  TransferStatus,
} from '@/types';

const toDates = (v: any): any => {
  if (v instanceof Timestamp) return v.toDate();
  if (Array.isArray(v)) return v.map(toDates);
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, toDates(val)]));
  }
  return v;
};

const clean = (v: any): any => {
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const out: Record<string, any> = {};
    Object.entries(v).forEach(([k, val]) => {
      if (val !== undefined) out[k] = clean(val);
    });
    return out;
  }
  return v;
};

const distanceMeters = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
};

/** Relaciones en ruta (con paradas). Sin `all`, solo las asignadas al conductor. */
export async function getOpenDeliveryManifests(opts: {
  driverUserId?: string;
  all?: boolean;
}): Promise<{ data?: DeliveryManifest[]; error?: string }> {
  try {
    const snap = await getDocs(query(collection(firestore, 'deliveryManifests'), where('deliveryStatus', '==', 'en_ruta')));
    const data = snap.docs
      .map((d) => toDates({ id: d.id, ...d.data() }) as DeliveryManifest)
      .filter((m) => opts.all || (!!opts.driverUserId && m.driverUserId === opts.driverUserId))
      .sort((a, b) => (b.manifestId || 0) - (a.manifestId || 0));
    return { data };
  } catch (error: any) {
    return { error: error.message || 'No se pudieron cargar las relaciones.' };
  }
}

export type StopWithTfs = DeliveryManifestStop & {
  tfs: DeliveryStopTf[];
  storeAddress?: string;
  storeLat?: number | null;
  storeLng?: number | null;
};

/** Paradas de la relación con sus TFs agrupadas (una fila por número de TF). */
export async function getManifestStopsDetail(
  manifestDocId: string
): Promise<{ manifest?: DeliveryManifest; stops?: StopWithTfs[]; error?: string }> {
  try {
    const manifestRef = doc(firestore, 'deliveryManifests', manifestDocId);
    const [mSnap, stopsSnap, storesSnap] = await Promise.all([
      getDoc(manifestRef),
      getDocs(collection(manifestRef, 'stops')),
      getDocs(collection(firestore, 'deliveryStores')),
    ]);
    if (!mSnap.exists()) return { error: 'La relación no existe.' };
    const manifest = toDates({ id: mSnap.id, ...mSnap.data() }) as DeliveryManifest;
    const stops = stopsSnap.docs.map((d) => toDates({ id: d.id, ...d.data() }) as DeliveryManifestStop);
    const matchStore = buildStoreMatcher(storesSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as DeliveryStore));

    const ids = Array.from(new Set(stops.flatMap((s) => s.transferIds || [])));
    const lines = new Map<string, DocumentData>();
    for (let i = 0; i < ids.length; i += 30) {
      const snap = await getDocs(query(collection(firestore, 'transfers'), where(documentId(), 'in', ids.slice(i, i + 30))));
      snap.forEach((d) => lines.set(d.id, d.data()));
    }

    const detailed: StopWithTfs[] = stops
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((s) => {
        const byTf = new Map<string, DeliveryStopTf>();
        (s.transferIds || []).forEach((id) => {
          const t = lines.get(id);
          const tf = String(t?.numeroTF || id).trim();
          const cur = byTf.get(tf) || {
            numeroTF: tf,
            transferIds: [],
            unidades: 0,
            status: (t?.status || 'Enviado a Destino') as TransferStatus,
          };
          cur.transferIds.push(id);
          cur.unidades += Number(t?.cantidad || 0) || 0;
          const alt = String(t?.codigoAlterno || '').trim();
          if (alt && !cur.codigoAlterno) cur.codigoAlterno = alt;
          byTf.set(tf, cur);
        });
        const store = matchStore(s.storeCode || s.destino);
        return {
          ...s,
          ...(store && !s.storeName ? { storeCode: store.codigoErp, storeName: store.nombreCorto } : {}),
          ...(store ? { storeAddress: [store.direccion, store.ciudad].filter(Boolean).join(', '), storeLat: store.latitud, storeLng: store.longitud } : {}),
          tfs: Array.from(byTf.values()).sort((a, b) => a.numeroTF.localeCompare(b.numeroTF, undefined, { numeric: true })),
        };
      });
    return { manifest, stops: detailed };
  } catch (error: any) {
    return { error: error.message || 'No se pudieron cargar las paradas.' };
  }
}

export type SubmitDeliveryStopInput = {
  manifestDocId: string;
  stopId: string;
  submissionId: string;
  deliveredTfs: string[];
  /** numeroTF -> motivo */
  notDelivered: Record<string, string>;
  photos: Array<Pick<DeliveryPhoto, 'path' | 'url' | 'category'>>;
  gps: { lat: number; lng: number; accuracyM?: number; at: string } | null;
  receivedByName?: string;
  notes?: string;
  actor: TransferActor;
};

const DELIVERABLE: TransferStatus[] = ['Enviado a Destino', 'Novedad de Entrega'];

/**
 * Registra la entrega de una parada: TF entregadas -> Entregado en Tienda, no entregadas -> Novedad de Entrega.
 * Reintentos con el mismo submissionId devuelven éxito sin repetir nada.
 */
export async function submitDeliveryStop(
  input: SubmitDeliveryStopInput
): Promise<{ success: boolean; already?: boolean; conflict?: boolean; stopStatus?: DeliveryStopStatus; error?: string }> {
  const { manifestDocId, stopId, submissionId, actor } = input;
  if (!actor?.userId) return { success: false, error: 'Sesión no válida. Vuelva a iniciar sesión.' };
  const delivered = new Set(input.deliveredTfs.map((t) => String(t).trim()));
  const notDelivered = new Map(Object.entries(input.notDelivered || {}).map(([k, v]) => [String(k).trim(), String(v || '').trim()]));
  const photos = (input.photos || []).slice(0, MAX_DELIVERY_PHOTOS);

  if (delivered.size > 0 && !photos.some((p) => p.category === 'remision')) {
    return { success: false, error: 'Falta la foto de la remisión firmada.' };
  }
  if (delivered.size > 0 && !String(input.receivedByName || '').trim()) {
    return { success: false, error: 'Falta el nombre de quien recibe.' };
  }
  if (Array.from(notDelivered.values()).some((r) => !r)) {
    return { success: false, error: 'Cada TF no entregada necesita un motivo.' };
  }

  try {
    const storesSnap = await getDocs(collection(firestore, 'deliveryStores'));
    const matchStore = buildStoreMatcher(storesSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as DeliveryStore));

    const manifestRef = doc(firestore, 'deliveryManifests', manifestDocId);
    const stopRef = doc(manifestRef, 'stops', stopId);
    const actorName = (actor.displayName || '').trim() || actor.userId;

    return await runTransaction(firestore, async (tx) => {
      const [mSnap, sSnap] = await Promise.all([tx.get(manifestRef), tx.get(stopRef)]);
      if (!mSnap.exists() || !sSnap.exists()) throw new Error('La relación o la parada ya no existe.');
      const manifest = mSnap.data() as any;
      const stop = sSnap.data() as any;

      if (stop.status && stop.status !== 'pendiente') {
        if (stop.submissionId === submissionId) return { success: true, already: true, stopStatus: stop.status };
        return {
          success: false,
          conflict: true,
          error: `Esta parada ya fue registrada${stop.completedByName ? ` por ${stop.completedByName}` : ''}.`,
        };
      }
      if (manifest.deliveryStatus && manifest.deliveryStatus !== 'en_ruta') {
        return { success: false, conflict: true, error: 'La relación ya no está en ruta.' };
      }

      const transferIds: string[] = Array.isArray(stop.transferIds) ? stop.transferIds : [];
      const tSnaps = await Promise.all(transferIds.map((id) => tx.get(doc(firestore, 'transfers', id))));
      const tfOf = (d: (typeof tSnaps)[number]) => String(d.data()?.numeroTF || d.id).trim();

      const missing = Array.from(new Set(tSnaps.map(tfOf))).filter((tf) => !delivered.has(tf) && !notDelivered.has(tf));
      if (missing.length > 0) throw new Error(`Falta marcar ${missing.length} TF como entregada o no entregada.`);

      const now = Timestamp.now();
      const deliveredIds: string[] = [];
      const notDeliveredIds: string[] = [];
      tSnaps.forEach((d) => {
        if (!d.exists()) return;
        const status = d.data()?.status as TransferStatus;
        const tf = tfOf(d);
        if (delivered.has(tf)) {
          deliveredIds.push(d.id);
          if (!DELIVERABLE.includes(status)) return;
          tx.update(d.ref, {
            status: 'Entregado en Tienda',
            entregadoTiendaAt: now,
            entregadoTiendaBy: actor.userId,
            entregadoTiendaByName: actorName,
            podManifestDocId: manifestDocId,
            podStopId: stopId,
            statusHistory: arrayUnion({ status: 'Entregado en Tienda', at: now, userId: actor.userId, userName: actorName }),
          });
        } else {
          notDeliveredIds.push(d.id);
          if (status !== 'Enviado a Destino') return;
          tx.update(d.ref, {
            status: 'Novedad de Entrega',
            novedadEntregaAt: now,
            novedadEntregaBy: actor.userId,
            novedadEntregaByName: actorName,
            novedadEntregaMotivo: notDelivered.get(tf) || '',
            podManifestDocId: manifestDocId,
            podStopId: stopId,
            statusHistory: arrayUnion({ status: 'Novedad de Entrega', at: now, userId: actor.userId, userName: actorName }),
          });
        }
      });

      const stopStatus: DeliveryStopStatus =
        deliveredIds.length === 0 ? 'no_entregada' : notDeliveredIds.length === 0 ? 'entregada' : 'parcial';

      const store = matchStore(stop.storeCode || stop.destino);
      const gps = input.gps
        ? { lat: input.gps.lat, lng: input.gps.lng, accuracyM: input.gps.accuracyM, at: Timestamp.fromDate(new Date(input.gps.at)) }
        : null;
      const distanceM =
        gps && store && typeof store.latitud === 'number' && typeof store.longitud === 'number'
          ? distanceMeters({ lat: gps.lat, lng: gps.lng }, { lat: store.latitud, lng: store.longitud })
          : undefined;

      tx.update(
        stopRef,
        clean({
          status: stopStatus,
          deliveredTransferIds: deliveredIds,
          notDeliveredTransferIds: notDeliveredIds,
          notDeliveredReasons: Object.fromEntries(notDelivered),
          photos: photos.map((p) => ({ ...p, uploadedAt: now })),
          gps,
          distanceM,
          receivedByName: String(input.receivedByName || '').trim() || undefined,
          notes: String(input.notes || '').trim() || undefined,
          completedAt: now,
          completedById: actor.userId,
          completedByName: actorName,
          submissionId,
          ...(store && !stop.storeCode ? { storeCode: store.codigoErp, storeName: store.nombreCorto } : {}),
        })
      );

      const stopsCount = Number(manifest.stopsCount || 0);
      const stopsDone = Number(manifest.stopsDone || 0) + 1;
      tx.update(manifestRef, {
        stopsDone,
        ...(stopsCount > 0 && stopsDone >= stopsCount ? { deliveryStatus: 'pendiente_validacion', deliveryCompletedAt: now } : {}),
      });

      return { success: true, stopStatus };
    });
  } catch (error: any) {
    console.error('Error registrando entrega:', error);
    return { success: false, error: error.message || 'No se pudo registrar la entrega.' };
  }
}

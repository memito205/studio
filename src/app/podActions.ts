'use server';

import {
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  documentId,
  type DocumentData,
} from 'firebase/firestore';
import { firestore } from '@/services/firebase';
import { buildStoreMatcher, DEFAULT_STORE_RADIUS_M } from '@/lib/deliveryStores';
import { getDeliveryStoresCached } from '@/lib/deliveryStoresCache';
import { MAX_DELIVERY_PHOTOS, POD_START_AT } from '@/lib/pod';

const PLATFORM_COLLECTION = 'tf_platform_status';
const platformTf = (v: unknown) => {
  const digits = String(v || '').replace(/\D/g, '');
  return digits ? String(Number(digits)) : '';
};
const platformWhs = (v: unknown) => String(v || '').trim().toUpperCase();
/** Mismo id que publica el analizador (`buildTfPlatformDocId`). */
const platformDocId = (tf: unknown, whs: unknown) => `${platformTf(tf)}_${platformWhs(whs).replace(/[^A-Z0-9]/g, '_')}`;
import type {
  DeliveryManifest,
  DeliveryManifestStop,
  DeliveryPhoto,
  DeliveryStopStatus,
  DeliveryStopTf,
  DeliveryStore,
  StoreReceipt,
  StoreReceiptResult,
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
      .filter((m) => m.createdAt instanceof Date && m.createdAt >= POD_START_AT)
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
    const [mSnap, stopsSnap, stores] = await Promise.all([
      getDoc(manifestRef),
      getDocs(collection(manifestRef, 'stops')),
      getDeliveryStoresCached(),
    ]);
    if (!mSnap.exists()) return { error: 'La relación no existe.' };
    const manifest = toDates({ id: mSnap.id, ...mSnap.data() }) as DeliveryManifest;
    const stops = stopsSnap.docs.map((d) => toDates({ id: d.id, ...d.data() }) as DeliveryManifestStop);
    const matchStore = buildStoreMatcher(stores);

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
          if (t?.storeReceivedAt instanceof Timestamp && !cur.storeReceivedAt) {
            cur.storeReceivedAt = t.storeReceivedAt.toDate();
            cur.storeReceivedByName = t.storeReceivedByName || undefined;
          }
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

export type PlatformLine = {
  id: string;
  numeroTF: string;
  bodegaDestino: string;
  bodegaOrigen?: string;
  cantidad: number;
  fechaDocumento: unknown;
  marca?: string;
  grupo?: string;
  delivered: boolean;
  motivo?: string;
};
export type PlatformPublish = { lines: PlatformLine[]; at: Timestamp; pod: Record<string, unknown>; photoUrls: string[] };

/**
 * Entregada en la app -> ENTREGADO con fuente app (manda sobre Quick e inferida).
 * No entregada -> solo deja la novedad; el estado plataforma no cambia.
 */
export async function publishPodToPlatform({ lines, at, pod, photoUrls }: PlatformPublish) {
  for (const l of lines) {
    const ref = doc(firestore, PLATFORM_COLLECTION, l.id);
    const snap = await getDoc(ref);
    const cur = snap.exists() ? (snap.data() as any) : null;
    if (!l.delivered) {
      if (cur) await updateDoc(ref, { podNovedad: clean({ at, motivo: l.motivo, ...pod }), updatedAt: at });
      continue;
    }
    const previousLinks: string[] = Array.isArray(cur?.evidenceLinks) ? cur.evidenceLinks : [];
    const quickLinks: string[] =
      cur?.podSource === 'app' ? (Array.isArray(cur?.quickEvidenceLinks) ? cur.quickEvidenceLinks : []) : previousLinks;
    await setDoc(
      ref,
      clean({
        ...(cur && cur.podSource !== 'app'
          ? {
              podPrev: {
                estadoPlataforma: cur.estadoPlataforma ?? null,
                evidenceLinks: previousLinks,
                entregaInferida: cur.entregaInferida ?? null,
                entregaInferidaMotivo: cur.entregaInferidaMotivo ?? null,
                fechaFinalizado: cur.fechaFinalizado ?? null,
                source: cur.source ?? null,
              },
            }
          : {}),
        ...(cur
          ? {}
          : {
              podCreated: true,
              id: l.id,
              numeroTF: l.numeroTF,
              bodegaDestino: l.bodegaDestino,
              bodegaOrigen: l.bodegaOrigen,
              cantidad: l.cantidad,
              fechaDocumento: l.fechaDocumento,
              marca: l.marca,
              grupo: l.grupo,
            }),
        estadoPlataforma: 'ENTREGADO',
        entregaInferida: false,
        entregaInferidaMotivo: null,
        fechaFinalizado: at,
        evidenceLinks: [...photoUrls, ...quickLinks.filter((u) => !photoUrls.includes(u))],
        quickEvidenceLinks: quickLinks,
        podSource: 'app',
        podNovedad: null,
        source: 'pod_app',
        updatedAt: at,
      }),
      { merge: true }
    );
    await updateDoc(ref, { pod: clean(pod) });
  }
}

/** Entregas registradas en la app, para que el analizador las use como evidencia (manda sobre Quick). */
export async function getAppPodIndex(): Promise<{
  data?: Array<{ numeroTF: string; bodegaDestino: string; at: string; photoUrl?: string; byName?: string; manifestId?: number }>;
  error?: string;
}> {
  try {
    const snap = await getDocs(query(collection(firestore, PLATFORM_COLLECTION), where('podSource', '==', 'app')));
    const data = snap.docs.map((d) => {
      const r = d.data() as any;
      const at = r.pod?.at instanceof Timestamp ? r.pod.at.toDate() : r.fechaFinalizado instanceof Timestamp ? r.fechaFinalizado.toDate() : null;
      return {
        numeroTF: String(r.numeroTF || ''),
        bodegaDestino: String(r.bodegaDestino || ''),
        at: at ? at.toISOString() : '',
        photoUrl: Array.isArray(r.evidenceLinks) ? r.evidenceLinks[0] : undefined,
        byName: r.pod?.byName,
        manifestId: r.pod?.manifestId,
      };
    });
    return { data };
  } catch (error: any) {
    return { error: error.message || 'No se pudieron leer las entregas de la app.' };
  }
}

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

  if (Array.from(notDelivered.values()).some((r) => !r)) {
    return { success: false, error: 'Cada TF no entregada necesita un motivo.' };
  }

  try {
    const matchStore = buildStoreMatcher(await getDeliveryStoresCached());

    const manifestRef = doc(firestore, 'deliveryManifests', manifestDocId);
    const stopRef = doc(manifestRef, 'stops', stopId);
    const actorName = (actor.displayName || '').trim() || actor.userId;
    const publish: { value: PlatformPublish | null } = { value: null };

    const result = await runTransaction(firestore, async (tx) => {
      publish.value = null;
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

      const storeReceivedTfs = new Set(tSnaps.filter((d) => d.data()?.storeReceivedAt).map(tfOf));
      const missing = Array.from(new Set(tSnaps.map(tfOf))).filter(
        (tf) => !delivered.has(tf) && !notDelivered.has(tf) && !storeReceivedTfs.has(tf)
      );
      if (missing.length > 0) throw new Error(`Falta marcar ${missing.length} TF como entregada o no entregada.`);
      storeReceivedTfs.forEach((tf) => notDelivered.delete(tf));
      const needsProof = Array.from(delivered).some((tf) => !storeReceivedTfs.has(tf));
      if (needsProof && !photos.some((p) => p.category === 'remision')) throw new Error('Falta la foto de la remisión firmada.');
      if (needsProof && !String(input.receivedByName || '').trim()) throw new Error('Falta el nombre de quien recibe.');

      const now = Timestamp.now();
      const deliveredIds: string[] = [];
      const notDeliveredIds: string[] = [];
      tSnaps.forEach((d) => {
        if (!d.exists()) return;
        const status = d.data()?.status as TransferStatus;
        const tf = tfOf(d);
        if (delivered.has(tf) || storeReceivedTfs.has(tf)) {
          deliveredIds.push(d.id);
          if (!DELIVERABLE.includes(status)) return;
          tx.update(d.ref, {
            status: 'Entregado en Tienda',
            entregadoTiendaAt: now,
            entregadoTiendaBy: actor.userId,
            entregadoTiendaByName: actorName,
            reprogramada: false,
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
            reprogramada: false,
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

      const lines = new Map<string, PlatformLine>();
      tSnaps.forEach((d) => {
        if (!d.exists()) return;
        const t = d.data() as any;
        // Recibida por la tienda y el conductor no la entregó con fotos: se deja la constancia de la tienda.
        if (storeReceivedTfs.has(tfOf(d)) && (!delivered.has(tfOf(d)) || photos.length === 0)) return;
        const id = platformDocId(t.numeroTF, t.bodegaDestino);
        const cur = lines.get(id) || {
          id,
          numeroTF: platformTf(t.numeroTF),
          bodegaDestino: platformWhs(t.bodegaDestino),
          bodegaOrigen: platformWhs(t.bodegaOrigen) || undefined,
          cantidad: 0,
          fechaDocumento: t.fecha ?? null,
          marca: String(t.marca || '').trim() || undefined,
          grupo: String(t.grupo || '').trim() || undefined,
          delivered: delivered.has(tfOf(d)) || storeReceivedTfs.has(tfOf(d)),
          motivo: notDelivered.get(tfOf(d)),
        };
        cur.cantidad += Number(t.cantidad || 0) || 0;
        lines.set(id, cur);
      });
      publish.value = {
        lines: Array.from(lines.values()),
        at: now,
        pod: clean({
          at: now,
          byId: actor.userId,
          byName: actorName,
          receivedByName: String(input.receivedByName || '').trim() || undefined,
          manifestDocId,
          manifestId: manifest.manifestId,
          stopId,
          photosCount: photos.length,
          distanceM,
        }),
        photoUrls: [...photos.filter((p) => p.category === 'remision'), ...photos.filter((p) => p.category !== 'remision')].map((p) => p.url),
      };

      return { success: true, stopStatus };
    });

    if (result.success && !result.already && publish.value) {
      await publishPodToPlatform(publish.value).catch((e) => console.error('Entrega registrada sin estado plataforma:', e));
    }
    return result;
  } catch (error: any) {
    console.error('Error registrando entrega:', error);
    return { success: false, error: error.message || 'No se pudo registrar la entrega.' };
  }
}

const actorNameOf = (actor: TransferActor) => (actor.displayName || '').trim() || actor.userId;

export type AdminStop = DeliveryManifestStop & {
  radiusM: number;
  distanceAlert: boolean;
  deliveredTfs: string[];
  notDeliveredTfs: string[];
};
export type AdminManifest = DeliveryManifest & {
  /** Creada antes de pruebas de entrega: no se puede terminar desde la app. */
  legacy: boolean;
  stops: AdminStop[];
};

/** Relaciones con paradas: todas las abiertas + las creadas en el rango. */
export async function getPodAdminManifests(opts: {
  from: string;
  to: string;
}): Promise<{ data?: AdminManifest[]; error?: string }> {
  try {
    const col = collection(firestore, 'deliveryManifests');
    const [openSnap, rangeSnap, stores] = await Promise.all([
      getDocs(query(col, where('deliveryStatus', 'in', ['en_ruta', 'pendiente_validacion']))),
      getDocs(
        query(
          col,
          where('createdAt', '>=', Timestamp.fromDate(new Date(opts.from))),
          where('createdAt', '<=', Timestamp.fromDate(new Date(opts.to)))
        )
      ),
      getDeliveryStoresCached(),
    ]);
    const matchStore = buildStoreMatcher(stores);
    const docs = new Map<string, (typeof openSnap.docs)[number]>();
    [...openSnap.docs, ...rangeSnap.docs].forEach((d) => {
      if (d.data().deliveryStatus) docs.set(d.id, d);
    });

    const data = await Promise.all(
      Array.from(docs.values()).map(async (d) => {
        const m = toDates({ id: d.id, ...d.data() }) as DeliveryManifest;
        const stopsSnap = await getDocs(collection(d.ref, 'stops'));
        const stops: AdminStop[] = stopsSnap.docs
          .map((s) => {
            const st = toDates({ id: s.id, ...s.data() }) as DeliveryManifestStop;
            const store = matchStore(st.storeCode || st.destino);
            const radiusM = store?.radioValidacionM || DEFAULT_STORE_RADIUS_M;
            const notDeliveredTfs = Object.keys(st.notDeliveredReasons || {});
            const done = !!st.status && st.status !== 'pendiente';
            return {
              ...st,
              ...(store && !st.storeName ? { storeCode: store.codigoErp, storeName: store.nombreCorto } : {}),
              radiusM,
              distanceAlert: typeof st.distanceM === 'number' && st.distanceM > radiusM,
              notDeliveredTfs,
              deliveredTfs: done ? (st.numerosTF || []).filter((tf) => !notDeliveredTfs.includes(String(tf).trim())) : [],
            };
          })
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        return { ...m, legacy: !(m.createdAt instanceof Date && m.createdAt >= POD_START_AT), stops };
      })
    );
    data.sort((a, b) => (b.manifestId || 0) - (a.manifestId || 0));
    return { data };
  } catch (error: any) {
    return { error: error.message || 'No se pudieron cargar las relaciones.' };
  }
}

/** Aprueba la relación completa (todas las paradas registradas) y la cierra. */
export async function approveDeliveryManifest(input: {
  manifestDocId: string;
  note?: string;
  actor: TransferActor;
}): Promise<{ success: boolean; error?: string }> {
  if (!input.actor?.userId) return { success: false, error: 'Sesión no válida.' };
  try {
    const ref = doc(firestore, 'deliveryManifests', input.manifestDocId);
    await runTransaction(firestore, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('La relación no existe.');
      if (snap.data().deliveryStatus !== 'pendiente_validacion') {
        throw new Error('Solo se aprueban relaciones con todas las paradas registradas.');
      }
      tx.update(
        ref,
        clean({
          deliveryStatus: 'cerrada',
          validatedAt: Timestamp.now(),
          validatedById: input.actor.userId,
          validatedByName: actorNameOf(input.actor),
          validationNote: String(input.note || '').trim() || undefined,
        })
      );
    });
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || 'No se pudo aprobar la relación.' };
  }
}

/** Cierra una relación en ruta sin terminarla en la app. No cambia el estado de las TF. */
export async function closeDeliveryManifestWithoutApp(input: {
  manifestDocId: string;
  note: string;
  actor: TransferActor;
}): Promise<{ success: boolean; error?: string }> {
  if (!input.actor?.userId) return { success: false, error: 'Sesión no válida.' };
  const note = String(input.note || '').trim();
  if (!note) return { success: false, error: 'Escriba el motivo del cierre.' };
  try {
    const ref = doc(firestore, 'deliveryManifests', input.manifestDocId);
    await runTransaction(firestore, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('La relación no existe.');
      if (snap.data().deliveryStatus !== 'en_ruta') throw new Error('La relación ya no está en ruta.');
      tx.update(ref, {
        deliveryStatus: 'cerrada',
        closedWithoutApp: true,
        closedAt: Timestamp.now(),
        closedById: input.actor.userId,
        closedByName: actorNameOf(input.actor),
        closedNote: note,
      });
    });
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || 'No se pudo cerrar la relación.' };
  }
}

/** Deshace en plataforma la entrega publicada por la parada rechazada (vuelve al último estado de Quick). */
async function revertPodPlatform(ids: string[], manifestDocId: string, stopId: string) {
  for (const id of ids) {
    const ref = doc(firestore, PLATFORM_COLLECTION, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) continue;
    const r = snap.data() as any;
    if (r.podSource === 'app' && r.pod?.stopId === stopId && r.pod?.manifestDocId === manifestDocId) {
      const sr = r.storeReceipt;
      if (sr?.at) {
        await updateDoc(ref, {
          estadoPlataforma: 'ENTREGADO',
          evidenceLinks: r.quickEvidenceLinks ?? [],
          fechaFinalizado: sr.at,
          pod: clean({ at: sr.at, byId: sr.byId, byName: sr.byName, kind: 'tienda', storeCode: sr.storeCode, storeName: sr.storeName, photosCount: 0 }),
          updatedAt: Timestamp.now(),
        });
        continue;
      }
      const prev = r.podPrev;
      if (!prev && r.podCreated) {
        await deleteDoc(ref);
        continue;
      }
      await setDoc(
        ref,
        {
          estadoPlataforma: prev?.estadoPlataforma ?? 'EN BODEGA',
          evidenceLinks: prev?.evidenceLinks ?? r.quickEvidenceLinks ?? [],
          entregaInferida: prev?.entregaInferida ?? false,
          entregaInferidaMotivo: prev?.entregaInferidaMotivo ?? deleteField(),
          fechaFinalizado: prev?.fechaFinalizado ?? null,
          source: prev?.source ?? deleteField(),
          podSource: deleteField(),
          pod: deleteField(),
          podPrev: deleteField(),
          podCreated: deleteField(),
          quickEvidenceLinks: deleteField(),
          updatedAt: Timestamp.now(),
        },
        { merge: true }
      );
    } else if (r.podNovedad?.stopId === stopId && r.podNovedad?.manifestDocId === manifestDocId) {
      await setDoc(ref, { podNovedad: null, updatedAt: Timestamp.now() }, { merge: true });
    }
  }
}

/**
 * Rechaza el registro de una parada: vuelve a pendiente para que el conductor la registre de nuevo
 * y sus TF regresan a Enviado a Destino. El registro anterior queda en `rejections`.
 */
export async function rejectDeliveryStop(input: {
  manifestDocId: string;
  stopId: string;
  note: string;
  actor: TransferActor;
}): Promise<{ success: boolean; reverted?: number; skipped?: number; error?: string }> {
  const { manifestDocId, stopId, actor } = input;
  if (!actor?.userId) return { success: false, error: 'Sesión no válida.' };
  const note = String(input.note || '').trim();
  if (!note) return { success: false, error: 'Escriba el motivo del rechazo para el conductor.' };
  try {
    const manifestRef = doc(firestore, 'deliveryManifests', manifestDocId);
    const stopRef = doc(manifestRef, 'stops', stopId);
    const actorName = actorNameOf(actor);
    const platformIds: { value: string[] } = { value: [] };

    const result = await runTransaction(firestore, async (tx) => {
      const [mSnap, sSnap] = await Promise.all([tx.get(manifestRef), tx.get(stopRef)]);
      if (!mSnap.exists() || !sSnap.exists()) throw new Error('La relación o la parada ya no existe.');
      const manifest = mSnap.data() as any;
      const stop = sSnap.data() as any;
      if (manifest.deliveryStatus === 'cerrada') throw new Error('La relación ya está cerrada; no se puede rechazar.');
      if (!stop.status || stop.status === 'pendiente') throw new Error('La parada no tiene entrega registrada.');

      const transferIds: string[] = Array.isArray(stop.transferIds) ? stop.transferIds : [];
      const tSnaps = await Promise.all(transferIds.map((id) => tx.get(doc(firestore, 'transfers', id))));
      const now = Timestamp.now();
      const ids = new Set<string>();
      let reverted = 0;
      let skipped = 0;
      tSnaps.forEach((d) => {
        if (!d.exists()) return;
        const t = d.data() as any;
        ids.add(platformDocId(t.numeroTF, t.bodegaDestino));
        const fromThisStop = t.podManifestDocId === manifestDocId && t.podStopId === stopId;
        if (!fromThisStop || t.storeReceivedAt || (t.status !== 'Entregado en Tienda' && t.status !== 'Novedad de Entrega')) {
          skipped++;
          return;
        }
        tx.update(d.ref, {
          status: 'Enviado a Destino',
          entregadoTiendaAt: deleteField(),
          entregadoTiendaBy: deleteField(),
          entregadoTiendaByName: deleteField(),
          novedadEntregaAt: deleteField(),
          novedadEntregaBy: deleteField(),
          novedadEntregaByName: deleteField(),
          novedadEntregaMotivo: deleteField(),
          podRechazadaAt: now,
          statusHistory: arrayUnion({ status: 'Enviado a Destino', at: now, userId: actor.userId, userName: actorName }),
        });
        reverted++;
      });

      const rejection = { at: now, byId: actor.userId, byName: actorName, note };
      tx.update(stopRef, {
        status: 'pendiente',
        lastRejection: rejection,
        rejections: arrayUnion({
          ...rejection,
          previous: clean({
            status: stop.status,
            completedAt: stop.completedAt ?? null,
            completedByName: stop.completedByName ?? null,
            receivedByName: stop.receivedByName ?? null,
            submissionId: stop.submissionId ?? null,
            photos: stop.photos || [],
            gps: stop.gps ?? null,
            distanceM: stop.distanceM ?? null,
            notes: stop.notes ?? null,
            deliveredTransferIds: stop.deliveredTransferIds || [],
            notDeliveredTransferIds: stop.notDeliveredTransferIds || [],
            notDeliveredReasons: stop.notDeliveredReasons || {},
          }),
        }),
        deliveredTransferIds: deleteField(),
        notDeliveredTransferIds: deleteField(),
        notDeliveredReasons: deleteField(),
        photos: deleteField(),
        gps: deleteField(),
        distanceM: deleteField(),
        receivedByName: deleteField(),
        notes: deleteField(),
        completedAt: deleteField(),
        completedById: deleteField(),
        completedByName: deleteField(),
        submissionId: deleteField(),
      });
      tx.update(manifestRef, {
        stopsDone: Math.max(0, Number(manifest.stopsDone || 0) - 1),
        deliveryStatus: 'en_ruta',
        deliveryCompletedAt: deleteField(),
      });
      platformIds.value = Array.from(ids);
      return { success: true, reverted, skipped };
    });

    await revertPodPlatform(platformIds.value, manifestDocId, stopId).catch((e) =>
      console.error('Parada rechazada sin revertir estado plataforma:', e)
    );
    return result;
  } catch (error: any) {
    return { success: false, error: error.message || 'No se pudo rechazar la parada.' };
  }
}

export type PodNovedadLine = {
  id: string;
  numeroTF: string;
  bodegaDestino: string;
  cantidad: number;
  codigoAlterno?: string;
  motivo: string;
  at: string | null;
  byName?: string;
  manifestDocId?: string;
  manifestId?: number;
  placa?: string;
};

/** Líneas en Novedad de Entrega pendientes de decisión del admin. */
export async function getPodNovedades(): Promise<{ data?: PodNovedadLine[]; error?: string }> {
  try {
    const snap = await getDocs(query(collection(firestore, 'transfers'), where('status', '==', 'Novedad de Entrega')));
    const manifestIds = Array.from(
      new Set(snap.docs.map((d) => String(d.data().podManifestDocId || '')).filter(Boolean))
    );
    const manifests = new Map<string, DocumentData>();
    for (let i = 0; i < manifestIds.length; i += 30) {
      const ms = await getDocs(
        query(collection(firestore, 'deliveryManifests'), where(documentId(), 'in', manifestIds.slice(i, i + 30)))
      );
      ms.forEach((m) => manifests.set(m.id, m.data()));
    }
    const data: PodNovedadLine[] = snap.docs.map((d) => {
      const t = d.data() as any;
      const m = t.podManifestDocId ? manifests.get(t.podManifestDocId) : undefined;
      const at = t.novedadEntregaAt instanceof Timestamp ? t.novedadEntregaAt.toDate() : null;
      return {
        id: d.id,
        numeroTF: String(t.numeroTF || '').trim(),
        bodegaDestino: String(t.bodegaDestino || '').trim(),
        cantidad: Number(t.cantidad || 0) || 0,
        codigoAlterno: String(t.codigoAlterno || '').trim() || undefined,
        motivo: String(t.novedadEntregaMotivo || '').trim(),
        at: at ? at.toISOString() : null,
        byName: t.novedadEntregaByName || undefined,
        manifestDocId: t.podManifestDocId || undefined,
        manifestId: m?.manifestId,
        placa: m?.resource,
      };
    });
    return { data };
  } catch (error: any) {
    return { error: error.message || 'No se pudieron cargar las novedades.' };
  }
}

/**
 * Decide sobre TF en Novedad de Entrega; ambas vuelven a Recibido en Bodega.
 * Reprogramar además la marca para que salga de primera en el Gestor.
 */
export async function resolvePodNovedades(input: {
  transferIds: string[];
  action: 'reprogramar' | 'devolver';
  note?: string;
  actor: TransferActor;
}): Promise<{ success: boolean; updated?: number; skipped?: number; error?: string }> {
  const { actor, action } = input;
  if (!actor?.userId) return { success: false, error: 'Sesión no válida.' };
  const ids = Array.from(new Set((input.transferIds || []).filter(Boolean)));
  if (ids.length === 0) return { success: false, error: 'Seleccione al menos una TF.' };
  const actorName = actorNameOf(actor);
  const note = String(input.note || '').trim() || undefined;
  let updated = 0;
  let skipped = 0;
  try {
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const res = await runTransaction(firestore, async (tx) => {
        const snaps = await Promise.all(chunk.map((id) => tx.get(doc(firestore, 'transfers', id))));
        const now = Timestamp.now();
        let ok = 0;
        let skip = 0;
        const touched: string[] = [];
        snaps.forEach((s) => {
          const t = s.data() as any;
          if (!s.exists() || t?.status !== 'Novedad de Entrega') {
            skip++;
            return;
          }
          tx.update(
            s.ref,
            clean({
              status: 'Recibido en Bodega',
              reprogramada: action === 'reprogramar',
              novedadResolucion: action,
              novedadResueltaAt: now,
              novedadResueltaBy: actor.userId,
              novedadResueltaByName: actorName,
              novedadResolucionNota: note,
              statusHistory: arrayUnion({ status: 'Recibido en Bodega', at: now, userId: actor.userId, userName: actorName }),
            })
          );
          touched.push(platformDocId(t.numeroTF, t.bodegaDestino));
          ok++;
        });
        return { ok, skip, touched, now };
      });
      updated += res.ok;
      skipped += res.skip;
      for (const id of res.touched) {
        const ref = doc(firestore, PLATFORM_COLLECTION, id);
        const snap = await getDoc(ref).catch(() => null);
        if (snap?.exists() && snap.data()?.podNovedad) {
          await setDoc(
            ref,
            { podNovedad: { resolucion: action, resueltaAt: res.now, resueltaByName: actorName }, updatedAt: res.now },
            { merge: true }
          ).catch(() => undefined);
        }
      }
    }
    return { success: true, updated, skipped };
  } catch (error: any) {
    return { success: false, updated, skipped, error: error.message || 'No se pudo aplicar la decisión.' };
  }
}

const STORE_RECEIPTS = 'storeReceipts';
const bogotaDay = (d = new Date()) => new Date(d.getTime() - 5 * 3600 * 1000).toISOString().slice(0, 10);
const normalizeAlt = (v: unknown) => String(v ?? '').trim().toUpperCase().replace(/\s+/g, '');

export type StoreReceiveResponse = {
  result: StoreReceiptResult | 'error';
  message: string;
  numeroTF?: string;
  codigoAlterno?: string;
  lines?: number;
  unidades?: number;
  otherDestino?: string;
  previousAt?: string;
  previousByName?: string;
};

/**
 * Lectura en tienda (etiqueta DESTINO-TF, número TF o código alterno).
 * Si la TF es de esta tienda y no estaba recibida -> Entregado en Tienda. Siempre deja registro.
 */
export async function receiveAtStore(input: {
  code: string;
  storeCode: string;
  actor: TransferActor;
}): Promise<StoreReceiveResponse> {
  const { actor } = input;
  if (!actor?.userId) return { result: 'error', message: 'Sesión no válida.' };
  const code = String(input.code || '').trim().toUpperCase().replace(/['\/]/g, '-');
  if (!code) return { result: 'error', message: 'Escanee un código.' };
  const actorName = actorNameOf(actor);

  try {
    const stores = await getDeliveryStoresCached();
    const store = stores.find((s) => s.codigoErp === input.storeCode);
    if (!store) return { result: 'error', message: 'Su usuario no tiene una tienda válida asignada.' };
    const matchStore = buildStoreMatcher(stores);
    const isMine = (dest: unknown) => {
      const s = matchStore(String(dest || ''));
      return s ? s.codigoErp === store.codigoErp : String(dest || '').trim().toUpperCase() === store.codigoErp.toUpperCase();
    };

    const now = Timestamp.now();
    const day = bogotaDay(now.toDate());
    const log = (data: Record<string, unknown>) =>
      setDoc(
        doc(collection(firestore, STORE_RECEIPTS)),
        clean({
          code,
          storeCode: store.codigoErp,
          storeName: store.nombreCorto,
          at: now,
          day,
          storeDay: `${store.codigoErp}|${day}`,
          byId: actor.userId,
          byName: actorName,
          ...data,
        })
      ).catch((e) => console.error('No se pudo guardar la lectura de tienda:', e));

    const transfersRef = collection(firestore, 'transfers');
    const byTf = async (tf: string) => (await getDocs(query(transfersRef, where('numeroTF', '==', tf)))).docs;
    let docs = await byTf(code);
    if (docs.length === 0 && code.includes('-')) {
      docs = await byTf(code.slice(code.lastIndexOf('-') + 1).trim());
    }
    if (docs.length === 0 && /^\d+$/.test(code) && String(Number(code)) !== code) {
      docs = await byTf(String(Number(code)));
    }
    let altCode: string | undefined;
    if (docs.length === 0) {
      altCode = normalizeAlt(code);
      docs = (await getDocs(query(transfersRef, where('codigoAlterno', '==', altCode)))).docs;
      if (docs.length === 0) {
        const receipts = await getDocs(query(collection(firestore, 'altCodeReceipts'), where('codigoAlterno', '==', altCode)));
        const pending = receipts.docs.find((d) => d.data().status !== 'void');
        if (pending) {
          await setDoc(
            pending.ref,
            { storeReceivedAt: now, storeReceivedByName: actorName, storeReceivedStoreCode: store.codigoErp },
            { merge: true }
          );
          await log({ result: 'alterno_sin_tf', codigoAlterno: altCode });
          return {
            result: 'alterno_sin_tf',
            codigoAlterno: altCode,
            message: `El código alterno ${altCode} todavía no está enlazado a una TF. Quedó registrado; avise a logística.`,
          };
        }
        await log({ result: 'no_encontrada' });
        return { result: 'no_encontrada', message: `No se encontró ninguna TF ni código alterno con "${code}".` };
      }
    }

    const mine = docs.filter((d) => isMine(d.data().bodegaDestino));
    const numeroTF = String((mine[0] || docs[0]).data().numeroTF || '').trim();
    if (mine.length === 0) {
      const destinos = Array.from(new Set(docs.map((d) => String(d.data().bodegaDestino || '').trim())));
      const names = destinos.map((dest) => matchStore(dest)?.nombreCorto || dest).join(', ');
      await log({ result: 'otro_destino', numeroTF, codigoAlterno: altCode, otherDestino: destinos.join(', ') });
      return {
        result: 'otro_destino',
        numeroTF,
        codigoAlterno: altCode,
        otherDestino: names,
        message: `La TF ${numeroTF} va para ${names}, no para ${store.nombreCorto}. No se registró como recibida.`,
      };
    }

    const pendingDocs = mine.filter((d) => d.data().status !== 'Entregado en Tienda');
    const unidades = mine.reduce((n, d) => n + (Number(d.data().cantidad || 0) || 0), 0);
    const unconfirmed = mine.filter((d) => !d.data().storeReceivedAt);
    if (pendingDocs.length === 0 && unconfirmed.length > 0) {
      const deliveredBy = unconfirmed[0].data().entregadoTiendaByName as string | undefined;
      await Promise.all(
        unconfirmed.map((d) =>
          updateDoc(d.ref, { storeReceivedAt: now, storeReceivedBy: actor.userId, storeReceivedByName: actorName, storeReceivedCode: code })
        )
      );
      const storeReceipt = { at: now, byId: actor.userId, byName: actorName, storeCode: store.codigoErp, storeName: store.nombreCorto };
      const platformIds = new Set(unconfirmed.map((d) => platformDocId(d.data().numeroTF, d.data().bodegaDestino)));
      for (const id of platformIds) {
        await setDoc(doc(firestore, PLATFORM_COLLECTION, id), { storeReceipt, updatedAt: now }, { merge: true }).catch(() => undefined);
      }
      await log({ result: 'recibida', numeroTF, codigoAlterno: altCode, transferIds: unconfirmed.map((d) => d.id), unidades, previousStatuses: ['Entregado en Tienda'] });
      return {
        result: 'recibida',
        numeroTF,
        codigoAlterno: altCode,
        lines: unconfirmed.length,
        unidades,
        message: `TF ${numeroTF} confirmada en ${store.nombreCorto}${deliveredBy ? ` (la entregó ${deliveredBy})` : ''}.`,
      };
    }
    if (pendingDocs.length === 0) {
      const first = mine
        .map((d) => d.data())
        .sort((a, b) => (a.entregadoTiendaAt?.toMillis?.() || 0) - (b.entregadoTiendaAt?.toMillis?.() || 0))[0];
      const prevAt = first?.entregadoTiendaAt instanceof Timestamp ? first.entregadoTiendaAt.toDate().toISOString() : undefined;
      await log({ result: 'ya_recibida', numeroTF, codigoAlterno: altCode, transferIds: mine.map((d) => d.id), unidades });
      return {
        result: 'ya_recibida',
        numeroTF,
        codigoAlterno: altCode,
        unidades,
        previousAt: prevAt,
        previousByName: first?.entregadoTiendaByName,
        message: `La TF ${numeroTF} ya estaba recibida.`,
      };
    }

    const previousStatuses = new Set<string>();
    const updatedIds: string[] = [];
    await runTransaction(firestore, async (tx) => {
      previousStatuses.clear();
      updatedIds.length = 0;
      const snaps = await Promise.all(pendingDocs.map((d) => tx.get(d.ref)));
      snaps.forEach((s) => {
        const t = s.data() as any;
        if (!s.exists() || t.status === 'Entregado en Tienda') return;
        previousStatuses.add(String(t.status || ''));
        updatedIds.push(s.id);
        tx.update(s.ref, {
          status: 'Entregado en Tienda',
          entregadoTiendaAt: now,
          entregadoTiendaBy: actor.userId,
          entregadoTiendaByName: actorName,
          storeReceivedAt: now,
          storeReceivedBy: actor.userId,
          storeReceivedByName: actorName,
          storeReceivedCode: code,
          reprogramada: false,
          statusHistory: arrayUnion({ status: 'Entregado en Tienda', at: now, userId: actor.userId, userName: actorName }),
        });
      });
    });

    const lines = new Map<string, PlatformLine>();
    mine.forEach((d) => {
      const t = d.data() as any;
      const id = platformDocId(t.numeroTF, t.bodegaDestino);
      const cur = lines.get(id) || {
        id,
        numeroTF: platformTf(t.numeroTF),
        bodegaDestino: platformWhs(t.bodegaDestino),
        bodegaOrigen: platformWhs(t.bodegaOrigen) || undefined,
        cantidad: 0,
        fechaDocumento: t.fecha ?? null,
        marca: String(t.marca || '').trim() || undefined,
        grupo: String(t.grupo || '').trim() || undefined,
        delivered: true,
      };
      cur.cantidad += Number(t.cantidad || 0) || 0;
      lines.set(id, cur);
    });
    const storeReceipt = { at: now, byId: actor.userId, byName: actorName, storeCode: store.codigoErp, storeName: store.nombreCorto };
    for (const line of lines.values()) {
      const ref = doc(firestore, PLATFORM_COLLECTION, line.id);
      const cur = await getDoc(ref).catch(() => null);
      if (cur?.exists() && cur.data()?.podSource === 'app') {
        await setDoc(ref, { storeReceipt, updatedAt: now }, { merge: true }).catch(() => undefined);
      } else {
        await publishPodToPlatform({
          lines: [line],
          at: now,
          pod: { at: now, byId: actor.userId, byName: actorName, kind: 'tienda', storeCode: store.codigoErp, storeName: store.nombreCorto, photosCount: 0 },
          photoUrls: [],
        }).catch((e) => console.error('Recibido en tienda sin estado plataforma:', e));
        await setDoc(ref, { storeReceipt }, { merge: true }).catch(() => undefined);
      }
    }

    await log({
      result: 'recibida',
      numeroTF,
      codigoAlterno: altCode,
      transferIds: updatedIds,
      unidades,
      previousStatuses: Array.from(previousStatuses),
    });
    return {
      result: 'recibida',
      numeroTF,
      codigoAlterno: altCode,
      lines: updatedIds.length,
      unidades,
      message: `TF ${numeroTF} recibida en ${store.nombreCorto}.`,
    };
  } catch (error: any) {
    console.error('Error recibiendo en tienda:', error);
    return { result: 'error', message: error.message || 'No se pudo registrar la lectura.' };
  }
}

/** Lecturas en tienda de un día (todas las tiendas, o solo una). */
export async function getStoreReceipts(opts: {
  day: string;
  storeCode?: string;
}): Promise<{ data?: StoreReceipt[]; error?: string }> {
  try {
    const q = opts.storeCode
      ? query(collection(firestore, STORE_RECEIPTS), where('storeDay', '==', `${opts.storeCode}|${opts.day}`))
      : query(collection(firestore, STORE_RECEIPTS), where('day', '==', opts.day));
    const snap = await getDocs(q);
    const data = snap.docs
      .map((d) => toDates({ id: d.id, ...d.data() }) as StoreReceipt)
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return { data };
  } catch (error: any) {
    return { error: error.message || 'No se pudieron cargar las lecturas.' };
  }
}

/** Números TF etiquetados con el código alterno (para la búsqueda). */
export async function findTfsByAltCode(code: string): Promise<{ data?: string[]; error?: string }> {
  const raw = String(code || '').trim();
  if (!raw) return { data: [] };
  try {
    const variants = Array.from(new Set([raw, raw.toUpperCase(), raw.toUpperCase().replace(/\s+/g, '')]));
    const snap = await getDocs(query(collection(firestore, 'transfers'), where('codigoAlterno', 'in', variants)));
    return { data: Array.from(new Set(snap.docs.map((d) => String(d.data().numeroTF || '').trim()).filter(Boolean))) };
  } catch (error: any) {
    return { error: error.message || 'No se pudo buscar el código alterno.' };
  }
}

/** Entregas del periodo en plataforma: con prueba de la app vs Quick vs inferidas. */
export async function getPodPlatformShare(opts: {
  from: string;
  to: string;
}): Promise<{ data?: { entregados: number; app: number; quick: number; inferidos: number }; error?: string }> {
  try {
    const snap = await getDocs(
      query(
        collection(firestore, PLATFORM_COLLECTION),
        where('fechaFinalizado', '>=', Timestamp.fromDate(new Date(opts.from))),
        where('fechaFinalizado', '<=', Timestamp.fromDate(new Date(opts.to)))
      )
    );
    const out = { entregados: 0, app: 0, quick: 0, inferidos: 0 };
    snap.forEach((d) => {
      const r = d.data() as any;
      if (r.estadoPlataforma !== 'ENTREGADO') return;
      out.entregados++;
      if (r.podSource === 'app') out.app++;
      else if (r.entregaInferida) out.inferidos++;
      else out.quick++;
    });
    return { data: out };
  } catch (error: any) {
    return { error: error.message || 'No se pudo calcular la fuente de las entregas.' };
  }
}

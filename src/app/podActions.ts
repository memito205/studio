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
  where,
  documentId,
  type DocumentData,
} from 'firebase/firestore';
import { firestore } from '@/services/firebase';
import { buildStoreMatcher, DEFAULT_STORE_RADIUS_M } from '@/lib/deliveryStores';
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

type PlatformLine = {
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
type PlatformPublish = { lines: PlatformLine[]; at: Timestamp; pod: Record<string, unknown>; photoUrls: string[] };

/**
 * Entregada en la app -> ENTREGADO con fuente app (manda sobre Quick e inferida).
 * No entregada -> solo deja la novedad; el estado plataforma no cambia.
 */
async function publishPodToPlatform({ lines, at, pod, photoUrls }: PlatformPublish) {
  for (const l of lines) {
    const ref = doc(firestore, PLATFORM_COLLECTION, l.id);
    const snap = await getDoc(ref);
    const cur = snap.exists() ? (snap.data() as any) : null;
    if (!l.delivered) {
      if (cur) await setDoc(ref, { podNovedad: clean({ at, motivo: l.motivo, ...pod }), updatedAt: at }, { merge: true });
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
        pod,
        podNovedad: null,
        source: 'pod_app',
        updatedAt: at,
      }),
      { merge: true }
    );
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
          delivered: delivered.has(tfOf(d)),
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
    const [openSnap, rangeSnap, storesSnap] = await Promise.all([
      getDocs(query(col, where('deliveryStatus', 'in', ['en_ruta', 'pendiente_validacion']))),
      getDocs(
        query(
          col,
          where('createdAt', '>=', Timestamp.fromDate(new Date(opts.from))),
          where('createdAt', '<=', Timestamp.fromDate(new Date(opts.to)))
        )
      ),
      getDocs(collection(firestore, 'deliveryStores')),
    ]);
    const matchStore = buildStoreMatcher(storesSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as DeliveryStore));
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
        if (!fromThisStop || (t.status !== 'Entregado en Tienda' && t.status !== 'Novedad de Entrega')) {
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

'use server';

import {
  arrayUnion,
  collection,
  deleteField,
  doc,
  getDocs,
  query,
  runTransaction,
  Timestamp,
  where,
  writeBatch,
  type DocumentData,
  type DocumentReference,
} from 'firebase/firestore';
import { firestore } from '@/services/firebase';
import { buildStoreMatcher } from '@/lib/deliveryStores';
import { publishPodToPlatform, type PlatformLine } from '@/app/podActions';
import type { DeliveryStore, DriverRouteTask, DriverRouteTaskPhoto, TransferActor, TransferStatus } from '@/types';

const TASKS = 'routeTasks';
/** Puntos que no son tiendas: se agregan al maestro sin GPS para poder asignarles tareas. */
const NON_STORE_POINTS = ['TRASLADOS', 'OFICINA', 'GARANTIAS', 'RECEPCION', 'CAJON NORTE'];
/** Dejar la mercancía aquí = sigue la recepción normal en bodega (sin prueba de entrega). */
const BODEGA_POINTS = ['BODEGA', 'CAJON NORTE', 'BODEGA PIONEROS', 'PIONEROS', 'RECEPCION'];
const DELIVERABLE: TransferStatus[] = ['Recolectado en Ruta', 'En Tránsito', 'Enviado a Destino', 'Novedad de Entrega'];

const platformTf = (v: unknown) => {
  const digits = String(v || '').replace(/\D/g, '');
  return digits ? String(Number(digits)) : '';
};
const platformWhs = (v: unknown) => String(v || '').trim().toUpperCase();
const platformDocId = (tf: unknown, whs: unknown) => `${platformTf(tf)}_${platformWhs(whs).replace(/[^A-Z0-9]/g, '_')}`;
const normPoint = (v: unknown) => String(v || '').trim().toUpperCase();
const actorNameOf = (a: TransferActor) => (a.displayName || '').trim() || a.userId;

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
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
};

const toTask = (id: string, data: DocumentData) => toDates({ id, ...data }) as DriverRouteTask;

async function loadStores() {
  const snap = await getDocs(collection(firestore, 'deliveryStores'));
  const stores = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as DeliveryStore);
  return { stores, match: buildStoreMatcher(stores) };
}

/** Crea en el maestro (sin GPS) los puntos no-tienda usados por el mensajero que aún no existan. */
async function ensureNonStorePoints(points: string[], stores: DeliveryStore[], actorName: string) {
  const match = buildStoreMatcher(stores);
  const missing = Array.from(new Set(points.map(normPoint))).filter((p) => NON_STORE_POINTS.includes(p) && !match(p));
  if (missing.length === 0) return [] as DeliveryStore[];
  const batch = writeBatch(firestore);
  const created: DeliveryStore[] = missing.map((p) => ({
    id: p.replace(/[^A-Z0-9]/g, '_'),
    codigoErp: p,
    nombreCorto: p,
    nombreTienda: p,
    ciudad: '',
    direccion: '',
    latitud: null,
    longitud: null,
    codigosEquivalentes: [],
    radioValidacionM: 300,
    quienesReciben: [],
    activo: true,
  }));
  created.forEach((s) => batch.set(doc(firestore, 'deliveryStores', s.id), { ...s, updatedAt: Timestamp.now(), updatedByName: actorName }));
  await batch.commit();
  return created;
}

export type NewRouteTask = {
  /** TF, o en envíos sin TF el código MSJ ya asignado (reasignación). */
  numeroTF?: string;
  kind?: 'tf' | 'libre';
  description?: string;
  refText?: string;
  transferIds?: string[];
  bodegaDestino?: string;
  pickupPoint?: string;
  deliverPoint: string;
  order?: number;
  notes?: string;
};

/**
 * Asigna tareas a un conductor/mensajero. Una TF no puede tener dos tareas abiertas a la vez.
 * Lecturas: maestro de tiendas + líneas de las TF (lotes de 30) + tareas abiertas de esas TF.
 */
export async function createRouteTasks(input: {
  tasks: NewRouteTask[];
  driverId: string;
  driverName: string;
  placa: string;
  day: string;
  source: DriverRouteTask['source'];
  actor: TransferActor;
  reassignedFrom?: Record<string, string>;
}): Promise<{ success: boolean; created?: number; skipped?: Array<{ numeroTF: string; reason: string }>; error?: string }> {
  const { actor } = input;
  if (!actor?.userId) return { success: false, error: 'Sesión no válida.' };
  if (!input.driverId) return { success: false, error: 'Elija el conductor (usuario con app).' };
  const placa = normPoint(input.placa);
  if (placa.length < 3) return { success: false, error: 'La placa es obligatoria (mínimo 3 caracteres).' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day)) return { success: false, error: 'Día inválido.' };
  const tasks = input.tasks.filter(
    (t) => normPoint(t.deliverPoint) && (t.kind === 'libre' ? String(t.description || t.refText || '').trim() : String(t.numeroTF || '').trim())
  );
  if (tasks.length === 0) return { success: false, error: 'No hay tareas para asignar.' };
  const actorName = actorNameOf(actor);

  try {
    let { stores, match } = await loadStores();
    if (input.source === 'planificador') {
      const created = await ensureNonStorePoints(
        tasks.flatMap((t) => [t.pickupPoint || '', t.deliverPoint]),
        stores,
        actorName
      );
      if (created.length) {
        stores = [...stores, ...created];
        match = buildStoreMatcher(stores);
      }
    }

    const tfs = Array.from(new Set(tasks.filter((t) => t.kind !== 'libre').map((t) => String(t.numeroTF).trim())));
    const linesByTf = new Map<string, Array<{ id: string; data: DocumentData }>>();
    const openTfs = new Set<string>();
    for (let i = 0; i < tfs.length; i += 30) {
      const chunk = tfs.slice(i, i + 30);
      const [lines, open] = await Promise.all([
        getDocs(query(collection(firestore, 'transfers'), where('numeroTF', 'in', chunk))),
        getDocs(query(collection(firestore, TASKS), where('openKey', 'in', chunk))),
      ]);
      lines.docs.forEach((d) => {
        const tf = String(d.data().numeroTF || '').trim();
        const list = linesByTf.get(tf) || [];
        list.push({ id: d.id, data: d.data() });
        linesByTf.set(tf, list);
      });
      open.docs.forEach((d) => openTfs.add(String(d.data().openKey)));
    }

    // En el planificador, lo que no existe como TF se registra como envío sin TF.
    const prepared = tasks.map((t) => {
      if (t.kind === 'libre') return { ...t, kind: 'libre' as const };
      const tf = String(t.numeroTF).trim();
      if (input.source === 'planificador' && !linesByTf.has(tf)) {
        return { ...t, kind: 'libre' as const, numeroTF: undefined, refText: tf, description: t.description || tf };
      }
      return { ...t, kind: 'tf' as const };
    });
    const needCodes = prepared.filter((t) => t.kind === 'libre' && !/^MSJ-/.test(String(t.numeroTF || ''))).length;
    let nextSeq = 0;
    if (needCodes > 0) {
      const seqRef = doc(firestore, 'systemJobs', `routeFreeSeq_${input.day}`);
      nextSeq = await runTransaction(firestore, async (tx) => {
        const s = await tx.get(seqRef);
        const last = s.exists() ? Number(s.data().seq) || 0 : 0;
        tx.set(seqRef, { seq: last + needCodes, day: input.day, updatedAt: Timestamp.now() });
        return last + 1;
      });
    }
    const dayCode = input.day.replace(/-/g, '');

    const skipped: Array<{ numeroTF: string; reason: string }> = [];
    const batches = [writeBatch(firestore)];
    const batch = {
      set: (ref: DocumentReference, data: DocumentData) => {
        if (created > 0 && created % 450 === 0) batches.push(writeBatch(firestore));
        batches[batches.length - 1].set(ref, data);
      },
    };
    const now = Timestamp.now();
    let created = 0;
    const seen = new Set<string>();
    for (const t of prepared) {
      const isLibre = t.kind === 'libre';
      const tf = isLibre
        ? /^MSJ-/.test(String(t.numeroTF || '')) ? String(t.numeroTF) : `MSJ-${dayCode}-${String(nextSeq++).padStart(3, '0')}`
        : String(t.numeroTF).trim();
      if (!isLibre && (openTfs.has(tf) || seen.has(tf))) {
        skipped.push({ numeroTF: tf, reason: 'Ya tiene una tarea abierta' });
        continue;
      }
      seen.add(tf);
      const deliverStore = match(t.deliverPoint);
      const pickupStore = t.pickupPoint ? match(t.pickupPoint) : undefined;
      const allLines = isLibre ? [] : linesByTf.get(tf) || [];
      let lines = t.transferIds?.length ? allLines.filter((l) => t.transferIds!.includes(l.id)) : allLines;
      if (!t.transferIds?.length && t.bodegaDestino) {
        lines = lines.filter((l) => platformWhs(l.data.bodegaDestino) === platformWhs(t.bodegaDestino));
      } else if (!t.transferIds?.length && deliverStore && lines.length > 1) {
        const forStore = lines.filter((l) => match(l.data.bodegaDestino)?.codigoErp === deliverStore.codigoErp);
        if (forStore.length) lines = forStore;
      }
      const first = lines[0]?.data;
      const deliverPoint = deliverStore?.nombreCorto || normPoint(t.deliverPoint);
      const ref = doc(collection(firestore, TASKS));
      batch.set(
        ref,
        clean({
          numeroTF: tf,
          kind: isLibre ? 'libre' : undefined,
          description: isLibre ? String(t.description || t.refText || '').trim().slice(0, 200) : undefined,
          refText: isLibre ? t.refText?.trim() || undefined : undefined,
          transferIds: lines.map((l) => l.id),
          bodegaOrigen: first ? platformWhs(first.bodegaOrigen) || undefined : undefined,
          bodegaDestino: first ? platformWhs(first.bodegaDestino) || undefined : t.bodegaDestino,
          unidades: lines.reduce((n, l) => n + (Number(l.data.cantidad) || 0), 0),
          pickupPoint: t.pickupPoint ? pickupStore?.nombreCorto || normPoint(t.pickupPoint) : undefined,
          pickupStoreCode: pickupStore?.codigoErp,
          deliverPoint,
          deliverStoreCode: deliverStore?.codigoErp,
          deliverType: BODEGA_POINTS.includes(normPoint(t.deliverPoint)) || BODEGA_POINTS.includes(normPoint(deliverPoint)) ? 'bodega' : 'tienda',
          status: t.pickupPoint ? 'por_recoger' : 'por_entregar',
          driverId: input.driverId,
          driverName: input.driverName,
          driverOpen: `${input.driverId}|open`,
          openKey: isLibre ? undefined : tf,
          placa,
          day: input.day,
          order: t.order,
          source: input.source,
          notes: t.notes?.trim() || undefined,
          reassignedFrom: input.reassignedFrom?.[tf],
          createdAt: now,
          createdById: actor.userId,
          createdByName: actorName,
        })
      );
      created++;
    }
    if (created > 0) for (const b of batches) await b.commit();
    return { success: true, created, skipped };
  } catch (error: any) {
    console.error('createRouteTasks:', error);
    return { success: false, error: error.message || 'No se pudieron crear las tareas.' };
  }
}

/** Tareas abiertas del conductor (1 consulta de igualdad; solo lo pendiente). */
export async function getMyRouteTasks(driverId: string): Promise<{ data?: DriverRouteTask[]; error?: string }> {
  try {
    if (!driverId) return { data: [] };
    const snap = await getDocs(query(collection(firestore, TASKS), where('driverOpen', '==', `${driverId}|open`)));
    const data = snap.docs
      .map((d) => toTask(d.id, d.data()))
      .sort((a, b) => a.day.localeCompare(b.day) || (a.order ?? 9999) - (b.order ?? 9999) || a.numeroTF.localeCompare(b.numeroTF, undefined, { numeric: true }));
    return { data };
  } catch (error: any) {
    return { error: error.message || 'No se pudieron cargar las tareas.' };
  }
}

/** Tareas en un rango de días (máx. 31) para el buscador; filtra texto en memoria. */
export async function getRouteTasksByRange(from: string, to: string): Promise<{ data?: DriverRouteTask[]; error?: string }> {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return { error: 'Rango de fechas inválido.' };
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
    if (days > 31) return { error: 'Consulte máximo 31 días.' };
    const snap = await getDocs(query(collection(firestore, TASKS), where('day', '>=', from), where('day', '<=', to)));
    const data = snap.docs
      .map((d) => toTask(d.id, d.data()))
      .sort((a, b) => b.day.localeCompare(a.day) || a.driverName.localeCompare(b.driverName) || (a.order ?? 9999) - (b.order ?? 9999));
    return { data };
  } catch (error: any) {
    return { error: error.message || 'No se pudieron cargar las tareas.' };
  }
}

/** Tareas de un día (admin). */
export async function getRouteTasksByDay(day: string): Promise<{ data?: DriverRouteTask[]; error?: string }> {
  try {
    const snap = await getDocs(query(collection(firestore, TASKS), where('day', '==', day)));
    const data = snap.docs
      .map((d) => toTask(d.id, d.data()))
      .sort((a, b) => a.driverName.localeCompare(b.driverName) || (a.order ?? 9999) - (b.order ?? 9999));
    return { data };
  } catch (error: any) {
    return { error: error.message || 'No se pudieron cargar las tareas.' };
  }
}

export type RouteTaskAction = 'recoger' | 'no_recoger' | 'entregar' | 'no_entregar';

export type SubmitRouteTasksInput = {
  action: RouteTaskAction;
  taskIds: string[];
  submissionId: string;
  photos: DriverRouteTaskPhoto[];
  gps: { lat: number; lng: number; accuracyM?: number; at: string } | null;
  receivedByName?: string;
  reason?: string;
  notes?: string;
  actor: TransferActor;
};

/**
 * Registro del conductor sobre un grupo de tareas del mismo punto.
 * Reintentos con el mismo submissionId devuelven éxito sin repetir nada.
 */
export async function submitRouteTasks(
  input: SubmitRouteTasksInput
): Promise<{ success: boolean; already?: boolean; conflict?: boolean; error?: string }> {
  const { actor, action, submissionId } = input;
  if (!actor?.userId) return { success: false, error: 'Sesión no válida. Vuelva a iniciar sesión.' };
  if (!input.taskIds?.length) return { success: false, error: 'No hay tareas seleccionadas.' };
  const reason = String(input.reason || '').trim();
  if ((action === 'no_recoger' || action === 'no_entregar') && !reason) return { success: false, error: 'Indique el motivo.' };
  if (action === 'recoger' && input.photos.length === 0) return { success: false, error: 'Tome la foto de lo que recoge.' };
  const actorName = actorNameOf(actor);

  try {
    const { match } = action === 'entregar' ? await loadStores() : { match: (_: unknown) => undefined as DeliveryStore | undefined };
    const publishLines = new Map<string, PlatformLine>();
    const podMeta: { distanceM?: number; placa?: string; taskIds: string[] } = { taskIds: [] };

    const result = await runTransaction(firestore, async (tx) => {
      publishLines.clear();
      podMeta.taskIds = [];
      const refs = input.taskIds.map((id) => doc(firestore, TASKS, id));
      const snaps = await Promise.all(refs.map((r) => tx.get(r)));
      const tasks = snaps.filter((s) => s.exists()).map((s) => ({ ref: s.ref, t: toTask(s.id, s.data()!), raw: s.data()! }));
      if (tasks.length === 0) throw new Error('Las tareas ya no existen.');
      if (tasks.every((x) => x.raw.lastSubmissionId === submissionId)) return { success: true, already: true };
      const expected = action === 'recoger' || action === 'no_recoger' ? 'por_recoger' : 'por_entregar';
      const stale = tasks.find((x) => x.t.status !== expected);
      if (stale) {
        return { success: false, conflict: true, error: `La TF ${stale.t.numeroTF} ya no está pendiente (${stale.t.status}). Actualice la lista.` };
      }
      if (tasks.some((x) => x.t.driverId !== actor.userId)) {
        return { success: false, conflict: true, error: 'Estas tareas están asignadas a otro conductor.' };
      }
      const toStore = action === 'entregar' && tasks.some((x) => x.t.kind !== 'libre' && x.t.deliverType === 'tienda');
      const libreDelivery = action === 'entregar' && tasks.some((x) => x.t.kind === 'libre');
      if (toStore && !input.photos.some((p) => p.category === 'remision')) throw new Error('Falta la foto de la remisión firmada.');
      if (libreDelivery && input.photos.length === 0) throw new Error('Tome la foto de la entrega.');
      if ((toStore || libreDelivery) && !String(input.receivedByName || '').trim()) throw new Error('Falta el nombre de quien recibe.');

      const lineIds = action === 'recoger' || action === 'entregar' ? Array.from(new Set(tasks.flatMap((x) => x.t.transferIds || []))) : [];
      const lineSnaps = await Promise.all(lineIds.map((id) => tx.get(doc(firestore, 'transfers', id))));
      const lineById = new Map(lineSnaps.filter((s) => s.exists()).map((s) => [s.id, s]));

      const now = Timestamp.now();
      const gps = input.gps
        ? { lat: input.gps.lat, lng: input.gps.lng, accuracyM: input.gps.accuracyM, at: Timestamp.fromDate(new Date(input.gps.at)) }
        : null;
      const photos = input.photos.map((p) => clean({ path: p.path, url: p.url, category: p.category }));
      const closeKeys = { driverOpen: deleteField(), openKey: deleteField() };

      if (action === 'no_recoger' || action === 'no_entregar') {
        tasks.forEach(({ ref }) =>
          tx.update(ref, clean({
            status: action === 'no_recoger' ? 'no_recogida' : 'no_entregada',
            failedAt: now,
            failedById: actor.userId,
            failedByName: actorName,
            failReason: reason,
            failNotes: String(input.notes || '').trim() || undefined,
            failPhotos: photos.length ? photos : undefined,
            failGps: gps,
            lastSubmissionId: submissionId,
            ...closeKeys,
          }))
        );
        return { success: true };
      }

      if (action === 'recoger') {
        const logRef = doc(collection(firestore, 'collectionLogs'));
        const changed: string[] = [];
        const destinations: Record<string, number> = {};
        tasks.forEach(({ t }) =>
          (t.transferIds || []).forEach((id) => {
            const s = lineById.get(id);
            if (!s || s.data()?.status !== 'En Tránsito') return;
            const d = s.data()!;
            changed.push(id);
            destinations[d.bodegaDestino] = (destinations[d.bodegaDestino] || 0) + (Number(d.cantidad) || 1);
            tx.update(s.ref, {
              status: 'Recolectado en Ruta',
              recibidoAt: now,
              recolectadoBy: actor.userId,
              recolectadoByName: actorName,
              routeTaskId: t.id,
              statusHistory: arrayUnion({ status: 'Recolectado en Ruta', at: now, userId: actor.userId, userName: actorName }),
            });
          })
        );
        if (changed.length) {
          tx.set(logRef, {
            createdAt: now,
            placa: tasks[0].t.placa,
            transferIds: changed,
            recolectadoPor: actor.userId,
            recolectadoPorNombre: actorName,
            routeTaskIds: tasks.map((x) => x.t.id),
            photos,
            summary: { totalTransfers: changed.length, destinations },
          });
        }
        tasks.forEach(({ ref }) =>
          tx.update(ref, clean({
            status: 'por_entregar',
            pickedAt: now,
            pickedById: actor.userId,
            pickedByName: actorName,
            pickupPhotos: photos,
            pickupGps: gps,
            collectionLogId: changed.length ? logRef.id : undefined,
            lastSubmissionId: submissionId,
          }))
        );
        return { success: true };
      }

      // entregar
      tasks.forEach(({ ref, t }) => {
        const store = t.deliverStoreCode ? match(t.deliverStoreCode) : match(t.deliverPoint);
        const distanceM =
          gps && store && typeof store.latitud === 'number' && typeof store.longitud === 'number'
            ? distanceMeters({ lat: gps.lat, lng: gps.lng }, { lat: store.latitud, lng: store.longitud })
            : undefined;
        let marked = false;
        if (t.deliverType === 'tienda' && store) {
          (t.transferIds || []).forEach((id) => {
            const s = lineById.get(id);
            if (!s) return;
            const d = s.data()!;
            if (match(d.bodegaDestino)?.codigoErp !== store.codigoErp) return;
            marked = true;
            if (d.storeReceivedAt || !DELIVERABLE.includes(d.status)) return;
            const pid = platformDocId(d.numeroTF, d.bodegaDestino);
            const line = publishLines.get(pid) || {
              id: pid,
              numeroTF: platformTf(d.numeroTF),
              bodegaDestino: platformWhs(d.bodegaDestino),
              bodegaOrigen: platformWhs(d.bodegaOrigen) || undefined,
              cantidad: 0,
              fechaDocumento: d.fecha ?? null,
              marca: String(d.marca || '').trim() || undefined,
              grupo: String(d.grupo || '').trim() || undefined,
              delivered: true,
            };
            line.cantidad += Number(d.cantidad || 0) || 0;
            publishLines.set(pid, line);
            tx.update(s.ref, {
              status: 'Entregado en Tienda',
              entregadoTiendaAt: now,
              entregadoTiendaBy: actor.userId,
              entregadoTiendaByName: actorName,
              reprogramada: false,
              routeTaskId: t.id,
              statusHistory: arrayUnion({ status: 'Entregado en Tienda', at: now, userId: actor.userId, userName: actorName }),
            });
          });
        }
        if (distanceM !== undefined) podMeta.distanceM = distanceM;
        podMeta.placa = t.placa;
        podMeta.taskIds.push(t.id);
        tx.update(ref, clean({
          status: 'entregada',
          deliveredAt: now,
          deliveredById: actor.userId,
          deliveredByName: actorName,
          deliveryPhotos: photos,
          deliveryGps: gps,
          receivedByName: String(input.receivedByName || '').trim() || undefined,
          deliveryNotes: String(input.notes || '').trim() || undefined,
          distanceM,
          tfMarkedDelivered: marked,
          lastSubmissionId: submissionId,
          ...closeKeys,
        }));
      });
      return { success: true };
    });

    if (result.success && !result.already && publishLines.size > 0 && input.photos.length > 0) {
      const now = Timestamp.now();
      const ordered = [...input.photos.filter((p) => p.category === 'remision'), ...input.photos.filter((p) => p.category !== 'remision')];
      await publishPodToPlatform({
        lines: Array.from(publishLines.values()),
        at: now,
        pod: clean({
          at: now,
          byId: actor.userId,
          byName: actorName,
          kind: 'ruta',
          receivedByName: String(input.receivedByName || '').trim() || undefined,
          routeTaskIds: podMeta.taskIds,
          placa: podMeta.placa,
          photosCount: input.photos.length,
          distanceM: podMeta.distanceM,
        }),
        photoUrls: ordered.map((p) => p.url),
      }).catch((e) => console.error('Entrega de ruta sin estado plataforma:', e));
    }
    return result;
  } catch (error: any) {
    console.error('submitRouteTasks:', error);
    return { success: false, error: error.message || 'No se pudo registrar.' };
  }
}

/** Cancela tareas abiertas (admin). */
export async function cancelRouteTasks(input: { taskIds: string[]; actor: TransferActor; note?: string }): Promise<{ success: boolean; cancelled?: number; error?: string }> {
  if (!input.actor?.userId) return { success: false, error: 'Sesión no válida.' };
  try {
    let cancelled = 0;
    await runTransaction(firestore, async (tx) => {
      cancelled = 0;
      const snaps = await Promise.all(input.taskIds.map((id) => tx.get(doc(firestore, TASKS, id))));
      const now = Timestamp.now();
      snaps.forEach((s) => {
        if (!s.exists() || !['por_recoger', 'por_entregar'].includes(s.data().status)) return;
        cancelled++;
        tx.update(s.ref, {
          status: 'cancelada',
          failedAt: now,
          failedByName: actorNameOf(input.actor),
          failReason: String(input.note || '').trim() || 'Cancelada por el administrador',
          driverOpen: deleteField(),
          openKey: deleteField(),
        });
      });
    });
    return { success: true, cancelled };
  } catch (error: any) {
    return { success: false, error: error.message || 'No se pudieron cancelar.' };
  }
}

/** Reasigna (no recogidas / no entregadas / canceladas / abiertas) a otro conductor o día. */
export async function reassignRouteTasks(input: {
  taskIds: string[];
  driverId: string;
  driverName: string;
  placa: string;
  day: string;
  actor: TransferActor;
}): Promise<{ success: boolean; created?: number; skipped?: Array<{ numeroTF: string; reason: string }>; error?: string }> {
  if (!input.actor?.userId) return { success: false, error: 'Sesión no válida.' };
  try {
    const olds: Array<{ id: string; t: DriverRouteTask }> = [];
    await runTransaction(firestore, async (tx) => {
      olds.length = 0;
      const snaps = await Promise.all(input.taskIds.map((id) => tx.get(doc(firestore, TASKS, id))));
      snaps.forEach((s) => {
        if (!s.exists()) return;
        const t = toTask(s.id, s.data());
        if (t.status === 'entregada' || t.reassignedTo) return;
        olds.push({ id: s.id, t });
        tx.update(s.ref, {
          ...(t.status === 'por_recoger' || t.status === 'por_entregar'
            ? { status: 'cancelada', failReason: 'Reasignada', failedAt: Timestamp.now(), failedByName: actorNameOf(input.actor) }
            : {}),
          reassignedTo: 'pendiente',
          driverOpen: deleteField(),
          openKey: deleteField(),
        });
      });
    });
    if (olds.length === 0) return { success: false, error: 'No hay tareas para reasignar (ya entregadas o reasignadas).' };
    const res = await createRouteTasks({
      tasks: olds.map(({ t }) => ({
        numeroTF: t.numeroTF,
        kind: t.kind,
        description: t.description,
        refText: t.refText,
        transferIds: t.transferIds,
        // Si ya la recogió (no entregada), la nueva tarea es solo entregar.
        pickupPoint: t.pickedAt ? undefined : t.pickupPoint,
        deliverPoint: t.deliverStoreCode || t.deliverPoint,
        notes: t.notes,
      })),
      driverId: input.driverId,
      driverName: input.driverName,
      placa: input.placa,
      day: input.day,
      source: olds[0].t.source,
      actor: input.actor,
      reassignedFrom: Object.fromEntries(olds.map(({ id, t }) => [t.numeroTF, id])),
    });
    const batch = writeBatch(firestore);
    olds.forEach(({ id }) => batch.update(doc(firestore, TASKS, id), { reassignedTo: res.success ? 'si' : deleteField() }));
    await batch.commit();
    return res;
  } catch (error: any) {
    return { success: false, error: error.message || 'No se pudo reasignar.' };
  }
}

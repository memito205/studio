'use server';

import {
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  documentId,
  getDoc,
  getDocs,
  query,
  runTransaction,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type DocumentReference,
} from 'firebase/firestore';
import { firestore } from '@/services/firebase';
import { buildStoreMatcher } from '@/lib/deliveryStores';
import { getDeliveryStoresCached, invalidateDeliveryStoresCache } from '@/lib/deliveryStoresCache';
import { computeMessengerDayOrders } from '@/lib/messengerRouteOrder';
import { publishPodToPlatform, type PlatformLine } from '@/app/podActions';
import type { DeliveryStore, DriverRouteTask, DriverRouteTaskPhoto, TransferActor, TransferStatus } from '@/types';

const TASKS = 'routeTasks';
/** Puntos que no son tiendas: se agregan al maestro sin GPS para poder asignarles tareas. */
const NON_STORE_POINTS = ['TRASLADOS', 'OFICINA', 'GARANTIAS', 'RECEPCION', 'CAJON NORTE'];
/** Dejar la mercancía aquí = sigue la recepción normal en bodega (sin prueba de entrega). */
const BODEGA_POINTS = ['BODEGA', 'CAJON NORTE', 'BODEGA PIONEROS', 'PIONEROS', 'RECEPCION'];
const DELIVERABLE: TransferStatus[] = ['Recolectado en Ruta', 'En Tránsito', 'Enviado a Destino', 'Novedad de Entrega'];
const NOVEDAD_FROM: TransferStatus[] = ['Recolectado en Ruta', 'En Tránsito', 'Enviado a Destino'];
/** Cajón externo donde el mensajero deja lo que no pudo entregar. */
const CAJON_POINT = 'CAJON NORTE';
const isInCajon = (d: DocumentData) => d.status === 'Recibido en Bodega' && normPoint(d.ubicacion) === CAJON_POINT;
const isCajonPickupPoint = (v: unknown) => /CAJ[OÓ]N/i.test(normPoint(v));

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
  const stores = await getDeliveryStoresCached();
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
  invalidateDeliveryStoresCache();
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
  deliverOrder?: number;
  notes?: string;
  pickupKind?: 'camion' | 'cajon' | 'otro';
  waitingForHandoff?: boolean;
  handoffFromManifestId?: string;
  handoffStopId?: string;
  handoffManifestNumber?: number;
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
  collectionLogId?: string;
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
    // Obliga a cerrar rutas de días anteriores antes de montar una nueva.
    const prior = await getDriverOpenPriorDayTasks(input.driverId, input.day);
    if (prior.days.length > 0) {
      const detail = prior.days.map((d) => `${d} (${prior.countByDay[d]} pendiente(s))`).join(', ');
      return {
        success: false,
        error: `El mensajero tiene ruta sin cerrar de día(s) anterior(es): ${detail}. Debe cerrarla (o rechazar/corregir entregas) antes de montar la del ${input.day}.`,
      };
    }

    // Órdenes finales: reorderMessengerDayRoute (camión → cajón → Norte).
    tasks.forEach((t) => {
      if (t.pickupKind === 'camion' || t.handoffFromManifestId) {
        t.pickupKind = t.pickupKind || 'camion';
        t.order = t.order ?? 1;
        if (t.deliverOrder == null) t.deliverOrder = 50;
      } else if (isCajonPickupPoint(t.pickupPoint)) {
        t.pickupKind = t.pickupKind || 'cajon';
        t.order = t.order ?? 2;
        if (t.deliverOrder == null) t.deliverOrder = 50;
      }
    });

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
          pickupPoint: t.pickupPoint
            ? t.pickupKind === 'camion'
              ? normPoint(t.pickupPoint)
              : pickupStore?.nombreCorto || normPoint(t.pickupPoint)
            : undefined,
          pickupStoreCode: pickupStore?.codigoErp,
          pickupKind: t.pickupKind || (isCajonPickupPoint(t.pickupPoint) ? 'cajon' : undefined),
          waitingForHandoff: t.waitingForHandoff === true ? true : undefined,
          handoffFromManifestId: t.handoffFromManifestId || undefined,
          handoffStopId: t.handoffStopId || undefined,
          handoffManifestNumber: t.handoffManifestNumber || undefined,
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
          deliverOrder: t.deliverOrder,
          source: input.source,
          notes: t.notes?.trim() || undefined,
          collectionLogId: input.collectionLogId || undefined,
          reassignedFrom: input.reassignedFrom?.[tf],
          createdAt: now,
          createdById: actor.userId,
          createdByName: actorName,
        })
      );
      created++;
    }
    if (created > 0) {
      for (const b of batches) await b.commit();
      // Unifica prioridad y evita manuales/tiendas fragmentadas al final.
      const re = await reorderMessengerDayRoute({ driverId: input.driverId, day: input.day, actor });
      if (!re.success) console.warn('createRouteTasks: reorder falló', re.error);
    }
    return { success: true, created, skipped };
  } catch (error: any) {
    console.error('createRouteTasks:', error);
    return { success: false, error: error.message || 'No se pudieron crear las tareas.' };
  }
}

/**
 * Reescribe order/deliverOrder del día del mensajero.
 * Sin `customOrder`: secuencia planificador Norte.
 * Con `customOrder` (texto tipo "B12, MOL, B1"): mismo criterio que Importar orden del planificador.
 * Lecturas: 1 query por `day` y filtro en memoria por mensajero.
 */
export async function reorderMessengerDayRoute(input: {
  driverId: string;
  day: string;
  actor?: TransferActor;
  /** Paradas en el orden deseado (ya parseadas). */
  customOrder?: string[];
}): Promise<{ success: boolean; updated?: number; error?: string }> {
  if (!input.driverId) return { success: false, error: 'Mensajero requerido.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day)) return { success: false, error: 'Día inválido.' };
  try {
    const snap = await getDocs(query(collection(firestore, TASKS), where('day', '==', input.day)));
    const mine = snap.docs.filter((d) => String(d.data().driverId || '') === input.driverId);
    const tasks = mine
      .map((d) => toTask(d.id, d.data()))
      .filter((t) => t.status !== 'cancelada' && !t.reassignedTo);
    if (!tasks.length) return { success: true, updated: 0 };

    const custom = (input.customOrder || []).map((s) => String(s || '').trim()).filter(Boolean);
    const ordered = computeMessengerDayOrders(tasks, custom.length ? { customVisitOrder: custom } : undefined);
    const byId = new Map(ordered.map((t) => [t.id, t]));
    const batches = [writeBatch(firestore)];
    let updated = 0;
    let ops = 0;
    for (const d of mine) {
      const o = byId.get(d.id);
      if (!o) continue;
      const cur = d.data();
      const sameOrder = Number(cur.order) === o.order;
      const sameDeliver = Number(cur.deliverOrder) === o.deliverOrder;
      if (sameOrder && sameDeliver) continue;
      if (ops > 0 && ops % 450 === 0) batches.push(writeBatch(firestore));
      batches[batches.length - 1].update(d.ref, { order: o.order, deliverOrder: o.deliverOrder });
      ops++;
      updated++;
    }
    if (updated > 0) for (const b of batches) await b.commit();
    return { success: true, updated };
  } catch (error: any) {
    console.error('reorderMessengerDayRoute:', error);
    return { success: false, error: error.message || 'No se pudo reordenar la ruta.' };
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

/** Tareas abiertas con `day` estrictamente anterior a `beforeDay` (bloqueo de ruta nueva). */
export async function getDriverOpenPriorDayTasks(
  driverId: string,
  beforeDay: string
): Promise<{ days: string[]; countByDay: Record<string, number>; total: number }> {
  const countByDay: Record<string, number> = {};
  if (!driverId || !/^\d{4}-\d{2}-\d{2}$/.test(beforeDay)) return { days: [], countByDay, total: 0 };
  const snap = await getDocs(query(collection(firestore, TASKS), where('driverOpen', '==', `${driverId}|open`)));
  snap.docs.forEach((d) => {
    const day = String(d.data().day || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(day) && day < beforeDay) {
      countByDay[day] = (countByDay[day] || 0) + 1;
    }
  });
  const days = Object.keys(countByDay).sort();
  return { days, countByDay, total: days.reduce((n, d) => n + countByDay[d], 0) };
}

/**
 * Destinos on-route (opción A): paradas de relaciones en_ruta del conductor
 * + deliverPoint de sus routeTasks abiertas (excepto cajón).
 */
export async function getDriverOnRouteDestinationKeys(driverId: string): Promise<{
  keys: Set<string>;
  error?: string;
}> {
  const keys = new Set<string>();
  if (!driverId) return { keys };
  try {
    const { match } = await loadStores();
    const { destinationKeys } = await import('@/lib/collectionRouting');
    const { getOpenDeliveryManifests } = await import('@/app/podActions');

    const [tasksRes, manifestsRes] = await Promise.all([
      getMyRouteTasks(driverId),
      getOpenDeliveryManifests({ driverUserId: driverId }),
    ]);

    (tasksRes.data || []).forEach((t) => {
      if (BODEGA_POINTS.includes(normPoint(t.deliverPoint))) return;
      destinationKeys(t.deliverPoint, match).forEach((k) => keys.add(k));
      if (t.deliverStoreCode) destinationKeys(t.deliverStoreCode, match).forEach((k) => keys.add(k));
      if (t.bodegaDestino) destinationKeys(t.bodegaDestino, match).forEach((k) => keys.add(k));
    });

    const manifests = manifestsRes.data || [];
    // Lecturas acotadas: paradas solo de relaciones abiertas del conductor (pocas).
    for (const m of manifests.slice(0, 20)) {
      const stopsSnap = await getDocs(collection(firestore, 'deliveryManifests', m.id, 'stops'));
      stopsSnap.docs.forEach((d) => {
        const data = d.data();
        destinationKeys(data.storeCode || data.storeName || data.nombreCorto || data.codigoErp, match).forEach((k) =>
          keys.add(k)
        );
        destinationKeys(data.bodegaDestino, match).forEach((k) => keys.add(k));
      });
    }
    return { keys };
  } catch (error: any) {
    console.error('getDriverOnRouteDestinationKeys:', error);
    return { keys, error: error?.message };
  }
}

/**
 * Tras recolección libre: parte el lote.
 * - on-route → routeTask por_entregar (Mis entregas)
 * - mensajero off-route → routeTask a CAJON NORTE
 * - otro conductor off-route → queda para supervisor (sin tarea)
 */
export async function routeCollectedTransfersAfterFreeCollection(input: {
  transferIds: string[];
  driverId: string;
  driverName: string;
  placa: string;
  collectionLogId?: string;
  actor: TransferActor;
  isMessenger?: boolean;
}): Promise<{
  success: boolean;
  onRouteTasks?: number;
  cajonTasks?: number;
  supervisorLines?: number;
  error?: string;
}> {
  const ids = Array.from(new Set((input.transferIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
  if (!ids.length || !input.driverId) return { success: true, onRouteTasks: 0, cajonTasks: 0, supervisorLines: 0 };

  try {
    const { isMessengerDriver, classifyCollectedTransfer, bogotaDayKey } = await import('@/lib/collectionRouting');
    const { match } = await loadStores();
    const messenger =
      input.isMessenger === true ||
      isMessengerDriver({ displayName: input.driverName, isMessenger: input.isMessenger });

    const onRoute = await getDriverOnRouteDestinationKeys(input.driverId);
    const onRouteKeys = onRoute.keys;

    const lines: Array<{ id: string; data: DocumentData }> = [];
    for (let i = 0; i < ids.length; i += 30) {
      const chunk = ids.slice(i, i + 30);
      const snap = await getDocs(query(collection(firestore, 'transfers'), where(documentId(), 'in', chunk)));
      snap.docs.forEach((d) => lines.push({ id: d.id, data: d.data() }));
    }

    type Bucket = { numeroTF: string; transferIds: string[]; destino: string };
    const onRouteBuckets = new Map<string, Bucket>();
    const cajonBuckets = new Map<string, Bucket>();
    let supervisorLines = 0;

    lines.forEach(({ id, data }) => {
      const tf = String(data.numeroTF || '').trim();
      const destino = platformWhs(data.bodegaDestino) || 'SIN DESTINO';
      const bucket = classifyCollectedTransfer(
        { bodegaDestino: destino } as any,
        { onRouteKeys, isMessenger: messenger, match }
      );
      if (bucket === 'supervisor') {
        supervisorLines += 1;
        return;
      }
      const key = `${tf}|${destino}|${bucket}`;
      const map = bucket === 'on_route' ? onRouteBuckets : cajonBuckets;
      const prev = map.get(key) || { numeroTF: tf, transferIds: [], destino };
      prev.transferIds.push(id);
      map.set(key, prev);
    });

    const day = bogotaDayKey();
    const actor = input.actor;
    let onRouteTasks = 0;
    let cajonTasks = 0;

    const onRouteList = Array.from(onRouteBuckets.values()).filter((b) => b.numeroTF);
    if (onRouteList.length) {
      const res = await createRouteTasks({
        tasks: onRouteList.map((b) => ({
          numeroTF: b.numeroTF,
          transferIds: b.transferIds,
          bodegaDestino: b.destino,
          deliverPoint: b.destino,
          notes: 'Recogida en ruta · entregar en destino',
        })),
        driverId: input.driverId,
        driverName: input.driverName,
        placa: input.placa,
        day,
        source: 'recoleccion_libre',
        collectionLogId: input.collectionLogId,
        actor,
      });
      onRouteTasks = res.created || 0;
    }

    const cajonList = Array.from(cajonBuckets.values()).filter((b) => b.numeroTF);
    if (cajonList.length) {
      await ensureNonStorePoints([CAJON_POINT], (await loadStores()).stores, actorNameOf(actor));
      const res = await createRouteTasks({
        tasks: cajonList.map((b) => ({
          numeroTF: b.numeroTF,
          transferIds: b.transferIds,
          bodegaDestino: b.destino,
          deliverPoint: CAJON_POINT,
          notes: 'Recogida fuera de ruta (mensajero) · dejar en cajón',
        })),
        driverId: input.driverId,
        driverName: input.driverName,
        placa: input.placa,
        day,
        source: 'recoleccion_libre',
        collectionLogId: input.collectionLogId,
        actor,
      });
      cajonTasks = res.created || 0;
    }

    // Marcar líneas que quedaron en Mis entregas (bloqueo supervisor).
    const pendingIds = [
      ...Array.from(onRouteBuckets.values()).flatMap((b) => b.transferIds),
      ...Array.from(cajonBuckets.values()).flatMap((b) => b.transferIds),
    ];
    for (let i = 0; i < pendingIds.length; i += 400) {
      const batch = writeBatch(firestore);
      pendingIds.slice(i, i + 400).forEach((id) => {
        batch.update(doc(firestore, 'transfers', id), {
          misEntregasTaskOpen: true,
          misEntregasSource: 'recoleccion_libre',
          misEntregasAt: Timestamp.now(),
        });
      });
      await batch.commit();
    }

    if (input.collectionLogId) {
      await updateDoc(doc(firestore, 'collectionLogs', input.collectionLogId), {
        routedOnRoute: onRouteTasks,
        routedCajon: cajonTasks,
        routedSupervisor: supervisorLines,
        isMessengerRoute: messenger,
      }).catch(() => undefined);
    }

    return { success: true, onRouteTasks, cajonTasks, supervisorLines };
  } catch (error: any) {
    console.error('routeCollectedTransfersAfterFreeCollection:', error);
    return { success: false, error: error?.message || 'No se pudo enrutar la recolección a Mis entregas.' };
  }
}

/** TF que el mensajero dejó en el cajón y siguen allí (2 igualdades, sin índice compuesto). */
export async function getTransfersInCajon(): Promise<{ data?: Array<DocumentData & { id: string }>; error?: string }> {
  try {
    const snap = await getDocs(
      query(collection(firestore, 'transfers'), where('status', '==', 'Recibido en Bodega'), where('ubicacion', '==', CAJON_POINT))
    );
    return { data: snap.docs.map((d) => toDates({ id: d.id, ...d.data() })) };
  } catch (error: any) {
    return { error: error.message || 'No se pudieron cargar las TF del cajón.' };
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

/** Limpia el bloqueo de supervisor cuando la tarea de Mis entregas se cierra. */
const clearMisEntregasFields = {
  misEntregasTaskOpen: deleteField(),
  misEntregasSource: deleteField(),
  misEntregasAt: deleteField(),
};

/**
 * `cajon` = mensajero dejó en CAJON NORTE (Recibido en Bodega).
 * `bodega` = camión devolvió a bodega → Recolectado en Ruta para Validar Supervisor.
 */
export type RouteTaskAction = 'recoger' | 'no_recoger' | 'entregar' | 'no_entregar' | 'cajon' | 'bodega';

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
  if (action === 'cajon' && input.photos.length === 0) return { success: false, error: 'Tome la foto de la mercancía en el cajón.' };
  if (action === 'bodega' && input.photos.length === 0) return { success: false, error: 'Tome la foto de la mercancía en bodega.' };
  const actorName = actorNameOf(actor);

  try {
    const { match } =
      action === 'entregar' || action === 'no_entregar'
        ? await loadStores()
        : { match: (_: unknown) => undefined as DeliveryStore | undefined };
    const needsMessengerCheck = action === 'no_entregar' || action === 'cajon' || action === 'bodega';
    const { isMessengerDriver } = needsMessengerCheck
      ? await import('@/lib/collectionRouting')
      : { isMessengerDriver: () => false };
    const publishLines = new Map<string, PlatformLine>();
    const podMeta: { distanceM?: number; placa?: string; taskIds: string[] } = { taskIds: [] };
    const cajonPlatformIds = new Set<string>();

    const result = await runTransaction(firestore, async (tx) => {
      publishLines.clear();
      podMeta.taskIds = [];
      const refs = input.taskIds.map((id) => doc(firestore, TASKS, id));
      const snaps = await Promise.all(refs.map((r) => tx.get(r)));
      const tasks = snaps.filter((s) => s.exists()).map((s) => ({ ref: s.ref, t: toTask(s.id, s.data()!), raw: s.data()! }));
      if (tasks.length === 0) throw new Error('Las tareas ya no existen.');
      if (tasks.every((x) => x.raw.lastSubmissionId === submissionId)) return { success: true, already: true };
      cajonPlatformIds.clear();
      const waiting = tasks.find((x) => x.t.waitingForHandoff === true);
      if (waiting) {
        const rel = waiting.t.handoffManifestNumber ? ` #${waiting.t.handoffManifestNumber}` : '';
        throw new Error(
          `La TF ${waiting.t.numeroTF} espera el handoff del camión (relación${rel}). El camión debe registrar “Entregar a mensajero” antes de recoger/entregar.`
        );
      }
      const expected = action === 'recoger' || action === 'no_recoger' ? 'por_recoger' : 'por_entregar';
      const stale = tasks.find((x) => x.t.status !== expected);
      if (stale) {
        return { success: false, conflict: true, error: `La TF ${stale.t.numeroTF} ya no está pendiente (${stale.t.status}). Actualice la lista.` };
      }
      if (tasks.some((x) => x.t.driverId !== actor.userId)) {
        return { success: false, conflict: true, error: 'Estas tareas están asignadas a otro conductor.' };
      }
      const messengerRoute =
        isMessengerDriver({ displayName: actorName }) ||
        tasks.some((x) => isMessengerDriver({ displayName: x.t.driverName }));
      const toStore = action === 'entregar' && tasks.some((x) => x.t.kind !== 'libre' && x.t.deliverType === 'tienda');
      const libreDelivery = action === 'entregar' && tasks.some((x) => x.t.kind === 'libre');
      if (toStore && !input.photos.some((p) => p.category === 'remision')) throw new Error('Falta la foto de la remisión firmada.');
      if (libreDelivery && input.photos.length === 0) throw new Error('Tome la foto de la entrega.');
      if ((toStore || libreDelivery) && !String(input.receivedByName || '').trim()) throw new Error('Falta el nombre de quien recibe.');

      const lineIds = action !== 'no_recoger' ? Array.from(new Set(tasks.flatMap((x) => x.t.transferIds || []))) : [];
      const lineSnaps = await Promise.all(lineIds.map((id) => tx.get(doc(firestore, 'transfers', id))));
      const lineById = new Map(lineSnaps.filter((s) => s.exists()).map((s) => [s.id, s]));

      const now = Timestamp.now();
      const gps = input.gps
        ? { lat: input.gps.lat, lng: input.gps.lng, accuracyM: input.gps.accuracyM, at: Timestamp.fromDate(new Date(input.gps.at)) }
        : null;
      const photos = input.photos.map((p) => clean({ path: p.path, url: p.url, category: p.category }));
      const closeKeys = { driverOpen: deleteField(), openKey: deleteField() };
      /** Si venía de un rechazo, al reenviar queda marcada para que el admin la revise. */
      const revalidationOnClose = (t: DriverRouteTask, raw: DocumentData) => {
        const hadRejection = !!t.lastRejection || (Array.isArray(raw.rejections) && raw.rejections.length > 0);
        return hadRejection
          ? { pendingRevalidation: true, resentAfterRejectionAt: now, revalidatedAt: deleteField(), revalidatedByName: deleteField() }
          : {};
      };

      if (action === 'cajon') {
        if (!messengerRoute) throw new Error('En rutas de camión use “Dejar en bodega” (no cajón).');
        if (photos.length === 0) throw new Error('Tome la foto de la mercancía en el cajón.');
        tasks.forEach(({ ref, t, raw }) => {
          if (t.kind !== 'libre') {
            (t.transferIds || []).forEach((id) => {
              const s = lineById.get(id);
              if (!s) return;
              const d = s.data()!;
              if (d.storeReceivedAt || !DELIVERABLE.includes(d.status)) return;
              const pid = platformDocId(d.numeroTF, d.bodegaDestino);
              cajonPlatformIds.add(pid);
              tx.update(s.ref, {
                status: 'Recibido en Bodega',
                ubicacion: CAJON_POINT,
                ubicacionAt: now,
                reprogramada: true,
                cajonAt: now,
                cajonByName: actorName,
                cajonRouteTaskId: t.id,
                routeTaskId: t.id,
                ...clearMisEntregasFields,
                statusHistory: arrayUnion({ status: 'Recibido en Bodega', at: now, userId: actor.userId, userName: `${actorName} (cajón)` }),
              });
            });
          }
          tx.update(ref, clean({
            status: 'entregada',
            leftInCajon: true,
            deliveredAt: now,
            deliveredById: actor.userId,
            deliveredByName: actorName,
            deliveryPhotos: photos,
            deliveryGps: gps,
            deliveryNotes: String(input.notes || '').trim() || undefined,
            tfMarkedDelivered: false,
            lastSubmissionId: submissionId,
            ...revalidationOnClose(t, raw),
            ...closeKeys,
          }));
        });
        return { success: true };
      }

      if (action === 'bodega') {
        if (messengerRoute) throw new Error('El mensajero debe usar “Dejar en cajón”, no bodega.');
        if (photos.length === 0) throw new Error('Tome la foto de la mercancía en bodega.');
        // Camión: cierra Mis entregas y deja la TF en Recolectado en Ruta → aparece en Validar Supervisor.
        tasks.forEach(({ ref, t, raw }) => {
          if (t.kind !== 'libre') {
            (t.transferIds || []).forEach((id) => {
              const s = lineById.get(id);
              if (!s) return;
              const d = s.data()!;
              if (d.storeReceivedAt) return;
              const canReturn =
                DELIVERABLE.includes(d.status) ||
                d.status === 'Recolectado en Ruta' ||
                d.status === 'Novedad de Entrega';
              if (!canReturn) return;
              tx.update(s.ref, {
                status: 'Recolectado en Ruta',
                ubicacion: deleteField(),
                ubicacionAt: deleteField(),
                reprogramada: true,
                leftInBodegaAt: now,
                leftInBodegaByName: actorName,
                leftInBodegaRouteTaskId: t.id,
                routeTaskId: t.id,
                cajonAt: deleteField(),
                cajonByName: deleteField(),
                cajonRouteTaskId: deleteField(),
                novedadEntregaMotivo: deleteField(),
                novedadEntregaAt: deleteField(),
                novedadEntregaBy: deleteField(),
                novedadEntregaByName: deleteField(),
                novedadRouteTaskId: deleteField(),
                ...clearMisEntregasFields,
                statusHistory: arrayUnion({
                  status: 'Recolectado en Ruta',
                  at: now,
                  userId: actor.userId,
                  userName: `${actorName} (dejar en bodega)`,
                }),
              });
            });
          }
          tx.update(ref, clean({
            status: 'entregada',
            leftInBodega: true,
            leftInCajon: false,
            deliveredAt: now,
            deliveredById: actor.userId,
            deliveredByName: actorName,
            deliveryPhotos: photos,
            deliveryGps: gps,
            deliveryNotes: String(input.notes || '').trim() || undefined,
            tfMarkedDelivered: false,
            lastSubmissionId: submissionId,
            ...revalidationOnClose(t, raw),
            ...closeKeys,
          }));
        });
        return { success: true };
      }

      if (action === 'no_entregar') {
        const messenger =
          isMessengerDriver({ displayName: actorName }) ||
          tasks.some((x) => isMessengerDriver({ displayName: x.t.driverName }));
        const touchedLines = new Set<string>();

        if (messenger) {
          // Mensajero: no entrega → Cajón (nunca Novedad / Validado Supervisor / Entregado en Ruta).
          tasks.forEach(({ ref, t, raw }) => {
            if (t.kind !== 'libre') {
              (t.transferIds || []).forEach((id) => {
                const s = lineById.get(id);
                if (!s) return;
                const d = s.data()!;
                if (d.storeReceivedAt || !DELIVERABLE.includes(d.status)) return;
                const pid = platformDocId(d.numeroTF, d.bodegaDestino);
                cajonPlatformIds.add(pid);
                touchedLines.add(id);
                tx.update(s.ref, {
                  status: 'Recibido en Bodega',
                  ubicacion: CAJON_POINT,
                  ubicacionAt: now,
                  reprogramada: true,
                  cajonAt: now,
                  cajonByName: actorName,
                  cajonRouteTaskId: t.id,
                  routeTaskId: t.id,
                  novedadEntregaMotivo: reason,
                  ...clearMisEntregasFields,
                  statusHistory: arrayUnion({
                    status: 'Recibido en Bodega',
                    at: now,
                    userId: actor.userId,
                    userName: `${actorName} (cajón · no entregada)`,
                  }),
                });
              });
            }
            tx.update(ref, clean({
              status: 'entregada',
              leftInCajon: true,
              deliveredAt: now,
              deliveredById: actor.userId,
              deliveredByName: actorName,
              failReason: reason,
              failNotes: String(input.notes || '').trim() || undefined,
              failPhotos: photos.length ? photos : undefined,
              failGps: gps,
              deliveryNotes: String(input.notes || '').trim() || undefined,
              tfMarkedDelivered: false,
              lastSubmissionId: submissionId,
              ...revalidationOnClose(t, raw),
              ...closeKeys,
            }));
          });
          return { success: true };
        }

        // Conductor de camión: igual que la relación — Novedad de Entrega para decidir en "Novedades".
        tasks.forEach(({ t }) => {
          if (t.kind === 'libre' || t.deliverType !== 'tienda') return;
          const store = t.deliverStoreCode ? match(t.deliverStoreCode) : match(t.deliverPoint);
          (t.transferIds || []).forEach((id) => {
            const s = lineById.get(id);
            if (!s) return;
            const d = s.data()!;
            const forThisStop = store
              ? match(d.bodegaDestino)?.codigoErp === store.codigoErp
              : !!t.bodegaDestino && platformWhs(d.bodegaDestino) === platformWhs(t.bodegaDestino);
            if (!forThisStop || d.storeReceivedAt || !NOVEDAD_FROM.includes(d.status)) return;
            const pid = platformDocId(d.numeroTF, d.bodegaDestino);
            const line = publishLines.get(pid) || {
              id: pid,
              numeroTF: platformTf(d.numeroTF),
              bodegaDestino: platformWhs(d.bodegaDestino),
              cantidad: 0,
              fechaDocumento: d.fecha ?? null,
              delivered: false,
              motivo: reason,
            };
            line.cantidad += Number(d.cantidad || 0) || 0;
            publishLines.set(pid, line);
            podMeta.placa = t.placa;
            if (!podMeta.taskIds.includes(t.id)) podMeta.taskIds.push(t.id);
            touchedLines.add(id);
            tx.update(s.ref, {
              status: 'Novedad de Entrega',
              novedadEntregaAt: now,
              novedadEntregaBy: actor.userId,
              novedadEntregaByName: actorName,
              novedadEntregaMotivo: reason,
              novedadRouteTaskId: t.id,
              podManifestDocId: deleteField(),
              podStopId: deleteField(),
              reprogramada: false,
              ...clearMisEntregasFields,
              statusHistory: arrayUnion({ status: 'Novedad de Entrega', at: now, userId: actor.userId, userName: actorName }),
            });
          });
        });

        // Líneas con flag Mis entregas que no entraron a novedad (p.ej. destino bodega).
        tasks.forEach(({ t }) => {
          (t.transferIds || []).forEach((id) => {
            if (touchedLines.has(id)) return;
            const s = lineById.get(id);
            if (!s?.data()?.misEntregasTaskOpen) return;
            touchedLines.add(id);
            tx.update(s.ref, { ...clearMisEntregasFields });
          });
        });
      }

      if (action === 'no_recoger' || action === 'no_entregar') {
        tasks.forEach(({ ref, t, raw }) =>
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
            ...revalidationOnClose(t, raw),
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
            if (!s) return;
            const d = s.data()!;
            const fromCajon = isInCajon(d);
            if (d.status !== 'En Tránsito' && !fromCajon) return;
            changed.push(id);
            destinations[d.bodegaDestino] = (destinations[d.bodegaDestino] || 0) + (Number(d.cantidad) || 1);
            tx.update(s.ref, {
              status: 'Recolectado en Ruta',
              ...(fromCajon ? { ubicacion: deleteField(), ubicacionAt: deleteField() } : { recibidoAt: now }),
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
      tasks.forEach(({ ref, t, raw }) => {
        const store = t.deliverStoreCode ? match(t.deliverStoreCode) : match(t.deliverPoint);
        const distanceM =
          gps && store && typeof store.latitud === 'number' && typeof store.longitud === 'number'
            ? distanceMeters({ lat: gps.lat, lng: gps.lng }, { lat: store.latitud, lng: store.longitud })
            : undefined;
        let marked = false;
        // Punto fuera del maestro de tiendas (ej. B12): vale el destino de la TF guardado en la tarea, como en las relaciones de camión.
        const lineIsForThisStop = (d: DocumentData) =>
          store
            ? match(d.bodegaDestino)?.codigoErp === store.codigoErp
            : !!t.bodegaDestino && platformWhs(d.bodegaDestino) === platformWhs(t.bodegaDestino);
        if (t.deliverType === 'tienda' && t.kind !== 'libre') {
          (t.transferIds || []).forEach((id) => {
            const s = lineById.get(id);
            if (!s) return;
            const d = s.data()!;
            if (!lineIsForThisStop(d)) return;
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
              ...clearMisEntregasFields,
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
          ...revalidationOnClose(t, raw),
          ...closeKeys,
        }));
      });
      return { success: true };
    });

    if (result.success && !result.already && cajonPlatformIds.size > 0) {
      const at = Timestamp.now();
      for (const id of cajonPlatformIds) {
        const ref = doc(firestore, 'tf_platform_status', id);
        const snap = await getDoc(ref).catch(() => null);
        if (!snap?.exists() || snap.data()?.estadoPlataforma === 'ENTREGADO') continue;
        await updateDoc(ref, { estadoPlataforma: 'EN BODEGA', ubicacionActual: CAJON_POINT, cajonAt: at, cajonByName: actorName, updatedAt: at }).catch((e) =>
          console.error('Cajón sin estado plataforma:', e)
        );
      }
    }

    if (result.success && !result.already && publishLines.size > 0 && (action === 'no_entregar' || input.photos.length > 0)) {
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

/**
 * Rechaza una entrega/novedad de ruta del mensajero: la tarea vuelve abierta para que la registre de nuevo.
 * Igual espíritu que rejectDeliveryStop en relaciones.
 */
export async function rejectRouteTaskDelivery(input: {
  taskIds: string[];
  note: string;
  actor: TransferActor;
}): Promise<{ success: boolean; rejected?: number; error?: string }> {
  const { actor } = input;
  if (!actor?.userId) return { success: false, error: 'Sesión no válida.' };
  const note = String(input.note || '').trim();
  if (!note) return { success: false, error: 'Escriba el motivo del rechazo para el mensajero.' };
  const ids = Array.from(new Set((input.taskIds || []).filter(Boolean)));
  if (!ids.length) return { success: false, error: 'No hay tareas seleccionadas.' };
  const actorName = actorNameOf(actor);

  try {
    const platformIds = new Set<string>();
    const cajonPlatformIds = new Set<string>();
    let rejected = 0;

    await runTransaction(firestore, async (tx) => {
      rejected = 0;
      platformIds.clear();
      cajonPlatformIds.clear();
      const snaps = await Promise.all(ids.map((id) => tx.get(doc(firestore, TASKS, id))));
      const tasks = snaps.filter((s) => s.exists()).map((s) => ({ ref: s.ref, t: toTask(s.id, s.data()!), raw: s.data()! }));
      const reopenable = tasks.filter((x) => ['entregada', 'no_entregada', 'no_recogida'].includes(x.t.status));
      if (reopenable.length === 0) throw new Error('Ninguna tarea tiene entrega/novedad para rechazar.');

      const lineIds = Array.from(new Set(reopenable.flatMap((x) => x.t.transferIds || [])));
      const lineSnaps = await Promise.all(lineIds.map((id) => tx.get(doc(firestore, 'transfers', id))));
      const lineById = new Map(lineSnaps.filter((s) => s.exists()).map((s) => [s.id, s]));
      const now = Timestamp.now();

      reopenable.forEach(({ ref, t, raw }) => {
        const rejection = { at: now, byId: actor.userId, byName: actorName, note };
        const reopenStatus: DriverRouteTask['status'] =
          t.status === 'no_recogida' ? 'por_recoger' : 'por_entregar';

        (t.transferIds || []).forEach((id) => {
          const s = lineById.get(id);
          if (!s) return;
          const d = s.data()!;
          const pid = platformDocId(d.numeroTF, d.bodegaDestino);
          const fromThisTask =
            d.routeTaskId === t.id ||
            d.cajonRouteTaskId === t.id ||
            d.novedadRouteTaskId === t.id;
          if (!fromThisTask) return;

          if (d.status === 'Entregado en Tienda' || d.status === 'Novedad de Entrega') {
            platformIds.add(pid);
            tx.update(s.ref, {
              status: 'Recolectado en Ruta',
              entregadoTiendaAt: deleteField(),
              entregadoTiendaBy: deleteField(),
              entregadoTiendaByName: deleteField(),
              novedadEntregaAt: deleteField(),
              novedadEntregaBy: deleteField(),
              novedadEntregaByName: deleteField(),
              novedadEntregaMotivo: deleteField(),
              misEntregasTaskOpen: true,
              misEntregasSource: t.source === 'recoleccion_libre' ? 'recoleccion_libre' : deleteField(),
              misEntregasAt: now,
              statusHistory: arrayUnion({
                status: 'Recolectado en Ruta',
                at: now,
                userId: actor.userId,
                userName: `${actorName} (rechazo prueba ruta)`,
              }),
            });
          } else if (d.status === 'Recibido en Bodega' && normPoint(d.ubicacion) === CAJON_POINT) {
            cajonPlatformIds.add(pid);
            tx.update(s.ref, {
              status: 'Recolectado en Ruta',
              ubicacion: deleteField(),
              ubicacionAt: deleteField(),
              cajonAt: deleteField(),
              cajonByName: deleteField(),
              cajonRouteTaskId: deleteField(),
              reprogramada: deleteField(),
              misEntregasTaskOpen: true,
              misEntregasSource: t.source === 'recoleccion_libre' ? 'recoleccion_libre' : deleteField(),
              misEntregasAt: now,
              statusHistory: arrayUnion({
                status: 'Recolectado en Ruta',
                at: now,
                userId: actor.userId,
                userName: `${actorName} (rechazo cajón ruta)`,
              }),
            });
          }
        });

        tx.update(
          ref,
          clean({
            status: reopenStatus,
            lastRejection: rejection,
            rejections: arrayUnion({
              ...rejection,
              previous: clean({
                status: t.status,
                deliveredAt: raw.deliveredAt ?? null,
                receivedByName: raw.receivedByName ?? null,
                deliveryPhotos: raw.deliveryPhotos || [],
                failReason: raw.failReason ?? null,
                leftInCajon: !!raw.leftInCajon,
                leftInBodega: !!raw.leftInBodega,
              }),
            }),
            driverOpen: `${t.driverId}|open`,
            openKey: t.kind === 'libre' ? deleteField() : t.numeroTF,
            deliveredAt: deleteField(),
            deliveredById: deleteField(),
            deliveredByName: deleteField(),
            deliveryPhotos: deleteField(),
            deliveryGps: deleteField(),
            deliveryNotes: deleteField(),
            receivedByName: deleteField(),
            distanceM: deleteField(),
            tfMarkedDelivered: deleteField(),
            leftInCajon: deleteField(),
            leftInBodega: deleteField(),
            failedAt: deleteField(),
            failedById: deleteField(),
            failedByName: deleteField(),
            failReason: deleteField(),
            failNotes: deleteField(),
            failPhotos: deleteField(),
            failGps: deleteField(),
            lastSubmissionId: deleteField(),
            pendingRevalidation: deleteField(),
            resentAfterRejectionAt: deleteField(),
            revalidatedAt: deleteField(),
            revalidatedByName: deleteField(),
            ...(reopenStatus === 'por_recoger'
              ? {
                  pickedAt: deleteField(),
                  pickedById: deleteField(),
                  pickedByName: deleteField(),
                  pickupPhotos: deleteField(),
                  pickupGps: deleteField(),
                }
              : {}),
          })
        );
        rejected++;
      });
    });

    // Revertir estado plataforma de entregas publicadas por estas tareas (kind ruta).
    for (const pid of platformIds) {
      const ref = doc(firestore, 'tf_platform_status', pid);
      const snap = await getDoc(ref).catch(() => null);
      if (!snap?.exists()) continue;
      const r = snap.data() as any;
      const routeIds: string[] = Array.isArray(r.pod?.routeTaskIds) ? r.pod.routeTaskIds.map(String) : [];
      if (r.podSource === 'app' && r.pod?.kind === 'ruta' && ids.some((id) => routeIds.includes(id))) {
        const prev = r.podPrev;
        if (!prev && r.podCreated) {
          await deleteDoc(ref).catch(() => undefined);
        } else {
          await updateDoc(ref, {
            estadoPlataforma: prev?.estadoPlataforma ?? 'EN RUTA HOY',
            evidenceLinks: prev?.evidenceLinks ?? r.quickEvidenceLinks ?? [],
            podSource: deleteField(),
            pod: deleteField(),
            podPrev: deleteField(),
            podCreated: deleteField(),
            updatedAt: Timestamp.now(),
          }).catch(() => undefined);
        }
      }
    }
    for (const pid of cajonPlatformIds) {
      const ref = doc(firestore, 'tf_platform_status', pid);
      const snap = await getDoc(ref).catch(() => null);
      if (!snap?.exists()) continue;
      const r = snap.data() as any;
      if (normPoint(r.ubicacionActual) === CAJON_POINT) {
        await updateDoc(ref, {
          ubicacionActual: deleteField(),
          cajonAt: deleteField(),
          cajonByName: deleteField(),
          estadoPlataforma: r.estadoPlataforma === 'EN BODEGA' ? 'EN RUTA HOY' : r.estadoPlataforma,
          updatedAt: Timestamp.now(),
        }).catch(() => undefined);
      }
    }

    return { success: true, rejected };
  } catch (error: any) {
    console.error('rejectRouteTaskDelivery:', error);
    return { success: false, error: error.message || 'No se pudo rechazar la entrega.' };
  }
}

/** Marca como revisadas las pruebas reenviadas tras un rechazo (quita del filtro Por revalidar). */
export async function markRouteTasksRevalidated(input: {
  taskIds: string[];
  actor: TransferActor;
}): Promise<{ success: boolean; updated?: number; error?: string }> {
  const { actor } = input;
  if (!actor?.userId) return { success: false, error: 'Sesión no válida.' };
  const ids = Array.from(new Set((input.taskIds || []).filter(Boolean)));
  if (!ids.length) return { success: false, error: 'No hay tareas seleccionadas.' };
  try {
    const now = Timestamp.now();
    const actorName = actorNameOf(actor);
    let updated = 0;
    for (let i = 0; i < ids.length; i += 400) {
      const batch = writeBatch(firestore);
      const chunk = ids.slice(i, i + 400);
      const snaps = await Promise.all(chunk.map((id) => getDoc(doc(firestore, TASKS, id))));
      let batchCount = 0;
      snaps.forEach((s) => {
        if (!s.exists() || !s.data()?.pendingRevalidation) return;
        batchCount++;
        updated++;
        batch.update(s.ref, {
          pendingRevalidation: deleteField(),
          revalidatedAt: now,
          revalidatedByName: actorName,
        });
      });
      if (batchCount > 0) await batch.commit();
    }
    return { success: true, updated };
  } catch (error: any) {
    return { success: false, error: error.message || 'No se pudieron marcar como revisadas.' };
  }
}

/**
 * Admin: deshace una recolección marcada exitosa por error.
 * La TF vuelve a En Tránsito (si seguía Recolectado en Ruta por esta tarea) y la tarea queda
 * `no_recogida` para poder cerrar el día sin exigir entrega.
 */
export async function undoRouteTaskPickup(input: {
  taskIds: string[];
  note: string;
  actor: TransferActor;
}): Promise<{ success: boolean; undone?: number; transfersReverted?: number; error?: string }> {
  if (!input.actor?.userId) return { success: false, error: 'Sesión no válida.' };
  const note = String(input.note || '').trim();
  if (!note) return { success: false, error: 'Escriba el motivo (recolección errónea).' };
  const ids = Array.from(new Set((input.taskIds || []).filter(Boolean)));
  if (!ids.length) return { success: false, error: 'No hay tareas seleccionadas.' };
  const actorName = actorNameOf(input.actor);

  try {
    let undone = 0;
    let transfersReverted = 0;
    const logIds = new Set<string>();

    await runTransaction(firestore, async (tx) => {
      undone = 0;
      transfersReverted = 0;
      logIds.clear();
      const snaps = await Promise.all(ids.map((id) => tx.get(doc(firestore, TASKS, id))));
      const eligible = snaps.filter((s) => {
        const d = s.data();
        return s.exists() && !!d && d.status === 'por_entregar' && !!d.pickedAt;
      });
      if (eligible.length === 0) {
        throw new Error('Ninguna tarea está en “Recogida / por entregar” con recolección registrada.');
      }

      const lineIds = Array.from(new Set(eligible.flatMap((s) => (s.data()?.transferIds as string[]) || [])));
      const lineSnaps = await Promise.all(lineIds.map((id) => tx.get(doc(firestore, 'transfers', id))));
      const lineById = new Map(lineSnaps.filter((s) => s.exists()).map((s) => [s.id, s]));
      const now = Timestamp.now();

      eligible.forEach((s) => {
        const t = toTask(s.id, s.data()!);
        (t.transferIds || []).forEach((id) => {
          const ls = lineById.get(id);
          if (!ls) return;
          const d = ls.data()!;
          if (d.status !== 'Recolectado en Ruta') return;
          if (d.routeTaskId && d.routeTaskId !== t.id) return;
          transfersReverted++;
          tx.update(ls.ref, {
            status: 'En Tránsito',
            recolectadoBy: deleteField(),
            recolectadoByName: deleteField(),
            routeTaskId: deleteField(),
            ...clearMisEntregasFields,
            statusHistory: arrayUnion({
              status: 'En Tránsito',
              at: now,
              userId: input.actor.userId,
              userName: `${actorName} (deshacer recolección)`,
            }),
          });
        });
        if (t.collectionLogId) logIds.add(t.collectionLogId);
        tx.update(
          s.ref,
          clean({
            status: 'no_recogida',
            failedAt: now,
            failedById: input.actor.userId,
            failedByName: actorName,
            failReason: note,
            failNotes: 'Recolección exitosa deshecha por admin (sin entrega).',
            driverOpen: deleteField(),
            openKey: deleteField(),
            pickedAt: deleteField(),
            pickedById: deleteField(),
            pickedByName: deleteField(),
            pickupPhotos: deleteField(),
            pickupGps: deleteField(),
            collectionLogId: deleteField(),
            lastSubmissionId: deleteField(),
            lastRejection: {
              at: now,
              byId: input.actor.userId,
              byName: actorName,
              note: `Deshacer recolección: ${note}`,
            },
          })
        );
        undone++;
      });
    });

    for (const logId of logIds) {
      await updateDoc(doc(firestore, 'collectionLogs', logId), {
        voided: true,
        voidReason: note,
        voidedAt: Timestamp.now(),
        voidedByName: actorName,
      }).catch(() => undefined);
    }

    return { success: true, undone, transfersReverted };
  } catch (error: any) {
    console.error('undoRouteTaskPickup:', error);
    return { success: false, error: error.message || 'No se pudo deshacer la recolección.' };
  }
}

/** Cancela tareas abiertas (admin). Si ya habían recogido, revierte TF a En Tránsito. */
export async function cancelRouteTasks(input: { taskIds: string[]; actor: TransferActor; note?: string }): Promise<{ success: boolean; cancelled?: number; error?: string }> {
  if (!input.actor?.userId) return { success: false, error: 'Sesión no válida.' };
  try {
    let cancelled = 0;
    const actorName = actorNameOf(input.actor);
    const note = String(input.note || '').trim() || 'Cancelada por el administrador';
    await runTransaction(firestore, async (tx) => {
      cancelled = 0;
      const snaps = await Promise.all(input.taskIds.map((id) => tx.get(doc(firestore, TASKS, id))));
      const now = Timestamp.now();
      const openSnaps = snaps.filter((s) => {
        const d = s.data();
        return s.exists() && !!d && ['por_recoger', 'por_entregar'].includes(d.status);
      });
      const lineIds = Array.from(new Set(openSnaps.flatMap((s) => (s.data()?.transferIds as string[] | undefined) || [])));
      const lineSnaps = await Promise.all(lineIds.map((id) => tx.get(doc(firestore, 'transfers', id))));
      const lineById = new Map(lineSnaps.filter((s) => s.exists()).map((s) => [s.id, s]));

      openSnaps.forEach((s) => {
        const d = s.data()!;
        const taskId = s.id;
        (Array.isArray(d.transferIds) ? d.transferIds : []).forEach((id: string) => {
          const ls = lineById.get(id);
          if (!ls) return;
          const td = ls.data()!;
          const revertPickup =
            d.status === 'por_entregar' &&
            td.status === 'Recolectado en Ruta' &&
            (!td.routeTaskId || td.routeTaskId === taskId);
          if (!revertPickup && !td.misEntregasTaskOpen) return;
          tx.update(ls.ref, {
            ...(revertPickup
              ? {
                  status: 'En Tránsito' as TransferStatus,
                  recolectadoBy: deleteField(),
                  recolectadoByName: deleteField(),
                  routeTaskId: deleteField(),
                  statusHistory: arrayUnion({
                    status: 'En Tránsito',
                    at: now,
                    userId: input.actor.userId,
                    userName: `${actorName} (cancelar ruta)`,
                  }),
                }
              : {}),
            ...clearMisEntregasFields,
          });
        });
        cancelled++;
        tx.update(s.ref, {
          status: 'cancelada',
          failedAt: now,
          failedByName: actorName,
          failReason: note,
          driverOpen: deleteField(),
          openKey: deleteField(),
          ...(d.status === 'por_entregar'
            ? {
                pickedAt: deleteField(),
                pickedById: deleteField(),
                pickedByName: deleteField(),
                pickupPhotos: deleteField(),
                pickupGps: deleteField(),
                collectionLogId: deleteField(),
              }
            : {}),
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

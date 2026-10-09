import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';
import { app } from '@/services/firebase';
import { submitDeliveryStop, type SubmitDeliveryStopInput } from '@/app/podActions';
import { submitRouteTasks, type SubmitRouteTasksInput } from '@/app/routeTaskActions';
import type { DeliveryPhotoCategory } from '@/types';

export type QueuedPhoto = {
  id: string;
  category: DeliveryPhotoCategory;
  blob: Blob;
  path?: string;
  url?: string;
};

export type QueuedDelivery = {
  kind?: 'stop';
  submissionId: string;
  label: string;
  storeKey: string;
  monthKey: string;
  input: Omit<SubmitDeliveryStopInput, 'photos'>;
  photos: QueuedPhoto[];
  createdAt: number;
  lastError?: string;
  lastAttemptAt?: number;
  attempts?: number;
};

/** Registro de tareas de ruta (recoger / entregar / no recogida) pendiente de enviar. */
export type QueuedRouteSubmission = {
  kind: 'route';
  submissionId: string;
  label: string;
  storeKey: string;
  monthKey: string;
  input: Omit<SubmitRouteTasksInput, 'photos'>;
  photos: QueuedPhoto[];
  createdAt: number;
  lastError?: string;
  lastAttemptAt?: number;
  attempts?: number;
};

export type QueuedItem = QueuedDelivery | QueuedRouteSubmission;

export type QueueResult = { submissionId: string; label: string; ok: boolean; conflict?: boolean; error?: string };

const DB_NAME = 'pod-queue';
const STORE = 'deliveries';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'submissionId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => {
      db.close();
      resolve(req.result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function onQueueChange(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export const listQueuedAll = () => withStore<QueuedItem[]>('readonly', (s) => s.getAll());
export const listQueued = () => listQueuedAll().then((all) => all.filter((r): r is QueuedDelivery => r.kind !== 'route'));
export const listQueuedRoute = () => listQueuedAll().then((all) => all.filter((r): r is QueuedRouteSubmission => r.kind === 'route'));
const putQueued = (r: QueuedItem) => withStore('readwrite', (s) => s.put(r));
const deleteQueued = (id: string) => withStore('readwrite', (s) => s.delete(id));

export async function enqueueDelivery(r: QueuedItem) {
  await putQueued(r);
  notify();
}

let running: Promise<QueueResult[]> | null = null;

const SUBMIT_TIMEOUT_MS = 90_000;

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

/** Traduce errores técnicos a un motivo que el conductor / soporte entiendan. */
export function describeQueueError(raw?: string): { text: string; needsReload?: boolean } {
  const msg = String(raw || '');
  if (!msg) return { text: '' };
  if (/Server Action|Failed to find|unexpected response|ChunkLoadError|Loading chunk/i.test(msg)) {
    return { text: 'La app se actualizó: recargue la página para enviar.', needsReload: true };
  }
  if (/storage\/unauthorized/i.test(msg)) return { text: 'Sin permiso para subir fotos (revise el rol del usuario o vuelva a iniciar sesión).' };
  if (/storage\/unauthenticated|auth/i.test(msg)) return { text: 'Sesión vencida: cierre sesión y vuelva a entrar.' };
  if (/storage\/retry-limit-exceeded|network|Failed to fetch|Sin conexión|timeout|Tiempo/i.test(msg)) {
    return { text: 'Conexión inestable: se reintenta solo.' };
  }
  if (/storage\/quota/i.test(msg)) return { text: 'Almacenamiento lleno en el servidor: avise a soporte.' };
  return { text: msg };
}

/** Sube fotos pendientes y registra cada entrega en cola. Seguro de llamar varias veces. */
export function processQueue(uid: string): Promise<QueueResult[]> {
  if (running) return running;
  running = (async () => {
    const results: QueueResult[] = [];
    const items = await listQueuedAll().catch(() => [] as QueuedItem[]);
    const storage = getStorage(app);
    // Con wifi/datos inestables el SDK reintenta hasta 10 min por foto y bloquea la cola; mejor fallar y reintentar.
    storage.maxUploadRetryTime = 60_000;
    storage.maxOperationRetryTime = 60_000;
    for (const item of items.sort((a, b) => a.createdAt - b.createdAt)) {
      item.lastAttemptAt = Date.now();
      item.attempts = (item.attempts || 0) + 1;
      try {
        const folder = item.kind === 'route' ? `rt-${item.input.taskIds[0]}` : item.input.stopId;
        const manifest = item.kind === 'route' ? 'ruta' : item.input.manifestDocId;
        for (let i = 0; i < item.photos.length; i++) {
          const p = item.photos[i];
          if (p.url) continue;
          const path = `entregas/${item.monthKey}/${item.storeKey}/${folder}/${item.submissionId}-${i + 1}.jpg`;
          const r = ref(storage, path);
          try {
            await uploadBytes(r, p.blob, {
              contentType: 'image/jpeg',
              customMetadata: { uploadedBy: uid, category: p.category, manifest },
            });
          } catch (upErr: any) {
            // Si un intento anterior sí subió la foto pero se perdió la respuesta, el reintento no puede
            // sobrescribirla (regla update=false) y responde unauthorized: usar la que ya existe.
            const existing = await getDownloadURL(r).catch(() => null);
            if (!existing) throw upErr;
          }
          p.path = path;
          p.url = await getDownloadURL(r);
          await putQueued(item);
        }
        const photos = item.photos.map((p) => ({ path: p.path!, url: p.url!, category: p.category }));
        const res = await withTimeout(
          item.kind === 'route'
            ? submitRouteTasks({ ...item.input, photos })
            : submitDeliveryStop({ ...item.input, photos }),
          SUBMIT_TIMEOUT_MS,
          'Tiempo de espera agotado al registrar (timeout).'
        );
        if (res.success || res.conflict) {
          await deleteQueued(item.submissionId);
          results.push({ submissionId: item.submissionId, label: item.label, ok: !!res.success, conflict: res.conflict, error: res.error });
        } else {
          item.lastError = res.error;
          await putQueued(item);
          results.push({ submissionId: item.submissionId, label: item.label, ok: false, error: res.error });
        }
      } catch (e: any) {
        item.lastError = [e?.code, e?.message].filter(Boolean).join(' · ') || 'Sin conexión';
        await putQueued(item).catch(() => undefined);
        results.push({ submissionId: item.submissionId, label: item.label, ok: false, error: item.lastError });
      }
    }
    return results;
  })().finally(() => {
    running = null;
    notify();
  });
  return running;
}

/** Sube fotos directo (sin cola) para flujos de escritorio; devuelve rutas y URLs. */
export async function uploadPhotosNow(
  uid: string,
  monthKey: string,
  storeKey: string,
  folder: string,
  files: Array<{ blob: Blob; category: DeliveryPhotoCategory }>
): Promise<Array<{ path: string; url: string; category: DeliveryPhotoCategory }>> {
  const storage = getStorage(app);
  const stamp = Date.now();
  return Promise.all(
    files.map(async (f, i) => {
      const path = `entregas/${monthKey}/${storeKey}/${folder}/${stamp}-${i + 1}.jpg`;
      const r = ref(storage, path);
      await uploadBytes(r, f.blob, { contentType: 'image/jpeg', customMetadata: { uploadedBy: uid, category: f.category, manifest: 'recoleccion' } });
      return { path, url: await getDownloadURL(r), category: f.category };
    })
  );
}

/** Reduce la foto (lado mayor 1600 px, JPEG) para subir rápido y ocupar poco espacio. */
export async function compressImage(file: File, maxSide = 1600, quality = 0.7): Promise<Blob> {
  const load = (): Promise<{ w: number; h: number; draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void }> =>
    new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        resolve({ w: img.naturalWidth, h: img.naturalHeight, draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h) });
        URL.revokeObjectURL(url);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('No se pudo leer la foto.'));
      };
      img.src = url;
    });
  const { w, h, draw } = await load();
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  draw(ctx, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  return blob || file;
}

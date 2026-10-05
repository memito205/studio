import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';
import { app } from '@/services/firebase';
import { submitDeliveryStop, type SubmitDeliveryStopInput } from '@/app/podActions';
import type { DeliveryPhotoCategory } from '@/types';

export type QueuedPhoto = {
  id: string;
  category: DeliveryPhotoCategory;
  blob: Blob;
  path?: string;
  url?: string;
};

export type QueuedDelivery = {
  submissionId: string;
  label: string;
  storeKey: string;
  monthKey: string;
  input: Omit<SubmitDeliveryStopInput, 'photos'>;
  photos: QueuedPhoto[];
  createdAt: number;
  lastError?: string;
};

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

export const listQueued = () => withStore<QueuedDelivery[]>('readonly', (s) => s.getAll());
const putQueued = (r: QueuedDelivery) => withStore('readwrite', (s) => s.put(r));
const deleteQueued = (id: string) => withStore('readwrite', (s) => s.delete(id));

export async function enqueueDelivery(r: QueuedDelivery) {
  await putQueued(r);
  notify();
}

let running: Promise<QueueResult[]> | null = null;

/** Sube fotos pendientes y registra cada entrega en cola. Seguro de llamar varias veces. */
export function processQueue(uid: string): Promise<QueueResult[]> {
  if (running) return running;
  running = (async () => {
    const results: QueueResult[] = [];
    const items = await listQueued().catch(() => [] as QueuedDelivery[]);
    const storage = getStorage(app);
    for (const item of items.sort((a, b) => a.createdAt - b.createdAt)) {
      try {
        for (let i = 0; i < item.photos.length; i++) {
          const p = item.photos[i];
          if (p.url) continue;
          const path = `entregas/${item.monthKey}/${item.storeKey}/${item.input.stopId}/${item.submissionId}-${i + 1}.jpg`;
          const r = ref(storage, path);
          await uploadBytes(r, p.blob, {
            contentType: 'image/jpeg',
            customMetadata: { uploadedBy: uid, category: p.category, manifest: item.input.manifestDocId },
          });
          p.path = path;
          p.url = await getDownloadURL(r);
          await putQueued(item);
        }
        const res = await submitDeliveryStop({
          ...item.input,
          photos: item.photos.map((p) => ({ path: p.path!, url: p.url!, category: p.category })),
        });
        if (res.success || res.conflict) {
          await deleteQueued(item.submissionId);
          results.push({ submissionId: item.submissionId, label: item.label, ok: !!res.success, conflict: res.conflict, error: res.error });
        } else {
          item.lastError = res.error;
          await putQueued(item);
          results.push({ submissionId: item.submissionId, label: item.label, ok: false, error: res.error });
        }
      } catch (e: any) {
        item.lastError = e?.message || 'Sin conexión';
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

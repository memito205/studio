/**
 * Copias locales (IndexedDB del navegador) de colecciones que solo cambian cuando alguien sube/edita datos.
 * Se usan junto con un documento de versión en Firestore: si la versión no cambió, se evita releer la colección.
 */

const DB_NAME = 'suite-snapshots';
const STORE = 'snapshots';

type Snapshot<T> = { key: string; version: string; savedAt: number; data: T };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function readLocalSnapshot<T>(key: string): Promise<{ version: string; data: T } | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => {
        const row = req.result as Snapshot<T> | undefined;
        resolve(row ? { version: row.version, data: row.data } : null);
      };
      req.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
    });
  } catch {
    return null;
  }
}

export async function writeLocalSnapshot<T>(key: string, version: string, data: T): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ key, version, savedAt: Date.now(), data } satisfies Snapshot<T>);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    });
  } catch {
    /* sin copia local: la próxima apertura lee de Firestore */
  }
}

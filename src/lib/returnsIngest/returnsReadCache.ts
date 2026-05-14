/**
 * Caché local (IndexedDB) del dataset reconstruido del reporte de devoluciones.
 * Reduce lecturas repetidas a Firestore si los metadatos de períodos no cambiaron
 * y no pasó el TTL (24 h por defecto).
 */

import type { Transaction } from '@/types';

const DB_NAME = 'suite-logistica-returns-read-cache-v1';
const STORE = 'snapshots';
const DB_VERSION = 1;

type SerializedTransaction = Omit<Transaction, 'date'> & { date: string };

interface CacheRow {
  key: string;
  savedAt: number;
  ttlMs: number;
  payload: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error('indexedDB.open failed'));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

function serializeTransactions(rows: Transaction[]): SerializedTransaction[] {
  return rows.map((t) => ({
    ...t,
    date: (t.date instanceof Date ? t.date : new Date(String(t.date))).toISOString(),
  }));
}

function reviveTransactions(rows: SerializedTransaction[]): Transaction[] {
  return rows.map((t) => ({
    ...t,
    date: new Date(t.date),
  }));
}

export async function readReturnsReadCache(key: string, ttlMs: number): Promise<Transaction[] | null> {
  if (typeof window === 'undefined' || !window.indexedDB) return null;
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const st = tx.objectStore(STORE);
      const g = st.get(key);
      g.onerror = () => reject(g.error);
      g.onsuccess = () => {
        const row = g.result as CacheRow | undefined;
        db.close();
        if (!row) return resolve(null);
        if (Date.now() - row.savedAt > Math.min(row.ttlMs, ttlMs)) return resolve(null);
        try {
          const parsed = JSON.parse(row.payload) as { transactions: SerializedTransaction[] };
          resolve(reviveTransactions(parsed.transactions));
        } catch {
          resolve(null);
        }
      };
    });
  } catch (e) {
    console.warn('[returnsReadCache] read', e);
    return null;
  }
}

export async function writeReturnsReadCache(
  key: string,
  transactions: Transaction[],
  ttlMs: number,
): Promise<void> {
  if (typeof window === 'undefined' || !window.indexedDB) return;
  try {
    const db = await openDb();
    const row: CacheRow = {
      key,
      savedAt: Date.now(),
      ttlMs,
      payload: JSON.stringify({ transactions: serializeTransactions(transactions) }),
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE).put(row);
    });
  } catch (e) {
    console.warn('[returnsReadCache] write', e);
  }
}

export async function clearReturnsReadCache(): Promise<void> {
  if (typeof window === 'undefined' || !window.indexedDB) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE).clear();
    });
  } catch (e) {
    console.warn('[returnsReadCache] clear', e);
  }
}

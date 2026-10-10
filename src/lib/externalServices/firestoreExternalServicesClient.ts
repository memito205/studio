/**
 * Lectura/escritura de `externalServices` desde el navegador (con sesión Firebase Auth).
 * Las server actions no envían request.auth; updateDoc fallaba sin aviso en Compras/Contabilidad.
 */

import { FirebaseError } from 'firebase/app';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { firestore } from '@/services/firebase';
import { readLocalSnapshot, writeLocalSnapshot } from '@/lib/localSnapshotCache';
import type { ExternalServiceRow } from '@/types';

const COL = 'externalServices';
const SNAPSHOT_KEY = 'externalServices';

/** Debe cambiar en toda escritura de `externalServices` (también en `saveExternalServiceRows` de actions.ts). */
function externalServicesVersionRef() {
  return doc(firestore, 'systemCache', 'externalServicesVersion');
}

async function bumpExternalServicesVersion(): Promise<string | null> {
  const version = `${Date.now()}`;
  try {
    await setDoc(externalServicesVersionRef(), { version, at: Timestamp.now() });
    return version;
  } catch {
    return null;
  }
}

async function readExternalServicesVersion(): Promise<string | null> {
  try {
    const snap = await getDoc(externalServicesVersionRef());
    const v = snap.exists() ? snap.data()?.version : null;
    if (typeof v === 'string' && v) return v;
    return await bumpExternalServicesVersion();
  } catch {
    return null;
  }
}

export function formatExternalServicesError(e: unknown): string {
  if (e instanceof FirebaseError) {
    if (e.code === 'permission-denied') {
      return 'Firestore rechazó la escritura (permission-denied). Debe estar logueado y con permiso sobre externalServices.';
    }
    return `${e.code}: ${e.message}`;
  }
  if (e instanceof Error) return e.message;
  return typeof e === 'string' ? e : 'Error desconocido al hablar con Firestore.';
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (value && typeof value === 'object' && 'seconds' in value) {
    return new Date(Number((value as { seconds: number }).seconds) * 1000);
  }
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function rowFromDoc(docId: string, raw: Record<string, unknown>): ExternalServiceRow {
  return {
    ...(raw as ExternalServiceRow),
    id: docId,
    duplicateHash: String(raw.duplicateHash ?? docId),
    fechaServicio: toDate(raw.fechaServicio),
    createdAt: toDate(raw.createdAt),
  };
}

/** ID del documento en Firestore (path); prioriza duplicateHash si difiere del id en memoria. */
export function externalServiceDocId(
  rowOrId: Pick<ExternalServiceRow, 'id' | 'duplicateHash'> | string,
): string {
  if (typeof rowOrId === 'string') return rowOrId;
  const hash = rowOrId.duplicateHash?.trim();
  if (hash) return hash;
  return rowOrId.id;
}

function serializeUpdates(updates: Partial<ExternalServiceRow>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(updates)) {
    if (key === 'id') continue;
    if (val === undefined) continue;
    if (val instanceof Date) {
      out[key] = Timestamp.fromDate(val);
    } else {
      out[key] = val;
    }
  }
  return out;
}

export async function getExternalServiceRows(): Promise<{
  success: boolean;
  data?: ExternalServiceRow[];
  error?: string;
}> {
  try {
    if (typeof window === 'undefined') {
      return { success: false, error: 'getExternalServiceRows solo en navegador.' };
    }
    if (!firestore) {
      return { success: false, error: 'Firestore no inicializado.' };
    }
    const [version, local] = await Promise.all([
      readExternalServicesVersion(),
      readLocalSnapshot<ExternalServiceRow[]>(SNAPSHOT_KEY),
    ]);
    if (version && local && local.version === version && Array.isArray(local.data)) {
      return { success: true, data: local.data };
    }
    const q = query(collection(firestore, COL), orderBy('fechaServicio', 'desc'), limit(1000));
    const snap = await getDocs(q);
    const rows = snap.docs.map((d) => rowFromDoc(d.id, d.data() as Record<string, unknown>));
    if (version) void writeLocalSnapshot(SNAPSHOT_KEY, version, rows);
    return { success: true, data: rows };
  } catch (e) {
    console.error('[getExternalServiceRows]', e);
    return { success: false, error: formatExternalServicesError(e) };
  }
}

export async function updateExternalServiceRow(
  idOrRow: string | Pick<ExternalServiceRow, 'id' | 'duplicateHash'>,
  updates: Partial<ExternalServiceRow>,
): Promise<{ success: boolean; error?: string }> {
  try {
    if (typeof window === 'undefined') {
      return { success: false, error: 'updateExternalServiceRow solo en navegador.' };
    }
    if (!firestore) {
      return { success: false, error: 'Firestore no inicializado.' };
    }
    const docId = externalServiceDocId(idOrRow);
    if (!docId) {
      return { success: false, error: 'Fila sin id de documento Firestore.' };
    }
    const payload = serializeUpdates(updates);
    if (Object.keys(payload).length === 0) {
      return { success: true };
    }
    await updateDoc(doc(firestore, COL, docId), payload);
    await bumpExternalServicesVersion();
    return { success: true };
  } catch (e) {
    console.error('[updateExternalServiceRow]', idOrRow, updates, e);
    return { success: false, error: formatExternalServicesError(e) };
  }
}

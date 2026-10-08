'use server';

import { doc, getDoc, writeBatch } from 'firebase/firestore';
import { firestore } from '@/services/firebase';
import {
  ANALYZER_SNAPSHOT_COLLECTION,
  ANALYZER_SNAPSHOT_GLOBAL_ID,
  analyzerSnapshotPartId,
  analyzerSnapshotStoreId,
  type AnalyzerSnapshotDocWrite,
  type AnalyzerSnapshotGlobalPayload,
  type AnalyzerSnapshotMeta,
  type AnalyzerSnapshotStorePayload,
} from '@/lib/analyzerSnapshot';

/** Sobrescribe docs de la foto del analizador (el cliente envía lotes para no superar el límite del body). */
export async function saveAnalyzerSnapshotDocs(docs: AnalyzerSnapshotDocWrite[]): Promise<{ ok?: true; error?: string }> {
  try {
    const valid = docs.filter((d) => d.id === ANALYZER_SNAPSHOT_GLOBAL_ID || d.id.startsWith('s_') || d.id.startsWith(`${ANALYZER_SNAPSHOT_GLOBAL_ID}__p`));
    for (let i = 0; i < valid.length; i += 400) {
      const batch = writeBatch(firestore);
      valid.slice(i, i + 400).forEach((d) => batch.set(doc(firestore, ANALYZER_SNAPSHOT_COLLECTION, d.id), d.data));
      await batch.commit();
    }
    return { ok: true };
  } catch (e: any) {
    return { error: e?.message || 'No se pudo guardar la foto del reporte.' };
  }
}

async function readSnapshotDoc<T>(id: string): Promise<{ meta: AnalyzerSnapshotMeta; payload: T } | null> {
  const snap = await getDoc(doc(firestore, ANALYZER_SNAPSHOT_COLLECTION, id));
  if (!snap.exists()) return null;
  const d = snap.data();
  const parts = Number(d.parts || 1);
  let json = String(d.chunk || '');
  if (parts > 1) {
    const rest = await Promise.all(
      Array.from({ length: parts - 1 }, (_, i) => getDoc(doc(firestore, ANALYZER_SNAPSHOT_COLLECTION, analyzerSnapshotPartId(id, i + 1))))
    );
    for (const p of rest) {
      if (!p.exists() || p.data().at !== d.at) throw new Error('La foto se está actualizando; intente de nuevo en un momento.');
      json += String(p.data().chunk || '');
    }
  }
  return { meta: { at: d.at, byName: d.byName || '', fileName: d.fileName || '' }, payload: JSON.parse(json) as T };
}

/** Resumen global (office/admin/supervisor): 1 lectura si cabe en un doc. */
export async function getAnalyzerSnapshotGlobal(): Promise<{
  data?: { meta: AnalyzerSnapshotMeta; payload: AnalyzerSnapshotGlobalPayload } | null;
  error?: string;
}> {
  try {
    return { data: await readSnapshotDoc<AnalyzerSnapshotGlobalPayload>(ANALYZER_SNAPSHOT_GLOBAL_ID) };
  } catch (e: any) {
    return { error: e?.message || 'No se pudo leer la foto del reporte.' };
  }
}

/** Detalle de una tienda; solo es válido si pertenece a la última foto global. */
export async function getAnalyzerSnapshotStore(key: string): Promise<{
  data?: { meta: AnalyzerSnapshotMeta; payload: AnalyzerSnapshotStorePayload } | null;
  lastAt?: string;
  error?: string;
}> {
  try {
    const k = String(key || '').trim();
    if (!k) return { data: null };
    const [globalSnap, store] = await Promise.all([
      getDoc(doc(firestore, ANALYZER_SNAPSHOT_COLLECTION, ANALYZER_SNAPSHOT_GLOBAL_ID)),
      readSnapshotDoc<AnalyzerSnapshotStorePayload>(analyzerSnapshotStoreId(k)),
    ]);
    const lastAt = globalSnap.exists() ? String(globalSnap.data().at || '') : undefined;
    if (!store || (lastAt && store.meta.at !== lastAt)) return { data: null, lastAt };
    return { data: store, lastAt };
  } catch (e: any) {
    return { error: e?.message || 'No se pudo leer la foto del reporte.' };
  }
}

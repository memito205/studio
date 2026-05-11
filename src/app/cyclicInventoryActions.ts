'use server';

import { firestore } from '@/services/firebase';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import type { CyclicInventoryLine, CyclicInventoryRun } from '@/types';

const LINES_BATCH = 400;

function convertTimestampsToDates(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const key of Object.keys(out)) {
    const v = out[key];
    if (v && typeof v === 'object' && 'toDate' in v && typeof (v as { toDate: () => Date }).toDate === 'function') {
      out[key] = (v as { toDate: () => Date }).toDate().toISOString();
    }
  }
  return out;
}

function normRef(s: string) {
  return String(s || '')
    .trim()
    .toUpperCase();
}
function normLoc(s: string) {
  return String(s || '').trim();
}
function normSize(s: string) {
  return String(s || '').trim();
}

export async function createCyclicInventoryRun(input: {
  name: string;
  warehouseLabel?: string;
  createdBy: string;
  createdByName?: string;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    if (!input.name?.trim()) {
      return { success: false, error: 'Indique un nombre para el conteo.' };
    }
    const ref = await addDoc(collection(firestore, 'cyclicInventoryRuns'), {
      name: input.name.trim(),
      warehouseLabel: (input.warehouseLabel || '').trim(),
      status: 'active',
      createdAt: Timestamp.now(),
      createdBy: input.createdBy,
      createdByName: input.createdByName || '',
    });
    return { success: true, id: ref.id };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error al crear el conteo.';
    return { success: false, error: msg };
  }
}

export async function importCyclicInventoryLines(input: {
  runId: string;
  lines: { reference: string; size: string; location: string; expectedQty: number }[];
}): Promise<{ success: boolean; imported?: number; error?: string }> {
  try {
    const runId = input.runId?.trim();
    if (!runId) return { success: false, error: 'runId requerido.' };
    const runSnap = await getDoc(doc(firestore, 'cyclicInventoryRuns', runId));
    if (!runSnap.exists()) return { success: false, error: 'El conteo no existe.' };
    if (runSnap.data()?.status !== 'active') {
      return { success: false, error: 'Solo se pueden importar líneas en conteos activos.' };
    }

    let imported = 0;
    const normalized: { reference: string; size: string; location: string; expectedQty: number }[] = [];
    for (const row of input.lines || []) {
      const reference = normRef(row.reference);
      if (!reference) continue;
      normalized.push({
        reference,
        size: normSize(row.size),
        location: normLoc(row.location),
        expectedQty: Math.max(0, Math.floor(Number(row.expectedQty) || 0)),
      });
    }
    for (let i = 0; i < normalized.length; i += LINES_BATCH) {
      const chunk = normalized.slice(i, i + LINES_BATCH);
      const batch = writeBatch(firestore);
      for (const row of chunk) {
        const lineRef = doc(collection(firestore, 'cyclicInventoryLines'));
        batch.set(lineRef, {
          runId,
          reference: row.reference,
          size: row.size,
          location: row.location,
          expectedQty: row.expectedQty,
          countedQty: null,
          countedAt: null,
          countedBy: null,
          createdAt: Timestamp.now(),
        });
        imported += 1;
      }
      await batch.commit();
    }
    return { success: true, imported };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error al importar líneas.';
    return { success: false, error: msg };
  }
}

export async function listCyclicInventoryRuns(max = 40): Promise<{
  success: boolean;
  data?: CyclicInventoryRun[];
  error?: string;
}> {
  try {
    const q = query(collection(firestore, 'cyclicInventoryRuns'), orderBy('createdAt', 'desc'), limit(max));
    const snap = await getDocs(q);
    const data: CyclicInventoryRun[] = snap.docs.map((d) => {
      const raw = convertTimestampsToDates({ id: d.id, ...d.data() } as Record<string, unknown>);
      return raw as unknown as CyclicInventoryRun;
    });
    return { success: true, data };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error al listar conteos.';
    return { success: false, error: msg };
  }
}

export async function getCyclicInventoryLines(runId: string): Promise<{
  success: boolean;
  data?: CyclicInventoryLine[];
  error?: string;
}> {
  try {
    const rid = runId?.trim();
    if (!rid) return { success: false, error: 'runId requerido.' };
    const q = query(collection(firestore, 'cyclicInventoryLines'), where('runId', '==', rid));
    const snap = await getDocs(q);
    const data: CyclicInventoryLine[] = snap.docs.map((d) => {
      const raw = convertTimestampsToDates({ id: d.id, ...d.data() } as Record<string, unknown>);
      return raw as unknown as CyclicInventoryLine;
    });
    data.sort((a, b) => {
      const ra = `${a.reference}|${a.location}|${a.size}`.localeCompare(`${b.reference}|${b.location}|${b.size}`);
      return ra;
    });
    return { success: true, data };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error al cargar líneas.';
    if (String(msg).includes('failed-precondition')) {
      return {
        success: false,
        error:
          'Firestore requiere un índice compuesto: cyclicInventoryLines (runId + reference o solo runId). Revise el enlace en la consola de Firebase.',
      };
    }
    return { success: false, error: msg };
  }
}

export async function saveCyclicInventoryLineCount(input: {
  lineId: string;
  countedQty: number;
  countedBy: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const lineId = input.lineId?.trim();
    if (!lineId) return { success: false, error: 'lineId requerido.' };
    const n = Math.max(0, Math.floor(Number(input.countedQty)));
    const ref = doc(firestore, 'cyclicInventoryLines', lineId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return { success: false, error: 'Línea no encontrada.' };
    await updateDoc(ref, {
      countedQty: n,
      countedAt: Timestamp.now(),
      countedBy: input.countedBy,
    });
    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error al guardar conteo.';
    return { success: false, error: msg };
  }
}

export async function closeCyclicInventoryRun(runId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const rid = runId?.trim();
    if (!rid) return { success: false, error: 'runId requerido.' };
    await updateDoc(doc(firestore, 'cyclicInventoryRuns', rid), {
      status: 'closed',
      closedAt: Timestamp.now(),
    });
    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error al cerrar conteo.';
    return { success: false, error: msg };
  }
}

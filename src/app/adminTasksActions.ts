'use server';

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
} from 'firebase/firestore';
import { LOGISTICS_ADMIN_TASKS_COL, type LogisticsAdminTask } from '@/lib/adminTasks';
import { firestore } from '@/services/firebase';

type Actor = { uid: string; name?: string | null };

function toIso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Timestamp) {
    const d = v.toDate();
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : v.toISOString();
  }
  if (typeof v === 'object' && v !== null && typeof (v as { toDate?: () => Date }).toDate === 'function') {
    try {
      const d = (v as { toDate: () => Date }).toDate();
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    } catch {
      return null;
    }
  }
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

async function assertAdminActor(actor: Actor): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const uid = String(actor?.uid || '').trim();
  if (!uid) return { ok: false, error: 'Usuario no autenticado.' };

  try {
    const snap = await getDoc(doc(firestore, 'users', uid));
    if (!snap.exists()) {
      return { ok: false, error: 'No se encontró el perfil de usuario.' };
    }
    const role = String(snap.data()?.role || '')
      .trim()
      .toLowerCase();
    if (role !== 'admin') {
      return { ok: false, error: 'Solo administradores pueden gestionar pendientes.' };
    }
    const name =
      String(actor.name || '').trim() ||
      String(snap.data()?.displayName || '').trim() ||
      'Admin';
    return { ok: true, name };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error verificando permisos.';
    return { ok: false, error: message };
  }
}

function mapTask(id: string, raw: Record<string, unknown>): LogisticsAdminTask {
  const createdAt = toIso(raw.createdAt) || new Date(0).toISOString();
  const updatedAt = toIso(raw.updatedAt) || createdAt;
  return {
    id,
    title: String(raw.title || '').trim(),
    notes: raw.notes != null && String(raw.notes).trim() ? String(raw.notes).trim() : undefined,
    done: Boolean(raw.done),
    createdAt,
    updatedAt,
    createdByUid: String(raw.createdByUid || ''),
    createdByName: String(raw.createdByName || ''),
    doneAt: toIso(raw.doneAt),
    doneByUid: raw.doneByUid != null ? String(raw.doneByUid) : null,
    order: typeof raw.order === 'number' ? raw.order : undefined,
  };
}

/** Pending first, then by createdAt desc within each group. */
function sortTasks(tasks: LogisticsAdminTask[]): LogisticsAdminTask[] {
  return [...tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export async function listLogisticsAdminTasks(
  actor: Actor
): Promise<{ data?: LogisticsAdminTask[]; error?: string }> {
  const gate = await assertAdminActor(actor);
  if (!gate.ok) return { error: gate.error };

  try {
    const snap = await getDocs(
      query(collection(firestore, LOGISTICS_ADMIN_TASKS_COL), orderBy('createdAt', 'desc'), limit(200))
    );
    const tasks = sortTasks(snap.docs.map((d) => mapTask(d.id, d.data() as Record<string, unknown>)));
    return { data: tasks };
  } catch (error: unknown) {
    try {
      const snap = await getDocs(query(collection(firestore, LOGISTICS_ADMIN_TASKS_COL), limit(200)));
      const tasks = sortTasks(snap.docs.map((d) => mapTask(d.id, d.data() as Record<string, unknown>)));
      return { data: tasks };
    } catch (fallbackError: unknown) {
      const message =
        fallbackError instanceof Error
          ? fallbackError.message
          : error instanceof Error
            ? error.message
            : 'No se pudieron cargar los pendientes.';
      console.error('listLogisticsAdminTasks:', message);
      return { error: message };
    }
  }
}

export async function createLogisticsAdminTask(
  actor: Actor,
  input: { title: string; notes?: string }
): Promise<{ data?: LogisticsAdminTask; error?: string }> {
  const gate = await assertAdminActor(actor);
  if (!gate.ok) return { error: gate.error };

  const title = String(input.title || '').trim();
  if (!title) return { error: 'El título es obligatorio.' };
  if (title.length > 160) return { error: 'El título es demasiado largo.' };

  const notesRaw = String(input.notes || '').trim();
  const notes = notesRaw ? notesRaw.slice(0, 1000) : undefined;
  const now = Timestamp.now();

  try {
    const payload: Record<string, unknown> = {
      title,
      done: false,
      createdAt: now,
      updatedAt: now,
      createdByUid: actor.uid,
      createdByName: gate.name,
      order: Date.now(),
    };
    if (notes) payload.notes = notes;

    const ref = await addDoc(collection(firestore, LOGISTICS_ADMIN_TASKS_COL), payload);
    return {
      data: mapTask(ref.id, {
        ...payload,
        createdAt: now,
        updatedAt: now,
      }),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'No se pudo crear el pendiente.';
    console.error('createLogisticsAdminTask:', message);
    return { error: message };
  }
}

export async function setLogisticsAdminTaskDone(
  actor: Actor,
  taskId: string,
  done: boolean
): Promise<{ success?: boolean; error?: string }> {
  const gate = await assertAdminActor(actor);
  if (!gate.ok) return { error: gate.error };

  const id = String(taskId || '').trim();
  if (!id) return { error: 'Tarea no válida.' };

  try {
    const ref = doc(firestore, LOGISTICS_ADMIN_TASKS_COL, id);
    const existing = await getDoc(ref);
    if (!existing.exists()) return { error: 'El pendiente ya no existe.' };

    const now = Timestamp.now();
    if (done) {
      await updateDoc(ref, {
        done: true,
        updatedAt: now,
        doneAt: now,
        doneByUid: actor.uid,
      });
    } else {
      await updateDoc(ref, {
        done: false,
        updatedAt: now,
        doneAt: null,
        doneByUid: null,
      });
    }
    return { success: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'No se pudo actualizar el pendiente.';
    console.error('setLogisticsAdminTaskDone:', message);
    return { error: message };
  }
}

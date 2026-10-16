import type { LabelingAssigneeSession, LabelingOperation } from '@/types';

/** IDs internos asignados (array o escalar legacy). */
export function getInternalAssigneeIds(op: Pick<LabelingOperation, 'assignedOperatorId' | 'assignedOperatorIds'>): string[] {
  if (Array.isArray(op.assignedOperatorIds) && op.assignedOperatorIds.length > 0) {
    return Array.from(new Set(op.assignedOperatorIds.map((id) => String(id || '').trim()).filter(Boolean)));
  }
  const one = String(op.assignedOperatorId || '').trim();
  return one ? [one] : [];
}

/** Nombres externos asignados (array o escalar legacy). */
export function getExternalAssigneeNames(
  op: Pick<LabelingOperation, 'assignedExternalOperatorName' | 'assignedExternalOperatorNames'>
): string[] {
  if (Array.isArray(op.assignedExternalOperatorNames) && op.assignedExternalOperatorNames.length > 0) {
    return Array.from(
      new Set(op.assignedExternalOperatorNames.map((n) => String(n || '').trim()).filter(Boolean))
    );
  }
  const one = String(op.assignedExternalOperatorName || '').trim();
  return one ? [one] : [];
}

export function isMultiAssignee(op: LabelingOperation): boolean {
  if (op.isExternal) return getExternalAssigneeNames(op).length > 1;
  return getInternalAssigneeIds(op).length > 1;
}

export function isAssignedToInternal(op: LabelingOperation, uid: string): boolean {
  const id = String(uid || '').trim();
  if (!id || op.isExternal) return false;
  return getInternalAssigneeIds(op).includes(id);
}

export function isAssignedToExternal(op: LabelingOperation, operatorName: string): boolean {
  const name = String(operatorName || '').trim();
  if (!name || !op.isExternal) return false;
  return getExternalAssigneeNames(op).includes(name);
}

export function sessionKeyForExternal(name: string): string {
  return String(name || '').trim();
}

export function sessionKeyForInternal(uid: string): string {
  return String(uid || '').trim();
}

export function getAssigneeSession(
  op: LabelingOperation,
  key: string
): LabelingAssigneeSession | undefined {
  if (!key) return undefined;
  const map = op.assigneeSessions;
  if (!map || typeof map !== 'object') return undefined;
  return map[key];
}

/**
 * Payload de escritura compatible: si hay 1 persona, también llena los campos escalares
 * que usa todo el código actual (length===1 ≡ comportamiento de hoy).
 * Rechaza híbrido interno+externo.
 */
export function buildAssigneeWriteFields(input: {
  isExternal: boolean;
  internalIds?: string[];
  externalVendorId?: string;
  externalNames?: string[];
}): {
  ok: true;
  fields: Partial<LabelingOperation>;
} | { ok: false; error: string } {
  if (input.isExternal) {
    const vendorId = String(input.externalVendorId || '').trim();
    const names = Array.from(
      new Set((input.externalNames || []).map((n) => String(n || '').trim()).filter(Boolean))
    );
    if (!vendorId) return { ok: false, error: 'Seleccione el proveedor externo.' };
    if (names.length === 0) return { ok: false, error: 'Seleccione al menos un operario externo.' };
    return {
      ok: true,
      fields: {
        isExternal: true,
        assignedOperatorId: '',
        assignedOperatorIds: undefined,
        assignedExternalVendorId: vendorId,
        assignedExternalOperatorName: names[0],
        assignedExternalOperatorNames: names.length > 1 ? names : undefined,
        assigneeSessions: undefined,
      },
    };
  }

  const ids = Array.from(new Set((input.internalIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
  if (ids.length === 0) return { ok: false, error: 'Seleccione al menos un operario interno.' };
  return {
    ok: true,
    fields: {
      isExternal: false,
      assignedOperatorId: ids[0],
      assignedOperatorIds: ids.length > 1 ? ids : undefined,
      assignedExternalVendorId: undefined,
      assignedExternalOperatorName: undefined,
      assignedExternalOperatorNames: undefined,
      assigneeSessions: undefined,
    },
  };
}

/** Actualiza sesión por persona y decide status de la tarea en multi. */
export function applyAssigneeSessionEvent(
  sessions: Record<string, LabelingAssigneeSession> | undefined,
  key: string,
  type: 'START' | 'PAUSE' | 'RESUME',
  nowIso: string
): { sessions: Record<string, LabelingAssigneeSession>; taskStatus: 'En Progreso' | 'Pausada' } {
  const next: Record<string, LabelingAssigneeSession> = { ...(sessions || {}) };
  const prev = next[key] || { status: 'idle' as const, accumulatedMs: 0 };
  let accumulatedMs = Number(prev.accumulatedMs) || 0;

  if (type === 'START') {
    next[key] = {
      status: 'active',
      startedAt: prev.startedAt || nowIso,
      lastStartedAt: nowIso,
      pausedAt: undefined,
      accumulatedMs,
    };
  } else if (type === 'PAUSE') {
    if (prev.status === 'active' && prev.lastStartedAt) {
      accumulatedMs += Math.max(0, new Date(nowIso).getTime() - new Date(prev.lastStartedAt).getTime());
    }
    next[key] = {
      ...prev,
      status: 'paused',
      pausedAt: nowIso,
      lastStartedAt: undefined,
      accumulatedMs,
    };
  } else {
    // RESUME
    next[key] = {
      ...prev,
      status: 'active',
      lastStartedAt: nowIso,
      pausedAt: undefined,
      accumulatedMs,
    };
  }

  const values = Object.values(next);
  const anyActive = values.some((s) => s.status === 'active');
  return { sessions: next, taskStatus: anyActive ? 'En Progreso' : 'Pausada' };
}

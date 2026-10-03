"use client";

import { useEffect, useRef } from 'react';
import { doc, onSnapshot, Timestamp } from 'firebase/firestore';
import { firestore } from '@/services/firebase';
import { getVerificationLiveState, type VerificationLiveState } from '@/app/actions';
import type { VerificationItem } from '@/types';

const POLL_MS = 4000;

const stripTimestamps = (v: any): any => {
  if (v instanceof Timestamp) return v.toDate();
  if (Array.isArray(v)) return v.map(stripTimestamps);
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, stripTimestamps(val)]));
  }
  return v;
};

/**
 * Escucha la sesión de verificación en tiempo real (otros equipos alistando / cerrando).
 * Si la suscripción no está permitida, consulta cada 4 s por el servidor.
 */
export function useLiveVerificationSession(
  sessionId: string,
  onState: (state: VerificationLiveState) => void,
  enabled = true
) {
  const onStateRef = useRef(onState);
  onStateRef.current = onState;

  useEffect(() => {
    if (!enabled) return;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;

    const poll = async () => {
      const res = await getVerificationLiveState(sessionId);
      if (!cancelled && res.success && res.state) onStateRef.current(res.state);
    };

    const unsub = onSnapshot(
      doc(firestore, 'verificationSessions', sessionId),
      (snap) => {
        if (!snap.exists() || snap.metadata.hasPendingWrites) return;
        const raw = snap.data() as any;
        onStateRef.current({
          results: stripTimestamps(Array.isArray(raw.results) ? raw.results : []),
          outOfPlanReads: stripTimestamps(Array.isArray(raw.outOfPlanReads) ? raw.outOfPlanReads : []),
          status: raw.status,
          phase: raw.phase,
        });
      },
      (err) => {
        console.warn('Sesión en vivo no disponible, se consulta cada 4 s', err);
        if (cancelled || pollTimer) return;
        void poll();
        pollTimer = setInterval(() => void poll(), POLL_MS);
      }
    );

    return () => {
      cancelled = true;
      unsub();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [sessionId, enabled]);
}

/**
 * Lleva a la lista local lo leído en otros equipos sin perder lo local aún no guardado.
 * `notFoundPending`: códigos cuyo "no encontrada" cambió localmente y aún no se guarda.
 * Devuelve la misma referencia si no hay cambios.
 */
export function mergeRemotePicks(
  local: VerificationItem[],
  remote: VerificationItem[],
  notFoundPending: Set<string> = new Set()
): VerificationItem[] {
  const remoteByCode = new Map(remote.map((r) => [r.codigo, r]));
  let changed = false;
  const next = local.map((item) => {
    const r = remoteByCode.get(item.codigo);
    if (!r) return item;
    if (r.scanned && !item.scanned) {
      changed = true;
      return { ...item, scanned: true, scanTime: r.scanTime || item.scanTime, notFound: false };
    }
    if (!item.scanned && !r.scanned && !notFoundPending.has(item.codigo) && !!r.notFound !== !!item.notFound) {
      changed = true;
      return { ...item, notFound: !!r.notFound, ...(r.notFoundAt ? { notFoundAt: r.notFoundAt } : {}) };
    }
    return item;
  });
  const localCodes = new Set(local.map((i) => i.codigo));
  remote.forEach((r) => {
    if (!localCodes.has(r.codigo)) {
      changed = true;
      next.push(r);
    }
  });
  return changed ? next : local;
}

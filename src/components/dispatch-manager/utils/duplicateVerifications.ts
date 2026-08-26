import type { SavedVerification, VerificationItem } from '@/types';

export type TfSessionHit = {
  sessionId: string;
  sessionName: string;
  sessionStatus?: string;
  sessionCreatedAt?: Date;
  codigo: string;
  destino: string;
  scanned: boolean;
};

export type DuplicateTfAlert = {
  tfKey: string;
  hits: TfSessionHit[];
};

const normalizeTfKey = (tf: string | undefined | null): string => {
  const raw = String(tf || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  return digits ? String(Number(digits)) : raw.toUpperCase();
};

const itemTfKey = (item: VerificationItem): string => {
  return normalizeTfKey(item.tftCruce) || normalizeTfKey(item.tfOriginal) || '';
};

/** Índice TF → apariciones en sesiones de verificación. */
export function buildTfVerificationIndex(
  sessions: SavedVerification[]
): Map<string, TfSessionHit[]> {
  const index = new Map<string, TfSessionHit[]>();

  sessions.forEach((session) => {
    const seenInSession = new Set<string>();
    (session.results || []).forEach((item) => {
      const tfKey = itemTfKey(item);
      if (!tfKey || seenInSession.has(tfKey)) return;
      seenInSession.add(tfKey);

      const hit: TfSessionHit = {
        sessionId: session.id,
        sessionName: session.name,
        sessionStatus: session.status,
        sessionCreatedAt: session.createdAt instanceof Date ? session.createdAt : undefined,
        codigo: item.codigo,
        destino: item.destino,
        scanned: Boolean(item.scanned),
      };
      const list = index.get(tfKey) || [];
      list.push(hit);
      index.set(tfKey, list);
    });
  });

  return index;
}

/** Solo TFs que aparecen en 2+ sesiones distintas. */
export function getDuplicateTfAlerts(sessions: SavedVerification[]): DuplicateTfAlert[] {
  const index = buildTfVerificationIndex(sessions);
  const alerts: DuplicateTfAlert[] = [];
  index.forEach((hits, tfKey) => {
    const uniqueSessions = new Set(hits.map((h) => h.sessionId));
    if (uniqueSessions.size >= 2) {
      alerts.push({ tfKey, hits });
    }
  });
  return alerts.sort((a, b) => b.hits.length - a.hits.length || a.tfKey.localeCompare(b.tfKey));
}

export function getOtherSessionsForTf(
  index: Map<string, TfSessionHit[]>,
  tfKey: string,
  currentSessionId: string
): TfSessionHit[] {
  const key = normalizeTfKey(tfKey);
  if (!key) return [];
  return (index.get(key) || []).filter((h) => h.sessionId !== currentSessionId);
}

export { normalizeTfKey };

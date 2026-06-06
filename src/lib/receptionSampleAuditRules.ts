import { normalizeReceptionReference } from '@/lib/receptionReference';
import type {
  ComparisonResult,
  SampleDelivery,
  SamplePhotoReceptionStatus,
  SavedSampleVerification,
} from '@/types';

export type SampleValidationStatus = ComparisonResult['status'];

export type ReceptionAuditExemptReason = 'legacy_in_db' | 'adidas_virtual';

export interface LatestValidationEntry {
  status: SampleValidationStatus;
  sessionName: string;
  sessionId: string;
  createdAtMs: number;
}

/** Misma heurística que SampleVerification al guardar (nombre sesión AD… / ADIDAS). */
export function isAdidasVerificationSessionName(name: string): boolean {
  const n = name.trim().toUpperCase();
  return n.startsWith('AD') || n.includes('ADIDAS');
}

export function isManualVerificationDelivery(d: SampleDelivery): boolean {
  const src = String(d.sourceWarehouse || '').toUpperCase();
  return src.includes('VERIFICAC') && src.includes('MANUAL');
}

/** Entrega virtual inyectada al guardar verificación Adidas (TF = nombre de sesión). */
export function isAdidasVirtualDelivery(d: SampleDelivery): boolean {
  const tf = String(d.transferNumber || '').trim();
  if (!tf || !isManualVerificationDelivery(d)) return false;
  return isAdidasVerificationSessionName(tf);
}

/** Último estado guardado por referencia en verificaciones ≥ corte (más reciente gana). */
export function buildLatestValidationByRef(
  sessions: SavedSampleVerification[],
  cutoffMs: number
): Map<string, LatestValidationEntry> {
  const map = new Map<string, LatestValidationEntry>();
  const sorted = [...sessions].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  for (const session of sorted) {
    const createdMs = new Date(session.createdAt).getTime();
    if (createdMs < cutoffMs) continue;

    for (const result of session.results || []) {
      const ref = normalizeReceptionReference(result.reference || '');
      if (!ref || ref === 'UNKNOWN') continue;
      map.set(ref, {
        status: result.status,
        sessionName: session.name,
        sessionId: session.id,
        createdAtMs: createdMs,
      });
    }
  }

  return map;
}

export function getRefStatusInSession(
  session: SavedSampleVerification,
  refNorm: string
): SampleValidationStatus | null {
  const match = session.results?.find(
    (r) => normalizeReceptionReference(r.reference) === refNorm
  );
  return match?.status ?? null;
}

/**
 * Validada como ya en catálogo: no exige TF ni recepción foto en la suite
 * (histórico pre-arranque del proceso).
 */
export function isLegacyInDatabaseExempt(
  entry: LatestValidationEntry | undefined,
  inSampleDatabase: boolean
): boolean {
  if (!entry || entry.status !== 'En Base de Datos') return false;
  return inSampleDatabase;
}

export function hasAdidasVirtualDelivery(deliveries: SampleDelivery[]): boolean {
  return deliveries.some(isAdidasVirtualDelivery);
}

export type AuditPhotoDisplayStatus =
  | SamplePhotoReceptionStatus
  | 'none'
  | 'legacy_in_db'
  | 'virtual_adidas';

export interface EffectiveReceptionAuditFlags {
  hasTransferDelivery: boolean;
  hasPhotoReceptionReceived: boolean;
  photoReceptionStatus: AuditPhotoDisplayStatus;
  transferExemptReason: ReceptionAuditExemptReason | null;
  photoExemptReason: ReceptionAuditExemptReason | null;
}

export function computeEffectiveReceptionAuditFlags(input: {
  inSampleDatabase: boolean;
  latestValidation: LatestValidationEntry | undefined;
  deliveries: SampleDelivery[];
  photoReceivedCount: number;
  photoTotalCount: number;
  rawPhotoStatus: SamplePhotoReceptionStatus | 'none';
}): EffectiveReceptionAuditFlags {
  const hasRecordedTf = input.deliveries.some((d) => String(d.transferNumber || '').trim());
  const legacyExempt = isLegacyInDatabaseExempt(input.latestValidation, input.inSampleDatabase);
  const adidasVirtual = !legacyExempt && hasAdidasVirtualDelivery(input.deliveries);

  const transferExemptReason: ReceptionAuditExemptReason | null = legacyExempt
    ? 'legacy_in_db'
    : null;

  let photoExemptReason: ReceptionAuditExemptReason | null = null;
  if (input.photoReceivedCount > 0) {
    photoExemptReason = null;
  } else if (legacyExempt) {
    photoExemptReason = 'legacy_in_db';
  } else if (adidasVirtual) {
    photoExemptReason = 'adidas_virtual';
  }

  const hasTransferDelivery = hasRecordedTf || transferExemptReason === 'legacy_in_db';
  const hasPhotoReceptionReceived =
    input.photoReceivedCount > 0 || photoExemptReason != null;

  let photoReceptionStatus: AuditPhotoDisplayStatus = input.rawPhotoStatus;
  if (input.photoReceivedCount > 0) {
    photoReceptionStatus = 'received';
  } else if (photoExemptReason === 'legacy_in_db') {
    photoReceptionStatus = 'legacy_in_db';
  } else if (photoExemptReason === 'adidas_virtual') {
    photoReceptionStatus = 'virtual_adidas';
  }

  return {
    hasTransferDelivery,
    hasPhotoReceptionReceived,
    photoReceptionStatus,
    transferExemptReason,
    photoExemptReason,
  };
}

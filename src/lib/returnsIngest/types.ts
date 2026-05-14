/** Estado del período mensual en Firestore (reporte de devoluciones). */
export type ReturnsPeriodStatus = 'partial' | 'complete';

/** Metadatos del documento `returnsPeriods/{periodId}` (periodId = YYYY-MM). */
export interface ReturnsPeriodMetaDoc {
  periodId: string;
  year: number;
  month: number;
  status: ReturnsPeriodStatus;
  lastIngestAt?: unknown;
  lastIngestBy?: string;
  /** Último día (YYYY-MM-DD) incluido en la última ingesta (útil si el mes es parcial). */
  coversThrough?: string;
  bucketCount?: number;
}

/**
 * Agregado opción B: líneas idénticas en dimensión + referencia completa se fusionan.
 * Un documento por bucket en `returnsPeriods/{periodId}/buckets/{bucketDocId}`.
 */
export interface ReturnsBucketDoc {
  dayKey: string;
  type: string;
  pdv: string;
  brand: string;
  gender: string;
  group: string;
  /** Cadena vacía = sin motivo (equivale a null en Transaction). */
  returnReason: string;
  reference: string;
  lineCount: number;
  sumValue: number;
  sumQuantity: number;
}

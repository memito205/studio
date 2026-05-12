import type { DistributionResult, ItemForecast } from '@/types';

/**
 * Contrato versionado para persistir corridas de pronóstico + distribución (insumos/bolsas).
 * No incluye filas crudas de consumo: solo resúmenes listos para Firestore (paso 1).
 */
export const FORECAST_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export type ForecastSnapshotSchemaVersion = typeof FORECAST_SNAPSHOT_SCHEMA_VERSION;

/** Una línea de pronóstico agregado por período futuro (referencia única). */
export interface ForecastRunForecastLineV1 {
  periodLabel: string;
  periodStart?: string;
  periodEnd?: string;
  value: number | null;
  adjustedValue: number | null;
}

/** Resumen por referencia al momento de la corrida. */
export interface ForecastRunItemSummaryV1 {
  itemCode: string;
  leadTimeDays: number;
  serviceLevelPercentage: number;
  currentInventorySnapshot: number;
  forecastingMethodNote?: string;
  winningMethod?: string | null;
  outliersAdjusted: boolean;
  /** Si existían índices estacionales (12 meses) en el ítem. */
  hasSeasonalIndices: boolean;
  recommendedPurchase: number | null;
  finalRecommendedPurchase: number | null;
  lines: ForecastRunForecastLineV1[];
}

/** Una fila de distribución por bodega × referencia al momento de la corrida. */
export interface ForecastRunDistributionLineV1 {
  bodega: string;
  itemCode: string;
  coverageDays: number;
  currentBodegaInventory: number;
  forecastedDemandForCoverage: number | null;
  targetInventoryForCoverage: number | null;
  currentInventoryCoverageDays: number | null;
  quantityToSend: number;
  effectiveDailyRateAjsAdjusted: number | null;
  calculationMethod?: string;
  bodegaShare?: number | null;
  bodegaAjsPercentage?: number | null;
  /** Notas originales truncadas para no inflar el documento. */
  notesTruncated?: string;
}

export interface ForecastRunHeaderV1 {
  schemaVersion: ForecastSnapshotSchemaVersion;
  /** Instante de generación del snapshot (ISO 8601). */
  generationDateIso: string;
  /** Rango del histórico consumido (solo metadatos; fechas yyyy-MM-dd). */
  historyFrom?: string;
  historyTo?: string;
  itemCount: number;
  distributionLineCount: number;
  createdBy?: string;
  engineVersion?: string;
  appVersion?: string;
  /** Hash corto o firma de archivos de entrada (opcional). */
  sourceFingerprint?: string;
}

export interface ForecastRunPayloadV1 {
  header: ForecastRunHeaderV1;
  forecastByItem: ForecastRunItemSummaryV1[];
  distributionByBodegaItem: ForecastRunDistributionLineV1[];
}

export interface BuildForecastRunPayloadInput {
  generationDate: Date;
  itemForecasts: ItemForecast[];
  distributionResults?: DistributionResult[] | null;
  historyRange?: { from: string; to: string };
  meta?: {
    createdBy?: string;
    engineVersion?: string;
    appVersion?: string;
    sourceFingerprint?: string;
  };
}

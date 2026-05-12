import type { DistributionResult, ItemForecast, PeriodForecastValue } from '@/types';
import type {
  BuildForecastRunPayloadInput,
  ForecastRunDistributionLineV1,
  ForecastRunForecastLineV1,
  ForecastRunItemSummaryV1,
  ForecastRunPayloadV1,
} from './types';
import { FORECAST_SNAPSHOT_SCHEMA_VERSION } from './types';

const NOTES_MAX_LEN = 500;

function toIsoDateTime(d: Date): string {
  if (Number.isNaN(d.getTime())) return new Date(0).toISOString();
  return d.toISOString();
}

function toIsoDateOnly(d: Date | undefined): string | undefined {
  if (!d || Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 10);
}

function truncateNotes(s: string | undefined, maxLen: number): string | undefined {
  if (s == null || s === '') return undefined;
  const t = s.trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen)}…`;
}

function mapPeriodLine(p: PeriodForecastValue): ForecastRunForecastLineV1 {
  return {
    periodLabel: p.periodLabel,
    periodStart: toIsoDateOnly(p.startDate),
    periodEnd: toIsoDateOnly(p.endDate),
    value: p.value ?? null,
    adjustedValue: p.adjustedValue !== undefined && p.adjustedValue !== null ? p.adjustedValue : null,
  };
}

function mapItemForecast(item: ItemForecast): ForecastRunItemSummaryV1 {
  const lines = (item.aggregatedFutureForecasts || []).map(mapPeriodLine);
  return {
    itemCode: item.itemCode,
    leadTimeDays: item.leadTimeDays,
    serviceLevelPercentage: item.serviceLevelPercentage,
    currentInventorySnapshot: item.currentInventory,
    forecastingMethodNote: truncateNotes(item.forecastingMethodNote, NOTES_MAX_LEN),
    winningMethod: item.winningMethod ?? null,
    outliersAdjusted: !!item.outliersAdjusted,
    hasSeasonalIndices: Array.isArray(item.seasonalIndices) && item.seasonalIndices.length > 0,
    recommendedPurchase: item.recommendedPurchase ?? null,
    finalRecommendedPurchase: item.finalRecommendedPurchase ?? null,
    lines,
  };
}

function mapDistributionRow(row: DistributionResult): ForecastRunDistributionLineV1 {
  const trace = row.calculationTrace;
  return {
    bodega: row.bodega,
    itemCode: row.itemCode,
    coverageDays: typeof trace?.coverageDays === 'number' ? trace.coverageDays : 0,
    currentBodegaInventory: row.currentBodegaInventory,
    forecastedDemandForCoverage: row.forecastedDemandForCoverage ?? null,
    targetInventoryForCoverage: row.targetInventoryForCoverage ?? null,
    currentInventoryCoverageDays: row.currentInventoryCoverageDays ?? null,
    quantityToSend: row.quantityToSend,
    effectiveDailyRateAjsAdjusted:
      typeof trace?.effectiveBodegaDailyForecast_AjsAdjusted === 'number'
        ? trace.effectiveBodegaDailyForecast_AjsAdjusted
        : null,
    calculationMethod: trace?.calculationMethod,
    bodegaShare: typeof trace?.bodegaShare === 'number' ? trace.bodegaShare : null,
    bodegaAjsPercentage: typeof trace?.bodegaAjsPercentage === 'number' ? trace.bodegaAjsPercentage : null,
    notesTruncated: truncateNotes(row.notes, NOTES_MAX_LEN),
  };
}

/**
 * Construye el payload versionado listo para guardar en Firestore (sin I/O).
 * No modifica el motor de pronóstico ni de distribución: solo serializa lo ya calculado.
 */
export function buildForecastRunPayload(input: BuildForecastRunPayloadInput): ForecastRunPayloadV1 {
  const { generationDate, itemForecasts, distributionResults, historyRange, meta } = input;

  const forecastByItem = (itemForecasts || []).map(mapItemForecast);
  const distributionByBodegaItem = (distributionResults || []).map(mapDistributionRow);

  const header = {
    schemaVersion: FORECAST_SNAPSHOT_SCHEMA_VERSION,
    generationDateIso: toIsoDateTime(generationDate),
    historyFrom: historyRange?.from,
    historyTo: historyRange?.to,
    itemCount: forecastByItem.length,
    distributionLineCount: distributionByBodegaItem.length,
    createdBy: meta?.createdBy,
    engineVersion: meta?.engineVersion,
    appVersion: meta?.appVersion,
    sourceFingerprint: meta?.sourceFingerprint,
  };

  return {
    header,
    forecastByItem,
    distributionByBodegaItem,
  };
}

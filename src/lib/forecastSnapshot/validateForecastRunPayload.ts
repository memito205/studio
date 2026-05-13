import { z } from 'zod';
import type { ForecastRunPayloadV1 } from './types';
import { FORECAST_SNAPSHOT_SCHEMA_VERSION } from './types';

const numNull = z.union([z.number(), z.null()]);

const forecastLineSchema = z.object({
  periodLabel: z.string(),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
  value: numNull,
  adjustedValue: numNull,
});

const itemSummarySchema = z.object({
  itemCode: z.string().min(1),
  leadTimeDays: z.number(),
  serviceLevelPercentage: z.number(),
  currentInventorySnapshot: z.number(),
  forecastingMethodNote: z.string().optional(),
  winningMethod: z.string().nullable().optional(),
  outliersAdjusted: z.boolean(),
  hasSeasonalIndices: z.boolean(),
  recommendedPurchase: numNull,
  finalRecommendedPurchase: numNull,
  lines: z.array(forecastLineSchema),
});

const distributionLineSchema = z.object({
  bodega: z.string().min(1),
  itemCode: z.string().min(1),
  coverageDays: z.number().nonnegative(),
  currentBodegaInventory: z.number(),
  forecastedDemandForCoverage: numNull,
  targetInventoryForCoverage: numNull,
  currentInventoryCoverageDays: numNull,
  quantityToSend: z.number().nonnegative(),
  effectiveDailyRateAjsAdjusted: numNull,
  calculationMethod: z.string().optional(),
  bodegaShare: numNull.optional(),
  bodegaAjsPercentage: numNull.optional(),
  notesTruncated: z.string().optional(),
});

const headerSchema = z.object({
  schemaVersion: z.literal(FORECAST_SNAPSHOT_SCHEMA_VERSION),
  generationDateIso: z.string().min(10),
  historyFrom: z.string().optional(),
  historyTo: z.string().optional(),
  itemCount: z.number().int().nonnegative(),
  distributionLineCount: z.number().int().nonnegative(),
  createdBy: z.string().optional(),
  engineVersion: z.string().optional(),
  appVersion: z.string().optional(),
  sourceFingerprint: z.string().optional(),
});

export const forecastRunPayloadSchema = z.object({
  header: headerSchema,
  forecastByItem: z.array(itemSummarySchema),
  distributionByBodegaItem: z.array(distributionLineSchema),
});

export function parseForecastRunPayload(data: unknown): ForecastRunPayloadV1 {
  return forecastRunPayloadSchema.parse(data) as ForecastRunPayloadV1;
}

export function safeParseForecastRunPayload(data: unknown) {
  return forecastRunPayloadSchema.safeParse(data);
}

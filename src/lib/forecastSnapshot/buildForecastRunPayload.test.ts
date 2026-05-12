import { describe, expect, it } from 'vitest';
import { buildForecastRunPayload } from './buildForecastRunPayload';
import { parseForecastRunPayload } from './validateForecastRunPayload';
import { FORECAST_SNAPSHOT_SCHEMA_VERSION } from './types';
import type { DistributionResult, ItemForecast } from '@/types';

const baseGeneration = new Date('2026-05-12T15:00:00.000Z');

function minimalItemForecast(overrides: Partial<ItemForecast> = {}): ItemForecast {
  return {
    itemCode: '9619',
    historicalData: [],
    currentInventory: 100,
    methodForecasts: [],
    aggregatedFutureForecasts: [
      {
        periodLabel: 'Jun 2026',
        value: 400,
        adjustedValue: 420,
        startDate: new Date('2026-06-01'),
        endDate: new Date('2026-06-30'),
      },
    ],
    recommendedPurchase: 300,
    nextPeriodShortfall: null,
    nextPeriodShortfallDateRangeLabel: null,
    coverageTargetPeriods: 4,
    totalHistoricalMainConsumption: 0,
    totalHistoricalAjsConsumption: 0,
    ajsConsumptionPercentage: null,
    finalRecommendedPurchase: 310,
    calculatedDemandForShortfallPeriod: null,
    calculatedTotalDemandForNFullFutureMonths: null,
    outliersAdjusted: false,
    seasonalIndices: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    leadTimeDays: 7,
    serviceLevelPercentage: 95,
    safetyStock: null,
    reorderPoint: null,
    maePerMethod: null,
    forecastingMethodNote: 'Modelo: SES.',
    winningMethod: 'SES',
    ...overrides,
  };
}

describe('buildForecastRunPayload', () => {
  it('arma cabecera v1 y lista de pronósticos por referencia', () => {
    const payload = buildForecastRunPayload({
      generationDate: baseGeneration,
      itemForecasts: [minimalItemForecast()],
      historyRange: { from: '2023-01-01', to: '2026-04-30' },
      meta: { createdBy: 'tester', engineVersion: 'forecastingEngine@1', appVersion: '0.1.0' },
    });

    expect(payload.header.schemaVersion).toBe(FORECAST_SNAPSHOT_SCHEMA_VERSION);
    expect(payload.header.generationDateIso).toBe('2026-05-12T15:00:00.000Z');
    expect(payload.header.historyFrom).toBe('2023-01-01');
    expect(payload.header.historyTo).toBe('2026-04-30');
    expect(payload.header.itemCount).toBe(1);
    expect(payload.header.distributionLineCount).toBe(0);
    expect(payload.header.createdBy).toBe('tester');

    expect(payload.forecastByItem).toHaveLength(1);
    const item = payload.forecastByItem[0];
    expect(item.itemCode).toBe('9619');
    expect(item.currentInventorySnapshot).toBe(100);
    expect(item.hasSeasonalIndices).toBe(true);
    expect(item.lines).toHaveLength(1);
    expect(item.lines[0].value).toBe(400);
    expect(item.lines[0].adjustedValue).toBe(420);
    expect(item.lines[0].periodStart).toBe('2026-06-01');
    expect(item.lines[0].periodEnd).toBe('2026-06-30');

    expect(payload.distributionByBodegaItem).toEqual([]);
  });

  it('incluye líneas de distribución y campos del trace', () => {
    const dist: DistributionResult = {
      bodega: 'B1',
      itemCode: '9619',
      currentBodegaInventory: 100,
      forecastedDemandForCoverage: 400,
      targetInventoryForCoverage: 400,
      currentInventoryCoverageDays: 2.5,
      quantityToSend: 300,
      notes: 'Participación Histórica',
      calculationTrace: {
        coverageDays: 15,
        effectiveBodegaDailyForecast_AjsAdjusted: 26.67,
        calculationMethod: 'Participación Histórica',
        bodegaShare: 0.12,
        bodegaAjsPercentage: 5,
      },
    };

    const payload = buildForecastRunPayload({
      generationDate: baseGeneration,
      itemForecasts: [minimalItemForecast()],
      distributionResults: [dist],
    });

    expect(payload.header.distributionLineCount).toBe(1);
    const row = payload.distributionByBodegaItem[0];
    expect(row.bodega).toBe('B1');
    expect(row.itemCode).toBe('9619');
    expect(row.coverageDays).toBe(15);
    expect(row.quantityToSend).toBe(300);
    expect(row.effectiveDailyRateAjsAdjusted).toBe(26.67);
    expect(row.calculationMethod).toBe('Participación Histórica');
    expect(row.bodegaShare).toBe(0.12);
    expect(row.bodegaAjsPercentage).toBe(5);
  });

  it('trunca notas largas', () => {
    const long = 'x'.repeat(600);
    const payload = buildForecastRunPayload({
      generationDate: baseGeneration,
      itemForecasts: [minimalItemForecast({ forecastingMethodNote: long })],
    });
    const note = payload.forecastByItem[0].forecastingMethodNote;
    expect(note!.length).toBeLessThanOrEqual(501);
    expect(note!.endsWith('…')).toBe(true);
  });

  it('adjustedValue null se serializa como null', () => {
    const item = minimalItemForecast();
    item.aggregatedFutureForecasts = [{ periodLabel: 'Jul 2026', value: 100, adjustedValue: undefined }];
    const payload = buildForecastRunPayload({
      generationDate: baseGeneration,
      itemForecasts: [item],
    });
    expect(payload.forecastByItem[0].lines[0].adjustedValue).toBeNull();
  });

  it('el resultado de build pasa validación Zod (roundtrip)', () => {
    const payload = buildForecastRunPayload({
      generationDate: baseGeneration,
      itemForecasts: [minimalItemForecast()],
      distributionResults: [
        {
          bodega: 'B1',
          itemCode: '9619',
          currentBodegaInventory: 100,
          forecastedDemandForCoverage: 400,
          targetInventoryForCoverage: 400,
          currentInventoryCoverageDays: 2.5,
          quantityToSend: 300,
          notes: 'Test',
          calculationTrace: {
            coverageDays: 15,
            effectiveBodegaDailyForecast_AjsAdjusted: 26.67,
            calculationMethod: 'Participación Histórica',
            bodegaShare: 0.12,
            bodegaAjsPercentage: 5,
          },
        },
      ],
    });
    expect(() => parseForecastRunPayload(payload)).not.toThrow();
  });
});

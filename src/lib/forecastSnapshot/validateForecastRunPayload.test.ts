import { describe, expect, it } from 'vitest';
import { parseForecastRunPayload, safeParseForecastRunPayload } from './validateForecastRunPayload';
import { FORECAST_SNAPSHOT_SCHEMA_VERSION } from './types';

const minimalValid = {
  header: {
    schemaVersion: FORECAST_SNAPSHOT_SCHEMA_VERSION,
    generationDateIso: '2026-05-12T15:00:00.000Z',
    historyFrom: '2023-01-01',
    historyTo: '2026-04-30',
    itemCount: 1,
    distributionLineCount: 0,
  },
  forecastByItem: [
    {
      itemCode: '9619',
      leadTimeDays: 7,
      serviceLevelPercentage: 95,
      currentInventorySnapshot: 100,
      outliersAdjusted: false,
      hasSeasonalIndices: true,
      recommendedPurchase: 300,
      finalRecommendedPurchase: 310,
      lines: [
        {
          periodLabel: 'Jun 2026',
          periodStart: '2026-06-01',
          periodEnd: '2026-06-30',
          value: 400,
          adjustedValue: 420,
        },
      ],
    },
  ],
  distributionByBodegaItem: [],
};

describe('validateForecastRunPayload', () => {
  it('acepta payload mínimo válido', () => {
    const r = safeParseForecastRunPayload(minimalValid);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.header.itemCount).toBe(1);
    }
  });

  it('rechaza schemaVersion incorrecto', () => {
    const bad = { ...minimalValid, header: { ...minimalValid.header, schemaVersion: 2 } };
    const r = safeParseForecastRunPayload(bad);
    expect(r.success).toBe(false);
  });

  it('rechaza itemCode vacío', () => {
    const bad = {
      ...minimalValid,
      forecastByItem: [{ ...minimalValid.forecastByItem[0], itemCode: '' }],
    };
    const r = safeParseForecastRunPayload(bad);
    expect(r.success).toBe(false);
  });

  it('parseForecastRunPayload lanza en inválido', () => {
    expect(() => parseForecastRunPayload({})).toThrow();
  });
});

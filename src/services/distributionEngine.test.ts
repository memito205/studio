import { describe, expect, it } from 'vitest';
import { calculateDistribution } from './distributionEngine';
import type { BodegaInventory, ItemForecast, ProcessedRow } from '@/types';
import {
  MIN_MONTHS_FOR_DIRECT_FORECAST,
  MAX_CV_FOR_DIRECT_FORECAST,
  DISTRIBUTION_COVERAGE_DAYS,
} from '@/components/bag-distribution/constants';

function consumptionRow(
  itemCode: string,
  bodega: string,
  quantity: number,
  year: number,
  month: number
): ProcessedRow {
  return {
    itemCode,
    docType: 'RMV',
    date: new Date(year, month - 1, 15),
    quantity,
    bodega,
  };
}

function monthsOfStableConsumption(
  bodega: string,
  itemCode: string,
  quantityPerMonth: number,
  monthCount: number,
  startYear = 2024,
  startMonth = 1
): ProcessedRow[] {
  const rows: ProcessedRow[] = [];
  let year = startYear;
  let month = startMonth;

  for (let i = 0; i < monthCount; i++) {
    rows.push(consumptionRow(itemCode, bodega, quantityPerMonth, year, month));
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return rows;
}

function minimalItemForecast(itemCode: string, dailyRate: number): ItemForecast {
  return {
    itemCode,
    historicalData: [],
    currentInventory: 0,
    methodForecasts: [],
    aggregatedFutureForecasts: [],
    recommendedPurchase: null,
    nextPeriodShortfall: null,
    nextPeriodShortfallDateRangeLabel: null,
    coverageTargetPeriods: 4,
    totalHistoricalMainConsumption: 0,
    totalHistoricalAjsConsumption: 0,
    ajsConsumptionPercentage: null,
    finalRecommendedPurchase: null,
    calculatedDemandForShortfallPeriod: null,
    calculatedTotalDemandForNFullFutureMonths: null,
    outliersAdjusted: false,
    seasonalIndices: Array(12).fill(1),
    leadTimeDays: 7,
    serviceLevelPercentage: 95,
    safetyStock: null,
    reorderPoint: null,
    maePerMethod: null,
    calculationTrace: {
      shortfall_dailyRate: dailyRate,
      bodegaAjsPercentage: 0,
      effectiveBodegaDailyForecast_AjsAdjusted: 0,
      coverageDays: DISTRIBUTION_COVERAGE_DAYS,
      targetInventory: 0,
      currentBodegaInventory: 0,
      currentInventoryCoverageDays: null,
      quantityToSend_PreRounding: 0,
      roundingMultiple: 1,
      quantityToSend_Final: 0,
    },
  };
}

function findResult(
  results: ReturnType<typeof calculateDistribution>['results'],
  bodega: string,
  itemCode: string
) {
  return results.find(r => r.bodega === bodega && r.itemCode === itemCode);
}

describe('calculateDistribution — fallback Promedio Histórico Corto', () => {
  const itemCode = '9619';
  const baseDailyRate = 1000;

  it('mantiene Pronóstico Directo para bodegas con >=12 meses estables', () => {
    const matureBodega = 'MATURE01';
    const history = monthsOfStableConsumption(matureBodega, itemCode, 100, 12);
    const inventories: BodegaInventory[] = [{ bodega: matureBodega, itemCode, quantity: 0 }];
    const forecasts = [minimalItemForecast(itemCode, baseDailyRate)];

    const { results } = calculateDistribution(
      history,
      inventories,
      forecasts,
      {},
      MIN_MONTHS_FOR_DIRECT_FORECAST,
      MAX_CV_FOR_DIRECT_FORECAST
    );

    const row = findResult(results, matureBodega, itemCode);
    expect(row?.calculationTrace?.calculationMethod).toBe('Pronóstico Directo');
    expect(row?.calculationTrace?.directForecastEligibility?.isEligible).toBe(true);
  });

  it('usa Promedio Histórico Corto cuando hay pocos meses pero consumo local', () => {
    const shortBodega = '40201';
    const anchorBodega = 'BIG001';
    const shortHistory = monthsOfStableConsumption(shortBodega, itemCode, 30, 3, 2025, 1);
    const anchorHistory = monthsOfStableConsumption(anchorBodega, itemCode, 3000, 12, 2024, 1);
    const allRows = [...shortHistory, ...anchorHistory];

    const inventories: BodegaInventory[] = [
      { bodega: shortBodega, itemCode, quantity: 0 },
      { bodega: anchorBodega, itemCode, quantity: 0 },
    ];
    const forecasts = [minimalItemForecast(itemCode, baseDailyRate)];

    const { results } = calculateDistribution(
      allRows,
      inventories,
      forecasts,
      {},
      MIN_MONTHS_FOR_DIRECT_FORECAST,
      MAX_CV_FOR_DIRECT_FORECAST
    );

    const row = findResult(results, shortBodega, itemCode);
    expect(row?.calculationTrace?.calculationMethod).toBe('Promedio Histórico Corto');
    expect(row?.calculationTrace?.directForecastEligibility?.isEligible).toBe(false);

    const expectedDaily = 30 / 30.44;
    expect(row?.calculationTrace?.baseItemMonthlyForecast).toBeCloseTo(30, 5);
    expect(row?.calculationTrace?.shortfall_dailyRate).toBeCloseTo(expectedDaily, 4);
  });

  it('conserva Participación Histórica con demanda cero si la bodega no tiene consumo', () => {
    const emptyBodega = 'NEW000';
    const anchorBodega = 'BIG001';
    const anchorHistory = monthsOfStableConsumption(anchorBodega, itemCode, 500, 12, 2024, 1);

    const inventories: BodegaInventory[] = [
      { bodega: emptyBodega, itemCode, quantity: 0 },
      { bodega: anchorBodega, itemCode, quantity: 0 },
    ];
    const forecasts = [minimalItemForecast(itemCode, baseDailyRate)];

    const { results } = calculateDistribution(
      anchorHistory,
      inventories,
      forecasts,
      {},
      MIN_MONTHS_FOR_DIRECT_FORECAST,
      MAX_CV_FOR_DIRECT_FORECAST
    );

    const row = findResult(results, emptyBodega, itemCode);
    expect(row?.calculationTrace?.calculationMethod).toBe('Participación Histórica');
    expect(row?.calculationTrace?.bodegaShare).toBe(0);
    expect(row?.calculationTrace?.shortfall_dailyRate).toBe(0);
    expect(row?.quantityToSend).toBe(0);
  });

  it('prioriza Promedio Histórico Corto sobre participación tiny en la misma corrida', () => {
    const shortBodega = '40201';
    const matureBodega = 'MATURE01';

    const shortHistory = monthsOfStableConsumption(shortBodega, itemCode, 40, 3, 2025, 4);
    const matureHistory = monthsOfStableConsumption(matureBodega, itemCode, 200, 12, 2024, 1);
    const allRows = [...shortHistory, ...matureHistory];

    const inventories: BodegaInventory[] = [
      { bodega: shortBodega, itemCode, quantity: 5 },
      { bodega: matureBodega, itemCode, quantity: 5 },
    ];

    const { results } = calculateDistribution(
      allRows,
      inventories,
      [minimalItemForecast(itemCode, baseDailyRate)],
      {},
      MIN_MONTHS_FOR_DIRECT_FORECAST,
      MAX_CV_FOR_DIRECT_FORECAST
    );

    expect(findResult(results, matureBodega, itemCode)?.calculationTrace?.calculationMethod).toBe(
      'Pronóstico Directo'
    );
    expect(findResult(results, shortBodega, itemCode)?.calculationTrace?.calculationMethod).toBe(
      'Promedio Histórico Corto'
    );
  });
});

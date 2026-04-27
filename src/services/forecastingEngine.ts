

import type { AllItemsMonthlyData, ItemMonthlyData, ItemForecast, MethodForecast, PeriodForecastValue, ItemParameters, MonthlyConsumption, ProcessedRow, CalculationTrace, DirectForecastEligibility, BodegaInventory, DistributionResult } from '@/types';
import { 
    SMA_PERIOD, SES_ALPHA, WMA_PERIOD, NUMBER_OF_FUTURE_PERIODS_FOR_RECOMMENDATION, 
    MONTH_NAMES_ES, Z_SCORE_LOOKUP, DEFAULT_LEAD_TIME_DAYS, DEFAULT_SERVICE_LEVEL_PERCENTAGE,
    BODEGAS_TO_EXCLUDE_FOR_DISTRIBUTION, MIN_MONTHS_FOR_FULL_FORECAST,
    MAIN_CONSUMPTION_DOC_TYPES, ADJUSTMENT_DOC_TYPES,
    DAMPING_FACTOR,
    MINIMUM_SEASONAL_FACTORS,
    ITEM_SPECIFIC_ROUNDING_RULES,
    DEFAULT_ROUNDING_MULTIPLE
} from '@/components/bag-distribution/constants';
import { parseRobustNumber } from '@/lib/parsingUtils';
import { addDays, startOfWeek, format, isSameDay, differenceInDays, startOfDay } from 'date-fns';
import { es } from 'date-fns/locale';

// --- Helper Functions ---

function getDaysInMonth(year: number, month: number): number { // month is 0-indexed
  return new Date(year, month + 1, 0).getDate();
}

function formatDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}`;
}

function getMonthOffset(targetDate: Date, baseDate: Date): number {
  const targetYear = targetDate.getFullYear();
  const targetMonth = targetDate.getMonth();
  const baseYear = baseDate.getFullYear();
  const baseMonth = baseDate.getMonth();
  return (targetYear - baseYear) * 12 + (targetMonth - baseMonth);
}

function normalizeHistoricalData(data: ItemMonthlyData): ItemMonthlyData {
    if (data.length === 0) return [];
    
    const sortedData = [...data].sort((a,b) => a.date.getTime() - b.date.getTime());
    const firstDate = sortedData[0].date;
    const lastDate = sortedData[sortedData.length - 1].date;
    
    const normalizedData: ItemMonthlyData = [];
    let currentDate = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);

    while(currentDate <= lastDate) {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1; // 1-12
        
        const existingEntry = sortedData.find(d => d.year === year && d.month === month);
        
        if(existingEntry) {
            normalizedData.push(existingEntry);
        } else {
            normalizedData.push({
                year,
                month,
                mainQuantity: 0,
                ajsQuantity: 0,
                totalQuantity: 0,
                date: new Date(currentDate)
            });
        }
        
        currentDate.setMonth(currentDate.getMonth() + 1);
    }
    
    return normalizedData;
}


function getForecastPeriodDetails(
  generationDate: Date,
  numFutureRegularPeriods: number
): {
  shortfallPeriodStartDate: Date;
  shortfallPeriodEndDate: Date;
  shortfallPeriodLabel: string;
  futureRegularMonthPeriods: Array<{ periodLabel: string; startDate: Date; endDate: Date }>;
} {
  const shortfallPeriodStartDate = new Date(generationDate);
  const currentYear = generationDate.getFullYear();
  const currentMonth = generationDate.getMonth();

  // The shortfall period now ends at the end of the *current* full month.
  const shortfallPeriodEndDate = new Date(currentYear, currentMonth + 1, 0);

  // The first "regular" forecast period starts at the beginning of the next month.
  const firstRegularForecastMonthStartDate = new Date(currentYear, currentMonth + 1, 1);
  
  const shortfallPeriodLabel = `(${formatDate(shortfallPeriodStartDate)} - ${formatDate(shortfallPeriodEndDate)})`;
  
  const futureRegularMonthPeriods: Array<{ periodLabel: string; startDate: Date; endDate: Date }> = [];
  for (let i = 0; i < numFutureRegularPeriods; i++) {
    const periodStartDate = new Date(firstRegularForecastMonthStartDate);
    periodStartDate.setMonth(firstRegularForecastMonthStartDate.getMonth() + i);
    const periodEndDate = new Date(periodStartDate.getFullYear(), periodStartDate.getMonth() + 1, 0);
    futureRegularMonthPeriods.push({
      periodLabel: `${MONTH_NAMES_ES[periodStartDate.getMonth()]} ${periodStartDate.getFullYear()}`,
      startDate: periodStartDate,
      endDate: periodEndDate,
    });
  }
  return { shortfallPeriodStartDate, shortfallPeriodEndDate, shortfallPeriodLabel, futureRegularMonthPeriods };
}


function getWMAWeights(period: number): number[] {
  if (period <= 0) return [];
  const denominator = (period * (period + 1)) / 2;
  const weights: number[] = [];
  for (let i = 0; i < period; i++) {
    weights.push((i + 1) / denominator);
  }
  return weights; 
}

// --- Outlier Detection and Adjustment ---
function detectAndAdjustOutliers(historicalData: ItemMonthlyData): { adjustedData: ItemMonthlyData, outliersAdjusted: boolean } {
  if (historicalData.length < 12) { 
    return { adjustedData: historicalData.map(d => ({...d, originalTotalQuantity: d.totalQuantity})), outliersAdjusted: false };
  }

  const quantities = historicalData.map(d => d.totalQuantity).sort((a, b) => a - b);
  const q1Index = Math.floor(quantities.length / 4);
  const q3Index = Math.ceil(quantities.length * (3 / 4)) -1; 
  const q1 = quantities[q1Index];
  const q3 = quantities[q3Index];
  const iqr = q3 - q1;

  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;
  let outliersFound = false;

  const adjustedData = historicalData.map(d => {
    const originalQty = d.totalQuantity;
    let newTotalQuantity = d.totalQuantity;
    if (d.totalQuantity < lowerBound) {
      newTotalQuantity = Math.max(0, Math.round(lowerBound)); 
      outliersFound = true;
    } else if (d.totalQuantity > upperBound) {
      newTotalQuantity = Math.round(upperBound); 
      outliersFound = true;
    }
    return { 
        ...d, 
        totalQuantity: newTotalQuantity,
        originalTotalQuantity: originalQty 
    };
  });
  return { adjustedData, outliersAdjusted: outliersFound };
}


// --- Seasonality Calculation ---
function calculateSeasonalIndices(historicalData: ItemMonthlyData, minYears: number = 2): { indices: number[] | null; trace: string[] } {
    const logs: string[] = [];
    const numMonths = historicalData.length;
    if (numMonths < minYears * 12) {
        logs.push(`No se calculan índices estacionales, se requieren ${minYears*12} meses y hay ${numMonths}.`);
        return { indices: null, trace: logs };
    }

    const quantities = historicalData.map(d => d.totalQuantity);
    logs.push(`Cálculo sobre ${quantities.length} puntos de datos.`);

    const cma = [];
    const ma12 = [];
    for (let i = 0; i <= numMonths - 12; i++) {
        const sum = quantities.slice(i, i + 12).reduce((s, v) => s + v, 0);
        ma12.push(sum / 12);
    }
    logs.push(`Se calcularon ${ma12.length} promedios móviles de 12 meses.`);

    for (let i = 0; i < ma12.length - 1; i++) {
        cma.push((ma12[i] + ma12[i+1]) / 2);
    }
    logs.push(`Se calcularon ${cma.length} promedios móviles centrados.`);

    const ratios: { month: number; ratio: number }[] = [];
    for (let i = 0; i < cma.length; i++) {
        const dataIndex = i + 6; 
        if (dataIndex < numMonths && cma[i] > 0) { 
            ratios.push({
                month: historicalData[dataIndex].month, 
                ratio: quantities[dataIndex] / cma[i]
            });
        }
    }
    logs.push(`Se calcularon ${ratios.length} ratios de estacionalidad.`);

    if (ratios.length === 0) {
        logs.push("No se pudieron calcular ratios, se devolverán índices planos.");
        return { indices: null, trace: logs };
    }

    const monthlyRatios: number[][] = Array.from({ length: 12 }, () => []);
    ratios.forEach(r => {
        monthlyRatios[r.month - 1].push(r.ratio);
    });

    const rawSeasonalIndices = monthlyRatios.map(monthRatiosList => {
        if (monthRatiosList.length === 0) return 1; 
        return monthRatiosList.reduce((s, v) => s + v, 0) / monthRatiosList.length;
    });
    logs.push(`Índices crudos calculados: [${rawSeasonalIndices.map(r => r.toFixed(2)).join(', ')}]`);

    const sumRawIndices = rawSeasonalIndices.reduce((s, v) => s + v, 0);
    if (sumRawIndices === 0) {
        logs.push("La suma de índices es cero, devolviendo índices planos.");
        return { indices: Array(12).fill(1), trace: logs };
    }
  
    const normalizationFactor = 12 / sumRawIndices;
    logs.push(`Factor de normalización: ${normalizationFactor.toFixed(3)}.`);
    
    const finalSeasonalIndices = rawSeasonalIndices.map(idx => idx * normalizationFactor);
    logs.push(`Índices finales normalizados: [${finalSeasonalIndices.map(i => i.toFixed(2)).join(', ')}]`);

    return { indices: finalSeasonalIndices, trace: logs };
}

// --- Forecasting Methods (Multi-Period Future Forecasts) ---
function calculateSMA_MultiStep(data: number[], period: number, numForecasts: number): Array<number | null> {
  if (data.length < period || numForecasts <= 0) return [];
  const forecasts: Array<number | null> = [];
  let currentData = [...data];
  for (let i = 0; i < numForecasts; i++) {
    if (currentData.length < period) {
        for (let j = forecasts.length; j < numForecasts; j++) forecasts.push(null);
        break;
    }
    const sum = currentData.slice(-period).reduce((acc, val) => acc + val, 0);
    const forecast = Math.round(sum / period);
    forecasts.push(forecast);
    currentData.push(forecast); 
  }
  return forecasts;
}

function calculateSES_MultiStep(data: number[], alpha: number, numForecasts: number): Array<number | null> {
  if (data.length === 0 || numForecasts <= 0) return [];
  let smoothed = data[0]; 
  if (data.length > 1) {
    for (let i = 1; i < data.length; i++) {
      smoothed = alpha * data[i] + (1 - alpha) * smoothed;
    }
  }
  return Array(numForecasts).fill(Math.round(smoothed));
}

function calculateWMA_MultiStep(data: number[], period: number, numForecasts: number): Array<number | null> {
  const weights = getWMAWeights(period);
  if (data.length < period || weights.length !== period || numForecasts <= 0) return [];
  const forecasts: Array<number | null> = [];
  let currentData = [...data];
  for (let i = 0; i < numForecasts; i++) {
    if (currentData.length < period) {
       for (let j = forecasts.length; j < numForecasts; j++) forecasts.push(null);
       break;
    }
    const relevantData = currentData.slice(-period);
    let forecast = 0;
    for (let j = 0; j < period; j++) {
      forecast += relevantData[j] * weights[j]; 
    }
    forecasts.push(Math.round(forecast));
    currentData.push(Math.round(forecast)); 
  }
  return forecasts;
}

function calculateLinearRegression_MultiStep(data: number[], numForecasts: number, dampingFactor: number): Array<number | null> {
  const n = data.length;
  if (n < 2) return calculateSimpleAverage_MultiStep(data, numForecasts);

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i; sumY += data[i]; sumXY += i * data[i]; sumX2 += i * i;
  }

  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) { // if no trend, return avg
      const avg = data.reduce((s,v)=>s+v,0)/n;
      if (isNaN(avg)) return Array(numForecasts).fill(null);
      return Array(numForecasts).fill(Math.round(Math.max(0, avg)));
  }

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  const forecasts: Array<number | null> = [];
  const level = intercept + slope * (n - 1); 
  const trend = slope;

  let dampedTrendSum = 0;
  for (let h = 1; h <= numForecasts; h++) {
      dampedTrendSum += Math.pow(dampingFactor, h-1); 
      const predictedValue = level + dampedTrendSum * trend;
      forecasts.push(Math.round(Math.max(0, predictedValue)));
  }
  return forecasts;
}

function calculateSimpleAverage_MultiStep(data: number[], numForecasts: number): Array<number | null> {
    if (data.length === 0 || numForecasts <= 0) return [];
    const average = data.reduce((sum, val) => sum + val, 0) / data.length;
    return Array(numForecasts).fill(Math.round(Math.max(0, average)));
}

// --- MAE Calculation Helpers ---
function calculateSMA_HistoricalFit(data: number[], period: number): (number | null)[] {
    const fit: (number | null)[] = Array(data.length).fill(null);
    if (data.length < period) return fit;
    for (let i = period; i < data.length; i++) {
        const sum = data.slice(i - period, i).reduce((acc, val) => acc + val, 0);
        fit[i] = Math.round(sum / period);
    }
    return fit;
}

function calculateSES_HistoricalFit(data: number[], alpha: number): (number | null)[] {
    const fit: (number | null)[] = Array(data.length).fill(null);
    if (data.length === 0) return fit;
    fit[0] = data[0]; 
    let smoothed = data[0];
    for (let i = 1; i < data.length; i++) {
        fit[i] = Math.round(smoothed); 
        smoothed = alpha * data[i] + (1 - alpha) * smoothed;
    }
    return fit;
}

function calculateWMA_HistoricalFit(data: number[], period: number): (number | null)[] {
    const fit: (number | null)[] = Array(data.length).fill(null);
    const weights = getWMAWeights(period);
    if (data.length < period || weights.length !== period) return fit;
    for (let i = period; i < data.length; i++) {
        const relevantData = data.slice(i - period, i);
        let forecast = 0;
        for (let j = 0; j < period; j++) {
            forecast += relevantData[j] * weights[j];
        }
        fit[i] = Math.round(forecast);
    }
    return fit;
}

function calculateLinearRegression_HistoricalFit(data: number[]): (number | null)[] {
    const n = data.length;
    const fit: (number | null)[] = Array(n).fill(null);
    if (n < 2) return fit;

    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let i = 0; i < n; i++) {
        sumX += i;
        sumY += data[i];
        sumXY += i * data[i];
        sumX2 += i * i;
    }

    const denominator = n * sumX2 - sumX * sumX;
    
    if (denominator === 0) {
        const avg = sumY / n;
        if (!isNaN(avg)) {
             for (let i = 0; i < n; i++) {
                fit[i] = Math.round(Math.max(0, avg));
            }
        }
        return fit;
    }

    const slope = (n * sumXY - sumX * sumY) / denominator;
    const intercept = (sumY - slope * sumX) / n;

    for (let i = 0; i < n; i++) {
        const predictedValue = slope * i + intercept;
        fit[i] = Math.round(Math.max(0, predictedValue));
    }

    return fit;
}

function calculateSimpleAverage_HistoricalFit(data: number[]): (number | null)[] {
    const fit: (number | null)[] = Array(data.length).fill(null);
    if (data.length === 0) return fit;
    for(let i=1; i<data.length; i++) { 
        const historicalSlice = data.slice(0, i);
        if(historicalSlice.length > 0) {
            fit[i] = Math.round(historicalSlice.reduce((s,v)=>s+v,0) / historicalSlice.length);
        }
    }
    return fit;
}


function calculateMAE(actuals: number[], historicalFit: (number | null)[]): number | null {
    let sumAbsError = 0;
    let count = 0;
    for (let i = 0; i < actuals.length; i++) {
        if (historicalFit[i] !== null && actuals[i] !== undefined) {
            sumAbsError += Math.abs(actuals[i] - historicalFit[i]!);
            count++;
        }
    }
    return count > 0 ? sumAbsError / count : null;
}

function aggregateRowsForItem(rows: ProcessedRow[]): ItemMonthlyData {
  const monthlyMap = new Map<string, MonthlyConsumption>();

  rows.forEach(row => {
    const year = row.date.getFullYear();
    const month = row.date.getMonth() + 1; // 1-12
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;

    let monthEntry = monthlyMap.get(monthKey);
    if (!monthEntry) {
      monthEntry = { 
        year, 
        month, 
        mainQuantity: 0, 
        ajsQuantity: 0, 
        totalQuantity: 0, 
        date: new Date(year, month - 1, 1) 
      };
      monthlyMap.set(monthKey, monthEntry);
    }

    if (MAIN_CONSUMPTION_DOC_TYPES.includes(row.docType)) {
      monthEntry.mainQuantity += row.quantity;
    } else if (ADJUSTMENT_DOC_TYPES.includes(row.docType)) {
      monthEntry.ajsQuantity += row.quantity;
    }
    monthEntry.totalQuantity = monthEntry.mainQuantity + monthEntry.ajsQuantity;
  });

  return Array.from(monthlyMap.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
}


// --- Main Forecast Generation Function ---
export function generateAllForecasts(
  processedData: AllItemsMonthlyData, 
  allProcessedRows: ProcessedRow[], 
  inventories: Map<string, number>,
  itemParametersMap: Map<string, ItemParameters>,
  passedSeasonalIndices?: number[] | null
): ItemForecast[] {
  const allItemForecasts: ItemForecast[] = [];
  const generationDate = new Date(); 

  const allItemCodes = new Set([
      ...processedData.keys(),
      ...inventories.keys()
  ]);

  allItemCodes.forEach((itemCode) => {
    try {
        const trace: Partial<CalculationTrace> = { notes: [], future_periods: [] };
        const itemParams = itemParametersMap.get(itemCode) || {
            leadTimeDays: DEFAULT_LEAD_TIME_DAYS,
            serviceLevelPercentage: DEFAULT_SERVICE_LEVEL_PERCENTAGE
        };
        
        const originalHistoricalMonthlyDataForItem = processedData.get(itemCode) || [];

        const rowsForItemForecast = allProcessedRows.filter(row => 
            row.itemCode === itemCode && 
            (!row.bodega || !BODEGAS_TO_EXCLUDE_FOR_DISTRIBUTION.includes(row.bodega))
        );
        
        const historicalDataForForecastingWithGaps = aggregateRowsForItem(rowsForItemForecast);
        const historicalDataForForecasting = normalizeHistoricalData(historicalDataForForecastingWithGaps);


        const { adjustedData: outlierAdjustedHistoricalData, outliersAdjusted } = detectAndAdjustOutliers(historicalDataForForecasting);
        
        const { indices: statisticalSeasonalIndices, trace: seasonalityTrace } = calculateSeasonalIndices(outlierAdjustedHistoricalData, 2);
        trace.statisticalSeasonalIndices = statisticalSeasonalIndices;
        trace.notes?.push(...seasonalityTrace);

        const quantitiesForForecasting = outlierAdjustedHistoricalData.map(d => d.totalQuantity);
        const currentInventory = inventories.get(itemCode) || 0;
        
        let forecastingMethodNoteParts: string[] = [];
        
        let deseasonalizedQuantities = [...quantitiesForForecasting];

        if (statisticalSeasonalIndices) {
            deseasonalizedQuantities = outlierAdjustedHistoricalData.map(d => {
                const monthIndex = d.month - 1;
                return statisticalSeasonalIndices[monthIndex] > 0 ? d.totalQuantity / statisticalSeasonalIndices[monthIndex] : d.totalQuantity;
            });
            forecastingMethodNoteParts.push("Ajuste estacional (estadístico)");
        }

        const maePerMethod: Array<{ methodName: string; mae: number | null }> = [];
        if (deseasonalizedQuantities.length > 0) {
            maePerMethod.push({ methodName: 'SMA', mae: calculateMAE(deseasonalizedQuantities, calculateSMA_HistoricalFit(deseasonalizedQuantities, SMA_PERIOD)) });
            maePerMethod.push({ methodName: 'SES', mae: calculateMAE(deseasonalizedQuantities, calculateSES_HistoricalFit(deseasonalizedQuantities, SES_ALPHA)) });
            maePerMethod.push({ methodName: 'WMA', mae: calculateMAE(deseasonalizedQuantities, calculateWMA_HistoricalFit(deseasonalizedQuantities, WMA_PERIOD)) });
            maePerMethod.push({ methodName: 'Regresión Lineal', mae: calculateMAE(deseasonalizedQuantities, calculateLinearRegression_HistoricalFit(deseasonalizedQuantities)) });
            maePerMethod.push({ methodName: 'Media Simple', mae: calculateMAE(deseasonalizedQuantities, calculateSimpleAverage_HistoricalFit(deseasonalizedQuantities)) });
        }
        
        let winningMethod: string | null = 'Media Simple';
        const validMaes = maePerMethod.filter(m => m.mae !== null);
        
        const useSimpleAverageOverride = deseasonalizedQuantities.length > 0 && deseasonalizedQuantities.length < MIN_MONTHS_FOR_FULL_FORECAST;
        if (useSimpleAverageOverride) {
            winningMethod = 'Media Simple';
            forecastingMethodNoteParts.push(`Datos limitados (${quantitiesForForecasting.length} meses), usando promedio simple.`);
        } else if (validMaes.length > 0) {
            const simpleAvgMae = validMaes.find(m => m.methodName === 'Media Simple')?.mae;
            const regressionMae = validMaes.find(m => m.methodName === 'Regresión Lineal')?.mae;
            
            if (regressionMae !== null && regressionMae !== undefined && simpleAvgMae !== null && simpleAvgMae !== undefined && regressionMae < (simpleAvgMae * 1.15)) {
                 winningMethod = 'Regresión Lineal';
            } else {
                 winningMethod = validMaes.reduce((best, current) => (current.mae! < best.mae!) ? current : best).methodName;
            }
        }
        trace.winningMethod = winningMethod;
        
        if (winningMethod) {
            const winnerMae = maePerMethod?.find(m => m.methodName === winningMethod)?.mae;
            forecastingMethodNoteParts.unshift(`Modelo: ${winningMethod} (MAE: ${winnerMae !== null && winnerMae !== undefined ? winnerMae?.toFixed(2) : 'N/A'})`);
        }
         if (outliersAdjusted) {
            forecastingMethodNoteParts.push("Outliers ajustados");
        }
        
        const forecastingMethodNote = forecastingMethodNoteParts.length > 0 ? forecastingMethodNoteParts.join('. ') + '.' : undefined;

        const totalHistoricalMainConsumption = rowsForItemForecast.filter(r => MAIN_CONSUMPTION_DOC_TYPES.includes(r.docType)).reduce((sum, r) => sum + r.quantity, 0);
        const totalHistoricalAjsConsumption = rowsForItemForecast.filter(r => ADJUSTMENT_DOC_TYPES.includes(r.docType)).reduce((sum, r) => sum + r.quantity, 0);
        const totalConsumptionForAjsCalc = totalHistoricalMainConsumption + totalHistoricalAjsConsumption;
        let ajsConsumptionPercentage: number | null = (totalConsumptionForAjsCalc > 0) ? (totalHistoricalAjsConsumption / totalConsumptionForAjsCalc) * 100 : (totalHistoricalAjsConsumption > 0 ? 100 : 0);

        const firstMonthToForecastAfterHistory: Date | null = outlierAdjustedHistoricalData.length > 0 
            ? new Date(outlierAdjustedHistoricalData[outlierAdjustedHistoricalData.length - 1].date.getFullYear(), outlierAdjustedHistoricalData[outlierAdjustedHistoricalData.length - 1].date.getMonth() + 1, 1) 
            : new Date(generationDate.getFullYear(), generationDate.getMonth(), 1);

        const periodDetails = getForecastPeriodDetails(generationDate, NUMBER_OF_FUTURE_PERIODS_FOR_RECOMMENDATION);
        
        const lastRegularFuturePeriod = periodDetails.futureRegularMonthPeriods[periodDetails.futureRegularMonthPeriods.length - 1];
        const lastMonthToForecastDate = new Date(lastRegularFuturePeriod.endDate.getFullYear(), lastRegularFuturePeriod.endDate.getMonth(), 1);
        
        let numTotalForecastMonthsNeeded = 0;
        if (firstMonthToForecastAfterHistory) {
            const offset = getMonthOffset(lastMonthToForecastDate, firstMonthToForecastAfterHistory);
            numTotalForecastMonthsNeeded = Math.max(0, offset + 1);
        }
        
        const getRawForecastsForMethod = (method: string | null) => {
            if (!method || numTotalForecastMonthsNeeded <= 0) return [];
            if (deseasonalizedQuantities.length === 0) {
              if (method === 'Media Simple') { 
                  const avg = quantitiesForForecasting.reduce((s,v)=>s+v,0) / (quantitiesForForecasting.length || 1);
                  if (isNaN(avg) || avg === 0) return Array(numTotalForecastMonthsNeeded).fill(0);
                  return Array(numTotalForecastMonthsNeeded).fill(Math.round(avg));
              }
              return Array(numTotalForecastMonthsNeeded).fill(0);
            }
            switch (method) {
                case 'SMA': return calculateSMA_MultiStep(deseasonalizedQuantities, SMA_PERIOD, numTotalForecastMonthsNeeded);
                case 'SES': return calculateSES_MultiStep(deseasonalizedQuantities, SES_ALPHA, numTotalForecastMonthsNeeded);
                case 'WMA': return calculateWMA_MultiStep(deseasonalizedQuantities, WMA_PERIOD, numTotalForecastMonthsNeeded);
                case 'Regresión Lineal': return calculateLinearRegression_MultiStep(deseasonalizedQuantities, numTotalForecastMonthsNeeded, DAMPING_FACTOR);
                default: return calculateSimpleAverage_MultiStep(deseasonalizedQuantities, numTotalForecastMonthsNeeded);
            }
        };

        const winningTrendForecasts = getRawForecastsForMethod(winningMethod);
        
        const getBaseForecastForDate = (targetDate: Date): { value: number | null, trace: any } => {
            if (!firstMonthToForecastAfterHistory || winningTrendForecasts.length === 0) return { value: null, trace: {} };
            const offset = getMonthOffset(targetDate, firstMonthToForecastAfterHistory);
            
            const forecastIndex = Math.max(0, offset);

            if (forecastIndex < winningTrendForecasts.length) {
                const trendForecast = winningTrendForecasts[forecastIndex];
                if (trendForecast === null) return { value: null, trace: {} };

                const periodTrace: any = { trendForecast, trendForecast_inputData: deseasonalizedQuantities };
                
                const monthIndex = targetDate.getMonth();
                const monthNumber = monthIndex + 1;
                
                const statisticalFactor = statisticalSeasonalIndices ? statisticalSeasonalIndices[monthIndex] : 1.0;
                
                const prevYearDate = new Date(targetDate);
                prevYearDate.setFullYear(targetDate.getFullYear() - 1);
                
                const consumptionThisMonthLastYear = originalHistoricalMonthlyDataForItem.find(d => d.year === prevYearDate.getFullYear() && d.month === (prevYearDate.getMonth() + 1))?.totalQuantity;
                
                const prevMonthOfPrevYear = new Date(prevYearDate);
                prevMonthOfPrevYear.setMonth(prevYearDate.getMonth() - 1);
                const consumptionPrevMonthLastYear = originalHistoricalMonthlyDataForItem.find(d => d.year === prevMonthOfPrevYear.getFullYear() && d.month === (prevMonthOfPrevYear.getMonth() + 1))?.totalQuantity;

                let yoyGrowthFactor = 1.0;
                if(consumptionThisMonthLastYear !== undefined && consumptionPrevMonthLastYear !== undefined && consumptionPrevMonthLastYear > 0) {
                    yoyGrowthFactor = consumptionThisMonthLastYear / consumptionPrevMonthLastYear;
                }
                
                const minimumFactor = MINIMUM_SEASONAL_FACTORS[monthNumber] || 1.0;
                
                const finalSeasonalFactor = Math.max(statisticalFactor, minimumFactor, yoyGrowthFactor);

                periodTrace.seasonalIndex = finalSeasonalFactor;
                
                return { value: Math.round(trendForecast * finalSeasonalFactor), trace: periodTrace };
            }
            return { value: null, trace: {} };
        };

        // --- CALCULATION FOR SHORTFALL PERIOD ---
        let baseDemandForShortfallPeriod = 0;
        const daysRemainingCurrentMonth = Math.max(0, (new Date(generationDate.getFullYear(), generationDate.getMonth() + 1, 0).getTime() - generationDate.getTime()) / (1000 * 3600 * 24));
        
        // ALWAYS use the forecasting model for the current month.
        const { value: forecastCurrentMonth, trace: currentMonthTrace } = getBaseForecastForDate(new Date(generationDate.getFullYear(), generationDate.getMonth(), 1));
        
        const dailyRateCurrentMonth = forecastCurrentMonth !== null 
            ? forecastCurrentMonth / getDaysInMonth(generationDate.getFullYear(), generationDate.getMonth()) 
            : 0;
        
        trace.shortfall_dailyRate_source = 'Pronóstico'; // Now it's always from the forecast model
        trace.shortfall_avgMonthlyDemand = currentMonthTrace?.trendForecast; // This is the trend value, label is a bit confusing but consistent
        trace.shortfall_seasonalFactor = currentMonthTrace?.seasonalIndex; 
        trace.shortfall_monthsUsedForAvg = currentMonthTrace?.trendForecast_inputData;

        baseDemandForShortfallPeriod = dailyRateCurrentMonth * daysRemainingCurrentMonth;
        
        trace.shortfall_dailyRate = dailyRateCurrentMonth;
        trace.shortfall_daysInPeriod = daysRemainingCurrentMonth;
        trace.shortfall_baseDemand = baseDemandForShortfallPeriod;
        
        const calculatedDemandForShortfallPeriod = ajsConsumptionPercentage !== null
            ? Math.round(baseDemandForShortfallPeriod * (1 + ajsConsumptionPercentage / 100))
            : Math.round(baseDemandForShortfallPeriod);
            
        const nextPeriodShortfall = Math.max(0, calculatedDemandForShortfallPeriod - currentInventory);
        
        const aggregatedFutureForecasts: PeriodForecastValue[] = periodDetails.futureRegularMonthPeriods.map((p, idx) => {
            const { value: baseVal, trace: periodTrace } = getBaseForecastForDate(p.startDate);
            if(trace.future_periods && trace.future_periods.length > idx) {
              trace.future_periods[idx] = { ...trace.future_periods[idx], ...periodTrace };
            } else if (!trace.future_periods) {
              trace.future_periods = [periodTrace];
            } else {
              trace.future_periods.push(periodTrace);
            }

            let adjustedVal = null;
            if (baseVal !== null && ajsConsumptionPercentage !== null) {
                adjustedVal = Math.round(baseVal * (1 + ajsConsumptionPercentage/100));
            } else if (baseVal !== null) {
                adjustedVal = baseVal;
            }
            return { periodLabel: p.periodLabel, value: baseVal, adjustedValue: adjustedVal, startDate: p.startDate, endDate: p.endDate };
        });
        
        const calculatedTotalDemandForNFullFutureMonths = aggregatedFutureForecasts.reduce((sum, fc) => sum + (fc.value || 0), 0);
        
        let projectedInventoryLevel = currentInventory - calculatedDemandForShortfallPeriod;
        aggregatedFutureForecasts.forEach(aggFc => {
            const demandThisPeriod = aggFc.adjustedValue !== null ? aggFc.adjustedValue : (aggFc.value !== null ? aggFc.value : 0);
            aggFc.neededToBuyForPeriod = Math.round(Math.max(0, demandThisPeriod - projectedInventoryLevel));
            projectedInventoryLevel = projectedInventoryLevel + (aggFc.neededToBuyForPeriod || 0) - demandThisPeriod;
            aggFc.projectedInventoryAfterDemand = Math.round(projectedInventoryLevel);
        });

        const totalBaseDemandToCover = Math.round(baseDemandForShortfallPeriod) + calculatedTotalDemandForNFullFutureMonths;
        const recommendedPurchase = Math.round(Math.max(0, totalBaseDemandToCover - currentInventory));
       
        const totalAdjustedDemandForNFullFutureMonths = aggregatedFutureForecasts.reduce((sum, fc) => sum + (fc.adjustedValue || fc.value || 0), 0);
        const totalAdjustedDemandToCover = (calculatedDemandForShortfallPeriod || 0) + totalAdjustedDemandForNFullFutureMonths;
        const finalRecommendedPurchase = Math.round(Math.max(0, totalAdjustedDemandToCover - currentInventory));

        let safetyStock: number | null = null;
        let reorderPoint: number | null = null;
        if (quantitiesForForecasting.length >= 2) {
            const meanHistDemand = quantitiesForForecasting.reduce((s, v) => s + v, 0) / quantitiesForForecasting.length;
            const stdDevHistDemand = Math.sqrt(quantitiesForForecasting.reduce((s, v) => s + Math.pow(v - meanHistDemand, 2), 0) / (quantitiesForForecasting.length -1));
            const zScore = Z_SCORE_LOOKUP[itemParams.serviceLevelPercentage] || Z_SCORE_LOOKUP[DEFAULT_SERVICE_LEVEL_PERCENTAGE];
            const leadTimeInMonths = itemParams.leadTimeDays / 30.44;
            
            if (!isNaN(stdDevHistDemand) && zScore !== undefined && leadTimeInMonths >= 0) {
                const stdDevDemandDuringLeadTime = stdDevHistDemand * Math.sqrt(leadTimeInMonths);
                safetyStock = Math.round(zScore * stdDevDemandDuringLeadTime);

                const demandDuringLeadTime = (trace.shortfall_dailyRate > 0 ? trace.shortfall_dailyRate : (meanHistDemand / 30.44)) * itemParams.leadTimeDays;
                if (safetyStock !== null && !isNaN(safetyStock)) {
                    reorderPoint = Math.round(demandDuringLeadTime + safetyStock);
                }
            }
        }
        
        allItemForecasts.push({
          itemCode,
          historicalData: outlierAdjustedHistoricalData,
          currentInventory,
          methodForecasts: [], 
          aggregatedFutureForecasts,
          nextPeriodShortfall,
          nextPeriodShortfallDateRangeLabel: periodDetails.shortfallPeriodLabel,
          recommendedPurchase,
          coverageTargetPeriods: NUMBER_OF_FUTURE_PERIODS_FOR_RECOMMENDATION,
          totalHistoricalMainConsumption: totalHistoricalMainConsumption,
          totalHistoricalAjsConsumption: totalHistoricalAjsConsumption,
          ajsConsumptionPercentage,
          finalRecommendedPurchase,
          calculatedDemandForShortfallPeriod,
          calculatedTotalDemandForNFullFutureMonths,
          outliersAdjusted,
          seasonalIndices: statisticalSeasonalIndices, 
          leadTimeDays: itemParams.leadTimeDays,
          serviceLevelPercentage: itemParams.serviceLevelPercentage,
          safetyStock,
          reorderPoint,
          maePerMethod: maePerMethod.length > 0 ? maePerMethod : null,
          forecastingMethodNote,
          winningMethod,
          calculationTrace: trace as CalculationTrace
        });

    } catch (error) {
        console.error(`Error al procesar el pronóstico para el ítem ${itemCode}:`, error);
        allItemForecasts.push({
            itemCode,
            historicalData: [],
            currentInventory: inventories.get(itemCode) || 0,
            methodForecasts: [],
            aggregatedFutureForecasts: [],
            nextPeriodShortfall: null,
            nextPeriodShortfallDateRangeLabel: 'Error',
            recommendedPurchase: null,
            finalRecommendedPurchase: null,
            coverageTargetPeriods: NUMBER_OF_FUTURE_PERIODS_FOR_RECOMMENDATION,
            totalHistoricalMainConsumption: 0,
            totalHistoricalAjsConsumption: 0,
            ajsConsumptionPercentage: null,
            calculatedDemandForShortfallPeriod: null,
            calculatedTotalDemandForNFullFutureMonths: null,
            outliersAdjusted: false,
            seasonalIndices: null,
            leadTimeDays: itemParametersMap.get(itemCode)?.leadTimeDays || DEFAULT_LEAD_TIME_DAYS,
            serviceLevelPercentage: itemParametersMap.get(itemCode)?.serviceLevelPercentage || DEFAULT_SERVICE_LEVEL_PERCENTAGE,
            safetyStock: null,
            reorderPoint: null,
            maePerMethod: null,
            forecastingMethodNote: `Error al procesar: ${(error as Error).message}`,
            winningMethod: null,
        });
    }
  });

  return allItemForecasts;
}


import type { AllItemsMonthlyData, ItemMonthlyData, ItemForecast, MethodForecast, PeriodForecastValue, ItemParameters, MonthlyConsumption, ProcessedRow, CalculationTrace, DirectForecastEligibility, BodegaInventory, DistributionResult } from '@/types';
import { 
    SMA_PERIOD, SES_ALPHA, WMA_PERIOD, NUMBER_OF_FUTURE_PERIODS_FOR_RECOMMENDATION, 
    MONTH_NAMES_ES, Z_SCORE_LOOKUP, DEFAULT_LEAD_TIME_DAYS, DEFAULT_SERVICE_LEVEL_PERCENTAGE,
    BODEGAS_TO_EXCLUDE_FOR_DISTRIBUTION,
    MAIN_CONSUMPTION_DOC_TYPES, ADJUSTMENT_DOC_TYPES,
    DAMPING_FACTOR,
    MINIMUM_SEASONAL_FACTORS,
    ITEM_SPECIFIC_ROUNDING_RULES,
    DEFAULT_ROUNDING_MULTIPLE
} from '@/components/bag-distribution/constants';
import { parseRobustNumber } from '@/lib/parsingUtils';
import { addDays, startOfWeek, format, isSameDay, differenceInDays, startOfDay } from 'date-fns';
import { es } from 'date-fns/locale';

export const parseBodegaInventoryFile = (fileContent: string): BodegaInventory[] => {
  const lines = fileContent.split(/\r?\n/).filter(line => line.trim() !== '');
  
  return lines.map((line, index) => {
    const parts = line.split(',');
    if (parts.length < 3) {
      console.warn(`Línea ${index + 1} omitida: formato incorrecto. Se esperan 3 columnas.`);
      return null;
    }
    
    const bodega = parts[0].trim();
    const itemCodeAsNumber = parseInt(parts[1].trim(), 10);
    if(isNaN(itemCodeAsNumber)) {
        console.warn(`Línea ${index + 1} omitida: código de ítem inválido.`);
        return null;
    }
    const itemCode = itemCodeAsNumber.toString();
    
    const quantity = parseInt(parts[2].trim(), 10);
    
    if (!bodega || !itemCode || isNaN(quantity)) {
      console.warn(`Línea ${index + 1} omitida: datos inválidos. Bodega: ${bodega}, Item: ${itemCode}, Cant: ${quantity}`);
      return null;
    }
    
    return { bodega, itemCode, quantity };
  }).filter((item): item is BodegaInventory => item !== null);
};


// --- Forecasting Helper Functions (copied for independence) ---
const getWMAWeights = (period: number): number[] => {
  if (period <= 0) return [];
  const denominator = (period * (period + 1)) / 2;
  const weights: number[] = [];
  for (let i = 0; i < period; i++) {
    weights.push((i + 1) / denominator);
  }
  return weights; 
};

const calculateMAE = (actuals: number[], historicalFit: (number | null)[]): number | null => {
    let sumAbsError = 0;
    let count = 0;
    for (let i = 0; i < actuals.length; i++) {
        if (historicalFit[i] !== null && actuals[i] !== undefined) {
            sumAbsError += Math.abs(actuals[i] - historicalFit[i]!);
            count++;
        }
    }
    return count > 0 ? sumAbsError / count : null;
};

// Fit functions
const calculateSMA_HistoricalFit = (data: number[], period: number) => {
    const fit: (number | null)[] = Array(data.length).fill(null);
    if (data.length < period) return fit;
    for (let i = period; i < data.length; i++) {
        const sum = data.slice(i - period, i).reduce((acc, val) => acc + val, 0);
        fit[i] = Math.round(sum / period);
    }
    return fit;
};

const calculateSES_HistoricalFit = (data: number[], alpha: number) => {
    const fit: (number | null)[] = Array(data.length).fill(null);
    if (data.length === 0) return fit;
    fit[0] = data[0]; 
    let smoothed = data[0];
    for (let i = 1; i < data.length; i++) {
        fit[i] = Math.round(smoothed); 
        smoothed = alpha * data[i] + (1 - alpha) * smoothed;
    }
    return fit;
};

const calculateWMA_HistoricalFit = (data: number[], period: number) => {
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
};

const calculateLinearRegression_HistoricalFit = (data: number[]) => {
    const n = data.length;
    const fit: (number | null)[] = Array(n).fill(null);
    if (n < 2) return fit;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let i = 0; i < n; i++) { sumX += i; sumY += data[i]; sumXY += i * data[i]; sumX2 += i * i; }
    const denominator = n * sumX2 - sumX * sumX;
    if (denominator === 0) return fit;
    const slope = (n * sumXY - sumX * sumY) / denominator;
    const intercept = (sumY - slope * sumX) / n;
    for (let i = 0; i < n; i++) fit[i] = Math.round(Math.max(0, slope * i + intercept));
    return fit;
};

const calculateSimpleAverage_HistoricalFit = (data: number[]) => {
    const fit: (number | null)[] = Array(data.length).fill(null);
    if (data.length === 0) return fit;
    for(let i=1; i<data.length; i++) { 
        const historicalSlice = data.slice(0, i);
        if(historicalSlice.length > 0) fit[i] = Math.round(historicalSlice.reduce((s,v)=>s+v,0) / historicalSlice.length);
    }
    return fit;
};

// Forecast functions
const calculateSMA_MultiStep = (data: number[], period: number, numForecasts: number) => {
  if (data.length < period) return Array(numForecasts).fill(null);
  let forecast = data.slice(-period).reduce((s, v) => s + v, 0) / period;
  return Array(numForecasts).fill(Math.round(Math.max(0, forecast)));
};
const calculateSES_MultiStep = (data: number[], alpha: number, numForecasts: number) => {
  if (data.length === 0) return [];
  let smoothed = data[0];
  for (let i = 1; i < data.length; i++) smoothed = alpha * data[i] + (1 - alpha) * smoothed;
  return Array(numForecasts).fill(Math.round(Math.max(0, smoothed)));
};
const calculateWMA_MultiStep = (data: number[], period: number, numForecasts: number) => {
  const weights = getWMAWeights(period);
  if (data.length < period) return Array(numForecasts).fill(null);
  let forecast = 0;
  const relevantData = data.slice(-period);
  for (let j = 0; j < period; j++) forecast += relevantData[j] * weights[j];
  return Array(numForecasts).fill(Math.round(Math.max(0, forecast)));
};
const calculateLinearRegression_MultiStep = (data: number[], numForecasts: number, dampingFactor: number) => {
  const n = data.length;
  if (n < 2) return calculateSimpleAverage_MultiStep(data, numForecasts);
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) { sumX += i; sumY += data[i]; sumXY += i * data[i]; sumX2 += i * i; }
  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return calculateSimpleAverage_MultiStep(data, numForecasts);
  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;
  let forecasts = [];
  for (let i = 1; i <= numForecasts; i++) {
    forecasts.push(Math.round(Math.max(0, slope * (n + i - 1) + intercept)));
  }
  return forecasts;
};
const calculateSimpleAverage_MultiStep = (data: number[], numForecasts: number) => {
    if (data.length === 0) return Array(numForecasts).fill(0);
    const avg = data.reduce((s,v)=>s+v,0) / data.length;
    return Array(numForecasts).fill(Math.round(Math.max(0, avg)));
};

function checkDirectForecastEligibility(
    bodegaItemHistory: ProcessedRow[],
    minMonths: number,
    maxCvThreshold: number
): DirectForecastEligibility {
    const eligibility: DirectForecastEligibility = {
        isEligible: false,
        reason: "",
        monthsOfHistory: 0,
        requiredMonths: minMonths,
        coefficientOfVariation: null,
        maxCoefficientOfVariation: maxCvThreshold,
    };

    const monthlyConsumption: { [key: string]: number } = {};
    bodegaItemHistory.forEach(row => {
        const monthKey = format(row.date, 'yyyy-MM');
        monthlyConsumption[monthKey] = (monthlyConsumption[monthKey] || 0) + row.quantity;
    });

    const monthsWithConsumption = Object.values(monthlyConsumption).filter(qty => qty > 0);
    eligibility.monthsOfHistory = monthsWithConsumption.length;

    if (eligibility.monthsOfHistory < minMonths) {
        eligibility.reason = `Datos insuficientes (${eligibility.monthsOfHistory} < ${minMonths} meses)`;
        return eligibility;
    }

    const mean = monthsWithConsumption.reduce((sum, qty) => sum + qty, 0) / eligibility.monthsOfHistory;
    if (mean === 0) {
        eligibility.reason = "El consumo promedio es cero.";
        return eligibility;
    }
    const stdDev = Math.sqrt(monthsWithConsumption.reduce((sum, qty) => sum + Math.pow(qty - mean, 2), 0) / eligibility.monthsOfHistory);
    const cv = stdDev / mean;
    eligibility.coefficientOfVariation = cv;

    if (cv > maxCvThreshold) {
        eligibility.reason = `Consumo muy variable (CV = ${cv.toFixed(2)} > ${maxCvThreshold})`;
        return eligibility;
    }

    eligibility.isEligible = true;
    eligibility.reason = `Elegible para pronóstico directo (CV: ${cv.toFixed(2)})`;
    return eligibility;
}

function getNormalizedLocalAverageMonthly(bodegaItemHistory: ProcessedRow[]): { average: number, series: number[] } {
    if (bodegaItemHistory.length === 0) return { average: 0, series: [] };

    const sortedHistory = [...bodegaItemHistory].sort((a,b) => a.date.getTime() - b.date.getTime());
    const firstDate = sortedHistory[0].date;
    const lastDate = sortedHistory[sortedHistory.length - 1].date;

    const monthlyConsumptionMap = new Map<string, number>();
    sortedHistory.forEach(row => {
        const monthKey = format(row.date, 'yyyy-MM');
        monthlyConsumptionMap.set(monthKey, (monthlyConsumptionMap.get(monthKey) || 0) + row.quantity);
    });

    let totalMonths = 0;
    const series: number[] = [];
    let currentDate = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);

    while (currentDate <= lastDate) {
        const monthKey = format(currentDate, 'yyyy-MM');
        const consumption = monthlyConsumptionMap.get(monthKey) || 0;
        series.push(consumption);
        totalMonths++;
        currentDate.setMonth(currentDate.getMonth() + 1);
    }
    
    const totalConsumption = series.reduce((sum, val) => sum + val, 0);
    return {
        average: totalMonths > 0 ? totalConsumption / totalMonths : 0,
        series: series
    };
}


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

function getMonthOffset(targetDate: Date, baseDate: Date): number {
  const targetYear = targetDate.getFullYear();
  const targetMonth = targetDate.getMonth();
  const baseYear = baseDate.getFullYear();
  const baseMonth = baseDate.getMonth();
  return (targetYear - baseYear) * 12 + (targetMonth - baseMonth);
}


export function calculateDistribution(
  allProcessedRows: ProcessedRow[],
  bodegaInventories: BodegaInventory[],
  itemForecasts: ItemForecast[],
  bodegaCoverageConfig: Record<string, number>,
  minMonthsForDirectForecast: number,
  maxCvForDirectForecast: number
): { results: DistributionResult[]; logs: string[] } {
    const results: DistributionResult[] = [];
    const logs: string[] = [];

    const inventoryMap = new Map<string, number>();
    bodegaInventories.forEach(inv => {
        const key = `${inv.bodega}-${inv.itemCode}`;
        inventoryMap.set(key, inv.quantity);
    });

    const allBodegasInInventory = new Set(bodegaInventories.map(inv => inv.bodega));
    const allItemsInInventory = new Set(bodegaInventories.map(inv => inv.itemCode));

    for (const item of itemForecasts) {
        for (const bodega of allBodegasInInventory) {
            const trace: Partial<CalculationTrace> = {};

            const bodegaItemHistory = allProcessedRows.filter(row => 
                row.itemCode === item.itemCode && 
                row.bodega === bodega
            );

            const totalConsumptionInBodega = bodegaItemHistory.reduce((sum, row) => sum + row.quantity, 0);
            const totalItemConsumption = allProcessedRows.filter(r => r.itemCode === item.itemCode).reduce((s, r) => s + r.quantity, 0);
            const ajsConsumptionInBodega = bodegaItemHistory.filter(r => ADJUSTMENT_DOC_TYPES.includes(r.docType)).reduce((s, r) => s + r.quantity, 0);
            trace.bodegaAjsPercentage = totalConsumptionInBodega > 0 ? (ajsConsumptionInBodega / totalConsumptionInBodega) * 100 : 0;
            
            let dailyRate = 0;
            const eligibility = checkDirectForecastEligibility(bodegaItemHistory, minMonthsForDirectForecast, maxCvForDirectForecast);
            trace.directForecastEligibility = eligibility;

            if (eligibility.isEligible) {
                trace.calculationMethod = 'Pronóstico Directo';
                
                // 1. Convert history to ItemMonthlyData format for seasonality calculation
                const monthlyData: ItemMonthlyData = [];
                const monthlyMap = new Map<string, number>();
                bodegaItemHistory.forEach(row => {
                    const monthKey = format(row.date, 'yyyy-MM');
                    monthlyMap.set(monthKey, (monthlyMap.get(monthKey) || 0) + row.quantity);
                });
                
                Array.from(monthlyMap.entries()).forEach(([key, qty]) => {
                    const [year, month] = key.split('-').map(Number);
                    monthlyData.push({
                        year,
                        month,
                        mainQuantity: qty,
                        ajsQuantity: 0,
                        totalQuantity: qty,
                        date: new Date(year, month - 1, 1)
                    });
                });
                
                // 2. Detect outliers and calculate seasonal indices
                const { adjustedData } = detectAndAdjustOutliers(monthlyData);
                const { indices: seasonalIndices } = calculateSeasonalIndices(adjustedData, 2);
                
                // 3. Deseasonalize series for trend calculation
                const { series: localSeries, average: localAverage } = getNormalizedLocalAverageMonthly(bodegaItemHistory);
                const deseasonalizedSeries = localSeries.map((qty, idx) => {
                    if (!seasonalIndices) return qty;
                    const date = addDays(new Date(bodegaItemHistory[0].date.getFullYear(), bodegaItemHistory[0].date.getMonth() + idx, 1), 0);
                    const monthIdx = date.getMonth();
                    return seasonalIndices[monthIdx] > 0 ? qty / seasonalIndices[monthIdx] : qty;
                });
                
                const maePerMethod: Array<{ methodName: string; mae: number | null }> = [];
                 if (deseasonalizedSeries.length > 0) {
                    const methods = {
                        'Regresión Lineal': calculateLinearRegression_HistoricalFit(deseasonalizedSeries),
                        'Media Simple': calculateSimpleAverage_HistoricalFit(deseasonalizedSeries),
                        'SMA': calculateSMA_HistoricalFit(deseasonalizedSeries, SMA_PERIOD),
                        'SES': calculateSES_HistoricalFit(deseasonalizedSeries, SES_ALPHA),
                        'WMA': calculateWMA_HistoricalFit(deseasonalizedSeries, WMA_PERIOD),
                    };
                    for (const [name, fit] of Object.entries(methods)) {
                        maePerMethod.push({ methodName: name, mae: calculateMAE(deseasonalizedSeries, fit) });
                    }
                }
                
                const localWinningMethod = maePerMethod.filter(m => m.mae !== null).sort((a,b) => a.mae! - b.mae!)[0]?.methodName || 'Media Simple';

                const forecastFunctions: {[key: string]: (d: number[], n: number) => Array<number|null>} = {
                    'Regresión Lineal': (d, n) => calculateLinearRegression_MultiStep(d, n, DAMPING_FACTOR),
                    'Media Simple': (d, n) => calculateSimpleAverage_MultiStep(d, n),
                    'SMA': (d, n) => calculateSMA_MultiStep(d, SMA_PERIOD, n),
                    'SES': (d, n) => calculateSES_MultiStep(d, SES_ALPHA, n),
                    'WMA': (d, n) => calculateWMA_MultiStep(d, WMA_PERIOD, n),
                };
                
                const forecastFn = forecastFunctions[localWinningMethod];
                const forecastValues = forecastFn ? forecastFn(deseasonalizedSeries, 1) : [localAverage];
                const trendForecast = forecastValues.length > 0 ? forecastValues[0] : localAverage;

                // 4. Re-apply seasonal factor for the current month
                const currentMonthIdx = new Date().getMonth();
                const currentMonthNumber = currentMonthIdx + 1;
                const statisticalFactor = seasonalIndices ? seasonalIndices[currentMonthIdx] : 1.0;
                
                // Fallback to minimum factors if defined
                const minimumFactor = MINIMUM_SEASONAL_FACTORS[currentMonthNumber] || 1.0;
                const finalSeasonalFactor = Math.max(statisticalFactor, minimumFactor);

                dailyRate = ((trendForecast || 0) * finalSeasonalFactor) / 30.44;
                
                trace.localWinningMethod = localWinningMethod;
                trace.localMonthlyForecast = trendForecast || 0;
                trace.seasonalIndex = finalSeasonalFactor;

            } else {
                trace.calculationMethod = 'Participación Histórica';
                const bodegaShare = totalItemConsumption > 0 ? totalConsumptionInBodega / totalItemConsumption : 0;
                const baseItemDailyForecast = item.calculationTrace?.shortfall_dailyRate || ((item.calculationTrace?.shortfall_avgMonthlyDemand || 0) / 30.44);
                dailyRate = baseItemDailyForecast * bodegaShare;
                trace.bodegaShare = bodegaShare;
                trace.baseItemDailyForecast = baseItemDailyForecast;
            }
            
            trace.shortfall_dailyRate = dailyRate;
            trace.effectiveBodegaDailyForecast_AjsAdjusted = dailyRate * (1 + ((trace.bodegaAjsPercentage ?? 0) / 100));
            trace.coverageDays = bodegaCoverageConfig[bodega] || 15; // Fallback to 15 if not configured
            trace.targetInventory = Math.ceil(trace.effectiveBodegaDailyForecast_AjsAdjusted * trace.coverageDays);
            
            const currentBodegaInventory = inventoryMap.get(`${bodega}-${item.itemCode}`) || 0;
            trace.currentBodegaInventory = currentBodegaInventory;
            trace.currentInventoryCoverageDays = trace.effectiveBodegaDailyForecast_AjsAdjusted > 0 ? currentBodegaInventory / trace.effectiveBodegaDailyForecast_AjsAdjusted : null;
            
            const needed = trace.targetInventory - currentBodegaInventory;
            const quantityToSend_PreRounding = Math.max(0, needed);
            trace.quantityToSend_PreRounding = quantityToSend_PreRounding;
            
            const roundingMultiple = ITEM_SPECIFIC_ROUNDING_RULES[item.itemCode as keyof typeof ITEM_SPECIFIC_ROUNDING_RULES] || DEFAULT_ROUNDING_MULTIPLE;
            trace.roundingMultiple = roundingMultiple;

            let quantityToSend_Final = 0;
            if (quantityToSend_PreRounding > 0) {
                // Ceil to the nearest multiple
                quantityToSend_Final = Math.ceil(quantityToSend_PreRounding / roundingMultiple) * roundingMultiple;
            }
            trace.quantityToSend_Final = quantityToSend_Final;

            let notes = `${trace.calculationMethod || 'N/A'}`;
            if (trace.calculationMethod === 'Pronóstico Directo' && eligibility.coefficientOfVariation !== null) {
              notes += ` (CV: ${eligibility.coefficientOfVariation.toFixed(2)})`;
            }

            results.push({
                bodega,
                itemCode: item.itemCode,
                currentBodegaInventory,
                forecastedDemandForCoverage: trace.targetInventory,
                targetInventoryForCoverage: trace.targetInventory,
                currentInventoryCoverageDays: trace.currentInventoryCoverageDays,
                quantityToSend: quantityToSend_Final,
                notes: notes,
                calculationTrace: trace
            });
        }
    }

    results.sort((a, b) => {
        // First sort by bodega
        if (a.bodega < b.bodega) return -1;
        if (a.bodega > b.bodega) return 1;
        // Then sort by itemCode
        if (a.itemCode < b.itemCode) return -1;
        if (a.itemCode > b.itemCode) return 1;
        return 0;
    });

    return { results, logs };
}






import type { ProcessedRow, BodegaInventory, ItemForecast, DistributionResult, CalculationTrace, DirectForecastEligibility, ItemMonthlyData, MonthlyConsumption } from '@/types';
import { 
    BODEGAS_TO_EXCLUDE_FOR_DISTRIBUTION, 
    DISTRIBUTION_COVERAGE_DAYS, 
    SPECIAL_COVERAGE_BODEGAS,
    ITEM_SPECIFIC_ROUNDING_RULES,
    DEFAULT_ROUNDING_MULTIPLE,
    ADJUSTMENT_DOC_TYPES,
    MAIN_CONSUMPTION_DOC_TYPES,
    MIN_MONTHS_FOR_DIRECT_FORECAST,
    MAX_CV_FOR_DIRECT_FORECAST
} from '@/components/bag-distribution/constants';
import { generateAllForecasts } from './forecastingEngine'; // Necesario para el pronóstico directo
import { parseRobustNumber } from '@/lib/parsingUtils';

/**
 * Parses the raw text content of a bodega inventory file.
 * Expects a CSV format with or without headers: Bodega,ItemCode,Quantity
 * @param fileContent - The raw string content of the file.
 * @returns An array of BodegaInventory objects.
 */
export function parseBodegaInventoryFile(fileContent: string): BodegaInventory[] {
    const lines = fileContent.split(/\r?\n/).filter(line => line.trim() !== '');

    return lines.map((line, index) => {
        const parts = line.split(',');
        if (parts.length < 3) {
            console.warn(`Skipping malformed line ${index + 1} in inventory file: ${line}`);
            return null;
        }

        const bodega = parts[0].trim().toUpperCase();
        // Standardize item code by converting to number to remove leading zeros, then back to string.
        const rawItemCode = parts[1].trim();
        const itemCodeAsNumber = parseInt(rawItemCode, 10);
        if (isNaN(itemCodeAsNumber)) {
            console.warn(`Skipping line ${index + 1} due to invalid item code: ${line}`);
            return null;
        }
        const itemCode = itemCodeAsNumber.toString();
        
        const parsedQuantity = parseRobustNumber(parts[2] || '0');
        
        if (isNaN(parsedQuantity)) {
             console.warn(`Skipping line ${index + 1} due to invalid quantity (header?): ${line}`);
            return null;
        }
        return {
            bodega: bodega,
            itemCode: itemCode,
            quantity: parsedQuantity,
        };
    }).filter((item): item is BodegaInventory => item !== null);
}

// Helper to check if a bodega has enough stable history for a direct forecast
function checkDirectForecastEligibility(
  itemBodegaHistoricalData: ItemMonthlyData,
  requiredMonths: number,
  maxCv: number
): DirectForecastEligibility {
    const monthsOfHistory = itemBodegaHistoricalData.length;
    if (monthsOfHistory < requiredMonths) {
        return { isEligible: false, reason: `Datos insuficientes (${monthsOfHistory}/${requiredMonths} meses)`, monthsOfHistory, requiredMonths, coefficientOfVariation: null, maxCoefficientOfVariation: maxCv };
    }

    const quantities = itemBodegaHistoricalData.map(d => d.totalQuantity);
    const mean = quantities.reduce((a, b) => a + b, 0) / monthsOfHistory;

    if (mean === 0) {
        return { isEligible: false, reason: "Consumo histórico es cero", monthsOfHistory, requiredMonths, coefficientOfVariation: 0, maxCoefficientOfVariation: maxCv };
    }

    const stdDev = Math.sqrt(quantities.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / monthsOfHistory);
    const cv = stdDev / mean;

    if (cv > maxCv) {
        return { isEligible: false, reason: `Volatilidad muy alta (CV: ${cv.toFixed(2)} > ${maxCv})`, monthsOfHistory, requiredMonths, coefficientOfVariation: cv, maxCoefficientOfVariation: maxCv };
    }

    return { isEligible: true, reason: "Elegible para pronóstico directo", monthsOfHistory, requiredMonths, coefficientOfVariation: cv, maxCoefficientOfVariation: maxCv };
}


/**
 * Calculates the distribution plan based on historical data, current inventories, and forecasts.
 * Implements a hybrid model: uses direct forecasting for stable bodegas, and historical share for others.
 * @param allProcessedRows - All historical consumption data.
 * @param bodegaInventories - Current inventory levels for each item in each bodega.
 * @param itemForecasts - The general purchase forecasts for each item.
 * @returns An object containing the results and diagnostic logs.
 */
export function calculateDistribution(
  allProcessedRows: ProcessedRow[],
  bodegaInventories: BodegaInventory[],
  itemForecasts: ItemForecast[]
): { results: DistributionResult[], logs: string[] } {
    const results: DistributionResult[] = [];
    const logs: string[] = [`Iniciando cálculo de distribución para ${bodegaInventories.length} registros de inventario.`];
    
    // Pre-calculate total historical consumption per item (for share calculation)
    const totalItemConsumptionMap = new Map<string, number>();
    allProcessedRows.forEach(row => {
        if (!BODEGAS_TO_EXCLUDE_FOR_DISTRIBUTION.includes(row.bodega?.toUpperCase() || '')) {
            totalItemConsumptionMap.set(row.itemCode, (totalItemConsumptionMap.get(row.itemCode) || 0) + row.quantity);
        }
    });
    logs.push(`Se pre-calcularon ${totalItemConsumptionMap.size} consumos totales por ítem.`);

    // Pre-calculate historical consumption per item-bodega pair
    const itemBodegaConsumptionMap = new Map<string, number>();
    allProcessedRows.forEach(row => {
        if (row.bodega && !BODEGAS_TO_EXCLUDE_FOR_DISTRIBUTION.includes(row.bodega.toUpperCase())) {
            const key = `${row.itemCode}|${row.bodega}`;
            itemBodegaConsumptionMap.set(key, (itemBodegaConsumptionMap.get(key) || 0) + row.quantity);
        }
    });

    // Pre-calculate AJS percentage per bodega
    const bodegaAjsStats = new Map<string, { main: number, ajs: number }>();
    allProcessedRows.forEach(row => {
        if (row.bodega) {
            const stats = bodegaAjsStats.get(row.bodega) || { main: 0, ajs: 0 };
            if (ADJUSTMENT_DOC_TYPES.includes(row.docType)) {
                stats.ajs += row.quantity;
            } else {
                stats.main += row.quantity;
            }
            bodegaAjsStats.set(row.bodega, stats);
        }
    });
     logs.push(`Se pre-calcularon estadísticas de AJS para ${bodegaAjsStats.size} bodegas.`);


    // --- Main Loop: Iterate through each inventory entry (each item in each bodega) ---
    bodegaInventories.forEach(inv => {
        logs.push(`---`);
        logs.push(`Procesando Ítem: ${inv.itemCode}, Bodega: ${inv.bodega}, Inventario: ${inv.quantity}`);

        if (BODEGAS_TO_EXCLUDE_FOR_DISTRIBUTION.includes(inv.bodega.toUpperCase())) {
            logs.push(`-> OMITIDO: La bodega ${inv.bodega} está en la lista de exclusión.`);
            return;
        }

        const trace: Partial<CalculationTrace> = { notes: [] };

        // 1. Determine which forecast method to use (Direct vs. Share-based)
        const itemBodegaHistory = allProcessedRows.filter(r => r.itemCode === inv.itemCode && r.bodega === inv.bodega);
        const itemBodegaMonthlyData = aggregateRowsForItem(itemBodegaHistory);
        trace.directForecastEligibility = checkDirectForecastEligibility(itemBodegaMonthlyData, MIN_MONTHS_FOR_DIRECT_FORECAST, MAX_CV_FOR_DIRECT_FORECAST);
        logs.push(`--> Elegibilidad para pronóstico directo: ${trace.directForecastEligibility.reason}`);

        let monthlyForecastForBodega: number;
        let finalNotes: string[] = [];

        if (trace.directForecastEligibility.isEligible) {
            // -- TIER 1: DIRECT FORECAST LOGIC --
            trace.calculationMethod = 'Pronóstico Directo';
            finalNotes.push('Pronóstico Directo');
            const localForecastData = new Map<string, ItemMonthlyData>([[inv.itemCode, itemBodegaMonthlyData]]);
            const localForecastResult = generateAllForecasts(localForecastData, itemBodegaHistory, new Map(), new Map());
            
            const firstPeriodForecast = localForecastResult[0]?.aggregatedFutureForecasts[0];
            monthlyForecastForBodega = firstPeriodForecast?.value ?? 0;
            trace.localWinningMethod = localForecastResult[0]?.winningMethod || 'N/A';
            logs.push(`--> Usando ${trace.calculationMethod}. Modelo ganador local: ${trace.localWinningMethod}. Pronóstico mensual local: ${monthlyForecastForBodega}`);
        } else if (itemBodegaMonthlyData.length > 0) {
            // -- TIER 2: SHORT HISTORY AVERAGE LOGIC --
            trace.calculationMethod = 'Promedio Histórico Corto';
            finalNotes.push('Promedio Hist. Corto');
            const totalConsumption = itemBodegaMonthlyData.reduce((sum, month) => sum + month.totalQuantity, 0);
            const numberOfMonths = itemBodegaMonthlyData.length;
            monthlyForecastForBodega = totalConsumption / numberOfMonths;
            logs.push(`--> Usando ${trace.calculationMethod}. Promedio de ${numberOfMonths} meses: ${monthlyForecastForBodega.toFixed(2)}.`);
        } else {
            // -- TIER 3: SHARE-BASED FALLBACK LOGIC --
            trace.calculationMethod = 'Participación Histórica';
            finalNotes.push('Participación Histórica');
            const globalItemForecast = itemForecasts.find(f => f.itemCode === inv.itemCode);
            if (!globalItemForecast) {
                 logs.push(`-> ERROR: No se encontró pronóstico general para el ítem ${inv.itemCode}. No se puede distribuir.`);
                 return;
            }
            const firstPeriodGlobalForecast = globalItemForecast.aggregatedFutureForecasts[0];
            const monthlyGeneralForecast = firstPeriodGlobalForecast?.value ?? 0;
            logs.push(`--> Usando ${trace.calculationMethod}. Pronóstico general del ítem: ${monthlyGeneralForecast}`);
            trace.baseItemMonthlyForecast = monthlyGeneralForecast;
            
            const totalItemConsumption = totalItemConsumptionMap.get(inv.itemCode) || 0;
            const thisBodegaItemConsumption = itemBodegaConsumptionMap.get(`${inv.itemCode}|${inv.bodega}`) || 0;
            trace.bodegaShare = totalItemConsumption > 0 ? thisBodegaItemConsumption / totalItemConsumption : 0;
            logs.push(`--> Participación de la bodega: ${(trace.bodegaShare * 100).toFixed(2)}% (${thisBodegaItemConsumption} de ${totalItemConsumption}).`);

            monthlyForecastForBodega = monthlyGeneralForecast * trace.bodegaShare;
        }

        trace.localMonthlyForecast = monthlyForecastForBodega;
        const daysInMonth = 30.5; // Average days for consistency
        trace.daysInForecastMonth = daysInMonth;
        const dailyForecastForBodega = monthlyForecastForBodega / daysInMonth;
        trace.baseItemDailyForecast = dailyForecastForBodega; // Represents the base daily demand for the bodega
        logs.push(`--> Demanda diaria base para la bodega: ${dailyForecastForBodega.toFixed(2)}.`);
        
        // 2. Adjust for AJS consumption
        const thisBodegaAjsStats = bodegaAjsStats.get(inv.bodega) || { main: 0, ajs: 0 };
        const totalConsumptionForAjs = thisBodegaAjsStats.main + thisBodegaAjsStats.ajs;
        trace.bodegaAjsPercentage = totalConsumptionForAjs > 0 ? (thisBodegaAjsStats.ajs / totalConsumptionForAjs) * 100 : 0;
        trace.effectiveBodegaDailyForecast_AjsAdjusted = dailyForecastForBodega * (1 + (trace.bodegaAjsPercentage / 100));
        logs.push(`--> Demanda diaria ajustada por AJS (${trace.bodegaAjsPercentage.toFixed(1)}%): ${trace.effectiveBodegaDailyForecast_AjsAdjusted.toFixed(2)}.`);
        
        // 3. Calculate target inventory and quantity to send
        trace.coverageDays = SPECIAL_COVERAGE_BODEGAS[inv.bodega] || DISTRIBUTION_COVERAGE_DAYS;
         if (trace.coverageDays !== DISTRIBUTION_COVERAGE_DAYS) {
            finalNotes.push(`Cobertura especial de ${trace.coverageDays} días.`);
            logs.push(`--> Aplicando cobertura especial: ${trace.coverageDays} días.`);
        }
        
        trace.targetInventory = Math.ceil(trace.effectiveBodegaDailyForecast_AjsAdjusted * trace.coverageDays);
        trace.currentBodegaInventory = inv.quantity;
        logs.push(`--> Inventario objetivo: ${trace.targetInventory} (para cubrir ${trace.coverageDays} días).`);

        trace.quantityToSend_PreRounding = Math.max(0, trace.targetInventory - trace.currentBodegaInventory);
        logs.push(`--> Necesidad (antes de redondeo): ${trace.quantityToSend_PreRounding.toFixed(2)}.`);
        
        trace.roundingMultiple = ITEM_SPECIFIC_ROUNDING_RULES[inv.itemCode] || DEFAULT_ROUNDING_MULTIPLE;
        trace.quantityToSend_Final = (trace.quantityToSend_PreRounding > 0) 
            ? Math.ceil(trace.quantityToSend_PreRounding / trace.roundingMultiple) * trace.roundingMultiple
            : 0;
        logs.push(`--> Cantidad Final a Enviar (redondeado a múltiplo de ${trace.roundingMultiple}): ${trace.quantityToSend_Final}.`);
        
        const finalResult: DistributionResult = {
            bodega: inv.bodega,
            itemCode: inv.itemCode,
            currentBodegaInventory: inv.quantity,
            forecastedDemandForCoverage: trace.targetInventory, // Add this for display
            targetInventoryForCoverage: trace.targetInventory, // Same as demand for now
            quantityToSend: trace.quantityToSend_Final,
            notes: finalNotes.join(' '),
            calculationTrace: trace as CalculationTrace,
        };

        results.push(finalResult);
    });

    logs.push("---");
    logs.push("Cálculo de distribución finalizado.");
    if (results.length === 0 && bodegaInventories.length > 0) {
        logs.push("ADVERTENCIA: No se generó ninguna línea de distribución. Revise los registros anteriores para ver por qué la cantidad a enviar fue cero para todos los ítems.");
    }

    return { results, logs };
}

// Helper to re-aggregate ProcessedRows for a single item into ItemMonthlyData
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

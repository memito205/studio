

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import type { AllItemsMonthlyData, ItemForecast, MonthlyConsumption, MethodForecast, ItemMonthlyData, PeriodForecastValue, ItemParameters } from '@/types';
import { MONTH_NAMES_ES, SMA_PERIOD, SES_ALPHA, WMA_PERIOD, NUMBER_OF_FUTURE_PERIODS_FOR_RECOMMENDATION, DEFAULT_LEAD_TIME_DAYS, DEFAULT_SERVICE_LEVEL_PERCENTAGE, Z_SCORE_LOOKUP } from './constants';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { ChartIcon } from './icons/ChartIcon';
import { InventoryIcon } from './icons/InventoryIcon';
import { CalculatorIcon } from './icons/CalculatorIcon';
import { InfoIcon } from './icons/InfoIcon'; 
import { DownloadIcon } from './icons/DownloadIcon';
import { TechnicalSummaryModal } from './TechnicalSummaryModal'; 

interface ChartDataPoint {
  name: string; // Period label (e.g., "Ene 2023")
  Histórico?: number;
  'Histórico Original'?: number; // Para mostrar si hubo ajuste de outlier
  SMA?: number | null;
  SES?: number | null;
  WMA?: number | null;
  'Regresión Lineal'?: number | null; 
}

interface ItemDashboardProps {
  itemCodes: string[];
  processedData: AllItemsMonthlyData; 
  inventories: Map<string, number>;
  itemParameters: Map<string, ItemParameters>;
  forecasts: ItemForecast[];
  onInventoryChange: (itemCode: string, quantity: number) => void;
  onItemParametersChange: (itemCode: string, paramName: keyof ItemParameters, value: number) => void;
  activeTab: 'data' | 'forecast';
  setActiveTab: (tab: 'data' | 'forecast') => void;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-slate-700 p-2 border border-slate-600 rounded shadow-lg text-sm">
        <p className="label text-sky-300">{`Período: ${label}`}</p>
        {payload.map((entry: any, index: number) => (
          <p key={`item-${index}`} style={{ color: entry.color }}>
            {`${entry.name}: ${entry.value !== undefined && entry.value !== null ? Number(entry.value).toLocaleString() : 'N/D'}`}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

const formatDateRangeForHeader = (period?: PeriodForecastValue): string => {
    if (!period || !period.startDate || !period.endDate) return period?.periodLabel || 'N/D';
    const startDay = String(period.startDate.getDate()).padStart(2, '0');
    const startMonth = String(period.startDate.getMonth() + 1).padStart(2, '0');
    const endDay = String(period.endDate.getDate()).padStart(2, '0');
    const endMonth = String(period.endDate.getMonth() + 1).padStart(2, '0');
    return `${period.periodLabel} (${startDay}/${startMonth} - ${endDay}/${endMonth})`;
};


const ItemDashboard: React.FC<ItemDashboardProps> = ({
  itemCodes,
  processedData, 
  inventories,
  itemParameters,
  forecasts,
  onInventoryChange,
  onItemParametersChange,
  activeTab,
  setActiveTab
}) => {
  const [selectedItemCode, setSelectedItemCode] = useState<string | null>(null);
  const [isSummaryModalOpen, setSummaryModalOpen] = useState(false); 
  const [selectedItemForModal, setSelectedItemForModal] = useState<ItemForecast | null>(null); 

  useEffect(() => {
    if (itemCodes.length > 0 && !selectedItemCode) {
      setSelectedItemCode(itemCodes[0]);
    } else if (itemCodes.length > 0 && selectedItemCode && !itemCodes.includes(selectedItemCode)) {
      setSelectedItemCode(itemCodes[0]); 
    } else if (itemCodes.length === 0) {
      setSelectedItemCode(null);
    }
  }, [itemCodes, selectedItemCode]);

  const selectedItemForecast = useMemo(() => {
    return forecasts.find(f => f.itemCode === selectedItemCode);
  }, [forecasts, selectedItemCode]);

  const selectedItemOriginalHistoricalData = useMemo((): ItemMonthlyData | null => {
     if (!selectedItemCode) return null;
     return processedData.get(selectedItemCode) || null;
  }, [processedData, selectedItemCode]);


  const chartData = useMemo((): ChartDataPoint[] => {
    const data: ChartDataPoint[] = [];
    if (!selectedItemCode || !selectedItemForecast) return data;
    const historicalForChart = selectedItemForecast.historicalData;
    if (historicalForChart) {
      historicalForChart.forEach(h => {
        const point: ChartDataPoint = { name: `${MONTH_NAMES_ES[h.month - 1]} ${h.year}`, Histórico: h.totalQuantity };
        if (h.originalTotalQuantity !== undefined && h.originalTotalQuantity !== h.totalQuantity) {
            point['Histórico Original'] = h.originalTotalQuantity;
        }
        data.push(point);
      });
    }
    if (selectedItemForecast.methodForecasts) {
      const forecastMethods = selectedItemForecast.methodForecasts;
      if (forecastMethods.length > 0 && forecastMethods[0].forecasts.length > 0) {
        for (let i = 0; i < forecastMethods[0].forecasts.length; i++) {
          const periodLabel = forecastMethods[0].forecasts[i].periodLabel;
          let chartPoint: ChartDataPoint | undefined = data.find(d => d.name === periodLabel);
          if (!chartPoint) { chartPoint = { name: periodLabel }; data.push(chartPoint); }
          forecastMethods.forEach(method => {
            if (method.forecasts[i]?.value !== null) { 
              if (method.methodName === 'SMA') chartPoint!.SMA = method.forecasts[i].value;
              if (method.methodName === 'SES') chartPoint!.SES = method.forecasts[i].value;
              if (method.methodName === 'WMA') chartPoint!.WMA = method.forecasts[i].value;
              if (method.methodName === 'Regresión Lineal') chartPoint!['Regresión Lineal'] = method.forecasts[i].value;
            }
          });
        }
      }
    }
    data.sort((a, b) => {
        const parseName = (name: string): Date => {
            const parts = name.split(' ');
            const monthIndex = MONTH_NAMES_ES.indexOf(parts[0]);
            const year = parseInt(parts[1]);
            return new Date(year, monthIndex, 1);
        };
        return parseName(a.name).getTime() - parseName(b.name).getTime();
    });
    return data.filter(d => d.Histórico !== undefined || d['Histórico Original'] !== undefined || d.SMA !== undefined || d.SES !== undefined || d.WMA !== undefined || d['Regresión Lineal'] !== undefined);
  }, [selectedItemCode, selectedItemForecast]);


  const futurePeriodHeaders = useMemo(() => {
    if (forecasts.length > 0 && forecasts[0].aggregatedFutureForecasts.length > 0) {
        return forecasts[0].aggregatedFutureForecasts; 
    }
    const historicalDataForHeaders = selectedItemOriginalHistoricalData;
    const lastHistoricalDate = historicalDataForHeaders && historicalDataForHeaders.length > 0 
                               ? historicalDataForHeaders[historicalDataForHeaders.length - 1].date 
                               : new Date(); 
    let startDate = new Date(lastHistoricalDate);
    startDate.setUTCMonth(startDate.getUTCMonth() + 1);
    const labels: PeriodForecastValue[] = [];
    for (let i = 0; i < NUMBER_OF_FUTURE_PERIODS_FOR_RECOMMENDATION; i++) {
        const periodDate = new Date(startDate);
        periodDate.setUTCMonth(startDate.getUTCMonth() + i);
        labels.push({ periodLabel: `${MONTH_NAMES_ES[periodDate.getUTCMonth()]} ${periodDate.getFullYear().toString().slice(-2)}`, value: null, adjustedValue: null });
    }
    return labels;
  }, [forecasts, selectedItemOriginalHistoricalData]);

  const shortfallPeriodLabelForHeader = useMemo(() => {
    return (forecasts.length > 0 && forecasts[0].nextPeriodShortfallDateRangeLabel) ? `Faltante Próx.Per. ${forecasts[0].nextPeriodShortfallDateRangeLabel}` : 'Faltante Próx.Per.';
  }, [forecasts]);

  const handleOpenSummaryModal = (forecast: ItemForecast) => { setSelectedItemForModal(forecast); setSummaryModalOpen(true); };

  const adjustmentStatusMessage = useMemo(() => {
    if (!selectedItemForecast) return "";
    return selectedItemForecast.forecastingMethodNote || "";
  }, [selectedItemForecast]);
  
  const handleExportCSV = useCallback(() => {
    if (!forecasts || forecasts.length === 0) return;

    const headers = [
        "Código Item", "Inv. Actual", 
        `Demanda Próx.Per. ${forecasts[0]?.nextPeriodShortfallDateRangeLabel || ''}`,
        `Faltante Próx.Per. ${forecasts[0]?.nextPeriodShortfallDateRangeLabel || ''}`,
        ...futurePeriodHeaders.map(p => `Pron. ${formatDateRangeForHeader(p)} (Base)`),
        ...futurePeriodHeaders.map(p => `Pron. ${formatDateRangeForHeader(p)} (Ajustado AJS)`),
        ...futurePeriodHeaders.map(p => `Compra Necesaria ${formatDateRangeForHeader(p)}`),
        "Ajuste AJS (%)", `Compra Sug. (cubre ${NUMBER_OF_FUTURE_PERIODS_FOR_RECOMMENDATION} per.)`,
        "Compra Sug. Final (+AJS)", "Stock Seg.", "Pto. Pedido", "Lead Time (días)", "Nivel Servicio (%)"
    ];

    const rows = forecasts.sort((a,b) => a.itemCode.localeCompare(b.itemCode)).map(fc => [
        fc.itemCode,
        fc.currentInventory.toLocaleString(),
        fc.calculatedDemandForShortfallPeriod !== null ? fc.calculatedDemandForShortfallPeriod.toLocaleString() : 'N/D',
        fc.nextPeriodShortfall !== null ? fc.nextPeriodShortfall.toLocaleString() : 'N/D',
        ...fc.aggregatedFutureForecasts.map(agg => agg.value !== null ? agg.value.toLocaleString() : 'N/D'),
        ...fc.aggregatedFutureForecasts.map(agg => agg.adjustedValue !== null ? agg.adjustedValue.toLocaleString() : 'N/D'),
        ...fc.aggregatedFutureForecasts.map(agg => agg.neededToBuyForPeriod !== null ? agg.neededToBuyForPeriod.toLocaleString() : 'N/D'),
        fc.ajsConsumptionPercentage !== null ? `${fc.ajsConsumptionPercentage.toFixed(1)}%` : 'N/D',
        fc.recommendedPurchase !== null ? fc.recommendedPurchase.toLocaleString() : 'N/D',
        fc.finalRecommendedPurchase !== null ? fc.finalRecommendedPurchase.toLocaleString() : 'N/D',
        fc.safetyStock !== null ? fc.safetyStock.toLocaleString() : 'N/D',
        fc.reorderPoint !== null ? fc.reorderPoint.toLocaleString() : 'N/D',
        fc.leadTimeDays.toLocaleString(),
        `${fc.serviceLevelPercentage}%`
    ]);

    let csvContent = "data:text/csv;charset=utf-8," + headers.join(",") + "\n"
                     + rows.map(e => e.join(",")).join("\n");
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "resumen_pronosticos.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

  }, [forecasts, futurePeriodHeaders, shortfallPeriodLabelForHeader]);


  if (itemCodes.length === 0) {
    return <p className="text-center text-slate-400 py-8">No hay items procesados para mostrar.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex border-b border-slate-700">
        <button onClick={() => setActiveTab('data')} className={`py-3 px-6 font-medium text-sm transition-colors ${activeTab === 'data' ? 'border-b-2 border-sky-500 text-sky-400' : 'text-slate-400 hover:text-sky-300'}`}>
          <InventoryIcon className="inline-block w-5 h-5 mr-2" /> Datos de Inventario y Parámetros
        </button>
        <button onClick={() => setActiveTab('forecast')} className={`py-3 px-6 font-medium text-sm transition-colors ${activeTab === 'forecast' ? 'border-b-2 border-sky-500 text-sky-400' : 'text-slate-400 hover:text-sky-300'} ${forecasts.length === 0 ? 'opacity-50 cursor-not-allowed' : ''}`} disabled={forecasts.length === 0}>
          <CalculatorIcon className="inline-block w-5 h-5 mr-2" /> Pronósticos y Compras
        </button>
      </div>

      {activeTab === 'data' && (
        <div className="overflow-x-auto bg-slate-850 p-4 rounded-lg shadow-md">
          <h3 className="text-xl font-semibold mb-4 text-sky-400">Inventario Actual, Parámetros y Consumo Histórico por Item</h3>
          <table className="w-full min-w-[1000px] text-left text-sm">
            <thead className="bg-slate-700 text-slate-300">
              <tr>
                <th className="p-3">Código Item</th>
                <th className="p-3 text-center">Cons. Principal</th>
                <th className="p-3 text-center">Cons. Ajustes</th>
                <th className="p-3 text-center">Cons. Total Hist.</th>
                <th className="p-3 text-center">Inventario Actual</th>
                <th className="p-3 text-center">Lead Time (días)</th>
                <th className="p-3 text-center">Nivel Servicio (%)</th>
              </tr>
            </thead>
            <tbody>
              {itemCodes.map(itemCode => {
                const itemHistory = processedData.get(itemCode);
                const totalMainConsumption = itemHistory?.reduce((sum, d) => sum + d.mainQuantity, 0) || 0;
                const totalAjsConsumption = itemHistory?.reduce((sum, d) => sum + d.ajsQuantity, 0) || 0;
                const totalConsumption = totalMainConsumption + totalAjsConsumption;
                const params = itemParameters.get(itemCode) || { leadTimeDays: DEFAULT_LEAD_TIME_DAYS, serviceLevelPercentage: DEFAULT_SERVICE_LEVEL_PERCENTAGE };
                return (
                  <tr key={itemCode} className="border-b border-slate-700 hover:bg-slate-800">
                    <td className="p-3 font-medium">{itemCode}</td>
                    <td className="p-3 text-center">{totalMainConsumption.toLocaleString()}</td>
                    <td className="p-3 text-center">{totalAjsConsumption.toLocaleString()}</td>
                    <td className="p-3 text-center font-semibold">{totalConsumption.toLocaleString()}</td>
                    <td className="p-3 text-center">
                      <input type="number" min="0" value={inventories.get(itemCode) || 0} onChange={(e) => onInventoryChange(itemCode, parseInt(e.target.value, 10))} className="w-24 bg-slate-700 border border-slate-600 rounded px-2 py-1 focus:ring-1 focus:ring-sky-500 focus:border-sky-500 outline-none"/>
                    </td>
                    <td className="p-3 text-center">
                      <input type="number" min="0" value={params.leadTimeDays} onChange={(e) => onItemParametersChange(itemCode, 'leadTimeDays', parseInt(e.target.value, 10))} className="w-24 bg-slate-700 border border-slate-600 rounded px-2 py-1 focus:ring-1 focus:ring-sky-500 focus:border-sky-500 outline-none"/>
                    </td>
                    <td className="p-3 text-center">
                       <select 
                         value={params.serviceLevelPercentage} 
                         onChange={(e) => onItemParametersChange(itemCode, 'serviceLevelPercentage', parseInt(e.target.value, 10))} 
                         className="w-28 bg-slate-700 border border-slate-600 rounded px-2 py-1 focus:ring-1 focus:ring-sky-500 focus:border-sky-500 outline-none"
                       >
                         {Object.keys(Z_SCORE_LOOKUP).map(level => (
                           <option key={level} value={level}>{level}%</option>
                         ))}
                           <option value="100">100%</option> {/* Allow 100% if desired, though Z might be infinite */}
                       </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'forecast' && forecasts.length > 0 && (
         <>
         <div className="bg-slate-850 p-4 rounded-lg shadow-md mb-6">
            <h3 className="text-xl font-semibold mb-2 text-sky-400">Detalle de Item y Gráfico de Pronóstico</h3>
            
            <div className="flex justify-between items-center mb-4 flex-wrap">
                <div className="w-full md:w-1/2 mb-4 md:mb-0">
                    <label htmlFor="item-select" className="block text-sm font-medium text-slate-300 mb-1">Seleccionar Item:</label>
                    <select id="item-select" value={selectedItemCode || ''} onChange={(e) => setSelectedItemCode(e.target.value)} className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 focus:ring-1 focus:ring-sky-500 focus:border-sky-500 outline-none">
                    {itemCodes.map(code => <option key={code} value={code}>{code}</option>)}
                    </select>
                </div>
                <button onClick={handleExportCSV} className="bg-teal-600 hover:bg-teal-700 text-white font-semibold py-2 px-4 rounded-lg shadow-md transition duration-150 ease-in-out flex items-center space-x-2 ml-auto">
                    <DownloadIcon className="w-5 h-5" />
                    <span>Exportar CSV</span>
                </button>
            </div>
            {adjustmentStatusMessage && (<p className="text-xs text-sky-300 mb-4 italic">{adjustmentStatusMessage}</p>)}

            {selectedItemCode && selectedItemForecast && chartData.length > 0 && (
                <div className="h-96 w-full mt-6 bg-slate-900 p-4 rounded-lg">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#4A5568" />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#A0AEC0' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#A0AEC0' }} tickFormatter={(value) => typeof value === 'number' ? value.toLocaleString() : value} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ color: '#E2E8F0', fontSize: '12px' }} />
                    {chartData.some(d => d['Histórico Original'] !== undefined) && <Line type="monotone" dataKey="Histórico Original" stroke="#718096" strokeWidth={1} strokeDasharray="5 5" dot={false} activeDot={false} connectNulls={false} />}
                    <Line type="monotone" dataKey="Histórico" stroke="#38BDF8" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls={false} />
                    {chartData.some(d => d.SMA !== undefined && d.SMA !== null) && <Line type="monotone" dataKey="SMA" name={`SMA (${SMA_PERIOD} per.)`} stroke="#34D399" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls={false} />}
                    {chartData.some(d => d.SES !== undefined && d.SES !== null) && <Line type="monotone" dataKey="SES" name={`SES (α=${SES_ALPHA})`} stroke="#F472B6" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls={false} />}
                    {chartData.some(d => d.WMA !== undefined && d.WMA !== null) && <Line type="monotone" dataKey="WMA" name={`WMA (${WMA_PERIOD} per.)`} stroke="#FBBF24" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls={false} />}
                    {chartData.some(d => d['Regresión Lineal'] !== undefined && d['Regresión Lineal'] !== null) && <Line type="monotone" dataKey="Regresión Lineal" name="Regresión Lineal" stroke="#8B5CF6" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls={false} />}
                    </LineChart>
                </ResponsiveContainer>
                </div>
            )}
            {selectedItemCode && (!selectedItemForecast || chartData.length === 0) && (<p className="text-center text-slate-400 py-4">No hay suficientes datos o pronóstico para el item seleccionado.</p>)}
            
            {selectedItemForecast && selectedItemForecast.maePerMethod && (
                <div className="mt-6 p-4 bg-slate-900 rounded-lg">
                    <h4 className="text-md font-semibold text-sky-300 mb-2">Error Absoluto Medio (MAE) de Métodos:</h4>
                    <ul className="text-xs grid grid-cols-2 md:grid-cols-4 gap-2">
                        {selectedItemForecast.maePerMethod.map(m => (
                            <li key={m.methodName} className="text-slate-300">
                                <span className="font-medium">{m.methodName}:</span> {m.mae !== null ? m.mae.toFixed(2) : 'N/D'}
                            </li>
                        ))}
                    </ul>
                    <p className="text-xs text-slate-500 mt-2">MAE calculado sobre datos históricos desestacionalizados (si aplica). Un MAE más bajo indica mejor ajuste del modelo a la tendencia.</p>
                </div>
            )}
         </div>

        <div className="overflow-x-auto bg-slate-850 p-4 rounded-lg shadow-md">
          <h3 className="text-xl font-semibold mb-4 text-sky-400">Resumen de Pronósticos y Cantidad a Comprar</h3>
           <div className="text-xs text-slate-400 mb-2 space-y-1">
                <p>Las columnas "Pron." muestran: <code className="bg-slate-700 px-1 rounded">Valor Base</code> / <code className="bg-slate-700 px-1 rounded">Valor Ajustado con % AJS</code>. Debajo, 'Comprar:' indica la cantidad necesaria para cubrir la demanda ajustada de ese período, considerando el inventario proyectado de períodos anteriores.</p>
                <p>* N/D: No Disponible. El pronóstico se basa en el método con el menor error histórico (MAE) de un conjunto de modelos (SMA, SES, WMA, Regresión Lineal).</p>
                <p>* Compra Sugerida Final (+AJS) considera el porcentaje histórico de consumo 'AJS' para ajustar la recomendación base.</p>
                <p>* Faltante Próx.Per. considera la demanda estimada desde la fecha actual hasta el fin del mes en curso.</p>
           </div>
          <table className="w-full min-w-[2400px] text-left text-sm">
            <thead className="bg-slate-700 text-slate-300">
              <tr>
                <th className="p-2">Código Item</th>
                <th className="p-2 text-center">Inv. Actual</th>
                <th className="p-2 text-center text-cyan-300">Stock Seg.</th>
                <th className="p-2 text-center text-cyan-300">Pto. Pedido</th>
                <th className="p-2 text-center text-orange-300 whitespace-nowrap">{shortfallPeriodLabelForHeader}</th>
                {futurePeriodHeaders.map((periodInfo, idx) => (<th key={`h-${idx}`} className="p-2 text-center whitespace-nowrap">{`Pron. ${formatDateRangeForHeader(periodInfo)}`}</th>))}
                <th className="p-2 text-center text-amber-300">Ajuste AJS (%)</th>
                <th className="p-2 text-center text-sky-300 whitespace-nowrap">Compra Sug. (cubre {NUMBER_OF_FUTURE_PERIODS_FOR_RECOMMENDATION} per.)</th>
                <th className="p-2 text-center text-teal-300 font-semibold whitespace-nowrap">Compra Sug. Final (+AJS)</th>
              </tr>
            </thead>
            <tbody>
              {forecasts.sort((a,b) => a.itemCode.localeCompare(b.itemCode)).map(forecast => {
                return (
                  <tr key={forecast.itemCode} className="border-b border-slate-700 hover:bg-slate-800">
                    <td className="p-2 font-medium">
                        <div className="flex items-center gap-2">
                           <span>{forecast.itemCode}</span>
                           <button onClick={() => handleOpenSummaryModal(forecast)} className="text-sky-400 hover:text-sky-300" aria-label={`Ver resumen técnico para ${forecast.itemCode}`}><InfoIcon className="w-4 h-4" /></button>
                        </div>
                    </td>
                    <td className="p-2 text-center">{forecast.currentInventory.toLocaleString()}</td>
                    <td className="p-2 text-center text-cyan-200">{forecast.safetyStock !== null ? forecast.safetyStock.toLocaleString() : 'N/D'}</td>
                    <td className="p-2 text-center text-cyan-200">{forecast.reorderPoint !== null ? forecast.reorderPoint.toLocaleString() : 'N/D'}</td>
                    <td className={`p-2 text-center`}>
                        <div>
                            <span>Demanda: {forecast.calculatedDemandForShortfallPeriod?.toLocaleString() ?? 'N/D'}</span>
                        </div>
                        <div>
                            <span className={`font-semibold ${forecast.nextPeriodShortfall !== null && forecast.nextPeriodShortfall > 0 ? 'text-orange-400' : 'text-green-400'}`}>
                            Faltante: {forecast.nextPeriodShortfall !== null ? forecast.nextPeriodShortfall.toLocaleString() : 'N/D'}
                            </span>
                        </div>
                    </td>
                    {forecast.aggregatedFutureForecasts.map((aggForecast, idx) => (
                        <td key={`val-${idx}`} className="p-2 text-center">
                            <div>
                                <span>{aggForecast.value !== null ? aggForecast.value.toLocaleString() : 'N/D'}</span>
                                {' / '}
                                <span>{aggForecast.adjustedValue !== null ? aggForecast.adjustedValue.toLocaleString() : 'N/D'}</span>
                            </div>
                            {aggForecast.neededToBuyForPeriod !== null && (
                                <div className={`font-semibold ${aggForecast.neededToBuyForPeriod > 0 ? 'text-orange-400' : 'text-green-400'}`}>
                                Comprar: {aggForecast.neededToBuyForPeriod.toLocaleString()}
                                </div>
                            )}
                        </td>
                    ))}
                    <td className="p-2 text-center text-amber-300">{forecast.ajsConsumptionPercentage !== null ? `${forecast.ajsConsumptionPercentage.toFixed(1)}%` : 'N/D'}</td>
                    <td className={`p-2 text-center font-bold ${forecast.recommendedPurchase !== null && forecast.recommendedPurchase > 0 ? 'text-sky-400' : 'text-slate-400'}`}>{forecast.recommendedPurchase !== null ? forecast.recommendedPurchase.toLocaleString() : 'N/D'}</td>
                    <td className={`p-2 text-center font-bold ${forecast.finalRecommendedPurchase !== null && forecast.finalRecommendedPurchase > 0 ? 'text-teal-300' : 'text-slate-400'}`}>{forecast.finalRecommendedPurchase !== null ? forecast.finalRecommendedPurchase.toLocaleString() : 'N/D'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
      {activeTab === 'forecast' && forecasts.length === 0 && (<p className="text-center text-slate-400 py-8">Genere los pronósticos para ver los resultados.</p>)}
      {selectedItemForModal && (<TechnicalSummaryModal isOpen={isSummaryModalOpen} onClose={() => setSummaryModalOpen(false)} result={selectedItemForModal} />)}
    </div>
  );
};

export default ItemDashboard;

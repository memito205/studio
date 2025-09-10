
import React, { useMemo } from 'react';
import type { ProcessedRow } from '@/types';
import { ADJUSTMENT_DOC_TYPES } from './constants';

interface ComparisonDashboardProps {
  processedRows: ProcessedRow[];
}

const formatNumber = (num: number) => new Intl.NumberFormat('es-ES').format(Math.round(num));

const formatPercentage = (variation: number | null) => {
    if (variation === null || !isFinite(variation)) return { text: 'N/A', color: 'text-slate-400' };
    const color = variation >= 0 ? 'text-green-400' : 'text-red-400';
    const sign = variation >= 0 ? '+' : '';
    return { text: `${sign}${variation.toFixed(1)}%`, color };
};

const ComparisonDashboard: React.FC<ComparisonDashboardProps> = ({ processedRows }) => {
    
    const comparisonData = useMemo(() => {
        if (processedRows.length === 0) return null;

        const latestTimestamp = processedRows.reduce((max, r) => Math.max(max, r.date.getTime()), 0);
        if (latestTimestamp === 0) {
          return { error: "No se encontraron fechas válidas en los datos para realizar la comparación." };
        }
        const latestDate = new Date(latestTimestamp);

        const currentYear = latestDate.getFullYear();
        const previousYear = currentYear - 1;

        const periodEndDateMonth = latestDate.getMonth();
        const periodEndDateDay = latestDate.getDate();

        const currentPeriodRows = processedRows.filter(r => {
            const rowDate = r.date;
            return rowDate.getFullYear() === currentYear && (
                rowDate.getMonth() < periodEndDateMonth ||
                (rowDate.getMonth() === periodEndDateMonth && rowDate.getDate() <= periodEndDateDay)
            );
        });

        const previousPeriodRows = processedRows.filter(r => {
            const rowDate = r.date;
            return rowDate.getFullYear() === previousYear && (
                rowDate.getMonth() < periodEndDateMonth ||
                (rowDate.getMonth() === periodEndDateMonth && rowDate.getDate() <= periodEndDateDay)
            );
        });

        if (previousPeriodRows.length === 0) {
            return { error: `No se encontraron datos para el período del año anterior (hasta ${latestDate.toLocaleDateString('es-ES')}) para poder comparar.` };
        }

        // Overall
        const totalCurrent = currentPeriodRows.reduce((sum, r) => sum + r.quantity, 0);
        const totalPrevious = previousPeriodRows.reduce((sum, r) => sum + r.quantity, 0);
        const overallVariation = totalPrevious > 0 ? ((totalCurrent / totalPrevious) - 1) * 100 : (totalCurrent > 0 ? Infinity : 0);

        // By Item
        const itemMap = new Map<string, { current: number, previous: number }>();
        currentPeriodRows.forEach(r => {
            const entry = itemMap.get(r.itemCode) || { current: 0, previous: 0 };
            entry.current += r.quantity;
            itemMap.set(r.itemCode, entry);
        });
        previousPeriodRows.forEach(r => {
            const entry = itemMap.get(r.itemCode) || { current: 0, previous: 0 };
            entry.previous += r.quantity;
            itemMap.set(r.itemCode, entry);
        });
        const itemBreakdown = Array.from(itemMap.entries()).map(([key, data]) => ({
            key, ...data, variation: data.previous > 0 ? ((data.current / data.previous) - 1) * 100 : (data.current > 0 ? Infinity : 0)
        })).sort((a, b) => b.current - a.current);

        // By Bodega
        const bodegaMap = new Map<string, { current: number, previous: number }>();
        currentPeriodRows.forEach(r => {
            if (!r.bodega) return;
            const entry = bodegaMap.get(r.bodega) || { current: 0, previous: 0 };
            entry.current += r.quantity;
            bodegaMap.set(r.bodega, entry);
        });
        previousPeriodRows.forEach(r => {
            if (!r.bodega) return;
            const entry = bodegaMap.get(r.bodega) || { current: 0, previous: 0 };
            entry.previous += r.quantity;
            bodegaMap.set(r.bodega, entry);
        });
        const bodegaBreakdown = Array.from(bodegaMap.entries()).map(([key, data]) => ({
            key, ...data, variation: data.previous > 0 ? ((data.current / data.previous) - 1) * 100 : (data.current > 0 ? Infinity : 0)
        })).sort((a, b) => b.current - a.current);
        
        // AJS Participation
        const ajsCurrentAbsolute = currentPeriodRows.filter(r => ADJUSTMENT_DOC_TYPES.includes(r.docType)).reduce((sum, r) => sum + r.quantity, 0);
        const ajsPreviousAbsolute = previousPeriodRows.filter(r => ADJUSTMENT_DOC_TYPES.includes(r.docType)).reduce((sum, r) => sum + r.quantity, 0);
        const ajsParticipationCurrent = totalCurrent > 0 ? (ajsCurrentAbsolute / totalCurrent) * 100 : 0;
        const ajsParticipationPrevious = totalPrevious > 0 ? (ajsPreviousAbsolute / totalPrevious) * 100 : 0;

        return {
            periodInfo: {
                current: `01/01/${currentYear} - ${latestDate.toLocaleDateString('es-ES')}`,
                previous: `01/01/${previousYear} - ${new Date(previousYear, periodEndDateMonth, periodEndDateDay).toLocaleDateString('es-ES')}`,
            },
            overall: { current: totalCurrent, previous: totalPrevious, variation: overallVariation },
            itemBreakdown,
            bodegaBreakdown,
            ajs: { 
                currentPercent: ajsParticipationCurrent, 
                previousPercent: ajsParticipationPrevious,
                currentAbsolute: ajsCurrentAbsolute,
                previousAbsolute: ajsPreviousAbsolute,
            },
        };

    }, [processedRows]);

    if (!comparisonData) {
        return <p className="text-center text-slate-400 py-8">No hay datos procesados para mostrar la comparación.</p>;
    }

    if ('error' in comparisonData) {
        return <p className="text-center text-red-400 py-8">{comparisonData.error}</p>;
    }

    const { periodInfo, overall, itemBreakdown, bodegaBreakdown, ajs } = comparisonData;
    const overallVariationFormatted = formatPercentage(overall.variation);

    return (
        <div className="space-y-8">
            <div className="bg-slate-800 shadow-xl rounded-xl p-6">
                <h3 className="text-2xl font-semibold mb-2 text-sky-400">Comparativo Interanual de Consumo</h3>
                <p className="text-sm text-slate-400 mb-6">Comparando el período <span className="font-semibold text-sky-300">{periodInfo.current}</span> vs <span className="font-semibold text-sky-300">{periodInfo.previous}</span></p>
                <p className="text-xs text-slate-500 mb-6 -mt-4">Nota: El consumo total incluye todos los tipos de documento (RMV, RMP, AJS).</p>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-center">
                    <div className="bg-slate-850 p-4 rounded-lg">
                        <p className="text-slate-400 text-sm">Consumo Total ({periodInfo.previous.slice(-4)})</p>
                        <p className="text-3xl font-bold text-slate-200 mt-1">{formatNumber(overall.previous)}</p>
                    </div>
                    <div className="bg-slate-850 p-4 rounded-lg">
                        <p className="text-slate-400 text-sm">Consumo Total ({periodInfo.current.slice(-4)})</p>
                        <p className="text-3xl font-bold text-slate-200 mt-1">{formatNumber(overall.current)}</p>
                    </div>
                    <div className="bg-slate-850 p-4 rounded-lg">
                        <p className="text-slate-400 text-sm">Variación</p>
                        <p className={`text-3xl font-bold mt-1 ${overallVariationFormatted.color}`}>{overallVariationFormatted.text}</p>
                    </div>
                </div>
            </div>

            <div className="grid md:grid-cols-2 gap-8">
                <div className="bg-slate-800 shadow-xl rounded-xl p-6">
                    <h3 className="text-xl font-semibold mb-4 text-sky-400 border-b border-sky-600 pb-2">Desglose por Ítem</h3>
                    <div className="overflow-auto max-h-96">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-slate-700 text-slate-300 sticky top-0">
                                <tr>
                                    <th className="p-2">Ítem</th>
                                    <th className="p-2 text-right">Cons. Anterior</th>
                                    <th className="p-2 text-right">Cons. Actual</th>
                                    <th className="p-2 text-right">Var. %</th>
                                </tr>
                            </thead>
                            <tbody>
                                {itemBreakdown.map(item => {
                                    const variation = formatPercentage(item.variation);
                                    return (
                                    <tr key={item.key} className="border-b border-slate-700 hover:bg-slate-750">
                                        <td className="p-2 font-medium">{item.key}</td>
                                        <td className="p-2 text-right">{formatNumber(item.previous)}</td>
                                        <td className="p-2 text-right">{formatNumber(item.current)}</td>
                                        <td className={`p-2 text-right font-semibold ${variation.color}`}>{variation.text}</td>
                                    </tr>
                                )})}
                            </tbody>
                        </table>
                    </div>
                </div>
                <div className="bg-slate-800 shadow-xl rounded-xl p-6">
                    <h3 className="text-xl font-semibold mb-4 text-sky-400 border-b border-sky-600 pb-2">Desglose por Bodega</h3>
                    <div className="overflow-auto max-h-96">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-slate-700 text-slate-300 sticky top-0">
                                <tr>
                                    <th className="p-2">Bodega</th>
                                    <th className="p-2 text-right">Cons. Anterior</th>
                                    <th className="p-2 text-right">Cons. Actual</th>
                                    <th className="p-2 text-right">Var. %</th>
                                </tr>
                            </thead>
                            <tbody>
                                {bodegaBreakdown.map(bodega => {
                                     const variation = formatPercentage(bodega.variation);
                                     return (
                                     <tr key={bodega.key} className="border-b border-slate-700 hover:bg-slate-750">
                                         <td className="p-2 font-medium">{bodega.key}</td>
                                         <td className="p-2 text-right">{formatNumber(bodega.previous)}</td>
                                         <td className="p-2 text-right">{formatNumber(bodega.current)}</td>
                                         <td className={`p-2 text-right font-semibold ${variation.color}`}>{variation.text}</td>
                                     </tr>
                                 )})}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

             <div className="bg-slate-800 shadow-xl rounded-xl p-6">
                <h3 className="text-xl font-semibold mb-4 text-sky-400 border-b border-sky-600 pb-2">Análisis de Participación de Ajustes (AJS)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-center">
                    <div className="bg-slate-850 p-4 rounded-lg">
                        <p className="text-slate-400 text-sm">Participación AJS ({periodInfo.previous.slice(-4)})</p>
                        <p className="text-3xl font-bold text-amber-300 mt-1">{ajs.previousPercent.toFixed(1)}%</p>
                        <p className="text-slate-400 text-base mt-1">({formatNumber(ajs.previousAbsolute)} uds)</p>
                    </div>
                    <div className="bg-slate-850 p-4 rounded-lg">
                        <p className="text-slate-400 text-sm">Participación AJS ({periodInfo.current.slice(-4)})</p>
                        <p className="text-3xl font-bold text-amber-300 mt-1">{ajs.currentPercent.toFixed(1)}%</p>
                        <p className="text-slate-400 text-base mt-1">({formatNumber(ajs.currentAbsolute)} uds)</p>
                    </div>
                </div>
            </div>

        </div>
    );
};

export default ComparisonDashboard;

    
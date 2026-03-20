

import React from 'react';
import { Modal } from '@/components/bag-distribution/common/Modal';
import type { ItemForecast } from '@/types';

interface DistributionExplanationModalProps {
  isOpen: boolean;
  onClose: () => void;
  result: ItemForecast | null;
}

const DetailRow: React.FC<{ 
    label: string; 
    value?: string | number | null; 
    calculation?: string;
    isHeader?: boolean;
    isSubHeader?: boolean; 
    indent?: boolean;
    className?: string;
    isCalculation?: boolean;
}> = ({ label, value, calculation, isHeader, isSubHeader, indent, className, isCalculation }) => (
  <div className={`flex justify-between items-start py-1.5 ${indent ? 'ml-4' : ''} ${isHeader ? 'border-b border-slate-600 mb-2' : ''} ${isCalculation ? 'pl-4' : ''} ${className || ''}`}>
    <div>
        <span className={`text-sm ${isHeader ? 'font-semibold text-sky-300 text-lg' : isSubHeader ? 'font-medium text-sky-400' : isCalculation ? 'italic text-slate-400' : 'text-slate-300'}`}>{label}</span>
        {calculation && <span className="block text-xs text-slate-400 italic">({calculation})</span>}
    </div>
    {value !== undefined && (
        <span className={`text-sm text-right pl-2 ${isHeader ? 'font-semibold text-sky-300 text-lg' : isSubHeader ? 'font-medium text-sky-400' : 'text-slate-100'}`}>
        {value === null || value === undefined ? 'N/D' : typeof value === 'number' ? value.toLocaleString('es-CO', {maximumFractionDigits: 2}) : value}
        </span>
    )}
  </div>
);

export const TechnicalSummaryModal: React.FC<DistributionExplanationModalProps> = ({ isOpen, onClose, result: forecast }) => {
  if (!isOpen || !forecast || !forecast.calculationTrace) {
    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Detalle no disponible">
             <p className="text-slate-300">No hay un desglose de cálculo disponible para esta entrada.</p>
        </Modal>
    );
  }

  const trace = forecast.calculationTrace;
  const totalTargetDemand = (forecast.calculatedDemandForShortfallPeriod || 0) + (forecast.calculatedTotalDemandForNFullFutureMonths || 0);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Resumen Técnico: ${forecast.itemCode}`}>
      <div className="space-y-2 text-slate-200 text-sm max-h-[70vh] overflow-y-auto pr-2">
        <DetailRow isHeader label="Ítem" value={forecast.itemCode} />

        <DetailRow label="A. Inventario Actual" value={forecast.currentInventory} className="font-medium" />
        <DetailRow label="Lead Time (Días)" value={forecast.leadTimeDays} />
        <DetailRow label="Nivel de Servicio Deseado" value={`${forecast.serviceLevelPercentage}%`} />
        
        <div className="pt-2">
            <DetailRow isSubHeader label="B. Demanda Período de Faltante" value={forecast.calculatedDemandForShortfallPeriod} calculation={forecast.nextPeriodShortfallDateRangeLabel || ''} />
            {trace.shortfall_dailyRate_source && (
                <DetailRow indent label="Fuente del Cálculo Diario" value={trace.shortfall_dailyRate_source} />
            )}
            <DetailRow indent label="Demanda Diaria Pronosticada" value={trace.shortfall_dailyRate?.toFixed(2)} />
            <DetailRow indent label="Días en Período" value={trace.shortfall_daysInPeriod} />
            <DetailRow indent label="Demanda Base del Período" value={trace.shortfall_baseDemand?.toFixed(2)} calculation={`${trace.shortfall_dailyRate?.toFixed(2)} * ${trace.shortfall_daysInPeriod?.toFixed(2)}`}/>
            <DetailRow indent label="Ajuste % AJS" value={`${(forecast.ajsConsumptionPercentage || 0).toFixed(1)}%`} />
            <DetailRow indent label="Cálculo Final (B)" value={forecast.calculatedDemandForShortfallPeriod?.toLocaleString()} calculation={`${trace.shortfall_baseDemand?.toFixed(0)} * (1 + ${(forecast.ajsConsumptionPercentage || 0)/100})`} className="font-semibold" />
        </div>
        
        <DetailRow label="C. Faltante Inmediato (para cubrir B)" value={forecast.nextPeriodShortfall} calculation="Max(0, B - A)" className="font-medium" />

        <div className="pt-2">
            <DetailRow isSubHeader label="D. Demanda Pronosticada Períodos Futuros" value={`(${forecast.coverageTargetPeriods} meses)`} />
            {forecast.aggregatedFutureForecasts.map((periodFc, index) => {
                const tracePeriod = trace.future_periods && trace.future_periods[index];
                return (
                    <div key={index} className="ml-4 pl-4 border-l border-slate-600 mb-2">
                        <DetailRow isSubHeader label={`Mes ${index + 1} (${periodFc.periodLabel})`} value={`${periodFc.value?.toLocaleString()} / ${periodFc.adjustedValue?.toLocaleString()}`} />
                        <DetailRow indent label="Pronóstico de Tendencia" value={tracePeriod?.trendForecast?.toLocaleString()} calculation={trace.winningMethod || ''} />
                        {tracePeriod?.trendForecast_inputData && tracePeriod.trendForecast_inputData.length > 0 && (
                             <DetailRow isCalculation indent label="Cálculo sobre datos históricos:" value={`[${tracePeriod.trendForecast_inputData.map(v => v.toLocaleString()).join(', ')}]`} />
                        )}
                        <DetailRow indent label="Índice Estacional" value={tracePeriod?.seasonalIndex?.toFixed(2) || 'N/A'} />
                        <DetailRow indent label="Valor Base (Tendencia * Estacionalidad)" value={periodFc.value?.toLocaleString()} className="font-semibold" />
                        <DetailRow indent label="Ajuste % AJS" value={`${(forecast.ajsConsumptionPercentage || 0).toFixed(1)}%`} />
                        <DetailRow indent label="Valor Ajustado" value={periodFc.adjustedValue?.toLocaleString()} calculation={`${periodFc.value?.toLocaleString()} * (1 + ${(forecast.ajsConsumptionPercentage || 0) / 100})`} className="font-semibold" />
                    </div>
                )
            })}
            <DetailRow isSubHeader indent label="Suma Demanda Futura Base" value={forecast.calculatedTotalDemandForNFullFutureMonths?.toLocaleString()} className="border-t border-slate-700 pt-1" />
        </div>

        <DetailRow label="E. Demanda Total Objetivo (B + Suma Futura Base)" value={totalTargetDemand.toLocaleString()} className="font-medium text-sky-300" />
        
        <DetailRow label="F. Compra Base Recomendada (E - A)" value={forecast.recommendedPurchase?.toLocaleString()} className="font-semibold text-sky-200" />
        
        <DetailRow 
            label="H. Compra Sugerida Final (Ajustada por AJS)" 
            value={forecast.finalRecommendedPurchase?.toLocaleString()} 
            className="font-bold text-xl text-teal-300 border-t-2 border-teal-500 pt-2 mt-2" 
        />
        
        <div className="pt-3 border-t border-slate-700 mt-3">
            <DetailRow isSubHeader label="I. Métricas de Inventario Avanzadas" value="" />
            <DetailRow indent label="Stock de Seguridad (SS)" value={forecast.safetyStock?.toLocaleString()} />
            <DetailRow indent label="Punto de Pedido (ROP)" value={forecast.reorderPoint?.toLocaleString()} />
        </div>

        {forecast.maePerMethod && forecast.maePerMethod.length > 0 && (
            <div className="pt-3 border-t border-slate-700 mt-3">
                <DetailRow isSubHeader label="J. Selección de Modelo" value="" />
                 {forecast.winningMethod && (
                    <DetailRow indent label="Método Ganador" value={forecast.winningMethod} className="font-bold text-teal-300" />
                )}
                <DetailRow isSubHeader indent label="Error Absoluto Medio (MAE)" value="" className="mt-2 text-sm" />
                {forecast.maePerMethod.map(m => (
                     <DetailRow indent key={m.methodName} label={m.methodName} value={m.mae !== null ? m.mae.toFixed(2) : 'N/D'} className={m.methodName === forecast.winningMethod ? 'text-teal-300' : ''} />
                ))}
            </div>
        )}

         <p className="text-xs text-slate-400 pt-3 border-t border-slate-700 mt-3">
            Nota: El pronóstico base se genera usando el método con el menor error histórico (MAE). Cantidades redondeadas. "Base / Ajustado AJS".
        </p>
        {forecast.forecastingMethodNote && (
            <div className="text-xs text-sky-300 italic mt-2 border-t border-slate-700 pt-2">
                <p className="font-semibold">Notas Adicionales sobre el Cálculo:</p>
                <p>- {forecast.forecastingMethodNote}</p>
            </div>
        )}
      </div>
    </Modal>
  );
};

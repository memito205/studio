

import React from 'react';
import { Modal } from '@/components/bag-distribution/common/Modal';
import type { DistributionResult } from '@/types';

interface DistributionExplanationModalProps {
  isOpen: boolean;
  onClose: () => void;
  result: DistributionResult | null;
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

export const DistributionExplanationModal: React.FC<DistributionExplanationModalProps> = ({ isOpen, onClose, result }) => {
  if (!isOpen || !result || !result.calculationTrace) {
    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Detalle no disponible">
             <p className="text-slate-300">No hay un desglose de cálculo disponible para esta entrada.</p>
        </Modal>
    );
  }

  const trace = result.calculationTrace;

  const renderCalculationMethodDetails = () => {
    switch(trace.calculationMethod) {
      case 'Pronóstico Directo':
        return (
          <>
            <DetailRow indent label="Método de Pronóstico Local" value={trace.localWinningMethod} />
            <DetailRow indent label="Pronóstico Mensual Promedio (Tendencia)" value={trace.localMonthlyForecast?.toFixed(0)} />
            {trace.seasonalIndex !== undefined && trace.seasonalIndex !== 1 && (
                <DetailRow indent label="Índice Estacional Aplicado" value={trace.seasonalIndex.toFixed(2)} className="text-amber-300 font-medium" />
            )}
            <DetailRow 
                indent 
                label="Demanda Diaria Base (Local)" 
                value={trace.shortfall_dailyRate?.toFixed(2)} 
                calculation={trace.seasonalIndex && trace.seasonalIndex !== 1 
                    ? `(${trace.localMonthlyForecast?.toFixed(0)} * ${trace.seasonalIndex.toFixed(2)}) / 30.44`
                    : `${trace.localMonthlyForecast?.toFixed(0)} / 30.44`
                } 
            />

          </>
        );
      case 'Promedio Histórico Corto':
        return (
            <>
                <DetailRow indent label="Consumo Mensual Promedio (Bodega)" value={trace.baseItemMonthlyForecast?.toFixed(0)} />
                <DetailRow indent label="Demanda Diaria Base (Bodega)" value={trace.shortfall_dailyRate?.toFixed(2)} calculation={`${trace.baseItemMonthlyForecast?.toFixed(0)} / 30.44`} />
            </>
        );
      case 'Participación Histórica':
        return (
          <>
            <DetailRow indent label="Demanda Diaria General (Ítem)" value={trace.baseItemDailyForecast?.toFixed(2)} />
            <DetailRow indent label="Participación Histórica (Bodega)" value={`${(trace.bodegaShare || 0 * 100).toFixed(1)}%`} />
            <DetailRow isCalculation indent label="Demanda Diaria Base (Bodega)" value={(trace.baseItemDailyForecast || 0) * (trace.bodegaShare || 0)} calculation={`${trace.baseItemDailyForecast?.toFixed(2)} * ${(trace.bodegaShare || 0).toFixed(2)}`} />
          </>
        );
      default:
        return  <DetailRow indent label="Demanda Diaria Base" value={trace.shortfall_dailyRate?.toFixed(2) ?? '0.00'} />;
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Detalle del Cálculo: ${result.itemCode} para ${result.bodega}`}>
      <div className="space-y-2 text-slate-200 text-sm max-h-[70vh] overflow-y-auto pr-2">
        
        <DetailRow isHeader label="1. Cálculo de Demanda Diaria" className="mt-4" />
        <DetailRow indent isSubHeader label="Método Utilizado:" value={trace.calculationMethod} />
        {trace.directForecastEligibility && (
             <DetailRow indent label="Análisis de Elegibilidad" value={trace.directForecastEligibility.reason} className="text-xs italic text-slate-400" />
        )}
        {renderCalculationMethodDetails()}

        <div className="pt-2 mt-2 border-t border-slate-700">
          <DetailRow isSubHeader label="Ajuste por Consumo AJS" />
          <DetailRow indent label="Ajuste por AJS" value={`${trace.bodegaAjsPercentage?.toFixed(1)}%`} />
          <DetailRow indent label="Demanda Diaria Final Ajustada" value={trace.effectiveBodegaDailyForecast_AjsAdjusted?.toFixed(2)} calculation={`${trace.shortfall_dailyRate?.toFixed(2)} * (1 + ${((trace.bodegaAjsPercentage || 0) / 100).toFixed(2)})`} className="font-semibold" />
        </div>

        <DetailRow isHeader label="2. Inventario Objetivo" value={trace.targetInventory?.toLocaleString('es-CO')} className="mt-4" />
        <DetailRow indent label="Días de Cobertura" value={`${trace.coverageDays} días`} />
        <DetailRow indent label="Demanda Diaria Ajustada" value={trace.effectiveBodegaDailyForecast_AjsAdjusted?.toFixed(2)} />
        <DetailRow isCalculation indent label="Cálculo" value={trace.targetInventory?.toLocaleString('es-CO')} calculation={`${trace.effectiveBodegaDailyForecast_AjsAdjusted?.toFixed(2)} * ${trace.coverageDays} días`} />
        
        <DetailRow isHeader label="3. Cobertura Actual" value={trace.currentInventoryCoverageDays !== null && trace.currentInventoryCoverageDays !== undefined ? `${trace.currentInventoryCoverageDays.toFixed(1)} días` : '999+'} className="mt-4" />
        <DetailRow indent label="Inventario Actual en Bodega" value={trace.currentBodegaInventory?.toLocaleString('es-CO') ?? '0'} />
        <DetailRow indent label="Demanda Diaria Ajustada" value={trace.effectiveBodegaDailyForecast_AjsAdjusted?.toFixed(2)} />
        <DetailRow isCalculation indent label="Cálculo de Cobertura" value={trace.currentInventoryCoverageDays !== null && trace.currentInventoryCoverageDays !== undefined ? `${trace.currentInventoryCoverageDays.toFixed(1)} días` : '999+'} calculation={`${trace.currentBodegaInventory?.toLocaleString('es-CO') ?? '0'} / ${trace.effectiveBodegaDailyForecast_AjsAdjusted?.toFixed(2)}`} />

        <DetailRow isHeader label="4. Cantidad a Enviar" value={(trace.quantityToSend_Final ?? 0).toLocaleString('es-CO')} className="mt-4" />
        <DetailRow indent label="Inventario Objetivo" value={trace.targetInventory?.toLocaleString('es-CO')} />
        <DetailRow indent label="Inventario Actual (Resta)" value={trace.currentBodegaInventory?.toLocaleString('es-CO') ?? '0'} className="border-b border-slate-700" />
        <DetailRow indent label="Necesidad (antes de redondeo)" value={trace.quantityToSend_PreRounding?.toFixed(2)} className="font-semibold"/>
        <DetailRow indent label="Redondeado a múltiplo de" value={trace.roundingMultiple?.toLocaleString('es-CO') ?? 'N/A'} />
        <DetailRow 
            indent 
            label="Cantidad Final a Enviar" 
            value={(trace.quantityToSend_Final ?? 0).toLocaleString('es-CO')}
            className="font-bold text-xl text-teal-300 border-t-2 border-teal-500 pt-2 mt-2" 
        />
      </div>
    </Modal>
  );
};

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
}> = ({ label, value, calculation, isHeader, isSubHeader, indent, className }) => (
  <div className={`flex justify-between items-start py-1.5 ${indent ? 'ml-4' : ''} ${isHeader ? 'border-b border-slate-600 mb-2' : ''} ${className || ''}`}>
    <div>
        <span className={`text-sm ${isHeader ? 'font-semibold text-sky-300 text-lg' : isSubHeader ? 'font-medium text-sky-400' : 'text-slate-300'}`}>{label}</span>
        {calculation && <span className="block text-xs text-slate-400 italic">({calculation})</span>}
    </div>
    {value !== undefined && (
        <span className={`text-sm text-right pl-2 ${isHeader ? 'font-semibold text-sky-300 text-lg' : isSubHeader ? 'font-medium text-sky-400' : 'text-slate-100'}`}>
        {value === null || value === undefined ? 'N/D' : typeof value === 'number' ? value.toLocaleString(undefined, {maximumFractionDigits: 2}) : value}
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
  
  const isDirectMethod = trace.calculationMethod === 'Pronóstico Directo';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Detalle del Cálculo: ${result.itemCode} para ${result.bodega}`}>
      <div className="space-y-2 text-slate-200 text-sm max-h-[70vh] overflow-y-auto pr-2">
        
        <DetailRow isHeader label="1. Pronóstico Base" value={trace.baseItemDailyForecast?.toFixed(2)} calculation="unidades/día" />
        {isDirectMethod ? (
            <>
                <DetailRow indent label="Método Utilizado" value="Pronóstico Directo" />
                <DetailRow indent label="Modelo Local Seleccionado" value={trace.localWinningMethod} />
                <DetailRow indent label="Pronóstico Mensual Local" value={trace.localMonthlyForecast?.toLocaleString(undefined, {maximumFractionDigits: 0})} />
                <DetailRow indent label="Cálculo Diario" value={trace.baseItemDailyForecast?.toFixed(2)} calculation={`${trace.localMonthlyForecast?.toLocaleString(undefined, {maximumFractionDigits: 0})} / 30.5 días`} />
            </>
        ) : (
            <>
                <DetailRow indent label="Método Utilizado" value="Participación Histórica" />
                <DetailRow indent label="Pronóstico Mensual General" value={trace.baseItemMonthlyForecast?.toLocaleString(undefined, {maximumFractionDigits: 0})} />
                <DetailRow indent label="Participación de Bodega" value={`${(trace.bodegaShare! * 100).toFixed(1)}%`} />
                <DetailRow indent label="Pronóstico Mensual para Bodega" value={trace.localMonthlyForecast?.toFixed(2)} calculation={`${trace.baseItemMonthlyForecast?.toLocaleString(undefined, {maximumFractionDigits: 0})} x ${(trace.bodegaShare! * 100).toFixed(1)}%`} />
                <DetailRow indent label="Cálculo Diario" value={trace.baseItemDailyForecast?.toFixed(2)} calculation={`${trace.localMonthlyForecast?.toFixed(2)} / 30.5 días`} />
            </>
        )}

        <DetailRow isHeader label="2. Demanda Ajustada" value={trace.effectiveBodegaDailyForecast_AjsAdjusted.toFixed(2)} calculation="unidades/día" className="mt-4" />
        <DetailRow indent label="Pronóstico Diario Base" value={trace.baseItemDailyForecast?.toFixed(2)} />
        <DetailRow indent label="Ajuste por AJS" value={`${trace.bodegaAjsPercentage.toFixed(1)}%`} />
        <DetailRow indent label="Cálculo" value={trace.effectiveBodegaDailyForecast_AjsAdjusted.toFixed(2)} calculation={`${trace.baseItemDailyForecast?.toFixed(2)} * (1 + ${(trace.bodegaAjsPercentage/100).toFixed(2)})`} />


        <DetailRow isHeader label="3. Inventario Objetivo" value={trace.targetInventory?.toLocaleString()} className="mt-4" />
        <DetailRow indent label="Días de Cobertura" value={`${trace.coverageDays} días`} />
        <DetailRow indent label="Demanda Diaria Ajustada" value={trace.effectiveBodegaDailyForecast_AjsAdjusted.toFixed(2)} />
        <DetailRow indent label="Cálculo" value={trace.targetInventory?.toLocaleString()} calculation={`${trace.effectiveBodegaDailyForecast_AjsAdjusted.toFixed(2)} * ${trace.coverageDays} días`} />


        <DetailRow isHeader label="4. Cantidad a Enviar" value={trace.quantityToSend_Final.toLocaleString()} className="mt-4" />
        <DetailRow indent label="Inventario Objetivo" value={trace.targetInventory?.toLocaleString()} />
        <DetailRow indent label="Inventario Actual (Resta)" value={trace.currentBodegaInventory.toLocaleString()} className="border-b border-slate-700" />
        <DetailRow indent label="Necesidad (antes de redondeo)" value={trace.quantityToSend_PreRounding?.toFixed(2)} className="font-semibold"/>
        <DetailRow indent label="Redondeado a múltiplo de" value={trace.roundingMultiple.toLocaleString()} />
        <DetailRow 
            indent 
            label="Cantidad Final a Enviar" 
            value={trace.quantityToSend_Final.toLocaleString()} 
            className="font-bold text-xl text-teal-300 border-t-2 border-teal-500 pt-2 mt-2"
        />
      </div>
    </Modal>
  );
};

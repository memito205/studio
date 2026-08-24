import React, { useState } from 'react';
import type { SlaAnalysisData } from '../types';
import { ShieldCheckIcon, ChevronDownIcon } from './icons';

interface SlaAnalysisTableProps {
  data: SlaAnalysisData[];
}

const getBarColor = (percentage: number) => {
    if (percentage >= 80) return 'bg-green-500';
    if (percentage >= 50) return 'bg-yellow-400';
    return 'bg-red-500';
};

const SlaAnalysisTable: React.FC<SlaAnalysisTableProps> = ({ data }) => {
  const [expandedRows, setExpandedRows] = useState<string[]>([]);

  const handleToggleRow = (warehouse: string) => {
    setExpandedRows(prev => 
      prev.includes(warehouse) 
        ? prev.filter(w => w !== warehouse) 
        : [...prev, warehouse]
    );
  };
  
  if (!data || data.length === 0) {
    return (
        <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
            <div className="flex items-center mb-4">
                <ShieldCheckIcon className="h-6 w-6 text-green-600 mr-3"/>
                <h2 className="text-xl font-bold text-gray-800">Análisis de Cumplimiento de SLA por Bodega (3 días)</h2>
            </div>
            <div className="text-center text-gray-500 py-8">
                No hay datos de cumplimiento para mostrar con los filtros actuales.
            </div>
        </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
        <div className="flex items-center mb-4">
            <ShieldCheckIcon className="h-6 w-6 text-green-600 mr-3"/>
            <h2 className="text-xl font-bold text-gray-800">Análisis de Cumplimiento de SLA por Bodega (3 días)</h2>
        </div>
        <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                    <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/4">Bod. Entrada</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-2/4">Cumplimiento SLA</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Docs. Entregados (c/fecha fin)</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fuera de plazo (&gt;3 días)</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Detalles</th>
                    </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                    {data.map(item => {
                        const isExpanded = expandedRows.includes(item.warehouse);
                        return (
                            <React.Fragment key={item.warehouse}>
                                <tr className="hover:bg-gray-50">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{item.warehouse}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                                        <div className="flex items-center">
                                            <div className="w-full bg-gray-200 rounded-full h-4 mr-3">
                                                <div className={`${getBarColor(item.compliance)} h-4 rounded-full transition-all duration-500`} style={{ width: `${item.compliance}%` }}></div>
                                            </div>
                                            <span className="font-semibold">{item.compliance.toFixed(1)}%</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 text-center">{item.totalFinalized}</td>
                                    <td className={`px-6 py-4 whitespace-nowrap text-sm font-bold text-center ${item.overdueCount > 0 ? 'text-red-600' : 'text-green-600'}`}>{item.overdueCount}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                                        {item.totalFinalized > 0 && (
                                            <button onClick={() => handleToggleRow(item.warehouse)} className="p-1 rounded-full hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-green-500">
                                                <ChevronDownIcon className={`h-5 w-5 text-gray-600 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                                            </button>
                                        )}
                                    </td>
                                </tr>
                                {isExpanded && item.finalizedRecords.length > 0 && (
                                    <tr>
                                        <td colSpan={5} className="p-0">
                                            <div className="bg-slate-50 p-4">
                                                <h4 className="font-bold text-sm mb-2 text-gray-700">Detalle de Documentos Finalizados y Entregados para {item.warehouse}:</h4>
                                                <div className="max-h-60 overflow-y-auto">
                                                    <table className="min-w-full divide-y divide-gray-200">
                                                        <thead className="bg-gray-100 sticky top-0">
                                                            <tr>
                                                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nro TFT</th>
                                                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fecha Finalizado</th>
                                                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Días Desde Finalización</th>
                                                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Estado</th>
                                                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Evidencia</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="bg-white divide-y divide-gray-200">
                                                            {item.finalizedRecords.map(rec => (
                                                                <tr key={String(rec.docNumber)} className={rec.isOverdue ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-gray-50'}>
                                                                    <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-600">{rec.docNumber}</td>
                                                                    <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-600">{rec.finalizedDate}</td>
                                                                    <td className={`px-4 py-2 whitespace-nowrap text-sm font-semibold ${rec.isOverdue ? 'text-red-600' : 'text-gray-600'}`}>{rec.daysToFinalize}</td>
                                                                    <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-600">
                                                                        {rec.type === 'delivered' ? (
                                                                            <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
                                                                                Entregado
                                                                            </span>
                                                                        ) : (
                                                                            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${rec.isOverdue ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
                                                                                {rec.isOverdue ? 'Fuera de Plazo' : 'A Tiempo'}
                                                                            </span>
                                                                        )}
                                                                    </td>
                                                                    <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-600">
                                                                        {rec.type === 'delivered' ? (
                                                                            <span className="font-semibold text-gray-700">REVISAR WMS</span>
                                                                        ) : rec.imageLink ? (
                                                                            <a href={rec.imageLink} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-semibold">
                                                                                Ver Evidencia
                                                                            </a>
                                                                        ) : (
                                                                            'N/D'
                                                                        )}
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </React.Fragment>
                        )
                    })}
                </tbody>
            </table>
        </div>
    </div>
  );
};

export default SlaAnalysisTable;

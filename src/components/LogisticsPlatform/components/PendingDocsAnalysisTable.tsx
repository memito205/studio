




import React, { useState } from 'react';
import type { ReportData } from '../types';
import { TableIcon, ChevronDownIcon, PdfFileIcon, TruckIcon, CheckCircleIcon, PackageIcon } from './icons';
import { generateWarehousePdf } from '../utils/helpers';

interface PendingDocsAnalysisTableProps {
    reportData: ReportData;
    onGenerateSpecialPdf: () => void;
    hasPendingRows: boolean;
}

const PendingDocsAnalysisTable: React.FC<PendingDocsAnalysisTableProps> = ({ reportData, onGenerateSpecialPdf, hasPendingRows }) => {
  const { pendingDocsAnalysisData, slaAnalysisData, analysisData, brandSummaryByWarehouse } = reportData;
  const [expandedRows, setExpandedRows] = useState<string[]>([]);
  const [expandedSummaries, setExpandedSummaries] = useState<string[]>([]);

  const handleToggleRow = (warehouse: string) => {
    setExpandedRows(prev => 
      prev.includes(warehouse) 
        ? prev.filter(w => w !== warehouse) 
        : [...prev, warehouse]
    );
  };

  const handleToggleSummary = (summaryKey: string) => {
    setExpandedSummaries(prev => 
      prev.includes(summaryKey) 
        ? prev.filter(k => k !== summaryKey) 
        : [...prev, summaryKey]
    );
  };

  const handleGeneratePdf = (warehouseName: string) => {
    const warehouseSlaData = slaAnalysisData.find(
        (data) => data.warehouse === warehouseName
    );
    const warehousePendingData = pendingDocsAnalysisData.find(
        (data) => data.warehouse === warehouseName
    );
    const warehouseSummaryData = analysisData.find(
        (data) => data.name === warehouseName
    );
    const warehouseBrandSummary = brandSummaryByWarehouse.find(
        (data) => data.warehouse === warehouseName
    )?.summary;

    if (!warehouseSlaData && !warehousePendingData && !warehouseSummaryData) {
        alert(`No se encontraron datos para la bodega ${warehouseName}.`);
        return;
    }

    generateWarehousePdf(warehouseName, warehouseSummaryData, warehouseSlaData, warehousePendingData, warehouseBrandSummary);
  };

  const handleGenerateAllPdfs = () => {
    if (!analysisData || analysisData.length === 0) {
        alert("No hay datos de bodegas para generar PDFs.");
        return;
    }
    analysisData.forEach(item => {
        handleGeneratePdf(item.name);
    });
  };
  
  if (!analysisData || analysisData.length === 0) {
    return (
        <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
            <div className="flex items-center mb-4">
                <TableIcon className="h-6 w-6 text-green-600 mr-3"/>
                <h2 className="text-xl font-bold text-gray-800">Análisis y Reportes por Bodega</h2>
            </div>
            <div className="text-center text-gray-500 py-8">
                No se encontraron bodegas para analizar con los filtros actuales.
            </div>
        </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
        <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
            <div className="flex items-center">
                <TableIcon className="h-6 w-6 text-green-600 mr-3"/>
                <h2 className="text-xl font-bold text-gray-800">Análisis y Reportes por Bodega</h2>
            </div>
            <div className="flex items-center gap-2">
                <button
                    onClick={onGenerateSpecialPdf}
                    className="inline-flex items-center px-4 py-2 border border-blue-500 shadow-sm text-sm font-medium rounded-md text-blue-600 bg-white hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                    disabled={!hasPendingRows}
                    aria-label="Exportar PDF de documentos con estado 'En Cargue' o 'Pte Envío'"
                >
                    <PdfFileIcon className="h-5 w-5 mr-2" />
                    PDF Pendientes (Pte Envío / En Cargue)
                </button>
                <button 
                    onClick={handleGenerateAllPdfs}
                    className="inline-flex items-center px-4 py-2 border border-red-500 shadow-sm text-sm font-medium rounded-md text-red-600 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50"
                    disabled={!analysisData || analysisData.length === 0}
                    aria-label="Exportar todos los reportes de bodega a PDF"
                >
                    <PdfFileIcon className="h-5 w-5 mr-2" />
                    Exportar Todos los PDFs
                </button>
            </div>
        </div>
        <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                    <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/4">Bod. Entrada</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/4">% Participación (Pendientes)</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Docs. Pendientes</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cantidad Pendiente</th>
                        <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Acciones</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Detalles</th>
                    </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                    {analysisData.map(item => {
                        const warehouseName = item.name;
                        const pendingData = pendingDocsAnalysisData.find(d => d.warehouse === warehouseName);
                        
                        const isExpanded = expandedRows.includes(warehouseName);
                        
                        const pendingCount = pendingData?.pendingCount ?? 0;
                        const totalPendingQuantity = pendingData?.totalPendingQuantity ?? 0;
                        const participationPercentage = pendingData?.participationPercentage ?? 0;

                        return (
                            <React.Fragment key={warehouseName}>
                                <tr className="hover:bg-gray-50">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{warehouseName}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                                        <div className="flex items-center">
                                            <div className="w-full bg-gray-200 rounded-full h-4 mr-3">
                                                <div className="bg-orange-500 h-4 rounded-full transition-all duration-500" style={{ width: `${participationPercentage}%` }}></div>
                                            </div>
                                            <span className="font-semibold">{participationPercentage.toFixed(1)}%</span>
                                        </div>
                                    </td>
                                    <td className={`px-6 py-4 whitespace-nowrap text-sm font-bold text-center ${pendingCount > 0 ? 'text-orange-600' : 'text-green-600'}`}>{pendingCount}</td>
                                    <td className={`px-6 py-4 whitespace-nowrap text-sm font-bold text-center ${totalPendingQuantity > 0 ? 'text-orange-600' : 'text-green-600'}`}>{totalPendingQuantity.toLocaleString('es-ES')}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-center">
                                        <button 
                                            onClick={() => handleGeneratePdf(warehouseName)}
                                            className="p-2 rounded-full text-red-600 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500"
                                            title="Generar PDF"
                                        >
                                            <PdfFileIcon className="h-5 w-5" />
                                        </button>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                                        {pendingCount > 0 && (
                                            <button onClick={() => handleToggleRow(warehouseName)} className="p-1 rounded-full hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-500">
                                                <ChevronDownIcon className={`h-5 w-5 text-gray-600 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                                            </button>
                                        )}
                                    </td>
                                </tr>
                                {isExpanded && pendingData && pendingData.pendingRecords.length > 0 && (
                                    <tr>
                                        <td colSpan={6} className="p-0">
                                            <div className="bg-slate-50 p-4">
                                                <h4 className="font-bold text-sm mb-2 text-gray-700">Resumen de Pendientes para {warehouseName}:</h4>
                                                <div className="max-h-72 overflow-y-auto">
                                                    <table className="min-w-full divide-y divide-gray-200">
                                                        <thead className="bg-gray-100 sticky top-0">
                                                            <tr>
                                                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Marca</th>
                                                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Grupo</th>
                                                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Docs. Pendientes</th>
                                                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cantidad Pendiente</th>
                                                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Antigüedad Prom. (Días)</th>
                                                                <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Detalles</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="bg-white divide-y divide-gray-200">
                                                            {pendingData.pendingRecords.map((rec) => {
                                                                const summaryKey = `${warehouseName}-${rec.marca}-${rec.grupo}`;
                                                                const isSummaryExpanded = expandedSummaries.includes(summaryKey);
                                                                return (
                                                                    <React.Fragment key={summaryKey}>
                                                                        <tr>
                                                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-600">{rec.marca}</td>
                                                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-600">{rec.grupo}</td>
                                                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-600 text-center">{rec.docCount}</td>
                                                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-600 text-center">{rec.totalQuantity.toLocaleString('es-ES')}</td>
                                                                            <td className={`px-4 py-2 whitespace-nowrap text-sm font-semibold text-center ${rec.avgDaysPending > 7 ? 'text-red-600' : 'text-orange-500'}`}>{rec.avgDaysPending}</td>
                                                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-center">
                                                                                <button onClick={() => handleToggleSummary(summaryKey)} className="p-1 rounded-full hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-500">
                                                                                    <ChevronDownIcon className={`h-5 w-5 text-gray-600 transition-transform duration-200 ${isSummaryExpanded ? 'rotate-180' : ''}`} />
                                                                                </button>
                                                                            </td>
                                                                        </tr>
                                                                        {isSummaryExpanded && rec.detailedDocs.length > 0 && (
                                                                            <tr>
                                                                                <td colSpan={6} className="p-0 bg-slate-100">
                                                                                    <div className="p-3">
                                                                                        <h5 className="font-semibold text-xs mb-2 text-gray-600">Detalle de Documentos Pendientes:</h5>
                                                                                        <div className="max-h-48 overflow-y-auto">
                                                                                            <table className="min-w-full divide-y divide-gray-200">
                                                                                                <thead className="bg-gray-200 sticky top-0">
                                                                                                    <tr>
                                                                                                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fecha</th>
                                                                                                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nro Documento.2</th>
                                                                                                        <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Cantidad</th>
                                                                                                        <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Días Pendientes</th>
                                                                                                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">En Ruta</th>
                                                                                                    </tr>
                                                                                                </thead>
                                                                                                <tbody className="bg-white divide-y divide-gray-200">
                                                                                                    {rec.detailedDocs.map((doc, docIndex) => {
                                                                                                        const isPlaceholder = doc.enRuta === 'PREGUNTAR ALMACEN DE ORIGEN';
                                                                                                        const isWarehouse = doc.enRuta === 'ESTA EN BODEGA PPAL';
                                                                                                        const isInRoute = doc.enRuta === 'ESTA EN RUTA';
                                                                                                        const isDelivered = doc.enRuta === 'FUE ENTREGADA';
                                                                                                        const isTodayRoute = doc.enRuta === 'EN RUTA HOY';
                                                                                                        const isCollectedOnRoute = doc.enRuta === 'RECOLECTADO EN RUTA';
                                                                                                        const isInCharge = doc.enRuta === 'EN CARGUE';
                                                                                                        return (
                                                                                                            <tr key={`${doc.docNumber}-${docIndex}`}>
                                                                                                                <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-600">{doc.docDate}</td>
                                                                                                                <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-600">{doc.docNumber}</td>
                                                                                                                <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-600 text-center">{doc.quantity}</td>
                                                                                                                <td className={`px-3 py-2 whitespace-nowrap text-sm font-semibold text-center ${doc.daysPending > 7 ? 'text-red-600' : 'text-orange-500'}`}>{doc.daysPending}</td>
                                                                                                                <td className={`px-3 py-2 whitespace-nowrap text-sm flex items-center ${
                                                                                                                    isInCharge ? 'text-cyan-600 font-semibold' :
                                                                                                                    isTodayRoute ? 'text-purple-600 font-semibold' :
                                                                                                                    isCollectedOnRoute ? 'text-violet-600 font-semibold' :
                                                                                                                    isPlaceholder ? 'text-gray-500 italic' : 
                                                                                                                    isWarehouse ? 'text-blue-600 font-semibold' : 
                                                                                                                    isInRoute ? 'text-teal-600 font-semibold' : 
                                                                                                                    isDelivered ? 'text-green-600 font-semibold' : 'text-gray-700'
                                                                                                                }`}>
                                                                                                                    {(isInRoute || isTodayRoute || isCollectedOnRoute) && <TruckIcon className="h-4 w-4 mr-1.5 flex-shrink-0"/>}
                                                                                                                    {isDelivered && <CheckCircleIcon className="h-4 w-4 mr-1.5 flex-shrink-0"/>}
                                                                                                                    {isInCharge && <PackageIcon className="h-4 w-4 mr-1.5 flex-shrink-0"/>}
                                                                                                                    {doc.enRuta}
                                                                                                                </td>
                                                                                                            </tr>
                                                                                                        );
                                                                                                    })}
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

export default PendingDocsAnalysisTable;

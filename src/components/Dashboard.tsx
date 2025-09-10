

"use client";

import React from 'react';
import type { ProcessedReportData, ProductivityGoals, BrandProductTypeGoals, PackerReferenceProductivityDetail, PackerProductivity, IncidentLogEntry, Annotations } from '../types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { CheckCircle, Clock, FileDown, Tv, UserCheck, BarChart, Trophy, Package, Settings, Plus, ArrowLeft, Users } from 'lucide-react';
import { StatCard } from './StatCard';
import { ProductivityTable } from './ProductivityTable';
import { HourlyProductivityChart } from './HourlyProductivityChart';
import { BrandSummary } from './BrandSummary';
import { ProductTypeSummary } from './ProductTypeSummary';
import { DeadTimeReport } from './DeadTimeReport';
import { PackerDetailTable } from './PackerDetailTable';
import { BreakDetailReport } from './BreakDetailReport';
import { DeadTimeSummaryReport } from './DeadTimeSummaryReport';
import { MicroPausesReport } from './MicroPausesReport';
import { ReferencePerformanceTable } from './ReferencePerformanceTable';
import { ExecutiveSummary } from './ExecutiveSummary';
import { Podium } from './Podium';
import { HourlyPerformanceHeatmap } from './HourlyPerformanceHeatmap';
import { HourlyBreakdownTable } from './HourlyBreakdownTable'; // Importar la nueva tabla
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';


interface DashboardProps {
  data: ProcessedReportData;
  fileName: string;
  onReset: () => void;
  onReturnToSuite: () => void;
  onGoToConfiguration: () => void;
  onGoToPlantView: () => void;
  onGoToSupervisorView: () => void;
  onRequestAIInsight: (context: any, type: string) => Promise<void>;
  theme: 'light' | 'dark';
  annotations: Annotations;
  onAnnotationChange: (targetId: string, text: string) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ 
  data, 
  fileName, 
  onReset, 
  onReturnToSuite,
  onGoToConfiguration,
  onGoToPlantView,
  onGoToSupervisorView,
  onRequestAIInsight,
  theme,
  annotations,
  onAnnotationChange
}) => {
    
  const reportContentRef = React.useRef<HTMLDivElement>(null);

  const { packerProductivity, hourlyProductivity, brandProductivity, productTypeProductivity, overallCompliance, deadTimeReport, microPausesReport, deadTimeSummary, microPausesSummary, totalInactivitySummary, packerBrandProductivityDetail, packerReferenceProductivityDetail, breakDetailReport, packerHourlyPerformance, executiveSummary, incidentLog, smartAlerts } = data;
  
  const totalPairs = packerProductivity.reduce((sum, packer) => sum + packer.totalQuantity, 0);
  const totalHours = packerProductivity.reduce((sum, packer) => sum + packer.hoursWorked, 0);
  const avgProductivity = totalHours > 0 ? (totalPairs / totalHours) : 0;
  const numberOfPackers = packerProductivity.length;

  const handleGeneratePdf = async () => {
    const input = reportContentRef.current;
    if (!input) {
        console.error("El elemento del reporte no fue encontrado.");
        return;
    }
    
    // Use landscape orientation for more space
    const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4'
    });
    
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();
    const margin = 10;
    const contentWidth = pdfWidth - (margin * 2);
    let currentY = margin;

    const renderElement = async (element: HTMLElement | null, title: string) => {
        if (!element) return;
        
        await new Promise(resolve => setTimeout(resolve, 100));

        const canvas = await html2canvas(element, { 
            scale: 1.2, // Reduced scale for lighter files
            backgroundColor: theme === 'dark' ? '#0f172a' : '#ffffff',
            useCORS: true,
        });
        
        const imgData = canvas.toDataURL('image/jpeg', 0.80);
        const imgHeight = canvas.height * contentWidth / canvas.width;

        if (currentY + imgHeight + 15 > pdfHeight) { 
            pdf.addPage();
            currentY = margin;
        }
        
        pdf.setFontSize(16);
        pdf.text(title, margin, currentY);
        currentY += 8;

        pdf.addImage(imgData, 'JPEG', margin, currentY, contentWidth, imgHeight);
        currentY += imgHeight + 10;
    }
    
    await renderElement(input.querySelector<HTMLElement>('.pdf-section-stats'), "Estadísticas Generales");
    await renderElement(input.querySelector<HTMLElement>('.pdf-section-podium'), "Podio de Campeones");
    await renderElement(input.querySelector<HTMLElement>('.pdf-section-summaries'), "Resumen por Marca y Producto");
    await renderElement(input.querySelector<HTMLElement>('.pdf-section-hourly-chart'), "Productividad por Hora");
    await renderElement(input.querySelector<HTMLElement>('.pdf-section-heatmap'), "Mapa de Calor de Rendimiento");
    await renderElement(input.querySelector<HTMLElement>('.pdf-section-hourly-breakdown'), "Desglose de Productividad por Hora");
    await renderElement(input.querySelector<HTMLElement>('.pdf-section-packer-table'), "Detalle por Operario");
    await renderElement(input.querySelector<HTMLElement>('.pdf-section-break-detail'), "Detalle de Descansos Aplicados");
    
    pdf.save(`reporte_productividad_${fileName.replace('.xlsx', '')}.pdf`);
  };

  const getComplianceColor = (compliance: number): string => {
    if (compliance >= 100) return 'text-green-500';
    if (compliance >= 85) return 'text-amber-500';
    return 'text-red-500';
  };
  
  const chartTitle = React.useMemo(() => {
    return numberOfPackers > 1 ? `Productividad por Hora (${numberOfPackers} operarios)` : numberOfPackers === 1 ? `Productividad por Hora (${packerProductivity[0].packerName})` : `Productividad por Hora`;
  }, [numberOfPackers, packerProductivity]);
  
  return (
    <div className="space-y-8">
        <Card>
            <CardHeader className="flex flex-wrap justify-between items-center gap-4">
                <div>
                    <CardTitle>Mostrando Reporte</CardTitle>
                    <CardDescription>Archivo: <span className="font-semibold text-primary">{fileName}</span></CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Button onClick={handleGeneratePdf} variant="outline"><FileDown /> Generar PDF</Button>
                    <Button onClick={onReturnToSuite} variant="secondary"><ArrowLeft /> Volver a la Suite</Button>
                    <Button onClick={onGoToSupervisorView} className="bg-fuchsia-500 hover:bg-fuchsia-600"><UserCheck /> Modo Supervisor</Button>
                    <Button onClick={onGoToPlantView} className="bg-teal-500 hover:bg-teal-600"><Tv /> Modo Planta TV</Button>
                    <Button onClick={onGoToConfiguration} variant="outline"><Settings /> Ajustar</Button>
                    <Button onClick={onReset}><Plus /> Cargar Otro</Button>
                </div>
            </CardHeader>
        </Card>
        
        <div ref={reportContentRef} className="space-y-8">
            <div className="pdf-section-summary">
                <ExecutiveSummary summary={executiveSummary} isLoading={false} />
            </div>
            
            <div className="pdf-section-stats grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard title="Total Unidades Empacadas" value={totalPairs.toLocaleString()} icon={<Package />} color="text-amber-500" />
                <StatCard title="Horas Totales Registradas" value={totalHours.toFixed(2)} icon={<Clock />} color="text-blue-500" subtitle={`${numberOfPackers} ${numberOfPackers === 1 ? 'Operario' : 'Operarios'}`} />
                <StatCard title="Productividad Promedio" value={`${avgProductivity.toFixed(2)} unid./hr`} icon={<CheckCircle />} color="text-green-500" />
                <StatCard title="Cumplimiento General" value={`${overallCompliance.toFixed(1)}%`} icon={<Trophy />} color={getComplianceColor(overallCompliance)} />
            </div>

            <div className="pdf-section-podium">
                <Podium data={packerProductivity} />
            </div>

            <div className="pdf-section-summaries grid grid-cols-1 lg:grid-cols-2 gap-8">
                <BrandSummary data={brandProductivity} />
                <ProductTypeSummary data={productTypeProductivity} />
            </div>

            <div className="pdf-section-hourly-chart">
                <Card>
                    <CardHeader>
                        <CardTitle>{chartTitle}</CardTitle>
                        <CardDescription>Evolución de la productividad y el cumplimiento a lo largo del día.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <HourlyProductivityChart data={hourlyProductivity} incidentLog={incidentLog || []} theme={theme} />
                    </CardContent>
                </Card>
            </div>
            
            <div className="pdf-section-heatmap">
                <HourlyPerformanceHeatmap data={packerHourlyPerformance} />
            </div>

             <div className="pdf-section-hourly-breakdown">
                 <HourlyBreakdownTable hourlyData={hourlyProductivity} packerPerformance={packerHourlyPerformance} />
             </div>
            
            <div className="pdf-section-packer-table"><ProductivityTable data={packerProductivity} onAnalyze={onRequestAIInsight} annotations={annotations} onAnnotationChange={onAnnotationChange} /></div>
            
            <div className="pdf-section-break-detail">
                 <BreakDetailReport data={breakDetailReport} />
            </div>
            
            {/* The following sections will NOT be included in the PDF */}
            <div className="pdf-exclude">
                <ReferencePerformanceTable data={packerReferenceProductivityDetail} onAnalyze={onRequestAIInsight} />
                <DeadTimeSummaryReport totalData={totalInactivitySummary} deadTimeData={deadTimeSummary} microData={microPausesSummary} />
                <DeadTimeReport detailData={deadTimeReport} />
                <MicroPausesReport detailData={microPausesReport} />
            </div>
        </div>
    </div>
  );
};

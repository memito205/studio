
"use client";

import React from 'react';
import type { ProcessedReportData } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ArrowLeft, CheckCircle, Clock, Package, Trophy } from 'lucide-react';
import { ProductivityTable } from './ProductivityTable';
import { HourlyPerformanceHeatmap } from './HourlyPerformanceHeatmap';
import { StatCard } from './StatCard';
import { useToast } from '@/hooks/use-toast';


interface SupervisorViewProps {
  data: ProcessedReportData;
  onReturnToDashboard: () => void;
}

export const SupervisorView: React.FC<SupervisorViewProps> = ({ data, onReturnToDashboard }) => {
    const { toast } = useToast();

    const { packerProductivity, overallCompliance, annotations } = data;
    const totalPairs = packerProductivity.reduce((sum, packer) => sum + packer.totalQuantity, 0);
    const totalHours = packerProductivity.reduce((sum, packer) => sum + packer.hoursWorked, 0);
    const avgProductivity = totalHours > 0 ? (totalPairs / totalHours) : 0;
    const numberOfPackers = packerProductivity.length;

    const getComplianceColor = (compliance: number): string => {
        if (compliance >= 100) return 'text-green-500';
        if (compliance >= 85) return 'text-amber-500';
        return 'text-red-500';
    };
    
    // Mock handler since AI analysis is not part of this view directly
    const handleRequestAIInsight = () => {
        toast({
            title: "Función no disponible en esta vista",
            description: "Para análisis con IA, por favor regrese al dashboard principal.",
        });
    };

    return (
        <div className="space-y-8 bg-slate-100 dark:bg-slate-900 p-4 md:p-8 rounded-lg">
            <Card>
                <CardHeader className="flex flex-row justify-between items-center">
                    <div>
                        <CardTitle className="text-2xl md:text-3xl">Vista del Supervisor</CardTitle>
                        <CardDescription>Monitorización del rendimiento del equipo en tiempo real.</CardDescription>
                    </div>
                    <Button onClick={onReturnToDashboard} variant="outline">
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Volver al Dashboard
                    </Button>
                </CardHeader>
            </Card>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard title="Unidades Totales" value={totalPairs.toLocaleString()} icon={<Package />} color="text-amber-500" />
                <StatCard title="Operarios Activos" value={String(numberOfPackers)} icon={<Clock />} color="text-blue-500" />
                <StatCard title="Productividad Media" value={`${avgProductivity.toFixed(2)} u/hr`} icon={<CheckCircle />} color="text-green-500" />
                <StatCard title="Cumplimiento General" value={`${overallCompliance.toFixed(1)}%`} icon={<Trophy />} color={getComplianceColor(overallCompliance)} />
            </div>

            <ProductivityTable 
                data={data.packerProductivity} 
                onAnalyze={handleRequestAIInsight}
                annotations={annotations || {}}
                onAnnotationChange={() => {}} // Read-only in this view
            />

            <HourlyPerformanceHeatmap data={data.packerHourlyPerformance} />
        </div>
    );
};

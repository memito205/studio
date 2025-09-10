"use client";

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Sparkles } from 'lucide-react';
import type { ProcessedReportData } from '@/types';

interface ExecutiveSummaryProps {
  summary: ProcessedReportData['executiveSummary'];
  isLoading: boolean;
}

export const ExecutiveSummary: React.FC<ExecutiveSummaryProps> = ({ summary, isLoading }) => {
  return (
    <Card className="border-l-4 border-primary">
        <CardHeader className="flex flex-row items-center gap-3 space-y-0">
            <Sparkles className="w-6 h-6 text-primary" />
            <CardTitle>Resumen Ejecutivo con IA</CardTitle>
        </CardHeader>
        <CardContent>
        {isLoading && (
            <div className="flex items-center gap-3 text-muted-foreground">
                <Loader2 className="animate-spin h-5 w-5 text-primary" />
                <span>Generando análisis...</span>
            </div>
        )}
        {!isLoading && summary && summary.length > 0 && (
            <ul className="space-y-2 list-disc list-inside text-card-foreground/90">
                {summary.map((point, index) => (
                    <li key={index}>{point}</li>
                ))}
            </ul>
        )}
        {!isLoading && (!summary || summary.length === 0) && (
            <p className="text-muted-foreground">No se pudo generar el resumen ejecutivo.</p>
        )}
        </CardContent>
    </Card>
  );
};


"use client";

import React from 'react';
import type { IncidentLogEntry } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Sparkles, Loader2 } from 'lucide-react';

interface IncidentImpactAnalysisProps {
  incidents: IncidentLogEntry[];
  onAnalyze: (incident: IncidentLogEntry) => Promise<string>;
}

interface AnalysisResult {
    id: string;
    text: string;
    isLoading: boolean;
}

export const IncidentImpactAnalysis: React.FC<IncidentImpactAnalysisProps> = ({ incidents, onAnalyze }) => {
  const [analysisResults, setAnalysisResults] = React.useState<Map<string, AnalysisResult>>(new Map());

  const handleAnalyzeClick = async (incident: IncidentLogEntry) => {
    setAnalysisResults(prev => new Map(prev).set(incident.id, { id: incident.id, text: '', isLoading: true }));
    const resultText = await onAnalyze(incident);
    setAnalysisResults(prev => new Map(prev).set(incident.id, { id: incident.id, text: resultText, isLoading: false }));
  };

  if (!incidents || incidents.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Análisis de Impacto de Incidencias</CardTitle>
        <CardDescription>
          Correlacione los eventos registrados con la productividad. Haga clic en analizar para que la IA cuantifique el impacto.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {incidents.map(incident => {
            const result = analysisResults.get(incident.id);
            return (
                <div key={incident.id} className="p-4 bg-muted/50 rounded-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="flex-grow space-y-1">
                        <p className="font-semibold text-foreground">{incident.text}</p>
                        <p className="text-xs text-muted-foreground">{new Date(incident.timestamp).toLocaleString()}</p>
                        {result && (
                            <Alert className="mt-2 bg-background/50">
                                <Sparkles className="h-4 w-4" />
                                <AlertTitle>Análisis de IA</AlertTitle>
                                <AlertDescription>
                                    {result.isLoading ? 'Analizando...' : result.text}
                                </AlertDescription>
                            </Alert>
                        )}
                    </div>
                    <Button 
                        onClick={() => handleAnalyzeClick(incident)}
                        disabled={result?.isLoading}
                        variant="outline"
                        size="sm"
                        className="flex-shrink-0"
                    >
                        {result?.isLoading ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <Sparkles className="mr-2 h-4 w-4" />
                        )}
                        Analizar Impacto
                    </Button>
                </div>
            )
        })}
      </CardContent>
    </Card>
  );
};

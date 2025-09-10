
"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, Sparkles } from 'lucide-react';

interface ScenarioSimulatorProps {
  onSimulate: (scenarioText: string) => Promise<string>;
}

export const ScenarioSimulator: React.FC<ScenarioSimulatorProps> = ({ onSimulate }) => {
  const [scenario, setScenario] = useState('');
  const [result, setResult] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSimulateClick = async () => {
    if (!scenario.trim()) return;
    setIsLoading(true);
    setResult('');
    try {
      const simulationResult = await onSimulate(scenario);
      setResult(simulationResult);
    } catch (error) {
      console.error("Error simulating scenario:", error);
      setResult("No se pudo obtener una recomendación en este momento.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Simulador de Asignación Óptima</CardTitle>
        <CardDescription>
          Describa un escenario de trabajo y la IA recomendará la mejor asignación de operarios.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea
          value={scenario}
          onChange={e => setScenario(e.target.value)}
          placeholder="Ej: Necesito empacar 300 unidades de ADIDAS y 200 de SKECHERS en las próximas 3 horas. ¿Cómo distribuyo a mis operarios disponibles?"
          rows={3}
        />
        <Button
          onClick={handleSimulateClick}
          disabled={isLoading || !scenario.trim()}
          className="w-full bg-accent hover:bg-accent/90 text-accent-foreground"
        >
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              <span>Simulando...</span>
            </>
          ) : (
            <>
              <Sparkles className="mr-2 h-5 w-5" />
              Obtener Recomendación
            </>
          )}
        </Button>
        {result && (
          <Alert>
            <Sparkles className="h-4 w-4" />
            <AlertTitle>Recomendación de la IA</AlertTitle>
            <AlertDescription className="whitespace-pre-wrap">
              {result}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
};

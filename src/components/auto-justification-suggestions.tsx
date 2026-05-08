"use client";

import React from 'react';
import type { DeadTimeEntry, JustificationType } from '@/types';
import { handleGetJustificationSuggestions } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sparkles, Loader2 } from 'lucide-react';

interface AutoJustificationSuggestionsProps {
  incidents: DeadTimeEntry[];
  onAcceptSuggestion: (incidentId: string, type: JustificationType) => void;
  existingJustifications: { [key: string]: any };
}

interface Suggestion {
  incident: DeadTimeEntry;
  type: JustificationType;
}

export const AutoJustificationSuggestions: React.FC<AutoJustificationSuggestionsProps> = ({ incidents, onAcceptSuggestion, existingJustifications }) => {
  const [suggestions, setSuggestions] = React.useState<Suggestion[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);

  const findSuggestions = async () => {
    const incidentsToAnalyze = incidents.filter(
      i => !existingJustifications[i.id] && i.status === 'No Justificado'
    );
    if (incidentsToAnalyze.length === 0) {
      alert("No hay pausas sin justificar para analizar.");
      return;
    }
    
    setIsLoading(true);
    setSuggestions([]);
    
    const result = await handleGetJustificationSuggestions(incidentsToAnalyze);

    if (result.error) {
      alert(`Error al obtener sugerencias: ${result.error}`);
    } else if (result.data) {
      const newSuggestions: Suggestion[] = [];
      const suggestedJustifications = result.data.suggestions;
      
      for (const incidentId in suggestedJustifications) {
        const incident = incidents.find(i => i.id === incidentId);
        const suggestionType = suggestedJustifications[incidentId];
        if (incident && suggestionType) {
          newSuggestions.push({ incident, type: suggestionType as JustificationType });
        }
      }
      setSuggestions(newSuggestions);
    }
    
    setIsLoading(false);
  };

  const handleAccept = (suggestion: Suggestion) => {
    onAcceptSuggestion(suggestion.incident.id, suggestion.type);
    setSuggestions(current => current.filter(s => s.incident.id !== suggestion.incident.id));
  };

  return (
    <Card className="mt-6 bg-muted/50">
      <CardHeader className="flex-row items-center justify-between pb-4">
        <div className="flex items-center gap-3">
          <Sparkles className="w-6 h-6 text-primary" />
          <CardTitle className="text-lg">Sugerencias de Justificación con IA</CardTitle>
        </div>
        <Button onClick={findSuggestions} disabled={isLoading} variant="link" className="text-primary">
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Buscando...
            </>
          ) : 'Buscar Sugerencias'}
        </Button>
      </CardHeader>
      <CardContent>
        {suggestions.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {suggestions.map((suggestion) => (
              <Card key={suggestion.incident.id} className="bg-background">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{suggestion.incident.packerName}</CardTitle>
                  <CardDescription>
                    {suggestion.incident.startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ({suggestion.incident.duration} min)
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">
                    Sugerencia: <span className="font-semibold text-primary">{suggestion.type}</span>
                  </p>
                  <Button onClick={() => handleAccept(suggestion)} className="w-full mt-3" size="sm">
                    Aceptar
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        {suggestions.length === 0 && !isLoading && (
          <p className="text-sm text-center text-muted-foreground py-4">
            Haga clic en "Buscar Sugerencias" para que la IA analice las pausas no justificadas.
          </p>
        )}
         {isLoading && (
            <div className="flex justify-center items-center py-4">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <p className="ml-3 text-muted-foreground">Analizando tiempos de inactividad...</p>
            </div>
        )}
      </CardContent>
    </Card>
  );
};

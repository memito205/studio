"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles } from "lucide-react";

interface WorkdayProjectionProps {
  onAnalyze: () => void;
}

export const WorkdayProjection: React.FC<WorkdayProjectionProps> = ({ onAnalyze }) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Proyección de Jornada con IA</CardTitle>
        <CardDescription>
          Use IA para predecir si se alcanzará la meta del día y obtener recomendaciones.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={onAnalyze} className="w-full sm:w-auto bg-accent hover:bg-accent/90 text-accent-foreground">
          <Sparkles className="mr-2 h-5 w-5" />
          Generar Proyección
        </Button>
      </CardContent>
    </Card>
  );
};

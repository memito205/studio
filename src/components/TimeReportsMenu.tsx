
/** @jsxImportSource react */
import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, BarChartHorizontal, AlarmClockOff } from 'lucide-react';
import { SubModuleCard } from './SubModuleCard';

interface TimeReportsMenuProps {
  onReturn: () => void;
  onNavigateToGeneralPauses: () => void;
  onNavigateToIdleTime: () => void;
}

export const TimeReportsMenu: React.FC<TimeReportsMenuProps> = ({
  onReturn,
  onNavigateToGeneralPauses,
  onNavigateToIdleTime,
}) => {
  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <Card>
        <CardHeader className="flex flex-row justify-between items-center">
          <div>
            <CardTitle>Reportes de Tiempo y Pausas</CardTitle>
            <CardDescription>Seleccione el tipo de reporte que desea consultar.</CardDescription>
          </div>
          <Button onClick={onReturn} variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" /> Volver a Recepción
          </Button>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <SubModuleCard
          iconName="AlarmClockOff"
          title="Reporte General de Pausas"
          description="Consulte todas las pausas (manuales y automáticas) registradas en un día específico para todos los operarios."
          actionText="Acceder"
          onAction={onNavigateToGeneralPauses}
        />
        <SubModuleCard
          iconName="BarChartHorizontal"
          title="Análisis de Tiempos Muertos"
          description="Genere un reporte detallado de los tiempos de inactividad entre escaneos para una operación específica."
          actionText="Acceder"
          onAction={onNavigateToIdleTime}
        />
      </div>
    </div>
  );
};

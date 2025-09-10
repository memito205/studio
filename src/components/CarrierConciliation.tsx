
"use client";

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ClipboardSearch, Clock, Truck, FileCog, BarChartHorizontal } from 'lucide-react';
import { SubModuleCard } from './SubModuleCard';
import Validator99Minutos from './Validator99Minutos';
import ValidatorLogicuartas from './ValidatorLogicuartas';
import { ReceptionDashboard } from './ReceptionDashboard';
import { Card, CardHeader, CardTitle, CardDescription } from './ui/card';

interface LogisticsSubMenuProps {
  onReturnToSuite: () => void;
}

type LogisticsView = 'main' | '99minutos' | 'logicuartas' | 'reception_dashboard';

export const LogisticsSubMenu: React.FC<LogisticsSubMenuProps> = ({ onReturnToSuite }) => {
  const [view, setView] = useState<LogisticsView>('main');

  const handleNavigate = (targetView: LogisticsView) => {
    setView(targetView);
  };

  if (view === '99minutos') {
    return <Validator99Minutos onReturn={() => setView('main')} />;
  }
  
  if (view === 'logicuartas') {
    return <ValidatorLogicuartas onReturn={() => setView('main')} />;
  }

  if (view === 'reception_dashboard') {
    return <ReceptionDashboard onReturn={() => setView('main')} />;
  }

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader className="flex flex-row justify-between items-center">
          <div>
            <CardTitle>Módulo de Logística y Conciliación</CardTitle>
            <CardDescription>Seleccione una herramienta para procesar sus guías o ver analíticas.</CardDescription>
          </div>
          <Button onClick={onReturnToSuite} variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver a la Suite
          </Button>
        </CardHeader>
      </Card>

      <div className="space-y-12">
        <div className="space-y-4">
            <h2 className="text-2xl font-semibold tracking-tight">Analíticas</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                <SubModuleCard
                    iconName="BarChartHorizontal"
                    title="Dashboard de Recepción"
                    description="Visualice métricas clave y el rendimiento general de las operaciones de recepción de mercancía."
                    actionText="Acceder"
                    onAction={() => handleNavigate('reception_dashboard')}
                />
            </div>
        </div>

        <div className="space-y-4">
            <h2 className="text-2xl font-semibold tracking-tight">Conciliación de Transportadoras</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                <SubModuleCard
                    iconName="Clock"
                    title="99 Minutos"
                    description="Valide y concilie guías de despacho para la transportadora 99 Minutos."
                    actionText="Acceder"
                    onAction={() => handleNavigate('99minutos')}
                />
                <SubModuleCard
                    iconName="Truck"
                    title="Logicuartas"
                    description="Valide y concilie guías de despacho para la transportadora Logicuartas."
                    actionText="Acceder"
                    onAction={() => handleNavigate('logicuartas')}
                />
            </div>
        </div>
      </div>
    </div>
  );
};

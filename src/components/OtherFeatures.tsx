

"use client";

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from './ui/card';
import { SubModuleCard } from './SubModuleCard';
import { FinancialCalculator } from './financial-calculator/FinancialCalculator';
import { CreditSimulator } from './CreditSimulator';
import { useRouter } from 'next/navigation';
import { FletesVtex } from './FletesVtex';
import { PropuestaTransportadora } from './PropuestaTransportadora';
import { TulasDistribucion } from './TulasDistribucion';
import { BagCounting } from './BagCounting';


interface OtherFeaturesProps {
  onReturnToSuite: () => void;
}

type OtherFeaturesView = 'main' | 'financial_calculator' | 'credit_simulator' | 'returns_module' | 'fletes_vtex' | 'propuesta_transportadora' | 'tulas_distribucion' | 'bag_counting';

export const OtherFeatures: React.FC<OtherFeaturesProps> = ({ onReturnToSuite }) => {
  const [view, setView] = useState<OtherFeaturesView>('main');
  const router = useRouter();

  if (view === 'financial_calculator') {
    return <FinancialCalculator onReturn={() => setView('main')} />;
  }
  
  if (view === 'credit_simulator') {
    return <CreditSimulator onReturn={() => setView('main')} />;
  }

  if (view === 'fletes_vtex') {
    return <FletesVtex onReturn={() => setView('main')} />;
  }

  if (view === 'propuesta_transportadora') {
    return <PropuestaTransportadora onReturn={() => setView('main')} />;
  }

  if (view === 'tulas_distribucion') {
    return <TulasDistribucion onReturn={() => setView('main')} />;
  }

  if (view === 'bag_counting') {
    return <BagCounting onReturn={() => setView('main')} />;
  }

  // The returns module is now a dedicated page, so we navigate to it.
  if (view === 'returns_module') {
    // We can't render a full page component here directly.
    // The best approach is to navigate to its dedicated route.
    // This effect will run once when the view is set to 'returns_module'.
    React.useEffect(() => {
        router.push('/returns-module');
    }, [router]);
    
    return (
        <div className="flex justify-center items-center h-64">
            <p>Redirigiendo al Módulo de Devoluciones...</p>
        </div>
    );
  }


  return (
    <div className="space-y-8">
      <Card>
        <CardHeader className="flex flex-row justify-between items-center">
          <div>
            <CardTitle>Otras Funcionalidades</CardTitle>
            <CardDescription>Herramientas y utilidades adicionales para la gestión logística.</CardDescription>
          </div>
          <Button onClick={onReturnToSuite} variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver a la Suite
          </Button>
        </CardHeader>
      </Card>

      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          <SubModuleCard
            iconName="Calculator"
            title="Calculadora de Costo Financiero"
            description="Estime el costo financiero asociado a diferentes scenarios de inventario y plazos."
            actionText="Acceder"
            onAction={() => setView('financial_calculator')}
          />
           <SubModuleCard
            iconName="FileBarChart"
            title="Simulador de Créditos"
            description="Simule créditos y visualice tablas de amortización detalladas."
            actionText="Acceder"
            onAction={() => setView('credit_simulator')}
          />
          <SubModuleCard
            iconName="Undo2"
            title="Reporte de Devoluciones"
            description="Analice y procese archivos de devoluciones para generar reportes detallados."
            actionText="Acceder"
            onAction={() => router.push('/returns-module')}
          />
          <SubModuleCard
            iconName="Ship"
            title="Fletes VTEX"
            description="Calcule y gestione los costos de fletes relacionados con la plataforma VTEX."
            actionText="Acceder"
            onAction={() => setView('fletes_vtex')}
          />
          <SubModuleCard
            iconName="Rocket"
            title="Propuesta Transportadora"
            description="Analice y compare costos para encontrar la mejor opción de transportadora."
            actionText="Acceder"
            onAction={() => setView('propuesta_transportadora')}
          />
           <SubModuleCard
            iconName="Archive"
            title="Análisis de Rotación de Tulas"
            description="Analice el movimiento de tulas para optimizar el stock y la distribución."
            actionText="Acceder"
            onAction={() => setView('tulas_distribucion')}
          />
          <SubModuleCard
            iconName="PackageCheck"
            title="Conteo de Bolsas"
            description="Inicie sesiones de validación para contar bolsas por lote de forma rápida."
            actionText="Acceder"
            onAction={() => setView('bag_counting')}
          />
        </div>
      </div>
    </div>
  );
};

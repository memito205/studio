
"use client";

import React from 'react';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from './ui/card';

interface ReturnsModuleProps {
  onReturn: () => void;
}

const ReturnsModule: React.FC<ReturnsModuleProps> = ({ onReturn }) => {
  return (
    <div className="space-y-8">
      <Card>
        <CardHeader className="flex flex-row justify-between items-center">
          <div>
            <CardTitle>Reporte de Devoluciones</CardTitle>
            <CardDescription>
              Analice y procese archivos de devoluciones para generar reportes detallados.
            </CardDescription>
          </div>
          <Button onClick={onReturn} variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver
          </Button>
        </CardHeader>
      </Card>
      {/* El contenido del módulo irá aquí */}
    </div>
  );
};

export default ReturnsModule;

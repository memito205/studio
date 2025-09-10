
"use client";

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

interface MerchandiseLabelingProps {
  onReturnToSuite: () => void;
}

export const MerchandiseLabeling: React.FC<MerchandiseLabelingProps> = ({ onReturnToSuite }) => {
  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <Card>
        <CardHeader className="flex flex-row justify-between items-center">
          <div>
            <CardTitle>Etiquetado de Mercancía</CardTitle>
            <CardDescription>
              Imprima etiquetas para productos individuales o lotes de mercancía.
            </CardDescription>
          </div>
          <Button onClick={onReturnToSuite} variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver a la Suite
          </Button>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Módulo en construcción.</p>
        </CardContent>
      </Card>
    </div>
  );
};



"use client";

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { UserManagement } from './UserManagement';
import { useAuth } from '@/hooks/use-auth-context';
import { ProductivitySettings } from './ProductivitySettings';
import { UserGoals } from './UserGoals';

interface GeneralSettingsProps {
  onReturnToSuite: () => void;
  packingGoal: number;
  onPackingGoalChange: (goal: number) => void;
}

export const GeneralSettings: React.FC<GeneralSettingsProps> = ({ 
    onReturnToSuite,
    packingGoal,
    onPackingGoalChange
}) => {
  const { role } = useAuth();
  
  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <Card>
        <CardHeader className="flex flex-row justify-between items-center">
          <div>
            <CardTitle>Configuraciones Generales</CardTitle>
            <CardDescription>Ajuste los parámetros que afectan a toda la aplicación.</CardDescription>
          </div>
          <Button onClick={onReturnToSuite} variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver a la Suite
          </Button>
        </CardHeader>
      </Card>
      
      <Card>
        <CardHeader>
            <CardTitle>Parámetros de Empaque</CardTitle>
            <CardDescription>Configuraciones relacionadas con el módulo de empaque en vivo.</CardDescription>
        </CardHeader>
        <CardContent>
            <div className="space-y-2 max-w-xs">
              <Label htmlFor="packing-goal">Meta de Productividad (unidades/hora)</Label>
              <Input
                id="packing-goal"
                type="number"
                value={packingGoal}
                onChange={(e) => onPackingGoalChange(Number(e.target.value) || 0)}
                placeholder="Ej: 70"
              />
              <p className="text-xs text-muted-foreground">
                Esta meta se usará para calcular el cumplimiento en la pantalla de empaque en vivo.
              </p>
            </div>
        </CardContent>
      </Card>

      <ProductivitySettings />

      <UserGoals />

      {role === 'admin' && (
        <UserManagement />
      )}

    </div>
  );
};

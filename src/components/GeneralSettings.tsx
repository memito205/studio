
"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { UserManagement } from './UserManagement';
import { useAuth } from '@/hooks/use-auth-context';
import { ProductivitySettings } from './ProductivitySettings';
import { UserGoals } from './UserGoals';
import { ExternalVendorManager } from './ExternalVendorManager';
import { getPackingSettings, updatePackingSettings } from '@/app/actions';
import { DEFAULT_PACKING_PRODUCTIVITY_GOAL } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';

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
  const { toast } = useToast();
  const [draftGoal, setDraftGoal] = useState<number>(packingGoal);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const loadPackingGoal = useCallback(async () => {
    setIsLoading(true);
    const result = await getPackingSettings();
    if (result.success) {
      const goal = result.data?.productivityGoal ?? DEFAULT_PACKING_PRODUCTIVITY_GOAL;
      setDraftGoal(goal);
      onPackingGoalChange(goal);
    } else {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: result.error || 'No se pudo cargar la meta de empaque.',
      });
      setDraftGoal(DEFAULT_PACKING_PRODUCTIVITY_GOAL);
    }
    setIsLoading(false);
  }, [onPackingGoalChange, toast]);

  useEffect(() => {
    void loadPackingGoal();
  }, [loadPackingGoal]);

  const handleSavePackingGoal = async () => {
    const goal = Number(draftGoal);
    if (!Number.isFinite(goal) || goal < 0) {
      toast({
        variant: 'destructive',
        title: 'Valor inválido',
        description: 'La meta debe ser un número mayor o igual a 0.',
      });
      return;
    }
    setIsSaving(true);
    const result = await updatePackingSettings({ productivityGoal: goal });
    setIsSaving(false);
    if (result.success) {
      onPackingGoalChange(goal);
      toast({
        title: 'Guardado',
        description: `Meta de empaque actualizada a ${goal} U/H. Bodega Live usará este valor.`,
      });
    } else {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: result.error || 'No se pudo guardar la meta de empaque.',
      });
    }
  };
  
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
            <CardDescription>
              Meta compartida con empaque en vivo y Bodega Live · Ventas x Mayor (Cumpl. %).
            </CardDescription>
        </CardHeader>
        <CardContent>
            {isLoading ? (
              <div className="space-y-2 max-w-xs">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-32" />
              </div>
            ) : (
              <div className="space-y-3 max-w-xs">
                <Label htmlFor="packing-goal">Meta de Productividad (unidades/hora)</Label>
                <Input
                  id="packing-goal"
                  type="number"
                  min={0}
                  value={draftGoal}
                  onChange={(e) => setDraftGoal(Number(e.target.value) || 0)}
                  placeholder={`Ej: ${DEFAULT_PACKING_PRODUCTIVITY_GOAL}`}
                  disabled={role !== 'admin'}
                />
                <p className="text-xs text-muted-foreground">
                  Se usa para Cumpl. % en PackingScreen y en Bodega Live · Ventas x Mayor.
                </p>
                {role === 'admin' ? (
                  <Button onClick={handleSavePackingGoal} disabled={isSaving}>
                    {isSaving ? 'Guardando...' : 'Guardar Meta de Empaque'}
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">Solo un admin puede modificar esta meta.</p>
                )}
              </div>
            )}
        </CardContent>
      </Card>

      <ProductivitySettings />

      <UserGoals />

      {role === 'admin' && (
        <div className="space-y-8">
            <UserManagement />
            <ExternalVendorManager />
        </div>
      )}

    </div>
  );
};


"use client";

import type { ProductivityGoals, ProductCategory } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sparkles } from 'lucide-react';

interface GoalConfigurationProps {
  goals: ProductivityGoals;
  onGoalsChange: (newGoals: ProductivityGoals) => void;
  onSuggestGoals: () => void;
}

export const GoalConfiguration: React.FC<GoalConfigurationProps> = ({ goals, onGoalsChange, onSuggestGoals }) => {
  const categories: ProductCategory[] = ['CALZADO', 'ROPA', 'ACCESORIOS'];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap justify-between items-center gap-4">
          <div>
            <CardTitle>Metas de Productividad (unidades/hora)</CardTitle>
            <CardDescription className="mt-1">
              Ajuste las metas para cada tipo de producto. Los cálculos de productividad se actualizarán automáticamente.
            </CardDescription>
          </div>
          <Button
              onClick={onSuggestGoals}
              variant="outline"
              size="sm"
              className="bg-accent/50 text-accent-foreground hover:bg-accent/80"
          >
              <Sparkles className="w-5 h-5 mr-2"/>
              Sugerir Metas con IA
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {categories.map((category) => (
            <div key={category} className="space-y-2">
              <Label htmlFor={`goal-${category}`} className="capitalize">
                {category.toLowerCase()}
              </Label>
              <Input
                type="number"
                id={`goal-${category}`}
                value={goals[category] || ''}
                onChange={(e) => onGoalsChange({ ...goals, [category]: Number(e.target.value) || 0 })}
                min="1"
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

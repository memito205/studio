
"use client";

import React, { useState, useMemo } from 'react';
import type { ReferenceGoals, UniqueReference, BrandProductTypeGoals, ProductivityGoals } from '@/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Search, Plus, Trash2, Info } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface ReferenceGoalConfigurationProps {
  uniqueReferences: UniqueReference[];
  referenceGoals: ReferenceGoals;
  onReferenceGoalsChange: (newGoals: ReferenceGoals) => void;
  brandProductTypeGoals: BrandProductTypeGoals;
  baseGoals: ProductivityGoals;
}

export const ReferenceGoalConfiguration: React.FC<ReferenceGoalConfigurationProps> = ({
  uniqueReferences,
  referenceGoals,
  onReferenceGoalsChange,
  brandProductTypeGoals,
  baseGoals,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [manualRef, setManualRef] = useState('');
  const [manualGoal, setManualGoal] = useState<number>(60);

  const filteredReferences = useMemo(() => {
    if (!searchTerm) return uniqueReferences.slice(0, 50); // Limit initial view
    return uniqueReferences.filter(r => 
      r.referencia.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.descripcion.toLowerCase().includes(searchTerm.toLowerCase())
    ).slice(0, 100);
  }, [uniqueReferences, searchTerm]);

  const handleGoalChange = (ref: string, value: string) => {
    const numValue = parseInt(value);
    if (isNaN(numValue)) {
      const newGoals = { ...referenceGoals };
      delete newGoals[ref];
      onReferenceGoalsChange(newGoals);
    } else {
      onReferenceGoalsChange({
        ...referenceGoals,
        [ref]: numValue,
      });
    }
  };

  const handleAddManual = () => {
    if (!manualRef) return;
    onReferenceGoalsChange({
      ...referenceGoals,
      [manualRef.toUpperCase()]: manualGoal,
    });
    setManualRef('');
  };

  const handleRemove = (ref: string) => {
    const newGoals = { ...referenceGoals };
    delete newGoals[ref];
    onReferenceGoalsChange(newGoals);
  };

  const getInheritedGoal = (ref: UniqueReference) => {
    return brandProductTypeGoals[ref.marca]?.[ref.productType] || baseGoals[ref.productType] || 60;
  };

  const overriddenRefs = Object.keys(referenceGoals);

  return (
    <Card className="mt-8">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
            Metas Específicas por Referencia
            <Info className="h-4 w-4 text-muted-foreground" />
        </CardTitle>
        <CardDescription>
          Establezca metas personalizadas para referencias específicas. Estas metas tienen prioridad sobre las metas de marca y tipo de producto.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <Label htmlFor="search-ref">Buscar en el Reporte</Label>
            <div className="relative mt-1">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="search-ref"
                placeholder="Referencia o descripción..."
                className="pl-8"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col md:flex-row gap-2 items-end">
            <div>
              <Label htmlFor="manual-ref">Agregar Referencia Manual</Label>
              <Input
                id="manual-ref"
                placeholder="SKU-123"
                className="mt-1"
                value={manualRef}
                onChange={(e) => setManualRef(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="manual-goal">Meta</Label>
              <Input
                id="manual-goal"
                type="number"
                className="mt-1 w-24"
                value={manualGoal}
                onChange={(e) => setManualGoal(parseInt(e.target.value) || 0)}
              />
            </div>
            <Button onClick={handleAddManual} disabled={!manualRef}>
              <Plus className="h-4 w-4 mr-2" />
              Agregar
            </Button>
          </div>
        </div>

        {overriddenRefs.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Referencias con Meta Personalizada</h4>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Referencia</TableHead>
                    <TableHead>Meta Personalizada</TableHead>
                    <TableHead className="w-[100px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overriddenRefs.map(ref => (
                    <TableRow key={ref}>
                      <TableCell className="font-medium">{ref}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          className="w-24"
                          value={referenceGoals[ref]}
                          onChange={(e) => handleGoalChange(ref, e.target.value)}
                        />
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => handleRemove(ref)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <h4 className="text-sm font-medium">Sugerencias desde el Reporte Actual</h4>
          <div className="rounded-md border max-h-[300px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Referencia</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead>Meta Actual (Heredada)</TableHead>
                  <TableHead className="w-[120px]">Nueva Meta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredReferences.map(ref => {
                  const isOverridden = referenceGoals[ref.referencia] !== undefined;
                  const inheritedGoal = getInheritedGoal(ref);
                  
                  return (
                    <TableRow key={ref.referencia}>
                      <TableCell className="text-xs font-mono">{ref.referencia}</TableCell>
                      <TableCell className="text-xs truncate max-w-[200px]">{ref.descripcion}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {inheritedGoal} ( {ref.marca} - {ref.productType} )
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          placeholder={inheritedGoal.toString()}
                          className={`h-8 w-20 text-xs ${isOverridden ? 'border-primary ring-1 ring-primary' : ''}`}
                          value={referenceGoals[ref.referencia] || ''}
                          onChange={(e) => handleGoalChange(ref.referencia, e.target.value)}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground italic">
            Mostrando {filteredReferences.length} de {uniqueReferences.length} referencias únicas en el reporte.
          </p>
        </div>
      </CardContent>
    </Card>
  );
};

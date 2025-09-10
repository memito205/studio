

"use client";

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import type { BrandProductivity, RemisionEntry } from '@/types';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Clock, User } from 'lucide-react';
import React from 'react';
import { ClassificationDetailsDialog } from './ClassificationDetailsDialog';

interface BrandSummaryProps {
  data: BrandProductivity[];
}

const getComplianceVariant = (compliance: number): 'destructive' | 'warning' | 'secondary' | 'default' => {
  if (compliance > 100) return 'default';
  if (compliance >= 90) return 'secondary';
  if (compliance >= 85) return 'warning';
  return 'destructive';
};

const categoryColorClasses: { [key: string]: string } = {
  'CALZADO': 'bg-chart-1',
  'ROPA': 'bg-chart-2',
  'ACCESORIOS': 'bg-chart-3',
  'NO CLASIFICADO': 'bg-chart-4',
};

export const BrandSummary: React.FC<BrandSummaryProps> = ({ data }) => {
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const [selectedTitle, setSelectedTitle] = React.useState('');
  const [selectedItems, setSelectedItems] = React.useState<RemisionEntry[]>([]);

  const handleOpenDetails = (brandData: BrandProductivity) => {
    setSelectedTitle(`Marca: ${brandData.brandName}`);
    setSelectedItems(brandData.entries);
    setDetailsOpen(true);
  };
  
  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Resumen por Marca</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">No hay datos de marcas para mostrar.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <ClassificationDetailsDialog
        isOpen={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        title={selectedTitle}
        items={selectedItems}
      />
      <Card>
        <CardHeader>
          <CardTitle>Resumen por Marca</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {data.map((brand) => (
            <div key={brand.brandName}>
              <div className="flex justify-between items-baseline mb-1">
                <span 
                  className="font-semibold text-card-foreground cursor-pointer hover:underline"
                  onClick={() => handleOpenDetails(brand)}
                  title={`Ver detalles de ${brand.brandName}`}
                >
                  {brand.brandName}
                </span>
                <div className="text-right">
                  <div className="flex items-center justify-end gap-2 text-sm font-medium text-muted-foreground">
                      <Clock className="w-3 h-3"/>
                      <span>{(brand.workHours || 0).toFixed(2)} hrs</span>
                      <span>|</span>
                      <span>{brand.totalQuantity.toLocaleString()} unid. ({brand.percentage.toFixed(1)}%)</span>
                  </div>
                  {brand.productivity > 0 && (
                    <div className="flex justify-end items-center gap-3 mt-0.5">
                      <span className="text-xs font-semibold text-primary/90">
                        {brand.productivity.toFixed(1)} / {Math.round(brand.baseGoal)}{' '}
                        <span className="font-normal text-muted-foreground">u/hr</span>
                      </span>
                       <Badge variant={getComplianceVariant(brand.compliance)} className="w-16 justify-center">
                          {brand.compliance.toFixed(1)}%
                      </Badge>
                    </div>
                  )}
                </div>
              </div>
              
              <Progress value={brand.percentage} className="h-2" />

              {brand.breakdown && brand.breakdown.length > 0 && (
                <div className="mt-3 ml-2 pl-3 border-l-2 border-border space-y-1.5">
                  {brand.breakdown.map((item) => (
                    <div key={item.packerName} className="flex items-center justify-between text-sm text-muted-foreground">
                      <div className="flex items-center gap-2">
                         <User className="w-3 h-3 text-muted-foreground" />
                        <span className="font-medium capitalize text-card-foreground/90">{item.packerName.toLowerCase()}</span>
                      </div>
                      <div className="flex items-baseline gap-3">
                         <span className="text-xs">{item.hoursWorked.toFixed(2)} hrs</span>
                        <span className="font-mono text-xs text-card-foreground">{item.totalQuantity.toLocaleString()} unid.</span>
                         <span className="text-xs text-muted-foreground">{Math.round(item.baseGoal)} u/hr</span>
                        <Badge variant={getComplianceVariant(item.compliance)} className="w-16 justify-center">
                          {item.compliance.toFixed(1)}%
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
};

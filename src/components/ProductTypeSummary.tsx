
"use client";

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import type { ProductTypeProductivity, RemisionEntry, ProductCategory } from '@/types';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { User, Clock } from 'lucide-react';
import React from 'react';
import { ClassificationDetailsDialog } from './ClassificationDetailsDialog';


interface ProductTypeSummaryProps {
  data: ProductTypeProductivity[];
}

const getComplianceVariant = (compliance: number): 'destructive' | 'warning' | 'secondary' | 'default' => {
  if (compliance > 100) return 'default';
  if (compliance >= 90) return 'secondary';
  if (compliance >= 85) return 'warning';
  return 'destructive';
};

// Map categories to chart colors from globals.css for consistency
const categoryChartColors: Record<ProductCategory, string> = {
  'CALZADO': 'hsl(var(--chart-1))',
  'ROPA': 'hsl(var(--chart-2))',
  'ACCESORIOS': 'hsl(var(--chart-3))',
  'NO CLASIFICADO': 'hsl(var(--chart-4))',
};

export const ProductTypeSummary: React.FC<ProductTypeSummaryProps> = ({ data }) => {
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const [selectedTitle, setSelectedTitle] = React.useState('');
  const [selectedItems, setSelectedItems] = React.useState<RemisionEntry[]>([]);

  const handleOpenDetails = (prodTypeData: ProductTypeProductivity) => {
    setSelectedTitle(`Tipo de Producto: ${prodTypeData.category}`);
    setSelectedItems(prodTypeData.entries);
    setDetailsOpen(true);
  };
  
  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Resumen por Tipo de Producto</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">No hay datos de tipo de producto para mostrar.</p>
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
          <CardTitle>Resumen por Tipo de Producto</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {data.map((prodType) => (
            <div key={prodType.category}>
              <div className="flex justify-between items-baseline mb-1">
                <span 
                  className="font-semibold text-card-foreground cursor-pointer hover:underline"
                  onClick={() => handleOpenDetails(prodType)}
                  title={`Ver detalles de ${prodType.category}`}
                >
                  {prodType.category}
                </span>
                <div className="text-right">
                  <div className="flex items-center justify-end gap-2 text-sm font-medium text-muted-foreground">
                      <Clock className="w-3 h-3"/>
                      <span>{(prodType.workHours || 0).toFixed(2)} hrs</span>
                      <span>|</span>
                      <span>{prodType.totalQuantity.toLocaleString()} unid. ({prodType.percentage.toFixed(1)}%)</span>
                  </div>
                  {prodType.productivity > 0 && (
                     <div className="flex justify-end items-center gap-3 mt-0.5">
                        <span className="text-xs font-semibold text-primary/90">{prodType.productivity.toFixed(1)} u/hr</span>
                        <Badge variant={getComplianceVariant(prodType.compliance)} className="w-16 justify-center">
                          {prodType.compliance.toFixed(1)}%
                      </Badge>
                     </div>
                  )}
                </div>
              </div>
              <Progress
                value={prodType.percentage}
                className="h-2"
                style={{ '--indicator-color': categoryChartColors[prodType.category] || 'hsl(var(--chart-5))' } as React.CSSProperties}
              >
                  <div 
                      className="h-full w-full flex-1 bg-primary transition-all" 
                      style={{ transform: `translateX(-${100 - (prodType.percentage || 0)}%)`, backgroundColor: 'var(--indicator-color)' }}
                  />
              </Progress>
               {prodType.breakdown && prodType.breakdown.length > 0 && (
                <div className="mt-3 ml-2 pl-3 border-l-2 border-border space-y-1.5">
                  {prodType.breakdown.map((item) => (
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

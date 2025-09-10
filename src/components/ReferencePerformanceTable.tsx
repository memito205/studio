
"use client";

import React, { useState, useMemo } from 'react';
import type { PackerReferenceProductivityDetail, ProductCategory } from '@/types';
import { ArrowUp, ArrowDown, Sparkles, Download } from 'lucide-react';
import { exportToXlsx } from '@/services/export';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';


interface AggregatedReferencePerformance {
  referencia: string;
  descripcion: string;
  brandName: string;
  productType: ProductCategory;
  totalQuantity: number;
  hoursWorked: number;
  productivity: number;
  baseGoal: number; 
  compliance: number;
  operatorCount: number;
}

type SortKey = keyof AggregatedReferencePerformance;
type SortOrder = 'asc' | 'desc';

const SortableHeader: React.FC<{
  label: string;
  sortKey: SortKey;
  currentSortKey: SortKey;
  sortOrder: SortOrder;
  onSort: (key: SortKey) => void;
  className?: string;
}> = ({ label, sortKey, currentSortKey, sortOrder, onSort, className }) => {
  const isSorted = currentSortKey === sortKey;
  return (
    <TableHead
      className={`cursor-pointer ${className}`}
      onClick={() => onSort(sortKey)}
    >
      <div className="flex items-center gap-2">
        {label}
        {isSorted && (sortOrder === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />)}
      </div>
    </TableHead>
  );
};


interface ReferencePerformanceTableProps {
  data: PackerReferenceProductivityDetail[];
  onAnalyze: (context: any, type: 'reference' | 'comparison_reference') => void;
}

export const ReferencePerformanceTable: React.FC<ReferencePerformanceTableProps> = ({ data, onAnalyze }) => {
  const [sortKey, setSortKey] = useState<SortKey>('totalQuantity');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [filter, setFilter] = useState('');
  const [selectedForComparison, setSelectedForComparison] = useState<AggregatedReferencePerformance[]>([]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortOrder('desc');
    }
  };

  const handleSelectForComparison = (ref: AggregatedReferencePerformance, isChecked: boolean) => {
    if (isChecked) {
      if (selectedForComparison.length < 2) {
        setSelectedForComparison([...selectedForComparison, ref]);
      }
    } else {
      setSelectedForComparison(selectedForComparison.filter(r => r.referencia !== ref.referencia));
    }
  };

  const aggregatedData = useMemo(() => {
    const refMap = new Map<string, PackerReferenceProductivityDetail[]>();
    data.forEach(d => {
        if (!refMap.has(d.referencia)) {
            refMap.set(d.referencia, []);
        }
        refMap.get(d.referencia)!.push(d);
    });

    const aggregated: AggregatedReferencePerformance[] = Array.from(refMap.entries()).map(([referencia, details]) => {
        const first = details[0];
        const totalQuantity = details.reduce((sum, d) => sum + d.totalQuantity, 0);
        const hoursWorked = details.reduce((sum, d) => sum + d.hoursWorked, 0);
        const earnedHours = details.reduce((sum, d) => sum + d.totalQuantity / d.baseGoal, 0);

        const productivity = hoursWorked > 0 ? totalQuantity / hoursWorked : 0;
        const baseGoal = earnedHours > 0 ? totalQuantity / earnedHours : 60;
        const compliance = baseGoal > 0 ? (productivity / baseGoal) * 100 : 0;
        
        return {
            referencia,
            descripcion: first.descripcion,
            brandName: first.brandName,
            productType: first.productType,
            totalQuantity,
            hoursWorked,
            productivity,
            baseGoal,
            compliance,
            operatorCount: details.length,
        };
    });

    let filtered = aggregated;
    if (filter) {
        const lowerFilter = filter.toLowerCase();
        filtered = aggregated.filter(item => 
            item.referencia.toLowerCase().includes(lowerFilter) ||
            item.descripcion.toLowerCase().includes(lowerFilter) ||
            item.brandName.toLowerCase().includes(lowerFilter)
        );
    }
    
    filtered.sort((a, b) => {
      const aValue = a[sortKey];
      const bValue = b[sortKey];
      if (aValue < bValue) {
        return sortOrder === 'asc' ? -1 : 1;
      }
      if (aValue > bValue) {
        return sortOrder === 'asc' ? 1 : -1;
      }
      return 0;
    });

    return filtered;

  }, [data, filter, sortKey, sortOrder]);

  const getComplianceVariant = (compliance: number): 'destructive' | 'secondary' | 'default' => {
    if (compliance >= 100) return 'default';
    if (compliance >= 85) return 'secondary';
    return 'destructive';
  };
  
  const handleExport = () => {
    const dataToExport = aggregatedData.map(d => ({
        'Referencia': d.referencia,
        'Descripcion': d.descripcion,
        'Marca': d.brandName,
        'Tipo Producto': d.productType,
        'Unidades': d.totalQuantity,
        'Operarios': d.operatorCount,
        'Productividad (u/hr)': d.productivity,
        'Meta (u/hr)': d.baseGoal,
        'Cumplimiento (%)': d.compliance,
        'Horas Trabajadas': d.hoursWorked,
    }));
    exportToXlsx(dataToExport, 'productividad_por_referencia');
  }

  if (!data || data.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap justify-between items-center gap-4 mb-2">
            <div>
                <CardTitle>Análisis de Rendimiento por Referencia</CardTitle>
                <CardDescription>Identifique las referencias con mayor y menor rendimiento. Use el filtro para buscar.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
                <Button
                    onClick={() => onAnalyze({ itemA: selectedForComparison[0], itemB: selectedForComparison[1] }, 'comparison_reference')}
                    disabled={selectedForComparison.length !== 2}
                    variant="outline"
                >
                    <Sparkles className="mr-2 h-4 w-4" />
                    Comparar con IA
                </Button>
                <Button onClick={handleExport} variant="outline">
                    <Download className="mr-2 h-4 w-4" />
                    Exportar
                </Button>
            </div>
        </div>
      </CardHeader>
      <CardContent>
         <div className="my-4">
            <Input
                type="text"
                value={filter}
                onChange={e => setFilter(e.target.value)}
                placeholder="Filtrar por referencia, descripción o marca..."
                className="w-full sm:w-1/2"
            />
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead></TableHead>
              <SortableHeader label="Referencia" sortKey="referencia" currentSortKey={sortKey} sortOrder={sortOrder} onSort={handleSort} />
              <TableHead>Descripción</TableHead>
              <SortableHeader label="Marca" sortKey="brandName" currentSortKey={sortKey} sortOrder={sortOrder} onSort={handleSort} />
              <SortableHeader label="Unidades" sortKey="totalQuantity" currentSortKey={sortKey} sortOrder={sortOrder} onSort={handleSort} />
              <SortableHeader label="Productividad" sortKey="productivity" currentSortKey={sortKey} sortOrder={sortOrder} onSort={handleSort} />
              <SortableHeader label="Meta" sortKey="baseGoal" currentSortKey={sortKey} sortOrder={sortOrder} onSort={handleSort} />
              <SortableHeader label="Cumplimiento" sortKey="compliance" currentSortKey={sortKey} sortOrder={sortOrder} onSort={handleSort} />
              <SortableHeader label="Operarios" sortKey="operatorCount" currentSortKey={sortKey} sortOrder={sortOrder} onSort={handleSort} />
              <TableHead className="text-center">Análisis IA</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {aggregatedData.map((ref) => (
              <TableRow key={ref.referencia}>
                <TableCell>
                    <Checkbox
                        id={`compare-ref-${ref.referencia}`}
                        checked={selectedForComparison.some(r => r.referencia === ref.referencia)}
                        disabled={selectedForComparison.length >= 2 && !selectedForComparison.some(r => r.referencia === ref.referencia)}
                        onCheckedChange={(checked) => handleSelectForComparison(ref, !!checked)}
                        aria-label={`Seleccionar ${ref.referencia} para comparar`}
                    />
                </TableCell>
                <TableCell className="font-semibold">{ref.referencia}</TableCell>
                <TableCell className="max-w-xs truncate" title={ref.descripcion}>{ref.descripcion}</TableCell>
                <TableCell>{ref.brandName}</TableCell>
                <TableCell className="font-semibold">{ref.totalQuantity}</TableCell>
                <TableCell>{ref.productivity.toFixed(1)} <span className="text-xs text-muted-foreground">u/hr</span></TableCell>
                <TableCell>{Math.round(ref.baseGoal)} <span className="text-xs text-muted-foreground">u/hr</span></TableCell>
                <TableCell>
                  <Badge variant={getComplianceVariant(ref.compliance)}>
                    {ref.compliance.toFixed(1)}%
                  </Badge>
                </TableCell>
                 <TableCell className="text-center">{ref.operatorCount}</TableCell>
                 <TableCell className="text-center">
                    {ref.compliance < 90 && (
                         <Button 
                            onClick={() => onAnalyze(ref, 'reference')}
                            variant="ghost"
                            size="icon"
                            title="Analizar rendimiento con IA"
                        >
                            <Sparkles className="text-purple-500" />
                        </Button>
                    )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {aggregatedData.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            No se encontraron datos para los filtros seleccionados.
          </div>
        )}
      </CardContent>
    </Card>
  );
};

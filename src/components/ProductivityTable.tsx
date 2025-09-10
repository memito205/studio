

"use client";

import React, { useState, useMemo } from 'react';
import type { PackerProductivity, Annotations } from '@/types';
import { ArrowUp, ArrowDown, Coffee, Utensils, Cookie, Sparkles, Download, FilePenLine } from 'lucide-react';
import { exportToXlsx } from '@/services/export';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

type SortKey = keyof Omit<PackerProductivity, 'firstScan' | 'lastScan' | 'appliedBreaks' | 'workPeriodEnd'>;
type SortOrder = 'asc' | 'desc';

interface ProductivityTableProps {
  data: PackerProductivity[];
  onAnalyze: (context: any, type: 'operator' | 'comparison_operator') => void;
  annotations: Annotations;
  onAnnotationChange: (targetId: string, text: string) => void;
}

const SortableHeader: React.FC<{
  label: string;
  sortKey: SortKey;
  currentSortKey: SortKey;
  sortOrder: SortOrder;
  onSort: (key: SortKey) => void;
}> = ({ label, sortKey, currentSortKey, sortOrder, onSort }) => {
  const isSorted = currentSortKey === sortKey;
  return (
    <TableHead
      className="cursor-pointer"
      onClick={() => onSort(sortKey)}
    >
      <div className="flex items-center gap-2">
        {label}
        {isSorted && (sortOrder === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />)}
      </div>
    </TableHead>
  );
};


const AnnotationEditor: React.FC<{
    targetId: string;
    annotation: Annotation;
    onSave: (targetId: string, text: string) => void;
    onClose: () => void;
}> = ({ targetId, annotation, onSave, onClose }) => {
    const [text, setText] = useState(annotation?.text || '');
    
    const handleSave = () => {
        onSave(targetId, text);
        onClose();
    };

    return (
        <div className="grid gap-4">
            <div className="space-y-2">
                <h4 className="font-medium leading-none">Añadir Nota</h4>
                <p className="text-sm text-muted-foreground">
                    Añada una nota para el operario <span className="font-semibold">{targetId}</span>.
                </p>
            </div>
            <div className="grid gap-2">
                 <Textarea
                    id="annotation-text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Ej: Mostró gran mejora en la tarde..."
                    rows={4}
                />
            </div>
            <div className="flex justify-end gap-2">
                 <Button variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
                 <Button size="sm" onClick={handleSave}>Guardar</Button>
            </div>
        </div>
    )
}


export const ProductivityTable: React.FC<ProductivityTableProps> = ({ data, onAnalyze, annotations, onAnnotationChange }) => {
  const [sortKey, setSortKey] = useState<SortKey>('totalQuantity');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [selectedForComparison, setSelectedForComparison] = useState<PackerProductivity[]>([]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortOrder('desc');
    }
  };

  const handleSelectForComparison = (packer: PackerProductivity, isChecked: boolean) => {
    if (isChecked) {
      if (selectedForComparison.length < 2) {
        setSelectedForComparison([...selectedForComparison, packer]);
      }
    } else {
      setSelectedForComparison(selectedForComparison.filter(p => p.packerName !== packer.packerName));
    }
  };

  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => {
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
  }, [data, sortKey, sortOrder]);

  const getComplianceVariant = (compliance: number): 'destructive' | 'warning' | 'secondary' | 'default' => {
    if (compliance > 100) return 'default';
    if (compliance >= 90) return 'secondary';
    if (compliance >= 85) return 'warning';
    return 'destructive';
  };
  
  const handleExport = () => {
    const dataToExport = sortedData.map(p => ({
        'Operario': p.packerName,
        'Unidades': p.totalQuantity,
        'Productividad (u/hr)': p.productivity,
        'Meta Base (u/hr)': p.baseGoal,
        'Cumplimiento (%)': p.compliance,
        'Horas Trabajadas': p.hoursWorked,
        'Minutos Micro-Pausas': p.totalMicroPausesMinutes,
        'Nota': annotations[p.packerName]?.text || '',
    }));
    exportToXlsx(dataToExport, 'productividad_por_operario');
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap justify-between items-center gap-4">
            <div>
                <CardTitle>Detalle de Productividad por Operario</CardTitle>
                <CardDescription>Haga clic en las cabeceras para ordenar. Seleccione dos operarios para comparar.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
                <Button
                    onClick={() => onAnalyze({ itemA: selectedForComparison[0], itemB: selectedForComparison[1] }, 'comparison_operator')}
                    disabled={selectedForComparison.length !== 2}
                    variant="outline"
                >
                    <Sparkles />
                    Comparar con IA
                </Button>
                <Button onClick={handleExport} variant="outline">
                    <Download />
                    Exportar
                </Button>
            </div>
        </div>
      </CardHeader>
      <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead></TableHead>
                <TableHead>Operario</TableHead>
                <SortableHeader label="Unidades" sortKey="totalQuantity" currentSortKey={sortKey} sortOrder={sortOrder} onSort={handleSort} />
                <SortableHeader label="Productividad" sortKey="productivity" currentSortKey={sortKey} sortOrder={sortOrder} onSort={handleSort} />
                <SortableHeader label="Meta Base" sortKey="baseGoal" currentSortKey={sortKey} sortOrder={sortOrder} onSort={handleSort} />
                <SortableHeader label="Cumplimiento" sortKey="compliance" currentSortKey={sortKey} sortOrder={sortOrder} onSort={handleSort} />
                <TableHead className="text-center">Análisis IA</TableHead>
                <TableHead className="text-center">Nota</TableHead>
                <SortableHeader label="Horas" sortKey="hoursWorked" currentSortKey={sortKey} sortOrder={sortOrder} onSort={handleSort} />
                <SortableHeader label="Min. Desc." sortKey="totalDeductedMinutes" currentSortKey={sortKey} sortOrder={sortOrder} onSort={handleSort} />
                <TableHead>Descansos</TableHead>
                <TableHead>Horario</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedData.map((packer) => (
                <TableRow key={packer.packerName}>
                  <TableCell>
                      <Checkbox
                          id={`compare-${packer.packerName}`}
                          checked={selectedForComparison.some(p => p.packerName === packer.packerName)}
                          disabled={selectedForComparison.length >= 2 && !selectedForComparison.some(p => p.packerName === packer.packerName)}
                          onCheckedChange={(checked) => handleSelectForComparison(packer, !!checked)}
                          aria-label={`Seleccionar ${packer.packerName} para comparar`}
                      />
                  </TableCell>
                  <TableCell className="font-medium whitespace-nowrap">{packer.packerName}</TableCell>
                  <TableCell className="font-semibold">{packer.totalQuantity.toLocaleString()}</TableCell>
                  <TableCell>{packer.productivity.toFixed(2)} <span className="text-xs text-muted-foreground">u/hr</span></TableCell>
                  <TableCell>{Math.round(packer.baseGoal).toLocaleString()} <span className="text-xs text-muted-foreground">u/hr</span></TableCell>
                  <TableCell>
                    <Badge variant={getComplianceVariant(packer.compliance)}>
                      {packer.compliance.toFixed(1)}%
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                      {packer.compliance < 90 && (
                          <Button 
                              onClick={() => onAnalyze(packer, 'operator')}
                              variant="ghost"
                              size="icon"
                              title="Analizar rendimiento con IA"
                          >
                              <Sparkles className="text-purple-500" />
                          </Button>
                      )}
                  </TableCell>
                  <TableCell className="text-center">
                    <Popover>
                        <PopoverTrigger asChild>
                             <Button
                                variant="ghost"
                                size="icon"
                                title="Añadir o ver nota"
                            >
                                <FilePenLine className={`transition-colors ${annotations[packer.packerName]?.text ? 'text-primary' : 'text-muted-foreground'}`} />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80" align="end">
                           <AnnotationEditor
                                targetId={packer.packerName}
                                annotation={annotations[packer.packerName]}
                                onSave={onAnnotationChange}
                                onClose={() => document.body.click()} // Simple way to close popover
                            />
                        </PopoverContent>
                    </Popover>
                  </TableCell>
                  <TableCell>{packer.hoursWorked.toFixed(2)}</TableCell>
                  <TableCell className="font-semibold text-center">{packer.totalDeductedMinutes}</TableCell>
                  <TableCell>
                    <TooltipProvider>
                     <div className="flex items-center space-x-2">
                         <Tooltip>
                            <TooltipTrigger>
                                <Coffee className={`transition-colors ${packer.appliedBreaks.BREAKFAST ? 'text-green-500' : 'text-muted-foreground/50'}`} />
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>{packer.appliedBreaks.BREAKFAST ? "Desayuno Aplicado" : "Desayuno no Aplicado"}</p>
                            </TooltipContent>
                         </Tooltip>
                         <Tooltip>
                            <TooltipTrigger>
                                <Utensils className={`transition-colors ${packer.appliedBreaks.LUNCH ? 'text-green-500' : 'text-muted-foreground/50'}`} />
                            </TooltipTrigger>
                             <TooltipContent>
                                <p>{packer.appliedBreaks.LUNCH ? "Almuerzo Aplicado" : "Almuerzo no Aplicado"}</p>
                            </TooltipContent>
                         </Tooltip>
                         <Tooltip>
                            <TooltipTrigger>
                                <Cookie className={`transition-colors ${packer.appliedBreaks.SNACK ? 'text-green-500' : 'text-muted-foreground/50'}`} />
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>{packer.appliedBreaks.SNACK ? "Refrigerio Aplicado" : "Refrigerio no Aplicado"}</p>
                            </TooltipContent>
                         </Tooltip>
                     </div>
                    </TooltipProvider>
                  </TableCell>
                   <TableCell className="whitespace-nowrap">
                      {packer.firstScan.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {packer.workPeriodEnd.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                   </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
      </CardContent>
    </Card>
  );
};

    




"use client";

import React from 'react';
import type { PackerBrandProductivityDetail } from '@/types';
import { ArrowUp, ArrowDown, Download } from 'lucide-react';
import { exportToXlsx } from '@/services/export';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';

type SortKey = keyof PackerBrandProductivityDetail;
type SortOrder = 'asc' | 'desc';

interface SortableHeaderProps {
  label: string;
  sortKey: SortKey;
  currentSortKey: SortKey;
  sortOrder: SortOrder;
  onSort: (key: SortKey) => void;
  className?: string;
}

const SortableHeader: React.FC<SortableHeaderProps> = ({ label, sortKey, currentSortKey, sortOrder, onSort, className }) => {
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

interface PackerDetailTableProps {
  data: PackerBrandProductivityDetail[];
}

export const PackerDetailTable: React.FC<PackerDetailTableProps> = ({ data }) => {
  const [sortKey, setSortKey] = React.useState<SortKey>('packerName');
  const [sortOrder, setSortOrder] = React.useState<SortOrder>('asc');
  const [selectedPacker, setSelectedPacker] = React.useState<string>('all');
  const [selectedBrand, setSelectedBrand] = React.useState<string>('all');

  const packers = React.useMemo(() => ['all', ...Array.from(new Set(data.map(d => d.packerName))).sort()], [data]);
  const brands = React.useMemo(() => ['all', ...Array.from(new Set(data.map(d => d.brandName))).sort()], [data]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortOrder('desc');
    }
  };

  const sortedAndFilteredData = React.useMemo(() => {
    let filteredData = [...data];

    if (selectedPacker !== 'all') {
      filteredData = filteredData.filter(d => d.packerName === selectedPacker);
    }
    if (selectedBrand !== 'all') {
      filteredData = filteredData.filter(d => d.brandName === selectedBrand);
    }

    filteredData.sort((a, b) => {
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

    return filteredData;
  }, [data, sortKey, sortOrder, selectedPacker, selectedBrand]);
  
  const handleExport = () => {
    const dataToExport = sortedAndFilteredData.map(d => ({
        'Operario': d.packerName,
        'Marca': d.brandName,
        'Tipo Producto': d.productType,
        'Unidades': d.totalQuantity,
        'Productividad (u/hr)': d.productivity,
        'Meta (u/hr)': d.baseGoal,
        'Cumplimiento (%)': d.compliance,
        'Horas': d.hoursWorked,
    }));
    exportToXlsx(dataToExport, 'productividad_detalle_marca');
  }

  const getComplianceVariant = (compliance: number): 'destructive' | 'secondary' | 'default' => {
    if (compliance >= 100) return 'default';
    if (compliance >= 85) return 'secondary';
    return 'destructive';
  };

  if (!data || data.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div>
          <CardTitle>Detalle por Operario, Marca y Producto</CardTitle>
          <CardDescription>
            Analice el rendimiento en tareas específicas. Use los filtros para enfocar su análisis.
          </CardDescription>
        </div>
         <Button
            onClick={handleExport}
            variant="outline"
            className="flex-shrink-0"
        >
            <Download className="mr-2 h-4 w-4" />
            Exportar
        </Button>
      </CardHeader>
      
      <CardContent>
        <div className="flex flex-wrap gap-4 mb-6">
          <div className="flex-1 min-w-[200px]">
            <Label htmlFor="packer-filter">Filtrar por Operario</Label>
            <Select value={selectedPacker} onValueChange={setSelectedPacker}>
              <SelectTrigger id="packer-filter">
                <SelectValue placeholder="Seleccionar operario..." />
              </SelectTrigger>
              <SelectContent>
                {packers.map(packer => (
                  <SelectItem key={packer} value={packer}>{packer === 'all' ? 'Todos los Operarios' : packer}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <Label htmlFor="brand-filter">Filtrar por Marca</Label>
            <Select value={selectedBrand} onValueChange={setSelectedBrand}>
                <SelectTrigger id="brand-filter">
                    <SelectValue placeholder="Seleccionar marca..." />
                </SelectTrigger>
                <SelectContent>
                    {brands.map(brand => (
                        <SelectItem key={brand} value={brand}>{brand === 'all' ? 'Todas las Marcas' : brand}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <SortableHeader label="Operario" sortKey="packerName" currentSortKey={sortKey} sortOrder={sortOrder} onSort={handleSort} />
              <SortableHeader label="Marca" sortKey="brandName" currentSortKey={sortKey} sortOrder={sortOrder} onSort={handleSort} />
              <SortableHeader label="Tipo Producto" sortKey="productType" currentSortKey={sortKey} sortOrder={sortOrder} onSort={handleSort} />
              <SortableHeader label="Unidades" sortKey="totalQuantity" currentSortKey={sortKey} sortOrder={sortOrder} onSort={handleSort} />
              <SortableHeader label="Productividad" sortKey="productivity" currentSortKey={sortKey} sortOrder={sortOrder} onSort={handleSort} />
              <SortableHeader label="Meta" sortKey="baseGoal" currentSortKey={sortKey} sortOrder={sortOrder} onSort={handleSort} />
              <SortableHeader label="Cumplimiento" sortKey="compliance" currentSortKey={sortKey} sortOrder={sortOrder} onSort={handleSort} />
              <SortableHeader label="Horas" sortKey="hoursWorked" currentSortKey={sortKey} sortOrder={sortOrder} onSort={handleSort} className="text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedAndFilteredData.map((detail, index) => (
              <TableRow key={index}>
                <TableCell className="font-medium">{detail.packerName}</TableCell>
                <TableCell>{detail.brandName}</TableCell>
                <TableCell>{detail.productType}</TableCell>
                <TableCell className="font-semibold">{detail.totalQuantity}</TableCell>
                <TableCell>{detail.productivity.toFixed(1)} <span className="text-xs text-muted-foreground">u/hr</span></TableCell>
                <TableCell>{Math.round(detail.baseGoal)} <span className="text-xs text-muted-foreground">u/hr</span></TableCell>
                <TableCell>
                   <Badge variant={getComplianceVariant(detail.compliance)}>
                    {detail.compliance.toFixed(1)}%
                  </Badge>
                </TableCell>
                <TableCell className="text-right">{detail.hoursWorked.toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {sortedAndFilteredData.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            No se encontraron datos para los filtros seleccionados.
          </div>
        )}
      </CardContent>
    </Card>
  );
};

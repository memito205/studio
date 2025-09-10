/** @jsxImportSource react */
import React, { useEffect, useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EditReceptionOperationDialog } from './EditReceptionOperationDialog';
import { Settings, Play, Eye, Edit, Boxes, Download, ArrowDownUp, BarChartHorizontal, Bug } from 'lucide-react'; 
import { OperationPackingUnitsSummaryDialog } from './OperationPackingUnitsSummaryDialog';
import { ReceptionOperation, OperationReport, Location } from '@/types';
import SetStandardPerHourDialog from './SetStandardPerHourDialog';
import { OperationDetailedReportDialog } from './OperationDetailedReportDialog';
import { exportReportsToExcel } from '@/services/export';
import ProductivityReportDialog from './ProductivityReportDialog';
import { OperationDebugDialog } from './OperationDebugDialog';
import { useAuth } from '@/hooks/use-auth-context';


interface ReceptionOperationsTableProps {
  operations: ReceptionOperation[];
  loading: boolean;
  onOperationUpdated: () => void;
  onStartReading: (operationId: string) => void;
  sortDescriptor: { column: keyof ReceptionOperation; direction: 'asc' | 'desc' };
  onSortChange: (column: keyof ReceptionOperation) => void;
  allLocations: Location[];
}

const SortableHeader: React.FC<{
  label: string;
  sortKey: keyof ReceptionOperation;
  currentSortKey: keyof ReceptionOperation;
  sortDirection: 'asc' | 'desc';
  onSort: (key: keyof ReceptionOperation) => void;
}> = ({ label, sortKey, currentSortKey, sortDirection, onSort }) => (
  <TableHead onClick={() => onSort(sortKey)} className="cursor-pointer">
    <div className="flex items-center gap-2">
      {label}
      {currentSortKey === sortKey && <ArrowDownUp className={`h-4 w-4 transition-transform ${sortDirection === 'desc' ? 'rotate-180' : ''}`} />}
    </div>
  </TableHead>
);

const ReceptionOperationsTable: React.FC<ReceptionOperationsTableProps> = ({ operations, loading, onOperationUpdated, onStartReading, sortDescriptor, onSortChange, allLocations }) => {
  const { role } = useAuth(); // Get user role

  const handleExport = () => {
    // We need to construct the OperationReport object here before exporting.
    // This is a simplified version. A real implementation might need more data.
    const reportData: OperationReport[] = operations.map(op => ({
      ...op,
      quantityStatus: { text: 'N/A', color: 'gray' }, // Placeholder
      uniquePackingUnitNames: [], // Placeholder
      uniqueLocationNames: [], // Placeholder
    }));
    exportReportsToExcel(reportData);
  }


  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }

  if (operations.length === 0) {
    return (
      <p className="text-center text-muted-foreground py-8">No hay operaciones para mostrar con los filtros actuales.</p>
    );
  }
  
  const formatDateString = (dateString: string) => {
    if (!dateString) return 'N/A';
    // The date string is already in YYYY-MM-DD format from the server action.
    // We need to parse it without timezone interpretation to avoid off-by-one errors.
    const parts = dateString.split('-');
    if (parts.length !== 3) return dateString; // Return original if format is unexpected
    const [year, month, day] = parts;
    return `${day}/${month}/${year}`;
  };

  return (
    <div className="rounded-md border overflow-x-auto">
      <div className="flex justify-end p-2">
        <Button onClick={handleExport} variant="outline" size="sm">
          <Download className="mr-2 h-4 w-4"/>
          Exportar
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHeader label="Identificador RK" sortKey="rk_identifier" currentSortKey={sortDescriptor.column} sortDirection={sortDescriptor.direction} onSort={onSortChange} />
            <SortableHeader label="Proveedor" sortKey="supplier" currentSortKey={sortDescriptor.column} sortDirection={sortDescriptor.direction} onSort={onSortChange} />
            <SortableHeader label="Fecha de Llegada" sortKey="expected_arrival_date" currentSortKey={sortDescriptor.column} sortDirection={sortDescriptor.direction} onSort={onSortChange} />
            <SortableHeader label="Cant. Esperada" sortKey="expected_quantity" currentSortKey={sortDescriptor.column} sortDirection={sortDescriptor.direction} onSort={onSortChange} />
            <SortableHeader label="Cant. Leída" sortKey="totalScannedQuantity" currentSortKey={sortDescriptor.column} sortDirection={sortDescriptor.direction} onSort={onSortChange} />
            <SortableHeader label="Estado" sortKey="status" currentSortKey={sortDescriptor.column} sortDirection={sortDescriptor.direction} onSort={onSortChange} />
            <TableHead className="text-right">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {operations.map((operation) => {
            const isOperationImmutable = operation.status === 'completed' || operation.status === 'cancelled';
            const showAdminTools = role === 'admin' || role === 'supervisor';
            return (
            <TableRow key={operation.id}>
              <TableCell className="font-medium">{operation.rk_identifier}</TableCell>
              <TableCell>{operation.supplier}</TableCell>
              <TableCell>{formatDateString(operation.expected_arrival_date)}</TableCell>
              <TableCell>{operation.expected_quantity}</TableCell>
              <TableCell>{operation.totalScannedQuantity?.toLocaleString() ?? '0'}</TableCell>
              <TableCell>{operation.status}</TableCell>
              <TableCell className="text-right flex items-center justify-end space-x-1">
                {operation.id && (
                  <>
                    {showAdminTools && (
                       <>
                         <OperationDebugDialog operationId={operation.id}>
                            <Button variant="ghost" size="icon" title="Depurar Datos de Operación">
                                <Bug className="h-4 w-4 text-orange-500" />
                            </Button>
                         </OperationDebugDialog>
                         <ProductivityReportDialog operation={operation}>
                            <Button variant="ghost" size="icon" title="Ver Reporte de Productividad">
                                <BarChartHorizontal className="h-4 w-4" />
                            </Button>
                         </ProductivityReportDialog>
                         <OperationDetailedReportDialog operation={operation}>
                           <Button variant="ghost" size="icon" title="Ver Reporte Detallado">
                             <Eye className="h-4 w-4" />
                           </Button>
                         </OperationDetailedReportDialog>
                       </>
                    )}
                    <OperationPackingUnitsSummaryDialog receptionId={operation.id}>
                        <Button variant="ghost" size="icon" title="Buscar Caja / Ver Unidades de Empaque">
                            <Boxes className="h-4 w-4 text-blue-500" />
                        </Button>
                    </OperationPackingUnitsSummaryDialog>

                    <EditReceptionOperationDialog
                      operation={operation}
                      onSave={onOperationUpdated}
                    >
                      <Button variant="ghost" size="icon" title="Editar operación" disabled={isOperationImmutable}>
                        <Edit className="h-4 w-4" />
                      </Button>
                    </EditReceptionOperationDialog>
                    {(operation.status === 'pending' || operation.status === 'in_progress') && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onStartReading(operation.id!)}
                        title={operation.status === 'pending' ? 'Iniciar Lectura' : 'Continuar Lectura'}
                      >
                        <Play className="h-4 w-4 mr-2" />
                        {operation.status === 'pending' ? 'Iniciar' : 'Continuar'}
                      </Button>
                    )}
                  </>
                )}
              </TableCell>
            </TableRow>
          );
          })}
        </TableBody>
      </Table>
    </div>
  );
};

export default ReceptionOperationsTable;

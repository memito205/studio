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
import { Settings, Play, Eye, Edit, Boxes, Download, ArrowDownUp, BarChartHorizontal, Bug, Loader2, Search, Tag, RotateCcw } from 'lucide-react'; 
import { OperationPackingUnitsSummaryDialog } from './OperationPackingUnitsSummaryDialog';
import { ReceptionOperation, OperationReport, Location, PackedItem } from '@/types';
import SetStandardPerHourDialog from './SetStandardPerHourDialog';
import { OperationDetailedReportDialog } from './OperationDetailedReportDialog';
import { exportToXlsx } from '@/services/export';
import ProductivityReportDialog from './ProductivityReportDialog';
import { OperationDebugDialog } from './OperationDebugDialog';
import { useAuth } from '@/hooks/use-auth-context';
import { exportBasicOperationReport, getPackingUnitDetails, updateReceptionOperation } from '@/app/reception/actions';
import { useToast } from '@/hooks/use-toast';
import * as XLSX from 'xlsx';
import { FindPackingUnitDialog } from './FindPackingUnitDialog';
import PackingUnitDetailsDialog from './PackingUnitDetailsDialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';


interface ReceptionOperationsTableProps {
  operations: ReceptionOperation[];
  loading: boolean;
  onOperationUpdated: () => void;
  onStartReading: (operationId: string) => void;
  sortDescriptor: { column: keyof ReceptionOperation; direction: 'asc' | 'desc' };
  onSortChange: (column: keyof ReceptionOperation) => void;
  allLocations: Location[];
  onRowClick?: (operation: ReceptionOperation) => void; // Make this optional
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

const ReceptionOperationsTable: React.FC<ReceptionOperationsTableProps> = ({ operations, loading, onOperationUpdated, onStartReading, sortDescriptor, onSortChange, allLocations, onRowClick }) => {
  const { role } = useAuth();
  const { toast } = useToast();
  const [isExporting, setIsExporting] = useState<string | null>(null);
  const [reopeningId, setReopeningId] = useState<string | null>(null);
  const [isFindUnitDialogOpen, setIsFindUnitDialogOpen] = useState(false);
  const [isUnitDetailsOpen, setIsUnitDetailsOpen] = useState(false);
  const [isFindingUnit, setIsFindingUnit] = useState(false);
  const [selectedOperationIdForFind, setSelectedOperationIdForFind] = useState<string | null>(null);
  const [foundUnitData, setFoundUnitData] = useState<{ unit: any; items: PackedItem[] } | null>(null);


  const handleExport = () => {
    // We need to construct the OperationReport object here before exporting.
    // This is a simplified version. A real implementation might need more data.
    const reportData: OperationReport[] = operations.map(op => ({
      ...op,
      quantityStatus: { text: 'N/A', color: 'gray' }, // Placeholder
      uniquePackingUnitNames: [], // Placeholder
      uniqueLocationNames: [], // Placeholder
    }));
    exportToXlsx(reportData, "Reporte_General_Operaciones");
  }
  

  const handleFullReportExport = async (operation: ReceptionOperation) => {
    if (!operation.id) return;
    setIsExporting(operation.id);
    const result = await exportBasicOperationReport(operation.id);

    if (result.success && result.sheets) {
        const workbook = XLSX.utils.book_new();
        result.sheets.forEach(sheetInfo => {
            const worksheet = XLSX.utils.json_to_sheet(sheetInfo.data);
            XLSX.utils.book_append_sheet(workbook, worksheet, sheetInfo.sheetName);
        });
        XLSX.writeFile(workbook, `Reporte_Completo_${operation.rk_identifier}.xlsx`);
        toast({ title: 'Éxito', description: 'El reporte completo ha sido exportado.' });
    } else {
        toast({ variant: 'destructive', title: 'Error', description: result.error || 'No se pudo generar el reporte completo.' });
    }
    setIsExporting(null);
  };
  
  const handleOpenFindUnitDialog = (operationId: string) => {
    setSelectedOperationIdForFind(operationId);
    setIsFindUnitDialogOpen(true);
  };

  const handleFindUnit = async (unitNumber: number) => {
    if (!selectedOperationIdForFind) return;
    setIsFindingUnit(true);
    const result = await getPackingUnitDetails(selectedOperationIdForFind, unitNumber);
    if (result.success && result.data) {
        setFoundUnitData(result.data);
        setIsFindUnitDialogOpen(false);
        setIsUnitDetailsOpen(true);
    } else {
        toast({ variant: 'destructive', title: 'Error', description: result.error || 'No se encontró la unidad.' });
    }
    setIsFindingUnit(false);
  };
  
  const handleUnitDetailsDialogClose = () => {
      setIsUnitDetailsOpen(false);
      setFoundUnitData(null);
  }
  
  const handleReopenOperation = async (operationId: string) => {
    setReopeningId(operationId);
    try {
      const result = await updateReceptionOperation(operationId, { status: 'in_progress' });
      if (result.success) {
        toast({ title: 'Éxito', description: 'La operación ha sido reabierta.' });
        onOperationUpdated();
      } else {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
      }
    } finally {
      setReopeningId(null);
    }
  };


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
    const parts = dateString.split('-');
    if (parts.length !== 3) return dateString;
    const [year, month, day] = parts;
    return `${day}/${month}/${year}`;
  };

  return (
    <>
      <FindPackingUnitDialog 
        open={isFindUnitDialogOpen}
        onOpenChange={setIsFindUnitDialogOpen}
        onFind={handleFindUnit}
        isLoading={isFindingUnit}
      />
      {foundUnitData && (
        <PackingUnitDetailsDialog
            open={isUnitDetailsOpen}
            onOpenChange={handleUnitDetailsDialogClose}
            unitData={foundUnitData}
            onAction={onOperationUpdated}
        />
      )}
      <div className="rounded-md border overflow-x-auto">
        <div className="flex justify-end p-2">
          {role !== 'operator' && (
            <Button onClick={handleExport} variant="outline" size="sm">
              <Download className="mr-2 h-4 w-4"/>
              Exportar Tabla
            </Button>
          )}
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
              const isPrivilegedUser = role === 'admin' || role === 'supervisor';
              return (
              <TableRow key={operation.id} onClick={() => onRowClick?.(operation)} className={onRowClick ? 'cursor-pointer' : ''}>
                <TableCell className="font-medium">{operation.rk_identifier}</TableCell>
                <TableCell>{operation.supplier}</TableCell>
                <TableCell>{formatDateString(operation.expected_arrival_date)}</TableCell>
                <TableCell>{operation.expected_quantity}</TableCell>
                <TableCell>{operation.totalScannedQuantity?.toLocaleString() ?? '0'}</TableCell>
                <TableCell>{operation.status}</TableCell>
                <TableCell className="text-right flex items-center justify-end space-x-1" onClick={(e) => e.stopPropagation()}>
                  {operation.id && (
                    <>
                      <Button
                          variant="ghost"
                          size="icon"
                          title="Iniciar Lectura/Escaneo"
                          onClick={() => onStartReading(operation.id!)}
                          disabled={isOperationImmutable}
                        >
                          <Play className="h-4 w-4 text-green-500" />
                      </Button>
                      
                      {isPrivilegedUser && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Exportar Reporte Completo en Excel"
                            onClick={() => handleFullReportExport(operation)}
                            disabled={isExporting === operation.id}
                          >
                            {isExporting === operation.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                          </Button>

                          <OperationDebugDialog operationId={operation.id}>
                              <Button variant="ghost" size="icon" title="Depurar Datos de Operación">
                                  <Bug className="h-4 w-4 text-orange-500" />
                              </Button>
                          </OperationDebugDialog>
                          
                        {isPrivilegedUser && (
                          <ProductivityReportDialog operation={operation}>
                            <Button variant="ghost" size="icon" title="Ver Auditoría Completa (Productividad y Tiempos)">
                              <BarChartHorizontal className="h-4 w-4" />
                            </Button>
                          </ProductivityReportDialog>
                        )}
                          <OperationDetailedReportDialog operation={operation}>
                             <Button variant="ghost" size="icon" title="Ver Reporte Detallado de Ítems (Costoso)">
                               <Eye className="h-4 w-4" />
                             </Button>
                           </OperationDetailedReportDialog>
                           
                           <OperationPackingUnitsSummaryDialog receptionId={operation.id}>
                              <Button variant="ghost" size="icon" title="Resumen de Unidades de Empaque">
                                <Boxes className="h-4 w-4 text-purple-500" />
                              </Button>
                           </OperationPackingUnitsSummaryDialog>

                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" title="Reabrir Operación" disabled={operation.status !== 'completed' || reopeningId === operation.id}>
                                  {reopeningId === operation.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4 text-yellow-500" />}
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>¿Reabrir esta operación?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    La operación "{operation.rk_identifier}" volverá al estado "En Progreso" y se podrá
                                    continuar escaneando ítems.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => handleReopenOperation(operation.id)}>Sí, Reabrir</AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>

                            <EditReceptionOperationDialog
                              operation={operation}
                              onSave={onOperationUpdated}
                            >
                              <Button variant="ghost" size="icon" title="Editar operación" disabled={isOperationImmutable}>
                                <Edit className="h-4 w-4" />
                              </Button>
                            </EditReceptionOperationDialog>
                        </>
                      )}
                      
                      <Button variant="ghost" size="icon" title="Buscar Caja Específica" onClick={() => handleOpenFindUnitDialog(operation.id)}>
                          <Search className="h-4 w-4 text-blue-500" />
                      </Button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
};

export default ReceptionOperationsTable;

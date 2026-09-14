/** @jsxImportSource react */
import React, { useEffect, useMemo, useState } from 'react';
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
import { Checkbox } from '@/components/ui/checkbox';
import { EditReceptionOperationDialog } from './EditReceptionOperationDialog';
import { Play, Eye, Edit, Boxes, Download, ArrowDownUp, BarChartHorizontal, Bug, Loader2, Search, Tag, RotateCcw, CheckCircle2 } from 'lucide-react';
import { OperationPackingUnitsSummaryDialog } from './OperationPackingUnitsSummaryDialog';
import { ReceptionOperation, OperationReport, Location, PackedItem } from '@/types';
import { OperationDetailedReportDialog } from './OperationDetailedReportDialog';
import { exportToXlsx } from '@/services/export';
import ProductivityReportDialog from './ProductivityReportDialog';
import { OperationDebugDialog } from './OperationDebugDialog';
import { useAuth } from '@/hooks/use-auth-context';
import { exportBasicOperationReport, getPackingUnitDetails, updateReceptionOperation, exportOperationCatalog } from '@/app/reception/actions';
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
  onRowClick?: (operation: ReceptionOperation) => void;
}

const canFinalizeStatus = (status: ReceptionOperation['status']) =>
  status === 'pending' || status === 'in_progress' || status === 'paused';

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
  const [isExportingCatalog, setIsExportingCatalog] = useState<string | null>(null);
  const [reopeningId, setReopeningId] = useState<string | null>(null);
  const [finalizingId, setFinalizingId] = useState<string | null>(null);
  const [isBulkFinalizing, setIsBulkFinalizing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isFindUnitDialogOpen, setIsFindUnitDialogOpen] = useState(false);
  const [isUnitDetailsOpen, setIsUnitDetailsOpen] = useState(false);
  const [isFindingUnit, setIsFindingUnit] = useState(false);
  const [selectedOperationIdForFind, setSelectedOperationIdForFind] = useState<string | null>(null);
  const [foundUnitData, setFoundUnitData] = useState<{ unit: any; items: PackedItem[] } | null>(null);

  const isAdmin = role === 'admin';

  const finalizableOps = useMemo(
    () => operations.filter((op) => op.id && canFinalizeStatus(op.status)),
    [operations]
  );

  useEffect(() => {
    const valid = new Set(finalizableOps.map((op) => op.id!));
    setSelectedIds((prev) => {
      const next = new Set<string>();
      prev.forEach((id) => {
        if (valid.has(id)) next.add(id);
      });
      return next;
    });
  }, [finalizableOps]);

  const allFinalizableSelected =
    finalizableOps.length > 0 && finalizableOps.every((op) => selectedIds.has(op.id!));

  const toggleSelectAll = (checked: boolean) => {
    if (!checked) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(finalizableOps.map((op) => op.id!)));
  };

  const toggleSelectOne = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const completeOperation = async (operationId: string) => {
    return updateReceptionOperation(operationId, {
      status: 'completed',
      end_time: new Date().toISOString(),
    });
  };

  const handleFinalizeOne = async (operationId: string) => {
    setFinalizingId(operationId);
    try {
      const result = await completeOperation(operationId);
      if (result.success) {
        toast({ title: 'Operación finalizada', description: 'Quedó marcada como completada.' });
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(operationId);
          return next;
        });
        onOperationUpdated();
      } else {
        toast({ variant: 'destructive', title: 'Error', description: result.error });
      }
    } finally {
      setFinalizingId(null);
    }
  };

  const handleBulkFinalize = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setIsBulkFinalizing(true);
    let ok = 0;
    const errors: string[] = [];
    for (const id of ids) {
      const result = await completeOperation(id);
      if (result.success) ok += 1;
      else errors.push(result.error || id);
    }
    setIsBulkFinalizing(false);
    setSelectedIds(new Set());
    onOperationUpdated();
    if (errors.length === 0) {
      toast({
        title: 'Operaciones finalizadas',
        description: `Se finalizaron ${ok} operación(es).`,
      });
    } else {
      toast({
        variant: 'destructive',
        title: `Finalizadas ${ok} de ${ids.length}`,
        description: errors.slice(0, 3).join(' · '),
      });
    }
  };

  const handleExport = () => {
    const reportData: OperationReport[] = operations.map(op => ({
      ...op,
      quantityStatus: { text: 'N/A', color: 'gray' },
      uniquePackingUnitNames: [],
      uniqueLocationNames: [],
    }));
    exportToXlsx(reportData, "Reporte_General_Operaciones");
  };


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

  const handleCatalogExport = async (operation: ReceptionOperation) => {
    if (!operation.id) return;
    setIsExportingCatalog(operation.id);
    const result = await exportOperationCatalog(operation.id);

    if (result.success && result.data) {
        const worksheet = XLSX.utils.json_to_sheet(result.data);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Catálogo de Operación");
        XLSX.writeFile(workbook, `Catalogo_${operation.rk_identifier}.xlsx`);
        toast({ title: 'Éxito', description: 'El catálogo de la operación ha sido exportado.' });
    } else {
        toast({ variant: 'destructive', title: 'Error', description: result.error || 'No se pudo generar el catálogo.' });
    }
    setIsExportingCatalog(null);
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

  const selectedOps = operations.filter((op) => op.id && selectedIds.has(op.id));

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
        <div className="flex flex-wrap justify-between items-center gap-2 p-2">
          <div className="flex items-center gap-2">
            {isAdmin && finalizableOps.length > 0 ? (
              <>
                <span className="text-sm text-muted-foreground">
                  {selectedIds.size > 0
                    ? `${selectedIds.size} seleccionada(s)`
                    : 'Seleccione operaciones para finalizar'}
                </span>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="sm"
                      disabled={selectedIds.size === 0 || isBulkFinalizing}
                    >
                      {isBulkFinalizing ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                      )}
                      Finalizar seleccionadas
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        ¿Finalizar {selectedIds.size} operación(es)?
                      </AlertDialogTitle>
                      <AlertDialogDescription asChild>
                        <div className="space-y-2 text-sm text-muted-foreground">
                          <p>
                            Quedarán como completadas y no se podrá seguir escaneando en ellas
                            (salvo que un admin las reabra).
                          </p>
                          <ul className="max-h-40 overflow-y-auto list-disc pl-5 text-foreground">
                            {selectedOps.map((op) => (
                              <li key={op.id}>
                                {op.rk_identifier} · {op.supplier} · {op.status}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={() => void handleBulkFinalize()}>
                        Sí, finalizar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            ) : null}
          </div>
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
              {isAdmin ? (
                <TableHead className="w-10">
                  <Checkbox
                    checked={allFinalizableSelected}
                    onCheckedChange={(v) => toggleSelectAll(v === true)}
                    disabled={finalizableOps.length === 0}
                    aria-label="Seleccionar todas"
                  />
                </TableHead>
              ) : null}
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
              const canFinalize = Boolean(operation.id && canFinalizeStatus(operation.status));
              return (
              <TableRow key={operation.id} onClick={() => onRowClick?.(operation)} className={onRowClick ? 'cursor-pointer' : ''}>
                {isAdmin ? (
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={Boolean(operation.id && selectedIds.has(operation.id))}
                      disabled={!canFinalize}
                      onCheckedChange={(v) => {
                        if (operation.id) toggleSelectOne(operation.id, v === true);
                      }}
                      aria-label={`Seleccionar ${operation.rk_identifier}`}
                    />
                  </TableCell>
                ) : null}
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

                      {isAdmin && canFinalize ? (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Finalizar operación"
                              disabled={finalizingId === operation.id || isBulkFinalizing}
                            >
                              {finalizingId === operation.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                              )}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>¿Finalizar esta operación?</AlertDialogTitle>
                              <AlertDialogDescription>
                                La operación &quot;{operation.rk_identifier}&quot; quedará completada y no se
                                podrá seguir escaneando (salvo reapertura por admin).
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction onClick={() => void handleFinalizeOne(operation.id!)}>
                                Sí, finalizar
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : null}
                      
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

                          <Button
                            variant="ghost"
                            size="icon"
                            title="Exportar Solo Catálogo (Ref, Talla, Barcode)"
                            onClick={() => handleCatalogExport(operation)}
                            disabled={isExportingCatalog === operation.id}
                          >
                            {isExportingCatalog === operation.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Tag className="h-4 w-4 text-blue-600" />}
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
                                  <AlertDialogAction onClick={() => handleReopenOperation(operation.id!)}>Sí, Reabrir</AlertDialogAction>
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
                      
                      <Button variant="ghost" size="icon" title="Buscar Caja Específica" onClick={() => handleOpenFindUnitDialog(operation.id!)}>
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

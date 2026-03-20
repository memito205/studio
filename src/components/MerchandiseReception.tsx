
"use client";

import React, { useState, useEffect, useCallback, ChangeEvent, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { ArrowLeft, PlusCircle, BarChartHorizontal, MapPin, ClipboardList, Boxes, BookUser, ArrowDownUp, ArrowRight, Upload, Settings, AlarmClockOff, FileCheck2, Send, Loader2, Tag, Compass } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationPrevious,
  PaginationNext,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import ReceptionOperationsTable from './ReceptionOperationsTable';
import { CreateReceptionOperationDialog } from './CreateReceptionOperationDialog';
import type { ReceptionOperation, Location, CsvRow } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { loadReceptionOperations, getLocations, bulkUploadReceptionDataFromExcel } from '@/app/reception/actions';
import { useAuth } from '@/hooks/use-auth-context';
import { cn } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { ScrollArea, ScrollBar } from './ui/scroll-area';
import { LabelingPreparationScreen } from './LabelingPreparationScreen';
import { ReferenceTraceability } from './ReferenceTraceability'; // Import the new component


const DataPreviewTable: React.FC<{ data: CsvRow[] }> = ({ data }) => {
    if (data.length === 0) return null;
    const headers = Object.keys(data[0] || {});
    const previewData = data.slice(0, 50); // Show first 50 rows

    return (
        <Card className="mt-6">
            <CardHeader>
                <CardTitle>Previsualización de Datos Cargados</CardTitle>
                <CardDescription>Mostrando las primeras {previewData.length} filas de tu archivo. Revisa que los datos y columnas sean correctos antes de procesar.</CardDescription>
            </CardHeader>
            <CardContent>
                 <ScrollArea className="w-full whitespace-nowrap rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                {headers.map(header => <TableHead key={header}>{header}</TableHead>)}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {previewData.map((row, rowIndex) => (
                                <TableRow key={rowIndex}>
                                    {headers.map(header => <TableCell key={`${rowIndex}-${header}`}>{String(row[header] ?? '')}</TableCell>)}
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                    <ScrollBar orientation="horizontal" />
                </ScrollArea>
            </CardContent>
        </Card>
    );
};


interface MerchandiseReceptionProps {
  onReturnToSuite: () => void;
  onStartReading: (operationId: string) => void;
  onNavigateToNoveltyManagement: () => void;
  onNavigateToProductsManagement: () => void; 
  onNavigateToDashboard: () => void;
  onNavigateToTimeReports: () => void; // New prop for navigation
}

type OperationStatusFilter = 'active' | 'history';
type ReceptionView = 'operations_list' | 'labeling_prep' | 'reference_traceability';


export const MerchandiseReception: React.FC<MerchandiseReceptionProps> = ({ 
    onReturnToSuite, 
    onStartReading, 
    onNavigateToNoveltyManagement,
    onNavigateToProductsManagement,
    onNavigateToDashboard,
    onNavigateToTimeReports,
}) => {
  const [operations, setOperations] = useState<ReceptionOperation[]>([]);
  const [allLocations, setAllLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [activeTab, setActiveTab] = useState<OperationStatusFilter>('active');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  
  const [previewData, setPreviewData] = useState<CsvRow[] | null>(null);
  const [uploadedFileContent, setUploadedFileContent] = useState<string | null>(null);
  
  const [sortBy, setSortBy] = useState<keyof ReceptionOperation>('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  
  const { toast } = useToast();
  const { user, role } = useAuth();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  
  const [view, setView] = useState<ReceptionView>('operations_list');
  const [selectedOperation, setSelectedOperation] = useState<ReceptionOperation | null>(null);

  const fetchOperations = useCallback(async () => {
    setLoading(true);
    let statusFilter: Array<'pending' | 'in_progress' | 'completed' | 'cancelled'> | undefined;
    if (activeTab === 'active') {
      statusFilter = ['pending', 'in_progress'];
    } else if (activeTab === 'history') {
      statusFilter = ['completed', 'cancelled'];
    }
    
    const [opsResult, locResult] = await Promise.all([
        loadReceptionOperations({ statusFilter }),
        getLocations()
    ]);
    
    if (opsResult.success && opsResult.data) {
        setOperations(opsResult.data.operations);
    } else {
        toast({
            variant: 'destructive',
            title: 'Error',
            description: opsResult.error || 'No se pudieron cargar las operaciones de recepción.'
        });
        setOperations([]);
    }

    if (locResult.success && locResult.data) {
        setAllLocations(locResult.data);
    } else {
        toast({
            variant: 'destructive',
            title: 'Error',
            description: locResult.error || 'No se pudieron cargar las ubicaciones.'
        });
        setAllLocations([]);
    }
    setLoading(false);
  }, [toast, activeTab]);
  
  
  useEffect(() => {
    if (view === 'operations_list') {
        fetchOperations();
    }
  }, [fetchOperations, view, activeTab]);
  
  const handleSort = (column: keyof ReceptionOperation) => {
    const newSortOrder = sortBy === column && sortOrder === 'asc' ? 'desc' : 'asc';
    setSortBy(column);
    setSortOrder(newSortOrder);
    setCurrentPage(1);
  };

  const filteredAndSortedOperations = useMemo(() => {
    let sortedOps = [...operations];

    // Client-side search
    if (searchTerm) {
        const lowercasedSearch = searchTerm.toLowerCase();
        sortedOps = sortedOps.filter(op => 
            op.rk_identifier.toLowerCase().includes(lowercasedSearch) ||
            op.supplier.toLowerCase().includes(lowercasedSearch) ||
            op.nombre_rk?.toLowerCase().includes(lowercasedSearch)
        );
    }

    // Client-side sorting
    sortedOps.sort((a, b) => {
        const aValue = a[sortBy] ?? '';
        const bValue = b[sortBy] ?? '';
        if (aValue < bValue) return sortOrder === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortOrder === 'asc' ? 1 : -1;
        return 0;
    });

    return sortedOps;
  }, [operations, searchTerm, sortBy, sortOrder]);
  
  const totalPages = Math.ceil(filteredAndSortedOperations.length / itemsPerPage);
  const paginatedOperations = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredAndSortedOperations.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredAndSortedOperations, currentPage, itemsPerPage]);

  const handlePageChange = (newPage: number) => {
    if (newPage > 0 && newPage <= totalPages) {
        setCurrentPage(newPage);
    }
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    setCurrentPage(1); // Reset to first page on new search
  };
  
  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      setIsUploading(true);
      setPreviewData(null);
      setUploadedFileContent(null);
      try {
          const reader = new FileReader();
          reader.onload = async (e) => {
              const content = e.target?.result;
              if (content) {
                  setUploadedFileContent(content as string); // Guardar contenido para procesamiento final
                  const result = await bulkUploadReceptionDataFromExcel(content as string, user?.uid || '', true); // modo preview
                  if (result.success && result.previewData) {
                      setPreviewData(result.previewData);
                      toast({ title: 'Previsualización Lista', description: 'El archivo se ha cargado para su revisión. Confirme para procesar.' });
                  } else {
                      const description = result.error || 'Ocurrió un error desconocido durante la previsualización.';
                      toast({ variant: 'destructive', title: 'Error en Previsualización', description: description, duration: 10000 });
                  }
              } else {
                  toast({ variant: 'destructive', title: 'Error de Lectura', description: 'El contenido del archivo no pudo ser leído como texto.' });
              }
              setIsUploading(false);
          };
          reader.onerror = () => {
              toast({ variant: 'destructive', title: 'Error de Lectura', description: 'No se pudo leer el archivo.' });
              setIsUploading(false);
          };
          reader.readAsBinaryString(file);
      } catch (error: any) {
          toast({ variant: 'destructive', title: 'Error', description: error.message });
          setIsUploading(false);
      } finally {
          if (fileInputRef.current) {
              fileInputRef.current.value = '';
          }
      }
  };

  const handleConfirmProcess = async () => {
    if (!uploadedFileContent || !user?.uid) {
        toast({ variant: 'destructive', title: 'Error', description: 'No hay datos de archivo para procesar.' });
        return;
    }
    setIsUploading(true);
    try {
        const result = await bulkUploadReceptionDataFromExcel(uploadedFileContent, user.uid, false); // modo procesamiento final
        if (result.success) {
            toast({
                title: 'Carga Masiva Exitosa',
                description: `Se procesaron ${result.summary?.operations ?? 0} operaciones.`
            });
            fetchOperations(); // Refresh data
            setPreviewData(null); // Clear preview
            setUploadedFileContent(null);
        } else {
             const description = result.error || 'Ocurrió un error desconocido durante la carga masiva.';
             toast({ variant: 'destructive', title: 'Error en Carga Masiva', description: description, duration: 10000 });
             if (result.errors && result.errors.length > 0) {
                  console.error("Errores detallados de la importación:", result.errors);
             }
        }
    } catch (error: any) {
        toast({ variant: 'destructive', title: 'Error Inesperado', description: error.message });
    } finally {
        setIsUploading(false);
    }
  }

  const handleRowClick = (operation: ReceptionOperation) => {
    setSelectedOperation(operation);
    setView('labeling_prep');
  };

  const handleReturnToOperationsList = () => {
    setView('operations_list');
    setSelectedOperation(null);
    fetchOperations();
  };
  
  if (view === 'labeling_prep' && selectedOperation) {
    return <LabelingPreparationScreen operation={selectedOperation} onReturn={handleReturnToOperationsList} />;
  }

  if (view === 'reference_traceability') {
    return <ReferenceTraceability onReturn={handleReturnToOperationsList} />;
  }
  
  return (
    <div className="space-y-8">
      <Card>
        <CardHeader className="flex flex-col lg:flex-row justify-between lg:items-center gap-4">
          <div>
            <CardTitle>Recepción de Mercancía</CardTitle>
            <CardDescription>Gestione y ejecute las operaciones de recepción de mercancía entrante.</CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
              <Button onClick={onReturnToSuite} variant="outline">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Volver a la Suite
              </Button>
               <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline">
                            <Settings className="mr-2 h-4 w-4"/>
                            Módulos y Reportes
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Módulos de Gestión</DropdownMenuLabel>
                        <DropdownMenuItem onSelect={onNavigateToProductsManagement}><BookUser className="mr-2 h-4 w-4"/> Catálogo de Productos </DropdownMenuItem>
                        {role === 'admin' && (
                          <DropdownMenuItem onSelect={onNavigateToNoveltyManagement}><ClipboardList className="mr-2 h-4 w-4"/> Gestionar Novedades </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onSelect={() => setView('reference_traceability')}><Compass className="mr-2 h-4 w-4"/> Trazabilidad por Referencia </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>Analíticas</DropdownMenuLabel>
                        <DropdownMenuItem onSelect={onNavigateToDashboard}> <BarChartHorizontal className="mr-2 h-4 w-4"/> Ver Dashboard </DropdownMenuItem>
                         <DropdownMenuSeparator />
                        <DropdownMenuLabel>Reportes de Tiempo</DropdownMenuLabel>
                        <DropdownMenuItem onSelect={onNavigateToTimeReports}> <AlarmClockOff className="mr-2 h-4 w-4"/> Ver Pausas y Tiempos Muertos </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row justify-between items-center mb-4 gap-4 flex-wrap">
            <div className="flex w-full md:w-auto gap-4 flex-wrap md:flex-nowrap">
                <Input
                  type="text"
                  placeholder="Buscar por RK, Proveedor o Nombre RK..."
                  value={searchTerm}
                  onChange={handleSearchChange}
                  className="w-full md:w-auto md:max-w-xs"
                />
            </div>
            <div className="flex w-full md:w-auto gap-2">
                <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".xlsx, .xls" />
                <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={isUploading} className="flex-1 md:flex-none">
                    <Upload className="mr-2 h-4 w-4" />
                    Importar
                </Button>
                <CreateReceptionOperationDialog onSave={() => fetchOperations()}>
                  <Button className="flex-1 md:flex-none">
                      <PlusCircle className="mr-2 h-4 w-4" />
                      Nueva Operación
                  </Button>
                </CreateReceptionOperationDialog>
            </div>
          </div>
          
            {previewData && (
                <div className="mt-4 space-y-4">
                    <DataPreviewTable data={previewData} />
                    <div className="flex justify-end gap-2">
                         <Button variant="outline" onClick={() => { setPreviewData(null); setUploadedFileContent(null); }}>Cancelar</Button>
                         <Button onClick={handleConfirmProcess} disabled={isUploading}>
                           {isUploading ? <Loader2 className="animate-spin mr-2"/> : <Send className="mr-2 h-4 w-4"/>}
                           Confirmar y Procesar
                         </Button>
                    </div>
                </div>
            )}

            {!previewData && (
                <>
                <Tabs value={activeTab} onValueChange={(value) => { setActiveTab(value as OperationStatusFilter); setCurrentPage(1); }} className="w-full">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="active">Operaciones Activas</TabsTrigger>
                        <TabsTrigger value="history">Historial de Operaciones</TabsTrigger>
                    </TabsList>
                    <TabsContent value="active" className="mt-4">
                        <h3 className="text-xl font-semibold mb-4">Operaciones Pendientes y En Curso</h3>
                        <ReceptionOperationsTable
                            operations={paginatedOperations}
                            loading={loading}
                            onOperationUpdated={fetchOperations}
                            onStartReading={onStartReading}
                            sortDescriptor={{ column: sortBy, direction: sortOrder }}
                            onSortChange={handleSort}
                            allLocations={allLocations}
                            onRowClick={handleRowClick}
                        />
                    </TabsContent>
                    <TabsContent value="history" className="mt-4">
                        <h3 className="text-xl font-semibold mb-4">Operaciones Completadas y Canceladas</h3>
                        <ReceptionOperationsTable
                            operations={paginatedOperations}
                            loading={loading}
                            onOperationUpdated={fetchOperations}
                            onStartReading={onStartReading}
                            sortDescriptor={{ column: sortBy, direction: sortOrder }}
                            onSortChange={handleSort}
                            allLocations={allLocations}
                            onRowClick={handleRowClick}
                        />
                    </TabsContent>
                </Tabs>
                <div className="flex justify-between items-center mt-4">
                    <div className="flex items-center space-x-2">
                    <span className="text-sm text-muted-foreground">Ítems por página:</span>
                    <Select onValueChange={(val) => { setItemsPerPage(Number(val)); setCurrentPage(1); }} value={String(itemsPerPage)}>
                        <SelectTrigger className="w-[70px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                        <SelectItem value="10">10</SelectItem>
                        <SelectItem value="20">20</SelectItem>
                        <SelectItem value="50">50</SelectItem>
                        </SelectContent>
                    </Select>
                    </div>
                    <Pagination>
                    <PaginationContent>
                        <PaginationItem>
                        <PaginationPrevious onClick={() => handlePageChange(currentPage - 1)}
                            className={cn({
                                "pointer-events-none opacity-50": currentPage === 1 || loading,
                            })} />
                        </PaginationItem>
                        <PaginationItem>
                        <span className="text-sm text-muted-foreground">
                            Página {currentPage} de {totalPages}
                        </span>
                        </PaginationItem>
                        <PaginationItem>
                        <PaginationNext onClick={() => handlePageChange(currentPage + 1)} 
                            className={cn({
                                "pointer-events-none opacity-50": currentPage === totalPages || loading,
                            })} />
                        </PaginationItem>
                    </PaginationContent>
                    </Pagination>
                </div>
                </>
            )}
        </CardContent>
      </Card>
    </div>
  );
};

    
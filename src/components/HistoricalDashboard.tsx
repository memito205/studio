

"use client";

import React, { useState, useMemo } from 'react';
import type { ProcessedReportData, ReportSummary } from '@/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Calendar as CalendarIcon, Download, ChevronsRight, Loader2, Info, Eye } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format, isSameDay } from "date-fns";
import { es } from 'date-fns/locale';
import { exportToXlsx } from '@/services/export';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Badge } from './ui/badge';
import { consolidateDailyReports, previewConsolidatedReport } from '@/app/actions';
import { Dashboard } from './Dashboard';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from './ui/checkbox';


interface HistoricalDashboardProps {
  data: ReportSummary[];
  onReturnToMain: () => void;
  onConsolidate: (snapshotIds: string[]) => Promise<{ success: boolean; error?: string; consolidatedReportId?: string }>;
  theme: 'light' | 'dark';
}

type DailyGroup = {
  date: string;
  consolidated?: ReportSummary;
  snapshots: ReportSummary[];
};

export const HistoricalDashboard: React.FC<HistoricalDashboardProps> = ({ data, onReturnToMain, onConsolidate, theme }) => {
  const { toast } = useToast();
  
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [isConsolidating, setIsConsolidating] = useState(false);
  const [view, setView] = useState<'main' | 'snapshots'>('main');
  const [selectedSnapshots, setSelectedSnapshots] = useState<Set<string>>(new Set());
  
  // State for the preview modal
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewData, setPreviewData] = useState<ProcessedReportData | null>(null);
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);


  const handleExport = () => {
    if (view === 'snapshots' && selectedDate) {
      const snapshotsForDay = dailyGroups.find(g => isSameDay(new Date(g.date + 'T00:00:00'), selectedDate))?.snapshots || [];
      if (snapshotsForDay.length > 0) {
        const dataToExport = snapshotsForDay.map(d => ({
          Fecha_Reporte: d.reportDate ? new Date(d.reportDate).toLocaleDateString('es-CO') : 'N/A',
          Fecha_Snapshot: d.snapshotCreatedAt ? new Date(d.snapshotCreatedAt).toLocaleString('es-CO') : 'N/A',
          Cumplimiento_General: d.overallCompliance.toFixed(2),
          Unidades_Totales: d.totalQuantity,
          Operarios_Activos: d.operatorCount
        }));
        exportToXlsx(dataToExport, `historico_snapshots_${format(new Date(selectedDate), 'yyyy-MM-dd')}`);
      } else {
        toast({ variant: 'destructive', title: "No hay snapshots para exportar." });
      }
    } else {
        toast({ variant: 'destructive', title: "No implementado", description: "La exportación general aún no está disponible." });
    }
  };

  const handleSnapshotSelection = (snapshotId: string) => {
    setSelectedSnapshots(prev => {
        const newSelection = new Set(prev);
        if (newSelection.has(snapshotId)) {
            newSelection.delete(snapshotId);
        } else {
            newSelection.add(snapshotId);
        }
        return newSelection;
    });
  };

  const handleConsolidate = async () => {
    if (selectedSnapshots.size < 2) {
        toast({ variant: 'destructive', title: "Selección insuficiente", description: "Debe seleccionar al menos dos snapshots para consolidar." });
        return;
    }
    const snapshotIds = Array.from(selectedSnapshots);

    setIsConsolidating(true);
    const result = await onConsolidate(snapshotIds);
    if(result.success) {
        toast({ title: 'Éxito', description: `Reporte diario consolidado creado con ID: ${result.consolidatedReportId}` });
        setView('main');
    } else {
        toast({ variant: 'destructive', title: 'Error al Consolidar', description: result.error });
    }
    setIsConsolidating(false);
  };
  
  const handlePreview = async () => {
    if (selectedSnapshots.size < 1) {
      toast({ variant: "destructive", title: "Datos insuficientes", description: "Seleccione al menos un snapshot para generar una previsualización." });
      return;
    }
    const snapshotIds = Array.from(selectedSnapshots);
    
    setIsPreviewing(true);
    const result = await previewConsolidatedReport(snapshotIds);
    if(result.data) {
        setPreviewData(result.data);
        setIsPreviewModalOpen(true);
    } else {
        toast({ variant: 'destructive', title: 'Error al Previsualizar', description: result.error });
    }
    setIsPreviewing(false);
  };

  const dailyGroups = useMemo((): DailyGroup[] => {
    const groups = new Map<string, { consolidated?: ReportSummary; snapshots: ReportSummary[] }>();
    data.forEach(report => {
      const dateKey = new Date(report.reportDate).toISOString().split('T')[0];
      if (!groups.has(dateKey)) {
        groups.set(dateKey, { snapshots: [] });
      }
      const group = groups.get(dateKey)!;
      if (report.isConsolidated) {
        group.consolidated = report;
      } else {
        group.snapshots.push(report);
      }
    });
    return Array.from(groups.entries())
      .map(([date, groupData]) => ({ date, ...groupData }))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [data]);

  const snapshotsForSelectedDay = useMemo(() => {
    if (!selectedDate) return [];
    // Correctly compare dates by ignoring the time part.
    const group = dailyGroups.find(g => isSameDay(new Date(g.date + "T00:00:00"), selectedDate));
    return group ? group.snapshots.sort((a,b) => new Date(b.snapshotCreatedAt).getTime() - new Date(a.snapshotCreatedAt).getTime()) : [];
  }, [selectedDate, dailyGroups]);
  
  const renderMainView = () => (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
            <div>
                <CardTitle>Dashboard Histórico</CardTitle>
                <CardDescription>Análisis de todos los reportes guardados. Haga clic en una fila para ver los snapshots.</CardDescription>
            </div>
            <Button onClick={onReturnToMain} variant="outline"><ArrowLeft className="mr-2 h-4 w-4" /> Volver</Button>
        </div>
      </CardHeader>
      <CardContent>
          <Table>
              <TableHeader>
                  <TableRow>
                      <TableHead>Fecha del Reporte</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Cumplimiento General</TableHead>
                      <TableHead>Operarios</TableHead>
                      <TableHead>Unidades Totales</TableHead>
                  </TableRow>
              </TableHeader>
              <TableBody>
                  {dailyGroups.map(group => {
                      const reportToShow = group.consolidated || group.snapshots[0]; // Show consolidated or first snapshot as representative
                      if (!reportToShow) return null;
                      return (
                      <TableRow key={group.date} className="cursor-pointer" onClick={() => { setSelectedDate(new Date(group.date + 'T00:00:00')); setView('snapshots'); setSelectedSnapshots(new Set()); }}>
                          <TableCell className="font-semibold">{format(new Date(group.date + 'T00:00:00'), 'PPP', { locale: es })}</TableCell>
                          <TableCell>
                            {group.consolidated ? (
                                <Badge variant="default">Consolidado</Badge>
                            ) : (
                                <Badge variant="secondary">{group.snapshots.length} Snapshot(s)</Badge>
                            )}
                          </TableCell>
                          <TableCell>{reportToShow.overallCompliance.toFixed(2)}%</TableCell>
                          <TableCell>{reportToShow.operatorCount}</TableCell>
                          <TableCell>{reportToShow.totalQuantity.toLocaleString()}</TableCell>
                      </TableRow>
                  )})}
              </TableBody>
          </Table>
          {dailyGroups.length === 0 && <p className="text-muted-foreground text-center py-8">No hay reportes históricos para mostrar.</p>}
      </CardContent>
    </Card>
  );

  const renderSnapshotsView = () => (
     <Card>
        <CardHeader>
            <div className="flex justify-between items-center">
                <div>
                    <CardTitle>Snapshots del Día</CardTitle>
                    <CardDescription>Reportes guardados para el día {selectedDate ? format(selectedDate, "PPP", { locale: es }) : ''}.</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                    <Button onClick={() => setView('main')} variant="outline"><ArrowLeft className="mr-2 h-4 w-4" /> Volver al Historial</Button>
                    <Button onClick={handlePreview} disabled={isPreviewing || selectedSnapshots.size < 1}>
                        {isPreviewing ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Eye className="mr-2 h-4 w-4" />}
                        Previsualizar Consolidado
                    </Button>
                    <Button onClick={handleConsolidate} disabled={isConsolidating || selectedSnapshots.size < 2}>
                        {isConsolidating ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
                        Consolidar Reporte del Día
                    </Button>
                </div>
            </div>
        </CardHeader>
        <CardContent>
          {snapshotsForSelectedDay.length > 0 ? (
            <div className="max-h-96 overflow-y-auto">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead className="w-12"></TableHead>
                        <TableHead>Hora del Snapshot</TableHead>
                        <TableHead>Cumplimiento General</TableHead>
                        <TableHead>Operarios</TableHead>
                        <TableHead>Unidades Totales</TableHead>
                        <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {snapshotsForSelectedDay.map((report) => (
                        <TableRow key={report.id} data-state={selectedSnapshots.has(report.id) ? "selected" : undefined}>
                            <TableCell>
                                <Checkbox
                                    checked={selectedSnapshots.has(report.id)}
                                    onCheckedChange={() => handleSnapshotSelection(report.id)}
                                    aria-label={`Seleccionar snapshot ${report.id}`}
                                />
                            </TableCell>
                            <TableCell className="font-semibold">{new Date(report.snapshotCreatedAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</TableCell>
                            <TableCell>{report.overallCompliance.toFixed(2)}%</TableCell>
                            <TableCell>
                               <Badge variant="secondary">{report.operatorCount}</Badge>
                            </TableCell>
                            <TableCell>{report.totalQuantity.toLocaleString()}</TableCell>
                            <TableCell className="text-right">
                                <Button variant="ghost" size="sm" disabled>
                                    Ver Detalle <Info className="ml-2 h-4 w-4" />
                                </Button>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-8">No se encontraron snapshots para el día seleccionado.</p>
          )}
        </CardContent>
      </Card>
  )

  return (
    <div className="space-y-8">
        {view === 'main' ? renderMainView() : renderSnapshotsView()}

        <Dialog open={isPreviewModalOpen} onOpenChange={setIsPreviewModalOpen}>
            <DialogContent className="max-w-7xl h-[95vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Previsualización de Reporte Consolidado</DialogTitle>
                    <DialogDescription>
                        Esta es una vista temporal de cómo se vería el reporte consolidado para {selectedDate ? format(selectedDate, "PPP", { locale: es }) : ''}. <span className="font-semibold">No se ha guardado nada.</span>
                    </DialogDescription>
                </DialogHeader>
                <div className="flex-grow overflow-y-auto pr-6">
                    {previewData ? (
                        <Dashboard
                            data={previewData}
                            fileName={`previsualizacion-${selectedDate ? format(new Date(selectedDate), "yyyy-MM-dd") : ''}`}
                            onReset={() => {}}
                            onReturnToSuite={() => setIsPreviewModalOpen(false)}
                            onGoToConfiguration={() => {}}
                            onGoToPlantView={() => {}}
                            onGoToSupervisorView={() => {}}
                            onRequestAIInsight={async () => {}}
                            theme={theme}
                            annotations={{}}
                            onAnnotationChange={() => {}}
                        />
                    ) : (
                        <div className="flex items-center justify-center h-full">
                            <Loader2 className="h-12 w-12 animate-spin text-primary" />
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    </div>
  );
};

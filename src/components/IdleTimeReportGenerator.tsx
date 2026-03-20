

/** @jsxImportSource react */
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, ArrowLeft } from 'lucide-react';
import type { ReceptionOperation } from '@/types';
import { loadReceptionOperations, getIdleTimeReport } from '@/app/reception/actions';
import { showError } from '@/lib/toast';
import IdleTimeDetailsDialog from './IdleTimeDetailsDialog';

interface IdleTimeReportGeneratorProps {
  onReturn: () => void;
}

export const IdleTimeReportGenerator: React.FC<IdleTimeReportGeneratorProps> = ({ onReturn }) => {
  const [operations, setOperations] = useState<ReceptionOperation[]>([]);
  const [selectedOperationId, setSelectedOperationId] = useState<string>('');
  const [loadingOps, setLoadingOps] = useState(true);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [reportData, setReportData] = useState<any>(null);
  const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false);

  useEffect(() => {
    const fetchOps = async () => {
      setLoadingOps(true);
      const result = await loadReceptionOperations({ statusFilter: ['completed', 'in_progress'] });
      if (result.success && result.data) {
        setOperations(result.data.operations);
      } else {
        showError('Error al cargar operaciones', result.error);
      }
      setLoadingOps(false);
    };
    fetchOps();
  }, []);

  const handleGenerateReport = async () => {
    if (!selectedOperationId) {
      showError('Por favor, seleccione una operación.');
      return;
    }
    setGeneratingReport(true);
    setReportData(null);
    const result = await getIdleTimeReport(selectedOperationId);
    if (result.success) {
      setReportData(result.data);
      setIsDetailsDialogOpen(true);
    } else {
      showError('Error al generar el reporte', result.error);
    }
    setGeneratingReport(false);
  };

  return (
    <>
      <div className="space-y-8 max-w-4xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>Generador de Reporte de Tiempos Muertos</CardTitle>
            <CardDescription>
              Seleccione una operación para analizar los tiempos de inactividad entre escaneos de cada operario.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <Select onValueChange={setSelectedOperationId} value={selectedOperationId} disabled={loadingOps}>
                <SelectTrigger className="w-full sm:w-[300px]">
                  <SelectValue placeholder={loadingOps ? "Cargando operaciones..." : "Seleccionar operación..."} />
                </SelectTrigger>
                <SelectContent>
                  {operations.map(op => (
                    <SelectItem key={op.id} value={op.id}>
                      {op.rk_identifier} - {op.supplier}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={handleGenerateReport} disabled={generatingReport || !selectedOperationId}>
                {generatingReport && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Generar Reporte
              </Button>
            </div>
          </CardContent>
        </Card>
        <Button onClick={onReturn} variant="outline">
          <ArrowLeft className="mr-2 h-4 w-4" /> Volver al Menú de Reportes
        </Button>
      </div>
      <IdleTimeDetailsDialog
        open={isDetailsDialogOpen}
        onOpenChange={setIsDetailsDialogOpen}
        report={reportData}
      />
    </>
  );
};


"use client";

import React, { useState, useEffect, useCallback, useRef, ChangeEvent } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { UploadCloud, Loader2, List, FileText, Download, History } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { SampleReference } from '@/types';
import { saveSampleReferences, loadSampleReferences, importSamplePhotoDeliveries, migrateAdidasVerifications } from '@/app/actions';
import { useAuth } from '@/hooks/use-auth-context';
import * as XLSX from 'xlsx';
import { parseFlexibleDate } from '@/lib/parsingUtils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";


const DownloadDeliveriesTemplateButton: React.FC = () => {
    const handleDownload = () => {
        const headers = ["Referencia", "Numero de TF", "Fecha", "Bodega Origen", "Bodega Destino"];
        const exampleData = [
            {
                "Referencia": "AB12345",
                "Numero de TF": "TF-001",
                "Fecha": "2024-07-31",
                "Bodega Origen": "BODEGA PPA",
                "Bodega Destino": "FOTOGRAFIA"
            }
        ];
        
        const worksheet = XLSX.utils.json_to_sheet(exampleData, { header: headers });
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Plantilla Entregas');
        
        const colWidths = headers.map(header => ({
            wch: Math.max(header.length, ...exampleData.map(row => String(row[header as keyof typeof row] || '').length)) + 5
        }));
        worksheet["!cols"] = colWidths;
        
        XLSX.writeFile(workbook, `Plantilla_Entregas_Muestras.xlsx`);
    };

    return (
        <Button onClick={handleDownload} variant="secondary" size="sm" className="mt-2">
            <Download className="mr-2 h-4 w-4" />
            Descargar Plantilla
        </Button>
    );
};

export const AdminDataManagement: React.FC = () => {
  const [references, setReferences] = useState<SampleReference[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isSavingDeliveries, setIsSavingDeliveries] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  
  const listFileInputRef = useRef<HTMLInputElement>(null);
  const deliveriesFileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { user, userName } = useAuth();

  const fetchReferences = useCallback(async () => {
    setIsLoading(true);
    const result = await loadSampleReferences();
    if (result.success && result.data) {
      setReferences(result.data);
    } else {
      toast({ variant: 'destructive', title: 'Error al Cargar', description: result.error });
    }
    setIsLoading(false);
  }, [toast]);

  useEffect(() => {
    fetchReferences();
  }, [fetchReferences]);
  
  const handleMigration = async () => {
    setIsMigrating(true);
    const result = await migrateAdidasVerifications();
    if (result.success) {
        toast({
            title: "Migración Completada",
            description: `Se actualizaron ${result.updatedCount} verificaciones de ADIDAS.`
        });
    } else {
        toast({
            variant: 'destructive',
            title: 'Error en la Migración',
            description: result.error
        });
    }
    setIsMigrating(false);
  };

  const handleListFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const fileContent = await file.text();
      const lines = fileContent.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

      if (lines.length === 0) {
        throw new Error("El archivo está vacío o no contiene referencias válidas.");
      }

      const referencesToSave = lines.map(line => ({
        id: line,
        sourceFile: file.name,
      }));

      const result = await saveSampleReferences(referencesToSave);

      if (result.success) {
        toast({
          title: "Carga Exitosa",
          description: `${result.processedCount} referencias fueron actualizadas o añadidas.`,
        });
        fetchReferences();
      } else {
        throw new Error(result.error);
      }
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error al procesar archivo', description: error.message });
    } finally {
      setIsUploading(false);
      if (listFileInputRef.current) {
        listFileInputRef.current.value = '';
      }
    }
  };
  
  const handleDeliveriesFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsSavingDeliveries(true);
    try {
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const json: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        if (json.length < 2) {
            throw new Error("El archivo de entregas está vacío o no tiene datos.");
        }
        
        const headers = json[0].map((h:any) => String(h).toLowerCase().trim());
        const refIndex = headers.indexOf('referencia');
        const tfIndex = headers.indexOf('numero de tf');
        const dateIndex = headers.indexOf('fecha');
        const sourceIndex = headers.indexOf('bodega origen');
        const destIndex = headers.indexOf('bodega destino');

        if ([refIndex, tfIndex, dateIndex, sourceIndex, destIndex].includes(-1)) {
            throw new Error("El archivo de entregas debe contener las columnas: 'Referencia', 'Numero de TF', 'Fecha', 'Bodega Origen', 'Bodega Destino'");
        }
        
        const deliveriesToSave: {
            reference: string;
            transferNumber: string;
            deliveryDate: string;
            sourceWarehouse: string;
            destinationWarehouse: string;
        }[] = [];
        let invalidRows = 0;
        for (let i = 1; i < json.length; i++) {
            const row = json[i];
            const deliveryDate = parseFlexibleDate(row[dateIndex]);
            if (row[refIndex] && row[tfIndex] && deliveryDate) {
                deliveriesToSave.push({
                    reference: String(row[refIndex]).trim(),
                    transferNumber: String(row[tfIndex]).trim(),
                    deliveryDate: deliveryDate.toISOString(),
                    sourceWarehouse: String(row[sourceIndex] || '').trim(),
                    destinationWarehouse: String(row[destIndex] || '').trim(),
                });
            } else {
                invalidRows += 1;
            }
        }
        
        if (deliveriesToSave.length === 0) {
            throw new Error("No se encontraron registros de entrega válidos en el archivo.");
        }

        const result = await importSamplePhotoDeliveries({
            deliveries: deliveriesToSave,
            invalidRows,
            uploadedById: user?.uid,
            uploadedByName: userName ?? user?.displayName ?? user?.email ?? undefined,
        });

        if (!result.success) {
            throw new Error(result.error || 'No se pudieron guardar las entregas.');
        }

        const parts: string[] = [];
        if (result.added > 0) parts.push(`${result.added} nueva(s)`);
        if (result.updated > 0) parts.push(`${result.updated} actualizada(s)`);
        if (result.unchanged > 0) parts.push(`${result.unchanged} sin cambios`);
        if (result.duplicatesInFile > 0) parts.push(`${result.duplicatesInFile} duplicada(s) en el archivo`);
        if (result.invalidRows > 0) parts.push(`${result.invalidRows} fila(s) invalida(s) omitidas`);

        toast({
            title: 'Recepcion Foto - Entregas registradas',
            description: parts.length > 0 ? parts.join(' · ') : `Procesadas ${result.totalValidRows} fila(s).`,
        });

    } catch (error: any) {
        toast({ variant: 'destructive', title: 'Error al procesar archivo de entregas', description: error.message });
    } finally {
        setIsSavingDeliveries(false);
        if (deliveriesFileInputRef.current) {
            deliveriesFileInputRef.current.value = '';
        }
    }
  };

  return (
    <div className="space-y-8">
      <Card className="border-amber-500/50">
        <CardHeader>
            <CardTitle className="text-amber-600 dark:text-amber-400">Acción de Migración de Datos</CardTitle>
            <CardDescription>
                Ejecute este proceso una única vez para actualizar las verificaciones de ADIDAS guardadas anteriormente y aplicar la nueva lógica de entrega virtual.
            </CardDescription>
        </CardHeader>
        <CardContent>
            <AlertDialog>
                <AlertDialogTrigger asChild>
                    <Button variant="outline" className="border-amber-500/50 text-amber-600 hover:bg-amber-500/10 hover:text-amber-700" disabled={isMigrating}>
                        {isMigrating ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <History className="mr-2 h-4 w-4" />}
                        Ejecutar Migración de ADIDAS
                    </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>¿Está absolutamente seguro?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Esta acción es irreversible. Modificará todas las verificaciones históricas cuyo nombre contenga "AD" o "ADIDAS", actualizando el estado de las referencias que eran "Muestra Nueva Requerida".
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={handleMigration}>Sí, ejecutar migración</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            <p className="text-xs text-muted-foreground mt-2">Esta es una operación de datos. Úsela con precaución y solo una vez.</p>
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        <Card>
            <CardHeader>
                <CardTitle>Actualizar Muestras Listas</CardTitle>
                <CardDescription>Suba un .txt con el listado maestro de referencias que ya tienen foto.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="flex flex-col items-center justify-center p-4 border-2 border-dashed rounded-lg">
                    <UploadCloud className="w-10 h-10 text-muted-foreground" />
                    <input ref={listFileInputRef} type="file" className="hidden" onChange={handleListFileChange} accept=".txt" id="sample-list-upload-admin" />
                    <Button asChild className="mt-3" size="sm">
                        <label htmlFor="sample-list-upload-admin">
                            {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <FileText className="mr-2 h-4 w-4" />}
                            {isUploading ? 'Procesando...' : 'Seleccionar .txt'}
                        </label>
                    </Button>
                </div>
            </CardContent>
        </Card>
        
        <Card>
            <CardHeader>
                <CardTitle>Registrar Entregas a Foto</CardTitle>
                <CardDescription>Excel de entregas a fotografia. Sin duplicar TF + referencia. Recepcion pendiente en Firebase.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="flex flex-col items-center justify-center p-4 border-2 border-dashed rounded-lg">
                    <UploadCloud className="w-10 h-10 text-muted-foreground" />
                     <input ref={deliveriesFileInputRef} type="file" className="hidden" onChange={handleDeliveriesFileChange} accept=".xlsx, .xls" id="deliveries-file-upload-admin" />
                    <Button asChild className="mt-3" size="sm">
                        <label htmlFor="deliveries-file-upload-admin">
                            {isSavingDeliveries ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <FileText className="mr-2 h-4 w-4" />}
                            {isSavingDeliveries ? 'Guardando...' : 'Seleccionar .xlsx'}
                        </label>
                    </Button>
                    <DownloadDeliveriesTemplateButton />
                </div>
            </CardContent>
        </Card>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <List />
            Listado de Referencias en Base de Datos
          </CardTitle>
          <CardDescription>
            Listado de muestras que ya tienen foto.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border rounded-md max-h-[60vh] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-secondary">
                <TableRow>
                  <TableHead>Referencia</TableHead>
                  <TableHead>Última Actualización</TableHead>
                  <TableHead>Archivo Origen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={3} className="h-24 text-center">
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
                    </TableCell>
                  </TableRow>
                ) : references.length > 0 ? (
                  references.map(ref => (
                    <TableRow key={ref.id}>
                      <TableCell className="font-mono font-medium">{ref.id}</TableCell>
                      <TableCell>{format(ref.lastUploaded, "PPP p", { locale: es })}</TableCell>
                      <TableCell className="text-muted-foreground">{ref.sourceFile}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={3} className="h-24 text-center text-muted-foreground">
                      No hay referencias cargadas.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

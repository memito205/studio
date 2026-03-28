
"use client";

import React, { useState, useRef, ChangeEvent, useMemo, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { ArrowLeft, UploadCloud, Loader2, BarChart, Percent, Boxes, AlertTriangle, CheckCircle, Download, Info, Archive } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { useToast } from '@/hooks/use-toast';
import { findCaseInsensitiveKey, parseFlexibleDate } from '@/lib/parsingUtils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { calculateAnalysis } from '@/services/tulasEngine';
import type { TulaRotation, AnalysisResults } from '@/types';
import { StatCard } from './StatCard';
import { ResponsiveContainer, BarChart as RechartsBarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend } from 'recharts';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { exportToXlsx } from '@/services/export';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';


interface TulasDistribucionProps {
  onReturn: () => void;
}

export const TulasDistribucion: React.FC<TulasDistribucionProps> = ({ onReturn }) => {
    const [rotations, setRotations] = useState<TulaRotation[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [stockTulas, setStockTulas] = useState<number>(270);
    const [cicloTulas, setCicloTulas] = useState<number>(15);
    const [analysisResults, setAnalysisResults] = useState<AnalysisResults | null>(null);
    const [previewData, setPreviewData] = useState<TulaRotation[] | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const reportContentRef = useRef<HTMLDivElement>(null);
    const { toast } = useToast();

    const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;

        setIsLoading(true);
        setAnalysisResults(null);
        setRotations([]);
        setPreviewData(null);
        
        const fileReadPromises = Array.from(files).map(file => 
            new Promise<TulaRotation[]>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        const data = e.target?.result;
                        const workbook = XLSX.read(data, { type: 'array' });
                        const sheetName = workbook.SheetNames[0];
                        const worksheet = workbook.Sheets[sheetName];
                        const json: any[] = XLSX.utils.sheet_to_json(worksheet, { raw: true });

                        const parsedData: TulaRotation[] = json.map((row: any, index: number) => {
                            const fechaRaw = row[findCaseInsensitiveKey(row, 'Fecha')!];
                            const fecha = parseFlexibleDate(fechaRaw);
                            const numeroDocumento = row[findCaseInsensitiveKey(row, 'Documento')!];
                            const grupo = row[findCaseInsensitiveKey(row, 'GRUPO')!];
                            const bodegaOrigen = row[findCaseInsensitiveKey(row, 'Bodega ORIGEN')!];
                            const bodegaDestino = row[findCaseInsensitiveKey(row, 'Bodega DESTINO')!];
                            const cantidad = parseInt(row[findCaseInsensitiveKey(row, 'CANT')!]);

                            if (!fecha || !numeroDocumento || !bodegaOrigen || !bodegaDestino || isNaN(cantidad)) {
                                console.warn(`Fila ${index + 2} del archivo ${file.name} omitida por datos faltantes o inválidos.`);
                                return null;
                            }
                            return {
                                fecha,
                                numeroDocumento: String(numeroDocumento),
                                grupo: String(grupo || 'N/A'),
                                bodegaOrigen: String(bodegaOrigen),
                                bodegaDestino: String(bodegaDestino),
                                cantidad: cantidad,
                            };
                        }).filter((r): r is TulaRotation => r !== null);
                        resolve(parsedData);
                    } catch (err) {
                        reject(new Error(`Error al procesar ${file.name}: ${(err as Error).message}`));
                    }
                };
                reader.onerror = () => reject(new Error(`No se pudo leer el archivo ${file.name}.`));
                reader.readAsArrayBuffer(file);
            })
        );
        
        try {
            const allFilesData = await Promise.all(fileReadPromises);
            const allRotations = allFilesData.flat();

            if (allRotations.length === 0) {
                throw new Error("No se encontraron rotaciones válidas en los archivos seleccionados.");
            }
            
            setPreviewData(allRotations);
            toast({ title: "Previsualización Lista", description: `Se han cargado ${allRotations.length} registros para su revisión.` });

        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error al procesar archivos', description: error.message });
        } finally {
            setIsLoading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };
    
    const handleConfirmAnalysis = () => {
        if (!previewData) return;
        setRotations(previewData);
        setPreviewData(null); // Clear preview to show results
    };
    
    const handleCancelPreview = () => {
        setPreviewData(null);
    };

    const handleProcessAndAnalyze = () => {
        if (rotations.length === 0) {
            toast({ variant: 'destructive', title: 'Sin Datos', description: 'Por favor, cargue y confirme un archivo de rotaciones primero.' });
            return;
        }
        setIsLoading(true);
        try {
            const results = calculateAnalysis(rotations, stockTulas, cicloTulas);
            setAnalysisResults(results);
        } catch (error: any) {
             toast({ variant: 'destructive', title: 'Error en Análisis', description: error.message });
             setAnalysisResults(null);
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleExportDetail = () => {
        if (!analysisResults || !analysisResults.dailySimulationLog) {
            toast({ variant: 'destructive', title: 'Sin datos', description: 'No hay detalle de simulación para exportar.' });
            return;
        }
        exportToXlsx(analysisResults.dailySimulationLog, `detalle_simulacion_tulas_${new Date().toISOString().split('T')[0]}`);
    };

    const handleExportPdf = async () => {
        const input = reportContentRef.current;
        if (!input) {
          toast({ variant: 'destructive', title: 'Error', description: 'No se pudo encontrar el contenido para exportar.' });
          return;
        }
        
        setIsExporting(true);
        
        const originalTheme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
        document.documentElement.classList.remove('dark');
        
        await new Promise(resolve => setTimeout(resolve, 200));
    
        try {
            const canvas = await html2canvas(input, {
              scale: 1.5,
              useCORS: true,
              backgroundColor: '#ffffff'
            });
    
            const imgData = canvas.toDataURL('image/jpeg', 0.85);
            const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const margin = 15;
    
            const contentWidth = pdfWidth - margin * 2;
            const imgHeight = (canvas.height * contentWidth) / canvas.width;
            
            let heightLeft = imgHeight;
            let position = margin;
            
            pdf.addImage(imgData, 'JPEG', margin, position, contentWidth, imgHeight);
            heightLeft -= (pdf.internal.pageSize.getHeight() - margin * 2);
            
            while (heightLeft > 0) {
                position = -heightLeft - margin;
                pdf.addPage();
                pdf.addImage(imgData, 'JPEG', margin, position, contentWidth, imgHeight);
                heightLeft -= (pdf.internal.pageSize.getHeight() - margin * 2);
            }
        
            pdf.save(`Analisis_Tulas_${new Date().toISOString().split('T')[0]}.pdf`);
            toast({ title: "Éxito", description: "El reporte en PDF ha sido generado." });

        } catch (error: any) {
            console.error('Error al generar PDF:', error);
            toast({
                variant: 'destructive',
                title: 'Error al Generar PDF',
                description: 'Ocurrió un problema al crear el documento.',
            });
        } finally {
            if (originalTheme === 'dark') {
              document.documentElement.classList.add('dark');
            }
            setIsExporting(false);
        }
    };


  return (
    <div className="space-y-8">
      <Card>
        <CardHeader className="flex flex-row justify-between items-center">
          <div>
            <CardTitle>Análisis de Rotación de Tulas</CardTitle>
            <CardDescription>
              Analice el movimiento de mercancía para optimizar el stock y la distribución de tulas.
            </CardDescription>
          </div>
          <div className="flex gap-2 print-hide">
            {analysisResults && (
                <Button onClick={handleExportPdf} variant="outline" disabled={isExporting}>
                    {isExporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Download className="mr-2 h-4 w-4" />}
                    Exportar PDF
                </Button>
            )}
            <Button onClick={onReturn} variant="outline">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Volver
            </Button>
          </div>
        </CardHeader>
      </Card>
      
      <Card className="print-hide">
          <CardHeader>
              <CardTitle>Paso 1: Cargar Datos y Configurar Parámetros</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
              <div className="flex flex-col items-center justify-center p-4 border-2 border-dashed rounded-lg">
                  <UploadCloud className="w-10 h-10 text-muted-foreground" />
                  <input 
                    ref={fileInputRef} 
                    type="file" 
                    className="hidden" 
                    onChange={handleFileChange} 
                    accept=".xlsx, .xls" 
                    id="tulas-upload"
                    multiple
                    // @ts-ignore
                    webkitdirectory="true"
                    directory="true"
                  />
                  <Button asChild className="mt-3" size="sm">
                      <label htmlFor="tulas-upload">
                          {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
                          {isLoading ? 'Procesando...' : 'Cargar Carpeta de Rotaciones'}
                      </label>
                  </Button>
                  <p className="text-xs text-muted-foreground mt-2">Columnas requeridas: Documento, Fecha, GRUPO, Bodega DESTINO, Bodega ORIGEN, CANT.</p>
              </div>
          </CardContent>
      </Card>

      {previewData && (
        <Card className="print-hide">
            <CardHeader>
                <CardTitle>Previsualización de Datos Cargados</CardTitle>
                <CardDescription>Revise que las fechas y datos sean correctos antes de continuar.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="max-h-96 overflow-y-auto border rounded-md">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Fecha Interpretada</TableHead>
                                <TableHead>Documento</TableHead>
                                <TableHead>Origen</TableHead>
                                <TableHead>Destino</TableHead>
                                <TableHead>Grupo</TableHead>
                                <TableHead className="text-right">Cantidad</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {previewData.slice(0, 50).map((row, index) => (
                                <TableRow key={index}>
                                    <TableCell>{row.fecha ? format(row.fecha, 'dd/MM/yyyy') : 'Fecha Inválida'}</TableCell>
                                    <TableCell>{row.numeroDocumento}</TableCell>
                                    <TableCell>{row.bodegaOrigen}</TableCell>
                                    <TableCell>{row.bodegaDestino}</TableCell>
                                    <TableCell>{row.grupo}</TableCell>
                                    <TableCell className="text-right">{row.cantidad}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
                 <div className="flex justify-end gap-4 mt-4">
                    <Button variant="outline" onClick={handleCancelPreview}>Cancelar</Button>
                    <Button onClick={handleConfirmAnalysis}>Confirmar y Continuar</Button>
                </div>
            </CardContent>
        </Card>
      )}

      {rotations.length > 0 && !previewData && (
          <Card className="print-hide">
              <CardHeader><CardTitle>Paso 2: Configurar Parámetros y Analizar</CardTitle></CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
                    <div className="space-y-2">
                        <Label htmlFor="stock-tulas">Stock Actual de Tulas</Label>
                        <Input id="stock-tulas" type="number" value={stockTulas} onChange={(e) => setStockTulas(parseInt(e.target.value) || 0)} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="ciclo-tulas">Días de Ciclo de Tula (Retorno)</Label>
                        <Input id="ciclo-tulas" type="number" value={cicloTulas} onChange={(e) => setCicloTulas(parseInt(e.target.value) || 0)} />
                    </div>
                </div>
                 <Button onClick={handleProcessAndAnalyze} disabled={isLoading || rotations.length === 0} className="w-full">
                    <BarChart className="mr-2 h-4 w-4"/>
                    {isLoading ? 'Analizando...' : 'Volver a Analizar con Nuevos Parámetros'}
                </Button>
              </CardContent>
          </Card>
      )}

      {isLoading && <div className="flex justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>}

      <div ref={reportContentRef}>
        {analysisResults && (
            <div className="space-y-8">
                <Card>
                    <CardHeader>
                        <CardTitle>Indicadores Clave de Uso de Tulas</CardTitle>
                    </CardHeader>
                    <CardContent className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-6">
                        <StatCard title="Stock Actual de Tulas" value={stockTulas.toLocaleString()} icon={<Archive />} />
                        <StatCard title="Necesidad Máxima de Tulas" value={analysisResults.peakTulasNeeded.toLocaleString()} icon={<Boxes />} />
                        <StatCard 
                            title="Balance de Stock" 
                            value={analysisResults.stockDifference.toLocaleString()} 
                            subtitle={analysisResults.isStockSufficient ? 'Suficiente' : 'Déficit'}
                            icon={analysisResults.isStockSufficient ? <CheckCircle /> : <AlertTriangle />}
                            color={analysisResults.isStockSufficient ? 'text-green-500' : 'text-red-500'}
                        />
                        <StatCard 
                            title="% Rotaciones Pequeñas"
                            value={`${analysisResults.smallRotationsPercentage.toFixed(1)}%`} 
                            icon={<Percent />}
                            color={analysisResults.smallRotationsPercentage > 20 ? 'text-amber-500' : 'text-slate-500'}
                        />
                        <StatCard 
                            title="Necesidad Empaques Pequeños"
                            value={analysisResults.peakSmallPackagesNeeded.toLocaleString()} 
                            icon={<Boxes />}
                            subtitle={`Basado en ciclo de 8 días`}
                        />
                    </CardContent>
                </Card>

                <div className="grid grid-cols-1 gap-8">
                    <Card>
                        <CardHeader className="flex flex-row justify-between items-center">
                            <div>
                                <CardTitle>Tulas en Circulación por Día</CardTitle>
                                <CardDescription>Visualización del número de tulas fuera de la bodega cada día.</CardDescription>
                            </div>
                            <Button onClick={handleExportDetail} variant="outline" size="sm" className="print-hide">
                                <Download className="mr-2 h-4 w-4" /> Exportar Detalle del Cálculo
                            </Button>
                        </CardHeader>
                        <CardContent className="h-[300px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <RechartsBarChart data={analysisResults.dailyCirculationData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#4A5568" />
                                    <XAxis dataKey="date" tickFormatter={(date) => format(new Date(date), "dd MMM", { locale: es })} />
                                    <YAxis />
                                    <RechartsTooltip />
                                    <Legend />
                                    <Bar dataKey="tulasEnCirculacion" name="Tulas en Circulación" fill="#38bdf8" />
                                </RechartsBarChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>
                </div>

                <div className="grid md:grid-cols-2 gap-8">
                    <Card>
                        <CardHeader><CardTitle>Stock Recomendado por Tienda Origen</CardTitle></CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader><TableRow>
                                    <TableHead>Tienda Origen</TableHead>
                                    <TableHead className="text-right">Prom. Viajes/Semana</TableHead>
                                    <TableHead className="text-right">Prom. Viajes/Día</TableHead>
                                    <TableHead className="text-right">
                                        Stock Sugerido
                                        <TooltipProvider>
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <Info className="inline-block ml-1 h-4 w-4 text-muted-foreground cursor-help" />
                                            </TooltipTrigger>
                                            <TooltipContent className="bg-white border-slate-200 shadow-lg rounded-xl p-3 text-slate-900">
                                              <p className="max-w-xs">
                                                (Prom. Viajes/Día × Días de Ciclo) + 20% de seguridad.
                                                <br/>
                                                Es el stock mínimo para operar sin que se agoten las tulas.
                                              </p>
                                            </TooltipContent>
                                          </Tooltip>
                                        </TooltipProvider>
                                    </TableHead>
                                </TableRow></TableHeader>
                                <TableBody>
                                    {analysisResults.stockByStore.map(item => (
                                        <TableRow key={item.store}>
                                            <TableCell>{item.store}</TableCell>
                                            <TableCell className="text-right">{item.weeklyAvg.toFixed(1)}</TableCell>
                                            <TableCell className="text-right">{item.dailyAvg.toFixed(1)}</TableCell>
                                            <TableCell className="text-right font-bold">{item.recommendedStock}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader><CardTitle>Rotaciones Pequeñas por Tienda Origen</CardTitle></CardHeader>
                        <CardContent>
                             <Table>
                                <TableHeader><TableRow><TableHead>Tienda Origen</TableHead><TableHead className="text-right"># Viajes Pequeños</TableHead><TableHead className="text-right">Stock Sugerido (8 días)</TableHead></TableRow></TableHeader>
                                <TableBody>
                                    {analysisResults.smallRotationsByStore.map(item => (
                                        <TableRow key={item.store}><TableCell>{item.store}</TableCell><TableCell className="text-right">{item.rotationCount}</TableCell><TableCell className="text-right font-bold">{item.recommendedStock}</TableCell></TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <Card>
                        <CardHeader><CardTitle>Tendencia de Rotaciones por Semana</CardTitle></CardHeader>
                        <CardContent className="h-[300px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <RechartsBarChart data={analysisResults.rotationsByWeek}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis dataKey="week" tickFormatter={(week) => format(new Date(week), "dd MMM", { locale: es })} />
                                    <YAxis />
                                    <RechartsTooltip />
                                    <Legend />
                                    <Bar dataKey="count" name="Nº de Tulas" fill="#8884d8" />
                                </RechartsBarChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader><CardTitle>Tendencia de Rotaciones por Mes</CardTitle></CardHeader>
                        <CardContent className="h-[300px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <RechartsBarChart data={analysisResults.rotationsByMonth}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis dataKey="month" tickFormatter={(month) => format(new Date(`${month}-02`), "MMM yyyy", { locale: es })} />
                                    <YAxis />
                                    <RechartsTooltip />
                                    <Legend />
                                    <Bar dataKey="count" name="Nº de Tulas" fill="#82ca9d" />
                                </RechartsBarChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>
                </div>
            </div>
        )}
      </div>
    </div>
  );
};

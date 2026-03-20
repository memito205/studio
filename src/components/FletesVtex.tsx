

"use client";

import React, { useState, useCallback, useEffect, useRef, ChangeEvent } from 'react';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { ArrowLeft, UploadCloud, File, Package, CheckCircle, Loader2, FileInput, FileOutput, GitCompareArrows, Download, Filter, Search, Save } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from './ui/card';
import { useToast } from '@/hooks/use-toast';
import type { VtexRate } from '@/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { ScrollArea } from './ui/scroll-area';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { saveVtexRates, getVtexRates } from '@/app/actions';

interface FletesVtexProps {
  onReturn: () => void;
}

const CARRIERS = [
    "99 Minutos", 
    "Logicuartas", 
    "Envia", 
    "Servientrega", 
    "Deprisa", 
    "Mandar y Servir", 
    "Clicoh"
];

const FileUploaderCard: React.FC<{
  title: string;
  icon: React.ReactNode;
  file: File | null;
  onFileChange: (file: File | null) => void;
  isLoading: boolean;
  rateCount?: number;
  disabled: boolean;
}> = ({ title, icon, file, onFileChange, isLoading, rateCount, disabled }) => {
    const inputRef = React.useRef<HTMLInputElement>(null);

    const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            onFileChange(e.target.files[0]);
        }
    };

    const handleDrop = (e: React.DragEvent<HTMLLabelElement>) => {
        e.preventDefault();
        e.stopPropagation();
        if (disabled) return;
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            onFileChange(e.dataTransfer.files[0]);
        }
    };

    const handleDragOver = (e: React.DragEvent<HTMLLabelElement>) => {
        e.preventDefault();
        e.stopPropagation();
    };

    return (
        <Card className={`text-center transition-all duration-300 flex flex-col h-full ${disabled ? 'bg-muted/50' : 'hover:shadow-lg hover:border-primary/50'}`}>
            <CardHeader className="items-center pb-2">
                {icon}
                <CardTitle className="text-lg">{title}</CardTitle>
            </CardHeader>
            <CardContent className="flex-grow flex flex-col items-center justify-center">
                <input
                    ref={inputRef}
                    id={`file-upload-${title.replace(/\s/g, '-')}`}
                    type="file"
                    className="hidden"
                    onChange={handleFileChange}
                    accept=".xlsx,.xls,.csv"
                    disabled={isLoading || disabled}
                />
                {file ? (
                    <div className="space-y-2 text-center">
                        <p className="text-sm font-medium text-green-500 flex items-center justify-center gap-2">
                            <CheckCircle className="h-4 w-4" />
                            Archivo Cargado
                        </p>
                        <p className="text-xs text-muted-foreground truncate max-w-xs">{file.name}</p>
                         {rateCount !== undefined && <p className="text-sm font-bold text-primary">{rateCount.toLocaleString()} tarifas</p>}
                        <Button variant="link" size="sm" onClick={() => onFileChange(null)} disabled={isLoading || disabled}>Cambiar Archivo</Button>
                    </div>
                ) : (
                    <label
                        htmlFor={`file-upload-${title.replace(/\s/g, '-')}`}
                        className={`cursor-pointer text-sm text-muted-foreground p-4 rounded-md w-full h-full flex flex-col items-center justify-center ${disabled ? 'cursor-not-allowed opacity-50' : 'hover:text-primary'}`}
                        onDrop={handleDrop}
                        onDragOver={handleDragOver}
                    >
                         <UploadCloud className="w-8 h-8 mb-2" />
                        {disabled ? 'Seleccione una transportadora' : 'Arrastra o haz clic para subir'}
                    </label>
                )}
            </CardContent>
        </Card>
    );
};

export const FletesVtex: React.FC<FletesVtexProps> = ({ onReturn }) => {
    const { toast } = useToast();
    const [selectedCarrier, setSelectedCarrier] = useState<string>('');
    const [currentRatesFile, setCurrentRatesFile] = useState<File | null>(null);
    const [currentRates, setCurrentRates] = useState<VtexRate[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [filter, setFilter] = useState('');

    const handleFileChange = async (file: File | null) => {
        setCurrentRatesFile(file);
        if (!file) {
            setCurrentRates([]);
            return;
        }
        setIsLoading(true);
        try {
            const data = await file.arrayBuffer();
            const workbook = XLSX.read(data);
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const json: Partial<VtexRate>[] = XLSX.utils.sheet_to_json(worksheet);
            
            const validatedData: VtexRate[] = json.map((row, index) => {
                if (!row.ZipCodeStart || !row.ZipCodeEnd || !row.WeightStart || !row.WeightEnd || row.AbsoluteMoneyCost === undefined || !row.TimeCost) {
                    console.warn(`Fila ${index + 2} omitida por falta de datos requeridos.`);
                    return null;
                }
                return {
                    ...row,
                    AbsoluteMoneyCost: Number(row.AbsoluteMoneyCost) || 0,
                    PricePercent: Number(row.PricePercent) || 0,
                    PriceByExtraWeight: Number(row.PriceByExtraWeight) || 0,
                    MaxVolume: Number(row.MaxVolume) || 0,
                    MinimumValueInsurance: Number(row.MinimumValueInsurance) || 0,
                } as VtexRate;
            }).filter((row): row is VtexRate => row !== null);

            setCurrentRates(validatedData);
            toast({ title: "Archivo cargado", description: `Se han cargado ${validatedData.length} tarifas para ${selectedCarrier}.` });
        } catch (error) {
            console.error(error);
            toast({ variant: "destructive", title: "Error al leer el archivo", description: "Asegúrate que sea un archivo de Excel válido."});
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleCarrierChange = useCallback(async (carrier: string) => {
        setSelectedCarrier(carrier);
        setCurrentRatesFile(null);
        setCurrentRates([]);
        setFilter('');
        
        if (!carrier) return;

        setIsLoading(true);
        const result = await getVtexRates(carrier);
        if (result.success && result.data && result.data.length > 0) {
            setCurrentRates(result.data);
            toast({ title: "Tarifas cargadas", description: `Se cargaron ${result.data.length} tarifas desde la nube para ${carrier}.` });
        } else if (result.error) {
            toast({ variant: "destructive", title: "Error al cargar desde la nube", description: result.error });
        }
        setIsLoading(false);
    }, [toast]);

    const filteredRates = useMemo(() => {
        if (!filter) return currentRates;
        const lowercasedFilter = filter.toLowerCase();
        return currentRates.filter(rate => 
            String(rate.ZipCodeStart).toLowerCase().includes(lowercasedFilter) ||
            rate.PolygonName?.toLowerCase().includes(lowercasedFilter)
        );
    }, [currentRates, filter]);

    const handleSaveToCloud = async () => {
        if (!selectedCarrier || currentRates.length === 0) {
            toast({ variant: "destructive", title: "Error", description: "No hay tarifas para guardar." });
            return;
        }
        setIsSaving(true);
        const result = await saveVtexRates(selectedCarrier, currentRates);
        if (result.success) {
            toast({ title: "Éxito", description: "Las tarifas se han guardado en la nube." });
        } else {
            toast({ variant: "destructive", title: "Error al Guardar", description: result.error });
        }
        setIsSaving(false);
    };

    const handleGenerate = () => {
        toast({
            title: "En construcción",
            description: "La lógica para procesar y generar el archivo VTEX se implementará en el siguiente paso.",
        });
    };

    return (
    <div className="space-y-8">
      <Card>
        <CardHeader className="flex flex-row justify-between items-center">
          <div>
            <CardTitle>Módulo de Fletes VTEX</CardTitle>
            <CardDescription>
              Cargue, filtre, edite y genere el archivo consolidado de tarifas para VTEX.
            </CardDescription>
          </div>
          <Button onClick={onReturn} variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver
          </Button>
        </CardHeader>
      </Card>
      
      <Card>
          <CardHeader>
              <CardTitle>Paso 1: Seleccionar Transportadora y Cargar Tarifas</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
               <div className="space-y-4">
                  <label htmlFor="carrier-select" className="font-semibold">Seleccionar Transportadora</label>
                  <Select value={selectedCarrier} onValueChange={handleCarrierChange}>
                      <SelectTrigger id="carrier-select">
                          <SelectValue placeholder="Elija una transportadora..." />
                      </SelectTrigger>
                      <SelectContent>
                          {CARRIERS.map(carrier => (
                              <SelectItem key={carrier} value={carrier}>{carrier}</SelectItem>
                          ))}
                      </SelectContent>
                  </Select>
               </div>
               <FileUploaderCard
                title="Cargar Archivo de Tarifas"
                icon={<FileInput className="w-10 h-10 text-primary" />}
                file={currentRatesFile}
                onFileChange={handleFileChange}
                isLoading={isLoading}
                rateCount={currentRates.length}
                disabled={!selectedCarrier}
            />
          </CardContent>
      </Card>

      <Card>
          <CardHeader>
              <CardTitle>Paso 2: Visualización y Edición de Tarifas</CardTitle>
              <CardDescription>Filtre para encontrar las tarifas que desea editar, luego genere el archivo final.</CardDescription>
          </CardHeader>
          <CardContent>
              {isLoading ? (
                <div className="flex justify-center items-center h-64">
                    <Loader2 className="h-8 w-8 animate-spin" />
                    <p className="ml-4 text-muted-foreground">Cargando tarifas...</p>
                </div>
              ) : currentRates.length > 0 ? (
                  <div className="space-y-4">
                      <div className="flex items-center gap-2">
                          <Search className="w-5 h-5 text-muted-foreground" />
                          <Input 
                              placeholder="Filtrar por Código Postal o Polígono..."
                              value={filter}
                              onChange={e => setFilter(e.target.value)}
                          />
                      </div>
                      <ScrollArea className="h-[60vh] border rounded-md">
                          <Table>
                              <TableHeader className="sticky top-0 bg-secondary">
                                  <TableRow>
                                      <TableHead>ZipCodeStart</TableHead>
                                      <TableHead>ZipCodeEnd</TableHead>
                                      <TableHead>PolygonName</TableHead>
                                      <TableHead className="text-right">Abs. Money Cost</TableHead>
                                      <TableHead>TimeCost</TableHead>
                                  </TableRow>
                              </TableHeader>
                              <TableBody>
                                  {filteredRates.map((rate, index) => (
                                      <TableRow key={index}>
                                          <TableCell>{rate.ZipCodeStart}</TableCell>
                                          <TableCell>{rate.ZipCodeEnd}</TableCell>
                                          <TableCell>{rate.PolygonName}</TableCell>
                                          <TableCell className="text-right font-medium">${rate.AbsoluteMoneyCost.toLocaleString('es-CO')}</TableCell>
                                          <TableCell>{rate.TimeCost}</TableCell>
                                      </TableRow>
                                  ))}
                              </TableBody>
                          </Table>
                      </ScrollArea>
                  </div>
              ) : (
                  <div className="text-center py-16 text-muted-foreground">
                      <p>Seleccione una transportadora y cargue un archivo de tarifas para comenzar.</p>
                  </div>
              )}
          </CardContent>
      </Card>
       
       <Card>
        <CardHeader>
            <CardTitle>Paso 3: Acciones Finales</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row gap-4">
             <Button onClick={handleSaveToCloud} disabled={isSaving || currentRates.length === 0} className="flex-1">
                 {isSaving ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Save className="mr-2 h-5 w-5" />}
                 Guardar Cambios en la Nube
            </Button>
            <Button onClick={handleGenerate} disabled={currentRates.length === 0 || isLoading} className="flex-1">
                 {isLoading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Download className="mr-2 h-5 w-5" />}
                 Generar Archivo VTEX Final
            </Button>
        </CardContent>
       </Card>
    </div>
  );
};

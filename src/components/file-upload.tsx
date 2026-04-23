
"use client";
import React from 'react';
import * as XLSX from 'xlsx';
import { UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Loader2 } from 'lucide-react';

import { ManualOperatorMappings } from '@/types';
import { OperatorMappingsManager } from './OperatorMappingsManager';

interface FileUploadProps {
  onProcessFile: (data: any[], fileName: string) => void;
  isLoading: boolean;
  onGoToHistorical: () => void;
  onReturnToSuite: () => void;
  reportDate: string;
  onDateChange: (date: string) => void;
  manualOperatorMappings: ManualOperatorMappings;
  onManualOperatorMappingChange: (mappings: ManualOperatorMappings) => void;
}

export const FileUpload: React.FC<FileUploadProps> = ({ 
  onProcessFile, 
  isLoading, 
  onGoToHistorical, 
  onReturnToSuite, 
  reportDate, 
  onDateChange,
  manualOperatorMappings,
  onManualOperatorMappingChange
}) => {
  const [dragActive, setDragActive] = React.useState(false);

  const handleFile = React.useCallback((file: File | null) => {
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const data = e.target?.result;
        if (data) {
          const workbook = XLSX.read(data, { type: 'binary', cellDates: true });
          const sheetName = workbook.SheetNames[0];
          const sheet = workbook.Sheets[sheetName];
          const json = XLSX.utils.sheet_to_json(sheet);
          onProcessFile(json, file.name);
        }
      };
      reader.readAsBinaryString(file);
    }
  }, [onProcessFile]);

  const handleDrag = React.useCallback((e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = React.useCallback((e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  }, [handleFile]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  return (
    <div className="max-w-4xl mx-auto text-center">
        <Card className="bg-card/80 backdrop-blur-sm">
            <CardHeader>
                <div className="flex justify-between items-start">
                    <div className="text-left">
                        <CardTitle className="text-3xl font-bold">Inteligencia Operativa para Empaque</CardTitle>
                        <CardDescription className="text-muted-foreground mt-2 max-w-2xl">
                            Transforme sus datos de remisión en inteligencia accionable. 
                            <span className="block mt-1 font-semibold text-amber-600 uppercase tracking-tight">
                                Paso 1: Confirme la fecha del reporte antes de cargar el archivo.
                            </span>
                        </CardDescription>
                    </div>
                    <div className="flex gap-2">
                        <Button onClick={onGoToHistorical}>
                            Dashboard Histórico
                        </Button>
                        <Button variant="outline" onClick={onReturnToSuite}>
                            Volver a la Suite
                        </Button>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <div className={`mb-6 max-w-sm mx-auto p-4 border-2 rounded-lg bg-background shadow-xl transition-all ${!reportDate ? 'border-amber-500 animate-pulse' : 'border-primary shadow-primary/20 scale-105'}`}>
                    <label htmlFor="main-report-date" className="block text-sm font-black text-foreground mb-2 text-center uppercase tracking-widest">
                        📅 Confirme Fecha de Operación:
                    </label>
                    <input 
                        type="date" 
                        id="main-report-date"
                        value={reportDate}
                        onChange={(e) => onDateChange(e.target.value)}
                        className="w-full p-3 border-2 border-primary/30 rounded-md text-2xl text-center font-black focus:ring-4 focus:ring-primary/50 outline-none bg-primary/5 text-primary"
                    />
                    {!reportDate && <p className="text-xs text-amber-600 font-bold mt-2 animate-bounce">⚠️ REQUERIDO ANTES DE CARGAR</p>}
                </div>

                <form id="form-file-upload" className="mt-2" onSubmit={(e) => e.preventDefault()}>
                <input type="file" id="input-file-upload" className="hidden" onChange={handleChange} accept=".xlsx, .xls, .csv" />
                <label
                    htmlFor={reportDate ? "input-file-upload" : "no-date-overlay"}
                    onDragEnter={reportDate ? handleDrag : undefined}
                    onDragLeave={reportDate ? handleDrag : undefined}
                    onDragOver={reportDate ? handleDrag : undefined}
                    onDrop={reportDate ? handleDrop : undefined}
                    onClick={(e) => {
                        if (!reportDate) {
                            e.preventDefault();
                            alert("Por favor, seleccione primero la fecha de la operación arriba.");
                        }
                    }}
                    className={`relative flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-xl transition-all duration-300 ${
                    !reportDate ? 'border-muted bg-muted/20 cursor-not-allowed opacity-50' :
                    dragActive ? 'border-primary bg-primary/10' : 'border-border bg-background/50 hover:border-primary/50 cursor-pointer'
                    }`}
                >
                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                    <UploadCloud className={`w-16 h-16 mb-4 ${!reportDate ? 'text-muted' : 'text-muted-foreground'}`} />
                    <p className="mb-2 text-sm text-muted-foreground text-center">
                        {!reportDate ? (
                            <span className="font-bold text-amber-600 block px-4 py-2 bg-amber-100 rounded">DEBE SELECCIONAR LA FECHA ARRIBA PRIMERO</span>
                        ) : (
                            <>
                                <span className="font-semibold text-primary">Haga clic para cargar</span> o arrastre y suelte el archivo
                            </>
                        )}
                    </p>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">
                        {reportDate ? "XLSX, XLS, o CSV" : "Bloqueado hasta elegir fecha"}
                    </p>
                    </div>
                </label>
                </form>
            </CardContent>
        </Card>

       {isLoading && (
        <div className="mt-8 flex items-center justify-center">
          <Loader2 className="animate-spin h-12 w-12 text-primary" />
          <p className="ml-4 text-muted-foreground text-lg">Procesando archivo...</p>
        </div>
      )}

      <div className="mt-12">
          <OperatorMappingsManager 
              initialMappings={manualOperatorMappings} 
              onMappingsUpdated={onManualOperatorMappingChange} 
          />
      </div>
    </div>
  );
};



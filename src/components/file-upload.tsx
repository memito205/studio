
"use client";
import React from 'react';
import * as XLSX from 'xlsx';
import { UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Loader2 } from 'lucide-react';

interface FileUploadProps {
  onProcessFile: (data: any[], fileName: string) => void;
  isLoading: boolean;
  onGoToHistorical: () => void;
  onReturnToSuite: () => void;
  reportDate: string;
  onDateChange: (date: string) => void;
}

export const FileUpload: React.FC<FileUploadProps> = ({ onProcessFile, isLoading, onGoToHistorical, onReturnToSuite, reportDate, onDateChange }) => {
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
                <div className="mb-6 max-w-sm mx-auto p-4 border rounded-lg bg-background shadow-inner">
                    <label htmlFor="main-report-date" className="block text-sm font-bold text-foreground mb-2 text-center uppercase">
                        Fecha de la Operación (Reporte):
                    </label>
                    <input 
                        type="date" 
                        id="main-report-date"
                        value={reportDate}
                        onChange={(e) => onDateChange(e.target.value)}
                        className="w-full p-2 border rounded-md text-lg text-center font-semibold focus:ring-2 focus:ring-primary outline-none"
                    />
                </div>

                <form id="form-file-upload" className="mt-2" onSubmit={(e) => e.preventDefault()}>
                <input type="file" id="input-file-upload" className="hidden" onChange={handleChange} accept=".xlsx, .xls, .csv" />
                <label
                    htmlFor="input-file-upload"
                    onDragEnter={handleDrag}
                    onDragLeave={handleDrag}
                    onDragOver={handleDrag}
                    onDrop={handleDrop}
                    className={`relative flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-xl cursor-pointer transition-colors duration-300 ${
                    dragActive ? 'border-primary bg-primary/10' : 'border-border bg-background/50 hover:border-primary/50'
                    }`}
                >
                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                    <UploadCloud className="w-16 h-16 mb-4 text-muted-foreground" />
                    <p className="mb-2 text-sm text-muted-foreground">
                        <span className="font-semibold text-primary">Haga clic para cargar</span> o arrastre y suelte el archivo
                    </p>
                    <p className="text-xs text-muted-foreground">XLSX, XLS, o CSV</p>
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
    </div>
  );
};

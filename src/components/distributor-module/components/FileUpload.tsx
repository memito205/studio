import React, { useState, useRef, useCallback } from 'react';
import { parseExcelFile, validateStockData, validatePlanData } from '../services/parser';
import { UploadIcon, CheckCircleIcon } from './icons';
import type { StockItem, DistributionRule, BoxCurveRule } from '../types';

type FileType = 'stock' | 'plan';

interface FileUploadProps {
  id: FileType;
  title: string;
  onFileProcessed: (type: FileType, data: StockItem[] | DistributionRule[]) => void;
  onProcessingError: (error: string) => void;
  reset: boolean;
}

const FileUpload: React.FC<FileUploadProps> = ({ id, title, onFileProcessed, onProcessingError, reset }) => {
  const [fileName, setFileName] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (reset) {
        setFileName(null);
        if(inputRef.current) {
            inputRef.current.value = "";
        }
    }
  }, [reset]);

  const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setIsProcessing(true);
    onProcessingError('');

    try {
      if (id === 'stock') {
        const data = await parseExcelFile<StockItem>(file);
        if (!validateStockData(data)) {
            throw new Error('El archivo de existencias no tiene las columnas requeridas (REFERENCIA, NOMBRE, TALLA, CANTD LEIDA).');
        }
        onFileProcessed('stock', data);
      } else if (id === 'plan') {
        const data = await parseExcelFile<DistributionRule>(file);
        if(!validatePlanData(data)){
            throw new Error('El archivo de reparto no tiene las columnas requeridas (REFERENCIA, BODEGA, CANT).');
        }
        onFileProcessed('plan', data);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Error desconocido al procesar el archivo.";
      onProcessingError(`Error en ${title}: ${errorMessage}`);
      setFileName(null);
    } finally {
      setIsProcessing(false);
    }
  }, [id, title, onFileProcessed, onProcessingError]);

  const handleClick = () => {
    inputRef.current?.click();
  };

  return (
    <div className="w-full">
      <h3 className="text-lg font-semibold text-gray-700 mb-2">{title}</h3>
      <div
        onClick={handleClick}
        className={`flex flex-col items-center justify-center w-full p-6 border-2 border-dashed rounded-lg cursor-pointer transition-colors
        ${fileName ? 'border-emerald-400 bg-emerald-50' : 'border-gray-300 hover:border-primary hover:bg-primary/10'}`}
      >
        <input
          type="file"
          ref={inputRef}
          className="hidden"
          onChange={handleFileChange}
          accept=".xlsx, .xls"
          disabled={isProcessing}
        />
        {isProcessing ? (
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        ) : fileName ? (
          <div className="text-center">
            <CheckCircleIcon className="w-12 h-12 text-emerald-500 mx-auto mb-2" />
            <p className="text-sm font-medium text-gray-700">{fileName}</p>
            <p className="text-xs text-gray-500">Archivo cargado correctamente</p>
          </div>
        ) : (
          <div className="text-center text-gray-500">
            <UploadIcon className="w-12 h-12 mx-auto mb-2" />
            <p className="font-semibold">Haz clic para subir archivo</p>
            <p className="text-sm">o arrastra y suelta (.xlsx, .xls)</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default FileUpload;
"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface FileUploadSectionProps {
  onFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  isLoading: boolean; // New prop for loading state
}

const FileUploadSection: React.FC<FileUploadSectionProps> = ({ onFileUpload, isLoading }) => {
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Cargar Archivo Excel</CardTitle>
      </CardHeader>
      <CardContent>
        <input 
          type="file" 
          accept=".xlsx, .xls" 
          onChange={(e) => {
            console.log("Native input onChange fired!"); // Debug log
            onFileUpload(e);
          }} 
          disabled={isLoading} // Disable input when loading
          className="block w-full text-sm text-gray-500
            file:mr-4 file:py-2 file:px-4
            file:rounded-md file:border-0
            file:text-sm file:font-semibold
            file:bg-blue-50 file:text-blue-700
            hover:file:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
        />
        {isLoading && (
          <p className="text-center text-blue-600 mt-2">
            Procesando archivo... Esto puede tardar unos segundos.
          </p>
        )}
        <p className="text-sm text-gray-500 mt-2">
          Por favor, asegúrate de que tu archivo Excel contenga las columnas:
          `# credito`, `punto_de_venta`, `documento`, `valor`, `modalidadpago`, `numCuotas`, `vrAdmon`, `ivaAdmon`, `tasa de interes`, `fecha`.
        </p>
      </CardContent>
    </Card>
  );
};

export default FileUploadSection;

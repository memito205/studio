
"use client";

import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { Dashboard } from '@/components/returns-module/Dashboard';
import { DataPreviewModal } from '@/components/DataPreviewModal';
import { Transaction, RawTransaction, Filters } from '@/types';
import { generateMockData } from '@/services/mockData';
import { processRawData } from '@/services/dataUtils';
import { FileDownIcon } from '@/components/returns-module/icons';
import AuthLayout from '@/components/AuthLayout';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';


declare const html2pdf: any;

export default function ReturnsModulePage() {
  const [processedData, setProcessedData] = useState<Transaction[]>([]);
  const [rawDataForPreview, setRawDataForPreview] = useState<RawTransaction[]>([]);
  const [processedDataForPreview, setProcessedDataForPreview] = useState<Transaction[]>([]);
  const [isProcessing, setIsProcessing] = useState(true);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false); // State to control layout visibility
  const [currentPdfName, setCurrentPdfName] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [fileName, setFileName] = useState('Datos de Muestra');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  
  const dashboardStateRef = useRef<{ year: number; filters: Filters } | null>(null);


  // Load and process mock data on initial render
  useEffect(() => {
    const mockRawData = generateMockData();
    const processed = processRawData(mockRawData);
    setProcessedData(processed);
    setIsProcessing(false);
  }, []);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    
    setIsProcessing(true);
    
    let displayName = '';
    const isDirectoryUpload = files[0].webkitRelativePath;

    if (isDirectoryUpload) {
      const folderName = files[0].webkitRelativePath.split('/')[0];
      displayName = `Carpeta: ${folderName} (${files.length} archivo${files.length > 1 ? 's' : ''})`;
    } else {
      displayName = files[0].name + (files.length > 1 ? ` y ${files.length - 1} más` : '');
    }
    setFileName(displayName);


    try {
      let allRows: RawTransaction[] = [];
      for (const file of Array.from(files)) {
        if(file.name.endsWith('.xlsx')) {
            const data = await file.arrayBuffer();
            const workbook = XLSX.read(data);
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const json = XLSX.utils.sheet_to_json<RawTransaction>(worksheet);
            allRows = allRows.concat(json);
        }
      }
      setRawDataForPreview(allRows);
      const processedPreview = processRawData(allRows);
      setProcessedDataForPreview(processedPreview);
      setShowPreview(true);
    } catch (error) {
      console.error("Error al procesar el archivo XLSX:", error);
      alert("Hubo un error al procesar el archivo. Por favor, asegúrate de que sea un archivo XLSX válido.");
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleConfirmPreview = () => {
    setProcessedData(processedDataForPreview);
    setShowPreview(false);
    setRawDataForPreview([]);
    setProcessedDataForPreview([]);
  };
  
  const handleCancelPreview = () => {
    setShowPreview(false);
    setRawDataForPreview([]);
    setProcessedDataForPreview([]);
  };

  const triggerFileUpload = () => {
    if (fileInputRef.current) {
      fileInputRef.current.removeAttribute('webkitdirectory');
      fileInputRef.current.click();
    }
  };

  const triggerFolderUpload = () => {
    if (fileInputRef.current) {
        fileInputRef.current.setAttribute('webkitdirectory', 'true');
        fileInputRef.current.click();
    }
  };

  const generatePdf = (data: Transaction[], filename: string, year: number) => {
    return new Promise<void>((resolve, reject) => {
        setCurrentPdfName(filename);
        setProcessedData(data); 

        setTimeout(() => {
            const element = document.getElementById('dashboard-for-print');
            if (element) {
                const options = {
                    margin: [0.25, 0.25, 0.25, 0.25], // inches
                    filename: `${filename}.pdf`,
                    image: { type: 'jpeg', quality: 0.85 },
                    html2canvas: { scale: 1.5, useCORS: true, logging: false },
                    jsPDF: { unit: 'in', format: 'letter', orientation: 'landscape' }
                };
                html2pdf().from(element).set(options).save().then(() => {
                    resolve();
                }).catch(reject);
            } else {
                reject(new Error("Print layout element (#dashboard-for-print) not found for PDF export."));
            }
        }, 1500); // Allow time for charts to render in the print layout
    });
  };

  const handleExportPdf = async () => {
      if (!dashboardStateRef.current) {
        alert("Por favor, espera a que el dashboard cargue completamente antes de exportar.");
        return;
      }

      setIsGeneratingPdf(true); // Show spinner overlay
      setIsPrinting(true); // Switch to print layout
      
      // Allow a moment for React to re-render and show the print layout
      await new Promise(resolve => setTimeout(resolve, 100));

      const originalDataState = processedData;
      const originalDashboardState = { ...dashboardStateRef.current };

      try {
          const selectedYear = originalDashboardState.year;
          const previousYear = selectedYear - 1;

          const dataForBothYears = originalDataState.filter(d => 
              d.date.getFullYear() === selectedYear || d.date.getFullYear() === previousYear
          );
          
          const allPdvsForSelectedYear = Array.from(new Set(
            dataForBothYears
                .filter(d => d.date.getFullYear() === selectedYear)
                .map(d => d.pdv)
          ));
          
          const internetAndInstoreGroup = ['Ventas por Internet', 'Canal INSTORE'];
          
          const internetInstoreData = dataForBothYears.filter(d => internetAndInstoreGroup.includes(d.pdv));
          if (internetInstoreData.length > 0) {
              await generatePdf(internetInstoreData, 'Reporte_Internet_y_Tiendas_Propias', selectedYear);
          }
          
          const marketplaces = allPdvsForSelectedYear.filter(p => !internetAndInstoreGroup.includes(p) && p !== 'N/A');
          for (const marketplace of marketplaces) {
              const marketplaceData = dataForBothYears.filter(d => d.pdv === marketplace);
              await generatePdf(marketplaceData, `Reporte_${marketplace.replace(/ /g, '_')}`, selectedYear);
          }

          alert('Exportación a PDF completada.');
      } catch (error) {
          console.error("Failed to generate PDFs:", error);
          alert("Ocurrió un error durante la exportación a PDF.");
      } finally {
          // Restore original state regardless of success or failure
          setProcessedData(originalDataState);
          dashboardStateRef.current = originalDashboardState;
          setCurrentPdfName('');
          setIsPrinting(false); // Switch back to screen layout
          setIsGeneratingPdf(false); // Hide spinner overlay
      }
  };

  // Set dark mode
  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  return (
    <AuthLayout>
      {isGeneratingPdf && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex flex-col items-center justify-center z-50 text-white" aria-live="assertive">
            <h2 className="text-2xl font-bold mb-4">Generando reportes en PDF...</h2>
            <p>Esto puede tardar unos momentos. No cierres la ventana.</p>
            {currentPdfName && <p className="mt-2 text-sm text-slate-300">Generando: {currentPdfName}.pdf</p>}
             <div className="w-16 h-16 border-4 border-dashed rounded-full animate-spin border-indigo-400 mt-4"></div>
        </div>
      )}
      <div className={`min-h-screen bg-slate-100 dark:bg-slate-900 p-4 sm:p-6 lg:p-8 ${isPrinting ? 'invisible' : ''}`}>
        <div className="max-w-7xl mx-auto">
          <header className="mb-8 flex flex-wrap justify-between items-center gap-4">
            <div>
              <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Análisis de Ventas y Devoluciones</h1>
              <p className="text-slate-500 dark:text-slate-400">Mostrando datos de: <span className="font-semibold text-slate-600 dark:text-slate-300">{fileName}</span></p>
               <Button onClick={() => router.push('/')} variant="outline" className="mt-4">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Volver a la Suite
                </Button>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                className="hidden"
                accept=".xlsx, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                multiple
              />
              <button
                onClick={triggerFileUpload}
                disabled={isProcessing || isGeneratingPdf}
                className="bg-indigo-600 text-white font-semibold px-5 py-2.5 rounded-lg shadow-md hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                {isProcessing ? 'Procesando...' : 'Cargar Archivos'}
              </button>
               <button
                onClick={triggerFolderUpload}
                disabled={isProcessing || isGeneratingPdf}
                className="bg-sky-600 text-white font-semibold px-5 py-2.5 rounded-lg shadow-md hover:bg-sky-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                {isProcessing ? 'Procesando...' : 'Cargar Carpeta'}
              </button>
              <button
                onClick={handleExportPdf}
                disabled={isProcessing || isGeneratingPdf}
                className="bg-slate-600 text-white font-semibold px-5 py-2.5 rounded-lg shadow-md hover:bg-slate-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                <FileDownIcon className="w-5 h-5"/>
                <span>{isGeneratingPdf ? 'Exportando...' : 'Exportar PDF'}</span>
              </button>
            </div>
          </header>
          <main>
            {isProcessing && processedData.length === 0 ? (
                 <div className="flex items-center justify-center min-h-[50vh] text-slate-800 dark:text-slate-200">
                   <div className="text-2xl font-semibold">Cargando datos del Dashboard...</div>
                 </div>
            ) : (
                <Dashboard 
                    data={processedData} 
                    isPrinting={isPrinting}
                    onStateChange={(state) => {
                      if (!isGeneratingPdf && !isPrinting) {
                        dashboardStateRef.current = state;
                      }
                    }}
                    initialState={dashboardStateRef.current}
                />
            )}
          </main>
        </div>
      </div>
      {showPreview && (
        <DataPreviewModal
          rawData={rawDataForPreview}
          processedData={processedDataForPreview}
          onConfirm={handleConfirmPreview}
          onCancel={handleCancelPreview}
          fileName={fileName}
        />
      )}
    </AuthLayout>
  );
};

    
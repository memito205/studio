
import React, { useState, useCallback } from 'react';
import { parseFiles } from '../services/csvParser';

interface FileUploadStepProps {
  onFolderUpload: (carrierName: string, data: { headers: string[], records: { [key: string]: string }[] }) => void;
  onCancel: () => void;
}

const FileUploadStep: React.FC<FileUploadStepProps> = ({ onFolderUpload, onCancel }) => {
  const [carrierName, setCarrierName] = useState('');
  const [files, setFiles] = useState<FileList | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setFiles(event.target.files);
    setError(null);
  };

  const handleSubmit = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    if (!carrierName || !files || files.length === 0) {
      setError("Por favor, ingrese el nombre de la transportadora y seleccione una carpeta.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const parsedData = await parseFiles(files);
      onFolderUpload(carrierName, parsedData);
    } catch (err: any) {
      setError(err.message || 'Error al procesar los archivos.');
      setIsLoading(false);
    }
  }, [carrierName, files, onFolderUpload]);

  return (
    <div className="max-w-2xl mx-auto bg-white p-8 rounded-xl shadow-lg animate-fade-in">
      <h2 className="text-2xl font-bold mb-6 text-slate-800">Cargar Datos de Transportadora</h2>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="carrierName" className="block text-sm font-medium text-slate-700 mb-1">
            Nombre de la Transportadora
          </label>
          <input
            type="text"
            id="carrierName"
            value={carrierName}
            onChange={(e) => setCarrierName(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            placeholder="Ej: Servientrega, Inter Rapidísimo"
            required
          />
        </div>
        <div>
          <label htmlFor="csvFiles" className="block text-sm font-medium text-slate-700 mb-1">
            Carpeta con Archivos (CSV o Excel)
          </label>
          <input
            type="file"
            id="csvFiles"
            accept=".csv,.xlsx,.xls"
            onChange={handleFileChange}
            // @ts-ignore
            webkitdirectory="" 
            directory=""
            className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            required
          />
           <p className="mt-1 text-xs text-slate-500">Seleccione la carpeta que contiene sus archivos de gastos.</p>
        </div>
        
        {error && <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-md">{error}</div>}

        <div className="flex justify-end space-x-4 pt-4">
            <button
                type="button"
                onClick={onCancel}
                className="px-6 py-2 border border-slate-300 rounded-md text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-500"
            >
                Cancelar
            </button>
            <button
                type="submit"
                disabled={isLoading}
                className="px-6 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-slate-400 disabled:cursor-not-allowed"
            >
                {isLoading ? 'Procesando...' : 'Mapear Columnas'}
            </button>
        </div>
      </form>
    </div>
  );
};

export default FileUploadStep;
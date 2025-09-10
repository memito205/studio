import React, { useCallback, useState } from 'react';
import { UploadIcon } from './icons/UploadIcon';

interface FileUploadProps {
  onFilesUploaded: (files: File[]) => void;
  isLoading: boolean;
  accept?: string; 
  fileTypeDescription?: string; 
  idSuffix: string; // New required prop for unique ID
}

export const FileUpload: React.FC<FileUploadProps> = ({ 
  onFilesUploaded, 
  isLoading, 
  accept = ".txt", 
  fileTypeDescription = "Archivos TXT (consumos mensuales)",
  idSuffix 
}) => {
  const [dragActive, setDragActive] = useState(false);
  const uniqueInputId = `file-upload-${idSuffix}`;

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      onFilesUploaded(Array.from(event.target.files));
    }
  }, [onFilesUploaded]);

  const handleDrop = useCallback((event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      onFilesUploaded(Array.from(event.dataTransfer.files));
    }
  }, [onFilesUploaded]);

  const handleDragActivity = useCallback((event: React.DragEvent<HTMLLabelElement>, type: 'enter' | 'leave' | 'over') => {
    event.preventDefault();
    event.stopPropagation();
    if (type === 'enter' || type === 'over') {
      setDragActive(true);
    } else if (type === 'leave') {
      setDragActive(false);
    }
  }, []);


  return (
    <div className="w-full">
      <label
        htmlFor={uniqueInputId} // Use unique ID
        className={`flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-lg cursor-pointer transition-colors
                    ${dragActive ? 'border-sky-400 bg-slate-700' : 'border-slate-600 hover:border-sky-500 hover:bg-slate-750'}`}
        onDragEnter={(e) => handleDragActivity(e, 'enter')}
        onDragLeave={(e) => handleDragActivity(e, 'leave')}
        onDragOver={(e) => handleDragActivity(e, 'over')}
        onDrop={handleDrop}
      >
        <div className="flex flex-col items-center justify-center pt-5 pb-6">
          <UploadIcon className="w-12 h-12 mb-4 text-sky-400" />
          <p className="mb-2 text-lg text-slate-300">
            <span className="font-semibold">Haz clic para cargar</span> o arrastra y suelta
          </p>
          <p className="text-sm text-slate-400">{fileTypeDescription}</p>
          <p className="text-xs text-slate-500 mt-1">Se pueden seleccionar múltiples archivos si la funcionalidad lo permite (distribución usa solo el primero de un archivo CSV único).</p>
        </div>
        <input
          id={uniqueInputId} // Use unique ID
          type="file"
          multiple={accept === ".txt"} 
          accept={accept}
          className="hidden"
          onChange={handleFileChange}
          disabled={isLoading}
        />
      </label>
      {isLoading && <p className="mt-2 text-sm text-sky-300">Cargando archivos...</p>}
    </div>
  );
};

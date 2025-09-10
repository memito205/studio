
"use client";

import React, { useState, useCallback, useRef, useEffect } from 'react';
import UploadIcon from './icons/UploadIcon';

interface FileUploadProps {
  onFileSelect: (files: File[]) => void;
  title: string;
  id: string;
  multiple?: boolean;
  allowDirectory?: boolean;
}

const FileUpload: React.FC<FileUploadProps> = ({ onFileSelect, title, id, multiple = false, allowDirectory = false }) => {
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current && allowDirectory) {
      inputRef.current.setAttribute('webkitdirectory', '');
      inputRef.current.setAttribute('directory', '');
    }
  }, [allowDirectory]);

  const handleFiles = useCallback((files: FileList | null) => {
    setError(null);
    if (!files || files.length === 0) {
        return;
    }
    
    const selectedFiles = Array.from(files);
    const validFiles: File[] = [];
    const names: string[] = [];

    for (const file of selectedFiles) {
        const fName = file.name.toLowerCase();
        if (fName.endsWith('.csv') || fName.endsWith('.xlsx') || fName.endsWith('.xls')) {
            validFiles.push(file);
            names.push(file.name);
        } else if (!allowDirectory) {
            setFileNames([]);
            setError(`Archivo no válido: ${file.name}. Solo CSV o Excel.`);
            onFileSelect([]);
            return;
        }
    }
    
    if (validFiles.length === 0 && selectedFiles.length > 0) {
        setFileNames([]);
        setError('No se encontraron archivos CSV o Excel en la selección.');
        onFileSelect([]);
        return;
    }
    
    setFileNames(names);
    onFileSelect(validFiles);

  }, [onFileSelect, allowDirectory]);

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
    }
  };

  const baseClasses = "relative flex flex-col items-center justify-center w-full h-full p-8 border-2 border-dashed rounded-lg cursor-pointer transition-colors duration-200 ease-in-out";
  const idleClasses = "border-slate-600 bg-slate-800 hover:bg-slate-700";
  const draggingClasses = "border-blue-500 bg-blue-900/50";

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`${baseClasses} ${isDragging ? draggingClasses : idleClasses}`}
    >
      <input
        ref={inputRef}
        type="file"
        id={id}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        onChange={onFileChange}
        accept=".csv,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        multiple={multiple || allowDirectory}
      />
      <div className="text-center pointer-events-none">
        <UploadIcon />
        <p className="mt-2 text-lg font-semibold text-gray-300">{title}</p>
        <p className="mt-1 text-sm text-gray-500">
          Arrastra y suelta o <span className="font-semibold text-blue-400">busca {allowDirectory ? 'una carpeta' : 'archivos'}</span>
        </p>
        <p className="mt-1 text-xs text-gray-600">
          Soportado: .csv, .xlsx, .xls
        </p>
        {fileNames.length > 0 && (
          <p className="mt-4 text-sm font-medium text-green-400 bg-green-900/50 px-3 py-1 rounded-md">
            {multiple || allowDirectory ? `${fileNames.length} archivos cargados` : `Archivo: ${fileNames[0]}`}
          </p>
        )}
         {error && (
          <p className="mt-4 text-sm font-medium text-red-400 bg-red-900/50 px-3 py-1 rounded-md">
            {error}
          </p>
        )}
      </div>
    </div>
  );
};

export default FileUpload;

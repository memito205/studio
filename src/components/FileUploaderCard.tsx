
"use client";

import React, { useState, useCallback } from 'react';

interface FileUploaderCardProps {
  title: string;
  icon: React.ReactNode;
  file?: File | null;
  files?: File[];
  setFile?: (file: File | null) => void;
  setFiles?: (files: File[]) => void;
  allowMultiple?: boolean;
}

export const FileUploaderCard: React.FC<FileUploaderCardProps> = ({ 
    title, 
    icon, 
    file, 
    files,
    setFile, 
    setFiles,
    allowMultiple = false 
}) => {
  const [dragActive, setDragActive] = useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      if (allowMultiple && setFiles) {
        setFiles(Array.from(e.dataTransfer.files));
      } else if (setFile) {
        setFile(e.dataTransfer.files[0]);
      }
    }
  }, [allowMultiple, setFile, setFiles]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files) {
      if (allowMultiple && setFiles) {
        setFiles(Array.from(e.target.files));
      } else if (setFile && e.target.files[0]) {
        setFile(e.target.files[0]);
      }
    }
  }, [allowMultiple, setFile, setFiles]);
  
  const onButtonClick = () => {
    inputRef.current?.click();
  };

  const currentFiles = allowMultiple ? files : (file ? [file] : []);

  return (
    <div 
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
      className={`relative flex flex-col items-center justify-center w-full h-56 p-6 border-2 border-dashed rounded-xl transition-colors duration-300
        ${dragActive ? 'border-sky-400 bg-slate-800/50' : 'border-slate-700 bg-slate-800/20 hover:border-slate-500'}`}
    >
      <input 
        ref={inputRef}
        id={`file-upload-${title}`} 
        type="file" 
        className="hidden" 
        onChange={handleChange} 
        accept=".xlsx,.xls,.csv"
        multiple={allowMultiple}
      />
      {currentFiles && currentFiles.length > 0 ? (
         <div className="text-center">
            {icon}
            <p className="mt-2 font-semibold text-slate-200">
              {currentFiles.length > 1 ? `${currentFiles.length} archivos` : currentFiles[0].name}
            </p>
            <p className="text-xs text-slate-400">
               {currentFiles.length > 1 
                    ? `${(currentFiles.reduce((acc, f) => acc + f.size, 0) / 1024).toFixed(2)} KB total`
                    : `${(currentFiles[0].size / 1024).toFixed(2)} KB`
               }
            </p>
            <button onClick={onButtonClick} className="mt-2 text-sm font-semibold text-sky-400 hover:text-sky-300">
                Cambiar
            </button>
        </div>
      ) : (
        <div className="text-center text-slate-400">
            {icon}
            <h3 className="text-lg font-bold text-slate-200 mt-4">{title}</h3>
            <p className="mt-2 text-sm">
                Arrastra y suelta o{' '}
                <button onClick={onButtonClick} className="font-semibold text-sky-400 hover:text-sky-300">
                    busca archivos
                </button>
            </p>
            <p className="text-xs text-slate-500 mt-2">Soportado: .csv, .xlsx, .xls</p>
        </div>
      )}
    </div>
  );
};

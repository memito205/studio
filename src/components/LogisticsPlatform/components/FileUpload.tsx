
import React, { useCallback, useRef } from 'react';
import { UploadCloudIcon, FileIcon } from './icons';

interface FileUploadProps {
  onFileProcess?: (file: File) => void;
  onFilesProcess?: (files: File[]) => void;
  isLoading: boolean;
  fileName?: string | null;
  fileNames?: string[];
  mainText: string;
  subText: string;
  loadedSubText: string;
  multiple?: boolean;
  directory?: boolean;
  accept?: string;
}

const FileUpload: React.FC<FileUploadProps> = ({ 
  onFileProcess,
  onFilesProcess,
  isLoading, 
  fileName,
  fileNames,
  mainText,
  subText,
  loadedSubText,
  multiple = false,
  directory = false,
  accept,
}) => {
  const [dragging, setDragging] = React.useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSingleFile = useCallback((file: File | null | undefined) => {
    if (!file || file.size === 0) {
        alert('Por favor, sube un archivo válido y no vacío.');
        return;
    }

    const effectiveAccept = accept || ".xlsx, .xls";
    const acceptedTypes = effectiveAccept.split(',').map(t => t.trim().toLowerCase());
    const fileExtension = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`;
    
    if (!acceptedTypes.includes(fileExtension)) {
         alert(`Tipo de archivo no válido. Por favor, sube un archivo de tipo: ${effectiveAccept}`);
         return;
    }
    
    if (onFileProcess) {
        onFileProcess(file);
    }
  }, [onFileProcess, accept]);

  const handleMultipleFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;

    const originalFileCount = files.length;
    const effectiveAccept = accept || ".xlsx, .xls";
    const acceptedTypes = effectiveAccept.split(',').map(t => t.trim().toLowerCase());
    
    const validFiles = Array.from(files).filter(file => {
        if (file.name.startsWith('~$') || file.name.startsWith('.')) {
            return false;
        }
        if (file.size === 0) {
            return false;
        }
        const fileExtension = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`;
        return acceptedTypes.includes(fileExtension);
    });

    if(validFiles.length < originalFileCount){
        const skippedCount = originalFileCount - validFiles.length;
        alert(`Se omitieron ${skippedCount} archivo(s). Solo se procesarán archivos de tipo: ${effectiveAccept}, no vacíos y no ocultos.`);
    }

    if (onFilesProcess) {
      onFilesProcess(validFiles);
    }
  }, [onFilesProcess, accept]);

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (isLoading) return;
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (isLoading) return;
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (isLoading) return;
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (isLoading) return;
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      if (multiple || directory) {
        handleMultipleFiles(files);
      } else {
        handleSingleFile(files[0]);
      }
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      if (multiple || directory) {
        handleMultipleFiles(files);
      } else {
        handleSingleFile(files[0]);
      }
    }
    if (e.target) {
        e.target.value = '';
    }
  };
  
  const handleClick = () => {
    if (!isLoading) {
      fileInputRef.current?.click();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  };

  const hasSingleFile = !multiple && !directory && fileName;
  const hasMultipleFiles = (multiple || directory) && fileNames && fileNames.length > 0;
  
  const inputProps: any = {};
    if (directory) {
      inputProps.webkitdirectory = 'true';
  } else if (multiple) {
      inputProps.multiple = true;
  }

  return (
    <div
      role="button"
      tabIndex={isLoading ? -1 : 0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={`relative block w-full border-2 ${dragging ? 'border-green-500 bg-green-50' : 'border-dashed border-gray-300'} ${isLoading ? 'cursor-not-allowed bg-gray-100 opacity-60' : 'cursor-pointer hover:border-gray-400'} rounded-lg p-12 text-center focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition-colors duration-200`}
      aria-disabled={isLoading}
    >
      <input
        ref={fileInputRef}
        type="file"
        className="sr-only"
        onChange={handleChange}
        accept={directory ? undefined : (accept || ".xlsx, .xls")}
        disabled={isLoading}
        {...inputProps}
      />
      {hasSingleFile ? (
          <div className="flex flex-col items-center text-gray-700 pointer-events-none">
              <FileIcon className="mx-auto h-12 w-12 text-green-600"/>
              <span className="mt-2 block text-sm font-medium">{fileName}</span>
              <span className="mt-1 block text-xs text-gray-500">{loadedSubText}</span>
          </div>
      ) : hasMultipleFiles ? (
           <div className="flex flex-col items-center text-gray-700 pointer-events-none">
              <FileIcon className="mx-auto h-12 w-12 text-green-600"/>
              <span className="mt-2 block text-sm font-medium">{fileNames.length} archivo(s) cargado(s)</span>
              <span className="mt-1 block text-xs text-gray-500 max-w-full px-4 overflow-hidden text-ellipsis whitespace-nowrap" title={fileNames.join(', ')}>{loadedSubText}</span>
          </div>
      ) : (
          <div className="flex flex-col items-center text-gray-700 pointer-events-none">
              <UploadCloudIcon className="mx-auto h-12 w-12 text-gray-400" />
              <span className="mt-2 block text-sm font-semibold">{mainText}</span>
              <span className="block text-sm text-gray-500">{subText}</span>
          </div>
      )}
    </div>
  );
};

export default FileUpload;

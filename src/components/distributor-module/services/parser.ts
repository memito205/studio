import type { StockItem, DistributionRule, BoxCurveRule } from '../types';

import * as XLSX from 'xlsx';

export const parseExcelFile = <T,>(file: File): Promise<T[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event: ProgressEvent<FileReader>) => {
      if (!event.target?.result) {
        return reject(new Error("No se pudo leer el archivo."));
      }
      try {
        const data = new Uint8Array(event.target.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(worksheet) as T[];
        resolve(json);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = (error) => reject(error);
    reader.readAsArrayBuffer(file);
  });
};

export const validateStockData = (data: any[]): data is StockItem[] => {
    if (!data || data.length === 0) return true; // Empty is valid
    const firstRow = data[0];
    return 'REFERENCIA' in firstRow && 'NOMBRE' in firstRow && 'TALLA' in firstRow && 'CANTD LEIDA' in firstRow;
}

export const validatePlanData = (data: any[]): data is DistributionRule[] => {
    if (!data || data.length === 0) return true;
    const firstRow = data[0];
    return 'REFERENCIA' in firstRow && 'BODEGA' in firstRow && 'CANT' in firstRow;
}


import type { ProcessedRow, AllItemsMonthlyData, ItemMonthlyData } from '@/types';
import { COLUMN_MAPPINGS, DOC_TYPES_TO_INCLUDE, MAIN_CONSUMPTION_DOC_TYPES, ADJUSTMENT_DOC_TYPES } from '@/components/bag-distribution/constants';
import { parseRobustNumber } from '@/lib/parsingUtils';


function findColumnIndex(headerItems: string[], possibleNames: string[] | undefined): number {
  if (!possibleNames) return -1;
  for (const name of possibleNames) {
    const index = headerItems.findIndex(h => h.trim().toUpperCase() === name.toUpperCase());
    if (index !== -1) return index;
  }
  return -1;
}

/**
 * Parses a date string specifically from the D/M/YYYY or DD/MM/YYYY format.
 * This is a local utility to avoid conflicts with other module's date formats.
 * @param dateStr The date string from the file.
 * @returns A Date object or null if parsing fails.
 */
function parseCustomDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  const parts = dateStr.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (parts) {
    const day = parseInt(parts[1], 10);
    const month = parseInt(parts[2], 10);
    let year = parseInt(parts[3], 10);

    // Handle 2-digit years
    if (year < 100) {
      year += (year < 70 ? 2000 : 1900);
    }

    if (day > 0 && day <= 31 && month > 0 && month <= 12) {
      // Use UTC to prevent timezone shifts from changing the date
      const date = new Date(Date.UTC(year, month - 1, day));
      if (!isNaN(date.getTime())) {
        return date;
      }
    }
  }
  console.warn(`Could not parse custom date format: "${dateStr}"`);
  return null;
}


export function processSingleFile(fileContent: string): ProcessedRow[] {
  const lines = fileContent.split(/\r?\n/).filter(line => line.trim() !== '');
  if (lines.length < 2) throw new Error("El archivo está vacío o no tiene encabezado y datos suficientes.");

  const headerLine = lines[0];
  let delimiter = '\t'; 
  const commonDelimiters = [',', ';', '\t', '|'];
  let maxCols = 0;

  for (const d of commonDelimiters) {
    const cols = headerLine.split(d).length;
    if (cols > maxCols) {
        maxCols = cols;
        delimiter = d;
    }
  }
  if (maxCols <=1 && headerLine.length > 0) {
     console.warn("Could not reliably detect delimiter, defaulting to tab. Header: ", headerLine)
  }
  
  const headerItems = headerLine.split(delimiter).map(h => h.trim().replace(/^"|"$/g, ''));

  const itemCodeIdx = findColumnIndex(headerItems, COLUMN_MAPPINGS.itemCode);
  const docTypeIdx = findColumnIndex(headerItems, COLUMN_MAPPINGS.docType);
  const quantityIdx = findColumnIndex(headerItems, COLUMN_MAPPINGS.quantity);
  const dateIdx = findColumnIndex(headerItems, COLUMN_MAPPINGS.date);
  const bodegaIdx = findColumnIndex(headerItems, COLUMN_MAPPINGS.bodega); // Nuevo

  if (itemCodeIdx === -1) throw new Error(`No se encontró la columna de código de item (buscando ${COLUMN_MAPPINGS.itemCode.join('/')}). Encabezados encontrados: ${headerItems.join(', ')}`);
  if (docTypeIdx === -1) throw new Error(`No se encontró la columna de tipo de documento (buscando ${COLUMN_MAPPINGS.docType.join('/')}). Encabezados encontrados: ${headerItems.join(', ')}`);
  if (quantityIdx === -1) throw new Error(`No se encontró la columna de cantidad (buscando ${COLUMN_MAPPINGS.quantity.join('/')}). Encabezados encontrados: ${headerItems.join(', ')}`);
  if (dateIdx === -1) throw new Error(`No se encontró la columna de fecha (buscando ${COLUMN_MAPPINGS.date.join('/')}). Encabezados encontrados: ${headerItems.join(', ')}`);
  // Bodega es opcional, no lanzar error si no se encuentra.

  const processedRows: ProcessedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(delimiter).map(v => v.trim().replace(/^"|"$/g, ''));
    if (values.length < Math.max(itemCodeIdx, docTypeIdx, quantityIdx, dateIdx, bodegaIdx ?? -1) + 1) { // Considerar bodegaIdx
        if (values.length < Math.max(itemCodeIdx, docTypeIdx, quantityIdx, dateIdx) + 1) continue;
    }

    const originalDocType = values[docTypeIdx]?.toUpperCase();
    if (!originalDocType || !DOC_TYPES_TO_INCLUDE.includes(originalDocType)) continue;

    const rawItemCode = values[itemCodeIdx];
    // Standardize item code by converting to number to remove leading zeros, then back to string.
    const itemCodeAsNumber = parseInt(rawItemCode, 10);
    if (isNaN(itemCodeAsNumber)) continue; // Skip if item code is not a valid number
    const itemCode = itemCodeAsNumber.toString();
    
    // Use the robust number parsing function
    const quantity = parseRobustNumber(values[quantityIdx] || '0');
    
    const dateStr = values[dateIdx];
    const date = parseCustomDate(dateStr); // Use the new custom date parser
    const bodega = bodegaIdx !== -1 ? values[bodegaIdx] : undefined; // Nuevo

    if (itemCode && !isNaN(quantity) && quantity > 0 && date) {
      processedRows.push({ itemCode, docType: originalDocType, date, quantity, bodega }); // Añadir bodega
    }
  }
  return processedRows;
}

export function aggregateData(allRows: ProcessedRow[]): AllItemsMonthlyData {
  const aggregated: AllItemsMonthlyData = new Map();

  allRows.forEach(row => {
    const year = row.date.getFullYear();
    const month = row.date.getMonth() + 1; // 1-12

    if (!aggregated.has(row.itemCode)) {
      aggregated.set(row.itemCode, []);
    }
    const itemData = aggregated.get(row.itemCode)!;
    
    let monthEntry = itemData.find(d => d.year === year && d.month === month);
    if (!monthEntry) {
      monthEntry = { 
        year, 
        month, 
        mainQuantity: 0, 
        ajsQuantity: 0, 
        totalQuantity: 0, 
        date: new Date(year, month - 1, 1) 
      };
      itemData.push(monthEntry);
    }

    if (MAIN_CONSUMPTION_DOC_TYPES.includes(row.docType)) {
      monthEntry.mainQuantity += row.quantity;
    } else if (ADJUSTMENT_DOC_TYPES.includes(row.docType)) {
      monthEntry.ajsQuantity += row.quantity;
    }
    monthEntry.totalQuantity = monthEntry.mainQuantity + monthEntry.ajsQuantity;

  });

  // Sort monthly data for each item
  aggregated.forEach(itemMonthlyData => {
    itemMonthlyData.sort((a, b) => a.date.getTime() - b.date.getTime());
  });

  return aggregated;
}


"use client";

import { useState, useCallback } from 'react';
import type { CsvRow, ProcessedData } from '../types';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

// Target column names (case-insensitive)
const MINUTOS_GUIDE_COL = 'NUMERO 99';
const SIOP_GUIDE_COL = 'PED_GUIA_TTE';
const SIOP_NAME_COL = 'NOMBRE';
const NEW_RESULT_COL = 'CARGAR A';
const NEW_SIOP_GUIDE_COL = 'GUIA SIOP';

// New columns for negotiated value calculation
const MINUTOS_TIPO_ENVIO_COL = 'Tipo de envio';
const MINUTOS_CIUDAD_ORIGEN_COL = 'CIUDAD ORIGEN';
const MINUTOS_CIUDAD_DESTINO_COL = 'CIUDAD';
const MINUTOS_VTA_CON_NAC_COL = 'vta con nac';
const MINUTOS_NOTES_COL = 'NOTAS DEL ENVIO';
const MINUTOS_ORIGINAL_CLASSIFICATION_COL = 'CLASIFICACION'; // The one from the input file
const NEW_NEGOTIATED_VALUE_COL = 'VALOR A COBRAR NEGOCIADO';
const NEW_DIF_FLETE_COL = 'DIF FLETE';
const NEW_TIMES_BILLED_COL = 'VECES COBRADO';
const NEW_DOUBLE_BILLING_COL = 'COBRO DOBLE';
const NEW_BILLED_INVOICES_COL = 'FACTURAS DONDE SE COBRO';
const NEW_OBSERVATIONS_COL = 'OBSERVACIONES';
const NEW_ACTION_COL = 'ACCION';
const NEW_FINAL_CLASSIFICATION_COL = 'CLASIFICACION FINAL'; // The new one we generate
const NEW_CONTABLE_COL = 'CONTABLE';
const NEW_TIPO_COL = 'TIPO';
const MINUTOS_INVOICE_COL_ALIASES = ['FACTURA', 'NRO FACTURA', 'NO FACTURA', 'NUMERO FACTURA', 'NÚMERO FACTURA'];


// Date columns to format from Excel serial number to readable date
const DATE_COLUMNS_TO_FORMAT = [
    'FECHA TERMINADA',
    'FECHA CREADA',
    'FECHA ASIGNADA',
    'FECHA ESTACION'
];

// Map for negotiated values
const negotiatedValueMap: { [key: string]: number } = {
    'NextDayMED1MED1': 8125,
    'NextDayMDE1MDE1': 8125,
    'NextDayBOG1BOG1': 8125,
    'NextDayBOG1MED1': 15176,
    'NextDayBOG1MDE1': 15176,
    'RetornoMED1MED1': 10590,
    'RetornoMDE1MDE1': 10590,
};


const parseFile = (file: File): Promise<CsvRow[]> => {
    return new Promise((resolve, reject) => {
        const fileExtension = file.name.split('.').pop()?.toLowerCase();

        if (fileExtension === 'csv') {
            Papa.parse(file, {
                header: true,
                skipEmptyLines: true,
                transformHeader: (header: string) => header.trim(),
                complete: (results: { data: CsvRow[], errors: any[] }) => {
                    if (results.errors.length > 0 && results.errors.some(e => e.code !== 'TooFewFields')) {
                        const firstError = results.errors.find(e => e.code !== 'TooFewFields');
                        reject(new Error(`Error al parsear el archivo CSV: ${firstError.message} en la fila ${firstError.row}`));
                        return;
                    }
                    resolve(results.data);
                },
                error: (error: Error) => {
                    reject(error);
                }
            });
        } else if (fileExtension === 'xlsx' || fileExtension === 'xls') {
            const reader = new FileReader();
            reader.onload = (event: ProgressEvent<FileReader>) => {
                try {
                    const data = event.target?.result;
                    const workbook = XLSX.read(data, { type: 'array' });
                    const sheetName = workbook.SheetNames[0];
                    if (!sheetName) {
                        return reject(new Error('El archivo de Excel no contiene hojas.'));
                    }
                    const worksheet = workbook.Sheets[sheetName];
                    const jsonData: { [key: string]: any }[] = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

                    // Ensure headers are trimmed and all values are strings to match CsvRow type
                    const processedData: CsvRow[] = jsonData.map(row => {
                        const newRow: CsvRow = {};
                        for (const key in row) {
                            const trimmedKey = key.trim();
                            newRow[trimmedKey] = String(row[key]);
                        }
                        return newRow;
                    });
                    resolve(processedData);
                } catch (e: any) {
                    reject(new Error(`Error al procesar el archivo Excel: ${e.message}`));
                }
            };
            reader.onerror = () => {
                reject(new Error('No se pudo leer el archivo.'));
            };
            reader.readAsArrayBuffer(file);
        } else {
            reject(new Error('Formato de archivo no soportado. Por favor, sube un archivo CSV o Excel.'));
        }
    });
};

/**
 * Optimized parser to extract only a single column from a CSV or Excel file.
 * This is memory and speed efficient for large historical files.
 * @param file The file to parse.
 * @param columnName The name of the column to extract.
 * @returns A promise that resolves to an array of strings with the column values.
 */
const parseAndExtractColumn = (file: File, columnName: string): Promise<string[]> => {
    return new Promise((resolve, reject) => {
        const fileExtension = file.name.split('.').pop()?.toLowerCase();
        const lowerCaseColumnName = columnName.toLowerCase();

        if (fileExtension === 'csv') {
            const columnValues: string[] = [];
            let columnIndex = -1;

            Papa.parse(file, {
                header: false,
                skipEmptyLines: true,
                step: (results: { data: string[] }, parser: any) => {
                    if (columnIndex === -1) { // First row is the header
                        const headers = results.data.map(h => String(h).trim().toLowerCase());
                        columnIndex = headers.indexOf(lowerCaseColumnName);
                        if (columnIndex === -1) {
                            parser.abort();
                            reject(new Error(`La columna "${columnName}" no se encontró en el archivo CSV "${file.name}".`));
                        }
                    } else {
                        const value = results.data[columnIndex];
                        if (value !== undefined && value !== null && String(value).trim() !== '') {
                            columnValues.push(String(value));
                        }
                    }
                },
                complete: () => {
                    resolve(columnValues);
                },
                error: (error: Error) => {
                    reject(new Error(`Error al leer el CSV ${file.name}: ${error.message}`));
                }
            });

        } else if (fileExtension === 'xlsx' || fileExtension === 'xls') {
            const reader = new FileReader();
            reader.onload = (event: ProgressEvent<FileReader>) => {
                try {
                    const data = event.target?.result;
                    const workbook = XLSX.read(data, { type: 'array', cellNF: false, cellDates: false });
                    const sheetName = workbook.SheetNames[0];
                    if (!sheetName) {
                        return reject(new Error(`El archivo de Excel "${file.name}" no contiene hojas.`));
                    }
                    const worksheet = workbook.Sheets[sheetName];
                    
                    const sheetData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
                    
                    if (sheetData.length === 0) return resolve([]);
                    
                    const headers = sheetData[0].map(h => String(h).trim().toLowerCase());
                    const columnIndex = headers.indexOf(lowerCaseColumnName);

                    if (columnIndex === -1) {
                        return reject(new Error(`La columna "${columnName}" no se encontró en el archivo Excel "${file.name}".`));
                    }
                    
                    const columnValues = sheetData
                        .slice(1)
                        .map(row => row[columnIndex])
                        .filter(value => value !== undefined && value !== null && String(value).trim() !== '')
                        .map(String);
                        
                    resolve(columnValues);
                } catch (e: any) {
                    reject(new Error(`Error al procesar el archivo Excel optimizado "${file.name}": ${e.message}`));
                }
            };
            reader.onerror = () => reject(new Error(`No se pudo leer el archivo "${file.name}".`));
            reader.readAsArrayBuffer(file);
        } else {
            reject(new Error(`Formato de archivo no soportado: ${file.name}.`));
        }
    });
};

/**
 * Optimized parser to extract only specific columns from a CSV or Excel file.
 * @param file The file to parse.
 * @param columnNames An array of column names to extract.
 * @returns A promise that resolves to an array of CsvRow objects, each containing only the requested columns.
 */
const parseAndExtractMultipleColumns = (file: File, columnNames: string[]): Promise<CsvRow[]> => {
    return new Promise((resolve, reject) => {
        const fileExtension = file.name.split('.').pop()?.toLowerCase();
        const lowerCaseColumnNames = columnNames.map(c => c.toLowerCase());

        if (fileExtension === 'csv') {
            const extractedData: CsvRow[] = [];
            let columnMap: { originalHeader: string, index: number }[] = [];
            
            Papa.parse(file, {
                header: false,
                skipEmptyLines: true,
                step: (results: { data: string[] }, parser) => {
                    const rowData = results.data;
                    if (columnMap.length === 0) { // Header row
                        const headers = rowData.map(h => String(h).trim());
                        const lowerCaseHeaders = headers.map(h => h.toLowerCase());

                        for (const colName of lowerCaseColumnNames) {
                            const index = lowerCaseHeaders.indexOf(colName);
                            if (index === -1) {
                                parser.abort();
                                return reject(new Error(`La columna requerida "${colName}" no se encontró en el archivo CSV "${file.name}".`));
                            }
                            columnMap.push({ originalHeader: headers[index], index });
                        }
                    } else {
                        const newRow: CsvRow = {};
                        for (const { originalHeader, index } of columnMap) {
                            newRow[originalHeader] = rowData[index] || '';
                        }
                        extractedData.push(newRow);
                    }
                },
                complete: () => resolve(extractedData),
                error: (error: Error) => reject(new Error(`Error al leer el CSV ${file.name}: ${error.message}`))
            });
        } else if (fileExtension === 'xlsx' || fileExtension === 'xls') {
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const data = event.target?.result;
                    const workbook = XLSX.read(data, { type: 'array' });
                    const sheetName = workbook.SheetNames[0];
                    if (!sheetName) {
                        return reject(new Error(`El archivo de Excel "${file.name}" no contiene hojas.`));
                    }
                    const worksheet = workbook.Sheets[sheetName];
                    const sheetData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });

                    if (sheetData.length === 0) return resolve([]);
                    
                    const headers = sheetData[0].map(h => String(h).trim());
                    const lowerCaseHeaders = headers.map(h => h.toLowerCase());
                    const columnMap: { originalHeader: string, index: number }[] = [];

                    for (const colName of lowerCaseColumnNames) {
                        const index = lowerCaseHeaders.indexOf(colName);
                        if (index === -1) {
                            return reject(new Error(`La columna requerida "${colName}" no se encontró en el archivo Excel "${file.name}".`));
                        }
                        columnMap.push({ originalHeader: headers[index], index });
                    }

                    const extractedData = sheetData.slice(1).map(row => {
                        const newRow: CsvRow = {};
                        for (const { originalHeader, index } of columnMap) {
                            newRow[originalHeader] = String(row[index] || '');
                        }
                        return newRow;
                    });
                    resolve(extractedData);
                } catch (e: any) {
                    reject(new Error(`Error al procesar el archivo Excel optimizado "${file.name}": ${e.message}`));
                }
            };
            reader.onerror = () => reject(new Error(`No se pudo leer el archivo "${file.name}".`));
            reader.readAsArrayBuffer(file);
        } else {
            reject(new Error(`Formato de archivo no soportado: ${file.name}.`));
        }
    });
};


// Helper to find a key in an object case-insensitively
const findCaseInsensitiveKey = (obj: CsvRow | undefined, key: string): string | undefined => {
    if (!obj) return undefined;
    const lowerCaseKey = key.toLowerCase();
    return Object.keys(obj).find(k => k.toLowerCase() === lowerCaseKey);
};

const findFirstCaseInsensitiveKey = (obj: CsvRow | undefined, aliases: string[]): string | undefined => {
    for (const alias of aliases) {
        const match = findCaseInsensitiveKey(obj, alias);
        if (match) return match;
    }
    return undefined;
};

/**
 * Normaliza una guía para comparación de duplicados entre archivos:
 * - trim
 * - sin separadores comunes
 * - mayúsculas
 * - elimina ".0" típico de Excel numérico
 * - si es puramente numérica, elimina ceros a la izquierda
 */
const normalizeGuideId = (value: unknown): string => {
    let guide = String(value ?? '').trim();
    if (!guide) return '';
    guide = guide.replace(/[\s\-_/\\]/g, '').toUpperCase();
    guide = guide.replace(/\.0+$/g, '');
    if (/^\d+$/.test(guide)) {
        guide = guide.replace(/^0+/, '');
    }
    return guide;
};

/**
 * Converts an Excel serial date number to a formatted string 'DD/MM/YYYY HH:mm'.
 * Uses the XLSX library's built-in parser for accuracy.
 * @param serial The Excel serial number (can be string or number).
 * @returns A formatted date string, or the original value if parsing fails.
 */
const formatExcelDate = (serial: string | number): string => {
    const numericSerial = Number(serial);
    // Ignore non-numeric values, zeros or negative numbers, as they are not valid dates.
    if (isNaN(numericSerial) || numericSerial <= 0) {
        return String(serial);
    }

    try {
        const date = XLSX.SSF.parse_date_code(numericSerial);
        
        if (!date) {
            return String(serial);
        }
        
        const day = String(date.d).padStart(2, '0');
        const month = String(date.m).padStart(2, '0');
        const year = date.y;
        const hours = String(date.H).padStart(2, '0');
        const minutes = String(date.M).padStart(2, '0');
        
        if (!isNaN(year) && year > 1899) {
             return `${day}/${month}/${year} ${hours}:${minutes}`;
        }
       return String(serial);
    } catch (e) {
        console.error("Error formatting Excel date:", e);
        return String(serial);
    }
};


export const useFileProcessor = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ProcessedData | null>(null);

  const processFiles = useCallback(async (minutosFile: File | null, siopFile: File | null, historicalFiles: File[]) => {
    setIsLoading(true);
    setError(null);
    setResults(null);
    
    if (!minutosFile || !siopFile) {
        setIsLoading(false);
        return;
    }

    try {
        const siopColumnsToExtract = [SIOP_GUIDE_COL, SIOP_NAME_COL];

        const [minutosData, siopData, ...historicalDataSets] = await Promise.all([
            parseFile(minutosFile),
            parseAndExtractMultipleColumns(siopFile, siopColumnsToExtract),
            ...historicalFiles.map(file => parseFile(file))
        ]);

        const validationErrors: string[] = [];
        
        // Find actual column names (case-insensitive) from main file
        const actualMinutosGuideCol = findCaseInsensitiveKey(minutosData[0], MINUTOS_GUIDE_COL);
        const actualSiopGuideCol = findCaseInsensitiveKey(siopData[0], SIOP_GUIDE_COL);
        const actualSiopNameCol = findCaseInsensitiveKey(siopData[0], SIOP_NAME_COL);
        const actualMinutosTipoEnvioCol = findCaseInsensitiveKey(minutosData[0], MINUTOS_TIPO_ENVIO_COL);
        const actualMinutosCiudadOrigenCol = findCaseInsensitiveKey(minutosData[0], MINUTOS_CIUDAD_ORIGEN_COL);
        const actualMinutosCiudadDestinoCol = findCaseInsensitiveKey(minutosData[0], MINUTOS_CIUDAD_DESTINO_COL);
        const actualMinutosVtaConNacCol = findCaseInsensitiveKey(minutosData[0], MINUTOS_VTA_CON_NAC_COL);
        const actualMinutosNotesCol = findCaseInsensitiveKey(minutosData[0], MINUTOS_NOTES_COL);
        const actualMinutosClassificationCol = findCaseInsensitiveKey(minutosData[0], MINUTOS_ORIGINAL_CLASSIFICATION_COL);
        const actualMinutosInvoiceCol = findFirstCaseInsensitiveKey(minutosData[0], MINUTOS_INVOICE_COL_ALIASES);

        // Validate headers existence in main files
        if (minutosData.length > 0) {
            if (!actualMinutosGuideCol) validationErrors.push(`El archivo de 99 Minutos debe tener la columna "${MINUTOS_GUIDE_COL}".`);
            if (!actualMinutosTipoEnvioCol) validationErrors.push(`El archivo de 99 Minutos debe tener la columna "${MINUTOS_TIPO_ENVIO_COL}".`);
            if (!actualMinutosCiudadOrigenCol) validationErrors.push(`El archivo de 99 Minutos debe tener la columna "${MINUTOS_CIUDAD_ORIGEN_COL}".`);
            if (!actualMinutosCiudadDestinoCol) validationErrors.push(`El archivo de 99 Minutos debe tener la columna "${MINUTOS_CIUDAD_DESTINO_COL}".`);
            if (!actualMinutosVtaConNacCol) validationErrors.push(`El archivo de 99 Minutos debe tener la columna "${MINUTOS_VTA_CON_NAC_COL}".`);
            if (!actualMinutosNotesCol) validationErrors.push(`El archivo de 99 Minutos debe tener la columna "${MINUTOS_NOTES_COL}".`);
            if (!actualMinutosClassificationCol) validationErrors.push(`El archivo de 99 Minutos debe tener la columna "${MINUTOS_ORIGINAL_CLASSIFICATION_COL}" para la lógica de devoluciones.`);
        }
        if (siopData.length > 0) {
            if (!actualSiopGuideCol) validationErrors.push(`El archivo de SIOP debe tener la columna "${SIOP_GUIDE_COL}".`);
            if (!actualSiopNameCol) validationErrors.push(`El archivo de SIOP debe tener la columna "${SIOP_NAME_COL}".`);
        }
        
        if (validationErrors.length > 0) {
            setError(validationErrors.join(' '));
            setIsLoading(false);
            return;
        }
        
        // Create total billing count map and invoice trace map from all files
        const totalGuidesCount = new Map<string, number>();
        const guideInvoiceRefs = new Map<string, Set<string>>();
        if (actualMinutosGuideCol) {
            // Count from current "99 Minutos" file
            for (const row of minutosData) {
                const guide = row[actualMinutosGuideCol];
                if (guide) {
                    const guideStr = normalizeGuideId(guide);
                    if (!guideStr) continue;
                    totalGuidesCount.set(guideStr, (totalGuidesCount.get(guideStr) || 0) + 1);
                    const invoiceRaw = actualMinutosInvoiceCol ? String(row[actualMinutosInvoiceCol] || '').trim() : '';
                    if (invoiceRaw) {
                        if (!guideInvoiceRefs.has(guideStr)) guideInvoiceRefs.set(guideStr, new Set());
                        guideInvoiceRefs.get(guideStr)!.add(invoiceRaw);
                    }
                }
            }
            // Count from historical files (guide + possible invoice aliases)
            for (const historicalRows of historicalDataSets) {
                if (!historicalRows.length) continue;
                const histGuideCol = findFirstCaseInsensitiveKey(historicalRows[0], [
                    MINUTOS_GUIDE_COL,
                    'GUIA',
                    'GUÍA',
                    'NRO GUIA',
                    'NUMERO GUIA',
                    'N° GUIA',
                ]);
                if (!histGuideCol) continue;
                const histInvoiceCol = findFirstCaseInsensitiveKey(historicalRows[0], MINUTOS_INVOICE_COL_ALIASES);
                for (const hRow of historicalRows) {
                    const guideVal = hRow[histGuideCol];
                    const guideStr = normalizeGuideId(guideVal);
                    if (!guideStr) continue;
                    totalGuidesCount.set(guideStr, (totalGuidesCount.get(guideStr) || 0) + 1);
                    const invoiceRaw = histInvoiceCol ? String(hRow[histInvoiceCol] || '').trim() : '';
                    if (invoiceRaw) {
                        if (!guideInvoiceRefs.has(guideStr)) guideInvoiceRefs.set(guideStr, new Set());
                        guideInvoiceRefs.get(guideStr)!.add(invoiceRaw);
                    }
                }
            }
        }

        // Create a lookup map from SIOP data
        const siopMap = new Map<string, string>();
        if (actualSiopGuideCol && actualSiopNameCol) {
            for (const row of siopData) {
                const guide = row[actualSiopGuideCol];
                const name = row[actualSiopNameCol];
                if (guide) siopMap.set(String(guide).trim(), name || '');
            }
        }
        
        const actualDateColumnsToFormat = DATE_COLUMNS_TO_FORMAT.map(col => findCaseInsensitiveKey(minutosData[0], col)).filter((col): col is string => !!col);

        let matchedRows = 0;
        const processedMinutosData: CsvRow[] = minutosData.map((row, index) => {
            const newRow: CsvRow = { ...row, originalIndex: index, uniqueId: `minutos-row-${index}` };

            // SIOP cross-referencing
            if (actualMinutosGuideCol) {
                const minutosGuide = String(row[actualMinutosGuideCol] || '').trim();
                const siopName = minutosGuide ? siopMap.get(minutosGuide) : undefined;
                if (siopName !== undefined) {
                    matchedRows++;
                    newRow[NEW_RESULT_COL] = siopName;
                    newRow[NEW_SIOP_GUIDE_COL] = minutosGuide;
                } else {
                    newRow[NEW_RESULT_COL] = 'NO ENCONTRADO';
                    newRow[NEW_SIOP_GUIDE_COL] = '';
                }
            }

            // --- Start of Re-organized Logic ---

            // 1. Set initial Observation, Contable, and Tipo values
            const cargarAValue = newRow[NEW_RESULT_COL];
            if (cargarAValue === 'UNOEE') {
                newRow[NEW_OBSERVATIONS_COL] = 'CAMBIOS, GARANTIAS Y DEVOLUCIONES';
                newRow[NEW_CONTABLE_COL] = 'CAMBIOS, GARANTIAS Y DEVOLUCIONES';
            } else if (cargarAValue && cargarAValue !== 'NO ENCONTRADO') {
                newRow[NEW_OBSERVATIONS_COL] = 'ENVIO NORMAL ECOMMERCE';
                newRow[NEW_CONTABLE_COL] = 'TRANSPORTE ECOMMERCE';
            } else {
                newRow[NEW_OBSERVATIONS_COL] = '';
                newRow[NEW_CONTABLE_COL] = '';
            }
            newRow[NEW_TIPO_COL] = 'DOMICILIO';
            
            // 2. Negotiated value calculation
            if (actualMinutosTipoEnvioCol && actualMinutosCiudadOrigenCol && actualMinutosCiudadDestinoCol) {
                const concatenatedKey = `${row[actualMinutosTipoEnvioCol] || ''}${row[actualMinutosCiudadOrigenCol] || ''}${row[actualMinutosCiudadDestinoCol] || ''}`;
                const negotiatedValue = negotiatedValueMap[concatenatedKey];
                newRow[NEW_NEGOTIATED_VALUE_COL] = negotiatedValue !== undefined ? String(negotiatedValue) : '0';
            } else {
                newRow[NEW_NEGOTIATED_VALUE_COL] = 'N/A';
            }

            // 3. DIF FLETE calculation
            if (actualMinutosVtaConNacCol) {
                const vtaConNac = parseFloat(row[actualMinutosVtaConNacCol] || '0');
                const valorNegociado = parseFloat(newRow[NEW_NEGOTIATED_VALUE_COL] || '0');
                newRow[NEW_DIF_FLETE_COL] = !isNaN(vtaConNac) && !isNaN(valorNegociado) ? String(vtaConNac - valorNegociado) : 'Error de cálculo';
            } else {
                newRow[NEW_DIF_FLETE_COL] = 'N/A';
            }
            
            // 4. ACCION Column Logic
            const difFleteValue = newRow[NEW_DIF_FLETE_COL];
            newRow[NEW_ACTION_COL] = (difFleteValue === '0') ? 'OK VALOR' : '';
            
            // 5. Billing count columns
            if (actualMinutosGuideCol) {
                const minutosGuide = normalizeGuideId(newRow[actualMinutosGuideCol]);
                const timesBilled = minutosGuide ? totalGuidesCount.get(minutosGuide) || 0 : 0;
                newRow[NEW_TIMES_BILLED_COL] = String(timesBilled);
                newRow[NEW_DOUBLE_BILLING_COL] = timesBilled > 1 ? 'OJO REVISAR COBRADO MAS DE 1 VEZ' : 'UN SOLO COBRO';
                const invoiceList = minutosGuide ? [...(guideInvoiceRefs.get(minutosGuide) || [])] : [];
                newRow[NEW_BILLED_INVOICES_COL] =
                    timesBilled > 1
                        ? (invoiceList.length > 0 ? invoiceList.join(', ') : 'SIN REFERENCIA DE FACTURA')
                        : '';
            } else {
                newRow[NEW_TIMES_BILLED_COL] = 'N/A';
                newRow[NEW_DOUBLE_BILLING_COL] = 'N/A';
                newRow[NEW_BILLED_INVOICES_COL] = 'N/A';
            }

            // 6. Get value from original 'CLASIFICACION' column (from the input file).
            const originalClassificationValue = actualMinutosClassificationCol ? String(row[actualMinutosClassificationCol] || '').trim() : '';

            // 7. Calculate the NEW final classification value based on 'NOTAS DEL ENVIO'.
            if (actualMinutosNotesCol) {
                const notesValue = String(row[actualMinutosNotesCol] || '');
                const match = notesValue.match(/cobro:\s*(si|no)/i);
                if (match) {
                    newRow[NEW_FINAL_CLASSIFICATION_COL] = match[1].toLowerCase() === 'si' ? 'CONTRAENTREGA' : 'ENVIO NORMAL';
                } else {
                    newRow[NEW_FINAL_CLASSIFICATION_COL] = '';
                }
            } else {
                newRow[NEW_FINAL_CLASSIFICATION_COL] = '';
            }
            
            // 8. Overwrite OBSERVACIONES and CONTABLE if it's a "devolucion"
            if (originalClassificationValue === '6.DEVOLUCION') {
                const finalClassification = newRow[NEW_FINAL_CLASSIFICATION_COL]; // This is 'CONTRAENTREGA' or 'ENVIO NORMAL'
                
                if (finalClassification === 'CONTRAENTREGA') {
                    newRow[NEW_OBSERVATIONS_COL] = 'DEVOLUCION LOGISTICA DE COBRO';
                    newRow[NEW_CONTABLE_COL] = 'DEV LOGISTICA COBRO';
                } else if (finalClassification === 'ENVIO NORMAL') {
                    newRow[NEW_OBSERVATIONS_COL] = 'DEVOLUCION PAQUETE NO ENTREGADO EN PRIMER DESPACHO';
                    newRow[NEW_CONTABLE_COL] = 'DEVOLUCION';
                }
            }
            
            // --- End of re-organized logic ---

            // Format date columns
            actualDateColumnsToFormat.forEach(colName => {
                if (newRow[colName]) newRow[colName] = formatExcelDate(newRow[colName]);
            });

            return newRow;
        });
        
        const originalHeaders = minutosData.length > 0 ? Object.keys(minutosData[0]) : [];
        const newHeadersOrder = [
            ...originalHeaders,
            NEW_RESULT_COL,
            NEW_SIOP_GUIDE_COL,
            NEW_NEGOTIATED_VALUE_COL,
            NEW_DIF_FLETE_COL,
            NEW_TIMES_BILLED_COL,
            NEW_DOUBLE_BILLING_COL,
            NEW_BILLED_INVOICES_COL,
            NEW_OBSERVATIONS_COL,
            NEW_ACTION_COL,
            NEW_CONTABLE_COL,
            NEW_TIPO_COL,
            NEW_FINAL_CLASSIFICATION_COL,
        ];
        // Use a Set to ensure headers are unique, preserving the intended order.
        // It's crucial because the original CLASIFICACION might have the same name as the new one.
        const finalHeaders = [...new Set(newHeadersOrder)];
        
        setResults({
            headers: finalHeaders,
            data: processedMinutosData,
            errors: [],
            summary: {
                totalRows: minutosData.length,
                matchedRows: matchedRows,
                unmatchedRows: minutosData.length - matchedRows,
            }
        });

    } catch (e: any) {
        setError(`Ocurrió un error al procesar los archivos: ${e.message}`);
    } finally {
        setIsLoading(false);
    }
  }, []);

  return { isLoading, error, results, processFiles, setResults };
};

    
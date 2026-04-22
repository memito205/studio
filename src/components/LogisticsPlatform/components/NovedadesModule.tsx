"use client";

import React, { useState, useCallback, useEffect } from 'react';
import FileUpload from './FileUpload';
import Loader from './Loader';
import ReportTable from './ReportTable';
import KPI from './KPI';
import { findHeader, formatDate, normalizeDate } from '../utils/helpers';
import type { ExcelDataRow } from '../types';
import { ClipboardSearchIcon, PackageIcon } from './icons';

import * as XLSX from 'xlsx';
declare const JSZip: any;

interface ReportState {
  data: any[];
  exportData: any[];
  headers: string[];
}

const NovedadesModule: React.FC = () => {
    const [existenceFile, setExistenceFile] = useState<File | null>(null);
    const [historicalZipFiles, setHistoricalZipFiles] = useState<File[] | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    
    // State for filtered, displayed reports
    const [reports, setReports] = useState<Record<string, ReportState>>({});
    // State for all raw, unfiltered reports
    const [rawReports, setRawReports] = useState<Record<string, ReportState>>({});
    const [totalExistence, setTotalExistence] = useState(0);
    const [analyzedExistence, setAnalyzedExistence] = useState<any[]>([]);


    // Filter states
    const [availableYears, setAvailableYears] = useState<number[]>([]);
    const [selectedYear, setSelectedYear] = useState<string>('all');
    const [selectedMonth, setSelectedMonth] = useState<string>('all');


    const handleExistenceFile = (file: File) => {
        setExistenceFile(file);
        setReports({});
        setRawReports({});
        setError(null);
    };

    const handleHistoricalZipFiles = (files: File[]) => {
        setHistoricalZipFiles(files);
        setReports({});
        setRawReports({});
        setError(null);
    };

    const parseDateFromFilename = (filename: string): Date | null => {
        const monthMap: { [key: string]: number } = {
            'ENERO': 0, 'FEBRERO': 1, 'MARZO': 2, 'ABRIL': 3, 'MAYO': 4, 'JUNIO': 5,
            'JULIO': 6, 'AGOSTO': 7, 'SEPTIEMBRE': 8, 'SEPT': 8, 'OCTUBRE': 9, 'NOVIEMBRE': 10, 'DICIEMBRE': 11
        };
        
        const nameOnly = filename.split('.').slice(0, -1).join('.').toUpperCase().replace(/[^A-Z0-9\s]/g, '');
        
        const yearMatch = nameOnly.match(/\b(20\d{2})\b/);
        if (!yearMatch) return null;
        const year = parseInt(yearMatch[0], 10);

        let month: number | null = null;
        for (const monthName in monthMap) {
            if (nameOnly.includes(monthName)) {
                month = monthMap[monthName];
                break;
            }
        }

        if (month === null) return null;
        
        return new Date(Date.UTC(year, month, 1));
    };

    const handleAnalyze = useCallback(async () => {
        if (!existenceFile || !historicalZipFiles || historicalZipFiles.length === 0) {
            setError("Por favor, carga tanto el archivo de existencias como al menos un archivo ZIP de históricos.");
            return;
        }

        setIsLoading(true);
        setError(null);
        setReports({});
        setRawReports({});
        setAnalyzedExistence([]);
        setSelectedYear('all');
        setSelectedMonth('all');
        const failedFileErrors: string[] = [];

        try {
            // Step 1: Read Existence File
            const reader = new FileReader();
            const existencePromise = new Promise<ExcelDataRow[]>((resolve, reject) => {
                reader.onload = (e) => {
                    try {
                        const data = new Uint8Array(e.target!.result as ArrayBuffer);
                        const workbook = XLSX.read(data, { type: 'array', cellDates: true, codepage: 65001 });
                        const sheetName = workbook.SheetNames[0];
                        const worksheet = workbook.Sheets[sheetName];
                        const jsonData: ExcelDataRow[] = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
                        resolve(jsonData);
                    } catch (err) { reject(err); }
                };
                reader.onerror = reject;
                reader.readAsArrayBuffer(existenceFile);
            });
            const existenceData = await existencePromise;

            if (existenceData.length === 0) throw new Error("El archivo de existencias está vacío.");
            
            const existenceHeaders = Object.keys(existenceData[0] || {});
            const refColEx = findHeader(existenceHeaders, ['Referencia']);
            const existenciaColEx = findHeader(existenceHeaders, ['Existencia']);
            const fechaEntradaColEx = findHeader(existenceHeaders, ['Fecha última entrada']);
            if (!refColEx || !existenciaColEx) {
                throw new Error("El archivo de existencias debe contener 'Referencia' y 'Existencia'.");
            }

            // Step 2: Read and combine all historical files from all ZIPs
            const jszip = new JSZip();
            let allHistoricalData: ExcelDataRow[] = [];
            const allExcelFilePromises: Promise<ExcelDataRow[] | null>[] = [];

            for (const zipFile of historicalZipFiles) {
                try {
                    const zip = await jszip.loadAsync(zipFile);
                    for (const filename in zip.files) {
                        const fileInZip = zip.files[filename];
                        
                        if (fileInZip.dir || (!filename.toLowerCase().endsWith('.xlsx') && !filename.toLowerCase().endsWith('.xls')) || filename.startsWith('__MACOSX/')) {
                            continue;
                        }

                        const excelPromise = fileInZip.async('arraybuffer').then(content => {
                            if (content.byteLength === 0) {
                                failedFileErrors.push(`${zipFile.name} -> ${filename}: Archivo vacío.`);
                                return null;
                            }
                            try {
                                const workbook = XLSX.read(content, { type: 'array', cellDates: true, codepage: 65001, cellStyles: true });
                                const sheetName = workbook.SheetNames[0];
                                if (!sheetName) {
                                    failedFileErrors.push(`${zipFile.name} -> ${filename}: No contiene hojas de cálculo.`);
                                    return null;
                                }
                                const worksheet = workbook.Sheets[sheetName];

                                const classificationColorMap = new Map<string, string>();
                                let classificationRowStart = -1;
                                const range = XLSX.utils.decode_range(worksheet['!ref']);

                                for (let R = range.s.r; R <= range.e.r; ++R) {
                                    const cellAddress = XLSX.utils.encode_cell({ c: 0, r: R });
                                    const cell = worksheet[cellAddress];
                                    if (cell && typeof cell.v === 'string' && cell.v.trim().toUpperCase() === 'CLASIFICACION') {
                                        classificationRowStart = R;
                                        break;
                                    }
                                }

                                if (classificationRowStart !== -1) {
                                    for (let R = classificationRowStart + 1; R <= range.e.r; ++R) {
                                        const cellAddress = XLSX.utils.encode_cell({ c: 0, r: R });
                                        const cell = worksheet[cellAddress];
                                        if (cell && cell.v) {
                                            const classificationText = String(cell.v).trim();
                                            const bgColor = cell.s?.fgColor?.rgb;
                                            const standardizedColor = bgColor ? bgColor.slice(-6).toUpperCase() : null;
                                            if (classificationText && standardizedColor) {
                                                classificationColorMap.set(standardizedColor, classificationText);
                                            }
                                        } else {
                                            break;
                                        }
                                    }
                                }

                                const headerKeys: { [key: number]: string } = {};
                                let headerRowIndex = -1;
                                const searchLimit = Math.min(range.e.r, 50); 
                                for (let R = range.s.r; R <= searchLimit; R++) {
                                    for (let C = range.s.c; C <= range.e.c; C++) {
                                        const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
                                        const cell = worksheet[cellAddress];
                                        if (cell && cell.v && typeof cell.v === 'string' && cell.v.trim().toUpperCase() === 'REFERENCIA') {
                                            headerRowIndex = R;
                                            break;
                                        }
                                    }
                                    if (headerRowIndex !== -1) break;
                                }

                                if (headerRowIndex === -1) throw new Error(`En ${filename}, no se pudo encontrar la fila de encabezado con 'Referencia'.`);
                                
                                for (let C = range.s.c; C <= range.e.c; C++) {
                                    const cell = worksheet[XLSX.utils.encode_cell({r: headerRowIndex, c: C})];
                                    if (cell && cell.v) headerKeys[C] = String(cell.v);
                                }

                                const jsonData: ExcelDataRow[] = [];
                                const dataEndRow = classificationRowStart !== -1 ? classificationRowStart - 1 : range.e.r;

                                for (let R = headerRowIndex + 1; R <= dataEndRow; R++) {
                                    const rowData: ExcelDataRow = {};
                                    let hasContent = false;
                                    for (let C = range.s.c; C <= range.e.c; C++) {
                                        const header = headerKeys[C];
                                        if (header) {
                                            const cell = worksheet[XLSX.utils.encode_cell({r: R, c: C})];
                                            if (cell && cell.v !== null && cell.v !== undefined) {
                                                rowData[header] = cell.v;
                                                if(String(cell.v).trim() !== '') hasContent = true;
                                            } else {
                                                rowData[header] = '';
                                            }
                                        }
                                    }

                                    if (hasContent) {
                                        if (classificationColorMap.size > 0) {
                                            const firstCell = worksheet[XLSX.utils.encode_cell({r: R, c: 0})];
                                            const rowBgColor = firstCell?.s?.fgColor?.rgb;
                                            if (rowBgColor) {
                                                const standardizedColor = rowBgColor.slice(-6).toUpperCase();
                                                if (classificationColorMap.has(standardizedColor)) {
                                                    (rowData as any).__color_classification = classificationColorMap.get(standardizedColor);
                                                }
                                            }
                                        }
                                        jsonData.push(rowData);
                                    }
                                }

                                if (jsonData.length > 0) {
                                    const historicalHeaders = Object.keys(jsonData[0]);
                                    const refColHist = findHeader(historicalHeaders, ['Referencia']);
                                    const notasColHist = findHeader(historicalHeaders, ['Notas documento', 'notas', 'NOTAS']);
                                    const notasRespuestaColHist = findHeader(historicalHeaders, ['NOTAS respuesta', 'notas respuesta', 'NOTAS RESPUESTA']);
                                    const fechaColHist = findHeader(historicalHeaders, ['Fecha', 'FECHA']);
                                    const guiaColHist = findHeader(historicalHeaders, ['guia', 'GUIA', 'guía']);
                                    const clasificacionColHist = findHeader(historicalHeaders, ['Clasificación', 'CLASIFICACION', 'clasificacion']);

                                    let dateFromFilename: Date | null = null;
                                    if (!fechaColHist) dateFromFilename = parseDateFromFilename(filename);

                                    if (!refColHist || !notasColHist || (!fechaColHist && !dateFromFilename)) {
                                       let missing = [];
                                       if (!refColHist) missing.push("'Referencia'");
                                       if (!notasColHist) missing.push("'Notas documento', 'notas' o 'NOTAS'");
                                       if (!fechaColHist && !dateFromFilename) missing.push("'Fecha' (o fecha en nombre de archivo)");
                                       failedFileErrors.push(`${zipFile.name} -> ${filename}: Columnas requeridas no encontradas: ${missing.join(', ')}.`);
                                       return null;
                                    }
                                    
                                    jsonData.forEach(row => {
                                        (row as any).__ref = String(row[refColHist!] ?? '').trim().toUpperCase();
                                        (row as any).__hist_note = String(row[notasColHist!] || '');
                                        (row as any).__hist_note_respuesta = notasRespuestaColHist ? String(row[notasRespuestaColHist] || '') : '';
                                        (row as any).__hist_date = dateFromFilename ? dateFromFilename : normalizeDate(row[fechaColHist!]);
                                        (row as any).__guia = guiaColHist ? String(row[guiaColHist] || '') : '';
                                        
                                        const colorClassification = (row as any).__color_classification;
                                        const columnClassification = clasificacionColHist ? String(row[clasificacionColHist] || '').trim() : '';
                                        (row as any).__clasificacion = colorClassification || columnClassification;
                                    });
                                }
                                return jsonData;
                            } catch (err) {
                                failedFileErrors.push(`${zipFile.name} -> ${filename}: ${(err as Error).message}`);
                                return null;
                            }
                        });
                        allExcelFilePromises.push(excelPromise);
                    }
                } catch (zipError) {
                     failedFileErrors.push(`Error al leer el archivo ZIP '${zipFile.name}': ${(zipError as Error).message}`);
                }
            }

            const excelFileResults = await Promise.all(allExcelFilePromises);
            excelFileResults.forEach(jsonData => {
                if (jsonData) allHistoricalData = allHistoricalData.concat(jsonData);
            });
            
            if (allHistoricalData.length === 0) {
                let errorMsg = "Ninguno de los archivos ZIP contenía archivos de Excel válidos para analizar.";
                if(failedFileErrors.length > 0) errorMsg += `\n\nSe encontraron ${failedFileErrors.length} problemas:\n- ${failedFileErrors.join('\n- ')}`;
                setError(errorMsg);
                setIsLoading(false);
                return;
            }

            const historicalDataMap = new Map<string, ExcelDataRow[]>();
            allHistoricalData.forEach(row => {
                const ref = (row as any).__ref;
                if (ref) {
                    if (!historicalDataMap.has(ref)) historicalDataMap.set(ref, []);
                    historicalDataMap.get(ref)!.push(row);
                }
            });

            // Step 3: Analyze existence against historical data
            const reportRows = existenceData.map(existenceRow => {
                const ref = String(existenceRow[refColEx!] ?? '').trim().toUpperCase();
                if (!ref) return null;

                const existencia = Number(existenceRow[existenciaColEx!] || 0);
                const fechaEntrada = fechaEntradaColEx ? normalizeDate(existenceRow[fechaEntradaColEx]) : null;

                const allHistoricalRowsForRef = historicalDataMap.get(ref);
                let bestHistRow: ExcelDataRow | null = null;
                
                if (allHistoricalRowsForRef && allHistoricalRowsForRef.length > 0) {
                    const relevantHistoricalRows = fechaEntrada 
                        ? allHistoricalRowsForRef.filter(histRow => {
                            const histDate = (histRow as any).__hist_date;
                            return histDate && histDate.getTime() <= fechaEntrada.getTime();
                          })
                        : allHistoricalRowsForRef;

                    if (relevantHistoricalRows.length > 0) {
                        const priority: Record<string, number> = {
                            "TIENE NC SACAR DEL INVENTARIO": 6, "FALTA NOTA CREDITO": 5, "RESPUESTA DE AUDITORIA": 4,
                            "SIN NC POR TRANSPORTADORA": 3, "CRUZA CON AJUSTE": 2.5, "CRUZA MISMO MES": 2, "CRUZA EN MESES ANTERIORES": 1
                        };
                        let bestScore = -1;

                        relevantHistoricalRows.forEach(histRow => {
                            const clasificacionManual = (histRow as any).__clasificacion;
                            const note = (histRow as any).__hist_note;
                            const histDate = (histRow as any).__hist_date;
                            let currentScore = 0;
                            
                            if (clasificacionManual) {
                                currentScore = priority[clasificacionManual.toUpperCase() as keyof typeof priority] ?? 100;
                            } else {
                                const noteUpper = (note || '').toUpperCase();
                                if (noteUpper.includes('FALTA NOTA CREDITO')) currentScore = priority["FALTA NOTA CREDITO"];
                                else if (noteUpper.includes('NC') && !noteUpper.includes('SIN NC')) currentScore = priority["TIENE NC SACAR DEL INVENTARIO"];
                                else if (noteUpper.includes('AUDITORIA')) currentScore = priority["RESPUESTA DE AUDITORIA"];
                                else if (noteUpper.includes('TRANSPORTADORA') || noteUpper.includes('ENVIA') || noteUpper.includes('TCC') || noteUpper.includes('COORDINADORA') || noteUpper.includes('SIN NC')) currentScore = priority["SIN NC POR TRANSPORTADORA"];
                                else if (noteUpper.includes('AJUSTE')) currentScore = priority["CRUZA CON AJUSTE"];
                                else if (fechaEntrada && histDate) {
                                    if (histDate.getUTCFullYear() === fechaEntrada.getUTCFullYear() && histDate.getUTCMonth() === fechaEntrada.getUTCMonth()) {
                                        currentScore = priority["CRUZA MISMO MES"];
                                    } else {
                                        currentScore = priority["CRUZA EN MESES ANTERIORES"];
                                    }
                                }
                            }

                            if (currentScore > bestScore) {
                                bestScore = currentScore;
                                bestHistRow = histRow;
                            } else if (currentScore === bestScore && bestHistRow) {
                                const currentDateInBest = (bestHistRow as any).__hist_date;
                                const newDate = (histRow as any).__hist_date;
                                if (newDate && (!currentDateInBest || newDate.getTime() > currentDateInBest.getTime())) {
                                    bestHistRow = histRow;
                                }
                            }
                        });
                    }
                }
                
                const finalHistRow = bestHistRow;
                const note = finalHistRow ? (finalHistRow as any).__hist_note : '---';
                const noteRespuesta = finalHistRow ? (finalHistRow as any).__hist_note_respuesta : '---';
                const histDate = finalHistRow ? (finalHistRow as any).__hist_date : null;
                const guia = finalHistRow ? (finalHistRow as any).__guia : '---';
                
                let finalClassification: { status: string; color: string };

                if (finalHistRow) {
                    const clasificacionManual = (finalHistRow as any).__clasificacion;
                    if (clasificacionManual) {
                        const statusUpper = clasificacionManual.toUpperCase();
                        let color = 'bg-purple-300 text-purple-800';
                        if (statusUpper.includes('NC') || statusUpper.includes('NOTA CREDITO')) color = statusUpper.includes('FALTA') ? 'bg-red-700 text-white' : 'bg-yellow-300 text-yellow-800';
                        else if (statusUpper.includes('AJUSTE')) color = 'bg-cyan-300 text-cyan-800';
                        else if (statusUpper.includes('AUDITORIA')) color = 'bg-amber-700 text-white';
                        else if (statusUpper.includes('TRANSPORTADORA')) color = 'bg-red-500 text-white';
                        finalClassification = { status: clasificacionManual, color };
                    } else {
                        const noteUpper = (note || '').toUpperCase();
                        if (noteUpper.includes('FALTA NOTA CREDITO')) finalClassification = { status: "FALTA NOTA CREDITO", color: 'bg-red-700 text-white' };
                        else if (noteUpper.includes('NC') && !noteUpper.includes('SIN NC')) finalClassification = { status: "TIENE NC SACAR DEL INVENTARIO", color: 'bg-yellow-300 text-yellow-800' };
                        else if (noteUpper.includes('AUDITORIA')) finalClassification = { status: "RESPUESTA DE AUDITORIA", color: 'bg-amber-700 text-white' };
                        else if (noteUpper.includes('TRANSPORTADORA') || noteUpper.includes('ENVIA') || noteUpper.includes('TCC') || noteUpper.includes('COORDINADORA') || noteUpper.includes('SIN NC')) finalClassification = { status: "SIN NC POR TRANSPORTADORA", color: 'bg-red-500 text-white' };
                        else if (noteUpper.includes('AJUSTE')) finalClassification = { status: "CRUZA CON AJUSTE", color: 'bg-cyan-300 text-cyan-800' };
                        else if (fechaEntrada && histDate) {
                            if (histDate.getUTCFullYear() === fechaEntrada.getUTCFullYear() && histDate.getUTCMonth() === fechaEntrada.getUTCMonth()) {
                                finalClassification = { status: "CRUZA MISMO MES", color: 'bg-teal-300 text-teal-800' };
                            } else {
                                finalClassification = { status: "CRUZA EN MESES ANTERIORES", color: 'bg-sky-300 text-sky-800' };
                            }
                        } else {
                            finalClassification = { status: "CRUZA CON HISTÓRICO", color: 'bg-blue-300 text-blue-800' };
                        }
                    }
                } else {
                    finalClassification = { status: "SIN HISTORIAL", color: 'bg-gray-200 text-gray-800' };
                }

                return {
                    'Referencia': ref,
                    'Existencia': existencia,
                    'Fecha última entrada': fechaEntrada,
                    'Notas documento': note,
                    'NOTAS respuesta': noteRespuesta,
                    'Guia': guia,
                    'Fecha Histórico': histDate,
                    'Clasificación': finalClassification,
                };
            }).filter((row): row is any => row !== null);

            // Step 4: Group rows by classification and create reports
            const groupedRows: Record<string, any[]> = {};
            reportRows.forEach(row => {
                const status = row['Clasificación'].status;
                if (!groupedRows[status]) groupedRows[status] = [];
                groupedRows[status].push(row);
            });
            
            const newReports: Record<string, ReportState> = {};
            const reportHeaders = ['Referencia', 'Existencia', 'Fecha última entrada', 'Notas documento', 'NOTAS respuesta', 'Guia', 'Fecha Histórico', 'Clasificación'];
            
            Object.entries(groupedRows).forEach(([status, rows]) => {
                newReports[status] = {
                    headers: reportHeaders,
                    data: rows.map(row => ({
                        'Referencia': row['Referencia'],
                        'Existencia': row['Existencia'].toLocaleString('es-ES'),
                        'Fecha última entrada': formatDate(row['Fecha última entrada']),
                        'Notas documento': row['Notas documento'],
                        'NOTAS respuesta': row['NOTAS respuesta'],
                        'Guia': row['Guia'],
                        'Fecha Histórico': formatDate(row['Fecha Histórico']),
                        'Clasificación': (
                            <span className={`px-2 py-1 text-xs font-semibold rounded-full ${row['Clasificación'].color}`}>
                                {row['Clasificación'].status}
                            </span>
                        )
                    })),
                    exportData: rows.map(row => ({
                        'Referencia': row['Referencia'],
                        'Existencia': row['Existencia'],
                        'Fecha última entrada': row['Fecha última entrada'],
                        'Notas documento': row['Notas documento'],
                        'NOTAS respuesta': row['NOTAS respuesta'],
                        'Guia': row['Guia'],
                        'Fecha Histórico': row['Fecha Histórico'],
                        'Clasificación': row['Clasificación'].status,
                    }))
                };
            });
            
            const allHistoricalDates = reportRows
                .map(row => row['Fecha Histórico'])
                .filter((date): date is Date => date instanceof Date);
            
            const years = [...new Set(allHistoricalDates.map(date => date.getUTCFullYear()))].sort((a,b) => b - a);
            setAvailableYears(years);
            
            setAnalyzedExistence(reportRows);
            setRawReports(newReports);
            setReports(newReports);
            
            if (failedFileErrors.length > 0) {
                setError(`Se omitieron ${failedFileErrors.length} archivo(s) o sub-archivos dentro de los ZIP. El análisis continuó con los archivos válidos.\n\nDetalles:\n- ${failedFileErrors.join('\n- ')}`);
            }

        } catch (err: any) {
            setError(`Ocurrió un error al analizar los archivos: ${err.message}`);
        } finally {
            setIsLoading(false);
        }
    }, [existenceFile, historicalZipFiles]);
    
    // Filtering logic
    useEffect(() => {
        if (Object.keys(rawReports).length === 0) {
            setTotalExistence(0);
            return;
        }

        const yearToFilter = selectedYear === 'all' ? null : parseInt(selectedYear, 10);
        const monthToFilter = selectedMonth === 'all' ? null : parseInt(selectedMonth, 10);
        
        let itemsToSum = analyzedExistence;
        if (yearToFilter !== null || monthToFilter !== null) {
            itemsToSum = analyzedExistence.filter(row => {
                const date = row['Fecha Histórico'];
                if (date instanceof Date) {
                    const yearMatches = yearToFilter === null || date.getUTCFullYear() === yearToFilter;
                    const monthMatches = monthToFilter === null || date.getUTCMonth() === monthToFilter;
                    return yearMatches && monthMatches;
                }
                return false;
            });
        }

        const newTotal = itemsToSum.reduce((sum, row) => sum + (Number(row['Existencia']) || 0), 0);
        setTotalExistence(newTotal);

        if (yearToFilter === null && monthToFilter === null) {
            setReports(rawReports);
            return;
        }

        const filteredReports: Record<string, ReportState> = {};
        for (const status in rawReports) {
            const originalReport = rawReports[status];
            
            const filteredExportData = originalReport.exportData.filter(row => {
                const date = row['Fecha Histórico'];
                if (date instanceof Date) {
                    const yearMatches = yearToFilter === null || date.getUTCFullYear() === yearToFilter;
                    const monthMatches = monthToFilter === null || date.getUTCMonth() === monthToFilter;
                    return yearMatches && monthMatches;
                }
                return false;
            });
            
            if (filteredExportData.length > 0) {
                const firstRow = filteredExportData[0];
                const classificationText = firstRow['Clasificación'];
                const statusUpper = classificationText.toUpperCase();
                let color = 'bg-purple-300 text-purple-800'; 
                if (statusUpper.includes('NC') || statusUpper.includes('NOTA CREDITO')) color = statusUpper.includes('FALTA') ? 'bg-red-700 text-white' : 'bg-yellow-300 text-yellow-800';
                else if (statusUpper.includes('AJUSTE')) color = 'bg-cyan-300 text-cyan-800';
                else if (statusUpper.includes('AUDITORIA')) color = 'bg-amber-700 text-white';
                else if (statusUpper.includes('TRANSPORTADORA')) color = 'bg-red-500 text-white';
                else if (statusUpper.includes("CRUZA MISMO MES")) color = 'bg-teal-300 text-teal-800';
                else if (statusUpper.includes("CRUZA EN MESES ANTERIORES")) color = 'bg-sky-300 text-sky-800';
                else if (statusUpper.includes("CRUZA CON HISTÓRICO")) color = 'bg-blue-300 text-blue-800';
                else if (statusUpper.includes("SIN HISTORIAL")) color = 'bg-gray-200 text-gray-800';
                
                filteredReports[status] = {
                    headers: originalReport.headers,
                    exportData: filteredExportData,
                    data: filteredExportData.map(row => ({
                        'Referencia': row['Referencia'],
                        'Existencia': row['Existencia'].toLocaleString('es-ES'),
                        'Fecha última entrada': formatDate(row['Fecha última entrada']),
                        'Notas documento': row['Notas documento'],
                        'NOTAS respuesta': row['NOTAS respuesta'],
                        'Guia': row['Guia'],
                        'Fecha Histórico': formatDate(row['Fecha Histórico']),
                        'Clasificación': (
                            <span className={`px-2 py-1 text-xs font-semibold rounded-full ${color}`}>
                                {row['Clasificación']}
                            </span>
                        )
                    }))
                };
            }
        }
        setReports(filteredReports);
        
    }, [rawReports, selectedYear, selectedMonth, analyzedExistence]);


    const reportOrder: { key: string; colorClass: string }[] = [
        { key: "TIENE NC SACAR DEL INVENTARIO", colorClass: 'text-yellow-600' },
        { key: "FALTA NOTA CREDITO", colorClass: 'text-red-700' },
        { key: "RESPUESTA DE AUDITORIA", colorClass: 'text-amber-700' },
        { key: "SIN NC POR TRANSPORTADORA", colorClass: 'text-red-600' },
        { key: "CRUZA CON AJUSTE", colorClass: 'text-cyan-600' },
        { key: "CRUZA MISMO MES", colorClass: 'text-teal-600' },
        { key: "CRUZA EN MESES ANTERIORES", colorClass: 'text-sky-600' },
        { key: "CRUZA CON HISTÓRICO", colorClass: 'text-blue-600' },
        { key: "SIN HISTORIAL", colorClass: 'text-gray-600' },
    ];

    const months = [
        "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
        "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
    ];

    return (
        <div className="space-y-8">
            <section className="bg-white rounded-lg shadow-lg p-6">
                <h2 className="text-2xl font-bold text-gray-800 mb-6 border-b pb-4">Análisis de Novedades de Transportadora</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                    <div>
                        <h3 className="text-lg font-semibold text-gray-700 mb-2">Paso 1: Cargar Archivo de Existencias</h3>
                         <p className="text-sm text-gray-600 mb-4">
                            Sube el archivo Excel con el inventario actual (requiere 'Referencia' y 'Existencia').
                        </p>
                        <FileUpload
                            onFileProcess={handleExistenceFile}
                            isLoading={isLoading}
                            fileName={existenceFile?.name}
                            mainText="Arrastra o selecciona el archivo de existencias"
                            subText="Solo un archivo .xlsx o .xls"
                            loadedSubText="Archivo de existencias cargado."
                        />
                    </div>
                    <div>
                         <h3 className="text-lg font-semibold text-gray-700 mb-2">Paso 2: Cargar Archivos ZIP de Históricos</h3>
                         <p className="text-sm text-gray-600 mb-4">
                            Sube uno o varios archivos .zip que contengan todos los históricos (e.g., uno por cada mes o año).
                        </p>
                        <FileUpload
                            onFilesProcess={handleHistoricalZipFiles}
                            isLoading={isLoading}
                            fileNames={historicalZipFiles?.map(f => f.name)}
                            multiple={true}
                            mainText="Arrastra o selecciona los archivos .zip"
                            subText="Puedes seleccionar uno o varios archivos"
                            loadedSubText="Archivos ZIP cargados. Para cambiar, selecciona otros."
                            accept=".zip"
                        />
                    </div>
                </div>

                <div className="mt-8 text-center">
                    <button
                        onClick={handleAnalyze}
                        disabled={isLoading || !existenceFile || !historicalZipFiles || historicalZipFiles.length === 0}
                        className="inline-flex items-center justify-center px-8 py-3 border border-transparent shadow-sm text-base font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:bg-gray-400 disabled:cursor-not-allowed"
                    >
                        {isLoading ? 'Analizando...' : 'Clasificar Inventario'}
                    </button>
                </div>

                {isLoading && <div className="mt-4"><Loader /></div>}
                {error && <div className="mt-4 text-left text-red-700 bg-red-100 p-4 rounded-md whitespace-pre-wrap text-sm" role="alert">{error}</div>}
            </section>
            
            {Object.keys(rawReports).length > 0 && !isLoading && (
                <>
                <section className="bg-white rounded-lg shadow-lg p-4 sm:p-6">
                    <h3 className="text-lg font-semibold text-gray-800 mb-4">Filtros de Reporte</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-end">
                         <div>
                            <label htmlFor="year-filter" className="block text-sm font-medium text-gray-700">Año</label>
                            <select
                                id="year-filter"
                                value={selectedYear}
                                onChange={(e) => setSelectedYear(e.target.value)}
                                className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm rounded-md shadow-sm"
                            >
                                <option value="all">Todos los Años</option>
                                {availableYears.map(year => <option key={year} value={year}>{year}</option>)}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="month-filter" className="block text-sm font-medium text-gray-700">Mes</label>
                            <select
                                id="month-filter"
                                value={selectedMonth}
                                onChange={(e) => setSelectedMonth(e.target.value)}
                                className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm rounded-md shadow-sm"
                            >
                                <option value="all">Todos los Meses</option>
                                {months.map((month, index) => <option key={month} value={index}>{month}</option>)}
                            </select>
                        </div>
                         <div className="flex items-end">
                            <button
                                onClick={() => { setSelectedYear('all'); setSelectedMonth('all'); }}
                                className="w-full justify-center inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                            >
                                Limpiar Filtros
                            </button>
                        </div>
                    </div>
                </section>

                <div className="my-6">
                    <KPI
                        title="Existencia Total (Reportes Filtrados)"
                        value={totalExistence.toLocaleString('es-ES')}
                        icon={<PackageIcon />}
                    />
                </div>
                
                 <section className="space-y-8">
                    {(() => {
                        const renderedStatuses = new Set<string>();

                        const orderedReports = reportOrder.flatMap(({ key, colorClass }) => {
                            const matchingReports = Object.entries(reports).filter(([status]) => 
                                !renderedStatuses.has(status) && status.toUpperCase().includes(key.toUpperCase())
                            ).sort(([a], [b]) => a.localeCompare(b));

                            // FIX: Explicitly type 'report' as ReportState to fix property access errors.
                            return matchingReports.map(([status, report]: [string, ReportState]) => {
                                renderedStatuses.add(status);
                                return (
                                    <ReportTable
                                        key={status}
                                        title={status}
                                        data={report.data}
                                        headers={report.headers}
                                        exportData={report.exportData}
                                        icon={<ClipboardSearchIcon className={`h-6 w-6 ${colorClass} mr-3`} />}
                                    />
                                );
                            });
                        });
                        
                        const unrenderedReports = Object.entries(reports)
                            .filter(([status]) => !renderedStatuses.has(status))
                             .sort(([a], [b]) => a.localeCompare(b))
                            // FIX: Explicitly type 'report' as ReportState to fix property access errors.
                            .map(([status, report]: [string, ReportState]) => {
                                 renderedStatuses.add(status);
                                 return (
                                    <ReportTable
                                        key={status}
                                        title={status}
                                        data={report.data}
                                        headers={report.headers}
                                        exportData={report.exportData}
                                        icon={<ClipboardSearchIcon className="h-6 w-6 text-gray-500 mr-3" />}
                                    />
                                );
                            });

                        const allElements = [...orderedReports, ...unrenderedReports];

                        if (allElements.length > 0) {
                            return allElements;
                        }
                        
                        if (Object.keys(rawReports).length > 0 && !isLoading) {
                            return (
                                <div className="text-center text-gray-500 py-12 bg-white rounded-lg shadow-lg">
                                    <p>No se encontraron registros que coincidan con los filtros seleccionados.</p>
                                </div>
                            );
                        }
                        
                        return null;
                    })()}
                </section>
                </>
            )}
        </div>
    );
};

export default NovedadesModule;

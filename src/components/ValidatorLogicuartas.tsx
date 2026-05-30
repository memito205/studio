
"use client";

import React, { useState, useMemo, useCallback, ChangeEvent, DragEvent, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { Button } from './ui/button';
import { ArrowLeft, UploadCloud, Loader2, TableIcon, Filter } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from './ui/card';
import { useToast } from '@/hooks/use-toast';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { exportToXlsx } from '@/services/export';
import { cn } from '@/lib/utils';
import { findCaseInsensitiveKey } from '@/lib/parsingUtils';
import { EditableCell } from './EditableCell'; // Reusable component
import { FilterToolbar } from './FilterToolbar'; // Reusable component
import type { CsvRow, FilterTypeLogicuartas } from '@/types';


interface ValidatorLogicuartasProps {
  onReturn: () => void;
}

type SiopData = { nombre: string; ped_valor_total: string; ped_guia_tte: string; };
type TarifaData = { costoManejo: string; valor: string };
type GuideInvoiceTrace = { guide: string; invoice: string };


const extractColumnOptimized = (file: File, columnName: string): Promise<string[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'array', cellNF: false, cellDates: false });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) return resolve([]);
        const worksheet = workbook.Sheets[sheetName];
        const sheetData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });

        if (sheetData.length === 0) return resolve([]);
        
        const headers = sheetData[0].map(h => String(h).trim().toLowerCase());
        const lowerCaseColumnName = columnName.toLowerCase();
        const columnIndex = headers.indexOf(lowerCaseColumnName);

        if (columnIndex === -1) return resolve([]);
        
        const columnValues = sheetData.slice(1).map(row => row[columnIndex]).filter(Boolean).map(String);
        resolve(columnValues);
      } catch (error: any) {
        reject(new Error(`Error procesando ${file.name}: ${error.message}`));
      }
    };
    reader.onerror = () => reject(new Error(`No se pudo leer ${file.name}.`));
    reader.readAsArrayBuffer(file);
  });
};

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

const normalizeInvoiceId = (value: unknown): string => {
  return String(value ?? '').trim().toUpperCase();
};

const findHeaderAlias = (headers: string[], aliases: string[]): string | undefined => {
  const normalizedHeaders = headers.map((h) => String(h || '').trim().toUpperCase());
  for (const alias of aliases) {
    const idx = normalizedHeaders.indexOf(alias.toUpperCase());
    if (idx >= 0) return headers[idx];
  }
  return undefined;
};

const extractGuidesAndInvoicesOptimized = (
  file: File,
  guideAliases: string[],
  invoiceAliases: string[]
): Promise<GuideInvoiceTrace[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'array', cellNF: false, cellDates: false });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) return resolve([]);
        const worksheet = workbook.Sheets[sheetName];
        const sheetData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
        if (sheetData.length === 0) return resolve([]);

        const headers = sheetData[0].map((h) => String(h || '').trim());
        const guideHeader = findHeaderAlias(headers, guideAliases);
        if (!guideHeader) return resolve([]);
        const invoiceHeader = findHeaderAlias(headers, invoiceAliases);
        const guideIndex = headers.indexOf(guideHeader);
        const invoiceIndex = invoiceHeader ? headers.indexOf(invoiceHeader) : -1;

        const rows: GuideInvoiceTrace[] = [];
        for (const row of sheetData.slice(1)) {
          const guide = normalizeGuideId(row[guideIndex]);
          if (!guide) continue;
          const invoice = invoiceIndex >= 0 ? normalizeInvoiceId(row[invoiceIndex]) : '';
          rows.push({ guide, invoice });
        }
        resolve(rows);
      } catch (error: any) {
        reject(new Error(`Error procesando ${file.name}: ${error.message}`));
      }
    };
    reader.onerror = () => reject(new Error(`No se pudo leer ${file.name}.`));
    reader.readAsArrayBuffer(file);
  });
};

const recalculateRow = (row: CsvRow): CsvRow => {
    let newRow = { ...row };

    const tipoCobro = newRow['TIPO COBRO'];
    const destino = String(newRow['DESTINO'] || '').toUpperCase();

    // Check for special BODEGA -> TIENDA logic
    if (tipoCobro === 'BODEGA' && (destino === 'APARTADO' || destino === 'CAUCASIA')) {
        const und = parseInt(String(newRow['UND'] || '0'), 10);
        let fleteFinalBodega = 0;

        if (destino === 'APARTADO') {
            newRow['SIOP.NOMBRE'] = 'B16';
            fleteFinalBodega = und * 24300;
        } else { // CAUCASIA
            newRow['SIOP.NOMBRE'] = 'B3';
            fleteFinalBodega = und * 15698;
        }
        
        newRow['FLETE FINAL'] = fleteFinalBodega;
        newRow['SIOP.PED_VALOR_TOTAL'] = 'NO ES UN PEDIDO DE SIOP';
        newRow['SIOP.PED_GUIA_TTE'] = 'NO ES UN PEDIDO DEL SIOP';

        if (!newRow['OBSERVACIONES']) newRow['OBSERVACIONES'] = 'ENVIO MERCANCIA BODEGA A TIENDAS';
        if (!newRow['ACCION']) newRow['ACCION'] = 'OK VALOR';
        if (!newRow['CONTABLE']) newRow['CONTABLE'] = 'ENVIO MERCANCIA BODEGA A TIENDAS';

    }

    const fleteOriginal = parseFloat(String(newRow['FLETE'] || '0').replace(/[^0-9.-]+/g, ""));
    const manejoOriginal = parseFloat(String(newRow['MANEJO'] || '0').replace(/[^0-9.-]+/g, ""));
    const totalOriginal = parseFloat(String(newRow['TOTAL'] || '0').replace(/[^0-9.-]+/g, ""));
    const declaraValue = parseFloat(String(newRow['DECLARA'] || '0').replace(/[^0-9.-]+/g, ""));
    
    const costoManejoTarifa = parseFloat(String(newRow['TARIFAS.COSTO MANEJO'] || '0').replace(/[^0-9.-]+/g, ""));
    const fleteFinal = parseFloat(String(newRow['FLETE FINAL'] || '0').replace(/[^0-9.-]+/g, ""));
    
    const costoManejoNegociado = Math.floor(declaraValue * costoManejoTarifa);
    const totalNegociado = fleteFinal + costoManejoNegociado;

    const difFlete = isNaN(fleteOriginal) || isNaN(fleteFinal) ? 0 : fleteOriginal - fleteFinal;
    const difCostoManejo = isNaN(manejoOriginal) || isNaN(costoManejoNegociado) ? 0 : manejoOriginal - costoManejoNegociado;
    const difTotal = isNaN(totalOriginal) || isNaN(totalNegociado) ? 0 : totalOriginal - totalNegociado;

    newRow['COSTO MANEJO NEGOCIADO'] = isNaN(costoManejoNegociado) ? 0 : costoManejoNegociado;
    newRow['TOTAL NEGOCIADO'] = isNaN(totalNegociado) ? 0 : totalNegociado;
    newRow['DIF FLETE'] = difFlete;
    newRow['DIF COSTO MANEJO'] = difCostoManejo;
    newRow['DIF TOTAL'] = difTotal;
    
    // Only apply automatic logic if the fields are empty or not manually set
    if (!newRow['OBSERVACIONES']) {
        const cobroDoble = newRow['COBRO DOBLE'];
        if (tipoCobro === 'ECOMMERCE' && (difTotal >= -1 && difTotal <= 1) && cobroDoble === 'UN SOLO COBRO') {
            newRow['OBSERVACIONES'] = 'ENVIO NORMAL ECOMMERCE';
        }
    }

    if (!newRow['ACCION']) {
        if (newRow['OBSERVACIONES'] === 'ENVIO NORMAL ECOMMERCE' || newRow['OBSERVACIONES'] === 'ENVIO MERCANCIA BODEGA A TIENDAS') {
            newRow['ACCION'] = 'OK VALOR';
        }
    }
    
    if (!newRow['CONTABLE']) {
        if (newRow['ACCION'] === 'OK VALOR') {
            newRow['CONTABLE'] = 'TRANSPORTE ECOMMERCE';
        }
    }

    return newRow;
};


const DataTable: React.FC<{ 
    title: string; 
    description: string; 
    data: CsvRow[]; 
    headers: string[]; 
    onDataChange?: (rowIndex: number, columnId: string, value: any) => void;
    isEditable?: boolean;
}> = ({ title, description, data, headers, onDataChange, isEditable = false }) => {

    return (
    <Card>
        <CardHeader>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
             <ScrollArea className="w-full whitespace-nowrap rounded-md border">
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                {headers.map(header => <TableHead key={header} className="bg-slate-700 text-slate-300 sticky top-0">{header}</TableHead>)}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {data.map((row, index) => (
                                <TableRow key={row.uniqueId || index}>
                                    {headers.map(header => (
                                        <TableCell key={`${row.uniqueId || index}-${header}`} className={cn(
                                            'px-2 py-1',
                                            (header.startsWith('DIF') && Math.abs(parseFloat(String(row[header]))) > 1) && 'text-red-400 font-bold',
                                            (header === 'COBRO DOBLE' && row[header] !== 'UN SOLO COBRO') && 'text-amber-400 font-bold'
                                        )}>
                                            {isEditable && onDataChange ? (
                                                <EditableCell
                                                    value={row[header] ?? ''}
                                                    onSave={(newValue) => onDataChange(row.originalIndex, header, newValue)}
                                                />
                                            ) : row[header] instanceof Date ? (
                                                row[header].toLocaleDateString()
                                            ) : (
                                                <div className="min-h-[32px] p-1">{String(row[header] ?? '')}</div>
                                            )}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
                 <ScrollBar orientation="horizontal" />
            </ScrollArea>
        </CardContent>
    </Card>
)};


const FileUploader: React.FC<{
    title: string;
    description: string;
    files: File[];
    onFileChange: (e: ChangeEvent<HTMLInputElement>) => void;
    id: string;
    multiple?: boolean;
    allowDirectory?: boolean;
}> = ({ title, description, files, onFileChange, id, multiple = false, allowDirectory = false }) => {
    
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (inputRef.current && allowDirectory) {
            inputRef.current.setAttribute('webkitdirectory', 'true');
            inputRef.current.setAttribute('directory', 'true');
        }
    }, [allowDirectory]);

    const handleDragOver = (e: DragEvent<HTMLLabelElement>) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const handleDrop = (e: DragEvent<HTMLLabelElement>) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer.files) {
             const changeEvent = {
                target: { files: e.dataTransfer.files },
            } as unknown as ChangeEvent<HTMLInputElement>;
            onFileChange(changeEvent);
        }
    };
    
    return (
        <div className="space-y-2">
            <Label className="text-lg">{title}</Label>
             <p className="text-sm text-muted-foreground">{description}</p>
            <label
                htmlFor={id}
                className="relative flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
                onDragOver={handleDragOver}
                onDrop={handleDrop}
            >
                {files.length > 0 ? (
                    <>
                        <TableIcon className="h-8 w-8 text-green-500" />
                        <p className="mt-2 font-semibold">{files.length > 1 ? `${files.length} archivos cargados` : files[0].name}</p>
                        <p className="text-sm text-muted-foreground">Archivos listos.</p>
                    </>
                ) : (
                    <>
                        <UploadCloud className="h-8 w-8 text-muted-foreground" />
                        <p className="mt-2 text-sm text-muted-foreground">
                            <span className="font-semibold text-primary">Haga clic</span> o arrastre {allowDirectory ? 'una carpeta' : (multiple ? 'archivos' : 'el archivo')}
                        </p>
                    </>
                )}
            </label>
            <input 
                ref={inputRef}
                id={id}
                type="file" 
                className="hidden" 
                onChange={onFileChange} 
                accept=".xlsx, .xls" 
                multiple={multiple}
            />
        </div>
    );
}

const ValidatorLogicuartas: React.FC<ValidatorLogicuartasProps> = ({ onReturn }) => {
  const [logicuartasFile, setLogicuartasFile] = useState<File[]>([]);
  const [siopFile, setSiopFile] = useState<File[]>([]);
  const [tarifasFile, setTarifasFile] = useState<File[]>([]);
  const [historicalFiles, setHistoricalFiles] = useState<File[]>([]);
  
  const [logicuartasData, setLogicuartasData] = useState<CsvRow[]>([]);
  const [logicuartasHeaders, setLogicuartasHeaders] = useState<string[]>([]);
  
  const [ajusteData, setAjusteData] = useState<CsvRow[]>([]);
  const [ajusteHeaders, setAjusteHeaders] = useState<string[]>([]);

  const [isLoading, setIsLoading] = useState(false);
  const [factura, setFactura] = useState<string>('');
  const [fechaFactura, setFechaFactura] = useState<string>(new Date().toISOString().split('T')[0]);
  const [activeFilters, setActiveFilters] = useState(new Set<FilterTypeLogicuartas>());
  const { toast } = useToast();


  const handleFilterChange = (filter: FilterTypeLogicuartas) => {
    setActiveFilters(prev => {
        const newFilters = new Set(prev);
        if (newFilters.has(filter)) {
            newFilters.delete(filter);
        } else {
            newFilters.add(filter);
        }
        return newFilters;
    });
  };

  const handleAjusteDataChange = useCallback((rowIndex: number, columnId: string, value: any) => {
    setAjusteData(prevData => {
        const newData = [...prevData];
        const arrayIndex = newData.findIndex(row => row.originalIndex === rowIndex);
        if(arrayIndex !== -1) {
            const rowToUpdate = { ...newData[arrayIndex] };
            rowToUpdate[columnId] = value;
            const recalculatedRow = recalculateRow(rowToUpdate);
            newData[arrayIndex] = recalculatedRow;
        }
        return newData;
    });
  }, []);

  const readFileAsBuffer = (file: File): Promise<ArrayBuffer> => {
      return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = e => resolve(e.target?.result as ArrayBuffer);
          reader.onerror = e => reject(reader.error);
          reader.readAsArrayBuffer(file);
      });
  };

  const processFiles = useCallback(async () => {
    if (logicuartasFile.length === 0 || siopFile.length === 0 || tarifasFile.length === 0 || historicalFiles.length === 0) {
        toast({ variant: "destructive", title: "Faltan archivos", description: "Por favor, cargue los cuatro conjuntos de archivos para procesar." });
        return;
    }
    if (!factura.trim() || !fechaFactura) {
        toast({ variant: "destructive", title: "Faltan datos", description: "Por favor, ingrese un número y fecha de factura." });
        return;
    }

    setIsLoading(true);
    setLogicuartasData([]);
    setAjusteData([]);
    setActiveFilters(new Set());

    try {
        const [logicuartasBuffer, siopBuffer, tarifasBuffer] = await Promise.all([
            readFileAsBuffer(logicuartasFile[0]),
            readFileAsBuffer(siopFile[0]),
            readFileAsBuffer(tarifasFile[0])
        ]);

        const allFilesForGuideCounting = [...logicuartasFile, ...historicalFiles];
        const tracesPerFile = await Promise.all(
          allFilesForGuideCounting.map((file) =>
            extractGuidesAndInvoicesOptimized(
              file,
              ['GUIA', 'GUÍA', 'NUMERO 99', 'NRO GUIA', 'NUMERO GUIA', 'PED_GUIA_TTE'],
              ['FAC', 'FACTURA', 'NRO FACTURA', 'NO FACTURA', 'NUMERO FACTURA', 'NÚMERO FACTURA']
            )
          )
        );
        const allGuideTraces = tracesPerFile.flat();

        const guidesCountMap = new Map<string, number>();
        const guideInvoicesMap = new Map<string, Set<string>>();
        allGuideTraces.forEach(({ guide, invoice }) => {
            if (!guide) return;
            guidesCountMap.set(guide, (guidesCountMap.get(guide) || 0) + 1);
            if (invoice) {
              if (!guideInvoicesMap.has(guide)) guideInvoicesMap.set(guide, new Set());
              guideInvoicesMap.get(guide)!.add(invoice);
            }
        });

        const wbLogicuartas = XLSX.read(logicuartasBuffer, { type: 'array', cellDates: true });
        const wsLogicuartas = wbLogicuartas.Sheets[wbLogicuartas.SheetNames[0]];
        // **FIX:** Check if jsonDataLogicuartas has data before proceeding.
        const jsonDataLogicuartas: CsvRow[] = XLSX.utils.sheet_to_json(wsLogicuartas);
        if (jsonDataLogicuartas.length === 0) {
            throw new Error("El archivo de Logicuartas está vacío o no tiene el formato correcto.");
        }
        
        const wbSiop = XLSX.read(siopBuffer, { type: 'array', cellDates: true });
        const wsSiop = wbSiop.Sheets[wbSiop.SheetNames[0]];
        const siopDataArray: any[][] = XLSX.utils.sheet_to_json(wsSiop, { header: 1 });
        if (siopDataArray.length < 1) {
            throw new Error("El archivo SIOP está vacío o no contiene una fila de cabecera.");
        }
        
        const siopHeaders = siopDataArray[0].map(h => String(h).toLowerCase().trim());
        const guiaIndex = siopHeaders.indexOf('ped_guia_tte');
        const nombreIndex = siopHeaders.indexOf('nombre');
        const valorTotalIndex = siopHeaders.indexOf('ped_valor_total');


        if (guiaIndex === -1 || nombreIndex === -1 || valorTotalIndex === -1) {
            throw new Error("El archivo SIOP debe contener las columnas 'PED_GUIA_TTE', 'NOMBRE' y 'PED_VALOR_TOTAL'.");
        }

        const siopMap = new Map<string, SiopData>();
        for (let i = 1; i < siopDataArray.length; i++) {
            const row = siopDataArray[i];
            const guia = row[guiaIndex];
            if (guia !== null && guia !== undefined && String(guia).trim() !== '') {
                const guiaStr = normalizeGuideId(guia);
                if (!guiaStr) continue;
                siopMap.set(guiaStr, {
                    nombre: String(row[nombreIndex] || ''),
                    ped_valor_total: String(row[valorTotalIndex] || ''),
                    ped_guia_tte: guiaStr,
                });
            }
        }
        
        const wbTarifas = XLSX.read(tarifasBuffer, { type: 'array', cellDates: true });
        const wsTarifas = wbTarifas.Sheets[wbTarifas.SheetNames[0]];
        const jsonDataTarifas: CsvRow[] = XLSX.utils.sheet_to_json(wsTarifas);

        if (jsonDataTarifas.length === 0) {
            throw new Error("El archivo de Tarifas Negociadas está vacío o no contiene datos.");
        }

        const tarifasMap = new Map<string, TarifaData>();
        const costoManejoCol = findCaseInsensitiveKey(jsonDataTarifas[0], 'COSTO MANEJO');
        const destinoCol = findCaseInsensitiveKey(jsonDataTarifas[0], 'DESTINO');
        const tipoPesoCol = findCaseInsensitiveKey(jsonDataTarifas[0], 'TIPO PESO');
        const valorCol = findCaseInsensitiveKey(jsonDataTarifas[0], 'VALOR');

        if (!costoManejoCol || !destinoCol || !tipoPesoCol || !valorCol) {
            throw new Error("El archivo de Tarifas debe contener las columnas 'DESTINO', 'TIPO PESO', 'COSTO MANEJO' y 'VALOR'.");
        }
        jsonDataTarifas.forEach(row => {
            const destinoValue = String(row[destinoCol] || '').trim().toUpperCase();
            const tipoPesoValue = String(row[tipoPesoCol] || '').trim().toUpperCase();
            const key = `${destinoValue}-${tipoPesoValue}`;
            if (key !== '-') {
                tarifasMap.set(key, {
                    costoManejo: String(row[costoManejoCol] || ''),
                    valor: String(row[valorCol] || ''),
                });
            }
        });


      const logicuartasDefinedHeaders = [ 'FAC', 'DOC_CLI', 'NIT', 'TERCERO', 'ORIGEN', 'DESTINO', 'UND', 'P_REAL', 'P_FACTURADO', 'FLETE', 'TOTAL', 'RECAUDO', 'DECLARA', 'F_ENT', 'F_SOP', 'F_FAC', 'GUIA', 'MANEJO' ];
      const processedLogicuartasData = jsonDataLogicuartas.map((row, index) => ({
          'FAC': factura,
          'DOC_CLI': row[findCaseInsensitiveKey(row, 'DOCUMENTO') || ''] || '',
          'NIT': 900738933,
          'TERCERO': 'RANKING SPORT SAS',
          'ORIGEN': row[findCaseInsensitiveKey(row, 'ORIGEN') || ''] || '',
          'DESTINO': row[findCaseInsensitiveKey(row, 'DESTINO') || ''] || '',
          'UND': row[findCaseInsensitiveKey(row, 'UND') || ''] || '',
          'P_REAL': row[findCaseInsensitiveKey(row, 'PES') || ''] || '',
          'P_FACTURADO': row[findCaseInsensitiveKey(row, 'P_FAC') || ''] || '',
          'FLETE': row[findCaseInsensitiveKey(row, 'FLETE') || ''] || '',
          'TOTAL': row[findCaseInsensitiveKey(row, 'TOTAL') || ''] || '',
          'RECAUDO': row[findCaseInsensitiveKey(row, 'RECAUDO') || ''] || '',
          'DECLARA': row[findCaseInsensitiveKey(row, 'DECLARA') || ''] || '',
          'F_ENT': row[findCaseInsensitiveKey(row, 'FECHA') || ''] || '',
          'F_SOP': '',
          'F_FAC': '',
          'GUIA': row[findCaseInsensitiveKey(row, 'GUIA') || ''] || '',
          'MANEJO': row[findCaseInsensitiveKey(row, 'MANEJO') || ''] || '',
          'uniqueId': `logicuartas-${index}`,
          'originalIndex': index,
      }));
      setLogicuartasHeaders(logicuartasDefinedHeaders);
      setLogicuartasData(processedLogicuartasData);

      const ajusteDefinedHeaders = [
        'FAC', 'DOC_CLI', 'ORIGEN', 'DESTINO', 'UND', 'P_REAL', 'P_FACTURADO', 'FLETE', 'MANEJO', 'TOTAL', 'RECAUDO', 'DECLARA', 'F_ENT', 'F_SOP', 'F_FAC',
        'TIPO COBRO', 'SIOP.NOMBRE', 'SIOP.PED_VALOR_TOTAL', 'SIOP.PED_GUIA_TTE', 'DESTINO_TIPO_COBRO', 'TARIFAS.COSTO MANEJO', 'FLETE FINAL', 'COSTO MANEJO NEGOCIADO',
        'TOTAL NEGOCIADO', 'DIF FLETE', 'DIF COSTO MANEJO', 'DIF TOTAL', 'DOBLES.CANT COBRO PEDIDOS', 'COBRO DOBLE', 'FACTURAS DONDE SE COBRO', 'OBSERVACIONES', 'ACCION', 'CONTABLE',
        'TIPO', 'CLASIFICACION', 'FECHA FACTURA'
      ];

      const processedAjusteData = jsonDataLogicuartas.map((row, index) => {
          const productoValue = row[findCaseInsensitiveKey(row, 'PRODUCTO') || ''] || '';
          const tipoCobro = productoValue === 'ECOMMERCE 1-10K' ? 'ECOMMERCE' : 'BODEGA';
          const guia = normalizeGuideId(row[findCaseInsensitiveKey(row, 'GUIA') || '']);
          const siopInfo = siopMap.get(guia);
          const destino = String(row[findCaseInsensitiveKey(row, 'DESTINO') || ''] || '').toUpperCase();
          const destinoTipoCobro = `${destino}-${tipoCobro}`;
          const tarifaInfo = tarifasMap.get(destinoTipoCobro);
          
          const cantCobroPedidos = guia ? guidesCountMap.get(guia) || 0 : 0;
          const cobroDoble = cantCobroPedidos > 1 ? 'OJO REVISAR COBRO DOBLE' : 'UN SOLO COBRO';
          const invoiceRefs = guia ? [...(guideInvoicesMap.get(guia) || [])] : [];
          const billedInvoices = cantCobroPedidos > 1
            ? (invoiceRefs.length > 0 ? invoiceRefs.join(', ') : (factura ? factura : 'SIN REFERENCIA DE FACTURA'))
            : '';

          const recaudoValue = parseFloat(String(row[findCaseInsensitiveKey(row, 'RECAUDO') || ''] || '0').replace(/[^0-9.-]+/g, ""));
          const clasificacion = recaudoValue > 0 ? 'CONTRAENTREGA' : 'ENVIO NORMAL';

          let initialRow: CsvRow = {
              'FAC': factura,
              'DOC_CLI': row[findCaseInsensitiveKey(row, 'DOCUMENTO') || ''] || '',
              'ORIGEN': row[findCaseInsensitiveKey(row, 'ORIGEN') || ''] || '',
              'DESTINO': destino,
              'MANEJO': row[findCaseInsensitiveKey(row, 'MANEJO') || ''] || '',
              'UND': row[findCaseInsensitiveKey(row, 'UND') || ''] || '',
              'P_REAL': row[findCaseInsensitiveKey(row, 'PES') || ''] || '',
              'P_FACTURADO': row[findCaseInsensitiveKey(row, 'P_FAC') || ''] || '',
              'FLETE': row[findCaseInsensitiveKey(row, 'FLETE') || ''] || '',
              'TOTAL': row[findCaseInsensitiveKey(row, 'TOTAL') || ''] || '',
              'RECAUDO': row[findCaseInsensitiveKey(row, 'RECAUDO') || ''] || '',
              'DECLARA': row[findCaseInsensitiveKey(row, 'DECLARA') || ''] || '',
              'F_ENT': row[findCaseInsensitiveKey(row, 'FECHA') || ''] || '',
              'F_SOP': '',
              'F_FAC': '',
              'TIPO COBRO': tipoCobro,
              'SIOP.NOMBRE': siopInfo?.nombre || '',
              'SIOP.PED_VALOR_TOTAL': siopInfo?.ped_valor_total || '',
              'SIOP.PED_GUIA_TTE': siopInfo?.ped_guia_tte || '',
              'DESTINO_TIPO_COBRO': destinoTipoCobro,
              'TARIFAS.COSTO MANEJO': tarifaInfo?.costoManejo || '',
              'FLETE FINAL': tarifaInfo?.valor || '0', 
              'DOBLES.CANT COBRO PEDIDOS': cantCobroPedidos,
              'COBRO DOBLE': cobroDoble,
              'FACTURAS DONDE SE COBRO': billedInvoices,
              'TIPO': 'DOMICILIO',
              'CLASIFICACION': clasificacion,
              'FECHA FACTURA': fechaFactura ? new Date(fechaFactura + 'T00:00:00').toLocaleDateString('es-CO') : '',
              'originalIndex': index,
              'uniqueId': `row-${index}`,
          };

          return recalculateRow(initialRow);
      });
      setAjusteHeaders(ajusteDefinedHeaders);
      setAjusteData(processedAjusteData);
      
      toast({ title: "Archivos procesados", description: `Se han generado los datos para Logicuartas y Ajuste Factura.` });

    } catch (error: any) {
        console.error("Error processing files:", error);
        toast({ variant: "destructive", title: "Error al procesar", description: error.message });
    } finally {
        setIsLoading(false);
    }
  }, [logicuartasFile, siopFile, tarifasFile, historicalFiles, factura, fechaFactura, toast]);


  const handleDownloadLogicuartas = () => { if (logicuartasData.length > 0) exportToXlsx(logicuartasData, `Logicuartas_Procesado_${factura || 'sin_factura'}`); };
  
  const handleDownloadAjuste = () => {
    let dataToFilter = ajusteData;
     if (activeFilters.size > 0) {
        dataToFilter = dataToFilter.filter(row => {
            if (activeFilters.has('no_siop') && !row['SIOP.PED_GUIA_TTE']) return true;
            if (activeFilters.has('no_tarifa') && !row['TARIFAS.COSTO MANEJO']) return true;
            if (activeFilters.has('diferencias') && (Math.abs(row['DIF FLETE']) > 1 || Math.abs(row['DIF COSTO MANEJO']) > 1 || Math.abs(row['DIF TOTAL']) > 1)) return true;
            if (activeFilters.has('dobles') && row['DOBLES.CANT COBRO PEDIDOS'] > 1) return true;
            return false;
        });
    }

    if (dataToFilter.length > 0) {
      // Reorder the data to match the headers for export
      const finalData = dataToFilter.map(row => {
        const orderedRow: CsvRow = {};
        ajusteHeaders.forEach(header => {
            orderedRow[header] = row[header];
        });
        return orderedRow;
      });
      exportToXlsx(finalData, `Ajuste_Factura_Procesado_${factura || 'sin_factura'}`);
    } else {
         toast({
            variant: "destructive",
            title: "No hay datos para exportar",
            description: "El filtro actual no produce ningún resultado."
       })
    }
  };
  
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>, setter: React.Dispatch<React.SetStateAction<File[]>>) => {
      if(e.target.files) setter(Array.from(e.target.files));
      if(e.target) e.target.value = '';
  };
  
  const canProcess = logicuartasFile.length > 0 && siopFile.length > 0 && tarifasFile.length > 0 && historicalFiles.length > 0 && factura.trim() && fechaFactura;

  const filteredAjusteData = useMemo(() => {
    if (activeFilters.size === 0) return ajusteData;
    return ajusteData.filter(row => {
      if (activeFilters.has('no_siop') && !row['SIOP.PED_GUIA_TTE']) return true;
      if (activeFilters.has('no_tarifa') && !row['TARIFAS.COSTO MANEJO']) return true;
      if (activeFilters.has('diferencias') && (Math.abs(row['DIF FLETE']) > 1 || Math.abs(row['DIF COSTO MANEJO']) > 1 || Math.abs(row['DIF TOTAL']) > 1)) return true;
      if (activeFilters.has('dobles') && row['DOBLES.CANT COBRO PEDIDOS'] > 1) return true;
      return false;
    });
  }, [ajusteData, activeFilters]);

  return (
    <div className="space-y-8">
       <Card>
        <CardHeader className="flex flex-row justify-between items-center">
            <div>
                <CardTitle>Validador de Conciliación - Logicuartas</CardTitle>
                <CardDescription>Cargue los archivos para generar los reportes de conciliación.</CardDescription>
            </div>
            <Button onClick={onReturn} variant="outline"> <ArrowLeft className="mr-2 h-4 w-4" /> Volver </Button>
        </CardHeader>
        <CardContent className="space-y-6">
            <div className="flex flex-wrap gap-6 items-end">
                <div className="space-y-2 flex-1 min-w-[200px]">
                    <Label htmlFor="factura-input" className="text-lg">Número de Factura</Label>
                    <Input id="factura-input" value={factura} onChange={(e) => setFactura(e.target.value)} placeholder="Requerido para procesar" className="text-base" />
                </div>
                <div className="space-y-2 flex-1 min-w-[200px]">
                    <Label htmlFor="fecha-factura-input" className="text-lg">Fecha Factura</Label>
                    <Input id="fecha-factura-input" type="date" value={fechaFactura} onChange={(e) => setFechaFactura(e.target.value)} className="text-base" />
                </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 items-start">
                 <FileUploader id="logicuartas-upload" title="1. Archivo Logicuartas" description="El reporte original de la transportadora." files={logicuartasFile} onFileChange={(e) => handleFileChange(e, setLogicuartasFile)} />
                 <FileUploader id="siop-upload" title="2. Archivo SIOP" description="Reporte para cruzar guías y nombres." files={siopFile} onFileChange={(e) => handleFileChange(e, setSiopFile)} />
                 <FileUploader id="tarifas-upload" title="3. Archivo de Tarifas" description="Reporte con tarifas negociadas." files={tarifasFile} onFileChange={(e) => handleFileChange(e, setTarifasFile)} />
                 <FileUploader id="historical-upload" title="4. Historial de Cobros" description="Carpeta con archivos de cobros anteriores." files={historicalFiles} onFileChange={(e) => handleFileChange(e, setHistoricalFiles)} multiple allowDirectory />
            </div>
            <div className="flex justify-center mt-6">
                <Button onClick={processFiles} disabled={!canProcess || isLoading} size="lg">
                    {isLoading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <TableIcon className="mr-2 h-5 w-5" />}
                    Procesar Archivos
                </Button>
            </div>
        </CardContent>
      </Card>
      
      {logicuartasData.length > 0 && ( <DataTable title="Datos Procesados de Logicuartas" description="Visualización de las filas importadas con la estructura final." data={logicuartasData} headers={logicuartasHeaders} /> )}
      
      {ajusteData.length > 0 && (
         <Card>
            <CardHeader>
                <CardTitle>Datos Generados para Ajuste Factura</CardTitle>
                <CardDescription>Datos cruzados con SIOP y la lógica de TIPO COBRO. Puede editar las celdas directamente.</CardDescription>
            </CardHeader>
            <CardContent>
                <FilterToolbar
                    activeFilters={activeFilters}
                    onFilterChange={handleFilterChange}
                    filteredDataCount={filteredAjusteData.length}
                    totalDataCount={ajusteData.length}
                    onDownload={handleDownloadAjuste}
                    filterDefinitions={[
                        { type: 'no_siop', label: 'Sin Cruce SIOP' },
                        { type: 'no_tarifa', label: 'Sin Tarifa Negociada' },
                        { type: 'diferencias', label: 'Con Diferencias (>1)' },
                        { type: 'dobles', label: 'Cobros Múltiples' },
                    ]}
                />
                 <DataTable 
                    title="" 
                    description="" 
                    data={filteredAjusteData} 
                    headers={ajusteHeaders} 
                    onDataChange={handleAjusteDataChange}
                    isEditable={true}
                />
            </CardContent>
         </Card>
      )}
    </div>
  );
};

export default ValidatorLogicuartas;

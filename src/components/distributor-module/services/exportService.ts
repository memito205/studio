import type { Allocation, StockItem, DistributionRule } from '../types';

import * as XLSX from 'xlsx';

const formatDate = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
};

const transformSizeToExte = (talla: string): number | string => {
    // Normalizar la talla reemplazando comas por puntos
    const normalizedTalla = String(talla).replace(',', '.').trim();

    // Intentar convertir a número
    const numericTalla = parseFloat(normalizedTalla);

    // Si no es un número válido, devolver la talla original
    if (isNaN(numericTalla)) {
        return talla;
    }

    // Mapeo específico para códigos de talla no estándar (ej. '80' -> 8)
    const mapping: { [key: string]: number } = {
        '100': 10, '105': 10.5, '110': 11, '120': 12, '80': 8, '85': 8.5, '90': 9, '95': 9.5, '70': 7, '75': 7.5, '130': 13
    };
    if (mapping[normalizedTalla]) {
        return mapping[normalizedTalla];
    }
    
    // Si es un entero mayor a 30 (ej. 55), se asume que necesita ser dividido entre 10
    if (Number.isInteger(numericTalla) && numericTalla > 30) {
        return numericTalla / 10;
    }

    // Si no, se asume que la talla ya está en el formato correcto (ej. 5.5)
    return numericTalla;
};

export const findUnmappedWarehouses = (allocations: Allocation, coMap: { [key: string]: string }): string[] => {
    const allBodegasInAllocations = new Set<string>();
    for (const bodega in allocations) {
        const hasAllocation = Object.values(allocations[bodega]).some(ref => ref.allocated > 0);
        if (hasAllocation) {
            allBodegasInAllocations.add(bodega);
        }
    }
    const unmapped = [...allBodegasInAllocations].filter(bodega => !coMap[bodega]);
    return unmapped.sort();
};

const generateDocumentSheetsData = (allocations: Allocation | null, coMap: { [key: string]: string }) => {
    if (!allocations) return { documentosData: [], detalleDocumentosData: [], movimientosData: [] };

    const documentosData: any[] = [];
    const detalleDocumentosData: any[] = [];
    const movimientosData: any[] = [];
    let numDoctoCounter = 1;
    let numRegCounter = 1;

    const today = new Date();
    const fecha = formatDate(today);
    const fechaEntregaDate = new Date();
    fechaEntregaDate.setDate(today.getDate() + 2);
    const fechaEntrega = formatDate(fechaEntregaDate);

    const sortedBodegas = Object.keys(allocations).sort();

    for (const bodega of sortedBodegas) {
        const hasAllocation = Object.values(allocations[bodega]).some(ref => ref.allocated > 0);
        if (!hasAllocation) continue;

        let co = coMap[bodega];

        if (!co) {
            console.warn(`La bodega '${bodega}' no está mapeada y será omitida en la exportación.`);
            continue;
        }

        let bodEnt: string;
        if (co === '999') {
            bodEnt = 'BODVI';
        } else if (co === '997') {
            bodEnt = 'BODPN';
        } else {
            bodEnt = `${co}01`;
        }
        
        const numDocto = numDoctoCounter;
        
        documentosData.push({
            'CO': co,
            'NUM_DOCTO': numDocto,
            'FECHA': fecha,
            'SOLICITANTE': '042',
            'FECHA_ENTREGA': fechaEntrega,
            'NOTAS': 'NIKE RK2517',
            'BOD_SALIDA': 'BDIST',
            'BOD_ENT': bodEnt,
            'REF': 'NIKE RK2517'
        });

        for (const ref in allocations[bodega]) {
            for (const item of allocations[bodega][ref].items) {
                if (item.quantity > 0) {
                    detalleDocumentosData.push({
                        'CO': co,
                        'NUM_DOCTO': numDocto,
                        'REFERENCIA': ref,
                        'TALLA': item.talla,
                        'CANTIDAD': item.quantity
                    });

                    movimientosData.push({
                        'CO': co,
                        'NUM_DOCTO': numDocto,
                        'NUM_REG': numRegCounter,
                        'REF': ref,
                        'EXTE': transformSizeToExte(item.talla),
                        'BODEGA': bodEnt,
                        'CANT': item.quantity,
                        'FECHA_ENTREGA': fechaEntrega,
                        'CO_MOV': '999'
                    });
                    numRegCounter++;
                }
            }
        }
        numDoctoCounter++;
    }

    return { documentosData, detalleDocumentosData, movimientosData };
};


export const generateSummaryData = (
  stock: StockItem[] | null,
  plan: DistributionRule[] | null,
  allocations: Allocation | null
) => {
  if (!stock || !plan || !allocations) return [];

  const summary = new Map<string, { stock: number; requested: number; allocated: number }>();

  const ensureRef = (ref: string) => {
    if (!summary.has(ref)) {
      summary.set(ref, { stock: 0, requested: 0, allocated: 0 });
    }
  };

  for (const item of stock) {
    const ref = String(item.REFERENCIA).trim();
    ensureRef(ref);
    summary.get(ref)!.stock += Number(item['CANTD LEIDA'] || 0);
  }

  for (const rule of plan) {
    const ref = String(rule.REFERENCIA).trim();
    ensureRef(ref);
    summary.get(ref)!.requested += Number(rule.CANT || 0);
  }

  for (const bodega in allocations) {
    for (const ref in allocations[bodega]) {
      ensureRef(ref);
      summary.get(ref)!.allocated += allocations[bodega][ref].allocated;
    }
  }

  const summaryArray = Array.from(summary.entries()).map(([ref, data]) => ({
    'Referencia': ref,
    'Stock Inicial': data.stock,
    'Total Solicitado': data.requested,
    'Total Asignado': data.allocated,
    'Cumplimiento': data.requested > 0 ? `${Math.round((data.allocated / data.requested) * 100)}%` : 'N/A',
  }));

  summaryArray.sort((a, b) => a['Referencia'].localeCompare(b['Referencia']));

  return summaryArray;
};

export const generatePivotData = (allocations: Allocation | null) => {
    if (!allocations || Object.keys(allocations).length === 0) return { headers: [], data: [] };

    const allBodegas = Object.keys(allocations).sort();
    const pivotMap = new Map<string, any>();

    for (const bodega of allBodegas) {
        for (const ref in allocations[bodega]) {
            for (const item of allocations[bodega][ref].items) {
                const key = `${ref}-${item.talla}`;
                if (!pivotMap.has(key)) {
                    const newRow = {
                        'Referencia': ref,
                        'Talla': item.talla
                    };
                    allBodegas.forEach(b => {
                        (newRow as any)[b] = 0;
                    });
                    pivotMap.set(key, newRow);
                }
                const row = pivotMap.get(key);
                row[bodega] += item.quantity;
            }
        }
    }

    const data = Array.from(pivotMap.values()).sort((a, b) => {
        const refCompare = a.Referencia.localeCompare(b.Referencia);
        if (refCompare !== 0) return refCompare;
        return a.Talla.localeCompare(b.Talla, undefined, { numeric: true });
    });
    
    const headers = data.length > 0 ? Object.keys(data[0]) : [];

    return { headers, data };
};

const autoFitColumns = (sheet: any, data: any[]) => {
    if (!data || data.length === 0) return;
    const objectMaxLength: number[] = [];
    const header = Object.keys(data[0]);
    for (let i = 0; i < data.length; i++) {
        const value = Object.values(data[i]);
        for (let j = 0; j < value.length; j++) {
            const val = String(value[j] || '');
            objectMaxLength[j] = objectMaxLength[j] >= val.length ? objectMaxLength[j] : val.length;
        }
    }
    const cols = header.map((h, i) => ({
        wch: Math.max(h.length, objectMaxLength[i]) + 2
    }));
    sheet['!cols'] = cols;
}

export const exportDocumentsToExcel = (allocations: Allocation, coMap: { [key: string]: string }) => {
  const { documentosData, movimientosData } = generateDocumentSheetsData(allocations, coMap);
  if (documentosData.length === 0) {
    alert("No hay documentos para exportar con el mapeo actual.");
    return;
  }

  const workbook = XLSX.utils.book_new();
  
  const docSheet = XLSX.utils.json_to_sheet(documentosData);
  autoFitColumns(docSheet, documentosData);
  XLSX.utils.book_append_sheet(workbook, docSheet, 'Documentos');
  
  if (movimientosData.length > 0) {
      const movSheet = XLSX.utils.json_to_sheet(movimientosData);
      autoFitColumns(movSheet, movimientosData);
      XLSX.utils.book_append_sheet(workbook, movSheet, 'Movimientos');
  }

  XLSX.writeFile(workbook, 'documentos_reparto.xlsx', { bookType: 'xlsx', type: 'binary' });
};


export const exportSummaryToExcel = (
  allocations: Allocation,
  stock: StockItem[],
  plan: DistributionRule[],
  coMap: { [key: string]: string }
) => {
  const workbook = XLSX.utils.book_new();

  const { detalleDocumentosData } = generateDocumentSheetsData(allocations, coMap);
  if (detalleDocumentosData.length > 0) {
    const detalleSheet = XLSX.utils.json_to_sheet(detalleDocumentosData);
    autoFitColumns(detalleSheet, detalleDocumentosData);
    XLSX.utils.book_append_sheet(workbook, detalleSheet, 'Detalle Documentos');
  }

  const summaryData = generateSummaryData(stock, plan, allocations);
  if (summaryData.length > 0) {
    const summarySheet = XLSX.utils.json_to_sheet(summaryData);
    autoFitColumns(summarySheet, summaryData);
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Resumen General');
  }

  const detailData: { 'BODEGA': string; 'REFERENCIA': string; 'TALLA': string; 'CANTIDAD ASIGNADA': number; }[] = [];
  const sortedBodegas = Object.keys(allocations).sort();
  for (const bodega of sortedBodegas) {
    const references = allocations[bodega];
    const sortedReferences = Object.keys(references).sort();
    for (const ref of sortedReferences) {
      const details = references[ref];
      details.items.forEach(item => {
        detailData.push({
          'BODEGA': bodega,
          'REFERENCIA': ref,
          'TALLA': item.talla,
          'CANTIDAD ASIGNADA': item.quantity,
        });
      });
    }
  }
  if (detailData.length > 0) {
    const detailSheet = XLSX.utils.json_to_sheet(detailData);
    autoFitColumns(detailSheet, detailData);
    XLSX.utils.book_append_sheet(workbook, detailSheet, 'Distribucion Detallada');
  }

  const { data: pivotData } = generatePivotData(allocations);
  if (pivotData.length > 0) {
    const pivotSheet = XLSX.utils.json_to_sheet(pivotData);
    autoFitColumns(pivotSheet, pivotData);
    XLSX.utils.book_append_sheet(workbook, pivotSheet, 'Reparto por Bodega');
  }

  XLSX.writeFile(workbook, 'resumen_distribucion.xlsx', { bookType: 'xlsx', type: 'binary' });
};
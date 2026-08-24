import { useMemo } from 'react';
import React from 'react';
import type { 
  ExcelDataRow, 
  SlaAnalysisData, 
  FinalizedDocDetail, 
  PendingDocsAnalysisData, 
  PendingSummaryRecord, 
  PendingDocDetail, 
  AnalysisResult, 
  ReportData, 
  BrandSummaryByWarehouse 
} from '../types';
import { formatDate, parseDateString, normalizeDate, buildTfWarehouseKey } from '../utils/helpers';

export const useReportData = (
  baseData: ExcelDataRow[],
  columnMap: { [key: string]: string | undefined },
  selectedWarehouse: string,
  startDate: string,
  endDate: string,
  documentNumberFilter: string,
  routeStatusMap: Map<string, string>,
  /** Tras cruce Quick y/o empaque: filas sin estado → Validar con ambas tiendas */
  applyUnresolvedPlatformStatus = false
): ReportData => {
  return useMemo(() => {
    const { 
        fecha: FECHA_COL, 
        warehouse: WAREHOUSE_COL, 
        warehouseOut: WAREHOUSE_OUT_COL,
        doc: DOC_COL, 
        qty: QTY_COL, 
        image: IMAGE_LINK_COL, 
        estadoPlataforma: ESTADO_PLATAFORMA_COL,
        novedad: NOVEDAD_COL,
        fechaFinalizado: FECHA_FINALIZADO_PLATAFORMA_COL,
        marca: MARCA_COL,
        grupo: GRUPO_COL,
        estadoGeneral: ESTADO_GENERAL_COL,
        hoyRuta: HOY_RUTA_COL
    } = columnMap;

    // Claves sintéticas usadas al cruzar Quick/empaque si el Excel principal no trae esas columnas
    const hoyRutaField = HOY_RUTA_COL || 'hoyRuta';
    const estadoPlataformaField = ESTADO_PLATAFORMA_COL || 'estadoPlataforma';
    const fechaFinalizadoField = FECHA_FINALIZADO_PLATAFORMA_COL || 'fechaFinalizado';
    const imageField = IMAGE_LINK_COL || 'image';
    const estadoBodegaField = 'estadoBodega';

    const initialReturn: ReportData = {
        kpiData: { 
          totalDocs: '0', 
          deliveredCount: '0',
          pendingCount: '0',
          deliveredQty: '0',
          pendingQty: '0',
          compliancePercentage: '0.0%',
          uniqueTfCount: '0',
        },
        analysisData: [],
        dailyChartData: [],
        slaAnalysisData: [],
        pendingDocsAnalysisData: [],
        generalReport: {
            data: [],
            exportData: [],
            headers: ['FECHA', 'BOD. ENTRADA', 'NRO DOCUMENTO.2', 'CANTIDAD'],
        },
        deliveredDocsReport: {
            data: [],
            exportData: [],
            headers: [],
        },
        brandReport: {
            data: [],
            exportData: [],
            headers: [],
        },
        brandSummaryByWarehouse: [],
        deliveredDocsByWarehouse: [],
        pendingRows: [],
    };
    
    if (baseData.length === 0 || !FECHA_COL || !WAREHOUSE_COL || !DOC_COL || !QTY_COL) {
      return initialReturn;
    }
    
    const getUniqueDocKey = (row: ExcelDataRow): string => {
        const docNumber = String(row[DOC_COL!] || '');
        const warehouseIdentifier = String(row[WAREHOUSE_COL!] || '');
        return `${warehouseIdentifier}-${docNumber}`;
    };

    /** Misma prioridad que ESTADO PLATAFORMA del reporte general. */
    const classifyPlatformStatus = (row: ExcelDataRow): string => {
        const hoyVal = String(row[hoyRutaField] || row['hoyRuta'] || '').trim().toUpperCase();
        const platVal = String(row[estadoPlataformaField] || row['estadoPlataforma'] || '').trim().toUpperCase();
        const bodegaVal = String(row[estadoBodegaField] || '').trim().toUpperCase();
        const hasImage = Boolean(String(row[imageField] || row['image'] || '').trim());
        const hasFechaFin = Boolean(row[fechaFinalizadoField] || row['fechaFinalizado']);
        const routeKey = buildTfWarehouseKey(row[DOC_COL!], row[WAREHOUSE_COL!]);
        const routeStatus = routeKey ? routeStatusMap.get(routeKey) : undefined;

        if (
            platVal === 'ENTREGADO' ||
            platVal === 'FINALIZADO' ||
            hasImage ||
            hasFechaFin
        ) {
            return 'ENTREGADO';
        }

        const isHoyRuta =
            hoyVal === 'EN RUTA HOY' ||
            hoyVal === 'TRUE' ||
            platVal === 'EN RUTA HOY' ||
            routeStatus === 'EN RUTA HOY' ||
            routeStatus === 'ESTA EN RUTA' ||
            routeStatus === 'EN CARGUE';

        if (isHoyRuta) return 'EN RUTA HOY';

        if (bodegaVal === 'EN BODEGA' || platVal === 'EN BODEGA' || routeStatus === 'ESTA EN BODEGA PPAL') {
            return 'EN BODEGA';
        }

        if (platVal) return platVal;
        if (applyUnresolvedPlatformStatus) return 'VALIDAR CON AMBAS TIENDAS';
        return '';
    };

    let filteredRows = baseData;

    if (selectedWarehouse !== 'all') {
      filteredRows = filteredRows.filter(row => String(row[WAREHOUSE_COL!]) === selectedWarehouse);
    }

    if (documentNumberFilter) {
      const lowerFilter = documentNumberFilter.toLowerCase();
      filteredRows = filteredRows.filter(row => String(row[DOC_COL!]).toLowerCase().includes(lowerFilter));
    }
    
    const sDate = parseDateString(startDate);
    const eDate = parseDateString(endDate);
    
    if (sDate || eDate) {
      const inclusiveEDate = eDate ? new Date(Date.UTC(eDate.getUTCFullYear(), eDate.getUTCMonth(), eDate.getUTCDate(), 23, 59, 59, 999)) : null;

      filteredRows = filteredRows.filter(row => {
          const rowDate = normalizeDate(row[FECHA_COL!]);
          if (!rowDate) return false;
          if (sDate && rowDate < sDate) return false;
          if (inclusiveEDate && rowDate > inclusiveEDate) return false;
          return true;
      });
    }

    // --- Unificar por documento (bodega + NRO TF): 1 fila por TF, cantidad = suma de líneas ---
    const statusPriority = (status: string): number => {
        switch (status) {
            case 'ENTREGADO': return 40;
            case 'EN RUTA HOY': return 30;
            case 'EN BODEGA': return 20;
            case 'VALIDAR CON AMBAS TIENDAS': return 10;
            default: return status ? 5 : 0;
        }
    };

    const mergeUniqueLabels = (current: string, next: string): string => {
        const a = (current || '').trim();
        const b = (next || '').trim();
        if (!b || b === 'N/A') return a || b;
        if (!a || a === 'N/A') return b;
        const parts = a.split(',').map((p) => p.trim()).filter(Boolean);
        if (!parts.includes(b)) parts.push(b);
        return parts.join(', ');
    };

    const copyPlatformSignals = (target: ExcelDataRow, source: ExcelDataRow) => {
        const fields = [
            estadoPlataformaField, hoyRutaField, fechaFinalizadoField, imageField,
            'estadoPlataforma', 'hoyRuta', 'fechaFinalizado', 'image', 'estadoBodega',
        ];
        fields.forEach((field) => {
            if (!field) return;
            const val = source[field];
            if (val !== undefined && val !== null && String(val).trim() !== '') {
                target[field] = val;
            }
        });
    };

    const documentRowsMap = new Map<string, ExcelDataRow>();
    filteredRows.forEach((row) => {
        const key = getUniqueDocKey(row);
        const qty = Number(row[QTY_COL!] || 0);
        const existing = documentRowsMap.get(key);

        if (!existing) {
            const clone: ExcelDataRow = { ...row };
            clone[QTY_COL!] = qty;
            documentRowsMap.set(key, clone);
            return;
        }

        existing[QTY_COL!] = Number(existing[QTY_COL!] || 0) + qty;

        if (MARCA_COL) {
            existing[MARCA_COL] = mergeUniqueLabels(String(existing[MARCA_COL] || ''), String(row[MARCA_COL] || ''));
        }
        if (GRUPO_COL) {
            existing[GRUPO_COL] = mergeUniqueLabels(String(existing[GRUPO_COL] || ''), String(row[GRUPO_COL] || ''));
        }

        // Unir links de imagen si vienen en distintas líneas
        const existingImg = String(existing[imageField] || existing['image'] || '').trim();
        const rowImg = String(row[imageField] || row['image'] || '').trim();
        if (rowImg) {
            if (!existingImg) {
                existing[imageField] = rowImg;
                existing['image'] = rowImg;
            } else if (!existingImg.includes(rowImg)) {
                const merged = `${existingImg}|${rowImg}`;
                existing[imageField] = merged;
                existing['image'] = merged;
            }
        }

        const existingStatus = classifyPlatformStatus(existing);
        const rowStatus = classifyPlatformStatus(row);
        if (statusPriority(rowStatus) > statusPriority(existingStatus)) {
            copyPlatformSignals(existing, row);
        } else if (statusPriority(rowStatus) === statusPriority(existingStatus)) {
            // Completar fecha finalizado / evidencia si la fila actual no la tenía
            if (!(existing[fechaFinalizadoField] || existing['fechaFinalizado']) && (row[fechaFinalizadoField] || row['fechaFinalizado'])) {
                copyPlatformSignals(existing, row);
            }
        }
    });

    const documentRows = Array.from(documentRowsMap.values());

    const deliveredDocsKeys = new Set<string>();
    const uniqueTfCount = documentRows.length;
    const totalDocs = documentRows.length;

    const now = new Date();
    const currentDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    // --- KPIs por documento unificado; cantidades = suma de líneas ---
    let deliveredDocCount = 0;
    let pendingDocCount = 0;
    let deliveredQty = 0;
    let pendingQty = 0;

    documentRows.forEach((row) => {
        const key = getUniqueDocKey(row);
        const qty = Number(row[QTY_COL!] || 0);
        const status = classifyPlatformStatus(row);
        if (status === 'ENTREGADO') {
            deliveredDocCount++;
            deliveredQty += qty;
            deliveredDocsKeys.add(key);
        } else {
            pendingDocCount++;
            pendingQty += qty;
        }
    });

    const compliancePercentage =
        totalDocs > 0 ? ((deliveredDocCount / totalDocs) * 100).toFixed(1) + '%' : '0.0%';

    const deliveredDocsByWarehouseMap: { [warehouse: string]: Set<string> } = {};
    documentRows.forEach((row) => {
        const uniqueKey = getUniqueDocKey(row);
        if (deliveredDocsKeys.has(uniqueKey)) {
            const entryWarehouse = String(row[WAREHOUSE_COL!] || '');
            if (entryWarehouse) {
                if (!deliveredDocsByWarehouseMap[entryWarehouse]) {
                    deliveredDocsByWarehouseMap[entryWarehouse] = new Set();
                }
                deliveredDocsByWarehouseMap[entryWarehouse].add(String(row[DOC_COL!] || ''));
            }
        }
    });

    const deliveredDocsByWarehouse = Object.entries(deliveredDocsByWarehouseMap).map(([warehouse, docSet]) => ({
        warehouse,
        count: docSet.size,
    }));

    const kpiData = {
        totalDocs: totalDocs.toLocaleString('es-ES'),
        deliveredCount: deliveredDocCount.toLocaleString('es-ES'),
        pendingCount: pendingDocCount.toLocaleString('es-ES'),
        deliveredQty: deliveredQty.toLocaleString('es-ES'),
        pendingQty: pendingQty.toLocaleString('es-ES'),
        compliancePercentage,
        uniqueTfCount: uniqueTfCount.toLocaleString('es-ES'),
    };

    const warehouseSummary = filteredRows.reduce((acc, row) => {
        const warehouse = String(row[WAREHOUSE_COL!] || 'N/A');
        const uniqueKey = getUniqueDocKey(row);
        const quantity = Number(row[QTY_COL!] || 0);

        if (!acc[warehouse]) acc[warehouse] = { docs: new Set(), quantity: 0 };
        acc[warehouse].docs.add(uniqueKey);
        acc[warehouse].quantity += quantity;
        return acc;
    }, {} as { [key: string]: { docs: Set<string>, quantity: number } });

    const analysisData: AnalysisResult[] = Object.entries(warehouseSummary)
        .map(([name, data]) => ({
            name,
            documentos: data.docs.size,
            cantidad: data.quantity
        }))
        .sort((a, b) => b.documentos - a.documentos);

    const docsByDay = filteredRows.reduce((acc: Record<string, Set<string>>, row) => {
        const date = normalizeDate(row[FECHA_COL!]);
        if (!date) return acc;
        const formattedDate = formatDate(date);
        const docKey = getUniqueDocKey(row);
        if (!acc[formattedDate]) acc[formattedDate] = new Set<string>();
        acc[formattedDate].add(docKey);
        return acc;
    }, {} as Record<string, Set<string>>);
    
    const dailyChartData = Object.entries(docsByDay)
        .map(([date, docSet]) => ({ 'FECHA': date, 'Total Documentos': docSet.size }))
        .sort((a, b) => (parseDateString(a.FECHA)?.getTime() || 0) - (parseDateString(b.FECHA)?.getTime() || 0));
    
    // --- SLA / pendientes sobre documentos unificados ---
    const finalizedRecordsByWarehouse: { [warehouse: string]: FinalizedDocDetail[] } = {};
    const pendingDocsByWarehouse: { [warehouse: string]: ExcelDataRow[] } = {};

    documentRows.forEach((row) => {
        const uniqueKey = getUniqueDocKey(row);
        const warehouse = String(row[WAREHOUSE_COL!] || '');
        if (!warehouse) return;

        if (classifyPlatformStatus(row) !== 'ENTREGADO') {
            if (!pendingDocsByWarehouse[warehouse]) pendingDocsByWarehouse[warehouse] = [];
            pendingDocsByWarehouse[warehouse].push(row);
            return;
        }

        const fechaFin = normalizeDate(row[fechaFinalizadoField] || row['fechaFinalizado']);
        const docDate = normalizeDate(row[FECHA_COL!]);
        if (!fechaFin || !docDate) return;

        const diffTime = fechaFin.getTime() - docDate.getTime();
        const daysToFinalize = Math.max(0, Math.floor(diffTime / (1000 * 3600 * 24)));
        const isOverdue = daysToFinalize > 3;

        const linkValue = String(row[imageField] || row['image'] || '').trim();
        const links = linkValue.split('|').map((l) => l.trim()).filter((l) => l.startsWith('http'));

        const finalizedDetail: FinalizedDocDetail = {
            docNumber: String(row[DOC_COL!] || ''),
            finalizedDate: formatDate(fechaFin),
            daysToFinalize,
            isOverdue,
            imageLink: links[0],
            docDate: formatDate(docDate),
            quantity: Number(row[QTY_COL!] || 0),
            type: 'finalized',
            warehouseOut: WAREHOUSE_OUT_COL ? String(row[WAREHOUSE_OUT_COL] || 'N/A') : 'N/A',
        };

        if (!finalizedRecordsByWarehouse[warehouse]) finalizedRecordsByWarehouse[warehouse] = [];
        if (!finalizedRecordsByWarehouse[warehouse].some((r) => String(r.docNumber) === finalizedDetail.docNumber)) {
            finalizedRecordsByWarehouse[warehouse].push(finalizedDetail);
        }
    });

    const allPendingRows = Object.values(pendingDocsByWarehouse).flat() as ExcelDataRow[];

    const slaAnalysisData: SlaAnalysisData[] = Object.entries(finalizedRecordsByWarehouse)
    .map(([warehouseName, finalizedRecords]) => {
        const totalFinalized = finalizedRecords.length;
        const overdueCount = finalizedRecords.filter(r => r.isOverdue).length;
        const compliance = totalFinalized > 0 ? ((totalFinalized - overdueCount) / totalFinalized) * 100 : 100;
        return {
            warehouse: warehouseName,
            compliance: compliance,
            totalFinalized: totalFinalized,
            overdueCount: overdueCount,
            finalizedRecords: finalizedRecords.sort((a, b) => (parseDateString(a.finalizedDate)?.getTime() || 0) - (parseDateString(b.finalizedDate)?.getTime() || 0))
        };
    })
    .sort((a, b) => a.compliance - b.compliance);

    const totalPendingCountOverall = new Set(allPendingRows.map(row => getUniqueDocKey(row))).size;

    const pendingDocsAnalysisData: PendingDocsAnalysisData[] = Object.entries(pendingDocsByWarehouse)
    .map(([warehouseName, rows]) => {
        const uniqueDocs = new Set(rows.map(getUniqueDocKey));
        const totalPendingQuantity = rows.reduce((sum, row) => sum + Number(row[QTY_COL!] || 0), 0);
        const participationPercentage = totalPendingCountOverall > 0 ? (uniqueDocs.size / totalPendingCountOverall) * 100 : 0;

        const detailedRecords = rows.map(row => {
            const docDate = normalizeDate(row[FECHA_COL!]);
            if (!docDate) return null;

            const diffTime = currentDate.getTime() - docDate.getTime();
            const daysPending = Math.max(0, Math.floor(diffTime / (1000 * 3600 * 24)));
            const linkValue = IMAGE_LINK_COL ? String(row[IMAGE_LINK_COL!] || '').trim() : String(row['image'] || '').trim();
            const links = linkValue.split('|').map(l => l.trim()).filter(l => l.startsWith('http'));
            const docNumber = String(row[DOC_COL!] || '');
            const digitsOnly = docNumber.replace(/\D/g, '');
            const cleanDocNumber = digitsOnly ? String(Number(digitsOnly)) : null;

            let enRuta = '';
            const routeKey = buildTfWarehouseKey(row[DOC_COL!], row[WAREHOUSE_COL!]);
            const routeStatus = routeKey ? routeStatusMap.get(routeKey) : undefined;
            const hoyRutaRaw = String(row[hoyRutaField] || row['hoyRuta'] || '').trim().toUpperCase();
            const isInHoyRuta =
                hoyRutaRaw === 'EN RUTA HOY' ||
                hoyRutaRaw === 'TRUE' ||
                routeStatus === 'EN RUTA HOY';

            if (isInHoyRuta && (!routeStatus || routeStatus === 'EN RUTA HOY')) enRuta = 'EN RUTA HOY';
            else if (routeStatus) enRuta = routeStatus;
            else {
                const estadoGeneralValue = ESTADO_GENERAL_COL ? String(row[ESTADO_GENERAL_COL!] || '').trim().toLowerCase() : '';
                const estadoPlataformaValue = String(row[estadoPlataformaField] || row['estadoPlataforma'] || '').trim().toLowerCase();
                if (estadoGeneralValue === 'en tte' || estadoPlataformaValue === 'asignado') enRuta = 'ESTA EN RUTA';
                else if (estadoGeneralValue === 'pte envio' || estadoPlataformaValue === 'en bodega') enRuta = 'ESTA EN BODEGA PPAL';
                else enRuta = 'PREGUNTAR ALMACEN DE ORIGEN';
            }

            return {
                docNumber: docNumber,
                docKey: getUniqueDocKey(row),
                quantity: Number(row[QTY_COL!] || 0),
                marca: MARCA_COL ? String(row[MARCA_COL!] || 'N/A') : 'N/A',
                grupo: GRUPO_COL ? String(row[GRUPO_COL!] || 'N/A') : 'N/A',
                daysPending,
                imageLink: links[0],
                docDate: formatDate(docDate),
                enRuta: enRuta,
                warehouseOut: WAREHOUSE_OUT_COL ? String(row[WAREHOUSE_OUT_COL!] || 'N/A') : 'N/A',
            };
        }).filter((rec): rec is NonNullable<typeof rec> => rec !== null);

        const summaryByMarcaGrupo = detailedRecords.reduce((acc, record) => {
            const key = `${record.marca}-${record.grupo}`;
            if (!acc[key]) {
                acc[key] = {
                    marca: record.marca,
                    grupo: record.grupo,
                    docKeys: new Set<string>(),
                    totalQuantity: 0,
                    totalDaysPending: 0,
                    recordCount: 0,
                    detailedDocs: [],
                };
            }
            acc[key].docKeys.add(record.docKey);
            acc[key].totalQuantity += record.quantity;
            acc[key].totalDaysPending += record.daysPending;
            acc[key].recordCount += 1;
            acc[key].detailedDocs.push({
                docNumber: record.docNumber,
                quantity: record.quantity,
                daysPending: record.daysPending,
                imageLink: record.imageLink,
                docDate: record.docDate,
                enRuta: record.enRuta,
                warehouseOut: record.warehouseOut,
            });
            return acc;
        }, {} as { [key: string]: { marca: string; grupo: string; docKeys: Set<string>; totalQuantity: number; totalDaysPending: number; recordCount: number; detailedDocs: PendingDocDetail[] } });
        
        const pendingSummaryRecords: PendingSummaryRecord[] = Object.values(summaryByMarcaGrupo).map(summary => ({
            marca: summary.marca,
            grupo: summary.grupo,
            docCount: summary.docKeys.size,
            totalQuantity: summary.totalQuantity,
            avgDaysPending: summary.recordCount > 0 ? Math.round(summary.totalDaysPending / summary.recordCount) : 0,
            detailedDocs: summary.detailedDocs.sort((a,b) => b.daysPending - a.daysPending),
        })).sort((a,b) => b.avgDaysPending - a.avgDaysPending);

        return {
            warehouse: warehouseName,
            pendingCount: uniqueDocs.size,
            totalPendingQuantity,
            pendingRecords: pendingSummaryRecords,
            participationPercentage,
        };
    })
    .sort((a, b) => b.pendingCount - a.pendingCount);

    // FIX: Explicitly type the accumulator in the brandSummary reduce to avoid inference errors.
    const brandSummary = filteredRows.reduce<Record<string, number>>((acc, row) => {
        const brand = MARCA_COL ? String(row[MARCA_COL!] || 'SIN MARCA') : 'SIN MARCA';
        const quantity = Number(row[QTY_COL!] || 0);
        if (brand === 'SIN MARCA' && quantity === 0) return acc;
        // Access acc[brand] safely, default to 0, then add quantity.
        acc[brand] = (acc[brand] || 0) + quantity;
        return acc;
    }, {});

    const brandReportExportData = Object.entries(brandSummary)
        .map(([brand, quantity]) => ({
            'MARCA': brand,
            'CANTIDAD TOTAL': quantity,
        }))
        // FIX: Ensure both operands in sorting subtraction are treated as numbers.
        .sort((a, b) => Number(b['CANTIDAD TOTAL']) - Number(a['CANTIDAD TOTAL']));
    
    const brandReport = {
        data: brandReportExportData.map(item => ({
            ...item,
            'CANTIDAD TOTAL': item['CANTIDAD TOTAL'].toLocaleString('es-ES')
        })),
        exportData: brandReportExportData,
        headers: ['MARCA', 'CANTIDAD TOTAL']
    };

    const brandSummaryByWarehouseMap: { [warehouse: string]: { [brand: string]: { docs: Set<string>, quantity: number } } } = {};
    filteredRows.forEach(row => {
        const warehouse = String(row[WAREHOUSE_COL!] || '');
        const brand = MARCA_COL ? String(row[MARCA_COL!] || 'SIN MARCA') : 'SIN MARCA';
        const quantity = Number(row[QTY_COL!] || 0);
        const docKey = getUniqueDocKey(row);
        if (!brandSummaryByWarehouseMap[warehouse]) brandSummaryByWarehouseMap[warehouse] = {};
        if (!brandSummaryByWarehouseMap[warehouse][brand]) brandSummaryByWarehouseMap[warehouse][brand] = { docs: new Set(), quantity: 0 };
        brandSummaryByWarehouseMap[warehouse][brand].docs.add(docKey);
        brandSummaryByWarehouseMap[warehouse][brand].quantity += quantity;
    });

    const brandSummaryByWarehouse: BrandSummaryByWarehouse[] = Object.entries(brandSummaryByWarehouseMap).map(([warehouse, brands]) => ({
        warehouse,
        summary: Object.entries(brands).map(([brand, data]) => ({
            brand,
            docCount: data.docs.size,
            quantity: data.quantity,
        })).sort((a,b) => b.quantity - a.quantity)
    }));


    // --- NUEVA LÓGICA DE ESTADOS PARA EL REPORTE ---
    const desiredHeaders = [
        'FECHA', 'BOD. ENTRADA', 'BOD. SALIDA', 'NRO DOCUMENTO.2', 'CANTIDAD', 
        'ESTADO', 'ESTADO PLATAFORMA', 'LINK IMAGENES.1.1.1', 'FECHA FINALIZADO PLATAFORMA'
    ];
    
    const headerMappings = {
        'FECHA': { actual: FECHA_COL, type: 'date' },
        'BOD. ENTRADA': { actual: WAREHOUSE_COL, type: 'string' },
        'BOD. SALIDA': { actual: WAREHOUSE_OUT_COL, type: 'string' },
        'NRO DOCUMENTO.2': { actual: DOC_COL, type: 'string' },
        'CANTIDAD': { actual: QTY_COL, type: 'number' },
        'ESTADO': { actual: ESTADO_GENERAL_COL, type: 'string' },
        'ESTADO PLATAFORMA': { actual: estadoPlataformaField, type: 'statusOverride' },
        'LINK IMAGENES.1.1.1': { actual: imageField, type: 'link' },
        'FECHA FINALIZADO PLATAFORMA': { actual: fechaFinalizadoField, type: 'date' }
    };

    const resolvePlatformStatus = (row: ExcelDataRow): string => classifyPlatformStatus(row);

    const processRow = (row: ExcelDataRow, forExport: boolean) => {
        const record: { [key: string]: any } = {};

        desiredHeaders.forEach(header => {
            const mapping = headerMappings[header as keyof typeof headerMappings];
            if (!mapping || !mapping.actual) {
                record[header] = '';
                return;
            }

            if (mapping.type === 'statusOverride') {
                record[header] = resolvePlatformStatus(row);
                return;
            }

            const value = row[mapping.actual];
            if (forExport) {
                if (mapping.type === 'date') record[header] = formatDate(normalizeDate(value));
                else if (mapping.type === 'number') record[header] = Number(value ?? 0);
                else record[header] = String(value ?? '');
            } else {
                switch(mapping.type) {
                    case 'date': record[header] = formatDate(normalizeDate(value)); break;
                    case 'number': record[header] = Number(value ?? 0); break;
                    case 'link':
                        const linkStr = String(value ?? '').trim();
                        if (!linkStr) {
                            record[header] = '';
                            break;
                        }
                        
                        const links = linkStr.split('|').map(l => l.trim()).filter(l => l.startsWith('http'));
                        if (links.length === 0) {
                            record[header] = linkStr;
                            break;
                        }

                        record[header] = React.createElement('div', { className: 'flex gap-2' }, 
                            links.map((link, idx) => (
                                React.createElement('a', { 
                                    key: idx,
                                    href: link, 
                                    target: '_blank', 
                                    rel: 'noopener noreferrer', 
                                    className: 'text-blue-600 hover:underline flex items-center gap-1 bg-blue-50 px-2 py-1 rounded border border-blue-200 text-xs' 
                                }, `Evidencia ${idx + 1}`)
                            ))
                        );
                        break;
                    default: record[header] = String(value ?? '');
                }
            }
        });
        return record;
    };

    const deliveredReportExportData = documentRows
        .filter(row => deliveredDocsKeys.has(getUniqueDocKey(row)))
        .map(row => ({
            'FECHA': formatDate(normalizeDate(row[FECHA_COL!])),
            'BOD. ENTRADA': String(row[WAREHOUSE_COL!] || ''),
            'NRO DOCUMENTO.2': String(row[DOC_COL!] || ''),
            'CANTIDAD': Number(row[QTY_COL!] || 0),
            'ESTADO': 'ENTREGADO',
            'Origen de Estado': 'Cruce Plataforma / Quick',
        }));
    
    return {
      kpiData,
      analysisData,
      dailyChartData,
      slaAnalysisData,
      pendingDocsAnalysisData,
      generalReport: (() => {
        const sortedRows = [...documentRows].sort((a, b) => {
          const da = normalizeDate(a[FECHA_COL!])?.getTime() ?? 0;
          const db = normalizeDate(b[FECHA_COL!])?.getTime() ?? 0;
          return da - db; // más viejo → más nuevo
        });
        return {
          data: sortedRows.map(row => processRow(row, false)),
          exportData: sortedRows.map(row => processRow(row, true)),
          headers: desiredHeaders.filter(h => headerMappings[h as keyof typeof headerMappings]?.actual),
          lineCount: sortedRows.length,
          uniqueTfCount,
        };
      })(),
      deliveredDocsReport: {
        data: [],
        exportData: deliveredReportExportData,
        headers: ['FECHA', 'BOD. ENTRADA', 'NRO DOCUMENTO.2', 'CANTIDAD', 'ESTADO', 'Origen de Estado'],
      },
      brandReport,
      brandSummaryByWarehouse,
      deliveredDocsByWarehouse,
      pendingRows: allPendingRows,
    };
  }, [baseData, columnMap, selectedWarehouse, startDate, endDate, documentNumberFilter, routeStatusMap, applyUnresolvedPlatformStatus]);
};

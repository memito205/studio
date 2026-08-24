import * as XLSX from 'xlsx';
import type { SlaAnalysisData, PendingDocsAnalysisData, AnalysisResult, BrandSummaryRecord, PendingSummaryRecord, FinalizedDocDetail, VehiclePlan, ObservationSummary, EntregasPorVehiculo, ExcelDataRow, PendingGoodsItem, PendingDocDetail, RouteTask } from '../types';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export const docNumberMapping: { [key: string]: string } = {
    'B1': '201', 'B2': '202', 'B3': '203', 'B4': '204', 'B5': '206',
    'B6': '206', 'B7': '307', 'B8': '208', 'B9': '209', 'B10': '210',
    'B11': '211', 'B12': '212', 'B13': '313', 'B14': '214', 'B15': '315',
    'B16': '216', 'B17': '417', 'B18': '218', 'B19': '319', 'B20': '220',
    'B21': '221', 'B22': '222', 'B23': '223', 'MOLINOS': '303', 'GARANTIAS': '996',
    'PIONEROS': '997', 'BODVI': '998', 'TRYNO': '994', 'BODPP': '999', 'OFICINA': '990',
    'TRASLADOS': '991'
};


const toTitleCase = (str: string): string => {
    if (!str) return "";
    return str.toLowerCase().replace(/\b(\w)/g, s => s.toUpperCase());
};

export const formatDate = (date: any): string => {
    if (date instanceof Date && !isNaN(date.getTime())) {
      const day = String(date.getUTCDate()).padStart(2, '0');
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      const year = date.getUTCFullYear();
      return `${day}/${month}/${year}`;
    }
    return String(date || 'N/D');
};
  
export const parseDateString = (dateStr: string): Date | null => {
    if (typeof dateStr !== 'string' || !dateStr) return null;

    if (dateStr.includes('-')) {
        const parts = dateStr.split('-');
        if (parts.length === 3) {
            const year = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10);
            const day = parseInt(parts[2], 10);
            if (!isNaN(year) && !isNaN(month) && !isNaN(day) && year > 1000) {
                const date = new Date(Date.UTC(year, month - 1, day));
                if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
                    return date;
                }
            }
        }
    }
    
    const parts = dateStr.split('/');
    if (parts.length === 3) {
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);
        const year = parseInt(parts[2], 10);
        if (!isNaN(day) && !isNaN(month) && !isNaN(year) && year > 1000) {
            const date = new Date(Date.UTC(year, month - 1, day));
            if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
                return date;
            }
        }
    }
    return null;
};

export const normalizeDate = (dateValue: any): Date | null => {
    if (!dateValue) return null;
    if (dateValue instanceof Date) {
      if (!isNaN(dateValue.getTime())) {
        return new Date(Date.UTC(dateValue.getUTCFullYear(), dateValue.getUTCMonth(), dateValue.getUTCDate()));
      }
      return null;
    }
    if (typeof dateValue === 'string') {
      return parseDateString(dateValue);
    }
    return null;
};

/** YYYY-MM-DD en calendario local (Colombia) — evita desfases UTC al comparar “hoy”. */
export const getCalendarDateKey = (dateValue: any): string | null => {
    if (dateValue == null || dateValue === '') return null;

    if (dateValue instanceof Date && !isNaN(dateValue.getTime())) {
        const y = dateValue.getFullYear();
        const m = String(dateValue.getMonth() + 1).padStart(2, '0');
        const d = String(dateValue.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    if (typeof dateValue === 'number' && !isNaN(dateValue)) {
        // Serial Excel → día UTC del serial
        const excelEpoch = Date.UTC(1899, 11, 30);
        const dt = new Date(excelEpoch + dateValue * 86400000);
        return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
    }

    if (typeof dateValue === 'string') {
        const parsed = parseDateString(dateValue.trim());
        if (!parsed) return null;
        return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}-${String(parsed.getUTCDate()).padStart(2, '0')}`;
    }

    return null;
};

export const getTodayCalendarKey = (): string => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

export const normalizeDocId = (val: any): string => {
    const strVal = String(val || '').trim();
    const digitsOnly = strVal.replace(/\D/g, '');
    return digitsOnly ? String(Number(digitsOnly)) : '';
};

/** Clave de cruce TF + almacén destino (misma TF puede ir a destinos distintos). */
export const buildTfWarehouseKey = (tf: any, warehouse: any): string => {
    const doc = normalizeDocId(tf);
    const whs = String(warehouse || '').trim().toUpperCase();
    if (!doc || !whs) return '';
    return `${doc}|${whs}`;
};

export const findHeader = (headers: string[], potentialNames: string[]): string | undefined => {
    const normalize = (str: string) =>
        (str || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');

    const normalizedPotentialNames = potentialNames.map(normalize);

    for (const header of headers) {
        const normalizedHeader = normalize(header);
        if (normalizedPotentialNames.includes(normalizedHeader)) {
            return header;
        }
    }

    return undefined;
};

export const getWeekStartDate = (date: Date): Date => {
    const d = new Date(date.getTime());
    const dayOfWeek = d.getUTCDay();
    const diff = d.getUTCDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    return new Date(d.setUTCDate(diff));
};

export const exportToExcel = (data: { [key: string]: any }[], fileName: string) => {
    if (typeof XLSX === 'undefined') {
        alert('La librería de exportación (XLSX) no está disponible.');
        return;
    }
    try {
        const worksheet = XLSX.utils.json_to_sheet(data);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Reporte');
        const safeFileName = fileName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        XLSX.writeFile(workbook, `${safeFileName}_${new Date().toISOString().slice(0,10)}.xlsx`);
    } catch (error) {
        console.error("Error al exportar a Excel:", error);
        alert("Ocurrió un error al intentar generar el archivo de Excel.");
    }
};

export const generateDailySummaryPdf = (
    rimData: ObservationSummary[],
    vxmData: ObservationSummary[],
    entregasData: EntregasPorVehiculo[],
    pendingGoodsData: PendingGoodsItem[]
) => {
const doc = new jsPDF({ orientation: 'l', unit: 'mm', format: 'a4' });
    const marginLeft = 15;
    let cursorY = 20;
    const todayStr = new Date().toISOString().split('T')[0];

    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('Resumen de Procesos de Bodega', marginLeft, cursorY);
    cursorY += 8;
    doc.setFontSize(10);
    doc.setTextColor(150);
    doc.setFont('helvetica', 'normal');
    const generationDate = new Date();
    doc.text(`Generado el: ${generationDate.toLocaleDateString('es-ES')} ${generationDate.toLocaleTimeString('es-ES')}`, marginLeft, cursorY);

    cursorY += 15;

    const combinedDataForDeltas = [...rimData, ...vxmData].filter(item => item.hasDeltas);
    if (combinedDataForDeltas.length > 0) {
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0, 102, 204);
        doc.text('ANÁLISIS DE AVANCE Y PROYECCIÓN POR ETAPAS', marginLeft, cursorY);
        cursorY += 8;

        const advanceHead = [['Proceso', 'Tipo', 'Unidades Hoy (Empaque)', 'Pendiente', 'Avance Etapa 1 (Est.)', 'Avance Etapa 2 (Est.)']];
        
        // Totales para la fila final
        const totals = {
            unitsTodayPacking: 0,
            pendingPacking: 0,
            totalQty: 0,
            unitsTodayS1: 0,
            pendingS1: 0,
            unitsTodayS2: 0,
            pendingS2: 0
        };

        const advanceBody = combinedDataForDeltas.map(item => {
            const qty = item.totalQuantity || 0;
            const rhythm = item.deltaPacked || 0;
            const pendingPacked = Math.max(0, qty - (item.totalPacked || 0));
            
            totals.totalQty += qty;
            totals.unitsTodayPacking += rhythm;
            totals.pendingPacking += pendingPacked;

            // Función auxiliar para proyección por etapa
            const getStageData = (currentPct: number, deltaPct: number) => {
                const unitsProcessedToday = Math.round((deltaPct / 100) * qty);
                const unitsAlreadyDone = Math.round((currentPct / 100) * qty);
                const unitsPending = Math.max(0, qty - unitsAlreadyDone);
                return { unitsProcessedToday, unitsPending };
            };

            const s1 = item.isVXM 
                ? getStageData(item.revisionCalidadPorcentaje || 0, item.deltaCalidad || 0) 
                : getStageData(item.conteoPorcentaje || 0, item.deltaConteo || 0);
            
            const s2 = item.isVXM 
                ? getStageData(item.remisionPorcentaje || 0, item.deltaRemision || 0) 
                : getStageData(item.etiquetadoPorcentaje || 0, item.deltaEtiquetado || 0);

            totals.unitsTodayS1 += s1.unitsProcessedToday;
            totals.pendingS1 += s1.unitsPending;
            totals.unitsTodayS2 += s2.unitsProcessedToday;
            totals.pendingS2 += s2.unitsPending;

            const formatCell = (label: string, delta: number, unitsToday: number, unitsPending: number) => {
                let projection = '';
                if (unitsPending <= 0) projection = '(Completado)';
                else if (unitsToday > 0) projection = `(Faltan: ${Math.ceil(unitsPending / unitsToday)} d)`;
                else projection = '(Sin ritmo)';
                return `${label}: +${delta}% (${unitsToday} unds)\n${projection}`;
            };

            const packingProjection = pendingPacked <= 0 ? '(Completado)' : (rhythm > 0 ? `(Faltan: ${Math.ceil(pendingPacked / rhythm)} d)` : '(Sin ritmo)');

            return [
                item.observation.toUpperCase(),
                item.isVXM ? 'VXM' : 'RIM',
                `${rhythm.toLocaleString('es-ES')} unds\n${packingProjection}`,
                `${pendingPacked.toLocaleString('es-ES')} unds`,
                formatCell(item.isVXM ? 'Calidad' : 'Conteo', item.isVXM ? (item.deltaCalidad || 0) : (item.deltaConteo || 0), s1.unitsProcessedToday, s1.unitsPending),
                formatCell(item.isVXM ? 'Remisión' : 'Etiquetado', item.isVXM ? (item.deltaRemision || 0) : (item.deltaEtiquetado || 0), s2.unitsProcessedToday, s2.unitsPending)
            ];
        });

        // AGREGAR FILA DE TOTALES
        const totalPackingProjection = totals.pendingPacking <= 0 ? '(Completado)' : (totals.unitsTodayPacking > 0 ? `(Faltan: ${Math.ceil(totals.pendingPacking / totals.unitsTodayPacking)} d)` : '(Sin ritmo)');
        const totalS1Projection = totals.pendingS1 <= 0 ? '(Completado)' : (totals.unitsTodayS1 > 0 ? `(Faltan: ${Math.ceil(totals.pendingS1 / totals.unitsTodayS1)} d)` : '(Sin ritmo)');
        const totalS2Projection = totals.pendingS2 <= 0 ? '(Completado)' : (totals.unitsTodayS2 > 0 ? `(Faltan: ${Math.ceil(totals.pendingS2 / totals.unitsTodayS2)} d)` : '(Sin ritmo)');

        advanceBody.push([
            'TOTAL GENERAL',
            '-',
            `${totals.unitsTodayPacking.toLocaleString('es-ES')} unds\n${totalPackingProjection}`,
            `${totals.pendingPacking.toLocaleString('es-ES')} unds`,
            `Total Etapa 1: ${totals.unitsTodayS1.toLocaleString('es-ES')} unds\n${totalS1Projection}`,
            `Total Etapa 2: ${totals.unitsTodayS2.toLocaleString('es-ES')} unds\n${totalS2Projection}`
        ]);

        autoTable(doc, {
            startY: cursorY,
            head: advanceHead,
            body: advanceBody,
            theme: 'grid',
            headStyles: { fillColor: '#3b82f6', textColor: '#ffffff' },
            styles: { fontSize: 7.5, cellPadding: 2, valign: 'middle' },
            columnStyles: {
                2: { cellWidth: 40 },
                4: { cellWidth: 45 },
                5: { cellWidth: 45 }
            },
            didParseCell: (data: any) => {
                const isTotalRow = data.row.index === advanceBody.length - 1;
                if (isTotalRow) {
                    data.cell.styles.fontStyle = 'bold';
                    data.cell.styles.fillColor = '#f1f5f9';
                }
                if (data.section === 'body' && (data.column.index === 2 || data.column.index === 4 || data.column.index === 5)) {
                    if (data.cell.raw.includes('(Sin ritmo)')) {
                        data.cell.styles.textColor = '#b91c1c';
                    } else if (data.cell.raw.includes('(Completado)')) {
                        data.cell.styles.textColor = '#15803d';
                    }
                }
            }
        });
        
        cursorY = (doc as any).lastAutoTable.finalY + 5;
        doc.setFontSize(8);
        doc.setTextColor(100);
        doc.setFont('helvetica', 'italic');
        doc.text('* La columna "Sin ritmo" indica que el proceso está frenado o no ha avanzado el día de hoy.', marginLeft, cursorY);
        cursorY += 4;
        doc.text('* Las proyecciones (Faltan: X d) asumen que se mantendrá el mismo ritmo de producción de hoy en los días siguientes.', marginLeft, cursorY);
        
        cursorY += 15;
    }

    if (rimData.length > 0) {
        if (cursorY + 30 > doc.internal.pageSize.getHeight()) { doc.addPage(); cursorY = 20; }
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(40, 40, 40);
        doc.text('Resumen General por Proceso (RIM)', marginLeft, cursorY);
        cursorY += 8;

        const rimTotals = rimData.reduce((acc, curr) => ({ q: acc.q + curr.totalQuantity, p: acc.p + curr.totalPacked }), { q: 0, p: 0 });

        const summaryHead = [['PROCESO', 'F. PROCESO', 'F. ENTREGA', 'OBSERVACIÓN', 'CONTEO', 'ETIQUETADO', 'CANT. PEDIDA', 'CANT. EMPACADA', '%']];
        const summaryBody = rimData.map(item => {
            const isOverdue = item.fechaEntrega && item.fechaEntrega <= todayStr && item.packedPercentage < 100;
            const prefix = isOverdue ? '[ATRASADO] ' : '';
            return [
                prefix + item.observation.toUpperCase(),
                item.fechaObs,
                item.fechaEntrega ? (item.fechaEntrega.includes('/') ? item.fechaEntrega : formatDate(parseDateString(item.fechaEntrega))) : 'N/A',
                item.procesoObservacion || '',
                item.conteoPorcentaje,
                item.etiquetadoPorcentaje,
                item.totalQuantity.toLocaleString('es-ES'),
                item.totalPacked.toLocaleString('es-ES'),
                `${item.packedPercentage.toFixed(0)}%`
            ];
        });

        summaryBody.push([
            'TOTALES RIM', '', '', '', '', '', 
            rimTotals.q.toLocaleString('es-ES'), 
            rimTotals.p.toLocaleString('es-ES'), 
            `${rimTotals.q > 0 ? ((rimTotals.p / rimTotals.q) * 100).toFixed(0) : 0}%`
        ]);

        autoTable(doc, {
            startY: cursorY,
            head: summaryHead,
            body: summaryBody,
            theme: 'grid',
            headStyles: { fillColor: '#1e40af', textColor: '#ffffff' },
            styles: { fontSize: 7.5, cellPadding: 1.5, valign: 'middle' },
            columnStyles: { 0: { cellWidth: 35 }, 3: { cellWidth: 40 }, 4: { cellWidth: 25 }, 5: { cellWidth: 25 } },
            didParseCell: (data: any) => {
                if (data.row.index === summaryBody.length - 1) {
                    data.cell.styles.fontStyle = 'bold';
                    data.cell.styles.fillColor = '#f1f5f9';
                }
                if (data.section === 'body' && data.column.index === 0 && String(data.cell.raw || '').includes('[ATRASADO]')) {
                    data.cell.styles.textColor = '#dc2626';
                    data.cell.styles.fontStyle = 'bold';
                }
            },
            didDrawCell: (data: any) => {
                if (data.section === 'body' && data.row.index < summaryBody.length - 1) {
                    const item = rimData[data.row.index];
                    if (!item) return;
                    const drawProgressBar = (percentage: number, color: [number, number, number]) => {
                        const barHeight = 3, textPadding = 1.5;
                        doc.setFillColor(255, 255, 255);
                        doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height, 'F');
                        const text = `${percentage}%`;
                        const textWidth = doc.getTextWidth(text);
                        const availableWidth = data.cell.width - textWidth - (textPadding * 3);
                        const barX = data.cell.x + textPadding, barY = data.cell.y + (data.cell.height - barHeight) / 2;
                        doc.setFillColor(229, 231, 235);
                        doc.rect(barX, barY, availableWidth, barHeight, 'F');
                        const barWidth = availableWidth * (Math.min(100, Math.max(0, percentage)) / 100);
                        doc.setFillColor(color[0], color[1], color[2]);
                        doc.rect(barX, barY, barWidth, barHeight, 'F');
                        doc.setTextColor(40, 40, 40);
                        doc.setFontSize(7);
                        doc.text(text, barX + availableWidth + textPadding, data.cell.y + data.cell.height / 2, { baseline: 'middle' });
                    };
                    if (data.column.index === 4) drawProgressBar(item.conteoPorcentaje ?? 0, [59, 130, 246]);
                    if (data.column.index === 5) drawProgressBar(item.etiquetadoPorcentaje ?? 0, [168, 85, 247]);
                }
            }
        });
        cursorY = (doc as any).lastAutoTable.finalY + 15;
    }
    
    if (vxmData.length > 0) {
        if (cursorY + 30 > doc.internal.pageSize.getHeight()) { doc.addPage(); cursorY = 20; }
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(40, 40, 40);
        doc.text('Resumen General por Proceso (VXM)', marginLeft, cursorY);
        cursorY += 8;

        const vxmTotals = vxmData.reduce((acc, curr) => ({ q: acc.q + curr.totalQuantity, p: acc.p + curr.totalPacked }), { q: 0, p: 0 });

        const vxmHead = [['PROCESO', 'F. PROCESO', 'F. ENTREGA', 'OBSERVACIÓN', 'CALIDAD', 'REMISIÓN', 'CANT. PEDIDA', 'CANT. EMPACADA', '%']];
        const vxmBody = vxmData.map(item => {
            const isOverdue = item.fechaEntrega && item.fechaEntrega <= todayStr && item.packedPercentage < 100;
            const prefix = isOverdue ? '[ATRASADO] ' : '';
            return [
                prefix + item.observation.toUpperCase(),
                item.fechaObs,
                item.fechaEntrega ? (item.fechaEntrega.includes('/') ? item.fechaEntrega : formatDate(parseDateString(item.fechaEntrega))) : 'N/A',
                item.procesoObservacion || '',
                item.revisionCalidadPorcentaje,
                item.remisionPorcentaje,
                item.totalQuantity.toLocaleString('es-ES'),
                item.totalPacked.toLocaleString('es-ES'),
                `${item.packedPercentage.toFixed(0)}%`
            ];
        });

        vxmBody.push([
            'TOTALES VXM', '', '', '', '', '', 
            vxmTotals.q.toLocaleString('es-ES'), 
            vxmTotals.p.toLocaleString('es-ES'), 
            `${vxmTotals.q > 0 ? ((vxmTotals.p / vxmTotals.q) * 100).toFixed(0) : 0}%`
        ]);

        autoTable(doc, {
            startY: cursorY,
            head: vxmHead,
            body: vxmBody,
            theme: 'grid',
            headStyles: { fillColor: '#0284c7', textColor: '#ffffff' },
            styles: { fontSize: 7.5, cellPadding: 1.5, valign: 'middle' },
            columnStyles: { 0: { cellWidth: 35 }, 3: { cellWidth: 40 }, 4: { cellWidth: 25 }, 5: { cellWidth: 25 } },
            didParseCell: (data: any) => {
                if (data.row.index === vxmBody.length - 1) {
                    data.cell.styles.fontStyle = 'bold';
                    data.cell.styles.fillColor = '#f0f9ff';
                }
                if (data.section === 'body' && data.column.index === 0 && String(data.cell.raw || '').includes('[ATRASADO]')) {
                    data.cell.styles.textColor = '#dc2626';
                    data.cell.styles.fontStyle = 'bold';
                }
            },
            didDrawCell: (data: any) => {
                if (data.section === 'body' && data.row.index < vxmBody.length - 1) {
                    const item = vxmData[data.row.index];
                    if (!item) return;
                    const drawProgressBar = (percentage: number, color: [number, number, number]) => {
                         const barHeight = 3, textPadding = 1.5;
                        doc.setFillColor(255, 255, 255);
                        doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height, 'F');
                        const text = `${percentage}%`;
                        const textWidth = doc.getTextWidth(text);
                        const availableWidth = data.cell.width - textWidth - (textPadding * 3);
                        const barX = data.cell.x + textPadding, barY = data.cell.y + (data.cell.height - barHeight) / 2;
                        doc.setFillColor(229, 231, 235);
                        doc.rect(barX, barY, availableWidth, barHeight, 'F');
                        const barWidth = availableWidth * (Math.min(100, Math.max(0, percentage)) / 100);
                        doc.setFillColor(color[0], color[1], color[2]);
                        doc.rect(barX, barY, barWidth, barHeight, 'F');
                        doc.setTextColor(40, 40, 40);
                        doc.setFontSize(7);
                        doc.text(text, barX + availableWidth + textPadding, data.cell.y + data.cell.height / 2, { baseline: 'middle' });
                    };
                    if (data.column.index === 4) drawProgressBar(item.revisionCalidadPorcentaje ?? 0, [14, 165, 233]);
                    if (data.column.index === 5) drawProgressBar(item.remisionPorcentaje ?? 0, [99, 102, 241]);
                }
            }
        });
        cursorY = (doc as any).lastAutoTable.finalY + 15;
    }

    if (pendingGoodsData.length > 0) {
        if (cursorY + 30 > doc.internal.pageSize.getHeight()) { doc.addPage(); cursorY = 20; }
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(40, 40, 40);
        doc.text('Mercancía Pendiente por Ingresar', marginLeft, cursorY);
        cursorY += 8;

        const pendingHead = [['Marca', 'Cantidad a Ingresar', 'Fecha Aprox. de Ingreso']];
        const pendingBody = pendingGoodsData.map(item => [
            item.marca,
            item.cantidadEntrada.toLocaleString('es-ES'),
            item.fechaEntradaAprox ? (item.fechaEntradaAprox.includes('/') ? item.fechaEntradaAprox : formatDate(parseDateString(item.fechaEntradaAprox))) : 'N/D'
        ]);

        autoTable(doc, {
            startY: cursorY,
            head: pendingHead,
            body: pendingBody,
            theme: 'grid',
            headStyles: { fillColor: '#f97316', textColor: '#ffffff' },
            styles: { fontSize: 8.5, cellPadding: 2, valign: 'middle' },
            columnStyles: { 1: { halign: 'right' } }
        });
        cursorY = (doc as any).lastAutoTable.finalY + 15;
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    doc.save(`Resumen_Diario_Bodega_${dateStr}.pdf`);
};

export const generateVehiclePlanPdf = (plans: VehiclePlan[]) => {
const plansWithTasks = plans.filter(p => p.tasks.length > 0 && p.name.toUpperCase() !== 'TAREAS SIN ASIGNAR');
    
    if (plansWithTasks.length === 0) {
        alert('No hay tareas asignadas a vehículos para generar el PDF.');
        return;
    }

    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    const marginLeft = 15;
    let cursorY = 20;

    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('Plan de Ruta Detallado por Vehículo', marginLeft, cursorY);
    cursorY += 8;
    doc.setFontSize(10);
    doc.setTextColor(150);
    doc.setFont('helvetica', 'normal');
    doc.text(`Generado el: ${new Date().toLocaleDateString('es-ES')}`, marginLeft, cursorY);
    cursorY = 40;

    plansWithTasks.forEach(plan => {
        const allTasks = plan.tasks;
            
        if (allTasks.length === 0) return;
        
        const tableBody = allTasks.map(task => [
            task.order,
            task.type,
            task.tf,
            task.valor,
        ]);
        
        const estimatedHeight = 10 + 10 + (tableBody.length * 8) + 15;
        if (cursorY + estimatedHeight > doc.internal.pageSize.getHeight() - 20) {
            doc.addPage();
            cursorY = 20;
        }

        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(40, 40, 40);
        doc.text(`Vehículo: ${plan.name}`, marginLeft, cursorY);
        cursorY += 8;
        
        autoTable(doc, {
            startY: cursorY,
            head: [['Orden', 'Tipo', 'Número TF', 'Ubicación / Valor']],
            body: tableBody,
            theme: 'grid',
            headStyles: { fillColor: '#1e3a8a', textColor: '#ffffff', fontStyle: 'bold' },
            styles: { fontSize: 9, cellPadding: 2.5 },
            didParseCell: (data: any) => {
                const taskType = data.row.raw[1]; 
                
                if (data.section === 'body') {
                    if (taskType === 'RECOGER') {
                        data.cell.styles.fillColor = '#fed7aa'; 
                        data.cell.styles.textColor = '#7c2d12'; 
                    } else if (taskType === 'ENTREGAR') {
                        data.cell.styles.fillColor = '#dcfce7';
                        data.cell.styles.textColor = '#14532d';
                    }
                }
            }
        });

        cursorY = (doc as any).lastAutoTable.finalY + 15;
    });

    const dateStr = new Date().toISOString().slice(0, 10);
    doc.save(`Plan_de_Ruta_Detallado_${dateStr}.pdf`);
};

export const generateCajonReportPdf = (vehiclePlans: VehiclePlan[]) => {
const doc = new jsPDF({ orientation: 'l', unit: 'mm', format: 'a4' });
    const marginLeft = 15;
    let cursorY = 20;

    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(40, 40, 40);
    doc.text('REPORTE DE DEVOLUCIONES (CAJÓN)', marginLeft, cursorY);
    cursorY += 10;
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.setFont('helvetica', 'normal');
    doc.text(`Generado el: ${new Date().toLocaleString('es-ES')}`, marginLeft, cursorY);
    cursorY += 15;

    let hasData = false;

    vehiclePlans.forEach(plan => {
        const cajonTasks = plan.tasks.filter(t => 
            t.valor === 'CAJON NORTE' || 
            t.valor === 'BODEGA' || 
            String(t.observaciones).toLowerCase().includes('pendiente')
        );

        if (cajonTasks.length > 0) {
            hasData = true;
            if (cursorY + 50 > doc.internal.pageSize.getHeight()) { doc.addPage(); cursorY = 20; }

            doc.setFontSize(16);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(190, 30, 30); 
            doc.text(`Vehículo: ${plan.name}`, marginLeft, cursorY);
            cursorY += 8;

            const body = cajonTasks.map(t => {
                let destino = 'BODEGA';
                if (t.observaciones.includes('PARA ENTREGA EN ')) {
                    const match = t.observaciones.match(/PARA ENTREGA EN ([^-\s\.,]+)/);
                    destino = match ? match[1] : 'S/D';
                }
                
                const recogidaEn = t.observaciones
                    .replace('Entrega pendiente de ítem recogido en: ', '')
                    .replace(/PARA ENTREGA EN .*/, '')
                    .trim();

                return [
                    t.tf,
                    t.type,
                    recogidaEn || 'ORIGEN DESCONOCIDO',
                    destino,
                    t.valor === 'CAJON NORTE' ? 'CAJÓN' : 'BODEGA'
                ];
            });

            autoTable(doc, {
                startY: cursorY,
                head: [['Nro TF', 'Tipo', 'Recogido En', 'Tienda Destino', 'Estado Final']],
                body: body,
                theme: 'grid',
                headStyles: { fillColor: '#e11d48', textColor: '#ffffff', fontStyle: 'bold' },
                styles: { fontSize: 9, cellPadding: 3 },
                columnStyles: {
                    2: { fontStyle: 'bold' },
                    3: { fontStyle: 'bold', textColor: '#b91c1c' }
                }
            });
            cursorY = (doc as any).lastAutoTable.finalY + 15;
        }
    });

    if (!hasData) {
        doc.setFontSize(14);
        doc.setTextColor(120);
        doc.text('No hay artículos reportados en el cajón para la ruta de hoy.', marginLeft, cursorY);
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    doc.save(`Reporte_Detallado_Cajon_${dateStr}.pdf`);
};

export const generatePendingSummaryPdf = (data: { [key: string]: any }[]) => {
const doc = new jsPDF({ orientation: 'l', unit: 'mm', format: 'a4' });
    const pageTitle = "Reporte de Documentos Pendientes (Pte Envío / En Cargue)";
    const generatedDate = `Generado el: ${new Date().toLocaleDateString('es-ES')} ${new Date().toLocaleTimeString('es-ES')}`;
    const marginLeft = 10;
    const marginRight = 10;
    let cursorY = 20;
  
    const drawHeader = () => {
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text(pageTitle, marginLeft, 20);
        doc.setFontSize(11);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100);
        doc.text(generatedDate, marginLeft, 27);
        doc.setTextColor(0);
    };

    drawHeader();
    cursorY += 15;

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Resumen por Bodega de Entrada', marginLeft, cursorY);
    cursorY += 8;

    const summaryByWarehouse = data.reduce((acc, row) => {
        const warehouse = String(row['BOD. ENTRADA']);
        const quantity = Number(row['CANTIDAD']);
        const docNumber = String(row['NRO DOCUMENTO.2']);
    
        if (!acc[warehouse]) {
            acc[warehouse] = { quantity: 0, docs: new Set<string>() };
        }
    
        acc[warehouse].quantity += quantity;
        acc[warehouse].docs.add(docNumber);
    
        return acc;
    }, {} as { [wh: string]: { quantity: number; docs: Set<string> } });

    const summaryBodyData = Object.entries(summaryByWarehouse)
        .map(([warehouse, { quantity, docs }]) => ({ warehouse, docCount: docs.size, quantity }))
        .sort((a, b) => b.docCount - a.docCount);

    const summaryBody = summaryBodyData.map(item => [
        item.warehouse,
        item.docCount,
        item.quantity.toLocaleString('es-ES')
    ]);

    const totalDocsSummary = new Set(data.map(r => r['NRO DOCUMENTO.2'])).size;
    const totalQuantitySummary = data.reduce((sum, r) => sum + Number(r['CANTIDAD']), 0);
    const totalRowSummary = ['TOTAL', totalDocsSummary, totalQuantitySummary.toLocaleString('es-ES')];
    summaryBody.push(totalRowSummary);
    
    autoTable(doc, {
        startY: cursorY,
        head: [['Bodega de Entrada', 'Total Documentos', 'Cantidad Total Pendiente']],
        body: summaryBody,
        theme: 'grid',
        headStyles: { fillColor: '#16a34a', textColor: '#ffffff' },
        styles: { fontSize: 9, cellPadding: 2 },
        columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
        didDrawCell: (data: any) => {
            if (data.row.index === summaryBody.length - 1) {
                data.cell.styles.fontStyle = 'bold';
                data.cell.styles.fillColor = '#f0f0f0';
                data.cell.styles.textColor = '#000';
            }
        }
    });
    
    doc.addPage();
    drawHeader();
    cursorY = 35;

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Detalle por Marca y Grupo', marginLeft, cursorY);
    cursorY += 8;

    const warehouseColumns = [...new Set(data.map(row => String(row['BOD. ENTRADA'])))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const headByBrand = [['Marca', 'Grupo', ...warehouseColumns, 'Total Cantidad', 'Total Docs']];

    const pivotDataByBrand = data.reduce((acc, row) => {
        const marca = String(row['MARCA'] || 'SIN MARCA').trim();
        const grupo = String(row['GRUPO'] || 'SIN GRUPO').trim();
        const key = `${marca}|${grupo}`;

        if (!acc[key]) {
            acc[key] = {
                marca,
                grupo,
                warehouses: {},
                totalQuantity: 0,
                totalDocs: new Set<string>(),
            };
        }
        
        const bodEntrada = String(row['BOD. ENTRADA']);
        const quantity = Number(row['CANTIDAD']);
        const docNumber = String(row['NRO DOCUMENTO.2']);

        if (!acc[key].warehouses[bodEntrada]) {
            acc[key].warehouses[bodEntrada] = {
                quantity: 0,
                docs: new Set<string>(),
            };
        }

        acc[key].warehouses[bodEntrada].quantity += quantity;
        acc[key].warehouses[bodEntrada].docs.add(docNumber);
        
        acc[key].totalQuantity += quantity;
        acc[key].totalDocs.add(docNumber);

        return acc;
    }, {} as { [key: string]: { marca: string; grupo: string; warehouses: { [wh: string]: { quantity: number; docs: Set<string> } }; totalQuantity: number; totalDocs: Set<string> } });
    
    const sortedPivotDataByBrand = Object.values(pivotDataByBrand).sort((a,b) => {
        if (a.marca < b.marca) return -1;
        if (a.marca > b.marca) return 1;
        if (a.grupo < b.grupo) return -1;
        if (a.grupo > b.grupo) return 1;
        return 0;
    });

    const bodyByBrand = sortedPivotDataByBrand.map(row => {
        const rowData: (string | number)[] = [row.marca, row.grupo];
        warehouseColumns.forEach(wh => {
            const cellData = row.warehouses[wh];
            rowData.push(cellData && cellData.quantity > 0 ? `${cellData.quantity.toLocaleString('es-ES')} (${cellData.docs.size})` : '-');
        });
        rowData.push(row.totalQuantity.toLocaleString('es-ES'));
        rowData.push(row.totalDocs.size);
        return rowData;
    });

    const grandTotalsByBrand: { [key: string]: any } = {
        totalQuantity: 0,
        totalDocs: new Set<string>(),
        warehouses: {}
    };

    sortedPivotDataByBrand.forEach(row => {
        grandTotalsByBrand.totalQuantity += row.totalQuantity;
        row.totalDocs.forEach(doc => grandTotalsByBrand.totalDocs.add(doc));
        Object.entries(row.warehouses).forEach(([wh, data]) => {
            if (!grandTotalsByBrand.warehouses[wh]) {
                grandTotalsByBrand.warehouses[wh] = { quantity: 0, docs: new Set<string>() };
            }
            const warehouseData = data as { quantity: number; docs: Set<string> };
            grandTotalsByBrand.warehouses[wh].quantity += warehouseData.quantity;
            warehouseData.docs.forEach(doc => grandTotalsByBrand.warehouses[wh].docs.add(doc));
        });
    });

    const totalRowByBrand = ['TOTAL', ''];
    warehouseColumns.forEach(wh => {
        const total = grandTotalsByBrand.warehouses[wh];
        totalRowByBrand.push(total ? `${total.quantity.toLocaleString('es-ES')} (${total.docs.size})` : '-');
    });
    totalRowByBrand.push(grandTotalsByBrand.totalQuantity.toLocaleString('es-ES'));
    totalRowByBrand.push(grandTotalsByBrand.totalDocs.size);
    bodyByBrand.push(totalRowByBrand);

    autoTable(doc, {
        startY: cursorY,
        head: headByBrand,
        body: bodyByBrand,
        theme: 'grid',
        headStyles: { fillColor: [40, 167, 69], fontSize: 7 },
        styles: { fontSize: 7, cellPadding: 1.5 },
        margin: { left: marginLeft, right: marginRight },
        columnStyles: { 0: { fontStyle: 'bold' } },
        didDrawCell: (data: any) => {
            if (data.row.index === bodyByBrand.length - 1) {
                data.cell.styles.fontStyle = 'bold';
                data.cell.styles.fillColor = '#f0f0f0';
                data.cell.styles.textColor = '#000';
            }
        },
    });

    doc.addPage();
    drawHeader();
    cursorY = 35;
  
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Detalle por Fecha', marginLeft, cursorY);
    cursorY += 8;

    const headByDate = [['Fecha', ...warehouseColumns, 'Total Cantidad', 'Total Docs']];

    const pivotDataByDate = data.reduce((acc, row) => {
        const fecha = String(row['FECHA'] || 'SIN FECHA').trim();
        if (!acc[fecha]) {
            acc[fecha] = {
                fecha,
                warehouses: {},
                totalQuantity: 0,
                totalDocs: new Set<string>(),
            };
        }
        
        const bodEntrada = String(row['BOD. ENTRADA']);
        const quantity = Number(row['CANTIDAD']);
        const docNumber = String(row['NRO DOCUMENTO.2']);

        if (!acc[fecha].warehouses[bodEntrada]) {
            acc[fecha].warehouses[bodEntrada] = {
                quantity: 0,
                docs: new Set<string>(),
            };
        }

        acc[fecha].warehouses[bodEntrada].quantity += quantity;
        acc[fecha].warehouses[bodEntrada].docs.add(docNumber);
        
        acc[fecha].totalQuantity += quantity;
        acc[fecha].totalDocs.add(docNumber);

        return acc;
    }, {} as { [key: string]: { fecha: string; warehouses: { [wh: string]: { quantity: number; docs: Set<string> } }; totalQuantity: number; totalDocs: Set<string> } });
    
    const sortedPivotDataByDate = Object.values(pivotDataByDate).sort((a, b) => {
        const dateA = parseDateString(a.fecha);
        const dateB = parseDateString(b.fecha);
        return (dateA?.getTime() || 0) - (dateB?.getTime() || 0);
    });

    const bodyByDate = sortedPivotDataByDate.map(row => {
        const rowData: (string | number)[] = [row.fecha];
        warehouseColumns.forEach(wh => {
            const cellData = row.warehouses[wh];
            rowData.push(cellData && cellData.quantity > 0 ? `${cellData.quantity.toLocaleString('es-ES')} (${cellData.docs.size})` : '-');
        });
        rowData.push(row.totalQuantity.toLocaleString('es-ES'));
        rowData.push(row.totalDocs.size);
        return rowData;
    });

    const grandTotalsByDate: { [key: string]: any } = {
        totalQuantity: 0,
        totalDocs: new Set<string>(),
        warehouses: {}
    };

    sortedPivotDataByDate.forEach(row => {
        grandTotalsByDate.totalQuantity += row.totalQuantity;
        row.totalDocs.forEach(doc => grandTotalsByDate.totalDocs.add(doc));
        Object.entries(row.warehouses).forEach(([wh, data]) => {
            if (!grandTotalsByDate.warehouses[wh]) {
                grandTotalsByDate.warehouses[wh] = { quantity: 0, docs: new Set<string>() };
            }
            const warehouseData = data as { quantity: number; docs: Set<string> };
            grandTotalsByDate.warehouses[wh].quantity += warehouseData.quantity;
            warehouseData.docs.forEach(doc => grandTotalsByDate.warehouses[wh].docs.add(doc));
        });
    });

    const totalRowByDate = ['TOTAL'];
    warehouseColumns.forEach(wh => {
        const total = grandTotalsByDate.warehouses[wh];
        totalRowByDate.push(total ? `${total.quantity.toLocaleString('es-ES')} (${total.docs.size})` : '-');
    });
    totalRowByDate.push(grandTotalsByDate.totalQuantity.toLocaleString('es-ES'));
    totalRowByDate.push(grandTotalsByDate.totalDocs.size);
    bodyByDate.push(totalRowByDate);

    autoTable(doc, {
        startY: cursorY,
        head: headByDate,
        body: bodyByDate,
        theme: 'grid',
        headStyles: { fillColor: [40, 167, 69], fontSize: 7 },
        styles: { fontSize: 7, cellPadding: 1.5 },
        margin: { left: marginLeft, right: marginRight },
        columnStyles: { 0: { fontStyle: 'bold' } },
        didDrawCell: (data: any) => {
            if (data.row.index === bodyByDate.length - 1) {
                data.cell.styles.fontStyle = 'bold';
                data.cell.styles.fillColor = '#f0f0f0';
                data.cell.styles.textColor = '#000';
            }
        },
    });
  
    const dateStr = new Date().toISOString().slice(0, 10);
    doc.save(`Reporte_Pendientes_PteEnvio_EnCargue_${dateStr}.pdf`);
};

export const generateWarehousePdf = (
    warehouseName: string, 
    summaryData: AnalysisResult | undefined,
    slaData: SlaAnalysisData | undefined,
    pendingData: PendingDocsAnalysisData | undefined,
    brandData: BrandSummaryRecord[] | undefined
) => {
const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    const marginLeft = 15;
    const marginRight = 15;
    const pageContentWidth = doc.internal.pageSize.getWidth() - marginLeft - marginRight;
    let cursorY = 20;

    const checkPageBreak = (spaceNeeded: number) => {
        if (cursorY + spaceNeeded > doc.internal.pageSize.getHeight() - 20) {
            doc.addPage();
            cursorY = 20;
        }
    };
    
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text(`Reporte de Bodega: ${warehouseName}`, marginLeft, cursorY);
    cursorY += 8;
    doc.setFontSize(10);
    doc.setTextColor(150);
    doc.setFont('helvetica', 'normal');
    doc.text(`Generado el: ${new Date().toLocaleDateString('es-ES')} ${new Date().toLocaleTimeString('es-ES')}`, marginLeft, cursorY);
    cursorY += 12;

    const addSectionHeader = (title: string, description: string) => {
        checkPageBreak(25 + (description.split('\n').length * 5));
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0);
        doc.text(title, marginLeft, cursorY);
        cursorY += 8;
        
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(80, 80, 80);
        const splitDescription = doc.splitTextToSize(description, pageContentWidth);
        doc.text(splitDescription, marginLeft, cursorY);
        cursorY += (splitDescription.length * 5) + 3;
    };
    
    const addSubHeader = (title: string) => {
        checkPageBreak(12);
        doc.setFontSize(12);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(0);
        doc.text(title, marginLeft, cursorY);
        cursorY += 8;
    }

    if (summaryData) {
        addSectionHeader('Resumen General', 'Presenta el volumen total de documentos (TFT) y la cantidad de unidades. A continuación, se detalla la composición del total de documentos.');
        
        const finalizedWithEvidenceCount = slaData?.finalizedRecords?.filter(r => r.type === 'finalized').length || 0;
        const deliveredViaWmsCount = slaData?.finalizedRecords?.filter(r => r.type === 'delivered').length || 0;
        const totalDocsCount = summaryData?.documentos || finalizedWithEvidenceCount + deliveredViaWmsCount + (pendingData?.pendingCount || 0);

        const summaryBody = [
            ['Total de Documentos', totalDocsCount],
            ['  Documentos Finalizados (con evidencia)', finalizedWithEvidenceCount],
            ['  Documentos Entregados (vms)', deliveredViaWmsCount],
            ['  Documentos Pendientes', pendingData?.pendingCount || 0],
            ['Cantidad Total de Unidades', summaryData.cantidad.toLocaleString('es-ES')],
        ];

        autoTable(doc, {
            startY: cursorY,
            head: [['Métrica', 'Valor']],
            body: summaryBody,
            theme: 'grid',
            headStyles: { fillColor: '#16a34a', textColor: '#ffffff' },
            columnStyles: { 
                0: { fontStyle: 'bold' },
                1: { halign: 'right' }
            }
        });
        cursorY = (doc as any).lastAutoTable.finalY + 12;
    }

    if (brandData && brandData.length > 0) {
        checkPageBreak(40);
        addSectionHeader('Resumen General por Marca', 'Presenta un resumen de la cantidad de documentos y unidades totales por cada marca asociada a la bodega.');
        
        autoTable(doc, {
            startY: cursorY,
            head: [['Marca', 'Total Documentos', 'Cantidad Total de Unidades']],
            body: brandData.map(b => [b.brand, b.docCount, b.quantity.toLocaleString('es-ES')]),
            theme: 'grid',
            headStyles: { fillColor: '#16a34a', textColor: '#ffffff' },
            columnStyles: { 
                1: { halign: 'right' },
                2: { halign: 'right' }
            },
        });
        cursorY = (doc as any).lastAutoTable.finalY + 12;
    }

    if (slaData) {
        checkPageBreak(40);
        const slaDesc = 'Esta sección analiza la antigüedad de los documentos ya finalizados. Un TFT se considera "Fuera de Plazo" si han transcurrido 3 días o más desde su fecha de finalización. El objetivo es identificar los documentos finalizados más recientes. Un alto porcentaje de cumplimiento significa que la mayoría de los documentos se finalizaron en los últimos 2 días.';
        addSectionHeader('Análisis de Cumplimiento de SLA', slaDesc);

        autoTable(doc, {
            startY: cursorY,
            head: [['Cumplimiento SLA', 'TFT Finalizados', 'TFT Fuera de Plazo']],
            body: [[`${slaData.compliance.toFixed(1)}%`, slaData.totalFinalized, slaData.overdueCount]],
            theme: 'grid',
            headStyles: { fillColor: '#dc2626', textColor: '#ffffff' },
            columnStyles: { 0: { halign: 'center' }, 1: { halign: 'center' }, 2: { halign: 'center' } },
        });
        cursorY = (doc as any).lastAutoTable.finalY + 8;
        
        if (slaData.finalizedRecords.length > 0) {
            addSubHeader('Detalle de Documentos Finalizados y Entregados');
            
            const slaDetailBody = slaData.finalizedRecords.map(rec => {
                let evidenciaText: string;
                if (rec.type === 'delivered') {
                    evidenciaText = 'REVISAR WMS';
                } else if (rec.type === 'finalized' && rec.imageLink) {
                    evidenciaText = 'Ver Evidencia';
                } else {
                    evidenciaText = 'N/D';
                }
                
                return [
                    rec.docNumber,
                    rec.finalizedDate,
                    rec.daysToFinalize,
                    rec.warehouseOut,
                    rec.isOverdue ? 'Fuera de Plazo' : 'A Tiempo',
                    evidenciaText
                ];
            });

            autoTable(doc, {
                startY: cursorY,
                head: [['Nro TFT', 'Fecha Finalizado', 'Días Desde Finalización', 'Bod. Salida', 'Estado', 'Evidencia']],
                body: slaDetailBody,
                theme: 'grid',
                headStyles: { fillColor: '#dc2626', textColor: '#ffffff' },
                didParseCell: (data: any) => {
                    if (data.section === 'body' && data.column.dataKey === 5) {
                        const record = slaData.finalizedRecords[data.row.index];
                        if (record) {
                            if (record.type === 'delivered') {
                                data.cell.styles.fontStyle = 'bold';
                            } else if (record.type === 'finalized' && record.imageLink) {
                                data.cell.styles.textColor = [0, 0, 255];
                                data.cell.styles.fontStyle = 'bold';
                            }
                        }
                    }
                },
                didDrawCell: (data: any) => {
                    if (data.section === 'body' && data.column.dataKey === 5) {
                        const record = slaData.finalizedRecords[data.row.index];
                        if (record && record.type === 'finalized' && record.imageLink) {
                            doc.link(data.cell.x, data.cell.y, data.cell.width, data.cell.height, { url: record.imageLink });
                        }
                    }
                }
            });
            cursorY = (doc as any).lastAutoTable.finalY + 12;
        }
    }

    if (pendingData && pendingData.pendingCount > 0) {
        checkPageBreak(40);
        const pendingDesc = "Esta sección muestra todos los TFT no finalizados. La columna \"En Ruta\" indica el estado logístico:\n- 'ESTA EN RUTA': El TFT ha sido despachado y está en tránsito.\n- 'ESTA EN BODEGA PPAL': El TFT está listo pero aún en la bodega.\n- 'PREGUNTAR ALMACEN DE ORIGEN': El sistema no tiene estado confirmado.";
        addSectionHeader('Análisis de TFT Pendientes', pendingDesc);
        
        autoTable(doc, {
            startY: cursorY,
            head: [['TFT Pendientes', 'Cantidad Pendiente', '% Participación']],
            body: [[ pendingData.pendingCount, pendingData.totalPendingQuantity.toLocaleString('es-ES'), `${pendingData.participationPercentage.toFixed(1)}%`]],
            theme: 'grid',
            headStyles: { fillColor: '#f97316', textColor: '#ffffff' },
            columnStyles: { 0: { halign: 'center' }, 1: { halign: 'center' }, 2: { halign: 'center' } },
        });
        cursorY = (doc as any).lastAutoTable.finalY + 8;

        if (pendingData.pendingRecords.length > 0) {
             addSubHeader('Resumen de Pendientes por Marca y Grupo');
             
             autoTable(doc, {
                startY: cursorY,
                head: [['Marca', 'Grupo', 'TFT Pendientes', 'Cantidad Pendiente', 'Antigüedad Prom. (Días)']],
                body: pendingData.pendingRecords.map(rec => [rec.marca, rec.grupo, rec.docCount, rec.totalQuantity.toLocaleString('es-ES'), rec.avgDaysPending]),
                theme: 'grid',
                headStyles: { fillColor: '#f97316', textColor: '#ffffff' },
                columnStyles: { 
                    2: { halign: 'right' },
                    3: { halign: 'right' },
                    4: { halign: 'right' } 
                },
             });
             cursorY = (doc as any).lastAutoTable.finalY + 12;

             checkPageBreak(30);
             addSubHeader('Detalle de Documentos Pendientes (Más Antiguos)');

             const allPendingDocs = pendingData.pendingRecords
                .flatMap(p => p.detailedDocs);

            const aggregatedDocs = new Map<string, PendingDocDetail>();
            allPendingDocs.forEach(doc => {
                const key = `${doc.docNumber}|${doc.docDate}|${doc.daysPending}|${doc.warehouseOut}|${doc.enRuta}`;
                if (aggregatedDocs.has(key)) {
                    const existing = aggregatedDocs.get(key)!;
                    existing.quantity += doc.quantity;
                } else {
                    aggregatedDocs.set(key, { ...doc });
                }
            });

            const finalPendingDocs = Array.from(aggregatedDocs.values())
                .sort((a,b) => b.daysPending - a.daysPending);
            
             const pendingDetailBody = finalPendingDocs.map(doc => [
                doc.docDate,
                doc.docNumber,
                doc.quantity,
                doc.daysPending,
                doc.warehouseOut,
                doc.enRuta,
             ]);

             autoTable(doc, {
                startY: cursorY,
                head: [['Fecha', 'Nro TFT', 'Cant.', 'Días Pend.', 'Bod. Salida', 'Estado Ruta']],
                body: pendingDetailBody,
                theme: 'grid',
                headStyles: { fillColor: '#f97316', textColor: '#ffffff' },
                columnStyles: { 
                    2: { halign: 'right' },
                    3: { halign: 'right' },
                    4: { halign: 'right' } 
                },
             });
             cursorY = (doc as any).lastAutoTable.finalY + 12;
        }
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    doc.save(`Reporte_Bodega_${warehouseName.replace(/ /g, '_')}_${dateStr}.pdf`);
};

export const generateMainRouteTemplate = () => {
    if (typeof XLSX === 'undefined') {
        alert('La librería de exportación (XLSX) no está disponible.');
        return;
    }
    const data = [
        {
            'VEHICULO': 'MOTO EJEMPLO',
            'NUMERO TF': '12345',
            'VALOR': 'B12',
            'TIPO': 'ENTREGAR',
            'SE ENVIA CON': '',
            'OBSERVACIONES': 'Entrega en tienda B12'
        }
    ];
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Plantilla Principal');
    XLSX.writeFile(workbook, 'Plantilla_Ruta_Principal.xlsx');
};

export const generateAdditionalRouteTemplate = () => {
    if (typeof XLSX === 'undefined') {
        alert('La librería de exportación (XLSX) no está disponible.');
        return;
    }
    const data = [
        {
            'VEHICULO': 'MOTO EJEMPLO',
            'NUMERO TF': '67890',
            'VALOR': 'MOLINOS',
            'SE ENVIA CON': '',
            'CÓDIGO': 'ITEM EXTRA'
        }
    ];
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Plantilla Adicionales');
    XLSX.writeFile(workbook, 'Plantilla_Ruta_Adicional.xlsx');
};

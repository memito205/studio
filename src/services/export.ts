
"use client";
import * as XLSX from 'xlsx';
import type { ReceptionOperation, DetailedReportItem, ScannedItem, ItemNovelty, PackingUnit, Location, ProductDatabaseItem, OperationReport } from '@/types';


export const exportToXlsx = (data: any[], fileName: string): void => {
    // Check if data is empty
    if (!data || data.length === 0) {
        console.error("No data provided to export.");
        // Optionally, inform the user with a toast or alert
        alert("No hay datos para exportar.");
        return;
    }
    
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Datos');

    // Auto-adjust column width
    try {
        const objectKeys = Object.keys(data[0] || {});
        const colWidths = objectKeys.map(key => ({
            wch: Math.max(
                key.length,
                ...data.map(row => String(row[key] || '').length)
            ) + 2 // Add a little padding
        }));
        worksheet["!cols"] = colWidths;
    } catch (e) {
        console.error("Could not auto-size columns, using default.", e);
    }
    
    XLSX.writeFile(workbook, `${fileName}.xlsx`);
};

// Interface for combined detailed item data for export
interface DetailedItemForExport {
  Referencia: string;
  'Nombre Producto': string;
  Talla: string;
  'Cantidad Esperada': number;
  'Cantidad Leída': number;
  Diferencia: number;
  Novedades: string; // Concatenated novelty descriptions
}

// Interface for raw scanned item data for export
interface ScannedItemForExport {
  'ID Escaneo': string;
  Referencia: string;
  'Unidad de Empaque': string;
  Cantidad: number;
  Ubicación: string;
  'Fecha/Hora': string;
}

export const exportOperationReportsToExcel = ({
  operation,
  detailedItems, // Aggregated data by reference
  scannedItems, // Raw scanned items
  packingUnits,
  locations,
  novelties, // Raw novelties for descriptions
  products, // All products for mapping
}: {
  operation: ReceptionOperation;
  detailedItems: DetailedReportItem[];
  scannedItems: ScannedItem[];
  packingUnits: PackingUnit[];
  locations: Location[];
  novelties: ItemNovelty[];
  products: ProductDatabaseItem[];
}) => {
  const workbook = XLSX.utils.book_new();

  // --- Sheet 1: Operation Summary ---
  const totalScannedQuantity = scannedItems.reduce((sum, item) => sum + item.quantity, 0);
  let operationTotalTimeMillis = 0;
  if (operation?.start_time && operation?.end_time) {
    operationTotalTimeMillis = new Date(operation.end_time).getTime() - new Date(operation.start_time).getTime();
  } else if (operation?.start_time && operation?.status === 'in_progress') {
    operationTotalTimeMillis = new Date().getTime() - new Date(operation.start_time).getTime();
  }
  
  const timeSpentInMinutes = operationTotalTimeMillis / (1000 * 60);
  const actualProductivity = timeSpentInMinutes > 0 ? (totalScannedQuantity / (timeSpentInMinutes / 60)) : 0;

  const summaryData = [
    ['Detalles de la Operación'],
    ['RK:', operation.rk_identifier],
    ['Proveedor:', operation.supplier],
    ['Fecha de Llegada Esperada:', new Date(operation.expected_arrival_date).toLocaleDateString()],
    ['Estado:', operation.status],
    ['Cantidad Esperada:', operation.expected_quantity],
    ['Cantidad Leída:', totalScannedQuantity],
    ['Tiempo Transcurrido (min):', timeSpentInMinutes.toFixed(0)],
    ['Productividad Real (unidades/hora):', actualProductivity.toFixed(2)],
    [''],
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Resumen Operación');

  // --- Sheet 2: Item Details (aggregated by reference) ---
  const detailedItemsFormatted: DetailedItemForExport[] = detailedItems.map(item => ({
    Referencia: item.barcode,
    'Nombre Producto': item.productName,
    Talla: item.size,
    'Cantidad Esperada': item.expectedQuantity,
    'Cantidad Leída': item.scannedQuantity,
    Diferencia: item.difference,
    Novedades: item.noveltyType,
  }));
  const detailedItemsSheet = XLSX.utils.json_to_sheet(detailedItemsFormatted);
  XLSX.utils.book_append_sheet(workbook, detailedItemsSheet, 'Detalle por Referencia');

  // --- Sheet 3: Raw Scanned Items ---
  const scannedItemsFormatted: ScannedItemForExport[] = scannedItems.map(item => ({
    'ID Escaneo': item.id,
    Referencia: item.barcode,
    'Unidad de Empaque': String(item.packing_unit_id),
    Cantidad: item.quantity,
    Ubicación: locations.find(loc => loc.id === item.location_id)?.name || 'Desconocida',
    'Fecha/Hora': new Date(item.scanned_at).toLocaleString(),
  }));
  const scannedItemsSheet = XLSX.utils.json_to_sheet(scannedItemsFormatted);
  XLSX.utils.book_append_sheet(workbook, scannedItemsSheet, 'Items Escaneados');

  const fileName = `Reporte_Operacion_${operation.rk_identifier}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(workbook, fileName);
};

// Function for ReportsPage.tsx to export general operation reports
export const exportReportsToExcel = (reports: OperationReport[]) => {
  const workbook = XLSX.utils.book_new();

  const formattedReports = reports.map(report => ({
    'Identificador RK': report.rk_identifier,
    'Proveedor': report.supplier,
    'Fecha Esperada': new Date(report.expected_arrival_date).toLocaleDateString(),
    'Cantidad Esperada': report.expected_quantity,
    'Cantidad Leída': report.totalScannedQuantity,
    'Estado Cantidad': report.quantityStatus.text,
    'Tiempo (min)': report.timeSpentInMinutes.toFixed(2),
    'Prod. Real (u/h)': report.actualProductivity.toFixed(2),
    'Prod. Esperada (u/h)': report.expectedProductivity?.toFixed(2) || 'N/A',
    'Estado Operación': report.status,
    'Unidades Empaque': report.uniquePackingUnitNames?.join(', ') || 'N/A',
    'Ubicaciones': report.uniqueLocationNames?.join(', ') || 'N/A',
    'Calidad Recibo (%)': report.perOperationReceiptQualityIndicator !== undefined ? report.perOperationReceiptQualityIndicator.toFixed(2) : 'N/A',
  }));

  const ws = XLSX.utils.json_to_sheet(formattedReports);
  XLSX.utils.book_append_sheet(workbook, ws, 'Reporte General Operaciones');

  const fileName = `Reporte_General_Operaciones_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(workbook, fileName);
};

    
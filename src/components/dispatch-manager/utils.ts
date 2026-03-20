
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { MerchandiseItem, TFTItem } from '@/types';
import { parseFlexibleDate } from '@/lib/parsingUtils';

export const cleanToNumeric = (value: string): string => {
  if (!value) return '';
  return String(value).replace(/[^0-9]/g, '');
};

const parseExcelFile = (file: File): Promise<any[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary', cellDates: true });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(worksheet);
        resolve(json);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = (error) => reject(error);
    reader.readAsArrayBuffer(file);
  });
};

export const parseMerchandiseExcel = async (file: File): Promise<MerchandiseItem[]> => {
  const json = await parseExcelFile(file);
  return json.map((row: any) => ({
    codigo: String(row['CODIGO'] || ''),
    fechaCreacion: parseFlexibleDate(row['FECHA CREACION']) || new Date(),
    orden: String(row['ORDEN'] || ''),
    tipoOrd: String(row['TIPO ORD'] || ''),
    tipo: String(row['TIPO'] || ''),
    gr: String(row['GR'] || ''),
    contenido: String(row['CONTENIDO'] || ''),
    tf: String(row['TF'] || ''),
    origen: String(row['ORIGEN'] || ''),
    destino: String(row['DESTINO'] || ''),
    cant: Number(row['CANT.'] || 0),
    pKg: Number(row['P.KG'] || 0),
    vM3: Number(row['V.M3'] || 0),
    estado: String(row['ESTADO'] || ''),
    detalle: String(row['DETALLE'] || ''),
    etiqueta: String(row['ETIQUETA'] || ''),
    relacion: String(row['RELACION'] || ''),
    verLog: String(row['VER LOG'] || ''),
    ordDesp: String(row['ORD DESP'] || ''),
    fechaEmpaque: String(row['FECHA EMPAQUE'] || ''),
    empacador: String(row['EMPACADOR'] || ''),
  }));
};

export const parseTFTExcel = async (file: File): Promise<TFTItem[]> => {
  const json = await parseExcelFile(file);
  return json.map((row: any) => ({
    tft: String(row['TFT'] || ''),
    fecha: parseFlexibleDate(row['FECHA']) || new Date(),
    cantidad: Number(row['CANTIDAD'] || 0),
  }));
};

export const exportToExcel = (data: MerchandiseItem[], fileName: string) => {
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Datos");
  XLSX.writeFile(wb, `${fileName}.xlsx`);
};

export const generatePDF = (data: MerchandiseItem[]) => {
    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'pt',
      format: 'letter',
    });
    
    doc.setFontSize(18);
    doc.text('Reporte de Cruce de Mercancía', 40, 40);

    const tableData = data.map(item => [
        item.codigo,
        item.tftMatch || '-',
        item.tftFecha ? item.tftFecha.toLocaleDateString() : '-',
        item.tftCantidad || '-',
        item.destino,
        item.empacador,
    ]);

    autoTable(doc, {
        head: [['Código', 'TFT (Cruce)', 'Fecha TFT', 'Cant TFT', 'Destino', 'Empacador']],
        body: tableData,
        startY: 60,
        theme: 'striped',
        headStyles: { fillColor: [22, 163, 74] },
    });
    
    doc.save(`Reporte_Cruce_${new Date().toISOString().split('T')[0]}.pdf`);
};

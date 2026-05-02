
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import type { MerchandiseItem, TFTItem, VerificationItem } from '../../../types';
import { findCaseInsensitiveKey } from '../../../lib/parsingUtils';

// Destination mapping
export const DESTINATION_MAP: Record<string, string> = {
  '20101': 'BR 01', '20201': 'BR 02', '20301': 'BR 03', '20401': 'BR 04',
  '20501': 'BR 05', '20601': 'BR 06', '30701': 'BR 07', '20801': 'BR 08',
  '20901': 'BR 09', '21001': 'BR 10', '21101': 'BR 11', '21201': 'BR 12',
  '31301': 'BR 13', '21401': 'BR 14', '31501': 'BR 15', '21601': 'BR 16',
  '41701': 'BR 17 F', '21801': 'BR 18', '31901': 'BR 319', '22001': 'BR 20',
  '22101': 'BR 21', '22201': 'BR 22', '22301': 'BR 23', 'BODVI': 'INT',
  '30301': 'ML', 'BODPN': 'PIO',
};

export const normalizeDestination = (dest: string): string => {
  if (!dest) return 'SIN DESTINO';
  const upperDest = dest.toUpperCase().trim();
  // First, check if the destination is a key in our map
  if (DESTINATION_MAP[upperDest]) {
    return DESTINATION_MAP[upperDest];
  }
  // If not, check if it's one of the mapped values already (e.g. "BR 01")
  if (Object.values(DESTINATION_MAP).includes(upperDest)) {
    return upperDest;
  }
  // If none of the above, return the original (likely already correct or a special case)
  return upperDest;
};


export const cleanToNumeric = (val: any): string => {
  if (val === undefined || val === null) return '';
  // This version is less aggressive and keeps letters/hyphens which might be part of the TF number.
  return String(val).trim();
};

export const parseMerchandiseExcel = (file: File): Promise<MerchandiseItem[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet) as any[];

        const items: MerchandiseItem[] = jsonData.map((row) => {
          const fechaKey = findCaseInsensitiveKey(row, 'FECHA CREACIÓN');
          let dateValue = fechaKey ? row[fechaKey] : undefined;
          let fecha: Date;

          if (dateValue instanceof Date) {
            fecha = dateValue;
          } else if (typeof dateValue === 'number') {
            fecha = new Date((dateValue - 25569) * 86400 * 1000);
          } else {
            fecha = new Date(dateValue);
          }

          if (isNaN(fecha.getTime())) {
            fecha = new Date();
          }

          // **CORRECTED LOGIC START**
          // 1. Read the original CÓDIGO directly from the Excel file. DO NOT modify it.
          const codigoKey = findCaseInsensitiveKey(row, 'CÓDIGO');
          const codigo = String(codigoKey ? row[codigoKey] : '').trim().toUpperCase().replace(/'/g, '-');

          // 2. Read the original DESTINO from the file to be normalized for display.
          const destinoKey = findCaseInsensitiveKey(row, 'DESTINO');
          const rawDestino = String(destinoKey ? row[destinoKey] : '');
          const normalizedDestino = normalizeDestination(rawDestino);
          // **CORRECTED LOGIC END**

          const ordenKey = findCaseInsensitiveKey(row, 'ORDEN');
          const tipoOrdKey = findCaseInsensitiveKey(row, 'TIPO ORD');
          const tipoKey = findCaseInsensitiveKey(row, 'TIPO');
          const grKey = findCaseInsensitiveKey(row, 'GR');
          const contenidoKey = findCaseInsensitiveKey(row, 'CONTENIDO');
          const tfKey = findCaseInsensitiveKey(row, 'TF');
          const origenKey = findCaseInsensitiveKey(row, 'ORIGEN');
          const cantKey = findCaseInsensitiveKey(row, 'CANT');
          const pKgKey = findCaseInsensitiveKey(row, 'P(KG)');
          const vM3Key = findCaseInsensitiveKey(row, 'V(M3)');
          const estadoKey = findCaseInsensitiveKey(row, 'ESTADO');
          const detalleKey = findCaseInsensitiveKey(row, 'DETALLE');
          const etiquetaKey = findCaseInsensitiveKey(row, 'ETIQUETA');
          const relacionKey = findCaseInsensitiveKey(row, 'RELACIÓN');
          const verLogKey = findCaseInsensitiveKey(row, 'VER LOG');
          const ordDespKey = findCaseInsensitiveKey(row, 'ORD DESP');
          const fechaEmpaqueKey = findCaseInsensitiveKey(row, 'FECHA EMPAQUE');
          const empacadorKey = findCaseInsensitiveKey(row, 'EMPACADOR');

          const tfValue = cleanToNumeric(tfKey ? row[tfKey] : '');
          const contenidoValue = cleanToNumeric(contenidoKey ? row[contenidoKey] : '');

          return {
            codigo: codigo, // Use the original, unmodified code from the file
            fechaCreacion: fecha,
            orden: String(ordenKey ? row[ordenKey] : ''),
            tipoOrd: String(tipoOrdKey ? row[tipoOrdKey] : ''),
            tipo: String(tipoKey ? row[tipoKey] : ''),
            gr: String(grKey ? row[grKey] : ''),
            contenido: contenidoValue,
            tf: tfValue,
            origen: String(origenKey ? row[origenKey] : ''),
            destino: normalizedDestino, // Use the normalized value for display/filtering
            cant: Number(cantKey ? row[cantKey] : 0),
            pKg: Number(pKgKey ? row[pKgKey] : 0),
            vM3: Number(vM3Key ? row[vM3Key] : 0),
            estado: String(estadoKey ? row[estadoKey] : ''),
            detalle: String(detalleKey ? row[detalleKey] : ''),
            etiqueta: String(etiquetaKey ? row[etiquetaKey] : ''),
            relacion: String(relacionKey ? row[relacionKey] : ''),
            verLog: String(verLogKey ? row[verLogKey] : ''),
            ordDesp: String(ordDespKey ? row[ordDespKey] : ''),
            fechaEmpaque: String(fechaEmpaqueKey ? row[fechaEmpaqueKey] : ''),
            empacador: String(empacadorKey ? row[empacadorKey] : ''),
          };
        });

        resolve(items);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = (error) => reject(error);
    reader.readAsArrayBuffer(file);
  });
};

export const parseVerificationExcel = (file: File): Promise<VerificationItem[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet) as any[];

        const items: VerificationItem[] = jsonData.map((row) => {
            const codigoKey = findCaseInsensitiveKey(row, 'Código');
            const tftCruceKey = findCaseInsensitiveKey(row, 'TFT (Cruce)');
            const fechaTftKey = findCaseInsensitiveKey(row, 'Fecha TFT');
            const cantTftKey = findCaseInsensitiveKey(row, 'Cant TFT');
            const destinoKey = findCaseInsensitiveKey(row, 'Destino');
            const empacadorKey = findCaseInsensitiveKey(row, 'Empacador');
            const contenidoOriginalKey = findCaseInsensitiveKey(row, 'Contenido Original');
            const tfOriginalKey = findCaseInsensitiveKey(row, 'TF Original');

            return {
              codigo: String(codigoKey ? row[codigoKey] : '').replace(/'/g, '-'),
              tftCruce: String(tftCruceKey ? row[tftCruceKey] : ''),
              fechaTft: String(fechaTftKey ? row[fechaTftKey] : ''),
              cantTft: String(cantTftKey ? row[cantTftKey] : ''),
              destino: String(destinoKey ? row[destinoKey] : ''),
              empacador: String(empacadorKey ? row[empacadorKey] : ''),
              contenidoOriginal: String(contenidoOriginalKey ? row[contenidoOriginalKey] : ''),
              tfOriginal: String(tfOriginalKey ? row[tfOriginalKey] : ''),
              scanned: false
            }
        });

        resolve(items);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = (error) => reject(error);
    reader.readAsArrayBuffer(file);
  });
};

export const exportToExcel = (data: MerchandiseItem[], fileName: string) => {
  const worksheetData = data.map(item => ({
    'Código': item.codigo,
    'TFT (Cruce)': item.tftMatch || 'Sin cruce',
    'Fecha TFT': item.tftFecha ? format(item.tftFecha, 'dd/MM/yyyy') : '-',
    'Cant TFT': item.tftCantidad !== undefined ? item.tftCantidad : '-',
    'Destino': item.destino,
    'Empacador': item.empacador || '-',
    'Contenido Original': item.contenido,
    'TF Original': item.tf
  }));

  const worksheet = XLSX.utils.json_to_sheet(worksheetData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Reporte');
  XLSX.writeFile(workbook, `${fileName}.xlsx`);
};

export const exportVerificationToExcel = (data: VerificationItem[], fileName: string) => {
  const worksheetData = data.map(item => ({
    'Código': item.codigo,
    'TFT (Cruce)': item.tftCruce,
    'Fecha TFT': item.fechaTft,
    'Cant TFT': item.cantTft,
    'Destino': item.destino,
    'Empacador': item.empacador,
    'Contenido Original': item.contenidoOriginal,
    'TF Original': item.tfOriginal,
    'Estado': item.scanned ? 'ESCANEADO' : 'PENDIENTE',
    'Hora Escaneo': item.scanTime ? format(item.scanTime, 'HH:mm:ss') : '-'
  }));

  const worksheet = XLSX.utils.json_to_sheet(worksheetData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Verificación');
  XLSX.writeFile(workbook, `${fileName}.xlsx`);
};

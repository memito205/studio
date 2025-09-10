import { RawTransaction, Transaction, TransactionType } from '../types';

// Helper to find a value in a row by checking multiple possible keys (case-insensitive and trimmed)
const getValueFromRow = (row: { [key: string]: any }, possibleKeys: string[]): any => {
  const lowercasedRow: { [key: string]: any } = {};
  for (const key in row) {
    lowercasedRow[key.toLowerCase().trim()] = row[key];
  }

  for (const key of possibleKeys) {
    const value = lowercasedRow[key.toLowerCase()];
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return undefined;
};


// Helper to convert Excel serial date to JS Date
function excelSerialDateToJSDate(serial: number): Date {
  // Excel's epoch can be ambiguous (1900 vs 1904). This formula assumes the common 1900-based system.
  // 25569 is the number of days between 1900-01-01 and the Unix epoch (1970-01-01).
  const utc_days = Math.floor(serial - 25569);
  const utc_value = utc_days * 86400; // seconds
  const date_info = new Date(utc_value * 1000); // ms

  const fractional_day = serial - Math.floor(serial) + 0.0000001;

  let total_seconds = Math.floor(86400 * fractional_day);
  const seconds = total_seconds % 60;
  total_seconds -= seconds;
  const hours = Math.floor(total_seconds / 3600);
  const minutes = Math.floor(total_seconds / 60) % 60;

  // Use UTC methods to extract date parts. This prevents the user's local timezone
  // from causing an off-by-one day error during conversion.
  // Then, we create a new Date object. It will be in the user's local timezone
  // but will represent the correct calendar date and time from the source data.
  return new Date(
    date_info.getUTCFullYear(),
    date_info.getUTCMonth(),
    date_info.getUTCDate(),
    hours,
    minutes,
    seconds
  );
}


export const processRawData = (rawData: RawTransaction[]): Transaction[] => {
  if (!rawData || !Array.isArray(rawData)) {
    return [];
  }
  
  return rawData
    .filter(row => {
        const type = getValueFromRow(row, ['Tipo docto.']);
        const value = getValueFromRow(row, ['Valor subtotal local']);
        const date = getValueFromRow(row, ['Fecha']);
        return row && (type === 'FVE' || type === 'NCE') && typeof value === 'number' && typeof date === 'number';
    })
    .map(row => {
      const type = getValueFromRow(row, ['Tipo docto.']);
      const value = getValueFromRow(row, ['Valor subtotal local']);
      // Per user request, NCE values are negative and need to be made positive.
      const processedValue = type === TransactionType.Return 
        ? Math.abs(value) 
        : value;
      
      const originalPdv = getValueFromRow(row, ['PDV', 'Nombre Vendedor']) || 'N/A';
      let processedPdv = originalPdv;
      if (typeof originalPdv === 'string' && originalPdv.toUpperCase().includes('INSTOR')) {
        processedPdv = 'Canal INSTORE';
      }

      return {
        date: excelSerialDateToJSDate(getValueFromRow(row, ['Fecha'])),
        type: type,
        value: processedValue,
        quantity: 1, // Assuming 1 quantity per transaction row
        brand: getValueFromRow(row, ['Marca', 'MARCA']) || 'N/A',
        gender: getValueFromRow(row, ['Genero', 'Género', 'GEN.']) || 'N/A',
        group: getValueFromRow(row, ['Grupo', 'GRUPO']) || 'N/A',
        returnReason: getValueFromRow(row, ['Motivo devolucion', 'Motivo Devolucion', 'Desc. motivo']) || null,
        pdv: processedPdv,
        reference: getValueFromRow(row, ['Referencia']) || 'N/A',
      };
    });
};
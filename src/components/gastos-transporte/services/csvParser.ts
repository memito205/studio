// Make XLSX available from the global scope (CDN)
declare var XLSX: any;

const parseSheetData = (data: ArrayBuffer): { headers: string[], rows: string[][] } => {
    const workbook = XLSX.read(data, {type: 'array', cellDates: true});
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    // sheet_to_json with header: 1 gives an array of arrays
    const sheetData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
    
    if (sheetData.length === 0) return { headers: [], rows: [] };

    // Convert all header cells to strings and trim them
    const headers = sheetData[0].map(header => String(header).trim());
    
    // Convert all row data to strings and trim them
    const rows = sheetData.slice(1).map(row => {
        // Ensure the row has the same number of columns as the header
        const fullRow = Array(headers.length).fill("");
        row.forEach((cell, i) => {
            if (i < headers.length) {
                if (cell instanceof Date) {
                    // FIX: Use UTC methods to prevent local timezone from shifting the date.
                    const year = cell.getUTCFullYear();
                    const month = (cell.getUTCMonth() + 1).toString().padStart(2, '0');
                    const day = cell.getUTCDate().toString().padStart(2, '0');
                    fullRow[i] = `${year}-${month}-${day}`;
                } else {
                    fullRow[i] = String(cell ?? "").trim();
                }
            }
        });
        return fullRow;
    });

    return { headers, rows };
}

export const parseFiles = async (files: FileList): Promise<{ headers: string[], records: { [key: string]: string }[] }> => {
  return new Promise(async (resolve, reject) => {
    if (!files || files.length === 0) {
      return reject(new Error("No se seleccionaron archivos."));
    }

    const allHeaders = new Set<string>();
    const allFileRecords: { headers: string[], rows: string[][], fileName: string }[] = [];
    let processedFileCount = 0;

    for (const file of Array.from(files)) {
      const fileName = file.name.toLowerCase();
      
      if (!fileName.endsWith('.csv') && !fileName.endsWith('.xlsx') && !fileName.endsWith('.xls')) {
        console.warn(`Skipping unsupported file type: ${file.name}`);
        continue;
      }
      
      try {
        const data = await file.arrayBuffer();
        const { headers, rows } = parseSheetData(data);

        if (headers.length === 0 || rows.length === 0) {
            continue; // Skip empty or header-only files
        }

        headers.forEach(h => allHeaders.add(h));
        allFileRecords.push({ headers, rows, fileName: file.name });
        processedFileCount++;

      } catch (error: any) {
        console.error(`Error processing file ${file.name}:`, error);
        if (error.name === 'NotReadableError') {
          return reject(new Error(`No se pudo leer el archivo "${file.name}". Esto puede ocurrir por restricciones de seguridad del navegador. Por favor, intente seleccionar la carpeta nuevamente.`));
        }
        return reject(new Error(`Error al procesar el archivo "${file.name}". Asegúrese de que sea un archivo CSV o Excel válido.`));
      }
    }
    
    if (processedFileCount === 0) {
        return reject(new Error("No se encontraron archivos CSV o Excel válidos con datos en el directorio."));
    }

    const unionHeaders = Array.from(allHeaders);
    const unifiedRecords: { [key: string]: string }[] = [];

    allFileRecords.forEach(({ headers, rows }) => {
        rows.forEach(row => {
            const unifiedRecord: { [key: string]: string } = {};
            // Initialize with empty strings for all possible headers
            unionHeaders.forEach(h => unifiedRecord[h] = '');

            // Fill in the data from the current row
            headers.forEach((header, index) => {
                if(unionHeaders.includes(header)) {
                    unifiedRecord[header] = row[index] || '';
                }
            });
            unifiedRecords.push(unifiedRecord);
        });
    });

    resolve({ headers: unionHeaders, records: unifiedRecords });
  });
};
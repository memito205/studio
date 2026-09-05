
// utils/formatters.ts

// Centralized function to parse dates from various string formats into YYYY-MM-DD
export const parseDateFlexible = (dateInput: string | Date | number, formatHint: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD' = 'DD/MM/YYYY'): string => {
    if (!dateInput) return '';

    // Handle Date objects directly, which can be passed by the XLSX library
    // Using UTC methods ensures we get the date as it was in the file, avoiding local timezone shifts.
    if (dateInput instanceof Date) {
        const year = dateInput.getUTCFullYear();
        const month = (dateInput.getUTCMonth() + 1).toString().padStart(2, '0');
        const day = dateInput.getUTCDate().toString().padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    // Coerce to string for other types (string, number) and trim
    const trimmedDate = String(dateInput).trim();


    // Priority 1: YYYY-MM-DD or YYYY/MM/DD (unambiguous)
    const ymdMatch = trimmedDate.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
    if (ymdMatch) {
        const year = ymdMatch[1];
        const month = ymdMatch[2].padStart(2, '0');
        const day = ymdMatch[3].padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    
    // Priority 2: Ambiguous format ##/##/####, use the hint
    const ambiguousMatch = trimmedDate.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (ambiguousMatch) {
        let day, month, year;
        year = ambiguousMatch[3];

        if (formatHint === 'DD/MM/YYYY') {
            day = ambiguousMatch[1].padStart(2, '0');
            month = ambiguousMatch[2].padStart(2, '0');
        } else { // MM/DD/YYYY
            month = ambiguousMatch[1].padStart(2, '0');
            day = ambiguousMatch[2].padStart(2, '0');
        }

        // Basic validation
        if (parseInt(month) > 0 && parseInt(month) <= 12 && parseInt(day) > 0 && parseInt(day) <= 31) {
            return `${year}-${month}-${day}`;
        }
    }
    
    // Fallback for Excel serial date numbers passed as strings
    const numericValue = Number(trimmedDate);
    if (!isNaN(numericValue) && numericValue > 1 && numericValue < 2958466) { // Range for 1900-9999
        // This formula converts Excel serial number to JS Date.
        // It accounts for Excel's 1900 leap year bug by using an epoch of 1899-12-30.
        const excelEpoch = new Date(Date.UTC(1899, 11, 30));
        const date = new Date(excelEpoch.getTime() + numericValue * 24 * 60 * 60 * 1000);
        
        const year = date.getUTCFullYear();
        const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
        const day = date.getUTCDate().toString().padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    // If nothing matches, return original trimmed string
    return trimmedDate;
};

export const formatCurrency = (value: number, short = false): string => {
    if (short) {
        if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} M`;
        if (value >= 1_000) return `${(value / 1_000).toFixed(1)} K`;
    }
    return value.toLocaleString('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 });
};

export const formatNumber = (value: number): string => {
    return value.toLocaleString('es-CO');
};
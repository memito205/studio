
/**
 * @fileoverview Utility functions for robust data parsing.
 * This file centralizes common data transformation logic to be reused across different modules,
 * improving reliability and maintainability.
 */

/**
 * Converts an Excel serial date number to a JS Date object.
 * Correctly handles timezone offsets to prevent date shifting by treating the date as UTC.
 * @param serial The Excel serial number.
 * @returns A Date object.
 */
export function excelSerialDateToJSDate(serial: number): Date {
    if (isNaN(serial) || serial <= 0) {
      // Return an invalid date for invalid serial numbers to prevent infinite loops or crashes.
      return new Date(NaN);
    }
    // Excel's epoch starts on 1899-12-30 for Windows.
    // We add the number of days (serial number) to this epoch.
    // The result is calculated in milliseconds and then used to create a UTC date.
    // 86400000 is the number of milliseconds in one day (24 * 60 * 60 * 1000).
    const excelEpoch = Date.UTC(1899, 11, 30);
    // Excel incorrectly considers 1900 a leap year. We subtract 1 for dates after Feb 28, 1900 (serial > 59).
    const days = serial - (serial > 59 ? 1 : 0);
    const dateInMilliseconds = excelEpoch + days * 86400000;
    
    // Create a new Date object from the UTC milliseconds. This correctly represents the date without timezone shifts.
    return new Date(dateInMilliseconds);
}


/**
 * Normalizes a header string by converting it to lowercase, removing accents,
 * and replacing spaces/special characters with underscores.
 * @param header The original header string.
 * @returns The normalized header string.
 */
export const normalizeHeader = (header: string): string => {
  if (!header) return '';
  return header
    .toString()
    .toLowerCase()
    .trim()
    .normalize('NFD') // Decompose accented characters
    .replace(/[\u0300-\u036f]/g, '') // Remove combining diacritical marks
    .replace(/[^a-z0-9_]/g, '_') // Replace non-alphanumeric with underscore
    .replace(/_{2,}/g, '_'); // Replace multiple underscores with a single one
};


/**
 * Robustly parses a string into a number, handling various formats including Colombian currency.
 * It correctly interprets thousand separators ('.') and removes currency symbols.
 * - "$7.160.702.089" -> 7160702089
 * - "14.639" -> 14639
 * - "1.234,56" -> 1234.56
 * @param value The string to parse.
 * @returns The parsed number, or NaN if parsing is not possible.
 */
export const parseRobustNumber = (value: string | number | null | undefined): number => {
  if (value === null || value === undefined) return NaN;
  if (typeof value === 'number') return value;

  const str = String(value).trim();
  if (!str) return NaN;

  // Remove currency symbols and thousand separators (.), then replace comma with a dot for decimals
  const cleanedStr = str.replace(/[$.]/g, '').replace(',', '.');
  
  const num = parseFloat(cleanedStr);
  return isNaN(num) ? NaN : num;
};


/**
 * Parses a date string from various common formats (DD/MM/YYYY, YYYY-MM-DD, Excel serial, full string date).
 * It attempts to parse directly first, then tries specific formats.
 * @param dateStr The string or number representing the date.
 * @returns A Date object, or null if parsing fails.
 */
export const parseFlexibleDate = (dateStr: string | number | Date | null | undefined): Date | null => {
  if (!dateStr) return null;
  
  if (dateStr instanceof Date) {
    if (!isNaN(dateStr.getTime())) {
      return dateStr;
    }
    return null;
  }

  // Handling for Excel serial dates which come in as numbers
  if (typeof dateStr === 'number' || !isNaN(Number(dateStr))) {
     try {
        const date = excelSerialDateToJSDate(Number(dateStr));
        if (!isNaN(date.getTime())) return date;
    } catch (e) { /* ignore parsing error and proceed */ }
  }
  
  const str = String(dateStr).trim();

  // Try direct parsing first for ISO and other standard formats
  const directDate = new Date(str);
  if (!isNaN(directDate.getTime())) {
    // If it's a valid date, we must correct for timezone issues.
    // An ISO-like string without timezone info is treated as UTC by new Date().
    // We get the offset and add it back to get the "local" date the user intended.
    return new Date(directDate.valueOf() + directDate.getTimezoneOffset() * 60 * 1000);
  }

  // Prioritize DD-MM-YYYY format
  const dmyParts = str.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (dmyParts) {
    const day = parseInt(dmyParts[1], 10);
    const month = parseInt(dmyParts[2], 10);
    let year = parseInt(dmyParts[3], 10);
    if (year < 100) year += (year < 70 ? 2000 : 1900);
    
    if (day > 0 && day <= 31 && month > 0 && month <= 12 && year > 1000 && year < 3000) {
      // Construct date as UTC to avoid local timezone from shifting the date.
      const date = new Date(Date.UTC(year, month - 1, day, 12)); // Use midday to be safe
      if(!isNaN(date.getTime())) return date;
    }
  }

  console.warn(`Could not parse date: "${str}"`);
  return null;
}


/**
 * Finds a key in an object case-insensitively, also removing extra spaces.
 * @param obj The object to search within.
 * @param key The key to find.
 * @returns The original key from the object if found, otherwise undefined.
 */
export const findCaseInsensitiveKey = (obj: { [key: string]: any } | undefined, key: string): string | undefined => {
    if (!obj) return undefined;
    const lowerCaseKey = key.toLowerCase().trim();
    return Object.keys(obj).find(k => k.toLowerCase().trim() === lowerCaseKey);
};

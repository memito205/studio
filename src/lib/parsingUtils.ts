/**
 * @fileoverview Utility functions for robust data parsing.
 * This file centralizes common data transformation logic to be reused across different modules,
 * improving reliability and maintainability.
 */

/**
 * Converts an Excel serial date number to a JS Date object.
 * Correctly handles timezone offsets by treating the date as UTC.
 * @param serial The Excel serial number.
 * @returns A Date object.
 */
export function excelSerialDateToJSDate(serial: any): Date {
  if (serial instanceof Date) {
      return !isNaN(serial.getTime()) ? serial : new Date(NaN);
  }
  const serialNumber = Number(serial);
  if (isNaN(serialNumber) || serialNumber <= 0) {
    return new Date(NaN);
  }

  // This formula correctly converts Excel's serial number (based on 1900) to a JS Date.
  // It accounts for Excel's incorrect assumption that 1900 was a leap year.
  const utc_days = Math.floor(serialNumber - 25569);
  const utc_value = utc_days * 86400;
  const date_info = new Date(utc_value * 1000);

  const fractional_day = serialNumber - Math.floor(serialNumber) + 0.0000001;
  const total_seconds = Math.floor(86400 * fractional_day);
  const seconds = total_seconds % 60;
  const hours = Math.floor(total_seconds / (60 * 60));
  const minutes = Math.floor(total_seconds / 60) % 60;

  return new Date(
    date_info.getUTCFullYear(),
    date_info.getUTCMonth(),
    date_info.getUTCDate(),
    hours,
    minutes,
    seconds
  );
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
 * It attempts to parse directly first, then tries specific formats. Avoids timezone shifts by treating dates as local.
 * @param dateStr The string or number representing the date.
 * @returns A Date object, or null if parsing fails.
 */
export const parseFlexibleDate = (dateStr: string | number | Date | null | undefined): Date | null => {
  if (!dateStr) return null;
  
  if (dateStr instanceof Date) {
    if (isNaN(dateStr.getTime())) return null;
    return dateStr;
  }

  // Handle Excel serial numbers
  if (typeof dateStr === 'number' || /^\d{5,}(\.\d+)?$/.test(String(dateStr))) {
     try {
        const date = excelSerialDateToJSDate(Number(dateStr));
        if (!isNaN(date.getTime())) {
            return date;
        }
    } catch (e) { /* ignore parsing error and proceed */ }
  }
  
  const str = String(dateStr).trim();
  
  // Try parsing full ISO-like string dates first ("YYYY-MM-DDTHH:mm:ss...")
  // This will correctly handle timezone info if it's present.
  const isoDate = new Date(str);
  if (!isNaN(isoDate.getTime()) && (str.includes('T') || str.split(' ').length > 1 || str.includes(','))) {
    return isoDate;
  }

  // Try parsing "DD/MM/YYYY HH:mm" or "DD/MM/YYYY"
  const dmyParts = str.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})(?:[ T](\d{1,2}):(\d{1,2}))?/);
  if (dmyParts) {
    const day = parseInt(dmyParts[1], 10);
    const month = parseInt(dmyParts[2], 10);
    let year = parseInt(dmyParts[3], 10);
    if (year < 100) year += (year < 70 ? 2000 : 1900);
    const hour = parseInt(dmyParts[4], 10) || 0;
    const minute = parseInt(dmyParts[5], 10) || 0;
    
    if (day > 0 && day <= 31 && month > 0 && month <= 12 && year > 1000 && year < 3000) {
      // Create date using local time parts to avoid timezone shifts
      const date = new Date(year, month - 1, day, hour, minute);
      if(!isNaN(date.getTime())) return date;
    }
  }

  // Try parsing "YYYY-MM-DD" last as it's less common in the source files but good for ISO strings without time
  const ymdParts = str.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/);
  if (ymdParts) {
      const year = parseInt(ymdParts[1], 10);
      const month = parseInt(ymdParts[2], 10);
      const day = parseInt(ymdParts[3], 10);
      if (day > 0 && day <= 31 && month > 0 && month <= 12 && year > 1000 && year < 3000) {
        // Create date as local
        const date = new Date(year, month - 1, day);
        if (!isNaN(date.getTime())) return date;
      }
  }

  console.warn(`Could not parse date: "${str}"`);
  return null;
}

/**
 * Extracts a YYYY-MM-DD string from a Date object using local time components.
 * This is safer than toISOString() in negative timezones.
 * @param date The date object.
 * @returns A string in YYYY-MM-DD format.
 */
export const extractLocalDateString = (date: Date | string): string => {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return String(date).split('T')[0];
    
    // If it's a date with 00:00:00 time, it's almost certainly intended as a "Calendar Date"
    // and might have come from a UTC source (Excel/Server).
    // In UTC- environments (like CO), d.getDate() would return the previous day.
    // So we use UTC components if it's pure midnight.
    if (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0) {
        const year = d.getUTCFullYear();
        const month = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    
    // Otherwise it's a timestamped date, use local components
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};


/**
 * Finds a key in an object case-insensitively, also removing extra spaces and diacritics (accents).
 * @param obj The object to search within.
 * @param keys The keys to find, in order of preference.
 * @returns The original key from the object if found, otherwise undefined.
 */
export const findCaseInsensitiveKey = (obj: { [key: string]: any } | undefined, ...keys: string[]): string | undefined => {
    if (!obj) return undefined;
    
    // Normalization function
    const normalize = (str: string) => str
        .toLowerCase()
        .trim()
        .normalize("NFD") // Decompose accented characters into base characters and diacritics
        .replace(/[\u0300-\u036f]/g, "") // Remove the diacritics
        .replace(/[_-]/g, ' '); // Replace underscores and hyphens with spaces

    const lowercasedKeysToFind = keys.map(normalize);
    const objectKeys = Object.keys(obj);

    for (const keyToFind of lowercasedKeysToFind) {
        const foundKey = objectKeys.find(objKey => normalize(objKey) === keyToFind);
        if (foundKey) {
            return foundKey;
        }
    }
    return undefined;
};


/**
 * Calculates the total number of business hours between two dates.
 * Excludes Sundays, specified holidays, and Saturdays after 4 PM.
 * @param startDate The start date.
 * @param endDate The end date.
 * @param holidays An array of holiday dates.
 * @returns The total number of business hours.
 */
export const calculateSlaHours = (startDate: Date, endDate: Date, holidays: Date[]): number => {
    if (!startDate || !endDate || isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return 0;
    if (startDate > endDate) return 0;

    let totalBusinessMs = 0;
    
    // Create localized string keys (YYYY-MM-DD) avoiding UTC shifts
    const toLocalString = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const holidaySet = new Set(holidays.map(toLocalString));
    
    let current = new Date(startDate);

    while (current < endDate) {
        const dayOfWeek = current.getDay(); // Sunday is 0, Saturday is 6
        const hourOfDay = current.getHours();
        const dateString = toLocalString(current);

        const isBusinessTime = !(
            dayOfWeek === 0 || // Is Sunday
            holidaySet.has(dateString) || // Is a holiday
            (dayOfWeek === 6 && hourOfDay >= 16) // Is Saturday 4 PM or later
        );

        // Find the next time the business-hour status *could* change
        let nextChangeTime: Date;
        if (dayOfWeek === 6 && hourOfDay < 16) {
            // On a working Saturday, the next change is at 4 PM
            nextChangeTime = new Date(current);
            nextChangeTime.setHours(16, 0, 0, 0);
        } else {
            // On a weekday, Sunday, holiday, or after-hours Saturday, the next change is the start of the next day
            nextChangeTime = new Date(current);
            nextChangeTime.setDate(nextChangeTime.getDate() + 1);
            nextChangeTime.setHours(0, 0, 0, 0);
        }

        // The current segment ends either at the next status change or the overall end time, whichever is sooner
        const endOfSegment = new Date(Math.min(endDate.getTime(), nextChangeTime.getTime()));

        // If the current segment is within business hours, add its duration
        if (isBusinessTime) {
            totalBusinessMs += (endOfSegment.getTime() - current.getTime());
        }

        // Move to the end of the processed segment for the next iteration
        current = endOfSegment;
    }

    return totalBusinessMs / (1000 * 60 * 60);
};

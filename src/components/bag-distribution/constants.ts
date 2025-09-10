import type { HeaderConfig } from '../types';

export const MAIN_CONSUMPTION_DOC_TYPES: string[] = ['RMV', 'RMP'];
export const ADJUSTMENT_DOC_TYPES: string[] = ['AJS'];
export const DOC_TYPES_TO_INCLUDE: string[] = [...MAIN_CONSUMPTION_DOC_TYPES, ...ADJUSTMENT_DOC_TYPES];

export const COLUMN_MAPPINGS: HeaderConfig = {
  itemCode: ['COD. ITEM', 'ITEM', 'CODIGO ITEM', 'ARTICULO', 'CODIGO'],
  docType: ['Tipo docto.', 'TIPO DOCUMENTO', 'DOCTO'], 
  quantity: ['SALIDA (INV.)', 'Salidas (inv.)', 'SALIDA INV', 'CANTIDAD SALIDA', 'CANTIDAD', 'SALIDAS'],
  date: ['FECHA'],
  bodega: ['BODEGA', 'ALMACEN', 'BODEGA ORIGEN', 'BODEGA DESTINO', 'ALMACÉN'],
};

export const SMA_PERIOD: number = 3;
export const SES_ALPHA: number = 0.3;
export const WMA_PERIOD: number = 3; // Período para Weighted Moving Average
export const DAMPING_FACTOR: number = 0.95; // Damping factor for linear regression

// Número total de períodos futuros para los que se generarán pronósticos y se basará la recomendación de compra.
// (Ej: 1er período siguiente + 3 adicionales = 4 en total)
export const NUMBER_OF_FUTURE_PERIODS_FOR_RECOMMENDATION: number = 4;


export const MONTH_NAMES_ES: string[] = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun", 
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"
];

// Z-scores for common service levels
export const Z_SCORE_LOOKUP: { [key: number]: number } = {
  80: 0.84,
  85: 1.04,
  90: 1.28,
  92: 1.41, // Approx
  95: 1.645,
  97: 1.88,
  98: 2.05,
  99: 2.33,
  // Add more if needed
};

// Default Item Parameters
export const DEFAULT_LEAD_TIME_DAYS = 7;
export const DEFAULT_SERVICE_LEVEL_PERCENTAGE = 95;

// Bodegas to exclude from forecasting calculations (e.g., internal transfers, write-offs)
export const BODEGAS_TO_EXCLUDE: string[] = []; // Initialize as empty, can be populated as needed

// Minimum number of historical months required to use full forecasting methods (SMA, SES, etc.)
// If less than this, a simpler method (e.g., simple average) might be used.
export const MIN_MONTHS_FOR_FULL_FORECAST: number = 6;

// For Distribution Module
export const BODEGAS_TO_EXCLUDE_FOR_DISTRIBUTION: string[] = [
  "BODVI", "BDBOL", "BODMO", "BMC03", 
  "21701", "30201", "21901", "31701",
  "BODPN" 
].map(b => b.toUpperCase()); 

export const DISTRIBUTION_COVERAGE_DAYS: number = 15; // Default coverage

export const SPECIAL_COVERAGE_BODEGAS: { [bodegaCode: string]: number } = {
  "20301": 30,
  "30701": 30,
  "22301": 30,
  "22101": 30,
  "21601": 30,
  "20601": 30,
};

export const ITEM_SPECIFIC_ROUNDING_RULES: { [itemCode: string]: number } = {
  "9615": 25,
  "9618": 50,
  "9619": 50, // Actualizado a 50
  "27650": 25,
};

export const DEFAULT_ROUNDING_MULTIPLE = 1; 

// Constantes para el modelo de distribución HÍBRIDO
// Número mínimo de meses con ventas para que una bodega sea candidata a un pronóstico directo
export const MIN_MONTHS_FOR_DIRECT_FORECAST = 12; 
// Coeficiente de Variación (CV) máximo. Un CV más bajo significa ventas más estables.
// CV = Desviación Estándar / Media. Un valor de 1.0 significa que la desviación es tan grande como la media.
export const MAX_CV_FOR_DIRECT_FORECAST = 1.0; 


// Constantes para Ajuste Estacional Manual
export const HIGH_SEASON_MONTHS: number[] = [1, 5, 6, 10, 11, 12]; // Ene, May, Jun, Oct, Nov, Dic
export const MANUAL_SEASONAL_ADJUSTMENT_FACTOR = 1.20; // 20% increase for high season months if statistical indices are unavailable.

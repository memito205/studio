
export interface ExpenseRecord {
  fecha: string;
  destino: string;
  costo: number;
  contable: string; 
  concepto: string; 
  guia?: string;
  modificacionNC?: string;
}

export interface IncomeRecord {
  fecha: string;
  monto: number;
  contable: string;
  co: string;
  concepto: string;
  ordenDeCompra: string;
  modificacionNC?: string;
  guia?: string;
}

export interface JustificationRecord {
  pedId: string;
  motivo: string;
}

export interface ReconciledTransaction {
  id: string;
  fechaIngreso: string;
  nroDocumento: string;
  guia?: string;
  montoIngreso: number;
  fechaGasto?: string;
  costoGasto?: number;
  utilidad: number;
  margen: number;
  carrierName?: string;
}

export interface CarrierData {
  id: string;
  name: string;
  data: ExpenseRecord[];
  color: string;
}

export enum AppView {
  UPLOAD,
  MAPPING,
  DASHBOARD,
}

export interface ColumnMapping {
  fecha: string;
  destino: string;
  costo: string;
  contable: string;
  concepto: string;
  guia: string;
  dateFormat: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
}

export type ActiveFilters = {
  carriers: string[];
  concepts: string[];
  destinations: string[];
  months: string[];
};

export type FilterCategory = keyof ActiveFilters;

export type MainView = 'dashboard' | 'comparative' | 'income-expense' | 'profitability' | 'expense-profitability' | 'justifications' | 'year-over-year' | 'accrual';

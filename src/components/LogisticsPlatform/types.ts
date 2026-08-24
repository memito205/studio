
// FIX: Import React to use React.ReactNode type.
import type React from 'react';

export interface ExcelDataRow {
  [key: string]: string | number | Date;
}

export interface AnalysisResult {
  name: string;
  documentos: number;
  cantidad: number;
}

export interface SummaryRow {
    [key: string]: string | number;
    'BOD. ENTRADA': string;
    'Nro. de Documentos Únicos': number;
    'Cantidad Total': string;
}

export interface DailyWarehouseSummaryRow {
    [key:string]: string | number;
    'FECHA': string;
    'BOD. ENTRADA': string;
    'Nro. de Documentos Únicos': number;
}

export interface FinalizedDocDetail {
    docNumber: string | number;
    finalizedDate: string;
    daysToFinalize: number;
    isOverdue: boolean;
    imageLink?: string;
    docDate: string;
    quantity: number;
    type?: 'finalized' | 'delivered';
    warehouseOut: string;
}

export interface PendingDocDetail {
  docNumber: string;
  quantity: number;
  daysPending: number;
  imageLink?: string;
  docDate: string;
  enRuta: string;
  warehouseOut: string;
}

export interface PendingSummaryRecord {
  marca: string;
  grupo: string;
  docCount: number;
  totalQuantity: number;
  avgDaysPending: number;
  detailedDocs: PendingDocDetail[];
}

export interface PendingDocsAnalysisData {
    warehouse: string;
    pendingCount: number;
    totalPendingQuantity: number;
    pendingRecords: PendingSummaryRecord[];
    participationPercentage: number;
}

export interface SlaAnalysisData {
    warehouse: string;
    compliance: number;
    totalFinalized: number;
    overdueCount: number;
    finalizedRecords: FinalizedDocDetail[];
}

export interface BrandSummaryRecord {
  brand: string;
  docCount: number;
  quantity: number;
}

export interface BrandSummaryByWarehouse {
  warehouse: string;
  summary: BrandSummaryRecord[];
}

export interface ReportData {
    kpiData: {
      totalDocs: string;
      deliveredCount: string;
      pendingCount: string;
      deliveredQty: string;
      pendingQty: string;
      compliancePercentage: string;
    };
    analysisData: AnalysisResult[];
    dailyChartData: { 'FECHA': string; 'Total Documentos': number }[];
    slaAnalysisData: SlaAnalysisData[];
    pendingDocsAnalysisData: PendingDocsAnalysisData[];
    generalReport: {
      data: { [key: string]: React.ReactNode }[];
      exportData: { [key: string]: any }[];
      headers: string[];
    };
    deliveredDocsReport: {
      data: { [key: string]: React.ReactNode }[];
      exportData: { [key: string]: any }[];
      headers: string[];
    };
    brandReport: {
      data: { [key: string]: React.ReactNode }[];
      exportData: { [key: string]: any }[];
      headers: string[];
    };
    brandSummaryByWarehouse: BrandSummaryByWarehouse[];
    deliveredDocsByWarehouse: { warehouse: string; count: number }[];
    pendingRows: ExcelDataRow[];
  }

// --- TYPES FOR BREAKS DASHBOARD ---

export interface ProcessedBreak {
    mealType: string;
    duration: number; // in minutes
    startTime: Date;
    endTime: Date;
    isPartial: boolean;
}

export interface EmployeeDailyAnalysis {
    employeeName: string;
    totalMinutes: number;
    completedBreaks: ProcessedBreak[];
    missedBreaks: string[];
    partialMarkingsCount: number;
    exceededTotalTime: boolean;
    isCompliant: boolean;
}

export interface DailyAnalysis {
    date: string; // "DD/MM/YYYY"
    employeesAnalysis: EmployeeDailyAnalysis[];
    stats: {
        totalEmployees: number;
        employeesExceedingTime: number;
        employeesWithMissedBreaks: number;
        employeesWithPartialRegs: number;
    };
}

export interface WeeklyTrend {
    week: string; // e.g., "Semana del 15/07/2024"
    avgBreakTime: number;
    complianceRate: number; // % of compliant employee-days
    exceededRate: number; // % of exceeded employee-days
}

export interface EmployeePerformance {
    employeeName: string;
    avgTime: number;
    totalExceededDays: number;
    totalPartialDays: number;
    totalMissedDays: number; // Days with at least one missed break
    complianceRate: number; // % of days the employee was compliant
}

export interface BreaksReportData {
    kpis: {
        complianceRate: number;
        exceededRate: number;
        avgBreakTime: number;
        totalEmployeesWithBreaks: number;
        partialMarkingRate: number;
    };
    weeklyTrends: WeeklyTrend[];
    employeePerformances: EmployeePerformance[];
    dailyAnalyses: DailyAnalysis[];
}

// --- TYPES FOR RUTAS MODULE ---
export interface RouteTask {
    id: string;
    tf: string | number;
    type: 'RECOGER' | 'ENTREGAR';
    seEnviaCon: string;
    observaciones: string;
    vehiculo: string;
    valor?: string;
    order?: number;
    runningLoad?: number;
    loadWarning?: string;
}

export interface VehiclePlan {
    name: string;
    tasks: RouteTask[];
}

// --- TYPES FOR WAREHOUSE PROCESSES MODULE ---
export interface ObservationSummary {
  id: string;
  observation: string;
  originalObservation: string;
  totalQuantity: number;
  totalPacked: number;
  packedPercentage: number;
  fechaObs: string;
  fechaEntrega: string; 
  procesoObservacion: string;
  isVXM?: boolean;
  conteoPorcentaje?: number;
  etiquetadoPorcentaje?: number;
  revisionCalidadPorcentaje?: number;
  remisionPorcentaje?: number;
  // Campos de Avance Diario (Calculados vs Día Anterior)
  deltaPacked?: number;
  deltaConteo?: number;
  deltaEtiquetado?: number;
  deltaCalidad?: number;
  deltaRemision?: number;
  hasDeltas?: boolean;
}

export interface PendingGoodsItem {
  id: string;
  marca: string;
  cantidadEntrada: number;
  fechaEntradaAprox: string; // ISO string 'YYYY-MM-DD'
}


// --- TYPES FOR DELIVERY SUMMARY ---
export interface EntregasPorVehiculo {
  vehiculo: string;
  items: { ubicacion: string, marca: string, cantidad: number }[];
}

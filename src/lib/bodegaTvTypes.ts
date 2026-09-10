export type BodegaTvPersonRank = {
  name: string;
  units: number;
  productivity: number;
  compliance?: number;
  meta?: string;
};

export type BodegaTvAreaKey = 'empaque' | 'etiquetado' | 'tallado' | 'recepcion';

export type BodegaTvAreaSnapshot = {
  key: BodegaTvAreaKey;
  title: string;
  units: number;
  operators: number;
  productivity: number;
  compliance?: number;
  ranking: BodegaTvPersonRank[];
  extras?: { label: string; value: string }[];
  /** Claves canónicas de personas identificadas (uid:/name:) para deduplicar recursos. */
  peopleKeys?: string[];
  /**
   * Personas de tallado sin identidad nominada (peopleCount − operario del turno).
   * Solo aplica a tallado; el resumen las suma aparte del set único.
   */
  anonymousPeople?: number;
};

export type BodegaTvRemainderAssignmentRow = {
  operatorName: string;
  reference: string;
  rkIdentifier?: string;
  locationName?: string;
  expectedRemainderQty: number;
  /** Cantidad declarada / legalizada por el operario. */
  returnedQty?: number;
  /** true si devolvió el remanente completo (o esperado 0 confirmado). */
  remainderComplete?: boolean;
  /** Texto corto para TV: Completo / Parcial x/y / Pendiente. */
  legalizationLabel?: string;
  status: string;
  statusLabel: string;
};

/** Fila de aporte al total de etiquetado del día (Bodega Live). */
export type EtiquetadoContributionRow = {
  id: string;
  source: 'finish' | 'unit_complete';
  logId: string;
  operationId: string;
  reference: string;
  status: string;
  trackingMode?: string;
  operatorLabel: string;
  timestamp: string;
  units: number;
  /** Cómo se obtuvo la und (log / fallback tarea). */
  unitsSource: 'log' | 'operation_completed' | 'qty';
};

export type EtiquetadoDayBreakdown = {
  dayKey: string;
  finishUnits: number;
  liveUnits: number;
  /** finishUnits + liveUnits (mismo headline que Bodega Live). */
  totalUnits: number;
  contributions: EtiquetadoContributionRow[];
};

export type BodegaTvSnapshot = {
  dayKey: string;
  generatedAt: string;
  areas: BodegaTvAreaSnapshot[];
  summary: {
    totalUnits: number;
    avgCompliance: number;
    /** Personas únicas del día (sin repetir la misma persona entre áreas). */
    operators: number;
  };
  /** Asignaciones Físico vs Distribución (remanentes / confirmación 0). */
  remainderAssignments?: BodegaTvRemainderAssignmentRow[];
};

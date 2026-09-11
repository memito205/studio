export type BodegaTvPersonRank = {
  name: string;
  units: number;
  productivity: number;
  compliance?: number;
  meta?: string;
};

export type BodegaTvAreaKey = 'empaque' | 'etiquetado' | 'tallado' | 'recepcion';

/** full = TV bodega completa; externos = Tallado + Etiquetado Externo (kiosk). */
export type BodegaTvMode = 'full' | 'externos';

/** Producción por hora de reloj (America/Bogota) para Monitor Live Externos. */
export type BodegaTvHourlyBucket = {
  hour: number;
  hourLabel: string;
  units: number;
  /** Und / persona·h (o und / h activa) en esa franja. */
  productivity: number;
  /** Personas / recursos que aportaron tiempo o und en la franja. */
  people?: number;
};

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
  /** Solo Monitor Live Externos: und + U/H por hora. */
  hourlyBuckets?: BodegaTvHourlyBucket[];
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
  /** true = no suma al total (p. ej. FINISH duplicado de la misma tarea). */
  excluded?: boolean;
  excludeReason?: string;
};

export type EtiquetadoDayBreakdown = {
  dayKey: string;
  finishUnits: number;
  liveUnits: number;
  /** finishUnits + liveUnits (mismo headline que Bodega Live). */
  totalUnits: number;
  /** FINISH duplicados omitidos al total. */
  omittedFinishDuplicates?: number;
  contributions: EtiquetadoContributionRow[];
};

export type BodegaTvSnapshot = {
  dayKey: string;
  generatedAt: string;
  mode?: BodegaTvMode;
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

export type BodegaTvPersonRank = {
  name: string;
  units: number;
  productivity: number;
  compliance?: number;
  meta?: string;
};

/** Resumen de una operación de recepción (varias pueden ir en paralelo). */
export type BodegaTvReceptionOpSummary = {
  id: string;
  rkIdentifier: string;
  supplier: string;
  status: string;
  statusLabel: string;
  /** Misma base que Cant. Leída en Recepción (totalScannedQuantity). */
  unitsCounted: number;
  /** @deprecated usar unitsCounted */
  unitsToday?: number;
  expectedQuantity: number;
  progressPct?: number;
  operatorsToday: number;
};

/** Pedido Ventas x Mayor en empaque (progreso packed vs total canónico). */
export type BodegaTvPackingOrderSummary = {
  id: string;
  cliente: string;
  ordenDeCompra?: string;
  status: string;
  statusLabel: string;
  packedUnits: number;
  totalUnits: number;
  remainingUnits: number;
  progressPct?: number;
};

export type BodegaTvAreaKey =
  | 'empaque'
  | 'etiquetado'
  | 'tallado'
  | 'recepcion'
  | 'ventas_mayor';

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
  /** Solo recepción: resumen por operación activa / con und hoy (antes del ranking). */
  receptionOps?: BodegaTvReceptionOpSummary[];
  /** Solo ventas_mayor: pedidos En Empaque con avance packed/total. */
  packingOrders?: BodegaTvPackingOrderSummary[];
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

/** Etapa compacta de un proceso RIM/VXM para Bodega Live. */
export type BodegaTvProcessStage = {
  label: string;
  pct: number;
};

/** Fila de proceso publicada desde Plataforma Logística → Procesos de Bodega. */
export type BodegaTvProcessRow = {
  id: string;
  name: string;
  type: 'RIM' | 'VXM';
  packedPercentage: number;
  totalQuantity: number;
  totalPacked: number;
  fechaEntrega?: string;
  isOverdue?: boolean;
  stages: BodegaTvProcessStage[];
  note?: string;
};

export type BodegaTvPendingGoodRow = {
  id: string;
  marca: string;
  cantidadEntrada: number;
  fechaEntradaAprox: string;
};

export type BodegaTvEntregaSummary = {
  vehiculo: string;
  itemCount: number;
  totalQty: number;
};

/** Documento `bodega_process_summaries/latest` (snapshot manual para TV). */
export type BodegaTvProcessSummary = {
  publishedAt: string;
  publishedBy: string;
  dayKey: string;
  source: string;
  processes: BodegaTvProcessRow[];
  pendingGoods: BodegaTvPendingGoodRow[];
  entregas?: BodegaTvEntregaSummary[];
  totals: {
    processCount: number;
    rimCount: number;
    vxmCount: number;
    overdueCount: number;
    avgProgress: number;
    pendingCount: number;
  };
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
  /** Resumen publicado desde Procesos de Bodega (manual). */
  processSummary?: BodegaTvProcessSummary | null;
};

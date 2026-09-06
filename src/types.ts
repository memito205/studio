
export enum TransactionType {
  Sale = 'FVE',
  Return = 'NCE',
}

// Types for interactive filtering
export type FilterCategory = 'brand' | 'gender' | 'group' | 'returnReason' | 'pdv' | 'reference' | 'tienda' | 'transportadora' | 'date' | 'bodega' | 'status';
export type Filters = Partial<Record<FilterCategory, string[]>>;

export interface RawTransaction {
  'Fecha'?: number;
  'Tipo docto.'?: TransactionType;
  'Valor subtotal local'?: number;
  'Marca'?: string;
  'Genero'?: 'HOMBRE' | 'DAMA' | 'JUNIOR' | 'UNISEX' | 'N/A';
  'Grupo'?: 'CALZADO' | 'ROPA' | 'ACCESORIOS' | 'N/A';
  'Motivo devolucion'?: 'CLIENTE NO ENCONTRADO' | 'TALLA GRANDE' | 'CAMBIO POR REFERENCIA' | 'TALLA PEQUEÑA' | 'NO ERA LO QUE ESPERABA' | 'OTRO' | null;
  'PDV'?: string;
  'Referencia'?: string;
  [key: string]: any; // Allows for flexible column names from XLSX files
}

/** Flag de contraentrega desde Excel de devoluciones (`CONTRAENTREGA`: SI / NO). */
export type ContraentregaFlag = 'SI' | 'NO';

export interface Transaction {
  date: Date;
  type: TransactionType;
  value: number;
  quantity: number;
  brand: string;
  gender: 'HOMBRE' | 'DAMA' | 'JUNIOR' | 'UNISEX' | 'N/A';
  group: 'CALZADO' | 'ROPA' | 'ACCESORIOS' | 'N/A';
  returnReason: 'CLIENTE NO ENCONTRADO' | 'TALLA GRANDE' | 'CAMBIO POR REFERENCIA' | 'TALLA PEQUEÑA' | 'NO ERA LO QUE ESPERABA' | 'OTRO' | null;
  pdv: string;
  reference: string;
  /**
   * Contraentrega (columna Excel `CONTRAENTREGA`).
   * null = vacío / histórico sin re-subir el campo.
   */
  contraentrega?: ContraentregaFlag | null;
  /** Nro documento (FVE-xxxx / NCE-xxxx). Opcional — datos históricos sin re-ingesta. */
  docNumber?: string;
  /** Factura base en NCE (FVE-xxxx). */
  baseInvoiceDoc?: string | null;
  /** Orden de compra compartida entre FVE y NCE. */
  purchaseOrder?: string | null;
  /** Mes de la factura origen (para vista "Mes factura"). FVE = misma que date. */
  attributionDate?: Date;
  /** NCE sin match: se imputa al mes del documento con alerta. */
  attributionUnmatched?: boolean;
  /** Cómo se resolvió el vínculo NC → factura. */
  attributionSource?: 'sale_self' | 'base_invoice' | 'purchase_order' | 'unmatched';
}


export interface RawFileData {
  name: string;
  content: string;
}

export interface MonthlyConsumption {
  year: number;
  month: number; // 1-12
  mainQuantity: number; // Consumo de RMV, RMP
  ajsQuantity: number;  // Consumo de AJS
  totalQuantity: number; // mainQuantity + ajsQuantity
  date: Date; // For sorting and full date context
  originalTotalQuantity?: number;
}

export type ItemMonthlyData = MonthlyConsumption[];

export type AllItemsMonthlyData = Map<string, ItemMonthlyData>; // Key: itemCode

export interface ProcessedRow {
  itemCode: string;
  docType: string; // Tipo de documento original (RMV, RMP, AJS)
  date: Date;
  quantity: number;
  bodega?: string; // Bodega de origen/destino
}

export interface HeaderConfig {
  itemCode: string[];
  docType: string[];
  quantity: string[];
  date: string[];
  bodega?: string[]; // Añadido para la columna de bodega
}

// Representa el valor pronosticado para un período específico
export interface PeriodForecastValue {
  periodLabel: string; // e.g., "Oct 2024"
  value: number | null; // Pronóstico base (ya incluye ajuste estacional si aplica)
  adjustedValue?: number | null; // Pronóstico con ajuste AJS (y estacional si aplica)
  startDate?: Date; // Fecha de inicio del período
  endDate?: Date;   // Fecha de fin del período
  neededToBuyForPeriod?: number | null; // Cantidad a comprar para este período específico, considerando el inventario proyectado
  projectedInventoryAfterDemand?: number | null; // Inventario proyectado después de cubrir la demanda de este período
  /** Día aproximado del mes en que se agota el inventario (si cae en este período). */
  estimatedStockOutDayInMonth?: number | null;
}

// Representa los pronósticos de un método específico a través de múltiples períodos futuros
export interface MethodForecast {
  methodName: string;
  forecasts: PeriodForecastValue[]; // Array de {periodLabel, value, adjustedValue?, startDate?, endDate?}, longitud = NUMBER_OF_FUTURE_PERIODS_FOR_RECOMMENDATION
}

export interface ItemParameters {
  leadTimeDays: number;
  serviceLevelPercentage: number;
}

export interface CalculationTrace {
    notes?: string[];
    winningMethod?: string | null;
    outliersAdjusted?: boolean;
    statisticalSeasonalIndices?: number[] | null;
    deseasonalizedData?: number[];
    shortfall_dailyRate: number;
    shortfall_daysInPeriod?: number;
    shortfall_baseDemand?: number;
    shortfall_avgMonthlyDemand?: number;
    shortfall_seasonalFactor?: number;
    shortfall_monthsUsedForAvg?: number[];
    shortfall_dailyRate_source?: string;
    future_periods?: Array<{
        trendForecast?: number | null;
        trendForecast_inputData?: number[];
        seasonalIndex?: number | null;
        seasonalIndex_components?: {
            statisticalFactor: string;
            minimumFactor: string;
            yoyGrowthFactor: string;
            finalFactor: string;
        };
    }>;
    calculationMethod?: 'Pronóstico Directo' | 'Promedio Histórico Corto' | 'Promedio Histórico Total' | 'Participación Histórica' | 'Sin Historial';
    directForecastEligibility?: DirectForecastEligibility;
    localWinningMethod?: string;
    localMonthlyForecast?: number;
    seasonalIndex?: number;
    baseItemMonthlyForecast?: number;
    bodegaShare?: number;
    daysInForecastMonth?: number;
    baseItemDailyForecast?: number;
    bodegaAjsPercentage: number;
    effectiveBodegaDailyForecast_AjsAdjusted: number;
    coverageDays: number;
    targetInventory: number;
    currentBodegaInventory: number;
    currentInventoryCoverageDays: number | null;
    quantityToSend_PreRounding: number;
    roundingMultiple: number;
    quantityToSend_Final: number;
}

// Contiene todos los datos y pronósticos para un item específico
export interface ItemForecast {
  itemCode: string;
  historicalData: ItemMonthlyData; // Para referencia y gráfico (contiene main, ajs y totalQuantity, y opcionalmente originalTotalQuantity)
  currentInventory: number;
  
  methodForecasts: MethodForecast[]; // Array de pronósticos, una entrada por método (SMA, SES, WMA, etc.)
  
  // Pronóstico agregado (promedio de métodos) para cada período futuro
  aggregatedFutureForecasts: PeriodForecastValue[]; 

  recommendedPurchase: number | null; // Recomendación base (cubre N periodos) antes de ajuste AJS
  nextPeriodShortfall: number | null; // Faltante para cubrir el próximo período
  
  // Información sobre el rango de fechas del "Próximo Período" para el cálculo del faltante
  nextPeriodShortfallDateRangeLabel: string | null; 

  coverageTargetPeriods: number; // Número de períodos que la recomendación de compra intenta cubrir (ej. 4)

  // Campos para AJS
  totalHistoricalMainConsumption: number;
  totalHistoricalAjsConsumption: number;
  ajsConsumptionPercentage: number | null; // % que AJS representa del consumo total histórico
  finalRecommendedPurchase: number | null; // Recomendación de compra final (base + ajuste AJS)

  // Nuevos campos para el modal de resumen técnico
  calculatedDemandForShortfallPeriod: number | null;
  calculatedTotalDemandForNFullFutureMonths: number | null;

  // Campos para mejoras de forecasting
  outliersAdjusted: boolean; // Indica si se ajustaron outliers para este ítem
  seasonalIndices: number[] | null; // Índices estacionales (12 valores, uno por mes) o null si aplica

  // Campos para métricas de inventario avanzadas
  leadTimeDays: number;
  serviceLevelPercentage: number;
  safetyStock: number | null;
  reorderPoint: number | null;
  maePerMethod: Array<{ methodName: string; mae: number | null }> | null;
  forecastingMethodNote?: string; // Nota sobre el método de pronóstico utilizado (e.g. si se usó media simple por datos limitados)
  winningMethod?: string | null;
  calculationTrace?: Partial<CalculationTrace>; // Añadido
  /** Fecha estimada de agotamiento (sin compras adicionales). */
  estimatedStockOutDate?: Date | null;
  /** Etiqueta legible, ej. ~15 mar 2026 */
  estimatedStockOutLabel?: string | null;
}

// Para el nuevo Dashboard Analítico
export interface MonthlyTotalConsumption {
  name: string; // "Mes Año"
  totalConsumption: number;
  date: Date; // Para ordenar
}

export interface ConsumptionByItem {
  itemCode: string;
  totalConsumption: number;
}

export interface ConsumptionByBodega {
  bodega: string;
  totalConsumption: number;
}

export interface BodegaAdjustmentStats {
  bodega: string;
  mainConsumption: number;
  ajsConsumption: number;
  totalConsumption: number;
  ajsPercentage: number | null;
}

// Para el módulo de Distribución por Bodega
export interface BodegaInventory {
  bodega: string;
  itemCode: string;
  quantity: number;
}

export interface DirectForecastEligibility {
  isEligible: boolean;
  reason: string;
  monthsOfHistory: number;
  requiredMonths: number;
  coefficientOfVariation: number | null;
  maxCoefficientOfVariation: number;
}

export interface DistributionResult {
  bodega: string;
  itemCode: string;
  currentBodegaInventory: number;
  forecastedDemandForCoverage: number | null;
  targetInventoryForCoverage: number | null;
  currentInventoryCoverageDays: number | null;
  quantityToSend: number;
  notes?: string;
  calculationTrace?: Partial<CalculationTrace>;
}

export interface TulaRotation {
  fecha: Date;
  numeroDocumento: string;
  grupo: string;
  bodegaOrigen: string;
  bodegaDestino: string;
  cantidad: number;
}

export interface AnalysisResults {
  peakTulasNeeded: number;
  peakSmallPackagesNeeded: number;
  isStockSufficient: boolean;
  stockDifference: number;
  smallRotationsPercentage: number;
  smallRotationsByStore: { store: string; rotationCount: number; recommendedStock: number; }[];
  stockByStore: { store: string; recommendedStock: number; rotationCount: number; weeklyAvg: number; dailyAvg: number; }[];
  rotationsByWeek: { week: string; count: number; }[];
  rotationsByMonth: { month: string; count: number; }[];
  dailyCirculationData: { date: string; tulasEnCirculacion: number }[];
  dailySimulationLog: { date: string; tulasOut: number; tulasIn: number; tulasInCirculacion: number; }[];
}

// Types for Carrier Conciliation modules
export type CsvRow = { [key: string]: any; originalIndex?: number };

export interface ProcessedData {
  headers: string[];
  data: CsvRow[];
  errors: string[];
  summary: {
    totalRows: number;
    matchedRows: number;
    unmatchedRows: number;
  };
}

export type FilterType99Minutos = 'no_siop' | 'diferencias' | 'dobles';
export type FilterTypeLogicuartas = 'no_siop' | 'no_tarifa' | 'diferencias' | 'dobles';

export interface AmortizationRow {
  cuota: number;
  fecha: string;
  valorCuota: number;
  capital: number;
  financiacion: number;
  ivaFinanc: number;
  aval: number;
  ivaAval: number;
  gracePeriodCostPerInstallment: number;
}

export interface CreditCalculationResult {
  creditId: string;
  puntoDeVenta: string;
  documento: string;
  fechaCredito: string;
  valorCredito: number;
  modalidadPago: string;
  numCuotas: number;
  tasaInteres: number;
  vrAdmon: number;
  ivaAdmon: number;
  amortizationTable: AmortizationRow[];
  totalValorPagar: number;
  totalInterestPaid: number;
  totalGracePeriodCost: number;
  totalIvaFinancPaid: number;
  monthlyGraceCostBreakdown: Record<string, { total: number; baseAmount: number; compoundingBase: number; quincenal: number; mensual: number; other: number }>;
  uncollectedAmountGracePeriod: number;
}

export interface GeneralSummary {
  totalCredits: number;
  paymentModalityDistribution: {
    quincenal: number;
    mensual: number;
    other: number;
  };
  quincenalPercentage: number;
  mensualPercentage: number;
  otherPercentage: number;
  totalInterestPaid: number;
  totalGracePeriodCost: number;
  totalIvaFinancPaid: number;
  uncollectedAmountGracePeriod: number;
  totalValorCredito: number;
  totalVrAdmon: number;
  totalIvaAdmon: number;
  averageValorCredito: number;
  quincenalInstallmentCounts: Record<number, number>;
  mensualInstallmentCounts: Record<number, number>;
  overallMonthlyGraceCostBreakdown: Record<string, { total: number; baseAmount: number; compoundingBase: number; quincenal: number; mensual: number; other: number }>;
}

// VTEX Shipping Rates Type
export interface VtexRate {
  ZipCodeStart: string;
  ZipCodeEnd: string;
  PolygonName: string;
  WeightStart: number;
  WeightEnd: number;
  AbsoluteMoneyCost: number;
  PricePercent: number;
  PriceByExtraWeight: number;
  MaxVolume: number;
  TimeCost: string; // Format: "d.hh:mm:ss"
  Country: string;
  MinimumValueInsurance: number;
}

// Route Module Types
export type RouteStatus = 'Programado' | 'Recogido' | 'Entregado' | 'Recolección Fallida' | 'Entrega Fallida';

export interface RouteEntry {
    id: string;
    fecha: Date;
    vehiculo: string;
    responsable: string;
    almacenDestino: string;
    originalAlmacenDestino?: string;
    numeroTF: string;
    tipoServicio: string;
    status?: RouteStatus;
    failureReason?: string;
    isManual?: boolean;
    updatedAt?: Date;
    completedBy?: string;
}

export type TransferNoveltyStatus = 'Reportado' | 'En Justificación' | 'Justificado';
export type TransferNoveltyType = 'Sobrante' | 'Faltante';

export interface TransferNovelty {
    id?: string;
    numeroTF: string;
    packerId: string;
    packerName: string;
    tipo: TransferNoveltyType;
    estado: TransferNoveltyStatus;
    cantidad: number;
    codigoUnidad: string;
    fechaEntregaTienda: Date | string;
    fechaReporteTienda: Date | string;
    /** Día operativo de la transferencia (para alinear con totales TF diarios). Opcional en registros antiguos. */
    fechaTf?: Date | string;
    almacen: string;
    justificacion?: string;
    tfLegalizacion?: string;
    enTiempo: boolean;
    comentariosAdmin?: string;
    createdAt: Date | string;
}

// Types for Transfers Module
export type UserRole = 'admin' | 'supervisor' | 'operator' | 'office' | 'conductor' | 'tiendas';
export type TransferStatus = 'En Tránsito' | 'Recolectado en Ruta' | 'Entregado en Ruta' | 'Recibido en Bodega' | 'Validado Supervisor' | 'Enviado a Destino';

/** Estado plataforma (Analizador) consultable por tiendas — distinto del status operativo de transfers. */
export type TfPlatformEstado =
  | 'ENTREGADO'
  | 'EN RUTA HOY'
  | 'RECOLECTADO EN RUTA'
  | 'EN BODEGA'
  | 'VALIDAR CON AMBAS TIENDAS';

export interface TfPlatformStatusRecord {
  id: string;
  numeroTF: string;
  bodegaDestino: string;
  /** Bod. salida / origen del documento de transferencia */
  bodegaOrigen?: string;
  estadoPlataforma: TfPlatformEstado;
  evidenceLinks: string[];
  /**
   * true = ENTREGADO por cierre automático de EN RUTA HOY
   * (día siguiente / fuera de En Tránsito / fuera del lote), no por evidencia del analizador.
   */
  entregaInferida?: boolean;
  /** Motivo del cierre automático cuando entregaInferida. */
  entregaInferidaMotivo?: 'dia_siguiente' | 'fuera_de_transito' | 'fuera_del_lote_publicado';
  /** Placa/recurso de entrega (Excel Paso 2 rutas) */
  placaEntrega?: string;
  /** Placa de recolección (misma fila del Excel Paso 2) */
  placaRecoleccion?: string;
  fechaDocumento?: Date | null;
  fechaFinalizado?: Date | null;
  cantidad: number;
  marca?: string;
  grupo?: string;
  updatedAt: Date;
  updatedBy?: string;
  source?: string;
}


export interface TransferActor {
  userId: string;
  displayName: string;
}

/** Entrada append-only de cada cambio de estado (trazabilidad). */
export interface TransferStatusHistoryEntry {
  status: TransferStatus;
  at: Date;
  userId: string;
  userName: string;
}

export interface TransferEntry {
  id: string;
  fecha: Date;
  numeroTF: string;
  bodegaOrigen: string;
  bodegaDestino: string;
  cantidad?: number;
  marca?: string;
  grupo?: string;
  status: TransferStatus;
  recibidoAt?: Date;
  enviadoAt?: Date;
  validatedAt?: Date;
  deliveredAt?: Date;
  manualStatusChangeJustification?: string;
  storageOrder?: string;
  recolectadoBy?: string;
  recolectadoByName?: string;
  validatedBy?: string;
  validatedByName?: string;
  recibidoBodegaBy?: string;
  recibidoBodegaByName?: string;
  enviadoBy?: string;
  enviadoByName?: string;
  deliveredBy?: string;
  deliveredByName?: string;
  manualStatusChangedBy?: string;
  manualStatusChangedByName?: string;
  statusHistory?: TransferStatusHistoryEntry[];
  }

export interface DeliveryManifest {
    id: string;
    manifestId: number; // Consecutive ID
    createdAt: Date;
    resource: string;
    driver?: string;
    assistants?: string;
    transferIds: string[];
    summary?: {
        totalTransfers: number;
        destinations: { [key: string]: number };
    };
}

/** Borrador de cargue / relación de entrega (autoguardado antes de confirmar). */
export interface DeliveryManifestDraft {
  id: string;
  draftNumber: number;
  status: 'open' | 'closed';
  transferIds: string[];
  resource?: string;
  driver?: string;
  assistants?: string;
  createdBy?: string;
  createdByName?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CollectionLog {
  id: string;
  createdAt: Date;
  placa: string;
  transferIds: string[];
  summary: {
    totalTransfers: number;
    destinations: { [key: string]: number };
  };
  recolectadoPor: string;
}


// EXISTING TYPES BELOW - DO NOT REMOVE

export type OrderStatus = 'Pte Empaque' | 'En Empaque' | 'Empacado' | 'En Cargue' | 'Despachado' | 'Cancelado';
export type ProductCategory = 'CALZADO' | 'ROPA' | 'ACCESORIOS' | 'NO CLASIFICADO';

export interface RemisionEntry {
  orden: string;
  unidadDeEmpaque: string;
  empacador: string;
  fechaDeLectura: Date;
  referencia: string;
  descripcion: string;
  codigoBarras: string;
  talla?: string;
  grupo?: string;
  cantidad: number;
  marca: string;
  productType: ProductCategory;
}

export interface UniqueReference {
  codigoBarras: string;
  talla?: string;
  referencia: string;
  descripcion: string;
  marca: string;
  productType: ProductCategory;
}

/** Producto del catálogo maestro con marca IMPORTADA presente en el reporte de empaque. */
export interface ImportedBrandCatalogItem {
  codigoBarras: string;
  referencia: string;
  descripcion: string;
  talla?: string;
  grupo: string;
  unidadesEnReporte: number;
}

export interface ReferenceCorrection {
  newReferencia?: string;
  newDescripcion?: string;
}

export type ReferenceCorrections = {
  [key: string]: ReferenceCorrection;
};

export type ManualOperatorMappings = {
    [operatorId: string]: string;
};

export interface PackerProductivity {
  packerName: string;
  totalQuantity: number;
  hoursWorked: number;
  productivity: number; // units per hour
  compliance: number; // percentage of goal
  firstScan: Date;
  lastScan: Date;
  workPeriodEnd: Date;
  baseGoal: number;
  appliedBreaks: {
    BREAKFAST: boolean;
    LUNCH: boolean;
    SNACK: boolean;
  };
  totalMicroPausesMinutes: number;
  totalDeductedMinutes: number;
}

export interface HourlyProductivity {
    hour: number;
    totalQuantity: number;
    operatorCount: number;
    productivityPerOperator: number;
    compliance: number;
    productiveMinutes: number; // Nuevo campo
}

export interface BrandPackerBreakdown {
  packerName: string;
  totalQuantity: number;
  compliance: number;
  baseGoal: number;
  hoursWorked: number;
}

export interface BrandProductivity {
  brandName: string;
  totalQuantity: number;
  percentage: number;
  productivity: number;
  breakdown: BrandPackerBreakdown[];
  baseGoal: number;
  compliance: number;
  workHours: number;
  entries: RemisionEntry[];
}

export interface ProductTypePackerBreakdown {
    packerName: string;
    totalQuantity: number;
    compliance: number;
    baseGoal: number;
    hoursWorked: number;
}

export interface ProductTypeProductivity {
  category: ProductCategory;
  totalQuantity: number;
  percentage: number;
  productivity: number;
  compliance: number;
  workHours: number;
  breakdown: ProductTypePackerBreakdown[];
  entries: RemisionEntry[];
}

export interface DeadTimeEntry {
  id: string;
  packerName: string;
  startTime: Date;
  endTime: Date;
  duration: number; // in minutes
  status: 'Justificado' | 'No Justificado' | 'Excedente de Descanso';
  justification?: string;
}

export interface DeadTimeSummaryEntry {
  packerName: string;
  incidentCount: number;
  totalMinutes: number;
  percentageOfWorkday: number;
  percentageOfTotalDeadTime: number;
  hourlyDistribution: { [hour: number]: number };
  reason?: string;
  type?: 'DEAD_TIME' | 'MICRO_PAUSE' | 'HEURISTIC';
}

export interface PackerBrandProductivityDetail {
  packerName: string;
  brandName: string;
  productType: ProductCategory;
  totalQuantity: number;
  hoursWorked: number;
  productivity: number;
  baseGoal: number;
  compliance: number;
}

export interface PackerReferenceProductivityDetail {
  packerName: string;
  referencia: string;
  descripcion: string;
  brandName: string;
  productType: ProductCategory;
  totalQuantity: number;
  hoursWorked: number;
  productivity: number;
  baseGoal: number;
  compliance: number;
}

export type ManualProductClassifications = {
    [term: string]: {
      productType?: ProductCategory;
      brand?: string;
    };
};

export type JustificationType = 'REASON' | 'BREAKFAST' | 'LUNCH' | 'SNACK' | 'SHIFT_END' | 'PULSE_IGNORE';

export type ManualJustifications = {
    [deadTimeId: string]: {
        type: JustificationType;
        reasonText?: string;
        customDuration?: number;
        startTime?: string;
        endTime?: string;
    };
};

/** Mapa nuevo o actualizador funcional (evita perder borrados al hacer varios clics seguidos). */
export type ManualJustificationsUpdate =
    | ManualJustifications
    | ((prev: ManualJustifications) => ManualJustifications);

export interface DetectedBreakDetail {
    packerName: string;
    breakType: 'BREAKFAST' | 'LUNCH' | 'SNACK';
    status: 'Asignado' | 'No Encontrado';
    assignedDeadTime?: DeadTimeEntry;
    actualDuration?: number;
    excessDuration?: number;
}

export interface HourlyOperatorDetail {
  units: number;
  baseGoal: number;
  productivity: number;
  compliance: number;
  trend: number | null;
  productiveMinutes: number; // Nuevo campo
}

export interface PackerHourlyPerformance {
  packerName: string;
  hourlyDetails: {
    [hour: number]: HourlyOperatorDetail;
  };
}

export interface IncidentLogEntry {
    id: string;
    timestamp: string;
    text: string;
}

export type PulseType = 'activity' | 'pause' | 'status_change';
export type PulseReason = 'Desayuno' | 'Almuerzo' | 'Refrigerio' | 'Baño' | 'Café' | 'Soporte Técnico' | 'Sin Carga de Trabajo' | 'Otro' | 'Pausa Global' | 'Remisión' | 'Fin de Turno';
export type UserStatus = 'Disponible' | 'En Remisión' | 'Pausado' | 'Inactivo' | 'Desconectado';
export type PulseModuleContext = 'reception' | 'wholesale' | 'general';

export interface OperationPulse {
    id?: string;
    userId: string;
    userName: string;
    email?: string;
    type: PulseType;
    status: UserStatus;
    reason?: PulseReason | string;
    justification?: string;
    details?: string;
    startTime: Date;
    endTime?: Date;
    isGlobal?: boolean;
    moduleContext?: PulseModuleContext;
    metadata?: Record<string, any>;
}

export interface ChatMessage {
    role: 'user' | 'model';
    text: string;
}

export interface Achievement {
    id: string;
    title: string;
    description: string;
    icon: string;
    value: string | number;
}

export interface SmartAlert {
    id: string;
    severity: 'info' | 'warning' | 'critical';
    text: string;
}

export interface ActionPlan {
    title: string;
    steps: string[];
}

export interface Annotation {
  text: string;
}

export type Annotations = Record<string, Annotation>;

export interface TaggedReport {
  report: ProcessedReportData;
  tags: string[];
}

export interface ReportSummary {
    id: string;
    reportDate: Date;
    snapshotCreatedAt: Date;
    overallCompliance: number;
    operatorCount: number;
    totalQuantity: number;
    totalHours: number;
    avgProductivity: number;
    brandCompliance?: { brandName: string; compliance: number }[];
    operatorNames?: string[];
    isConsolidated?: boolean;
    sourceSnapshotIds?: string[];
    manualJustifications?: ManualJustifications;
    incidentLog?: IncidentLogEntry[];
    annotations?: Annotations;
    packerProductivity?: PackerProductivity[];
    brandProductivity?: BrandProductivity[];
    productTypeProductivity?: ProductTypeProductivity[];
    deadTimeSummary?: DeadTimeSummaryEntry[];
    microPausesSummary?: DeadTimeSummaryEntry[];
    packerBrandProductivityDetail?: PackerBrandProductivityDetail[];
    hourlyProductivity?: HourlyProductivity[];
    reasonsSummary?: { reason: string; durationMinutes: number; type: string }[];
}

export interface ReportConfiguration {
    processedData: RemisionEntry[];
    reportDate: string;
    reportStartTime: string;
    reportEndTime: string;
    snapshotCreatedAt: Date;
    isConsolidated: boolean;
    sourceSnapshotIds: string[];
    // Include other optional config properties
    brandProductTypeGoals?: BrandProductTypeGoals;
    manualJustifications?: ManualJustifications;
    incidentLog?: IncidentLogEntry[];
    configSelectedPacker?: string[];
    // These are not strictly part of the config but can be useful to re-apply
    productivityGoals?: ProductivityGoals;
    manualClassifications?: ManualProductClassifications;
    referenceCorrections?: ReferenceCorrections;
    learnedCorrections?: ReferenceCorrections;
    manualOperatorMappings?: ManualOperatorMappings;
    annotations?: Annotations;
    referenceGoals?: ReferenceGoals;
}

export type ReferenceGoals = {
    [reference: string]: number;
};


export interface ProcessedReportData {
    packerProductivity: PackerProductivity[];
    hourlyProductivity: HourlyProductivity[];
    brandProductivity: BrandProductivity[];
    productTypeProductivity: ProductTypeProductivity[];
    overallCompliance: number;
    deadTimeReport: DeadTimeEntry[];
    microPausesReport: DeadTimeEntry[];
    deadTimeSummary: DeadTimeSummaryEntry[];
    microPausesSummary: DeadTimeSummaryEntry[];
    totalInactivitySummary: DeadTimeSummaryEntry[];
    packerBrandProductivityDetail: PackerBrandProductivityDetail[];
    packerReferenceProductivityDetail: PackerReferenceProductivityDetail[];
    breakDetailReport: DetectedBreakDetail[];
    packerHourlyPerformance: PackerHourlyPerformance[];
    reportDate: string;
    executiveSummary?: string[] | null;
    incidentLog: IncidentLogEntry[];
    smartAlerts?: SmartAlert[] | null;
    annotations?: Annotations;
    reasonsSummary?: { reason: string; durationMinutes: number; type: string }[];
    referenceGoals?: ReferenceGoals;
    id?: string;
    // Add processedData for full traceability, especially for snapshots
    processedData?: RemisionEntry[];
    reportStartTime?: string;
    reportEndTime?: string;
    brandProductTypeGoals?: BrandProductTypeGoals;
    manualJustifications?: ManualJustifications;
    configSelectedPacker?: string[];
    isConsolidated?: boolean;
    sourceSnapshotIds?: string[];
    snapshotCreatedAt?: Date;
    productivityGoals?: ProductivityGoals;
}

export type ProductivityGoals = {
  [key in ProductCategory]: number;
};

export type BrandProductTypeGoals = {
    [brandName: string]: Partial<ProductivityGoals>;
};

export interface WholesaleOrder {
    id: string;
    vendedor: string;
    fecha: string;
    bodega: string;
    cliente: string;
    sucursal: string;
    ordenDeCompra: string;
    cantidadTotal: number;
    valorNetoTotal: number;
    status: OrderStatus;
    details: WholesaleOrderDetail[];
    packingData?: {
        packedUnits: number;
        totalUnits: number;
        boxCount: number;
    };
}

export interface WholesaleOrderDetail {
    referencia: string;
    item?: string;
    talla: string;
    cantidad: number;
}

export interface ProductDatabaseItem {
  id: string; // Document ID from Firestore (often the barcode itself)
  codigoBarras: string;
  referencia: string;
  talla: string;
  item?: string;
  marca?: string;
  fecha?: string;
  grupo?: string;
  name?: string;
  reference?: string; // Added for English-key compatibility
  description?: string | null;
  size?: string | null;
  merchandise_type?: string | null;
  location?: string | null;
  created_at?: string;
  updated_at?: string;
  user_id?: string | null;
}


export interface PackingScanResult {
    item?: ProductDatabaseItem;
    message: string;
    status: 'success' | 'error' | 'warning';
    scannedBarcode: string;
}

export interface PackedItemInUnit {
    item: ProductDatabaseItem;
    packedQuantity: number;
}

export interface PackingUnit {
    firestoreId: string; // The actual document ID from Firestore
    id: number; // The sequential, human-readable ID
    items: { [key: string]: PackedItemInUnit };
    status: 'open' | 'closed';
    labelBarcode?: string;
    closed_at?: string;
    closedBy?: string;
    closedByName?: string | null;
    createdAt?: string;
    createdBy?: string;
    createdByName?: string | null;
    destination?: string;
    reception_id?: string; // Add this if units can be linked to receptions
}

// NEW TYPE FOR THE RE-ARCHITECTURE
export interface PackedItem {
    id: string; // The Firestore document ID for this specific packed item entry
    orderId: string;
    packingUnitId: string; // The Firestore ID of the PackingUnit
    itemKey: string; // e.g., "REF123-TALLA-M"
    barcode: string;
    quantity: number;
    packerId: string;
    scannedAt: Date;
    scannedItemId?: string; // Optional: Link to the original scanned item if migrating
    packedQuantity?: number; // Optional: For compatibility with old structure
    item?: ProductDatabaseItem; // Optional: For compatibility with old structure
}


export type PauseReason = 'BREAKFAST' | 'LUNCH' | 'SNACK' | 'BATHROOM' | 'SUPPLIES' | 'FAILURE' | 'RECYCLING' | 'OTHER';

export interface PackingPause {
    startTime: Date;
    endTime?: Date;
    reason: PauseReason;
    userId?: string;
}

export interface PackingSession {
    orderId: string;
    packerId: string; 
    packerName: string;
    units: PackingUnit[];
    startTime?: Date;
    endTime?: Date;
    lastActivity?: Date;
    status: 'active' | 'paused' | 'completed';
    pauses: PackingPause[];
}


export interface UnitSearchResult {
    referencia: string;
    item: string;
    talla: string;
    packedQuantity: number;
    unitId: number;
    unitLabel: string;
}

export type LabelStatus = 'available' | 'used' | 'dispatched' | 'void';

export interface PreprintedLabel {
    id: string;
    orderId: string;
    status: LabelStatus;
    createdAt: Date;
    usedAt?: Date;
    usedBy?: string;
    unitId?: number;
}

export type LabelValidationResult = {
  isValid: true;
  label: PreprintedLabel;
} | {
  isValid: false;
  message: string;
};



export interface AppUser {
    uid: string;
    email?: string;
    displayName?: string;
    role: UserRole;
    disabled: boolean;
}

export type GeneralLabelOwnerType = 'packer' | 'store';

export interface GeneralLabel {
    id: string;
    ownerType: GeneralLabelOwnerType;
    ownerId: string;
    status: LabelStatus;
    createdAt: Date;
    usedAt?: Date;
    usedBy?: string;
}
export interface BagItem {
    id: string; // OPID-001
    loaded: boolean;
    discharged: boolean;
    loadedAt?: Date;
    dischargedAt?: Date;
}

export interface BagOperationSettings {
    /** Permite escanear descargue mientras aún hay cargue pendiente (camiones salen y llegan en paralelo). */
    allowConcurrentPhases?: boolean;
    /** Permite cerrar la operación con bolsas sin cargar o sin descargar. */
    allowPartialClose?: boolean;
}

export interface BagOperation {
    id: string;
    name: string;
    totalBags: number;
    bags: Record<string, BagItem>;
    createdAt: Date;
    status: 'cargue' | 'descargue' | 'completed' | 'concurrent';
    createdBy?: string;
    createdByName?: string;
    settings?: BagOperationSettings;
}

/** Metadatos del inventario cargado por día (id = yyyy-MM-dd). */
export interface CyclicInventoryDayMeta {
  id: string;
  lastUploadedAt: string | Date;
  lastUploadedBy?: string;
  lastUploadedByName?: string;
  lastFileName?: string;
  lineCount?: number;
}

export interface CyclicInventoryLine {
  id: string;
  /** Fecha del inventario base (mismo día que el archivo subido). */
  inventoryDate: string;
  reference: string;
  size: string;
  location: string;
  expectedQty: number;
  countedQty: number | null;
  countedAt?: string | Date | null;
  countedBy?: string | null;
  /** Si hay varias filas Firestore con la misma ref + talla + ubicación, aquí van todos los ids. */
  consolidatedLineIds?: string[];
}

/** Registro inmutable de un conteo (no se borra al reimportar el inventario del día). */
export interface CyclicInventoryCountRecord {
  id: string;
  inventoryDate: string;
  reference: string;
  size: string;
  location: string;
  /** Cantidad esperada al momento de guardar el conteo. */
  expectedQtyAtSave: number;
  countedQty: number;
  countedAt: string | Date;
  countedBy: string;
  countedByName?: string;
  lineId: string;
  /** Presente si el guardado aplicó a varias líneas (misma ref + talla + ubicación). */
  consolidatedLineIds?: string[];
}

export type AppStep = 'suite' | 'upload' | 'configure' | 'dashboard' | 'historical' | 'plant_view' | 'supervisor_view' | 'wholesale' | 'packing' | 'packed_orders_dashboard' | 'logistics_submenu' | 'general_settings' | 'label_control' | 'merchandise_labeling' | 'bag_distribution' | 'merchandise_reception' | 'reception_dashboard' | 'reception_reading' | 'novelty_management' | 'novelty_reports' | 'products_management' | 'time_reports' | 'time_reports_menu' | 'idle_time_report' | 'other_features' | 'bag_counting' | 'credit_simulator' | 'dispatching' | 'dispatch_manager' | 'returns_module' | 'dispatch_dashboard' | 'dispatch_report' | 'fletes_vtex' | 'routes' | 'dashboards' | 'dashboards_main_menu' | 'dashboards_ecommerce_menu' | 'sample_control' | 'transfers' | 'propuesta_transportadora' | 'distributor' | 'distributor_module' | 'dashboards_bodega' | 'dashboards_remision' | 'dashboards_labeling' | 'dashboards_gastos_transporte' | 'control_piso' | 'external_labeling_portal' | 'logistics_platform' | 'tf_platform_lookup' | 'service_conciliation' | 'remision' | 'transfer_novelties' | 'cyclic_inventory' | 'store_capacity';

/** Capacidad de un tipo de cajón en una tienda (medida × carga × cantidad). */
export interface StoreDrawerCapacity {
  id: string;
  /** Ej. "60*60", "80*60" */
  measure: string;
  /** Pares con caja original por cajón */
  capacityWithBox: number;
  /** Pares sin caja original por cajón */
  capacityWithoutBox: number;
  /** Cantidad de cajones de esa medida en la tienda */
  drawerCount: number;
}

/** Snapshot opcional de inventario en tienda (para ocupación vs capacidad). */
export interface StoreInventorySnapshot {
  accesorios: number;
  calzado: number;
  ropa: number;
  updatedAt?: string;
  source?: 'manual' | 'import' | 'system';
}

/**
 * Maestro de capacidad de almacenamiento por PDV/tienda.
 * Pensado para cruzar luego con transferencias (calzado en tránsito) e inventario.
 */
export interface StoreCapacityProfile {
  id: string;
  /** Código de tienda / PDV (ej. B18). Debe alinearse con bodegaDestino de transferencias. */
  pdvCode: string;
  pdvName?: string;
  drawers: StoreDrawerCapacity[];
  inventorySnapshot?: StoreInventorySnapshot;
  notes?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  updatedBy?: string;
}

export interface StoreCapacityTotals {
  totalWithBox: number;
  totalWithoutBox: number;
  totalDrawers: number;
}

// Types for Merchandise Reception
export interface ReceptionOperation {
  id: string;
  rk_identifier: string;
  supplier: string;
  expected_arrival_date: string;
  expected_quantity: number;
  status: 'pending' | 'in_progress' | 'paused' | 'completed' | 'cancelled';
  nombre_rk?: string | null;
  codigo_de_barras?: string | null;
  descripcion_del_producto?: string | null;
  referencia?: string | null;
  talla?: string | null;
  tipo_mercancia?: string | null;
  standard_units_per_hour?: number | null;
  created_at: string;
  updated_at: string;
  user_id: string;
  start_time?: string | null;
  end_time?: string | null;
  totalScannedQuantity: number; // Denormalized field for performance
  actualProductivity?: number;
  timeSpentInMinutes?: number;
  perOperationReceiptQualityIndicator?: number;
  expectedItems?: ReceptionExpectedItem[];
}

export interface ReceptionProduct {
  id: string; // Typically the barcode
  name: string;
  barcode: string;
  description: string | null;
  reference: string | null;
  size: string | null;
  merchandise_type: string | null;
  location?: string | null;
  created_at: string;
  updated_at: string;
  user_id: string | null; // The user who created or last updated it
  item?: string; // a field from excel
  marca?: string; // a field from excel
  fecha?: string; // a field from excel
  grupo?: string; // a field from excel
}


export type NoveltyStatus = 'pending' | 'resolved' | 'ignored';

export interface ItemNovelty {
    id: string;
    reception_id: string;
    barcode: string;
    novelty_type: string;
    description: string;
    created_at: string;
    status: NoveltyStatus;
    user_id: string;
    updated_at?: string;
    scanned_item_id?: string;
}

export interface ScannedItem {
  id: string;
  reception_id: string;
  packing_unit_id: string; 
  barcode: string;
  quantity: number;
  location_id?: string;
  scanned_at: string;
  created_at: string;
  updated_at: string;
  user_id: string;
  reference: string;
  talla: string;
  item: string;
}

export interface Location {
    id: string;
    name: string;
    description?: string;
    created_at: Date;
    user_id?: string;
}
    
export interface OperationPause {
    id: string;
    reception_id: string;
    user_id: string;
    start_time: Date;
    end_time: Date | null;
    pause_reason: string;
    created_at?: Date;
    updated_at?: Date;
    is_manual?: boolean; // New optional field
}

/** Intervalo de inactividad entre escaneos (recepción). */
export interface ReceptionIdleTimeDetail {
    id: string;
    from_ms: number;
    to_ms: number;
    idle_duration_minutes: number;
    userId: string;
    userName: string;
}

/** Justificación de un tiempo muerto en recepción (por operación RK). */
export interface ReceptionIdleJustificationEntry {
    type: JustificationType;
    reasonText?: string;
    customDuration?: number;
    fromMs: number;
    toMs: number;
    userId: string;
}

export type ReceptionIdleJustifications = {
    [entryId: string]: ReceptionIdleJustificationEntry;
};

export interface ReceptionExpectedItem {
    barcode: string;
    expected_quantity: number;
    reference: string;
    size: string;
    item: string;
    location?: string;
}
  
export interface UserProfile {
  id: string;
  email: string;
  role?: string;
}
  
export interface DetailedReportItem {
  barcode: string;
  productName: string;
  reference: string;
  size: string;
  expectedQuantity: number;
  scannedQuantity: number;
  difference: number;
  noveltyType: string;
  packingUnitBreakdown?: {
    unitId: string;
    unitFirestoreId: string; // Added to enable navigation
    quantity: number;
    userId: string;
    userName: string;
  }[];
}

export interface PackingUnitType {
    id: string;
    name: string;
    description?: string;
    created_at: Date;
}

export interface ProductivitySettings {
    id: string;
    standard_per_hour_goal: number;
    low_productivity_threshold: number;
    medium_productivity_threshold: number;
    high_productivity_threshold: number;
}


export interface ActivityLog {
  id?: string;
  created_at?: string;
  user_id: string;
  reception_id?: string | null;
  packing_unit_id?: string | null;
  action_type: string;
  details?: Record<string, any> | null;
}

export interface UserGoal {
  id: string;
  user_id: string;
  daily_scanned_items_goal: number;
  hourly_productivity_goal: number;
  created_at?: string;
  updated_at?: string;
}

export interface OperationReport {
  id: string;
  rk_identifier: string;
  supplier: string;
  expected_arrival_date: string;
  expected_quantity: number;
  status: 'pending' | 'in_progress' | 'paused' | 'completed' | 'cancelled';
  totalScannedQuantity?: number;
  actualProductivity?: number;
  expectedProductivity?: number | null;
  timeSpentInMinutes?: number;
  perOperationReceiptQualityIndicator?: number;
  quantityStatus: {
    text: string;
    color: string;
  };
  uniquePackingUnitNames: string[];
  uniqueLocationNames: string[];
}

export interface UserProductivity {
  userId: string;
  userName: string;
  totalScanned: number;
  effectiveTimeMinutes: number;
  pausesCount: number;
  productivityPerHour: number;
  compliance: number;
  operation_rk_identifier: string; // Added for context in dialogs
  pauses: OperationPause[]; // Added for detail dialog
}

export interface AlternateBarcodeUploadRow {
  referencia: string;
  talla: string;
  codigo_alterno: string;
}

export interface FirebaseError {
  code: string;
  message: string;
}

export interface BoxToDispatch {
    labelId: string;
    orderId: string;
    customer: string;
    totalItems: number;
    unitId?: string;
    items?: { referencia: string; cantidad: number }[];
}

export interface DispatchSessionInfo {
    id?: string;
    truckPlate: string;
    driverName: string;
    sealNumber?: string;
    dispatchDate?: string;
    createdAt?: Date;
    status: 'open' | 'closed';
    scannedLabels?: { [labelId: string]: any }; // Map of labelId to timestamp
    orderIds?: string[];
    allowedOrderIds?: string[];
}

// Add new type for the returns module
export interface DiscardedRecord {
  reason: string;
  rowData: { [key: string]: any };
}

// Types for Merchandise Labeling Module
export type LabelingOperationStatus = 'Pendiente' | 'Asignada' | 'En Progreso' | 'Pausada' | 'Completada';

export interface LabelingOperation {
  id: string; // Firestore document ID
  receptionOperationId: string; // Link to the original reception
  rk_identifier: string;
  supplier: string;
  reference: string; // The specific reference being labeled
  sizes: { [size: string]: number }; // e.g., { "S": 50, "M": 100 }
  totalUnits: number; // Total units for this specific task
  status: LabelingOperationStatus;
  assignedOperatorId: string; // Single operator per task (Internal)
  assignedExternalVendorId?: string; // New: Link to an external company
  assignedExternalOperatorName?: string; // New: Specific operator assigned (optional)
  isExternal?: boolean; // New: Flag to distinguish between internal and external
  standard_units_per_hour?: number;
  createdAt: string;
  updatedAt: string;
  parentTaskId?: string; // ID of the original task if this is a residual one
  completedUnits?: number; // How many units were actually completed in this task session
}

export type LabelingActivityType = 'START' | 'PAUSE' | 'RESUME' | 'FINISH';

export interface LabelingActivityLog {
  id?: string; // Firestore document ID
  labelingOperationId: string;
  operatorId: string; // Internal UID or ExternalVendor ID
  type: LabelingActivityType;
  timestamp: string; // ISO 8601 string
  pauseReason?: string; // Only for PAUSE events
  isExternal?: boolean; // New: Flag
  externalOperatorName?: string; // New: Name of the individual operator
  completedUnits?: number; // Optional: used in some log entries for incremental updates
}

export interface LabelingSummaryKPIs {
    totalUnits: number;
    internalUnits: number;
    externalUnits: number;
    efficiency: number;
    totalActiveMinutes: number;
    conversionRate: number; // units per active hour
}

export interface LabelingEmployeePerformance {
    id: string;
    name: string;
    type: 'Interno' | 'Externo';
    vendorName?: string;
    totalUnits: number;
    activeMinutes: number;
    pausesCount: number;
    efficiency: number;
    lastActivity: string;
}

export interface LabelingDashboardData {
    operations: LabelingOperation[];
    logs: LabelingActivityLog[];
    summary: LabelingSummaryKPIs;
    employeePerformance: LabelingEmployeePerformance[];
    hourlyData: { hour: string; units: number }[];
    pauseReasons: { reason: string; count: number; totalMinutes: number }[];
}

export interface ExternalOperator {
  name: string;
  pin: string; // Individual 4-digit PIN
}

export interface ExternalVendor {
  id: string;
  name: string;
  pin?: string; // Optional: Company-wide backup PIN
  active: boolean;
  operators: ExternalOperator[]; // List of authorized operators with their individual PINs
  createdAt: string;
  updatedAt: string;
}

export interface Justification {
  text: string;
  date: Date;
  userId: string;
  userName?: string;
  bitrixTaskCreationDate?: Date;
  bitrixTaskId?: string;
  almacen?: string;
}

export interface DelayedOrderLog {
  id: string; // orderId
  orderId: string;
  detectionDates: Date[];
  justifications: Justification[];
  isResolved: boolean;
  resolvedAt?: Date;
  lastStatus: string;
}

export interface EcommerceOrder {
  id: string; // PED_ID
  tienda: string; // NOMBRE
  valorTotal: number; // PED_VALOR_TOTAL
  transportadora: string; // TRA_NOMBRE
  dispatchDate?: Date; // NEW
  bodega?: string | string[]; // Added: Warehouse field

  // Other columns from image
  ped_cli_env?: string;
  cli_nombre_cto?: string;
  ped_direccion?: string;
  ped_barrio?: string;
  ped_ciudad?: string;
  ped_departamento?: string;
  ped_telefono?: string;
  ped_celular?: string;
  ped_factura?: string;

  // These are optional as they are not in the image
  fechaPedido?: Date | null;
  estado?: string;
  sku?: string;
  cantidad?: number;
}
    
// Types for Sample Control Module
export interface SampleReference {
  id: string; // The reference number itself will be the document ID
  lastUploaded: Date;
  sourceFile: string;
}

export interface SampleDelivery {
  id: string; // Firestore document ID
  reference: string;
  transferNumber: string;
  deliveryDate: Date;
  sourceWarehouse: string;
  destinationWarehouse: string;
}

export type SamplePhotoReceptionStatus = 'pending' | 'in_progress' | 'received' | 'cancelled';

export interface SamplePhotoReceptionEvent {
  at: Date;
  fromStatus: SamplePhotoReceptionStatus | null;
  toStatus: SamplePhotoReceptionStatus;
  source?: 'manual' | 'id' | 'reference' | 'transfer' | 'barcode' | 'admin_cancel';
  note?: string | null;
  actorId?: string | null;
  actorName?: string | null;
}

export interface SamplePhotoReception {
  id: string;
  deliveryKey: string;
  reference: string;
  transferNumber: string;
  status: SamplePhotoReceptionStatus;
  createdAt?: Date;
  updatedAt?: Date;
  lastUploadedAt?: Date;
  lastUploadedById?: string | null;
  lastUploadedByName?: string | null;
  updatedById?: string | null;
  updatedByName?: string | null;
  statusHistory?: SamplePhotoReceptionEvent[];
}

export interface SamplePhotoTransferSummary {
  transferNumber: string;
  total: number;
  pending: number;
  inProgress: number;
  received: number;
  cancelled: number;
  canClose: boolean;
  isClosed: boolean;
  closedAt?: Date;
  closedById?: string | null;
  closedByName?: string | null;
}

export interface ComparisonResult {
    reference: string;
    status: 'En Base de Datos' | 'Muestra Nueva Requerida' | 'Advertencia: Entregada pero sin Foto';
    deliveryHistory?: SampleDelivery[];
}

export interface SavedSampleVerification {
  id: string;
  name: string;
  createdAt: Date;
  savedById: string;
  savedBy: string;
  results: ComparisonResult[];
  /** Referencias que en la corrida estaban como "Muestra nueva requerida" antes de ajustes al guardar (p. ej. Adidas). Permite seguimiento sin cambiar el resultado guardado. */
  newSampleReferencesAtRun?: string[];
  stats: {
    total: number;
    scanned: number;
    pending: number;
  };
  status?: 'pending' | 'in-progress' | 'completed';
}

// Types for Merchandise Dispatch Manager Module
export interface MerchandiseItem {
  codigo: string;
  fechaCreacion: Date;
  orden: string;
  tipoOrd: string;
  tipo: string;
  gr: string;
  contenido: string;
  tf: string;
  origen: string;
  destino: string;
  cant: number;
  pKg: number;
  vM3: number;
  estado: string;
  detalle: string;
  etiqueta: string;
  relacion: string;
  verLog: string;
  ordDesp: string;
  fechaEmpaque: string;
  empacador: string;
  /** Marca (Excel o transferencia cruzada) — usada para prioridad en límites de despacho */
  marca?: string;
  // Joined fields from File 2
  tftMatch?: string;
  tftFecha?: Date;
  tftCantidad?: number;
}

export interface TFTItem {
  tft: string;
  fecha: Date;
  cantidad: number;
  numeroDocumento: string; // Añadido para consistencia
  marca?: string;
}

export interface VerificationItem {
  codigo: string;
  tftCruce: string;
  fechaTft: string;
  cantTft: string;
  destino: string;
  empacador: string;
  contenidoOriginal: string;
  tfOriginal: string;
  /** Marca del cruce (opcional; sesiones antiguas pueden no tenerla). */
  marca?: string;
  scanned: boolean;
  scanTime?: Date;
}

export interface SavedVerification {
  id: string;
  name: string;
  createdAt: Date;
  savedById: string;
  savedBy: string;
  results: VerificationItem[];
  unmatchedResults?: VerificationItem[];
  excludedResults?: VerificationItem[]; // New: Items excluded by limits
  originalStats?: {
    totalUnits: number;
    totalTFs: number;
  }; // New: Stats before filtering
  filteredStats?: {
    totalUnits: number;
    totalTFs: number;
  }; // New: Stats after filtering
  stats: {
    total: number;
    scanned: number;
    pending: number;
  };
  status?: 'pending' | 'in-progress' | 'completed';
}


export type SortOrder = 'asc' | 'desc';

// --- External Services Conciliation Types ---
export interface ExternalServiceRow {
    id: string;
    fechaServicio: Date;
    proveedor: string;
    /** Id compartido: logística agrupa varias operaciones/días en un solo lote de facturación (alternativa a la agrupación semanal automática). */
    grupoFacturacion?: string;
    cantidad: number;
    servicio: string;
    destino?: string;
    numeroFactura?: string;
    numeroOC?: string;
    valorACobrar: number;
    valorFactura?: number;
    diferencia?: number;
    observacion?: string;
    metodoPago: 'Jornada' | 'Unidad' | 'Hora';
    estadoCadena: 'Logística' | 'Compras' | 'Contabilidad' | 'Devuelto';
    duplicateHash: string; // Hash of key fields to prevent double uploads
    createdAt: Date;
}

export interface ServiceRate {
    id?: string;
    provider: string;
    service: string;
    rate: number;
    method: string;
}

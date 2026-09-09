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
};

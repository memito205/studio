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
};

export type BodegaTvSnapshot = {
  dayKey: string;
  generatedAt: string;
  areas: BodegaTvAreaSnapshot[];
  summary: {
    totalUnits: number;
    avgCompliance: number;
    operators: number;
  };
};

/** Colección Firestore: corridas de pronóstico + distribución (insumos/bolsas), solo resumen. */
export const SUPPLY_FORECAST_RUNS_COL = 'supplyForecastRuns';

export type SaveForecastRunSnapshotResult =
  | { success: true; id: string }
  | { success: false; error: string };

export type ListForecastRunsResult =
  | {
      success: true;
      items: { id: string; generationDateIso: string; itemCount: number; persistedAtMs: number }[];
    }
  | { success: false; error: string };

export type GetForecastRunResult =
  | { success: true; id: string; data: Record<string, unknown> }
  | { success: false; error: string };

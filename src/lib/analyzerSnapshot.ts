import { computeReportData } from '@/components/LogisticsPlatform/hooks/useReportData';
import type {
  AnalysisResult,
  ExcelDataRow,
  PendingDocsAnalysisData,
  ReportData,
  SlaAnalysisData,
} from '@/components/LogisticsPlatform/types';
import type { AnalyzerRouteMatch } from '@/components/LogisticsPlatform/utils/helpers';
import { buildStoreMatcher, normalizeStoreCode } from '@/lib/deliveryStores';
import type { DeliveryStore } from '@/types';

/** Foto del último reporte del Analizador de Bodega (solo la última; se sobrescribe). */
export const ANALYZER_SNAPSHOT_COLLECTION = 'analyzerSnapshot';
export const ANALYZER_SNAPSHOT_GLOBAL_ID = '_global';
/** Firestore limita el doc a 1 MB; el payload JSON se parte en trozos de este tamaño (caracteres). */
const PAYLOAD_CHUNK_CHARS = 450_000;

export const analyzerSnapshotStoreId = (key: string) => `s_${key.replace(/[\/.#$\[\]]/g, '-')}`;
export const analyzerSnapshotPartId = (id: string, part: number) => `${id}__p${part}`;

export type SnapshotKpi = ReportData['kpiData'];

export interface AnalyzerSnapshotStoreRef {
  key: string;
  docId: string;
  label: string;
  storeCode?: string;
  storeName?: string;
  kpi: SnapshotKpi;
}

export interface AnalyzerSnapshotGlobalPayload {
  kpi: SnapshotKpi;
  analysis: AnalysisResult[];
  daily: ReportData['dailyChartData'];
  sla: Omit<SlaAnalysisData, 'finalizedRecords'>[];
  pending: (Omit<PendingDocsAnalysisData, 'pendingRecords'> & {
    pendingRecords: { marca: string; grupo: string; docCount: number; totalQuantity: number; avgDaysPending: number }[];
  })[];
  brands: { [key: string]: any }[];
  stores: AnalyzerSnapshotStoreRef[];
}

export interface AnalyzerSnapshotStorePayload {
  key: string;
  label: string;
  storeCode?: string;
  storeName?: string;
  warehouses: string[];
  kpi: SnapshotKpi;
  sla: SlaAnalysisData[];
  pending: PendingDocsAnalysisData[];
  brands: { [key: string]: any }[];
  headers: string[];
  rows: (string | number)[][];
  uniqueTfCount?: number;
  lineCount?: number;
}

export interface AnalyzerSnapshotMeta {
  at: string;
  byName: string;
  fileName: string;
}

export interface AnalyzerSnapshotDocWrite {
  id: string;
  data: Record<string, unknown>;
}

export interface BuildAnalyzerSnapshotInput {
  baseData: ExcelDataRow[];
  columnMap: { [key: string]: string | undefined };
  routeStatusMap: Map<string, AnalyzerRouteMatch | string>;
  applyUnresolvedPlatformStatus: boolean;
  receivedInWarehouseKeys: string[];
  collectedOnRouteKeys: string[];
  novedadKeys: string[];
  stores: DeliveryStore[];
  meta: AnalyzerSnapshotMeta;
}

function toDocs(id: string, meta: AnalyzerSnapshotMeta, extra: Record<string, unknown>, payload: unknown): AnalyzerSnapshotDocWrite[] {
  const json = JSON.stringify(payload);
  const chunks: string[] = [];
  for (let i = 0; i < json.length; i += PAYLOAD_CHUNK_CHARS) chunks.push(json.slice(i, i + PAYLOAD_CHUNK_CHARS));
  if (!chunks.length) chunks.push('');
  return chunks.map((chunk, i) =>
    i === 0
      ? { id, data: { ...meta, ...extra, parts: chunks.length, chunk } }
      : { id: analyzerSnapshotPartId(id, i), data: { at: meta.at, chunk } }
  );
}

/** Calcula el reporte global y uno por tienda destino, y lo empaqueta en docs listos para guardar. */
export function buildAnalyzerSnapshotDocs(input: BuildAnalyzerSnapshotInput): AnalyzerSnapshotDocWrite[] {
  const { baseData, columnMap, routeStatusMap, applyUnresolvedPlatformStatus, receivedInWarehouseKeys, collectedOnRouteKeys, novedadKeys, stores, meta } = input;
  const compute = (rows: ExcelDataRow[]) =>
    computeReportData(rows, columnMap, 'all', '', '', '', routeStatusMap, applyUnresolvedPlatformStatus, receivedInWarehouseKeys, collectedOnRouteKeys, novedadKeys);

  const warehouseCol = columnMap.warehouse;
  const match = buildStoreMatcher(stores);
  const groups = new Map<string, { store?: DeliveryStore; warehouses: Set<string>; rows: ExcelDataRow[] }>();
  if (warehouseCol) {
    baseData.forEach((row) => {
      const wh = String(row[warehouseCol] ?? '').trim();
      if (!wh) return;
      const store = match(wh);
      const key = store?.codigoErp || `X_${normalizeStoreCode(wh)}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { store, warehouses: new Set(), rows: [] }));
      g.warehouses.add(wh);
      g.rows.push(row);
    });
  }

  const docs: AnalyzerSnapshotDocWrite[] = [];
  const storeRefs: AnalyzerSnapshotStoreRef[] = [];

  groups.forEach((g, key) => {
    const r = compute(g.rows);
    const docId = analyzerSnapshotStoreId(key);
    const label = g.store ? `${g.store.codigoErp} · ${g.store.nombreCorto}` : Array.from(g.warehouses).join(', ');
    const headers = r.generalReport.headers;
    const payload: AnalyzerSnapshotStorePayload = {
      key,
      label,
      storeCode: g.store?.codigoErp,
      storeName: g.store?.nombreCorto,
      warehouses: Array.from(g.warehouses),
      kpi: r.kpiData,
      sla: r.slaAnalysisData,
      pending: r.pendingDocsAnalysisData,
      brands: r.brandReport.exportData,
      headers,
      rows: r.generalReport.exportData.map((row) => headers.map((h) => row[h] ?? '')),
      uniqueTfCount: r.generalReport.uniqueTfCount,
      lineCount: r.generalReport.lineCount,
    };
    docs.push(...toDocs(docId, meta, { key, label, storeCode: g.store?.codigoErp ?? null }, payload));
    storeRefs.push({ key, docId, label, storeCode: g.store?.codigoErp, storeName: g.store?.nombreCorto, kpi: r.kpiData });
  });

  const all = compute(baseData);
  const globalPayload: AnalyzerSnapshotGlobalPayload = {
    kpi: all.kpiData,
    analysis: all.analysisData,
    daily: all.dailyChartData,
    sla: all.slaAnalysisData.map(({ finalizedRecords, ...rest }) => rest),
    pending: all.pendingDocsAnalysisData.map(({ pendingRecords, ...rest }) => ({
      ...rest,
      pendingRecords: pendingRecords.map(({ detailedDocs, ...p }) => p),
    })),
    brands: all.brandReport.exportData,
    stores: storeRefs.sort((a, b) => a.label.localeCompare(b.label)),
  };
  docs.push(...toDocs(ANALYZER_SNAPSHOT_GLOBAL_ID, meta, { storeCount: storeRefs.length }, globalPayload));
  return docs;
}

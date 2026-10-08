import { getAnalyzerWarehouseMatchKeys, normalizeDocId } from '@/components/LogisticsPlatform/utils/helpers';

export type AppPodEntry = {
  numeroTF: string;
  bodegaDestino: string;
  at: string;
  photoUrl?: string;
  /** Evidencias de un ENTREGADO por Quick publicado antes. */
  evidenceLinks?: string[];
  byName?: string;
  manifestId?: number;
  source?: 'app' | 'quick';
};

/** Índice TF|bodega (con alias del analizador). La entrega de la app manda sobre la de Quick previo. */
export function buildAppPodIndex(entries: AppPodEntry[]): Map<string, AppPodEntry> {
  const map = new Map<string, AppPodEntry>();
  entries.forEach((e) => {
    const tf = normalizeDocId(e.numeroTF);
    if (!tf) return;
    getAnalyzerWarehouseMatchKeys(e.bodegaDestino).forEach((whs) => {
      const key = `${tf}|${whs}`;
      const cur = map.get(key);
      if (!cur || (cur.source === 'quick' && e.source !== 'quick')) map.set(key, e);
    });
  });
  return map;
}

/**
 * La entrega de la app manda sobre Quick y sobre lo inferido: la fila queda ENTREGADO,
 * con la foto de la app como primera evidencia y la fecha de entrega real.
 * Un ENTREGADO de Quick publicado antes se conserva aunque el Quick de hoy no traiga esa TF.
 */
export function overlayAppPods<T extends Record<string, any>>(
  rows: T[],
  columnMap: { [key: string]: string | undefined },
  index: Map<string, AppPodEntry>
): T[] {
  if (index.size === 0 || !columnMap.doc || !columnMap.warehouse) return rows;
  const imageField = columnMap.image || 'image';
  const fechaFinField = columnMap.fechaFinalizado || 'fechaFinalizado';
  const estadoField = columnMap.estadoPlataforma || 'estadoPlataforma';
  return rows.map((row) => {
    const tf = normalizeDocId(row[columnMap.doc!]);
    if (!tf) return row;
    const match = getAnalyzerWarehouseMatchKeys(row[columnMap.warehouse!])
      .map((whs) => index.get(`${tf}|${whs}`))
      .find(Boolean);
    if (!match) return row;
    const existing = String(row[imageField] || '')
      .split('|')
      .map((l) => l.trim())
      .filter(Boolean);
    if (match.source === 'quick') {
      if (String(row[estadoField] || '').toUpperCase() === 'ENTREGADO') return row;
      const links = Array.from(new Set([...existing, ...(match.evidenceLinks || [])]));
      const next: Record<string, any> = {
        ...row,
        [imageField]: links.join(' | '),
        [estadoField]: 'ENTREGADO',
        fuenteEntrega: 'QUICK_PREVIO',
      };
      if (match.at && !row[fechaFinField]) next[fechaFinField] = new Date(match.at);
      return next as T;
    }
    const next: Record<string, any> = {
      ...row,
      [imageField]: [match.photoUrl, ...existing.filter((l) => l !== match.photoUrl)].filter(Boolean).join(' | '),
      [estadoField]: 'ENTREGADO',
      fuenteEntrega: 'APP',
      hoyRuta: '',
    };
    if (match.at) next[fechaFinField] = new Date(match.at);
    if (columnMap.hoyRuta) next[columnMap.hoyRuta] = '';
    return next as T;
  });
}

import type { ObservationSummary } from '../types';
import { findHeader, formatDate, normalizeDate } from './helpers';

export type MatchMethod = 'exact' | 'fuzzy' | 'quantity' | 'manual';

export interface PreviousDayProcessRow {
  id: string;
  label: string;
  isVXM: boolean;
  totalQuantity: number;
  totalPacked: number;
  conteoPorcentaje: number;
  etiquetadoPorcentaje: number;
  revisionCalidadPorcentaje: number;
  remisionPorcentaje: number;
  fechaProceso?: string;
  fechaEntrega?: string;
  source: 'control' | 'raw';
}

export interface ProcessMatch {
  currentId: string;
  previousId: string;
  method: MatchMethod;
  score: number;
}

export interface AutoMatchResult {
  matches: ProcessMatch[];
  unmatchedCurrentIds: string[];
  unmatchedPreviousIds: string[];
}

const FUZZY_THRESHOLD = 0.72;
const QUANTITY_TOLERANCE = 0.02;

let prevIdSeq = 0;
const nextPrevId = () => `prev-${++prevIdSeq}-${Date.now().toString(36)}`;

export function normalizeProcessLabel(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function tokenize(label: string): string[] {
  return normalizeProcessLabel(label)
    .split(/[^A-Z0-9]+/)
    .filter((t) => t.length > 1);
}

/** Dice coefficient on character bigrams + token Jaccard blend. */
export function labelSimilarity(a: string, b: string): number {
  const na = normalizeProcessLabel(a);
  const nb = normalizeProcessLabel(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const containment =
    na.includes(nb) || nb.includes(na)
      ? Math.min(na.length, nb.length) / Math.max(na.length, nb.length)
      : 0;

  const bigrams = (s: string): Map<string, number> => {
    const map = new Map<string, number>();
    const padded = ` ${s} `;
    for (let i = 0; i < padded.length - 1; i++) {
      const bg = padded.slice(i, i + 2);
      map.set(bg, (map.get(bg) || 0) + 1);
    }
    return map;
  };
  const ba = bigrams(na);
  const bb = bigrams(nb);
  let overlap = 0;
  let totalA = 0;
  let totalB = 0;
  ba.forEach((c) => {
    totalA += c;
  });
  bb.forEach((c) => {
    totalB += c;
  });
  ba.forEach((c, k) => {
    overlap += Math.min(c, bb.get(k) || 0);
  });
  const dice = totalA + totalB > 0 ? (2 * overlap) / (totalA + totalB) : 0;

  const ta = new Set(tokenize(na));
  const tb = new Set(tokenize(nb));
  let tokenOverlap = 0;
  ta.forEach((t) => {
    if (tb.has(t)) tokenOverlap++;
  });
  const tokenUnion = ta.size + tb.size - tokenOverlap;
  const jaccard = tokenUnion > 0 ? tokenOverlap / tokenUnion : 0;

  return Math.max(containment, dice * 0.55 + jaccard * 0.45, dice, jaccard);
}

function parseNum(value: unknown): number {
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  const n = Number(String(value ?? '').replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function detectIsVXM(row: Record<string, unknown>, tipoCol?: string): boolean {
  if (tipoCol) {
    const t = String(row[tipoCol] || '')
      .toUpperCase()
      .trim();
    if (t === 'VXM') return true;
    if (t === 'RIM') return false;
  }
  // Heurística: filas Control con CALIDAD/REMISION suelen ser VXM si no hay TIPO
  const hasCalidad = parseNum(row['CALIDAD %'] ?? row['CALIDAD%']) > 0;
  const hasRemision = parseNum(row['REMISION %'] ?? row['REMISION%']) > 0;
  const hasConteo = parseNum(row['CONTEO %'] ?? row['CONTEO%']) > 0;
  if ((hasCalidad || hasRemision) && !hasConteo) return true;
  return false;
}

function formatFechaFromRow(value: unknown): string | undefined {
  if (!value && value !== 0) return undefined;
  const d = normalizeDate(value);
  if (d) return formatDate(d);
  const s = String(value).trim();
  return s || undefined;
}

function parseControlExportRows(jsonData: Record<string, unknown>[]): PreviousDayProcessRow[] {
  const rows: PreviousDayProcessRow[] = [];
  for (const row of jsonData) {
    const label =
      String(row['PROCESO'] || row['OBS'] || '').trim() ||
      String(row['ID'] || '').trim();
    if (!label) continue;
    const tipoCol = Object.keys(row).find((k) => normalizeProcessLabel(k) === 'TIPO');
    let fechaEntrega: string | undefined;
    const rawFecha = row['FECHA ENTREGA'];
    if (rawFecha) {
      const d = normalizeDate(rawFecha);
      if (d) {
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        fechaEntrega = `${y}-${m}-${day}`;
      } else {
        const s = String(rawFecha).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) fechaEntrega = s;
      }
    }
    rows.push({
      id: nextPrevId(),
      label,
      isVXM: detectIsVXM(row, tipoCol),
      totalQuantity: parseNum(row['CANT. PEDIDA'] ?? row['CANT PEDIDA'] ?? row['CANT']),
      totalPacked: parseNum(row['CANT. EMPACADA'] ?? row['CANT EMPACADA'] ?? row['EMP']),
      conteoPorcentaje: parseNum(row['CONTEO %'] ?? row['CONTEO%']),
      etiquetadoPorcentaje: parseNum(row['ETIQUETADO %'] ?? row['ETIQUETADO%']),
      revisionCalidadPorcentaje: parseNum(row['CALIDAD %'] ?? row['CALIDAD%']),
      remisionPorcentaje: parseNum(row['REMISION %'] ?? row['REMISION%']),
      fechaProceso: formatFechaFromRow(row['FECHA PROCESO'] ?? row['FECHA']),
      fechaEntrega,
      source: 'control',
    });
  }
  return rows;
}

function parseRawTipoObsRows(jsonData: Record<string, unknown>[]): PreviousDayProcessRow[] {
  const headers = Object.keys(jsonData[0] || {});
  const colMap = {
    TIPO: findHeader(headers, ['TIPO']),
    FECHA: findHeader(headers, ['FECHA']),
    OBS: findHeader(headers, ['OBS', 'PROCESO', 'OBSERVACION', 'OBSERVACIÓN']),
    CANT: findHeader(headers, ['CANT', 'CANTIDAD', 'CANT. PEDIDA']),
    EMP: findHeader(headers, ['EMP', 'EMPACADA', 'CANT. EMPACADA']),
  };
  if (!colMap.TIPO || !colMap.CANT) return [];

  const tempMap = new Map<
    string,
    { q: number; p: number; d: Date | null; tipo: string; obs: string }
  >();

  jsonData.forEach((row) => {
    const tipo = String(row[colMap.TIPO!] || '')
      .toUpperCase()
      .trim();
    if (tipo !== 'RIM' && tipo !== 'VXM') return;
    const obs = String(row[colMap.OBS!] || 'S/O');
    const key = `${tipo}-${obs}`;
    if (!tempMap.has(key)) tempMap.set(key, { q: 0, p: 0, d: null, tipo, obs });
    const curr = tempMap.get(key)!;
    curr.q += parseNum(row[colMap.CANT!]);
    curr.p += colMap.EMP ? parseNum(row[colMap.EMP]) : 0;
    const f = normalizeDate(row[colMap.FECHA!]);
    if (f && (!curr.d || f > curr.d)) curr.d = f;
  });

  return Array.from(tempMap.values()).map((d) => ({
    id: nextPrevId(),
    label: d.obs,
    isVXM: d.tipo === 'VXM',
    totalQuantity: d.q,
    totalPacked: d.p,
    conteoPorcentaje: 0,
    etiquetadoPorcentaje: 0,
    revisionCalidadPorcentaje: 0,
    remisionPorcentaje: 0,
    fechaProceso: d.d ? formatDate(d.d) : undefined,
    source: 'raw' as const,
  }));
}

/** Detecta Excel Control export o raw TIPO/OBS/CANT/EMP. */
export function parsePreviousDayRows(jsonData: Record<string, unknown>[]): PreviousDayProcessRow[] {
  if (!jsonData?.length) return [];
  const headers = Object.keys(jsonData[0] || {}).map((h) => normalizeProcessLabel(h));
  const isControl =
    headers.includes('PROCESO') ||
    headers.includes('CANT EMPACADA') ||
    headers.includes('AVANCE TOTAL');

  if (isControl) {
    const rows = parseControlExportRows(jsonData);
    if (rows.length > 0) return rows;
  }
  return parseRawTipoObsRows(jsonData);
}

function quantityClose(a: number, b: number): boolean {
  const max = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) / max <= QUANTITY_TOLERANCE;
}

function fechaBonus(currentFechaObs: string, prevFecha?: string): number {
  if (!prevFecha || !currentFechaObs || currentFechaObs === 'N/D') return 0;
  const na = normalizeProcessLabel(currentFechaObs).replace(/\//g, '');
  const nb = normalizeProcessLabel(prevFecha).replace(/\//g, '');
  if (na && nb && (na === nb || currentFechaObs === prevFecha)) return 0.05;
  return 0;
}

export function scoreProcessMatch(
  current: ObservationSummary,
  previous: PreviousDayProcessRow
): { score: number; method: MatchMethod } | null {
  if (Boolean(current.isVXM) !== previous.isVXM) return null;

  const currLabel = current.observation;
  const prevLabel = previous.label;
  const exact =
    normalizeProcessLabel(currLabel) === normalizeProcessLabel(prevLabel) &&
    normalizeProcessLabel(currLabel) !== '';

  if (exact) {
    let score = 1;
    if (previous.totalPacked <= current.totalPacked + 1) score += 0.02;
    score += fechaBonus(current.fechaObs, previous.fechaProceso);
    return { score: Math.min(1.05, score), method: 'exact' };
  }

  const sim = labelSimilarity(currLabel, prevLabel);
  if (sim >= FUZZY_THRESHOLD) {
    let score = 0.75 + sim * 0.2;
    if (quantityClose(current.totalQuantity, previous.totalQuantity)) score += 0.05;
    if (previous.totalPacked <= current.totalPacked + 1) score += 0.02;
    score += fechaBonus(current.fechaObs, previous.fechaProceso);
    return { score, method: 'fuzzy' };
  }

  if (
    quantityClose(current.totalQuantity, previous.totalQuantity) &&
    current.totalQuantity > 0
  ) {
    let score = 0.55;
    if (previous.totalPacked <= current.totalPacked + 1) score += 0.08;
    score += fechaBonus(current.fechaObs, previous.fechaProceso);
    // Solo aceptar quantity si la cantidad es suficientemente discriminante
    // (evita emparejar muchos procesos con misma cant genérica)
    return { score, method: 'quantity' };
  }

  return null;
}

/** Matching 1:1 greedy por score descendente. */
export function autoMatchProcesses(
  current: ObservationSummary[],
  previous: PreviousDayProcessRow[]
): AutoMatchResult {
  type Cand = { currentId: string; previousId: string; score: number; method: MatchMethod };
  const candidates: Cand[] = [];

  for (const cur of current) {
    for (const prev of previous) {
      const scored = scoreProcessMatch(cur, prev);
      if (!scored) continue;
      // Quantity-only: exigir que no haya otro current con misma cantidad+tipo
      // (se filtra abajo con greedy; score más bajo que fuzzy/exact)
      candidates.push({
        currentId: cur.id,
        previousId: prev.id,
        score: scored.score,
        method: scored.method,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  const usedCurrent = new Set<string>();
  const usedPrevious = new Set<string>();
  const matches: ProcessMatch[] = [];

  // Primera pasada: exact + fuzzy
  for (const c of candidates) {
    if (c.method === 'quantity') continue;
    if (usedCurrent.has(c.currentId) || usedPrevious.has(c.previousId)) continue;
    usedCurrent.add(c.currentId);
    usedPrevious.add(c.previousId);
    matches.push({
      currentId: c.currentId,
      previousId: c.previousId,
      method: c.method,
      score: c.score,
    });
  }

  // Quantity: solo si ambos lados siguen libres y la cantidad es única en cada lado
  const qtyByTipoCurr = new Map<string, number>();
  const qtyByTipoPrev = new Map<string, number>();
  const qtyKey = (isVXM: boolean, q: number) => `${isVXM ? 'V' : 'R'}:${Math.round(q)}`;

  current.forEach((c) => {
    if (usedCurrent.has(c.id)) return;
    const k = qtyKey(Boolean(c.isVXM), c.totalQuantity);
    qtyByTipoCurr.set(k, (qtyByTipoCurr.get(k) || 0) + 1);
  });
  previous.forEach((p) => {
    if (usedPrevious.has(p.id)) return;
    const k = qtyKey(p.isVXM, p.totalQuantity);
    qtyByTipoPrev.set(k, (qtyByTipoPrev.get(k) || 0) + 1);
  });

  for (const c of candidates) {
    if (c.method !== 'quantity') continue;
    if (usedCurrent.has(c.currentId) || usedPrevious.has(c.previousId)) continue;
    const cur = current.find((x) => x.id === c.currentId);
    const prev = previous.find((x) => x.id === c.previousId);
    if (!cur || !prev) continue;
    const k = qtyKey(Boolean(cur.isVXM), cur.totalQuantity);
    if ((qtyByTipoCurr.get(k) || 0) !== 1 || (qtyByTipoPrev.get(k) || 0) !== 1) continue;
    usedCurrent.add(c.currentId);
    usedPrevious.add(c.previousId);
    matches.push({
      currentId: c.currentId,
      previousId: c.previousId,
      method: c.method,
      score: c.score,
    });
  }

  return {
    matches,
    unmatchedCurrentIds: current.filter((c) => !usedCurrent.has(c.id)).map((c) => c.id),
    unmatchedPreviousIds: previous.filter((p) => !usedPrevious.has(p.id)).map((p) => p.id),
  };
}

function stagesAreEmpty(item: ObservationSummary): boolean {
  const c = item.conteoPorcentaje || 0;
  const e = item.etiquetadoPorcentaje || 0;
  const q = item.revisionCalidadPorcentaje || 0;
  const r = item.remisionPorcentaje || 0;
  return c === 0 && e === 0 && q === 0 && r === 0;
}

export function applyPreviousDayDeltas(
  current: ObservationSummary,
  previous: PreviousDayProcessRow,
  method: MatchMethod
): ObservationSummary {
  const deltaPacked = Math.max(0, Number(current.totalPacked) - Number(previous.totalPacked || 0));
  const seedStages = stagesAreEmpty(current);
  const conteo = seedStages ? previous.conteoPorcentaje : current.conteoPorcentaje || 0;
  const etiquetado = seedStages ? previous.etiquetadoPorcentaje : current.etiquetadoPorcentaje || 0;
  const calidad = seedStages
    ? previous.revisionCalidadPorcentaje
    : current.revisionCalidadPorcentaje || 0;
  const remision = seedStages ? previous.remisionPorcentaje : current.remisionPorcentaje || 0;

  const deltaConteo = Math.max(0, conteo - (previous.conteoPorcentaje || 0));
  const deltaEtiquetado = Math.max(0, etiquetado - (previous.etiquetadoPorcentaje || 0));
  const deltaCalidad = Math.max(0, calidad - (previous.revisionCalidadPorcentaje || 0));
  const deltaRemision = Math.max(0, remision - (previous.remisionPorcentaje || 0));

  const fechaEntrega =
    !current.fechaEntrega && previous.fechaEntrega
      ? previous.fechaEntrega
      : current.fechaEntrega;

  return {
    ...current,
    conteoPorcentaje: conteo,
    etiquetadoPorcentaje: etiquetado,
    revisionCalidadPorcentaje: calidad,
    remisionPorcentaje: remision,
    fechaEntrega,
    deltaPacked,
    deltaConteo,
    deltaEtiquetado,
    deltaCalidad,
    deltaRemision,
    hasDeltas: true,
    matchMethod: method,
    matchedPreviousLabel: previous.label,
    matchedPreviousId: previous.id,
  };
}

export function clearPreviousDayDeltas(current: ObservationSummary): ObservationSummary {
  const {
    deltaPacked: _dp,
    deltaConteo: _dc,
    deltaEtiquetado: _de,
    deltaCalidad: _dq,
    deltaRemision: _dr,
    hasDeltas: _hd,
    matchMethod: _mm,
    matchedPreviousLabel: _mpl,
    matchedPreviousId: _mpi,
    ...rest
  } = current;
  return { ...rest, hasDeltas: false };
}

export function methodLabel(method: MatchMethod): string {
  switch (method) {
    case 'exact':
      return 'Exacto';
    case 'fuzzy':
      return 'Similar';
    case 'quantity':
      return 'Cantidad';
    case 'manual':
      return 'Manual';
    default:
      return method;
  }
}

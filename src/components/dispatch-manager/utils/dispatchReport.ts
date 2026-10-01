import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import type { SavedVerification, VerificationDispatchClass, VerificationItem } from '@/types';
import { arrivalLabel } from './verificationScan';

export const DISPATCH_CLASS_LABEL: Record<VerificationDispatchClass, string> = {
  ambas: 'Alistada y cargada',
  solo_cargue: 'Solo cargue',
  solo_alistamiento: 'Alistada, no cargada',
  no_encontrada: 'No encontrada',
  sin_leer: 'Sin leer',
};

export const DISPATCH_CLASSES = Object.keys(DISPATCH_CLASS_LABEL) as VerificationDispatchClass[];

export type AltCodeRow = { codigoAlterno: string; numeroTF: string; destino: string; cantidad: number };

export const isClosedCargueSession = (s: SavedVerification) => !!s.requiresCargue && !!s.dispatchClose;

export const isLoadedItem = (item: VerificationItem) =>
  item.dispatchClass === 'ambas' || item.dispatchClass === 'solo_cargue';

const toDate = (v: unknown): Date | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d;
};

const fmt = (v: unknown, pattern = 'dd/MM/yyyy HH:mm') => {
  const d = toDate(v);
  return d ? format(d, pattern) : '';
};

const safeName = (name: string) => name.replace(/[^\w-]+/g, '_');

export const sessionClosedAt = (s: SavedVerification) => toDate(s.dispatchClose?.closedAt);

export function dispatchDetailRows(sessions: SavedVerification[]) {
  return sessions.flatMap((s) =>
    (s.results || []).map((item) => ({
      Validación: s.name,
      'Fecha cierre': fmt(s.dispatchClose?.closedAt),
      Placa: s.cargue?.placa || '',
      Conductor: s.cargue?.conductor || '',
      'Relación #': s.dispatchClose?.manifestId ?? '',
      Código: item.codigo,
      TF: item.tftCruce || item.tfOriginal || '',
      Destino: item.destino,
      Unidades: Number(item.cantTft) || item.cantTft || '',
      Ubicación: item.ubicacion || '',
      Llegada: item.fechaLlegada ? arrivalLabel(item.fechaLlegada) : '',
      'Código alterno': item.codigoAlterno || '',
      Clasificación: item.dispatchClass ? DISPATCH_CLASS_LABEL[item.dispatchClass] : '',
      'Motivo no cargue': item.notLoadedReason || '',
      'Hora alistamiento': fmt(item.scanTime, 'HH:mm'),
      'Hora cargue': fmt(item.loadedAt, 'HH:mm'),
      'Cargó': item.loadedByName || '',
      'Fuera del plan': item.outOfPlan ? 'Sí' : '',
    }))
  );
}

export type DispatchIndicators = {
  despachos: number;
  cajas: number;
  byClass: Record<VerificationDispatchClass, number>;
  unidadesCargadas: number;
  reasons: Array<{ motivo: string; cajas: number }>;
  notFoundByDest: Array<{ destino: string; cajas: number }>;
  outOfPlanLoaded: number;
};

export function computeDispatchIndicators(sessions: SavedVerification[]): DispatchIndicators {
  const byClass = Object.fromEntries(DISPATCH_CLASSES.map((c) => [c, 0])) as Record<VerificationDispatchClass, number>;
  const reasons = new Map<string, number>();
  const notFound = new Map<string, number>();
  let cajas = 0;
  let unidadesCargadas = 0;
  let outOfPlanLoaded = 0;
  sessions.forEach((s) =>
    (s.results || []).forEach((item) => {
      if (!item.dispatchClass) return;
      cajas += 1;
      byClass[item.dispatchClass] += 1;
      if (isLoadedItem(item)) {
        unidadesCargadas += Number(item.cantTft) || 0;
        if (item.outOfPlan) outOfPlanLoaded += 1;
      }
      if (item.dispatchClass === 'solo_alistamiento') {
        const m = item.notLoadedReason || 'Sin motivo';
        reasons.set(m, (reasons.get(m) || 0) + 1);
      }
      if (item.dispatchClass === 'no_encontrada') {
        notFound.set(item.destino || 'N/A', (notFound.get(item.destino || 'N/A') || 0) + 1);
      }
    })
  );
  return {
    despachos: sessions.length,
    cajas,
    byClass,
    unidadesCargadas,
    reasons: Array.from(reasons, ([motivo, n]) => ({ motivo, cajas: n })).sort((a, b) => b.cajas - a.cajas),
    notFoundByDest: Array.from(notFound, ([destino, n]) => ({ destino, cajas: n })).sort((a, b) => b.cajas - a.cajas),
    outOfPlanLoaded,
  };
}

export function exportDispatchReportExcel(sessions: SavedVerification[], fileLabel: string) {
  const ind = computeDispatchIndicators(sessions);
  const wb = XLSX.utils.book_new();

  const resumen = sessions.map((s) => {
    const counts = Object.fromEntries(DISPATCH_CLASSES.map((c) => [c, 0])) as Record<VerificationDispatchClass, number>;
    (s.results || []).forEach((i) => i.dispatchClass && (counts[i.dispatchClass] += 1));
    return {
      Validación: s.name,
      'Fecha cierre': fmt(s.dispatchClose?.closedAt),
      'Cerró': s.dispatchClose?.closedByName || '',
      Placa: s.cargue?.placa || '',
      Conductor: s.cargue?.conductor || '',
      Auxiliares: s.cargue?.auxiliares || '',
      'Relación #': s.dispatchClose?.manifestId ?? '',
      ...Object.fromEntries(DISPATCH_CLASSES.map((c) => [DISPATCH_CLASS_LABEL[c], counts[c]])),
      'No incluidas en relación': s.dispatchClose?.skipped?.length || 0,
    };
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumen), 'Resumen');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dispatchDetailRows(sessions)), 'Detalle cajas');
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(ind.reasons.length ? ind.reasons.map((r) => ({ Motivo: r.motivo, Cajas: r.cajas })) : [{ Motivo: '', Cajas: 0 }]),
    'Motivos no cargue'
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      ind.notFoundByDest.length ? ind.notFoundByDest.map((r) => ({ Destino: r.destino, Cajas: r.cajas })) : [{ Destino: '', Cajas: 0 }]
    ),
    'No encontradas'
  );
  const skipped = sessions.flatMap((s) =>
    (s.dispatchClose?.skipped || []).map((k) => ({ Validación: s.name, Código: k.codigo, TF: k.tf, Destino: k.destino, Motivo: k.reason }))
  );
  if (skipped.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(skipped), 'No en relación');

  XLSX.writeFile(wb, `reporte_despachos_${safeName(fileLabel)}_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`);
}

export function downloadAltCodesExcel(
  rows: AltCodeRow[],
  meta: { sessionName: string; manifestId?: number; placa?: string; fecha?: Date | null }
) {
  const fecha = format(meta.fecha || new Date(), 'dd/MM/yyyy HH:mm');
  const sheet = XLSX.utils.json_to_sheet(
    rows.map((r) => ({
      'Código alterno': r.codigoAlterno,
      TF: r.numeroTF,
      Destino: r.destino,
      Unidades: r.cantidad,
      'Fecha cargue': fecha,
      'Relación #': meta.manifestId ?? '',
      Placa: meta.placa || '',
    }))
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Codigos alternos');
  XLSX.writeFile(wb, `codigos_alternos_${safeName(meta.sessionName)}_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`);
}

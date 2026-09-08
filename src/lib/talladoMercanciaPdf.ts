import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { TalladoPause, TalladoShift, TalladoUnit } from '@/types';
import { TALLADO_DEFAULT_DESTINO } from '@/lib/talladoCatalog';

const PAUSE_LABELS: Record<string, string> = {
  desayuno: 'Desayuno',
  almuerzo: 'Almuerzo',
  fin_jornada: 'Fin jornada',
  otros: 'Otros',
};

function isSinRemision(u: TalladoUnit): boolean {
  if (u.source === 'catalogo') return true;
  const dest = String(u.bodegaDestino || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const marca = String(u.marca || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const target = TALLADO_DEFAULT_DESTINO.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return dest === target || marca === target || dest.includes('SIN REMISION') || marca.includes('SIN REMISION');
}

/** Marca para reportes: catálogo / sin remisión siempre como MERCANCIA SIN REMISIONAR. */
function reportMarca(u: TalladoUnit): string {
  if (isSinRemision(u)) return TALLADO_DEFAULT_DESTINO;
  return u.marca || 'Sin marca';
}

function reportDestino(u: TalladoUnit): string {
  if (isSinRemision(u)) return TALLADO_DEFAULT_DESTINO;
  return u.bodegaDestino || '—';
}

function fmtTime(iso?: string) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es-CO', { hour12: false });
  } catch {
    return iso;
  }
}

function fmtDuration(ms?: number) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m} min`;
  return `${h}h ${m}m`;
}

/** Hora local 0–23 a partir de ISO. */
export function localHourFromIso(iso?: string): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(iso).getHours();
}

export function filterTalladoByHour(
  units: TalladoUnit[],
  pauses: TalladoPause[],
  hour: number
): { units: TalladoUnit[]; pauses: TalladoPause[] } {
  const h = Math.max(0, Math.min(23, Math.round(hour)));
  return {
    units: units.filter((u) => {
      const ref = u.endedAt || u.startedAt;
      return localHourFromIso(ref) === h;
    }),
    pauses: pauses.filter((p) => localHourFromIso(p.pausedAt) === h),
  };
}

function writeUnitsAndPauses(
  doc: jsPDF,
  units: TalladoUnit[],
  pauses: TalladoPause[],
  startY: number
) {
  autoTable(doc, {
    startY,
    head: [['Código', 'TF / Ref', 'Destino', 'Marca', 'Cant.', 'Inicio', 'Fin', 'Bruto', 'Neto', 'Grupo']],
    body:
      units.length === 0
        ? [['—', 'Sin unidades', '—', '—', '—', '—', '—', '—', '—', '—']]
        : units.map((u) => [
            u.scanCode,
            isSinRemision(u) ? u.referencia || u.numeroTF || u.scanCode : u.numeroTF,
            reportDestino(u),
            reportMarca(u),
            String(u.cantidad),
            fmtTime(u.startedAt),
            fmtTime(u.endedAt),
            fmtDuration(u.durationMs),
            fmtDuration(u.durationNetMs ?? u.durationMs),
            u.grupo || '—',
          ]),
    styles: { fontSize: 7, cellPadding: 2.5 },
    headStyles: { fillColor: [30, 64, 175] },
  });

  const afterUnits = (doc as any).lastAutoTable?.finalY || startY + 40;
  doc.setFontSize(11);
  doc.text('Pausas colectivas', 40, afterUnits + 20);
  autoTable(doc, {
    startY: afterUnits + 28,
    head: [['Tipo', 'Motivo', 'Grupo', 'Inicio', 'Fin', 'Duración']],
    body:
      pauses.length === 0
        ? [['—', 'Sin pausas', '—', '—', '—', '—']]
        : pauses.map((p) => [
            PAUSE_LABELS[p.type] || p.type,
            p.note || '—',
            p.grupo || '—',
            fmtTime(p.pausedAt),
            fmtTime(p.resumedAt),
            fmtDuration(
              p.durationMs ??
                (p.status === 'open' ? Date.now() - new Date(p.pausedAt).getTime() : undefined)
            ),
          ]),
    styles: { fontSize: 7, cellPadding: 2.5 },
    headStyles: { fillColor: [180, 83, 9] },
  });
}

function summaryLine(units: TalladoUnit[], pauses: TalladoPause[]) {
  const done = units.filter((u) => u.status === 'done');
  const inProg = units.filter((u) => u.status === 'in_progress');
  const qtyDone = done.reduce((s, u) => s + (Number(u.cantidad) || 0), 0);
  const pauseMs = pauses.reduce((s, p) => {
    if (p.durationMs != null) return s + p.durationMs;
    if (p.status === 'open') return s + Math.max(0, Date.now() - new Date(p.pausedAt).getTime());
    return s;
  }, 0);
  const netMs = done.reduce((s, u) => s + (Number(u.durationNetMs ?? u.durationMs) || 0), 0);
  return { done, inProg, qtyDone, pauseMs, netMs };
}

/** Reporte del turno actual (todas las unidades del shift). */
export function downloadTalladoReportPdf(opts: {
  shift: TalladoShift;
  units: TalladoUnit[];
  pauses: TalladoPause[];
}) {
  const { shift, units, pauses } = opts;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const { done, inProg, qtyDone, pauseMs, netMs } = summaryLine(units, pauses);

  doc.setFontSize(16);
  doc.text('Reporte Tallado de mercancía — Turno', 40, 36);
  doc.setFontSize(10);
  doc.text(`Grupo: ${shift.grupo}  ·  Personas: ${shift.peopleCount}  ·  Operario: ${shift.userName}`, 40, 54);
  doc.text(
    `Inicio turno: ${fmtTime(shift.startedAt)}  ·  Unidades: ${done.length} cerradas / ${inProg.length} en proceso  ·  Cantidad: ${qtyDone}`,
    40,
    68
  );
  doc.text(`Tiempo neto unidades: ${fmtDuration(netMs)}  ·  Tiempo en pausas: ${fmtDuration(pauseMs)}`, 40, 82);

  writeUnitsAndPauses(doc, units, pauses, 96);

  const safeGrupo = shift.grupo.replace(/[^\w\-]+/g, '_');
  doc.save(`tallado_turno_${safeGrupo}_${shift.startedAt.slice(0, 10)}.pdf`);
}

/** Reporte filtrado por una hora local específica (0–23). */
export function downloadTalladoHourlyPdf(opts: {
  hour: number;
  dayLabel?: string;
  shift?: TalladoShift | null;
  units: TalladoUnit[];
  pauses: TalladoPause[];
  scopeLabel?: string;
}) {
  const hour = Math.max(0, Math.min(23, Math.round(opts.hour)));
  const filtered = filterTalladoByHour(opts.units, opts.pauses, hour);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const { done, inProg, qtyDone, pauseMs, netMs } = summaryLine(filtered.units, filtered.pauses);
  const day = opts.dayLabel || new Date().toLocaleDateString('es-CO');
  const hourLabel = `${String(hour).padStart(2, '0')}:00–${String(hour).padStart(2, '0')}:59`;

  doc.setFontSize(16);
  doc.text('Reporte Tallado — Por hora', 40, 36);
  doc.setFontSize(10);
  doc.text(`Día: ${day}  ·  Franja: ${hourLabel}  ·  ${opts.scopeLabel || 'Alcance seleccionado'}`, 40, 54);
  if (opts.shift) {
    doc.text(`Grupo: ${opts.shift.grupo}  ·  Personas: ${opts.shift.peopleCount}  ·  Operario: ${opts.shift.userName}`, 40, 68);
  } else {
    doc.text('Consolidado (varios turnos / grupos del día)', 40, 68);
  }
  doc.text(
    `Unidades: ${done.length} cerradas / ${inProg.length} en proceso  ·  Cantidad: ${qtyDone}  ·  Neto: ${fmtDuration(netMs)}  ·  Pausas: ${fmtDuration(pauseMs)}`,
    40,
    82
  );

  writeUnitsAndPauses(doc, filtered.units, filtered.pauses, 96);
  doc.save(`tallado_hora_${String(hour).padStart(2, '0')}_${day.replace(/[^\d\-]/g, '_')}.pdf`);
}

/** Reporte consolidado de todo el día (todos los turnos/unidades/pausas del día). */
export function downloadTalladoDayConsolidatedPdf(opts: {
  dayLabel?: string;
  shifts: TalladoShift[];
  units: TalladoUnit[];
  pauses: TalladoPause[];
}) {
  const { shifts, units, pauses } = opts;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const { done, inProg, qtyDone, pauseMs, netMs } = summaryLine(units, pauses);
  const day = opts.dayLabel || new Date().toLocaleDateString('es-CO');
  const people = shifts.reduce((s, sh) => s + (Number(sh.peopleCount) || 0), 0);
  const grupos = Array.from(new Set(shifts.map((s) => s.grupo).filter(Boolean))).join(', ') || '—';

  // Resumen por hora
  const byHour = new Map<number, { qty: number; units: number; pauseMin: number }>();
  for (const u of done) {
    const h = localHourFromIso(u.endedAt || u.startedAt);
    if (h == null) continue;
    const prev = byHour.get(h) || { qty: 0, units: 0, pauseMin: 0 };
    prev.qty += Number(u.cantidad) || 0;
    prev.units += 1;
    byHour.set(h, prev);
  }
  for (const p of pauses) {
    const h = localHourFromIso(p.pausedAt);
    if (h == null) continue;
    const prev = byHour.get(h) || { qty: 0, units: 0, pauseMin: 0 };
    prev.pauseMin += Math.round((Number(p.durationMs) || 0) / 60000);
    byHour.set(h, prev);
  }

  const byMarca = new Map<string, number>();
  for (const u of done) {
    const m = reportMarca(u);
    byMarca.set(m, (byMarca.get(m) || 0) + (Number(u.cantidad) || 0));
  }

  doc.setFontSize(16);
  doc.text('Reporte Tallado — Consolidado del día', 40, 36);
  doc.setFontSize(10);
  doc.text(`Día: ${day}  ·  Turnos: ${shifts.length}  ·  Grupos: ${grupos}  ·  Personas (suma turnos): ${people}`, 40, 54);
  doc.text(
    `Unidades: ${done.length} cerradas / ${inProg.length} en proceso  ·  Cantidad: ${qtyDone}  ·  Neto: ${fmtDuration(netMs)}  ·  Pausas: ${fmtDuration(pauseMs)}`,
    40,
    68
  );

  autoTable(doc, {
    startY: 84,
    head: [['Hora', 'Cantidad', 'Unidades', 'Pausa (min)']],
    body:
      byHour.size === 0
        ? [['—', '0', '0', '0']]
        : Array.from(byHour.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([h, v]) => [`${String(h).padStart(2, '0')}:00`, String(v.qty), String(v.units), String(v.pauseMin)]),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [15, 118, 110] },
  });

  const afterHour = (doc as any).lastAutoTable?.finalY || 120;
  doc.setFontSize(11);
  doc.text('Marcas (cantidad)', 40, afterHour + 18);
  autoTable(doc, {
    startY: afterHour + 26,
    head: [['Marca', 'Cantidad']],
    body:
      byMarca.size === 0
        ? [['—', '0']]
        : Array.from(byMarca.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([m, c]) => [m, String(c)]),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [67, 56, 202] },
  });

  const afterMarca = (doc as any).lastAutoTable?.finalY || afterHour + 60;
  doc.setFontSize(11);
  doc.text('Detalle de unidades y pausas', 40, afterMarca + 18);
  writeUnitsAndPauses(doc, units, pauses, afterMarca + 26);

  const safeDay = day.replace(/[^\d\-]/g, '_');
  doc.save(`tallado_dia_consolidado_${safeDay}.pdf`);
}

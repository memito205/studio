import * as XLSX from 'xlsx';
import type { TalladoPause, TalladoShift, TalladoUnit } from '@/types';
import { TALLADO_DEFAULT_DESTINO } from '@/lib/talladoCatalog';
import {
  filterTalladoBundleToDay,
  talladoLocalDayKey,
  talladoPauseMs,
  talladoPerPersonHour,
} from '@/lib/talladoProductivity';

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

function reportMarca(u: TalladoUnit): string {
  if (isSinRemision(u)) return TALLADO_DEFAULT_DESTINO;
  return u.marca || 'Sin marca';
}

function reportDestino(u: TalladoUnit): string {
  if (isSinRemision(u)) return TALLADO_DEFAULT_DESTINO;
  return u.bodegaDestino || '—';
}

function fmtLocal(iso?: string) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('es-CO', { hour12: false, timeZone: 'America/Bogota' });
  } catch {
    return iso;
  }
}

function fmtDuration(ms?: number) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '';
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m} min`;
  return `${h}h ${m}m`;
}

function localHourBogota(iso?: string): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(d);
  const hour = parts.find((p) => p.type === 'hour')?.value;
  const n = hour != null ? Number(hour) : NaN;
  return Number.isFinite(n) ? n % 24 : null;
}

export function prepareTalladoDayConsolidated(opts: {
  dayKey?: string;
  shifts: TalladoShift[];
  units: TalladoUnit[];
  pauses: TalladoPause[];
}) {
  const dayKey = opts.dayKey || talladoLocalDayKey();
  const filtered = filterTalladoBundleToDay(dayKey, opts.shifts, opts.units, opts.pauses);
  const done = filtered.units.filter((u) => u.status === 'done');
  const inProg = filtered.units.filter((u) => u.status === 'in_progress');
  const metrics = talladoPerPersonHour({
    shifts: filtered.shifts,
    units: filtered.units,
    pauses: filtered.pauses,
    dayKey,
  });
  const pauseMs = talladoPauseMs(filtered.pauses, dayKey);

  const byHour = new Map<number, { qty: number; units: number; pauseMin: number }>();
  for (const u of done) {
    const h = localHourBogota(u.endedAt || u.startedAt);
    if (h == null) continue;
    const prev = byHour.get(h) || { qty: 0, units: 0, pauseMin: 0 };
    prev.qty += Number(u.cantidad) || 0;
    prev.units += 1;
    byHour.set(h, prev);
  }
  for (const p of filtered.pauses) {
    const h = localHourBogota(p.pausedAt);
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

  return {
    dayKey,
    ...filtered,
    done,
    inProg,
    metrics,
    pauseMs,
    byHour,
    byMarca,
  };
}

export function downloadTalladoDayConsolidatedExcel(opts: {
  dayKey?: string;
  dayLabel?: string;
  shifts: TalladoShift[];
  units: TalladoUnit[];
  pauses: TalladoPause[];
}) {
  const data = prepareTalladoDayConsolidated(opts);
  const dayLabel = opts.dayLabel || data.dayKey;

  const resumen = [
    { Campo: 'Día', Valor: dayLabel },
    { Campo: 'DayKey', Valor: data.dayKey },
    { Campo: 'Turnos', Valor: data.shifts.length },
    { Campo: 'Personas (suma turnos)', Valor: data.metrics.peopleTotal },
    { Campo: 'Cantidad cerrada', Valor: data.metrics.qty },
    { Campo: 'Unidades cerradas', Valor: data.done.length },
    { Campo: 'Unidades en proceso', Valor: data.inProg.length },
    { Campo: 'Jornada neta', Valor: fmtDuration(data.metrics.workedMsTotal) },
    { Campo: 'Fórmula jornada', Valor: data.metrics.formulaLabel },
    { Campo: 'Persona·horas', Valor: Number(data.metrics.personHours.toFixed(2)) },
    { Campo: 'Rendimiento (cant/persona·h)', Valor: Number(data.metrics.perPersonHour.toFixed(2)) },
    { Campo: 'Detalle rendimiento', Valor: `${data.metrics.qty} ÷ ${data.metrics.personHours.toFixed(2)}` },
    { Campo: 'Pausas', Valor: fmtDuration(data.pauseMs) },
  ];

  const porHora = Array.from(data.byHour.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([h, v]) => ({
      Hora: `${String(h).padStart(2, '0')}:00`,
      Cantidad: v.qty,
      Unidades: v.units,
      'Pausa (min)': v.pauseMin,
    }));

  const marcas = Array.from(data.byMarca.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([marca, cant]) => ({ Marca: marca, Cantidad: cant }));

  const turnos = data.shifts.map((s) => ({
    Grupo: s.grupo,
    Personas: s.peopleCount,
    Estado: s.status,
    Operario: s.userName,
    Inicio: fmtLocal(s.startedAt),
    Fin: fmtLocal(s.endedAt),
  }));

  const unidades = data.units.map((u) => ({
    Grupo: u.grupo,
    Código: u.scanCode,
    TF: u.numeroTF,
    Referencia: u.referencia || '',
    Talla: u.talla || '',
    Cantidad: u.cantidad,
    Marca: reportMarca(u),
    Destino: reportDestino(u),
    Origen: u.source || '',
    Estado: u.status,
    Inicio: fmtLocal(u.startedAt),
    Fin: fmtLocal(u.endedAt),
    'Duración bruta': fmtDuration(u.durationMs),
    'Duración neta': fmtDuration(u.durationNetMs ?? u.durationMs),
    Operario: u.userName,
  }));

  const pausas = data.pauses.map((p) => ({
    Grupo: p.grupo,
    Tipo: PAUSE_LABELS[p.type] || p.type,
    Nota: p.note || '',
    Inicio: fmtLocal(p.pausedAt),
    Fin: fmtLocal(p.resumedAt),
    Duración: fmtDuration(p.durationMs),
    Estado: p.status,
    Operario: p.userName,
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumen), 'Resumen');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(porHora.length ? porHora : [{ Hora: '—' }]), 'Por hora');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(marcas.length ? marcas : [{ Marca: '—' }]), 'Marcas');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(turnos.length ? turnos : [{ Grupo: '—' }]), 'Turnos');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(unidades.length ? unidades : [{ Código: '—' }]), 'Unidades');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pausas.length ? pausas : [{ Tipo: '—' }]), 'Pausas');

  XLSX.writeFile(wb, `tallado_dia_consolidado_${data.dayKey}.xlsx`);
  return { success: true as const, dayKey: data.dayKey, units: data.units.length, shifts: data.shifts.length };
}

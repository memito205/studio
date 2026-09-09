import type { TalladoPause, TalladoShift, TalladoUnit } from '@/types';

export function talladoLocalDayKey(d: Date = new Date()): string {
  // Bodega opera en Colombia; no usar timezone del server (UTC en Vercel).
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Compara ISO/fecha contra dayKey en America/Bogota. */
export function isTalladoSameLocalDay(iso: string | undefined | null, dayKey: string): boolean {
  if (!iso) return false;
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return String(iso).startsWith(dayKey);
  return talladoLocalDayKey(d) === dayKey;
}

/** Inicio/fin del día calendario en America/Bogota (Colombia UTC-5, sin DST). */
export function talladoBogotaDayBounds(dayKey: string): { startMs: number; endMs: number } {
  const startMs = new Date(`${dayKey}T00:00:00.000-05:00`).getTime();
  const endMs = new Date(`${dayKey}T23:59:59.999-05:00`).getTime();
  return { startMs, endMs };
}

function parseMs(iso?: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

export function fmtTalladoClock(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString('es-CO', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'America/Bogota',
    });
  } catch {
    return '—';
  }
}

/**
 * Ventana de jornada del turno en un día.
 * Prioridad de inicio:
 * 1) productivityStartedAt (admin)
 * 2) primera unidad leída ese día
 * 3) startedAt del turno solo si es ese mismo día
 * Nunca usar 00:00 del calendario por defecto.
 */
export function talladoShiftDayWindow(opts: {
  shift: TalladoShift;
  units?: TalladoUnit[];
  dayKey?: string;
  nowMs?: number;
}): { startMs: number; endMs: number; startSource: 'admin' | 'primera_lectura' | 'turno' } | null {
  const nowMs = opts.nowMs ?? Date.now();
  const shiftStart = parseMs(opts.shift.startedAt);
  if (shiftStart == null) return null;

  const shiftEnd =
    opts.shift.status === 'closed' && opts.shift.endedAt
      ? parseMs(opts.shift.endedAt) ?? nowMs
      : nowMs;

  if (!opts.dayKey) {
    const adminStart = parseMs(opts.shift.productivityStartedAt);
    return {
      startMs: adminStart ?? shiftStart,
      endMs: Math.max(adminStart ?? shiftStart, shiftEnd),
      startSource: adminStart ? 'admin' : 'turno',
    };
  }

  const { startMs: dayStart, endMs: dayEnd } = talladoBogotaDayBounds(opts.dayKey);
  const cappedEnd = Math.min(shiftEnd, dayEnd, nowMs);

  const dayUnits = (opts.units || []).filter((u) => {
    // Prefer shiftId; if missing/mismatched, still use same grupo on this day
    // so jornada starts at first scan (not calendar 00:00).
    const sameShift = u.shiftId === opts.shift.id;
    const sameGrupo = u.grupo === opts.shift.grupo;
    if (!sameShift && !sameGrupo) return false;
    return (
      isTalladoSameLocalDay(u.startedAt, opts.dayKey!) ||
      isTalladoSameLocalDay(u.endedAt, opts.dayKey!)
    );
  });

  let firstUnitMs: number | null = null;
  let lastUnitMs: number | null = null;
  for (const u of dayUnits) {
    const s = parseMs(u.startedAt);
    const e = parseMs(u.endedAt || u.startedAt);
    if (s != null) firstUnitMs = firstUnitMs == null ? s : Math.min(firstUnitMs, s);
    if (e != null) lastUnitMs = lastUnitMs == null ? e : Math.max(lastUnitMs, e);
  }

  const adminStartRaw = parseMs(opts.shift.productivityStartedAt);

  let windowStart: number;
  let startSource: 'admin' | 'primera_lectura' | 'turno';

  if (adminStartRaw != null) {
    windowStart = Math.min(Math.max(adminStartRaw, dayStart), cappedEnd);
    startSource = 'admin';
  } else if (firstUnitMs != null) {
    windowStart = Math.max(firstUnitMs, dayStart);
    startSource = 'primera_lectura';
  } else if (isTalladoSameLocalDay(opts.shift.startedAt, opts.dayKey)) {
    windowStart = Math.max(shiftStart, dayStart);
    startSource = 'turno';
  } else {
    return null;
  }

  let windowEnd = cappedEnd;
  if (lastUnitMs != null && opts.shift.status === 'closed') {
    windowEnd = Math.min(windowEnd, Math.max(lastUnitMs, windowStart));
  }

  if (windowEnd <= windowStart) return null;
  return { startMs: windowStart, endMs: windowEnd, startSource };
}

/**
 * Jornada neta (ms) = ventana del día − pausas que solapan esa ventana.
 */
export function talladoShiftWorkedMs(
  shift: TalladoShift,
  pauses: TalladoPause[],
  nowMs: number = Date.now(),
  dayKey?: string,
  units?: TalladoUnit[]
): number {
  const window = talladoShiftDayWindow({ shift, units, dayKey, nowMs });
  if (!window) return 0;

  let raw = Math.max(0, window.endMs - window.startMs);

  for (const p of pauses) {
    if (p.shiftId !== shift.id) continue;

    const ps = parseMs(p.pausedAt);
    if (ps == null) continue;
    const pe =
      p.status === 'open'
        ? window.endMs
        : p.resumedAt
          ? parseMs(p.resumedAt) ?? window.endMs
          : typeof p.durationMs === 'number'
            ? ps + Math.max(0, Number(p.durationMs) || 0)
            : window.endMs;

    const a = Math.max(ps, window.startMs);
    const b = Math.min(pe, window.endMs);
    if (b > a) raw -= b - a;
  }

  return Math.max(0, raw);
}

export function talladoPauseMs(pauses: TalladoPause[], dayKey?: string): number {
  return pauses.reduce((s, p) => {
    if (dayKey && !isTalladoSameLocalDay(p.pausedAt, dayKey) && p.status !== 'open') {
      return s;
    }
    if (dayKey && p.status === 'open' && !isTalladoSameLocalDay(p.pausedAt, dayKey)) {
      // pausa abierta de otro día: el solape se descuenta en talladoShiftWorkedMs
      return s;
    }
    if (typeof p.durationMs === 'number' && Number.isFinite(p.durationMs)) {
      return s + Math.max(0, Number(p.durationMs) || 0);
    }
    if (p.status === 'open' && p.pausedAt) {
      const ps = parseMs(p.pausedAt);
      if (ps != null) return s + Math.max(0, Date.now() - ps);
    }
    return s;
  }, 0);
}

/**
 * Solo unidades leídas/cerradas ese día + turnos relacionados.
 * No arrastra histórico de turnos active de otros días.
 */
export function filterTalladoBundleToDay(
  dayKey: string,
  shifts: TalladoShift[],
  units: TalladoUnit[],
  pauses: TalladoPause[]
): { shifts: TalladoShift[]; units: TalladoUnit[]; pauses: TalladoPause[]; dayKey: string } {
  const dayUnits = units.filter(
    (u) => isTalladoSameLocalDay(u.startedAt, dayKey) || isTalladoSameLocalDay(u.endedAt, dayKey)
  );
  const unitShiftIds = new Set(dayUnits.map((u) => u.shiftId).filter(Boolean) as string[]);

  const dayShifts = shifts.filter(
    (s) => isTalladoSameLocalDay(s.startedAt, dayKey) || unitShiftIds.has(s.id)
  );
  const shiftIds = new Set(dayShifts.map((s) => s.id));

  const dayPauses = pauses.filter(
    (p) =>
      (p.shiftId && shiftIds.has(p.shiftId) && isTalladoSameLocalDay(p.pausedAt, dayKey)) ||
      isTalladoSameLocalDay(p.pausedAt, dayKey) ||
      (p.status === 'open' && p.shiftId && shiftIds.has(p.shiftId))
  );

  return { dayKey, shifts: dayShifts, units: dayUnits, pauses: dayPauses };
}

export type TalladoProductivityBreakdown = {
  personHours: number;
  peopleTotal: number;
  workedMsTotal: number;
  formulaLabel: string;
  shiftRows: Array<{
    shiftId: string;
    grupo: string;
    people: number;
    startClock: string;
    endClock: string;
    startSource: 'admin' | 'primera_lectura' | 'turno';
    workedMs: number;
    personHours: number;
  }>;
};

/**
 * Persona·horas del día = Σ (jornada_neta_del_día_turno_h × personas_turno).
 * Rendimiento = cantidad_cerrada_del_día ÷ persona·horas
 */
export function talladoPersonHours(opts: {
  shifts: TalladoShift[];
  units?: TalladoUnit[];
  pauses?: TalladoPause[];
  nowMs?: number;
  dayKey?: string;
}): TalladoProductivityBreakdown {
  const pauses = opts.pauses || [];
  const units = opts.units || [];
  const nowMs = opts.nowMs ?? Date.now();
  let personHours = 0;
  let peopleTotal = 0;
  let workedMsTotal = 0;
  const shiftRows: TalladoProductivityBreakdown['shiftRows'] = [];

  for (const sh of opts.shifts) {
    const people = Math.max(1, Number(sh.peopleCount) || 1);
    const window = talladoShiftDayWindow({
      shift: sh,
      units,
      dayKey: opts.dayKey,
      nowMs,
    });
    if (!window) continue;

    const workedMs = talladoShiftWorkedMs(sh, pauses, nowMs, opts.dayKey, units);
    if (workedMs <= 0) continue;

    const ph = (workedMs / 3600000) * people;
    peopleTotal += people;
    workedMsTotal += workedMs;
    personHours += ph;
    shiftRows.push({
      shiftId: sh.id,
      grupo: sh.grupo,
      people,
      startClock: fmtTalladoClock(window.startMs),
      endClock: fmtTalladoClock(window.endMs),
      startSource: window.startSource,
      workedMs,
      personHours: ph,
    });
  }

  const formulaLabel =
    shiftRows.length === 0
      ? 'Sin jornada del día'
      : shiftRows.length === 1
        ? `Jornada ${shiftRows[0].startClock}→${shiftRows[0].endClock} (${shiftRows[0].startSource}) × ${shiftRows[0].people} pers.`
        : `${shiftRows.length} turnos: Σ (jornada_turno × personas)`;

  return { personHours, peopleTotal, workedMsTotal, formulaLabel, shiftRows };
}

export function talladoPerPersonHour(opts: {
  shifts: TalladoShift[];
  units: TalladoUnit[];
  pauses?: TalladoPause[];
  nowMs?: number;
  dayKey?: string;
}): {
  qty: number;
  personHours: number;
  perPersonHour: number;
  peopleTotal: number;
  workedMsTotal: number;
  formulaLabel: string;
  shiftRows: TalladoProductivityBreakdown['shiftRows'];
} {
  const dayKey = opts.dayKey;
  const units = dayKey
    ? opts.units.filter(
        (u) => isTalladoSameLocalDay(u.startedAt, dayKey) || isTalladoSameLocalDay(u.endedAt, dayKey)
      )
    : opts.units;
  const done = units.filter((u) => u.status === 'done');
  const qty = done.reduce((s, u) => s + (Number(u.cantidad) || 0), 0);
  const breakdown = talladoPersonHours({
    shifts: opts.shifts,
    units,
    pauses: opts.pauses,
    nowMs: opts.nowMs,
    dayKey,
  });
  return {
    qty,
    personHours: breakdown.personHours,
    perPersonHour: breakdown.personHours > 0 ? qty / breakdown.personHours : 0,
    peopleTotal: breakdown.peopleTotal,
    workedMsTotal: breakdown.workedMsTotal,
    formulaLabel: breakdown.formulaLabel,
    shiftRows: breakdown.shiftRows,
  };
}

export function talladoRankingByGrupo(opts: {
  shifts: TalladoShift[];
  units: TalladoUnit[];
  pauses?: TalladoPause[];
  nowMs?: number;
  dayKey?: string;
}): Array<{ name: string; units: number; productivity: number; meta: string; people: number }> {
  const dayKey = opts.dayKey;
  const done = opts.units.filter((u) => {
    if (u.status !== 'done') return false;
    if (!dayKey) return true;
    return isTalladoSameLocalDay(u.startedAt, dayKey) || isTalladoSameLocalDay(u.endedAt, dayKey);
  });
  const pauses = opts.pauses || [];
  const nowMs = opts.nowMs ?? Date.now();

  const qtyByShift = new Map<string, number>();
  for (const u of done) {
    const sid = u.shiftId || '_none';
    qtyByShift.set(sid, (qtyByShift.get(sid) || 0) + (Number(u.cantidad) || 0));
  }

  const byGrupo = new Map<
    string,
    { qty: number; personHours: number; people: number; userName: string }
  >();

  for (const sh of opts.shifts) {
    const people = Math.max(1, Number(sh.peopleCount) || 1);
    const workedMs = talladoShiftWorkedMs(sh, pauses, nowMs, dayKey, opts.units);
    if (workedMs <= 0) continue;
    const personHours = (workedMs / 3600000) * people;
    const qty = qtyByShift.get(sh.id) || 0;
    const prev = byGrupo.get(sh.grupo) || {
      qty: 0,
      personHours: 0,
      people: 0,
      userName: sh.userName || sh.grupo,
    };
    prev.qty += qty;
    prev.personHours += personHours;
    prev.people += people;
    prev.userName = sh.userName || prev.userName;
    byGrupo.set(sh.grupo, prev);
  }

  return Array.from(byGrupo.entries())
    .map(([grupo, v]) => ({
      name: grupo,
      units: v.qty,
      productivity: v.personHours > 0 ? v.qty / v.personHours : 0,
      people: v.people,
      meta: `${v.people} pers. · ${v.userName}`,
    }))
    .filter((r) => r.units > 0 || r.productivity > 0)
    .sort((a, b) => b.productivity - a.productivity || b.units - a.units);
}

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

/**
 * Jornada del turno recortada al día (reloj):
 * max(inicioTurno, 00:00 día) → min(fin|ahora, 23:59 día) − pausas en esa ventana.
 */
export function talladoShiftWorkedMs(
  shift: TalladoShift,
  pauses: TalladoPause[],
  nowMs: number = Date.now(),
  dayKey?: string
): number {
  const shiftStart = parseMs(shift.startedAt);
  if (shiftStart == null) return 0;
  const shiftEnd =
    shift.status === 'closed' && shift.endedAt
      ? parseMs(shift.endedAt) ?? nowMs
      : nowMs;

  let windowStart = shiftStart;
  let windowEnd = shiftEnd;
  if (dayKey) {
    const { startMs, endMs } = talladoBogotaDayBounds(dayKey);
    const dayEnd = Math.min(endMs, nowMs);
    windowStart = Math.max(shiftStart, startMs);
    windowEnd = Math.min(shiftEnd, dayEnd);
  }

  let raw = Math.max(0, windowEnd - windowStart);
  if (raw <= 0) return 0;

  for (const p of pauses) {
    if (p.shiftId !== shift.id) continue;

    const ps = parseMs(p.pausedAt);
    if (ps == null) continue;
    const pe =
      p.status === 'open'
        ? windowEnd
        : p.resumedAt
          ? parseMs(p.resumedAt) ?? windowEnd
          : typeof p.durationMs === 'number'
            ? ps + Math.max(0, Number(p.durationMs) || 0)
            : windowEnd;

    const a = Math.max(ps, windowStart);
    const b = Math.min(pe, windowEnd);
    if (b > a) raw -= b - a;
  }

  return Math.max(0, raw);
}

export function talladoPauseMs(pauses: TalladoPause[], dayKey?: string): number {
  return pauses.reduce((s, p) => {
    if (dayKey && !isTalladoSameLocalDay(p.pausedAt, dayKey) && p.status !== 'open') {
      // open pauses may have started previous day; still count overlap via shift worked
      if (!isTalladoSameLocalDay(p.pausedAt, dayKey)) return s;
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
  // Unidades del día = inicio o fin en ese dayKey (Bogotá)
  const dayUnits = units.filter(
    (u) => isTalladoSameLocalDay(u.startedAt, dayKey) || isTalladoSameLocalDay(u.endedAt, dayKey)
  );
  const unitShiftIds = new Set(dayUnits.map((u) => u.shiftId).filter(Boolean) as string[]);

  // Turnos: empezaron ese día O tienen unidades de ese día
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

/**
 * Persona·horas del día = Σ (jornada_neta_del_día_turno_h × personas_turno).
 */
export function talladoPersonHours(opts: {
  shifts: TalladoShift[];
  pauses?: TalladoPause[];
  nowMs?: number;
  dayKey?: string;
}): { personHours: number; peopleTotal: number; workedMsTotal: number } {
  const pauses = opts.pauses || [];
  const nowMs = opts.nowMs ?? Date.now();
  let personHours = 0;
  let peopleTotal = 0;
  let workedMsTotal = 0;

  for (const sh of opts.shifts) {
    const people = Math.max(1, Number(sh.peopleCount) || 1);
    const workedMs = talladoShiftWorkedMs(sh, pauses, nowMs, opts.dayKey);
    if (workedMs <= 0 && opts.dayKey && !isTalladoSameLocalDay(sh.startedAt, opts.dayKey)) {
      // turno de otro día sin solape real en la ventana → no suma personas
      continue;
    }
    peopleTotal += people;
    workedMsTotal += workedMs;
    personHours += (workedMs / 3600000) * people;
  }

  return { personHours, peopleTotal, workedMsTotal };
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
} {
  const dayKey = opts.dayKey;
  const units = dayKey
    ? opts.units.filter(
        (u) => isTalladoSameLocalDay(u.startedAt, dayKey) || isTalladoSameLocalDay(u.endedAt, dayKey)
      )
    : opts.units;
  const done = units.filter((u) => u.status === 'done');
  const qty = done.reduce((s, u) => s + (Number(u.cantidad) || 0), 0);
  const { personHours, peopleTotal, workedMsTotal } = talladoPersonHours({
    shifts: opts.shifts,
    pauses: opts.pauses,
    nowMs: opts.nowMs,
    dayKey,
  });
  return {
    qty,
    personHours,
    perPersonHour: personHours > 0 ? qty / personHours : 0,
    peopleTotal,
    workedMsTotal,
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
    const workedMs = talladoShiftWorkedMs(sh, pauses, nowMs, dayKey);
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

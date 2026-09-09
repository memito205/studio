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

function parseMs(iso?: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Jornada trabajada del turno (reloj): fin|ahora − inicio − pausas.
 * NO usa la suma de tiempos de cajas.
 */
export function talladoShiftWorkedMs(
  shift: TalladoShift,
  pauses: TalladoPause[],
  nowMs: number = Date.now()
): number {
  const start = parseMs(shift.startedAt);
  if (start == null) return 0;
  const end =
    shift.status === 'closed' && shift.endedAt
      ? parseMs(shift.endedAt) ?? nowMs
      : nowMs;
  let raw = Math.max(0, end - start);

  for (const p of pauses) {
    if (p.shiftId !== shift.id) continue;

    if (p.status !== 'open' && typeof p.durationMs === 'number' && Number.isFinite(p.durationMs)) {
      raw -= Math.max(0, Number(p.durationMs) || 0);
      continue;
    }

    const ps = parseMs(p.pausedAt);
    if (ps == null) continue;
    const pe =
      p.resumedAt != null
        ? parseMs(p.resumedAt) ?? end
        : p.status === 'open'
          ? end
          : end;
    const a = Math.max(ps, start);
    const b = Math.min(pe, end);
    if (b > a) raw -= b - a;
  }

  return Math.max(0, raw);
}

export function talladoPauseMs(pauses: TalladoPause[]): number {
  return pauses.reduce((s, p) => {
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

/** Deja solo turnos/unidades/pausas del día (America/Bogota). */
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
    (s) =>
      isTalladoSameLocalDay(s.startedAt, dayKey) ||
      (s.status === 'active' && unitShiftIds.has(s.id)) ||
      unitShiftIds.has(s.id)
  );
  const shiftIds = new Set(dayShifts.map((s) => s.id));

  const dayPauses = pauses.filter(
    (p) => shiftIds.has(p.shiftId) || isTalladoSameLocalDay(p.pausedAt, dayKey)
  );

  // Unidades del día: preferir las ligadas a turnos del día + las fechadas hoy
  const filteredUnits = dayUnits.filter(
    (u) => !u.shiftId || shiftIds.has(u.shiftId) || isTalladoSameLocalDay(u.startedAt, dayKey)
  );

  return { dayKey, shifts: dayShifts, units: filteredUnits, pauses: dayPauses };
}

/**
 * Persona·horas = Σ (jornada_neta_turno_h × personas_turno).
 * Ejemplo: 7 personas desde 07:00 hasta 12:00 sin pausas → 5 × 7 = 35.
 */
export function talladoPersonHours(opts: {
  shifts: TalladoShift[];
  pauses?: TalladoPause[];
  nowMs?: number;
}): { personHours: number; peopleTotal: number; workedMsTotal: number } {
  const pauses = opts.pauses || [];
  const nowMs = opts.nowMs ?? Date.now();
  let personHours = 0;
  let peopleTotal = 0;
  let workedMsTotal = 0;

  for (const sh of opts.shifts) {
    const people = Math.max(1, Number(sh.peopleCount) || 1);
    const workedMs = talladoShiftWorkedMs(sh, pauses, nowMs);
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
}): {
  qty: number;
  personHours: number;
  perPersonHour: number;
  peopleTotal: number;
  workedMsTotal: number;
} {
  const done = opts.units.filter((u) => u.status === 'done');
  const qty = done.reduce((s, u) => s + (Number(u.cantidad) || 0), 0);
  const { personHours, peopleTotal, workedMsTotal } = talladoPersonHours({
    shifts: opts.shifts,
    pauses: opts.pauses,
    nowMs: opts.nowMs,
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
}): Array<{ name: string; units: number; productivity: number; meta: string; people: number }> {
  const done = opts.units.filter((u) => u.status === 'done');
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
    const workedMs = talladoShiftWorkedMs(sh, pauses, nowMs);
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

  // Unidades con shiftId desconocido: agrupar por grupo de la unidad con ventana min→max
  const knownIds = new Set(opts.shifts.map((s) => s.id));
  const orphanByGrupo = new Map<string, TalladoUnit[]>();
  for (const u of done) {
    if (u.shiftId && knownIds.has(u.shiftId)) continue;
    const g = u.grupo || 'SIN GRUPO';
    if (!orphanByGrupo.has(g)) orphanByGrupo.set(g, []);
    orphanByGrupo.get(g)!.push(u);
  }
  for (const [grupo, list] of orphanByGrupo.entries()) {
    const starts = list.map((u) => parseMs(u.startedAt)).filter((n): n is number => n != null);
    const ends = list
      .map((u) => parseMs(u.endedAt || u.startedAt))
      .filter((n): n is number => n != null);
    if (!starts.length || !ends.length) continue;
    const workedMs = Math.max(0, Math.max(...ends) - Math.min(...starts));
    const qty = list.reduce((s, u) => s + (Number(u.cantidad) || 0), 0);
    const prev = byGrupo.get(grupo) || {
      qty: 0,
      personHours: 0,
      people: 1,
      userName: list[0]?.userName || grupo,
    };
    prev.qty += qty;
    prev.personHours += workedMs / 3600000; // 1 persona si no hay turno
    byGrupo.set(grupo, prev);
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

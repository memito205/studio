import type { TalladoPause, TalladoShift, TalladoUnit } from '@/types';

/** Horas persona productivas del día: Σ (neto del turno × personas del turno). */
export function talladoPersonHours(opts: {
  shifts: TalladoShift[];
  units: TalladoUnit[];
}): number {
  const { shifts, units } = opts;
  const done = units.filter((u) => u.status === 'done');
  const byShift = new Map<string, number>();
  for (const u of done) {
    const sid = u.shiftId || '_';
    byShift.set(sid, (byShift.get(sid) || 0) + (Number(u.durationNetMs ?? u.durationMs) || 0));
  }

  let personHours = 0;
  const seen = new Set<string>();
  for (const sh of shifts) {
    seen.add(sh.id);
    const netMs = byShift.get(sh.id) || 0;
    const people = Math.max(1, Number(sh.peopleCount) || 1);
    personHours += (netMs / 3600000) * people;
  }
  // Unidades huérfanas (sin turno en la lista)
  for (const [sid, netMs] of byShift.entries()) {
    if (seen.has(sid)) continue;
    personHours += netMs / 3600000;
  }
  return personHours;
}

export function talladoPerPersonHour(opts: {
  shifts: TalladoShift[];
  units: TalladoUnit[];
}): { qty: number; personHours: number; perPersonHour: number; peopleTotal: number } {
  const done = opts.units.filter((u) => u.status === 'done');
  const qty = done.reduce((s, u) => s + (Number(u.cantidad) || 0), 0);
  const personHours = talladoPersonHours(opts);
  const peopleTotal = opts.shifts.reduce((s, sh) => s + (Number(sh.peopleCount) || 0), 0) || 0;
  return {
    qty,
    personHours,
    perPersonHour: personHours > 0 ? qty / personHours : 0,
    peopleTotal,
  };
}

export function talladoRankingByGrupo(opts: {
  shifts: TalladoShift[];
  units: TalladoUnit[];
}): Array<{ name: string; units: number; productivity: number; meta: string; people: number }> {
  const done = opts.units.filter((u) => u.status === 'done');
  const byGrupo = new Map<
    string,
    { qty: number; personHours: number; people: number; userName: string }
  >();

  const shiftById = new Map(opts.shifts.map((s) => [s.id, s]));

  // Acumular por turno y luego agrupar por nombre de grupo
  const byShift = new Map<string, { qty: number; netMs: number }>();
  for (const u of done) {
    const sid = u.shiftId || '_none';
    const prev = byShift.get(sid) || { qty: 0, netMs: 0 };
    prev.qty += Number(u.cantidad) || 0;
    prev.netMs += Number(u.durationNetMs ?? u.durationMs) || 0;
    byShift.set(sid, prev);
  }

  for (const [sid, v] of byShift.entries()) {
    const sh = shiftById.get(sid);
    const grupo = sh?.grupo || done.find((u) => u.shiftId === sid)?.grupo || 'SIN GRUPO';
    const people = Math.max(1, Number(sh?.peopleCount) || 1);
    const userName = sh?.userName || done.find((u) => u.shiftId === sid)?.userName || grupo;
    const personHours = (v.netMs / 3600000) * people;
    const prev = byGrupo.get(grupo) || { qty: 0, personHours: 0, people: 0, userName };
    prev.qty += v.qty;
    prev.personHours += personHours;
    prev.people += people;
    prev.userName = userName;
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

export function talladoPauseMs(pauses: TalladoPause[]): number {
  return pauses.reduce((s, p) => s + (Number(p.durationMs) || 0), 0);
}

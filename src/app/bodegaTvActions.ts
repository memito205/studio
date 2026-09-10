'use server';

import { format } from 'date-fns';
import { loadHistoricalReports } from '@/app/actions';
import { listTalladoDashboard } from '@/app/talladoMercanciaActions';
import {
  getAllUserProfiles,
  getLabelingHistoricalData,
  getScannedItemsByReception,
  loadReceptionOperations,
} from '@/app/reception/actions';
import { listRemainderAssignmentBoard } from '@/app/distributionCompareActions';
import type {
  BodegaTvAreaKey,
  BodegaTvAreaSnapshot,
  BodegaTvRemainderAssignmentRow,
  BodegaTvSnapshot,
} from '@/lib/bodegaTvTypes';
import {
  filterTalladoBundleToDay,
  talladoLocalDayKey,
  talladoPauseMs,
  talladoPerPersonHour,
  talladoRankingByGrupo,
} from '@/lib/talladoProductivity';

function todayKeyLocal(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

function isSameLocalDay(value: unknown, dayKey: string): boolean {
  if (!value) return false;
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return false;
  return format(d, 'yyyy-MM-dd') === dayKey;
}

function normalizePersonLabel(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

function buildUidByNormName(nameByUid: Map<string, string>): Map<string, string> {
  const uidByNormName = new Map<string, string>();
  for (const [uid, name] of nameByUid) {
    const n = normalizePersonLabel(name || '');
    if (n) uidByNormName.set(n, uid);
    if (name?.includes('@')) {
      const local = normalizePersonLabel(name.split('@')[0].replace(/[._]/g, ' '));
      if (local) uidByNormName.set(local, uid);
    }
  }
  return uidByNormName;
}

function personKeyFromUid(uid: string): string {
  return `uid:${uid}`;
}

function personKeyFromName(name: string, uidByNormName: Map<string, string>): string {
  const n = normalizePersonLabel(name);
  if (!n) return `name:DESCONOCIDO`;
  const uid = uidByNormName.get(n);
  if (uid) return personKeyFromUid(uid);
  return `name:${n}`;
}

function emptyArea(key: BodegaTvAreaKey, title: string): BodegaTvAreaSnapshot {
  return {
    key,
    title,
    units: 0,
    operators: 0,
    productivity: 0,
    compliance: undefined,
    ranking: [],
    extras: [],
    peopleKeys: [],
    anonymousPeople: 0,
  };
}

/**
 * Recursos únicos: personas identificadas sin repetir + cupo anónimo de tallado
 * (peopleCount − operario del turno ya nominado).
 */
function countUniqueResources(areas: BodegaTvAreaSnapshot[]): number {
  const named = new Set<string>();
  let anonymous = 0;
  for (const area of areas) {
    for (const key of area.peopleKeys || []) {
      if (key) named.add(key);
    }
    anonymous += Math.max(0, area.anonymousPeople || 0);
  }
  return named.size + anonymous;
}

async function buildEmpaque(
  dayKey: string,
  uidByNormName: Map<string, string>
): Promise<BodegaTvAreaSnapshot> {
  const area = emptyArea('empaque', 'Empaque');
  try {
    const { data, error } = await loadHistoricalReports({ startDate: dayKey, endDate: dayKey });
    if (error || !data?.length) return area;

    const withPackers = data.filter((r) => (r.packerProductivity?.length || 0) > 0);
    const pool = withPackers.length ? withPackers : data;

    // KPIs agregados: consolidado más reciente / con más unidades; no el primero a ciegas.
    const ranked = [...pool].sort((a, b) => {
      const c = Number(!!b.isConsolidated) - Number(!!a.isConsolidated);
      if (c !== 0) return c;
      const q = (b.totalQuantity || 0) - (a.totalQuantity || 0);
      if (q !== 0) return q;
      return (b.operatorCount || 0) - (a.operatorCount || 0);
    });
    const report = ranked[0];
    if (!report) return area;

    // Personas: unión de todos los cortes del día (evita quedar en 5 si otro corte trae 7).
    const byName = new Map<
      string,
      {
        packerName: string;
        totalQuantity: number;
        productivity: number;
        compliance: number;
      }
    >();
    for (const r of pool) {
      for (const p of r.packerProductivity || []) {
        const name = String(p.packerName || '').trim();
        if (!name) continue;
        const key = normalizePersonLabel(name);
        const prev = byName.get(key);
        if (!prev || (p.totalQuantity || 0) >= prev.totalQuantity) {
          byName.set(key, {
            packerName: name,
            totalQuantity: p.totalQuantity || 0,
            productivity: p.productivity || 0,
            compliance: p.compliance || 0,
          });
        }
      }
      for (const n of r.operatorNames || []) {
        const name = String(n || '').trim();
        if (!name) continue;
        const key = normalizePersonLabel(name);
        if (!byName.has(key)) {
          byName.set(key, {
            packerName: name,
            totalQuantity: 0,
            productivity: 0,
            compliance: 0,
          });
        }
      }
    }

    const packers = [...byName.values()].sort((a, b) => {
      if (b.compliance !== a.compliance) return b.compliance - a.compliance;
      return b.productivity - a.productivity;
    });

    area.units = report.totalQuantity || packers.reduce((s, p) => s + (p.totalQuantity || 0), 0);
    area.operators = packers.length || report.operatorCount || 0;
    area.productivity = report.avgProductivity || 0;
    {
      const weight = packers.reduce((s, p) => s + (p.totalQuantity || 0), 0);
      area.compliance =
        weight > 0
          ? packers.reduce((s, p) => s + (p.compliance || 0) * (p.totalQuantity || 0), 0) / weight
          : report.overallCompliance;
    }
    area.ranking = packers.map((p) => ({
      name: p.packerName,
      units: p.totalQuantity || 0,
      productivity: p.productivity || 0,
      compliance: p.compliance,
    }));
    area.peopleKeys = packers.map((p) => personKeyFromName(p.packerName, uidByNormName));
    area.extras = [
      { label: 'Horas', value: `${(report.totalHours || 0).toFixed(1)} h` },
      { label: 'Fuente', value: report.isConsolidated ? 'Consolidado' : 'Mejor corte del día' },
      { label: 'Pers. (unión día)', value: String(area.operators) },
    ];
  } catch (e) {
    console.error('bodegaTv empaque:', e);
  }
  return area;
}

async function buildEtiquetado(
  dayKey: string,
  nameByUid: Map<string, string>,
  uidByNormName: Map<string, string>
): Promise<BodegaTvAreaSnapshot> {
  const area = emptyArea('etiquetado', 'Etiquetado');
  try {
    const { summarizePackPlanProgress } = await import('@/lib/labelingPackPlan');
    const { labelingUnitsForProductivity } = await import('@/lib/labelingProductivity');

    const day = new Date(`${dayKey}T12:00:00`);
    const result = await getLabelingHistoricalData({ from: day, to: day });
    if (!result.success || !result.data) return area;

    const { summary, employeePerformance, operations } = result.data;

    // Base histórica: solo FINISH (completadas).
    const finishUnits = summary.totalUnits || 0;

    // LIVE: tareas pack_units abiertas hoy (En Progreso / Pausada).
    const activeOps = (operations || []).filter(
      (op) => op.status === 'En Progreso' || op.status === 'Pausada'
    );
    const packActive = activeOps.filter(
      (op) => op.trackingMode === 'pack_units' && (op.labelingPackPlan?.length || 0) > 0
    );

    let liveUnits = 0;
    let confirmedBoxes = 0;
    let totalBoxes = 0;
    for (const op of packActive) {
      liveUnits += Number(op.completedUnitsLive) || 0;
      const prog = summarizePackPlanProgress(op.labelingPackPlan);
      confirmedBoxes += prog.confirmedBoxes;
      totalBoxes += prog.totalBoxes;
    }

    // Refs finalizadas hoy sin seguimiento por caja (legacy_finish / sin trackingMode).
    const legacyRefsDone = new Set(
      (operations || [])
        .filter(
          (op) =>
            op.status === 'Completada' &&
            op.trackingMode !== 'pack_units' &&
            (isSameLocalDay(op.updatedAt, dayKey) || isSameLocalDay(op.createdAt, dayKey))
        )
        .map((op) => `${op.receptionOperationId || ''}|${op.reference}`)
    );

    // Refs finalizadas pack_units (sesión cerrada hoy).
    const packRefsDone = new Set(
      (operations || [])
        .filter(
          (op) =>
            op.status === 'Completada' &&
            op.trackingMode === 'pack_units' &&
            (isSameLocalDay(op.updatedAt, dayKey) || isSameLocalDay(op.createdAt, dayKey))
        )
        .map((op) => `${op.receptionOperationId || ''}|${op.reference}`)
    );

    // Headline: finalizadas + progreso live (sin doble contar Completada).
    area.units = finishUnits + liveUnits;
    area.operators = employeePerformance.length;
    const activeMinutes = summary.totalActiveMinutes || 0;
    area.productivity =
      activeMinutes > 0 ? area.units / (activeMinutes / 60) : summary.conversionRate || summary.efficiency || 0;

    // Ranking: sumar und LIVE a operarios con tarea pack activa.
    const liveByOperator = new Map<string, number>();
    for (const op of packActive) {
      const key = op.isExternal
        ? op.assignedExternalOperatorName || op.assignedExternalVendorId || ''
        : op.assignedOperatorId || '';
      if (!key) continue;
      liveByOperator.set(key, (liveByOperator.get(key) || 0) + labelingUnitsForProductivity(op));
    }

    area.ranking = [...employeePerformance]
      .map((e) => {
        const liveAdd = liveByOperator.get(e.id) || liveByOperator.get(e.name) || 0;
        const units = (e.totalUnits || 0) + liveAdd;
        const minutes = e.activeMinutes || 0;
        const productivity = minutes > 0 ? units / (minutes / 60) : e.efficiency;
        const resolved =
          e.type === 'Interno' ? nameByUid.get(e.id) || nameByUid.get(e.name) || e.name : e.name;
        return {
          name: resolved,
          units,
          productivity,
          meta: e.type,
        };
      })
      .sort((a, b) => b.productivity - a.productivity || b.units - a.units);

    // Operarios solo en LIVE (aún sin FINISH en el día) → aparecer en ranking.
    for (const op of packActive) {
      const key = op.isExternal
        ? op.assignedExternalOperatorName || op.assignedExternalVendorId || ''
        : op.assignedOperatorId || '';
      if (!key) continue;
      const displayName = op.isExternal
        ? op.assignedExternalOperatorName || key
        : nameByUid.get(key) || key;
      const already = area.ranking.some(
        (r) => r.name === displayName || r.name === key
      );
      if (already) continue;
      const units = labelingUnitsForProductivity(op);
      if (units <= 0) continue;
      area.ranking.push({
        name: displayName,
        units,
        productivity: 0,
        meta: op.isExternal ? 'Externo' : 'Interno',
      });
      area.operators = Math.max(area.operators, area.ranking.length);
    }
    area.ranking.sort((a, b) => b.productivity - a.productivity || b.units - a.units);

    area.peopleKeys = employeePerformance.map((e) => {
      if (e.type === 'Interno' && e.id) return personKeyFromUid(e.id);
      return personKeyFromName(e.name || e.id, uidByNormName);
    });
    for (const op of packActive) {
      if (!op.isExternal && op.assignedOperatorId) {
        area.peopleKeys.push(personKeyFromUid(op.assignedOperatorId));
      } else if (op.assignedExternalOperatorName) {
        area.peopleKeys.push(personKeyFromName(op.assignedExternalOperatorName, uidByNormName));
      }
    }

    area.extras = [
      { label: 'Interno', value: String(summary.internalUnits || 0) },
      { label: 'Externo', value: String(summary.externalUnits || 0) },
      {
        label: 'Horas prod.',
        value: `${((summary.totalActiveMinutes || 0) / 60).toFixed(1)} h`,
      },
      {
        label: 'Und LIVE',
        value: String(liveUnits),
      },
      {
        label: 'Cajas',
        value: totalBoxes > 0 ? `${confirmedBoxes}/${totalBoxes}` : '—',
      },
      {
        label: 'Refs finalizadas',
        value: String(legacyRefsDone.size + packRefsDone.size),
      },
      {
        label: 'Refs legacy',
        value: String(legacyRefsDone.size),
      },
    ];
  } catch (e) {
    console.error('bodegaTv etiquetado:', e);
  }
  return area;
}

async function buildTallado(
  dayKey: string,
  uidByNormName: Map<string, string>
): Promise<BodegaTvAreaSnapshot> {
  const area = emptyArea('tallado', 'Tallado');
  try {
    const todayKey = dayKey || talladoLocalDayKey();
    const result = await listTalladoDashboard({ dayKey: todayKey });
    if (!result.success) return area;

    const filtered = filterTalladoBundleToDay(
      todayKey,
      result.shifts || [],
      result.units || [],
      result.pauses || []
    );
    const { shifts, units, pauses } = filtered;
    const done = units.filter((u) => u.status === 'done');
    const pauseMs = talladoPauseMs(pauses, todayKey);
    const { qty, personHours, perPersonHour, peopleTotal, workedMsTotal, formulaLabel, shiftRows } =
      talladoPerPersonHour({
        shifts,
        units,
        pauses,
        dayKey: todayKey,
      });
    const ranking = talladoRankingByGrupo({ shifts, units, pauses, dayKey: todayKey });

    const peopleKeys: string[] = [];
    let anonymousPeople = 0;
    for (const row of shiftRows) {
      const sh = shifts.find((s) => s.id === row.shiftId);
      const people = Math.max(1, row.people || 1);
      if (sh?.userId) {
        peopleKeys.push(personKeyFromUid(sh.userId));
        anonymousPeople += Math.max(0, people - 1);
      } else if (sh?.userName) {
        peopleKeys.push(personKeyFromName(sh.userName, uidByNormName));
        anonymousPeople += Math.max(0, people - 1);
      } else {
        anonymousPeople += people;
      }
    }

    area.units = qty;
    // Por área: headcount configurado (peopleCount), no cantidad de turnos.
    area.operators = peopleTotal;
    area.productivity = perPersonHour;
    area.ranking = ranking;
    area.peopleKeys = peopleKeys;
    area.anonymousPeople = anonymousPeople;
    area.extras = [
      { label: 'Día', value: todayKey },
      { label: 'Personas', value: String(peopleTotal) },
      { label: 'Grupos', value: String(shifts.length) },
      { label: 'Cajas hechas', value: String(done.length) },
      { label: 'Jornada', value: `${(workedMsTotal / 3600000).toFixed(1)} h` },
      { label: 'Cálculo', value: formulaLabel },
      { label: 'Pausas', value: `${Math.round(pauseMs / 60000)} min` },
      { label: 'Persona·h', value: personHours.toFixed(2) },
      {
        label: 'Rendimiento',
        value: `${qty} ÷ ${personHours.toFixed(2)} = ${perPersonHour.toFixed(1)} u/h`,
      },
    ];
  } catch (e) {
    console.error('bodegaTv tallado:', e);
  }
  return area;
}

async function buildRecepcion(
  dayKey: string,
  nameByUid: Map<string, string>
): Promise<BodegaTvAreaSnapshot> {
  const area = emptyArea('recepcion', 'Recepción');
  try {
    const opsResult = await loadReceptionOperations({ limit: 400 });
    if (!opsResult.success || !opsResult.data) return area;

    const todayOps = opsResult.data.operations.filter((op) => {
      if (op.status === 'in_progress' || op.status === 'paused') return true;
      return (
        isSameLocalDay(op.created_at, dayKey) ||
        isSameLocalDay(op.start_time, dayKey) ||
        isSameLocalDay(op.end_time, dayKey) ||
        isSameLocalDay(op.updated_at, dayKey)
      );
    });

    const completed = todayOps.filter((o) => o.status === 'completed').length;
    const inProgress = todayOps.filter(
      (o) => o.status === 'in_progress' || o.status === 'paused'
    ).length;

    const targetOps = todayOps
      .filter((o) => o.status !== 'cancelled' && o.status !== 'pending')
      .slice(0, 40);

    const scannedBatches = await Promise.all(
      targetOps.map(async (op) => {
        const res = await getScannedItemsByReception(op.id);
        return res.success && res.data ? res.data : [];
      })
    );

    const byUser = new Map<string, { units: number; first: number; last: number }>();
    let totalUnits = 0;
    let fillAcc = 0;
    let fillN = 0;

    for (let i = 0; i < targetOps.length; i++) {
      const op = targetOps[i];
      const items = scannedBatches[i].filter((it) => isSameLocalDay(it.scanned_at, dayKey));
      const opUnits = items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
      totalUnits += opUnits;
      if (op.expected_quantity > 0 && opUnits > 0) {
        fillAcc += Math.min(200, (opUnits / op.expected_quantity) * 100);
        fillN += 1;
      }
      for (const it of items) {
        const uid = it.user_id || 'sin-usuario';
        const ts = new Date(it.scanned_at).getTime();
        const prev = byUser.get(uid) || { units: 0, first: ts, last: ts };
        prev.units += Number(it.quantity) || 0;
        prev.first = Math.min(prev.first, ts);
        prev.last = Math.max(prev.last, ts);
        byUser.set(uid, prev);
      }
    }

    const ranking = Array.from(byUser.entries())
      .map(([uid, v]) => {
        const hours = Math.max((v.last - v.first) / 3600000, 1 / 60);
        return {
          name: nameByUid.get(uid) || uid,
          units: v.units,
          productivity: v.units / hours,
        };
      })
      .sort((a, b) => b.units - a.units || b.productivity - a.productivity);

    const totalProdHours = Array.from(byUser.values()).reduce((s, v) => {
      return s + Math.max((v.last - v.first) / 3600000, 1 / 60);
    }, 0);

    area.units = totalUnits;
    area.operators = byUser.size;
    area.productivity = totalProdHours > 0 ? totalUnits / totalProdHours : 0;
    area.compliance = undefined;
    area.ranking = ranking;
    area.peopleKeys = [...byUser.keys()]
      .filter((uid) => uid && uid !== 'sin-usuario')
      .map((uid) => personKeyFromUid(uid));
    area.extras = [
      { label: 'Completadas', value: String(completed) },
      { label: 'En curso', value: String(inProgress) },
      { label: 'Ops hoy', value: String(todayOps.length) },
      ...(fillN > 0
        ? [{ label: 'Avance lectura', value: `${(fillAcc / fillN).toFixed(0)}%` }]
        : []),
    ];
  } catch (e) {
    console.error('bodegaTv recepcion:', e);
  }
  return area;
}

function remainderStatusLabel(status: string): string {
  switch (status) {
    case 'assigned':
      return 'Asignada';
    case 'submitted':
      return 'Por validar';
    case 'validated':
      return 'Validada';
    case 'rejected':
      return 'Rechazada';
    default:
      return status;
  }
}

async function buildRemainderAssignments(
  dayKey: string
): Promise<BodegaTvRemainderAssignmentRow[]> {
  try {
    const res = await listRemainderAssignmentBoard(250);
    if (!res.success || !res.data) return [];

    const rows: BodegaTvRemainderAssignmentRow[] = [];
    for (const t of res.data) {
      const touchedToday =
        isSameLocalDay(t.assignedAt, dayKey) ||
        isSameLocalDay(t.submittedAt, dayKey) ||
        isSameLocalDay(t.validatedAt, dayKey) ||
        isSameLocalDay(t.updatedAt, dayKey);

      const show =
        t.status === 'assigned' ||
        t.status === 'submitted' ||
        t.status === 'rejected' ||
        (t.status === 'validated' && touchedToday);
      if (!show) continue;

      rows.push({
        operatorName: t.assignedOperatorName || t.assignedOperatorId || '—',
        reference: t.reference,
        rkIdentifier: t.rkIdentifier,
        locationName: t.locationName || undefined,
        expectedRemainderQty: Number(t.expectedRemainderQty) || 0,
        status: t.status,
        statusLabel: remainderStatusLabel(t.status),
      });
    }

    rows.sort((a, b) => {
      const op = a.operatorName.localeCompare(b.operatorName, 'es');
      if (op !== 0) return op;
      return a.reference.localeCompare(b.reference, 'es');
    });
    return rows;
  } catch (e) {
    console.error('bodegaTv remainderAssignments:', e);
    return [];
  }
}

/** Snapshot unificado del día para el Modo TV Bodega (sin auth de UI). */
export async function getBodegaTvSnapshot(): Promise<{
  success: boolean;
  data?: BodegaTvSnapshot;
  error?: string;
}> {
  try {
    const dayKey = todayKeyLocal();
    const profiles = await getAllUserProfiles();
    const nameByUid = new Map<string, string>();
    for (const u of profiles || []) {
      nameByUid.set(u.uid, u.displayName || u.email || u.uid);
    }
    const uidByNormName = buildUidByNormName(nameByUid);

    const [empaque, etiquetado, tallado, recepcion, remainderAssignments] = await Promise.all([
      buildEmpaque(dayKey, uidByNormName),
      buildEtiquetado(dayKey, nameByUid, uidByNormName),
      buildTallado(dayKey, uidByNormName),
      buildRecepcion(dayKey, nameByUid),
      buildRemainderAssignments(dayKey),
    ]);

    const areas = [empaque, etiquetado, tallado, recepcion];

    let complianceWeight = 0;
    let complianceSum = 0;
    for (const area of areas) {
      for (const row of area.ranking) {
        if (typeof row.compliance === 'number' && Number.isFinite(row.compliance)) {
          const w = Math.max(row.units, 1);
          complianceSum += row.compliance * w;
          complianceWeight += w;
        }
      }
    }
    if (complianceWeight <= 0) {
      for (const area of areas) {
        if (typeof area.compliance === 'number' && Number.isFinite(area.compliance) && area.units > 0) {
          complianceSum += area.compliance * area.units;
          complianceWeight += area.units;
        }
      }
    }

    const uniqueOperators = countUniqueResources(areas);

    const snapshot: BodegaTvSnapshot = {
      dayKey,
      generatedAt: new Date().toISOString(),
      areas,
      summary: {
        totalUnits: areas.reduce((s, a) => s + a.units, 0),
        avgCompliance: complianceWeight > 0 ? complianceSum / complianceWeight : 0,
        operators: uniqueOperators,
      },
      remainderAssignments,
    };

    return { success: true, data: snapshot };
  } catch (error: any) {
    console.error('getBodegaTvSnapshot:', error);
    return {
      success: false,
      error: error?.message || 'No se pudo construir el tablero de bodega.',
    };
  }
}

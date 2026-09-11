'use server';

import { format } from 'date-fns';
import { loadHistoricalReports, loadOperatorMappings } from '@/app/actions';
import { listTalladoDashboard } from '@/app/talladoMercanciaActions';
import {
  getAllUserProfiles,
  getLabelingHistoricalData,
  getScannedItemsByReception,
  loadReceptionOperations,
} from '@/app/reception/actions';
import {
  listRemainderAssignmentBoard,
  resolveReceptionLocationsForReferences,
} from '@/app/distributionCompareActions';
import type {
  BodegaTvAreaKey,
  BodegaTvAreaSnapshot,
  BodegaTvRemainderAssignmentRow,
  BodegaTvSnapshot,
  EtiquetadoContributionRow,
  EtiquetadoDayBreakdown,
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

/** Cédula / documento numérico (sin mapear a nombre). */
function looksLikeDocumentId(value: string): boolean {
  return /^\d{6,}$/.test(String(value || '').trim());
}

/**
 * Resuelve cédula → nombre vía maestro de empacadores.
 * Unifica filas cuando un corte guardó la cédula y otro el nombre.
 */
function resolvePackerDisplayName(
  raw: string,
  idToName: Record<string, string>,
  nameNormSet: Set<string>
): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  const direct = idToName[trimmed];
  if (direct) return String(direct).trim();
  const norm = normalizePersonLabel(trimmed);
  const byNormId = idToName[norm];
  if (byNormId) return String(byNormId).trim();
  // Ya es un nombre conocido del maestro (valor del mapa).
  if (nameNormSet.has(norm)) return trimmed;
  return trimmed;
}

function buildOperatorResolveMaps(mappings: Record<string, string> | undefined | null): {
  idToName: Record<string, string>;
  nameNormSet: Set<string>;
} {
  const idToName: Record<string, string> = {};
  const nameNormSet = new Set<string>();
  for (const [id, name] of Object.entries(mappings || {})) {
    const idTrim = String(id || '').trim();
    const nameTrim = String(name || '').trim();
    if (!idTrim || !nameTrim) continue;
    idToName[idTrim] = nameTrim;
    idToName[normalizePersonLabel(idTrim)] = nameTrim;
    nameNormSet.add(normalizePersonLabel(nameTrim));
  }
  return { idToName, nameNormSet };
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
    const [{ data, error }, mappingsResult] = await Promise.all([
      loadHistoricalReports({ startDate: dayKey, endDate: dayKey }),
      loadOperatorMappings(),
    ]);
    if (error || !data?.length) return area;

    const { idToName, nameNormSet } = buildOperatorResolveMaps(mappingsResult.data);

    const withPackers = data.filter((r) => (r.packerProductivity?.length || 0) > 0);
    const pool = withPackers.length ? withPackers : data;
    if (!pool.length) return area;

    // Un solo corte: el mismo que el usuario valida en histórico / último snapshot.
    // (Antes se unían TODOS los cortes del día → und/cumpl. mezclados y no cuadraban.)
    const snapshotMs = (r: (typeof pool)[number]) => {
      const v = r.snapshotCreatedAt;
      if (!v) return 0;
      const t = v instanceof Date ? v.getTime() : new Date(v as string).getTime();
      return Number.isFinite(t) ? t : 0;
    };
    const ranked = [...pool].sort((a, b) => {
      const c = Number(!!b.isConsolidated) - Number(!!a.isConsolidated);
      if (c !== 0) return c;
      const t = snapshotMs(b) - snapshotMs(a);
      if (t !== 0) return t;
      return (b.totalQuantity || 0) - (a.totalQuantity || 0);
    });
    const report = ranked[0];
    if (!report) return area;

    const byPerson = new Map<
      string,
      {
        packerName: string;
        totalQuantity: number;
        productivity: number;
        compliance: number;
      }
    >();

    for (const p of report.packerProductivity || []) {
      const raw = String(p.packerName || '').trim();
      if (!raw) continue;
      const resolved = resolvePackerDisplayName(raw, idToName, nameNormSet);
      if (!resolved) continue;
      const key = normalizePersonLabel(resolved);
      if (!key) continue;
      const prev = byPerson.get(key);
      const qty = p.totalQuantity || 0;
      if (!prev) {
        byPerson.set(key, {
          packerName: resolved,
          totalQuantity: qty,
          productivity: p.productivity || 0,
          compliance: p.compliance || 0,
        });
        continue;
      }
      // Misma persona dos veces en el mismo corte (cédula + nombre): sumar und y
      // quedarse con productividad/cumpl. del renglón con más und.
      const preferName =
        looksLikeDocumentId(prev.packerName) && !looksLikeDocumentId(resolved)
          ? resolved
          : prev.packerName;
      const nextQty = prev.totalQuantity + qty;
      const useNewMetrics = qty >= prev.totalQuantity;
      byPerson.set(key, {
        packerName: preferName,
        totalQuantity: nextQty,
        productivity: useNewMetrics ? p.productivity || 0 : prev.productivity,
        compliance: useNewMetrics ? p.compliance || 0 : prev.compliance,
      });
    }

    // Personas listadas en el corte sin fila de productividad.
    for (const n of report.operatorNames || []) {
      const raw = String(n || '').trim();
      if (!raw) continue;
      const resolved = resolvePackerDisplayName(raw, idToName, nameNormSet);
      if (!resolved) continue;
      const key = normalizePersonLabel(resolved);
      if (!key || byPerson.has(key)) continue;
      byPerson.set(key, {
        packerName: resolved,
        totalQuantity: 0,
        productivity: 0,
        compliance: 0,
      });
    }

    const packers = [...byPerson.values()].sort((a, b) => {
      if (b.compliance !== a.compliance) return b.compliance - a.compliance;
      return b.productivity - a.productivity;
    });

    const rankingUnits = packers.reduce((s, p) => s + (p.totalQuantity || 0), 0);
    // Preferir total del snapshot; si falta, suma del ranking (mismo corte).
    area.units = Number(report.totalQuantity) > 0 ? Number(report.totalQuantity) : rankingUnits;
    area.operators = packers.length || report.operatorCount || 0;
    area.productivity =
      Number(report.avgProductivity) > 0
        ? Number(report.avgProductivity)
        : report.totalHours > 0
          ? area.units / report.totalHours
          : 0;
    {
      const weight = rankingUnits;
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

    const snapLabel = (() => {
      const t = snapshotMs(report);
      if (!t) return report.isConsolidated ? 'Consolidado' : 'Último corte del día';
      return `${report.isConsolidated ? 'Consolidado' : 'Corte'} ${format(new Date(t), 'HH:mm')}`;
    })();

    area.extras = [
      { label: 'Horas', value: `${(report.totalHours || 0).toFixed(1)} h` },
      { label: 'Fuente', value: snapLabel },
      { label: 'Pers.', value: String(area.operators) },
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
    const { computeLabelingProductivity } = await import('@/lib/labelingProductivity');

    const day = new Date(`${dayKey}T12:00:00`);
    const result = await getLabelingHistoricalData({ from: day, to: day });
    if (!result.success || !result.data) return area;

    const { summary, employeePerformance, operations, logs } = result.data;
    const dayFromMs = new Date(`${dayKey}T00:00:00`).getTime();
    const dayToMs = new Date(`${dayKey}T23:59:59.999`).getTime();

    // Base histórica: solo FINISH del día (ya filtrado en getLabelingHistoricalData).
    const finishUnits = summary.totalUnits || 0;

    // LIVE: pack_units abiertas CON actividad de hoy (no arrastrar pausadas de ayer).
    const activeOps = (operations || []).filter(
      (op) => op.status === 'En Progreso' || op.status === 'Pausada'
    );
    const packActive = activeOps.filter((op) => {
      if (op.trackingMode !== 'pack_units' || !(op.labelingPackPlan?.length || 0)) return false;
      const opLogs = (logs || []).filter((l) => l.labelingOperationId === op.id);
      return opLogs.some(
        (l) =>
          isSameLocalDay(l.timestamp, dayKey) &&
          (l.type === 'START' ||
            l.type === 'RESUME' ||
            l.type === 'UNIT_COMPLETE' ||
            l.type === 'PAUSE')
      );
    });

    let liveUnits = 0;
    let confirmedBoxes = 0;
    let totalBoxes = 0;
    for (const op of packActive) {
      const opLogs = (logs || []).filter((l) => l.labelingOperationId === op.id);
      const unitCompleteToday = opLogs.filter(
        (l) => l.type === 'UNIT_COMPLETE' && isSameLocalDay(l.timestamp, dayKey)
      );
      const seenBox = new Set<string>();
      let unitsToday = 0;
      let boxesToday = 0;
      for (const l of unitCompleteToday) {
        const dedupeKey = l.packingUnitId
          ? `box:${l.packingUnitId}`
          : l.unitNumber != null
            ? `n:${l.unitNumber}`
            : `t:${l.timestamp}:${l.id || ''}`;
        if (seenBox.has(dedupeKey)) continue;
        seenBox.add(dedupeKey);
        unitsToday += Number(l.qty ?? l.completedUnits) || 0;
        boxesToday += 1;
      }
      liveUnits += unitsToday;
      const prog = summarizePackPlanProgress(op.labelingPackPlan);
      confirmedBoxes += boxesToday;
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

    // Métricas LIVE por operario (u/h y cumplimiento con reloj desde START − pausas).
    type LiveAgg = {
      units: number;
      minutes: number;
      standard: number;
      displayName: string;
      isExt: boolean;
    };
    const liveAggByKey = new Map<string, LiveAgg>();
    let liveProductiveMinutes = 0;

    for (const op of packActive) {
      const key = op.isExternal
        ? op.assignedExternalOperatorName || op.assignedExternalVendorId || ''
        : op.assignedOperatorId || '';
      if (!key) continue;

      const opLogs = (logs || []).filter((l) => l.labelingOperationId === op.id);
      const unitCompleteToday = opLogs.filter(
        (l) => l.type === 'UNIT_COMPLETE' && isSameLocalDay(l.timestamp, dayKey)
      );
      const seenBox = new Set<string>();
      let unitsToday = 0;
      for (const l of unitCompleteToday) {
        const dedupeKey = l.packingUnitId
          ? `box:${l.packingUnitId}`
          : l.unitNumber != null
            ? `n:${l.unitNumber}`
            : `t:${l.timestamp}:${l.id || ''}`;
        if (seenBox.has(dedupeKey)) continue;
        seenBox.add(dedupeKey);
        unitsToday += Number(l.qty ?? l.completedUnits) || 0;
      }
      const metrics = computeLabelingProductivity(opLogs, op, [], Date.now(), {
        fromMs: dayFromMs,
        toMs: dayToMs,
        unitsOverride: unitsToday,
      });
      const units = unitsToday;
      const minutes = metrics?.productiveTimeMinutes || 0;
      liveProductiveMinutes += minutes;

      const displayName = op.isExternal
        ? op.assignedExternalOperatorName || key
        : nameByUid.get(key) || key;

      const prev = liveAggByKey.get(key) || {
        units: 0,
        minutes: 0,
        standard: 0,
        displayName,
        isExt: Boolean(op.isExternal),
      };
      const prevUnits = prev.units;
      prev.units += units;
      prev.minutes += minutes;
      const std = Number(op.standard_units_per_hour) || 0;
      if (std > 0 && units > 0) {
        prev.standard = (prev.standard * prevUnits + std * units) / Math.max(prev.units, 1);
      } else if (std > 0 && prev.standard <= 0) {
        prev.standard = std;
      }
      liveAggByKey.set(key, prev);
    }

    // Headline: finalizadas + progreso live (sin doble contar Completada).
    area.units = finishUnits + liveUnits;
    const activeMinutes = (summary.totalActiveMinutes || 0) + liveProductiveMinutes;
    area.productivity =
      activeMinutes > 0
        ? area.units / (activeMinutes / 60)
        : summary.conversionRate || summary.efficiency || 0;

    // Estándar u/h por operario desde tareas del día (también FINISH legacy, no solo LIVE).
    const standardByKey = new Map<string, { weighted: number; weight: number }>();
    for (const op of operations || []) {
      const std = Number(op.standard_units_per_hour) || 0;
      if (std <= 0) continue;
      const key = op.isExternal
        ? op.assignedExternalOperatorName || op.assignedExternalVendorId || ''
        : op.assignedOperatorId || '';
      if (!key) continue;
      const w = Math.max(
        Number(op.completedUnits) || 0,
        Number(op.completedUnitsLive) || 0,
        Number(op.totalUnits) || 0,
        1
      );
      const prev = standardByKey.get(key) || { weighted: 0, weight: 0 };
      prev.weighted += std * w;
      prev.weight += w;
      standardByKey.set(key, prev);
    }
    const standardFor = (key: string, fallbackName?: string) => {
      const a = standardByKey.get(key);
      const b = fallbackName ? standardByKey.get(fallbackName) : undefined;
      const row = a?.weight ? a : b;
      return row && row.weight > 0 ? row.weighted / row.weight : 0;
    };

    const rankingByKey = new Map<
      string,
      { name: string; units: number; productivity: number; compliance?: number; meta?: string }
    >();

    for (const e of employeePerformance) {
      const live = liveAggByKey.get(e.id) || liveAggByKey.get(e.name);
      const liveUnitsAdd = live?.units || 0;
      const liveMinutesAdd = live?.minutes || 0;
      const units = (e.totalUnits || 0) + liveUnitsAdd;
      const minutes = (e.activeMinutes || 0) + liveMinutesAdd;
      const productivity = minutes > 0 ? units / (minutes / 60) : e.efficiency || 0;
      const standard = live?.standard || standardFor(e.id, e.name) || 0;
      const compliance = standard > 0 ? (productivity / standard) * 100 : undefined;
      const resolved =
        e.type === 'Interno' ? nameByUid.get(e.id) || nameByUid.get(e.name) || e.name : e.name;
      rankingByKey.set(e.id || e.name, {
        name: resolved,
        units,
        productivity,
        compliance,
        meta: e.type,
      });
      if (live) {
        liveAggByKey.delete(e.id);
        liveAggByKey.delete(e.name);
      }
    }

    // Operarios solo LIVE (sin FINISH aún).
    for (const [key, live] of liveAggByKey.entries()) {
      if (live.units <= 0 && live.minutes <= 0) continue;
      const productivity = live.minutes > 0 ? live.units / (live.minutes / 60) : 0;
      const standard = live.standard || standardFor(key, live.displayName) || 0;
      const compliance =
        standard > 0 && productivity > 0 ? (productivity / standard) * 100 : undefined;
      rankingByKey.set(key, {
        name: live.displayName,
        units: live.units,
        productivity,
        compliance,
        meta: live.isExt ? 'Externo' : 'Interno',
      });
    }

    area.ranking = [...rankingByKey.values()].sort(
      (a, b) => b.productivity - a.productivity || b.units - a.units
    );
    area.operators = area.ranking.length;

    // Cumplimiento de área ponderado por und (solo filas con estándar).
    let compSum = 0;
    let compWeight = 0;
    for (const row of area.ranking) {
      if (typeof row.compliance === 'number' && Number.isFinite(row.compliance) && row.units > 0) {
        compSum += row.compliance * row.units;
        compWeight += row.units;
      }
    }
    if (compWeight > 0) area.compliance = compSum / compWeight;

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
        value: `${(activeMinutes / 60).toFixed(1)} h`,
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
    const { getProductivitySettings } = await import('@/app/reception/actions');
    const [opsResult, settingsResult] = await Promise.all([
      loadReceptionOperations({ limit: 400 }),
      getProductivitySettings(),
    ]);
    if (!opsResult.success || !opsResult.data) return area;

    const globalStandard =
      Number(settingsResult.data?.standard_per_hour_goal) > 0
        ? Number(settingsResult.data!.standard_per_hour_goal)
        : 0;

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

    const byUser = new Map<
      string,
      { units: number; first: number; last: number; stdWeighted: number; stdWeight: number }
    >();
    let totalUnits = 0;
    let fillAcc = 0;
    let fillN = 0;

    for (let i = 0; i < targetOps.length; i++) {
      const op = targetOps[i];
      const opStandard =
        Number(op.standard_units_per_hour) > 0
          ? Number(op.standard_units_per_hour)
          : globalStandard;
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
        const qty = Number(it.quantity) || 0;
        const prev = byUser.get(uid) || {
          units: 0,
          first: ts,
          last: ts,
          stdWeighted: 0,
          stdWeight: 0,
        };
        prev.units += qty;
        prev.first = Math.min(prev.first, ts);
        prev.last = Math.max(prev.last, ts);
        if (opStandard > 0 && qty > 0) {
          prev.stdWeighted += opStandard * qty;
          prev.stdWeight += qty;
        }
        byUser.set(uid, prev);
      }
    }

    const ranking = Array.from(byUser.entries())
      .map(([uid, v]) => {
        const hours = Math.max((v.last - v.first) / 3600000, 1 / 60);
        const productivity = v.units / hours;
        const standard =
          v.stdWeight > 0 ? v.stdWeighted / v.stdWeight : globalStandard > 0 ? globalStandard : 0;
        const compliance = standard > 0 ? (productivity / standard) * 100 : undefined;
        return {
          name: nameByUid.get(uid) || uid,
          units: v.units,
          productivity,
          compliance,
        };
      })
      .sort((a, b) => b.units - a.units || b.productivity - a.productivity);

    const totalProdHours = Array.from(byUser.values()).reduce((s, v) => {
      return s + Math.max((v.last - v.first) / 3600000, 1 / 60);
    }, 0);

    area.units = totalUnits;
    area.operators = byUser.size;
    area.productivity = totalProdHours > 0 ? totalUnits / totalProdHours : 0;
    {
      let compSum = 0;
      let compWeight = 0;
      for (const row of ranking) {
        if (typeof row.compliance === 'number' && Number.isFinite(row.compliance) && row.units > 0) {
          compSum += row.compliance * row.units;
          compWeight += row.units;
        }
      }
      area.compliance = compWeight > 0 ? compSum / compWeight : undefined;
    }
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

function remainderLegalization(task: {
  status: string;
  expectedRemainderQty: number;
  returnedQty?: number;
}): { remainderComplete: boolean; legalizationLabel: string; returnedQty?: number } {
  const expected = Number(task.expectedRemainderQty) || 0;
  const hasReturn = task.returnedQty != null && Number.isFinite(Number(task.returnedQty));
  const returned = hasReturn ? Number(task.returnedQty) : undefined;

  if (task.status === 'validated') {
    const complete = returned == null ? true : returned >= expected;
    return {
      returnedQty: returned,
      remainderComplete: complete,
      legalizationLabel:
        returned == null
          ? 'Legalizado'
          : complete
            ? `Completo ${returned}/${expected}`
            : `Parcial ${returned}/${expected}`,
    };
  }
  if (task.status === 'submitted' && returned != null) {
    const complete = returned >= expected;
    return {
      returnedQty: returned,
      remainderComplete: complete,
      legalizationLabel: complete
        ? `Enviado completo ${returned}/${expected}`
        : `Enviado parcial ${returned}/${expected}`,
    };
  }
  if (task.status === 'rejected') {
    return {
      returnedQty: returned,
      remainderComplete: false,
      legalizationLabel:
        returned != null ? `Rechazado ${returned}/${expected}` : 'Rechazado',
    };
  }
  return {
    returnedQty: returned,
    remainderComplete: false,
    legalizationLabel: expected === 0 ? 'Pendiente (esp. 0)' : 'Pendiente',
  };
}

async function buildRemainderAssignments(
  _dayKey: string
): Promise<BodegaTvRemainderAssignmentRow[]> {
  try {
    const res = await listRemainderAssignmentBoard(250);
    if (!res.success || !res.data) return [];

    // TV: solo referencias actualmente asignadas o tomadas (claim).
    // No validadas, no pendientes de validación enviadas, no pool disponible.
    const candidates = res.data.filter((t) => t.status === 'assigned');

    // Backfill ubicación desde recepción (y compare si falta receptionOperationId).
    const needLoc = candidates.filter((t) => !String(t.locationName || '').trim()).slice(0, 40);
    const locByTaskId = new Map<string, string>();

    // Agrupar por recepción para resolver en lote.
    const byReception = new Map<string, typeof needLoc>();
    const needCompareLookup: typeof needLoc = [];
    for (const t of needLoc) {
      const rid = String(t.receptionOperationId || '').trim();
      if (!rid) {
        needCompareLookup.push(t);
        continue;
      }
      if (!byReception.has(rid)) byReception.set(rid, []);
      byReception.get(rid)!.push(t);
    }

    // Si la tarea no trae recepción, leerla del compare.
    if (needCompareLookup.length) {
      const { doc, getDoc } = await import('firebase/firestore');
      const { firestore } = await import('@/services/firebase');
      await Promise.all(
        needCompareLookup.map(async (t) => {
          if (!t.compareId) return;
          try {
            const snap = await getDoc(doc(firestore, 'distributionCompares', t.compareId));
            if (!snap.exists()) return;
            const rid = String(
              (snap.data() as { receptionOperationId?: string }).receptionOperationId || ''
            ).trim();
            if (!rid) return;
            if (!byReception.has(rid)) byReception.set(rid, []);
            byReception.get(rid)!.push({ ...t, receptionOperationId: rid });
          } catch {
            /* ignore */
          }
        })
      );
    }

    await Promise.all(
      [...byReception.entries()].map(async ([receptionOperationId, tasks]) => {
        const locMap = await resolveReceptionLocationsForReferences(
          receptionOperationId,
          tasks.map((t) => t.reference)
        );
        for (const t of tasks) {
          const loc = locMap.get(t.reference);
          if (!loc?.locationName) continue;
          locByTaskId.set(t.id, loc.locationName);
          try {
            const { doc, updateDoc } = await import('firebase/firestore');
            const { firestore } = await import('@/services/firebase');
            await updateDoc(doc(firestore, 'distributionRemainderTasks', t.id), {
              locationName: loc.locationName,
              ...(loc.locationId ? { locationId: loc.locationId } : {}),
              ...(receptionOperationId ? { receptionOperationId } : {}),
              updatedAt: new Date().toISOString(),
            });
          } catch {
            /* no bloquear el TV */
          }
        }
      })
    );

    const rows: BodegaTvRemainderAssignmentRow[] = [];
    for (const t of candidates) {
      const legal = remainderLegalization(t);
      rows.push({
        operatorName: t.assignedOperatorName || t.assignedOperatorId || '—',
        reference: t.reference,
        rkIdentifier: t.rkIdentifier,
        locationName: t.locationName || locByTaskId.get(t.id) || undefined,
        expectedRemainderQty: Number(t.expectedRemainderQty) || 0,
        returnedQty: legal.returnedQty,
        remainderComplete: legal.remainderComplete,
        legalizationLabel: legal.legalizationLabel,
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

/**
 * Auditoría admin: lista cada aporte (FINISH / UNIT_COMPLETE) que suma Bodega Live
 * para el día, con los mismos filtros que el TV.
 */
export async function getEtiquetadoDayBreakdown(dayKey?: string): Promise<{
  success: boolean;
  data?: EtiquetadoDayBreakdown;
  error?: string;
}> {
  try {
    const key = dayKey || todayKeyLocal();
    const day = new Date(`${key}T12:00:00`);
    const [result, profiles] = await Promise.all([
      getLabelingHistoricalData({ from: day, to: day }),
      getAllUserProfiles(),
    ]);
    if (!result.success || !result.data) {
      return { success: false, error: result.error || 'Sin datos de etiquetado.' };
    }

    const nameByUid = new Map<string, string>();
    for (const u of profiles || []) {
      nameByUid.set(u.uid, u.displayName || u.email || u.uid);
    }

    const resolveOperatorLabel = (
      log: { operatorId: string; isExternal?: boolean; externalOperatorName?: string },
      op?: {
        assignedOperatorId?: string;
        assignedExternalOperatorName?: string;
        isExternal?: boolean;
      }
    ) => {
      if (log.isExternal || op?.isExternal) {
        return (
          log.externalOperatorName ||
          op?.assignedExternalOperatorName ||
          log.operatorId ||
          'Externo'
        );
      }
      const uid = log.operatorId || op?.assignedOperatorId || '';
      return nameByUid.get(uid) || uid || '—';
    };

    const { summary, operations, logs } = result.data;
    const opsById = new Map((operations || []).map((op) => [op.id, op]));
    const contributions: EtiquetadoContributionRow[] = [];

    // FINISH: un solo log canónico por tarea (el más reciente del día).
    const finishLogs = (logs || []).filter(
      (l) => l.type === 'FINISH' && isSameLocalDay(l.timestamp, key)
    );
    const latestFinishByOp = new Map<string, (typeof finishLogs)[number]>();
    for (const log of finishLogs) {
      const prev = latestFinishByOp.get(log.labelingOperationId);
      if (!prev || new Date(log.timestamp).getTime() >= new Date(prev.timestamp).getTime()) {
        latestFinishByOp.set(log.labelingOperationId, log);
      }
    }
    const canonicalFinishIds = new Set(
      [...latestFinishByOp.values()].map(
        (l) => String(l.id || `${l.labelingOperationId}:${l.timestamp}`)
      )
    );
    let omittedFinishDuplicates = 0;

    for (const log of finishLogs) {
      const op = opsById.get(log.labelingOperationId);
      let units = Number(log.completedUnits) || 0;
      let unitsSource: EtiquetadoContributionRow['unitsSource'] = 'log';
      if (units <= 0 && op?.status === 'Completada') {
        units = Number(op.completedUnits) || 0;
        unitsSource = 'operation_completed';
      }
      if (units <= 0) continue;

      const logKey = String(log.id || `${log.labelingOperationId}:${log.timestamp}`);
      const isCanonical = canonicalFinishIds.has(logKey);
      if (!isCanonical) omittedFinishDuplicates += 1;

      contributions.push({
        id: `finish:${logKey}`,
        source: 'finish',
        logId: String(log.id || ''),
        operationId: log.labelingOperationId,
        reference: op?.reference || '—',
        status: op?.status || '—',
        trackingMode: op?.trackingMode,
        operatorLabel: resolveOperatorLabel(log, op),
        timestamp: log.timestamp,
        units,
        unitsSource,
        excluded: !isCanonical,
        excludeReason: !isCanonical ? 'FINISH duplicado (no suma)' : undefined,
      });
    }

    // LIVE: UNIT_COMPLETE de hoy; dedupe por caja.
    const activeOps = (operations || []).filter(
      (op) => op.status === 'En Progreso' || op.status === 'Pausada'
    );
    const packActiveIds = new Set(
      activeOps
        .filter((op) => {
          if (op.trackingMode !== 'pack_units' || !(op.labelingPackPlan?.length || 0)) return false;
          const opLogs = (logs || []).filter((l) => l.labelingOperationId === op.id);
          return opLogs.some(
            (l) =>
              isSameLocalDay(l.timestamp, key) &&
              (l.type === 'START' ||
                l.type === 'RESUME' ||
                l.type === 'UNIT_COMPLETE' ||
                l.type === 'PAUSE')
          );
        })
        .map((op) => op.id)
    );

    const liveLogs = (logs || []).filter(
      (l) =>
        l.type === 'UNIT_COMPLETE' &&
        isSameLocalDay(l.timestamp, key) &&
        packActiveIds.has(l.labelingOperationId)
    );
    const seenBox = new Set<string>();
    let liveUnits = 0;
    for (const log of liveLogs) {
      const boxKey = `${log.labelingOperationId}|${log.packingUnitId || ''}|${log.unitNumber ?? ''}|${log.timestamp}`;
      const dedupeKey = log.packingUnitId
        ? `${log.labelingOperationId}|box:${log.packingUnitId}`
        : log.unitNumber != null
          ? `${log.labelingOperationId}|n:${log.unitNumber}`
          : boxKey;
      const isDup = seenBox.has(dedupeKey);
      if (!isDup) seenBox.add(dedupeKey);

      const units = Number(log.qty ?? log.completedUnits) || 0;
      if (units <= 0) continue;
      if (!isDup) liveUnits += units;
      const op = opsById.get(log.labelingOperationId);
      contributions.push({
        id: `live:${log.id || boxKey}`,
        source: 'unit_complete',
        logId: String(log.id || ''),
        operationId: log.labelingOperationId,
        reference: op?.reference || '—',
        status: op?.status || '—',
        trackingMode: op?.trackingMode,
        operatorLabel: resolveOperatorLabel(log, op),
        timestamp: log.timestamp,
        units,
        unitsSource: log.qty != null ? 'qty' : 'log',
        excluded: isDup,
        excludeReason: isDup ? 'Caja duplicada (no suma)' : undefined,
      });
    }

    const finishUnits = summary.totalUnits || 0;
    contributions.sort(
      (a, b) =>
        Number(!!a.excluded) - Number(!!b.excluded) ||
        b.units - a.units ||
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    return {
      success: true,
      data: {
        dayKey: key,
        finishUnits,
        liveUnits,
        totalUnits: finishUnits + liveUnits,
        omittedFinishDuplicates,
        contributions,
      },
    };
  } catch (error: any) {
    console.error('getEtiquetadoDayBreakdown:', error);
    return {
      success: false,
      error: error?.message || 'No se pudo armar el desglose de etiquetado.',
    };
  }
}

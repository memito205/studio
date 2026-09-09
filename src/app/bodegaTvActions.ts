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
import type {
  BodegaTvAreaKey,
  BodegaTvAreaSnapshot,
  BodegaTvSnapshot,
} from '@/lib/bodegaTvTypes';
import { talladoPauseMs, talladoPerPersonHour, talladoRankingByGrupo } from '@/lib/talladoProductivity';

function todayKeyLocal(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

function isSameLocalDay(value: unknown, dayKey: string): boolean {
  if (!value) return false;
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return false;
  return format(d, 'yyyy-MM-dd') === dayKey;
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
  };
}

async function buildEmpaque(dayKey: string): Promise<BodegaTvAreaSnapshot> {
  const area = emptyArea('empaque', 'Empaque');
  try {
    const { data, error } = await loadHistoricalReports({ startDate: dayKey, endDate: dayKey });
    if (error || !data?.length) return area;

    const withPackers = data.filter((r) => (r.packerProductivity?.length || 0) > 0);
    const pool = withPackers.length ? withPackers : data;
    const consolidated = pool.find((r) => r.isConsolidated);
    const report = consolidated || pool[0];
    if (!report) return area;

    const packers = [...(report.packerProductivity || [])].sort((a, b) => {
      if (b.compliance !== a.compliance) return b.compliance - a.compliance;
      return b.productivity - a.productivity;
    });

    area.units = report.totalQuantity || packers.reduce((s, p) => s + (p.totalQuantity || 0), 0);
    area.operators = report.operatorCount || packers.length;
    area.productivity = report.avgProductivity || 0;
    // Cumplimiento de área = promedio ponderado por unidades de cada empacador
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
    area.extras = [
      { label: 'Horas', value: `${(report.totalHours || 0).toFixed(1)} h` },
      { label: 'Fuente', value: report.isConsolidated ? 'Consolidado' : 'Último corte' },
    ];
  } catch (e) {
    console.error('bodegaTv empaque:', e);
  }
  return area;
}

async function buildEtiquetado(dayKey: string, nameByUid: Map<string, string>): Promise<BodegaTvAreaSnapshot> {
  const area = emptyArea('etiquetado', 'Etiquetado');
  try {
    const day = new Date(`${dayKey}T12:00:00`);
    const result = await getLabelingHistoricalData({ from: day, to: day });
    if (!result.success || !result.data) return area;

    const { summary, employeePerformance } = result.data;
    area.units = summary.totalUnits || 0;
    area.operators = employeePerformance.length;
    area.productivity = summary.conversionRate || summary.efficiency || 0;
    area.ranking = [...employeePerformance]
      .sort((a, b) => b.efficiency - a.efficiency || b.totalUnits - a.totalUnits)
      .map((e) => {
        const resolved =
          e.type === 'Interno' ? nameByUid.get(e.id) || nameByUid.get(e.name) || e.name : e.name;
        return {
          name: resolved,
          units: e.totalUnits,
          productivity: e.efficiency,
          meta: e.type,
        };
      });
    area.extras = [
      { label: 'Interno', value: String(summary.internalUnits || 0) },
      { label: 'Externo', value: String(summary.externalUnits || 0) },
      {
        label: 'Horas prod.',
        value: `${((summary.totalActiveMinutes || 0) / 60).toFixed(1)} h`,
      },
    ];
  } catch (e) {
    console.error('bodegaTv etiquetado:', e);
  }
  return area;
}

async function buildTallado(dayKey: string): Promise<BodegaTvAreaSnapshot> {
  const area = emptyArea('tallado', 'Tallado');
  try {
    const result = await listTalladoDashboard({ dayKey });
    if (!result.success) return area;

    const units = result.units || [];
    const shifts = result.shifts || [];
    const pauses = result.pauses || [];
    const done = units.filter((u) => u.status === 'done');
    const pauseMs = talladoPauseMs(pauses);
    const { qty, personHours, perPersonHour, peopleTotal, workedMsTotal } = talladoPerPersonHour({
      shifts,
      units,
      pauses,
    });
    const ranking = talladoRankingByGrupo({ shifts, units, pauses });

    area.units = qty;
    area.operators = shifts.length;
    area.productivity = perPersonHour;
    area.ranking = ranking;
    area.extras = [
      { label: 'Cajas hechas', value: String(done.length) },
      { label: 'Jornada', value: `${(workedMsTotal / 3600000).toFixed(1)} h` },
      { label: 'Pausas', value: `${Math.round(pauseMs / 60000)} min` },
      { label: 'Personas', value: String(peopleTotal) },
      { label: 'Persona·h', value: personHours.toFixed(2) },
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

    const byUser = new Map<
      string,
      { units: number; first: number; last: number }
    >();
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
    // No usar % leído vs esperado como "cumplimiento de productividad"
    area.compliance = undefined;
    area.ranking = ranking;
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

    const [empaque, etiquetado, tallado, recepcion] = await Promise.all([
      buildEmpaque(dayKey),
      buildEtiquetado(dayKey, nameByUid),
      buildTallado(dayKey),
      buildRecepcion(dayKey, nameByUid),
    ]);

    const areas = [empaque, etiquetado, tallado, recepcion];

    // Cumplimiento medio del resumen = promedio ponderado por unidades
    // de personas/grupos que reportan compliance de productividad (hoy: empaque).
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

    const snapshot: BodegaTvSnapshot = {
      dayKey,
      generatedAt: new Date().toISOString(),
      areas,
      summary: {
        totalUnits: areas.reduce((s, a) => s + a.units, 0),
        avgCompliance: complianceWeight > 0 ? complianceSum / complianceWeight : 0,
        operators: areas.reduce((s, a) => s + a.operators, 0),
      },
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

'use server';

import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  startAfter,
  updateDoc,
  where,
} from 'firebase/firestore';
import { firestore } from '@/services/firebase';
import type {
  TalladoCatalogImportRow,
  TalladoCatalogItem,
  TalladoEtiquetadoModo,
  TalladoPause,
  TalladoPauseType,
  TalladoShift,
  TalladoTransferLookup,
  TalladoUnit,
  TransferEntry,
  PackingUnit,
  LabelingOperation,
  ReceptionOperation,
} from '@/types';
import { isTalladoSameLocalDay, talladoLocalDayKey, filterTalladoBundleToDay, talladoBogotaDayBounds } from '@/lib/talladoProductivity';
import { resolveTalladoEtiquetadoModo } from '@/lib/talladoEtiquetado';

const SHIFTS_COL = 'talladoShifts';
const UNITS_COL = 'talladoUnits';
const PAUSES_COL = 'talladoPauses';
const UNIT_DELETES_COL = 'talladoUnitDeletes';
const SHIFT_DELETES_COL = 'talladoShiftDeletes';
const TRANSFERS_COL = 'transfers';
const CATALOG_COL = 'talladoCatalog';
const PACKING_UNITS_COL = 'packingUnits';
const LABELING_OPS_COL = 'labelingOperations';
const RECEPTION_OPS_COL = 'receptionOperations';

const DEFAULT_DESTINO_SIN_REMISION = 'MERCANCIA SIN REMISIONAR';
/** # caja recepción: solo dígitos cortos (no confundir con TF largos). */
const RECEPTION_BOX_NUMBER_RE = /^\d{1,4}$/;

type TalladoDeleteActor = {
  deletedBy?: string;
  deletedByEmail?: string;
  deletedByName?: string;
  reason?: string;
};

type TalladoDeleteSource =
  | 'admin_delete'
  | 'admin_delete_shift'
  | 'cleanup_duplicates'
  | 'finish_dup_cleanup';

function isTalladoSoftDeleted(doc: { deletedAt?: string | null }): boolean {
  return !!doc?.deletedAt;
}

function filterActiveTalladoUnits(units: TalladoUnit[]): TalladoUnit[] {
  return units.filter((u) => !isTalladoSoftDeleted(u));
}

function filterActiveTalladoShifts(shifts: TalladoShift[]): TalladoShift[] {
  return shifts.filter((s) => !isTalladoSoftDeleted(s));
}

function filterActiveTalladoPauses(pauses: TalladoPause[]): TalladoPause[] {
  return pauses.filter((p) => !isTalladoSoftDeleted(p));
}

/**
 * Archiva snapshot completo y soft-marca la unidad.
 * NUNCA hard-deleteDoc: el archivo se escribe ANTES del soft-mark.
 */
async function archiveAndSoftDeleteUnit(
  unit: TalladoUnit,
  meta: TalladoDeleteActor & { source: TalladoDeleteSource }
): Promise<void> {
  const deletedAt = new Date().toISOString();
  const archive = stripUndefinedDeep({
    id: unit.id,
    snapshot: { ...unit },
    deletedAt,
    deletedBy: meta.deletedBy || unit.userId || 'unknown',
    deletedByEmail: meta.deletedByEmail,
    deletedByName: meta.deletedByName || unit.userName,
    reason: meta.reason,
    source: meta.source,
  });
  await setDoc(doc(firestore, UNIT_DELETES_COL, unit.id), archive as any);
  const softPatch: Record<string, string> = {
    deletedAt,
    deletedBy: meta.deletedBy || unit.userId || 'unknown',
  };
  if (meta.deletedByEmail) softPatch.deletedByEmail = meta.deletedByEmail;
  if (meta.deletedByName) softPatch.deletedByName = meta.deletedByName;
  await updateDoc(doc(firestore, UNITS_COL, unit.id), softPatch);
}

/**
 * Archiva turno (+ pausas en el snapshot) y soft-marca.
 * Las unidades se archivan por separado vía archiveAndSoftDeleteUnit.
 */
async function archiveAndSoftDeleteShift(
  shift: TalladoShift,
  pauses: TalladoPause[],
  meta: TalladoDeleteActor & { source: TalladoDeleteSource; unitIds: string[] }
): Promise<void> {
  const deletedAt = new Date().toISOString();
  const archive = stripUndefinedDeep({
    id: shift.id,
    snapshot: { ...shift },
    pauses: pauses.map((p) => ({ ...p })),
    unitIds: meta.unitIds,
    deletedAt,
    deletedBy: meta.deletedBy || shift.userId || 'unknown',
    deletedByEmail: meta.deletedByEmail,
    deletedByName: meta.deletedByName || shift.userName,
    reason: meta.reason,
    source: meta.source,
  });
  await setDoc(doc(firestore, SHIFT_DELETES_COL, shift.id), archive as any);
  const softPatch: Record<string, string> = {
    deletedAt,
    deletedBy: meta.deletedBy || shift.userId || 'unknown',
    status: 'closed',
    endedAt: shift.endedAt || deletedAt,
    closedReason: shift.closedReason || 'admin_delete',
  };
  if (meta.deletedByEmail) softPatch.deletedByEmail = meta.deletedByEmail;
  if (meta.deletedByName) softPatch.deletedByName = meta.deletedByName;
  await updateDoc(doc(firestore, SHIFTS_COL, shift.id), softPatch);
  for (const p of pauses) {
    if (isTalladoSoftDeleted(p)) continue;
    await updateDoc(doc(firestore, PAUSES_COL, p.id), {
      deletedAt,
      deletedBy: meta.deletedBy || shift.userId || 'unknown',
    });
  }
}

function stripUndefinedDeep(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)).filter((item) => item !== undefined);
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined) continue;
    const cleaned = stripUndefinedDeep(v);
    if (cleaned !== undefined) out[k] = cleaned;
  }
  return out;
}

function normalizeTalladoScanCode(raw: string): string {
  // Lectores a veces emiten ' , ; o / en vez del guion medio (-)
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[\u2018\u2019\u201A\uFF07`´′ʼ']/g, '-')
    .replace(/[,;/]/g, '-')
    .replace(/\s+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeGrupoKey(raw: string): string {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

function unitMatchesScanCode(unit: TalladoUnit, scanCode: string): boolean {
  const code = normalizeTalladoScanCode(scanCode);
  if (!code) return false;
  if (
    normalizeTalladoScanCode(unit.scanCode) === code ||
    normalizeTalladoScanCode(unit.numeroTF) === code ||
    normalizeTalladoScanCode(unit.codigoAlterno || '') === code
  ) {
    return true;
  }
  if (RECEPTION_BOX_NUMBER_RE.test(code) && unit.unitNumber != null) {
    return String(unit.unitNumber) === code;
  }
  return false;
}

async function listInProgressUnits(): Promise<TalladoUnit[]> {
  const snap = await getDocs(
    query(collection(firestore, UNITS_COL), where('status', '==', 'in_progress'), limit(500))
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as TalladoUnit))
    .filter((u) => !isTalladoSoftDeleted(u));
}

function talladoCodeVariants(code: string, rawCode?: string): string[] {
  return Array.from(
    new Set(
      [
        code,
        code.replace(/-/g, "'"),
        code.replace(/-/g, ','),
        code.replace(/-/g, ''),
        String(rawCode || '').trim(),
        String(rawCode || '')
          .trim()
          .toUpperCase(),
      ].filter(Boolean)
    )
  );
}

/** Consultas en paralelo. Primero código normalizado (3 lecturas); variantes solo si no hay match. */
async function findUnitsMatchingCode(scanCode: string): Promise<TalladoUnit[]> {
  const code = normalizeTalladoScanCode(scanCode);
  if (!code) return [];

  const fields = ['scanCode', 'numeroTF', 'codigoAlterno'] as const;
  const collect = (snaps: Awaited<ReturnType<typeof getDocs>>[]) => {
    const found = new Map<string, TalladoUnit>();
    for (const snap of snaps) {
      for (const d of snap.docs) {
        found.set(d.id, { id: d.id, ...d.data() } as TalladoUnit);
      }
    }
    return Array.from(found.values())
      .filter((u) => !isTalladoSoftDeleted(u) && unitMatchesScanCode(u, code))
      .sort((a, b) =>
        String(b.endedAt || b.startedAt).localeCompare(String(a.endedAt || a.startedAt))
      );
  };

  const primarySnaps = await Promise.all(
    fields.map((field) =>
      getDocs(query(collection(firestore, UNITS_COL), where(field, '==', code), limit(20)))
    )
  );
  const primary = collect(primarySnaps);
  if (primary.length > 0) return primary;

  const otherVariants = talladoCodeVariants(code).filter((v) => v !== code);
  if (otherVariants.length === 0) return [];

  const variantSnaps = await Promise.all(
    fields.flatMap((field) =>
      otherVariants.map((variant) =>
        getDocs(query(collection(firestore, UNITS_COL), where(field, '==', variant), limit(20)))
      )
    )
  );
  return collect(variantSnaps);
}

/**
 * Auditoría de unidades por código (TF / alterno / scanCode).
 * Devuelve historial con fechas de Inicio (se leyó/talló) y Fin.
 */
export async function auditTalladoUnitsByCode(rawCode: string): Promise<{
  success: boolean;
  data?: TalladoUnit[];
  normalizedCode?: string;
  error?: string;
}> {
  try {
    const code = normalizeTalladoScanCode(rawCode);
    if (!code) {
      return { success: false, error: 'Ingrese un código para auditar.' };
    }
    const units = await findUnitsMatchingCode(code);
    return { success: true, data: units, normalizedCode: code };
  } catch (error: any) {
    console.error('auditTalladoUnitsByCode:', error);
    return { success: false, error: error?.message || 'No se pudo consultar el historial.' };
  }
}

export type TalladoDayValidationSample = {
  id: string;
  scanCode: string;
  startedAt: string;
  cantidad?: number;
  shiftId?: string;
  status?: string;
};

/**
 * Admin: validación dura de un día Bogotá.
 * Cuenta unidades por rango startedAt, turnos, shiftIds referenciados y muestra muestras.
 * Opcionalmente audita un shiftId concreto (conteo total + por día).
 */
export async function validateTalladoDay(opts: {
  dayKey: string;
  shiftId?: string;
}): Promise<{
  success: boolean;
  dayKey?: string;
  bounds?: { startIso: string; endIso: string };
  unitsByStartedAt?: number;
  unitsByEndedAt?: number;
  unitsActive?: number;
  unitsSoftDeleted?: number;
  shiftsByStartedAt?: number;
  shiftsByDayKey?: number;
  shiftsSoftDeleted?: number;
  shiftIdsReferenced?: Record<string, number>;
  shiftsFound?: Array<{
    id: string;
    grupo?: string;
    status?: string;
    startedAt?: string;
    dayKey?: string | null;
    deletedAt?: string | null;
  }>;
  samples?: TalladoDayValidationSample[];
  shiftAudit?: {
    shiftId: string;
    exists: boolean;
    unitCount: number;
    unitsByBogotaDay: Record<string, number>;
    samples: TalladoDayValidationSample[];
  };
  dashboardLoad?: { shifts: number; units: number; pauses: number };
  error?: string;
}> {
  try {
    const dayKey = String(opts?.dayKey || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
      return { success: false, error: 'Indique una fecha válida (YYYY-MM-DD).' };
    }

    const { startMs, endMs } = talladoBogotaDayBounds(dayKey);
    const startIso = new Date(startMs).toISOString();
    const endIso = new Date(endMs).toISOString();

    const toSample = (u: TalladoUnit): TalladoDayValidationSample => ({
      id: u.id,
      scanCode: String(u.scanCode || u.numeroTF || ''),
      startedAt: String(u.startedAt || ''),
      cantidad: u.cantidad,
      shiftId: u.shiftId,
      status: u.status,
    });

    const [unitsStartSnap, unitsEndSnap, shiftsStartSnap, shiftsDayKeySnap] = await Promise.all([
      getDocs(
        query(
          collection(firestore, UNITS_COL),
          where('startedAt', '>=', startIso),
          where('startedAt', '<=', endIso),
          limit(3000)
        )
      ),
      getDocs(
        query(
          collection(firestore, UNITS_COL),
          where('endedAt', '>=', startIso),
          where('endedAt', '<=', endIso),
          limit(1500)
        )
      ).catch(() => null),
      getDocs(
        query(
          collection(firestore, SHIFTS_COL),
          where('startedAt', '>=', startIso),
          where('startedAt', '<=', endIso),
          limit(500)
        )
      ),
      getDocs(query(collection(firestore, SHIFTS_COL), where('dayKey', '==', dayKey), limit(500))).catch(
        () => null
      ),
    ]);

    const unitMap = new Map<string, TalladoUnit>();
    for (const d of unitsStartSnap.docs) {
      unitMap.set(d.id, { id: d.id, ...d.data() } as TalladoUnit);
    }
    if (unitsEndSnap) {
      for (const d of unitsEndSnap.docs) {
        if (!unitMap.has(d.id)) {
          unitMap.set(d.id, { id: d.id, ...d.data() } as TalladoUnit);
        }
      }
    }

    const shiftIdsReferenced: Record<string, number> = {};
    let unitsSoftDeleted = 0;
    for (const u of unitMap.values()) {
      if (isTalladoSoftDeleted(u)) {
        unitsSoftDeleted += 1;
        continue;
      }
      const sid = u.shiftId || '(sin shiftId)';
      shiftIdsReferenced[sid] = (shiftIdsReferenced[sid] || 0) + 1;
    }

    const shiftMap = new Map<string, TalladoShift>();
    for (const d of shiftsStartSnap.docs) {
      shiftMap.set(d.id, { id: d.id, ...d.data() } as TalladoShift);
    }
    if (shiftsDayKeySnap) {
      for (const d of shiftsDayKeySnap.docs) {
        shiftMap.set(d.id, { id: d.id, ...d.data() } as TalladoShift);
      }
    }

    let shiftsSoftDeleted = 0;
    for (const s of shiftMap.values()) {
      if (isTalladoSoftDeleted(s)) shiftsSoftDeleted += 1;
    }

    const activeUnits = Array.from(unitMap.values()).filter((u) => !isTalladoSoftDeleted(u));
    const samples = activeUnits
      .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)))
      .slice(0, 8)
      .map(toSample);

    let shiftAudit:
      | {
          shiftId: string;
          exists: boolean;
          unitCount: number;
          unitsByBogotaDay: Record<string, number>;
          samples: TalladoDayValidationSample[];
        }
      | undefined;

    const shiftId = String(opts?.shiftId || '').trim();
    if (shiftId) {
      const shiftSnap = await getDoc(doc(firestore, SHIFTS_COL, shiftId));
      const unitsByShift = await getDocs(
        query(collection(firestore, UNITS_COL), where('shiftId', '==', shiftId), limit(3000))
      );
      const unitsByBogotaDay: Record<string, number> = {};
      const shiftSamples: TalladoDayValidationSample[] = [];
      for (const d of unitsByShift.docs) {
        const u = { id: d.id, ...d.data() } as TalladoUnit;
        const day = u.startedAt ? talladoLocalDayKey(new Date(u.startedAt)) : 'sin-startedAt';
        unitsByBogotaDay[day] = (unitsByBogotaDay[day] || 0) + 1;
        if (shiftSamples.length < 8) shiftSamples.push(toSample(u));
      }
      shiftAudit = {
        shiftId,
        exists: shiftSnap.exists(),
        unitCount: unitsByShift.size,
        unitsByBogotaDay,
        samples: shiftSamples,
      };
    }

    const dash = await loadTalladoCollectionsForDay(dayKey);
    const filtered = filterTalladoBundleToDay(dayKey, dash.shifts, dash.units, dash.pauses);

    return {
      success: true,
      dayKey,
      bounds: { startIso, endIso },
      unitsByStartedAt: unitsStartSnap.size,
      unitsByEndedAt: unitsEndSnap?.size ?? 0,
      unitsActive: activeUnits.length,
      unitsSoftDeleted,
      shiftsByStartedAt: shiftsStartSnap.size,
      shiftsByDayKey: shiftsDayKeySnap?.size ?? 0,
      shiftsSoftDeleted,
      shiftIdsReferenced,
      shiftsFound: Array.from(shiftMap.values()).map((s) => ({
        id: s.id,
        grupo: s.grupo,
        status: s.status,
        startedAt: s.startedAt,
        dayKey: s.dayKey ?? null,
        deletedAt: s.deletedAt ?? null,
      })),
      samples,
      shiftAudit,
      dashboardLoad: {
        shifts: filtered.shifts.length,
        units: filtered.units.length,
        pauses: filtered.pauses.length,
      },
    };
  } catch (error: any) {
    console.error('validateTalladoDay:', error);
    return { success: false, error: error?.message || 'No se pudo validar el día.' };
  }
}

/** Unidades abiertas que coinciden con el código (sin listar las 500 in_progress). */
async function findInProgressUnitsByCode(scanCode: string): Promise<TalladoUnit[]> {
  const matches = await findUnitsMatchingCode(scanCode);
  return matches
    .filter((u) => u.status === 'in_progress')
    .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
}

async function listActiveShifts(): Promise<TalladoShift[]> {
  const snap = await getDocs(
    query(collection(firestore, SHIFTS_COL), where('status', '==', 'active'), limit(200))
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as TalladoShift))
    .filter((s) => !isTalladoSoftDeleted(s));
}

/** Turno pertenece al día (dayKey explícito o startedAt en Bogotá). */
function shiftBelongsToDay(shift: TalladoShift, dayKey: string): boolean {
  if (shift.dayKey) return shift.dayKey === dayKey;
  return isTalladoSameLocalDay(shift.startedAt, dayKey);
}

/**
 * Cierra un turno activo de un día anterior (rollover Bogotá).
 * - NO borra unidades ni pausas.
 * - Asigna dayKey del día en que inició el turno (si faltaba).
 * - endedAt = fin del día Bogotá anterior a hoy (límite de jornada), no deja el turno “abierto” multi-día.
 */
async function closeShiftAsDayRollover(shift: TalladoShift): Promise<void> {
  const todayKey = talladoLocalDayKey();
  const shiftDayKey = shift.dayKey || talladoLocalDayKey(new Date(shift.startedAt));
  const { startMs: todayStart } = talladoBogotaDayBounds(todayKey);
  const startedMs = new Date(shift.startedAt).getTime();
  const boundaryMs = Number.isFinite(startedMs)
    ? Math.max(todayStart - 1, startedMs)
    : todayStart - 1;
  const endedAt = new Date(boundaryMs).toISOString();
  await updateDoc(doc(firestore, SHIFTS_COL, shift.id), {
    status: 'closed',
    endedAt,
    closedReason: 'day_rollover',
    dayKey: shiftDayKey,
  });
}

/**
 * Garantiza que el shiftId sea un turno activo del día Bogotá actual.
 * Si es de otro día, lo cierra con day_rollover (sin borrar datos) y pide uno nuevo.
 */
async function requireActiveShiftForToday(
  shiftId: string
): Promise<{ ok: true; shift: TalladoShift } | { ok: false; error: string }> {
  if (!shiftId) return { ok: false, error: 'Sin turno activo.' };
  const snap = await getDoc(doc(firestore, SHIFTS_COL, shiftId));
  if (!snap.exists()) return { ok: false, error: 'El turno no existe.' };
  const shift = { id: snap.id, ...snap.data() } as TalladoShift;
  if (shift.status !== 'active') {
    return {
      ok: false,
      error: 'Ese turno ya no está activo. Inicie un turno nuevo para hoy.',
    };
  }
  const todayKey = talladoLocalDayKey();
  if (!shiftBelongsToDay(shift, todayKey)) {
    try {
      await closeShiftAsDayRollover(shift);
    } catch {
      // Igual bloqueamos el escaneo aunque el cierre falle
    }
    return {
      ok: false,
      error:
        'El turno era de otro día y se cerró automáticamente (cambio de día Bogotá). Cree un turno nuevo para hoy.',
    };
  }
  if (!shift.dayKey) {
    await updateDoc(doc(firestore, SHIFTS_COL, shift.id), { dayKey: todayKey });
    shift.dayKey = todayKey;
  }
  return { ok: true, shift };
}

function alreadyDoneError(unit: TalladoUnit): string {
  const when = unit.endedAt
    ? new Date(unit.endedAt).toLocaleString('es-CO', { hour12: false })
    : unit.startedAt;
  return `El código ${unit.scanCode} ya fue tallado (Fin ${when}, grupo ${unit.grupo}). No se puede iniciar de nuevo.`;
}

function overlapMs(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  const start = Math.max(aStart, bStart);
  const end = Math.min(aEnd, bEnd);
  return Math.max(0, end - start);
}

/** Resta de un intervalo los solapes con pausas cerradas/abiertas del mismo turno. */
function computeNetDurationMs(
  startedAtIso: string,
  endedAtIso: string,
  pauses: Array<Pick<TalladoPause, 'pausedAt' | 'resumedAt'>>
): number {
  const start = new Date(startedAtIso).getTime();
  const end = new Date(endedAtIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  let paused = 0;
  for (const p of pauses) {
    const pStart = new Date(p.pausedAt).getTime();
    const pEnd = p.resumedAt ? new Date(p.resumedAt).getTime() : end;
    if (!Number.isFinite(pStart) || !Number.isFinite(pEnd)) continue;
    paused += overlapMs(start, end, pStart, pEnd);
  }
  return Math.max(0, end - start - paused);
}

function aggregateTransfers(
  scanCode: string,
  matchedBy: TalladoTransferLookup['matchedBy'],
  docs: TransferEntry[]
): TalladoTransferLookup {
  const cantidad = docs.reduce((s, t) => s + (Number(t.cantidad) || 0), 0);
  const marcas = Array.from(new Set(docs.map((t) => String(t.marca || '').trim()).filter(Boolean)));
  const grupos = Array.from(new Set(docs.map((t) => String(t.grupo || '').trim()).filter(Boolean)));
  const destinos = Array.from(
    new Set(docs.map((t) => String(t.bodegaDestino || '').trim()).filter(Boolean))
  );
  const origenes = Array.from(
    new Set(docs.map((t) => String(t.bodegaOrigen || '').trim()).filter(Boolean))
  );
  const alternos = Array.from(
    new Set(docs.map((t) => String(t.codigoAlterno || '').trim()).filter(Boolean))
  );
  const first = docs[0];
  return {
    scanCode,
    matchedBy,
    transferIds: docs.map((t) => t.id).filter(Boolean),
    numeroTF: String(first?.numeroTF || scanCode),
    codigoAlterno: alternos[0] || undefined,
    bodegaDestino: destinos[0] || String(first?.bodegaDestino || ''),
    bodegaOrigen: origenes[0] || undefined,
    marca: marcas.join(', ') || String(first?.marca || ''),
    grupoMercancia: grupos.join(', ') || undefined,
    cantidad: cantidad || docs.length,
    lineCount: docs.length,
    source: 'transfers',
  };
}

function catalogToLookup(scanCode: string, item: TalladoCatalogItem): TalladoTransferLookup {
  return {
    scanCode,
    matchedBy: 'catalogo',
    transferIds: [],
    numeroTF: item.referencia || scanCode,
    codigoAlterno: item.codigoBarras,
    bodegaDestino: DEFAULT_DESTINO_SIN_REMISION,
    // En reportes/UI de marca siempre "MERCANCIA SIN REMISIONAR"; la ref va en numeroTF/referencia
    marca: DEFAULT_DESTINO_SIN_REMISION,
    grupoMercancia: item.talla ? `Talla ${item.talla}` : undefined,
    cantidad: Math.max(0, Number(item.cantidad) || 0),
    lineCount: 1,
    source: 'catalogo',
    referencia: item.referencia,
    talla: item.talla,
    catalogId: item.id,
  };
}

function packingUnitToReceptionLookup(
  scanCode: string,
  opts: {
    unit: PackingUnit;
    packingUnitFirestoreId: string;
    rkIdentifier?: string;
    yaEtiquetada: boolean;
    /** Cantidad resuelta desde packUnitsById / escaneos (preferida). */
    cantidadOverride?: number;
    referenciaOverride?: string;
    tallaOverride?: string;
  }
): TalladoTransferLookup {
  const items = opts.unit.items && typeof opts.unit.items === 'object' ? Object.values(opts.unit.items) : [];
  const refQty = new Map<string, number>();
  const tallas = new Set<string>();
  let cantidadFromItems = 0;
  for (const row of items) {
    const qty = Math.max(0, Number(row?.packedQuantity) || 0);
    cantidadFromItems += qty;
    const ref = String(row?.item?.referencia || '').trim();
    if (ref) refQty.set(ref, (refQty.get(ref) || 0) + qty);
    const talla = String(row?.item?.talla || row?.item?.size || '').trim();
    if (talla) tallas.add(talla);
  }
  const refsSorted = Array.from(refQty.entries()).sort((a, b) => b[1] - a[1]);
  const referencia =
    String(opts.referenciaOverride || '').trim() ||
    refsSorted.map(([r]) => r).join(', ') ||
    undefined;
  const primaryRef = (referencia || '').split(',')[0]?.trim() || refsSorted[0]?.[0];
  const unitNumber = Number(opts.unit.id) || Number(scanCode) || 0;
  const rk = String(opts.rkIdentifier || '').trim();
  const cantidad =
    opts.cantidadOverride != null && Number.isFinite(opts.cantidadOverride)
      ? Math.max(0, Number(opts.cantidadOverride))
      : cantidadFromItems;

  return {
    scanCode,
    matchedBy: 'recepcion_caja',
    transferIds: [],
    numeroTF: primaryRef || `CAJA-${unitNumber}`,
    codigoAlterno: opts.packingUnitFirestoreId,
    bodegaDestino: DEFAULT_DESTINO_SIN_REMISION,
    marca: DEFAULT_DESTINO_SIN_REMISION,
    grupoMercancia: rk ? `RK ${rk}` : undefined,
    cantidad,
    lineCount: Math.max(1, items.length || 1),
    source: 'recepcion',
    referencia,
    talla:
      String(opts.tallaOverride || '').trim() ||
      (tallas.size ? Array.from(tallas).join(', ') : undefined),
    unitNumber: unitNumber || undefined,
    packingUnitId: opts.packingUnitFirestoreId,
    receptionOperationId: opts.unit.reception_id,
    rkIdentifier: rk || undefined,
    yaEtiquetada: opts.yaEtiquetada,
  };
}

/** Misma regla que recepción al cerrar caja: `Number(quantity) || 1`. */
function receptionScanQty(quantity: unknown): number {
  return Number(quantity) || 1;
}

/**
 * Asegura el Firestore ID de la caja (a veces el tallado guardó el # caja
 * o un hint inválido en packingUnitId / codigoAlterno).
 */
async function resolvePackingUnitIdForTallado(
  receptionId: string,
  packingUnitHint: string,
  unitNumber?: number
): Promise<{ packingUnitId: string; unitNumber?: number } | null> {
  const hint = String(packingUnitHint || '').trim();
  const reception = String(receptionId || '').trim();

  if (hint) {
    try {
      const snap = await getDoc(doc(firestore, PACKING_UNITS_COL, hint));
      if (snap.exists()) {
        const data = snap.data() as PackingUnit;
        if (!reception || !data.reception_id || data.reception_id === reception) {
          return {
            packingUnitId: snap.id,
            unitNumber: Number(data.id) || unitNumber,
          };
        }
      }
    } catch {
      /* ignore */
    }
  }

  const n =
    unitNumber != null && Number.isFinite(unitNumber) && unitNumber >= 1
      ? Number(unitNumber)
      : RECEPTION_BOX_NUMBER_RE.test(hint)
        ? Number(hint)
        : NaN;

  if (reception && Number.isFinite(n) && n >= 1) {
    try {
      // `id` histórico a veces number y a veces string; probar ambos.
      const snaps = await Promise.all([
        getDocs(
          query(
            collection(firestore, PACKING_UNITS_COL),
            where('reception_id', '==', reception),
            where('id', '==', n),
            limit(10)
          )
        ),
        getDocs(
          query(
            collection(firestore, PACKING_UNITS_COL),
            where('reception_id', '==', reception),
            where('id', '==', String(n)),
            limit(10)
          )
        ),
      ]);
      const seen = new Set<string>();
      const docs = snaps.flatMap((s) => s.docs).filter((d) => {
        if (seen.has(d.id)) return false;
        seen.add(d.id);
        return true;
      });
      if (docs.length > 0) {
        const ranked = [...docs].sort((a, b) => {
          const da = a.data() as PackingUnit;
          const db = b.data() as PackingUnit;
          const closed = Number(db.status === 'closed') - Number(da.status === 'closed');
          if (closed !== 0) return closed;
          return String(db.closed_at || db.createdAt || '').localeCompare(
            String(da.closed_at || da.createdAt || '')
          );
        });
        const d = ranked[0];
        const data = d.data() as PackingUnit;
        return { packingUnitId: d.id, unitNumber: Number(data.id) || n };
      }
    } catch {
      /* ignore */
    }
  }

  return hint ? { packingUnitId: hint, unitNumber } : null;
}

/**
 * Qty + refs de una caja: escaneos (verdad) → closedQty → packUnitsById → plan → items.
 * Solo cuenta esa packingUnit (Firestore ID); no mezcla otras cajas por #.
 * No escribe ni modifica recepción (salvo leer).
 */
async function resolveReceptionBoxQty(
  receptionId: string,
  packingUnitFirestoreId: string,
  opts?: { unitNumber?: number }
): Promise<{ qty: number; refs: string[]; packingUnitId?: string }> {
  const reception = String(receptionId || '').trim();
  const resolvedUnit = await resolvePackingUnitIdForTallado(
    reception,
    packingUnitFirestoreId,
    opts?.unitNumber
  );
  const packingUnitId = resolvedUnit?.packingUnitId || String(packingUnitFirestoreId || '').trim();

  if (!reception || !packingUnitId) return { qty: 0, refs: [] };

  // 1) Escaneos reales de ESTA caja (fuente de verdad; no confiar solo en snapshot)
  try {
    const itemsSnap = await getDocs(
      query(collection(firestore, 'scannedItems'), where('packing_unit_id', '==', packingUnitId))
    );
    if (!itemsSnap.empty) {
      const refQty = new Map<string, number>();
      let qty = 0;
      for (const d of itemsSnap.docs) {
        const data = d.data() as { quantity?: number; reference?: string; reception_id?: string };
        // Defensa: no mezclar escaneos de otra RK si el id de caja se reutilizó mal.
        if (data.reception_id && String(data.reception_id) !== reception) continue;
        const q = receptionScanQty(data.quantity);
        qty += q;
        const ref = String(data.reference || '').trim();
        if (ref) refQty.set(ref, (refQty.get(ref) || 0) + q);
      }
      if (qty > 0) {
        const sorted = Array.from(refQty.entries()).sort((a, b) => b[1] - a[1]);
        return { qty, refs: sorted.map(([r]) => r), packingUnitId };
      }
    }
  } catch (err) {
    console.warn('resolveReceptionBoxQty scannedItems:', err);
  }

  // 2) Snapshot al cerrar / rebuild (closedQty / closedRefs) si ya no hay escaneos
  try {
    const unitSnap = await getDoc(doc(firestore, PACKING_UNITS_COL, packingUnitId));
    if (unitSnap.exists()) {
      const unit = unitSnap.data() as PackingUnit & {
        closedQty?: number;
        closedRefs?: string[];
      };
      if (unit.reception_id && String(unit.reception_id) !== reception) {
        return { qty: 0, refs: [], packingUnitId };
      }
      const closedQty = Math.max(0, Number(unit.closedQty) || 0);
      if (closedQty > 0) {
        const refs = Array.isArray(unit.closedRefs)
          ? unit.closedRefs.map((r) => String(r || '').trim()).filter(Boolean)
          : [];
        return { qty: closedQty, refs, packingUnitId };
      }
    }
  } catch (err) {
    console.warn('resolveReceptionBoxQty closedQty:', err);
  }

  // 3) referenceStats.packUnitsById — solo esta packingUnitId (puede partir qty por ref)
  try {
    const statsSnap = await getDocs(
      collection(firestore, RECEPTION_OPS_COL, reception, 'referenceStats')
    );
    const refs: string[] = [];
    let qty = 0;
    for (const d of statsSnap.docs) {
      const packUnitsById = (d.data() as {
        packUnitsById?: Record<
          string,
          { qty?: number; packingUnitId?: string; unitNumber?: number }
        >;
        reference?: string;
      }).packUnitsById;
      if (!packUnitsById || typeof packUnitsById !== 'object') continue;
      const detail = packUnitsById[packingUnitId];
      if (!detail) continue;
      if (detail.packingUnitId && String(detail.packingUnitId).trim() !== packingUnitId) {
        continue;
      }
      const q = Math.max(0, Number(detail.qty) || 0);
      if (q <= 0) continue;
      qty += q;
      const ref = String(d.data().reference || d.id || '').trim();
      if (ref) refs.push(ref);
    }
    if (qty > 0) return { qty, refs, packingUnitId };
  } catch (err) {
    console.warn('resolveReceptionBoxQty stats:', err);
  }

  // 4) Plan de etiquetado — solo packingUnitId exacto
  try {
    const labSnap = await getDocs(
      query(
        collection(firestore, LABELING_OPS_COL),
        where('receptionOperationId', '==', reception),
        limit(80)
      )
    );
    const byRef = new Map<string, number>();
    for (const lab of labSnap.docs) {
      const op = lab.data() as LabelingOperation;
      const plan = op.labelingPackPlan;
      if (!Array.isArray(plan)) continue;
      const hit = plan.find((u) => String(u?.packingUnitId || '').trim() === packingUnitId);
      if (!hit) continue;
      const q = Math.max(0, Number(hit.qty) || 0);
      if (q <= 0) continue;
      const ref = String(op.reference || '').trim() || lab.id;
      byRef.set(ref, Math.max(byRef.get(ref) || 0, q));
    }
    if (byRef.size > 0) {
      const qty = Array.from(byRef.values()).reduce((a, b) => a + b, 0);
      if (qty > 0) {
        const refs = Array.from(byRef.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([r]) => r);
        return { qty, refs, packingUnitId };
      }
    }
  } catch (err) {
    console.warn('resolveReceptionBoxQty labelingPlan:', err);
  }

  // 5) Items embebidos en el doc packingUnits (legado)
  try {
    const unitSnap = await getDoc(doc(firestore, PACKING_UNITS_COL, packingUnitId));
    if (unitSnap.exists()) {
      const unit = unitSnap.data() as PackingUnit;
      if (unit.reception_id && String(unit.reception_id) !== reception) {
        return { qty: 0, refs: [], packingUnitId };
      }
      const items =
        unit.items && typeof unit.items === 'object' ? Object.values(unit.items) : [];
      const refQty = new Map<string, number>();
      let qty = 0;
      for (const row of items) {
        const q = Math.max(0, Number(row?.packedQuantity) || 0);
        qty += q;
        const ref = String(row?.item?.referencia || '').trim();
        if (ref) refQty.set(ref, (refQty.get(ref) || 0) + q);
      }
      if (qty > 0) {
        const sorted = Array.from(refQty.entries()).sort((a, b) => b[1] - a[1]);
        return { qty, refs: sorted.map(([r]) => r), packingUnitId };
      }
    }
  } catch (err) {
    console.warn('resolveReceptionBoxQty packingUnit.items:', err);
  }

  return { qty: 0, refs: [], packingUnitId };
}

/**
 * Cruce por # caja: exige recepción (RK) elegida.
 * El # se reinicia en cada recepción; sin RK no se puede asociar.
 */
async function lookupReceptionBoxForTallado(
  rawCode: string,
  receptionOperationId?: string
): Promise<{
  success: boolean;
  data?: TalladoTransferLookup;
  candidates?: TalladoTransferLookup[];
  error?: string;
}> {
  const scanCode = normalizeTalladoScanCode(rawCode);
  if (!RECEPTION_BOX_NUMBER_RE.test(scanCode)) {
    return { success: false, error: 'Código no es un # de caja de recepción.' };
  }
  const unitNumber = Number(scanCode);
  if (!Number.isFinite(unitNumber) || unitNumber < 1) {
    return { success: false, error: 'Número de caja inválido.' };
  }

  const receptionId = String(receptionOperationId || '').trim();
  if (!receptionId) {
    return {
      success: false,
      error:
        'Para tallar por # de caja elija primero la recepción (RK). El # se reinicia en cada operación (todas empiezan en caja 1).',
    };
  }

  // `id` puede ser number o string según legado; no mezclar con TF/alternos.
  const unitSnaps = await Promise.all([
    getDocs(
      query(
        collection(firestore, PACKING_UNITS_COL),
        where('reception_id', '==', receptionId),
        where('id', '==', unitNumber),
        limit(10)
      )
    ),
    getDocs(
      query(
        collection(firestore, PACKING_UNITS_COL),
        where('reception_id', '==', receptionId),
        where('id', '==', String(unitNumber)),
        limit(10)
      )
    ),
  ]);
  const seenUnitIds = new Set<string>();
  const unitDocs = unitSnaps.flatMap((s) => s.docs).filter((d) => {
    if (seenUnitIds.has(d.id)) return false;
    seenUnitIds.add(d.id);
    return true;
  });
  if (unitDocs.length === 0) {
    return {
      success: false,
      error: `No hay caja #${unitNumber} en la recepción seleccionada.`,
    };
  }

  // Si hay más de un doc con el mismo #, preferir cerrada y la más reciente.
  const ranked = [...unitDocs].sort((a, b) => {
    const da = a.data() as PackingUnit;
    const db = b.data() as PackingUnit;
    const closed = Number(db.status === 'closed') - Number(da.status === 'closed');
    if (closed !== 0) return closed;
    const ta = String(da.closed_at || da.createdAt || '');
    const tb = String(db.closed_at || db.createdAt || '');
    return tb.localeCompare(ta);
  });
  const d = ranked[0];
  const raw = d.data() as Omit<PackingUnit, 'firestoreId'>;
  const unit: PackingUnit = { firestoreId: d.id, ...raw };

  let rkIdentifier: string | undefined;
  try {
    const opSnap = await getDoc(doc(firestore, RECEPTION_OPS_COL, receptionId));
    if (opSnap.exists()) {
      const op = opSnap.data() as ReceptionOperation;
      rkIdentifier = String(op.rk_identifier || '').trim() || undefined;
    }
  } catch {
    /* ignore */
  }

  let yaEtiquetada = false;
  try {
    const labSnap = await getDocs(
      query(
        collection(firestore, LABELING_OPS_COL),
        where('receptionOperationId', '==', receptionId),
        limit(40)
      )
    );
    for (const lab of labSnap.docs) {
      const op = lab.data() as LabelingOperation;
      const plan = op.labelingPackPlan;
      if (!Array.isArray(plan)) continue;
      if (plan.some((u) => u.packingUnitId === d.id && u.confirmed)) {
        yaEtiquetada = true;
        break;
      }
    }
  } catch {
    /* ignore */
  }

  const fromStats = await resolveReceptionBoxQty(receptionId, d.id, { unitNumber });

  return {
    success: true,
    data: packingUnitToReceptionLookup(scanCode, {
      unit,
      packingUnitFirestoreId: fromStats.packingUnitId || d.id,
      rkIdentifier,
      yaEtiquetada,
      cantidadOverride: fromStats.qty > 0 ? fromStats.qty : undefined,
      referenciaOverride: fromStats.refs.length ? fromStats.refs.join(', ') : undefined,
    }),
  };
}

/** Opciones livianas de recepción para fijar el contexto de # caja en Tallado. */
export async function listTalladoReceptionOptions(): Promise<{
  success: boolean;
  data?: Array<{ id: string; rk: string; supplier: string; status: string }>;
  error?: string;
}> {
  try {
    const snap = await getDocs(
      query(collection(firestore, RECEPTION_OPS_COL), orderBy('created_at', 'desc'), limit(80))
    );
    const allowed = new Set(['in_progress', 'completed', 'paused']);
    const data = snap.docs
      .map((d) => {
        const op = d.data() as ReceptionOperation;
        return {
          id: d.id,
          rk: String(op.rk_identifier || d.id).trim() || d.id,
          supplier: String(op.supplier || '').trim(),
          status: String(op.status || ''),
        };
      })
      .filter((o) => allowed.has(o.status))
      .slice(0, 50);
    return { success: true, data };
  } catch (error: any) {
    return { success: false, error: error?.message || 'No se pudieron listar recepciones.' };
  }
}

/** Admin: cierra un turno activo (deja de aparecer para reingreso del día). */
export async function adminCloseTalladoShift(shiftId: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    if (!shiftId) return { success: false, error: 'Turno inválido.' };
    const snap = await getDoc(doc(firestore, SHIFTS_COL, shiftId));
    if (!snap.exists()) return { success: false, error: 'El turno no existe.' };
    const shift = snap.data() as TalladoShift;
    if (shift.status === 'closed') return { success: true };
    const now = new Date().toISOString();
    await updateDoc(doc(firestore, SHIFTS_COL, shiftId), {
      status: 'closed',
      endedAt: now,
      closedReason: 'admin_close',
    });
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error?.message || 'No se pudo cerrar el turno.' };
  }
}

/**
 * Admin: soft-elimina el turno y sus unidades/pausas.
 * Archiva snapshots en talladoShiftDeletes / talladoUnitDeletes antes de marcar deletedAt.
 * No toca recepción ni transferencias.
 */
export async function adminDeleteTalladoShift(
  shiftId: string,
  actor?: TalladoDeleteActor
): Promise<{
  success: boolean;
  deletedUnits?: number;
  deletedPauses?: number;
  archived?: boolean;
  error?: string;
}> {
  try {
    if (!shiftId) return { success: false, error: 'Turno inválido.' };
    const shiftRef = doc(firestore, SHIFTS_COL, shiftId);
    const snap = await getDoc(shiftRef);
    if (!snap.exists()) return { success: false, error: 'El turno no existe.' };
    const shift = { id: snap.id, ...snap.data() } as TalladoShift;
    if (isTalladoSoftDeleted(shift)) {
      return { success: true, deletedUnits: 0, deletedPauses: 0, archived: true };
    }

    const [unitsSnap, pausesSnap] = await Promise.all([
      getDocs(query(collection(firestore, UNITS_COL), where('shiftId', '==', shiftId), limit(1000))),
      getDocs(query(collection(firestore, PAUSES_COL), where('shiftId', '==', shiftId), limit(500))),
    ]);
    const units = unitsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as TalladoUnit));
    const pauses = pausesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as TalladoPause));

    const meta = {
      deletedBy: actor?.deletedBy,
      deletedByEmail: actor?.deletedByEmail,
      deletedByName: actor?.deletedByName,
      reason: actor?.reason || 'Eliminación admin de turno',
      source: 'admin_delete_shift' as const,
    };

    // Archivar CADA unidad antes de soft-marcar el turno (nunca drop silencioso).
    let deletedUnits = 0;
    for (const u of units) {
      if (isTalladoSoftDeleted(u)) continue;
      await archiveAndSoftDeleteUnit(u, meta);
      deletedUnits += 1;
    }

    await archiveAndSoftDeleteShift(shift, pauses, {
      ...meta,
      unitIds: units.map((u) => u.id),
    });

    return {
      success: true,
      deletedUnits,
      deletedPauses: pauses.filter((p) => !isTalladoSoftDeleted(p)).length,
      archived: true,
    };
  } catch (error: any) {
    console.error('adminDeleteTalladoShift:', error);
    return { success: false, error: error?.message || 'No se pudo eliminar el turno.' };
  }
}

async function lookupCatalogForTallado(scanCode: string): Promise<TalladoTransferLookup | null> {
  const variants = talladoCodeVariants(scanCode);

  const indexedSnaps = await Promise.all(
    variants.map((variant) =>
      getDocs(
        query(
          collection(firestore, CATALOG_COL),
          where('codigoBarras', '==', variant),
          where('active', '==', true),
          limit(5)
        )
      ).catch(() => null)
    )
  );
  for (const snap of indexedSnaps) {
    if (snap && !snap.empty) {
      const item = { id: snap.docs[0].id, ...snap.docs[0].data() } as TalladoCatalogItem;
      return catalogToLookup(scanCode, item);
    }
  }

  // Fallback sin índice compuesto: buscar solo por código (paralelo)
  const plainSnaps = await Promise.all(
    variants.map((variant) =>
      getDocs(query(collection(firestore, CATALOG_COL), where('codigoBarras', '==', variant), limit(5)))
    )
  );
  for (const snap of plainSnaps) {
    if (!snap.empty) {
      const item = { id: snap.docs[0].id, ...snap.docs[0].data() } as TalladoCatalogItem;
      if (item.active === false) continue;
      return catalogToLookup(scanCode, item);
    }
  }

  return null;
}

export async function lookupTransferForTallado(
  rawCode: string,
  opts?: { receptionOperationId?: string }
): Promise<{
  success: boolean;
  data?: TalladoTransferLookup;
  candidates?: TalladoTransferLookup[];
  error?: string;
}> {
  try {
    const scanCode = normalizeTalladoScanCode(rawCode);
    if (!scanCode) return { success: false, error: 'Escanee un código válido.' };

    const receptionScope = String(opts?.receptionOperationId || '').trim();

    // Con RK elegida + # caja corto: SOLO cruce recepción.
    // Si no, TF/alternos con el mismo número (p.ej. 625) agregaban marcas ajenas
    // (NIKE+ADIDAS / FILA+ADIDAS) y el banner de caja correcta no aparecía.
    if (receptionScope && RECEPTION_BOX_NUMBER_RE.test(scanCode)) {
      const fromReception = await lookupReceptionBoxForTallado(scanCode, receptionScope);
      if (fromReception.success && fromReception.data) {
        return fromReception;
      }
      return {
        success: false,
        error:
          fromReception.error ||
          `No se encontró caja #${scanCode} en la recepción seleccionada.`,
      };
    }

    const col = collection(firestore, TRANSFERS_COL);
    const digits = scanCode.replace(/\D/g, '');
    const altVariants = talladoCodeVariants(scanCode, rawCode).filter((v) => v !== scanCode);

    // Primera oleada en paralelo: TF exacto, dígitos, alterno exacto
    const [byTf, byDigits, byAlt] = await Promise.all([
      getDocs(query(col, where('numeroTF', '==', scanCode), limit(50))),
      digits && digits !== scanCode
        ? getDocs(query(col, where('numeroTF', '==', digits), limit(50)))
        : Promise.resolve(null),
      getDocs(query(col, where('codigoAlterno', '==', scanCode), limit(50))),
    ]);

    if (!byTf.empty) {
      const docs = byTf.docs.map((d) => ({ id: d.id, ...d.data() } as TransferEntry));
      return { success: true, data: aggregateTransfers(scanCode, 'numeroTF', docs) };
    }
    if (byDigits && !byDigits.empty) {
      const docs = byDigits.docs.map((d) => ({ id: d.id, ...d.data() } as TransferEntry));
      return { success: true, data: aggregateTransfers(scanCode, 'numeroTF', docs) };
    }
    if (!byAlt.empty) {
      const docs = byAlt.docs.map((d) => ({ id: d.id, ...d.data() } as TransferEntry));
      return { success: true, data: aggregateTransfers(scanCode, 'codigoAlterno', docs) };
    }

    if (altVariants.length > 0) {
      const variantSnaps = await Promise.all(
        altVariants.map((variant) =>
          getDocs(query(col, where('codigoAlterno', '==', variant), limit(50)))
        )
      );
      for (const byVariant of variantSnaps) {
        if (!byVariant.empty) {
          const docs = byVariant.docs.map((d) => ({ id: d.id, ...d.data() } as TransferEntry));
          return { success: true, data: aggregateTransfers(scanCode, 'codigoAlterno', docs) };
        }
      }
    }

    const fromCatalog = await lookupCatalogForTallado(scanCode);
    if (fromCatalog) {
      return { success: true, data: fromCatalog };
    }

    // # caja sin RK: pedir recepción (no inventar match TF ya descartado arriba).
    if (RECEPTION_BOX_NUMBER_RE.test(scanCode)) {
      return {
        success: false,
        error:
          'Para tallar por # de caja elija primero la recepción (RK). El # se reinicia en cada operación.',
      };
    }

    return {
      success: false,
      error: `No se encontró el código "${scanCode}" en transferencias, catálogo ni recepción (# caja).`,
    };
  } catch (error: any) {
    console.error('lookupTransferForTallado:', error);
    return { success: false, error: error?.message || 'Error al buscar la transferencia.' };
  }
}

export async function startTalladoShift(input: {
  grupo: string;
  peopleCount: number;
  userId: string;
  userName: string;
}): Promise<{ success: boolean; data?: TalladoShift; rejoined?: boolean; error?: string }> {
  try {
    const grupo = String(input.grupo || '').trim();
    const peopleCount = Math.max(1, Math.round(Number(input.peopleCount) || 0));
    if (!grupo) return { success: false, error: 'Indique el grupo (ej. Grupo 1).' };
    if (!input.userId) return { success: false, error: 'Usuario no autenticado.' };

    const todayKey = talladoLocalDayKey();
    const now = new Date().toISOString();
    const grupoKey = normalizeGrupoKey(grupo);
    const active = await listActiveShifts();
    const sameGrupo = active.filter((s) => normalizeGrupoKey(s.grupo) === grupoKey);

    // Turnos activos de días anteriores: cerrar con dayKey; no reanudar ni borrar unidades.
    for (const stale of sameGrupo.filter((s) => !shiftBelongsToDay(s, todayKey))) {
      await closeShiftAsDayRollover(stale);
    }

    const sameGrupoToday = sameGrupo
      .filter((s) => shiftBelongsToDay(s, todayKey))
      .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));

    if (sameGrupoToday.length > 0) {
      const kept = sameGrupoToday[0];
      // Cerrar turnos activos duplicados del mismo grupo hoy (deja el más viejo)
      for (const dup of sameGrupoToday.slice(1)) {
        await updateDoc(doc(firestore, SHIFTS_COL, dup.id), {
          status: 'closed',
          endedAt: now,
          closedReason: 'duplicate_grupo',
        });
      }
      const patch: Record<string, unknown> = {};
      if (peopleCount !== kept.peopleCount) patch.peopleCount = peopleCount;
      if (!kept.dayKey) patch.dayKey = todayKey;
      if (Object.keys(patch).length > 0) {
        await updateDoc(doc(firestore, SHIFTS_COL, kept.id), patch);
        if (patch.peopleCount != null) kept.peopleCount = peopleCount;
        if (patch.dayKey) kept.dayKey = todayKey;
      }
      return { success: true, data: { ...kept, grupo }, rejoined: true };
    }

    const ref = doc(collection(firestore, SHIFTS_COL));
    const row: TalladoShift = {
      id: ref.id,
      grupo,
      peopleCount,
      userId: input.userId,
      userName: input.userName || 'Operario',
      startedAt: now,
      dayKey: todayKey,
      status: 'active',
    };
    try {
      await setDoc(ref, stripUndefinedDeep(row) as TalladoShift);
    } catch (writeErr: any) {
      console.error('startTalladoShift write failed:', writeErr);
      return {
        success: false,
        error: writeErr?.message || 'Error al guardar el turno en Firestore. Reintente.',
      };
    }
    return { success: true, data: row, rejoined: false };
  } catch (error: any) {
    return { success: false, error: error?.message || 'No se pudo iniciar el turno.' };
  }
}

/** Grupos activos del día (Bogotá). Cierra residuos de días previos. */
export async function listTalladoActiveShiftsForDay(dayKey?: string): Promise<{
  success: boolean;
  data?: TalladoShift[];
  error?: string;
}> {
  try {
    const key = dayKey || talladoLocalDayKey();
    const active = await listActiveShifts();
    const today: TalladoShift[] = [];
    for (const s of active) {
      if (shiftBelongsToDay(s, key)) {
        if (!s.dayKey) {
          try {
            await updateDoc(doc(firestore, SHIFTS_COL, s.id), { dayKey: key });
            s.dayKey = key;
          } catch {
            // Seguir listando aunque el backfill falle
          }
        }
        today.push(s);
      } else {
        try {
          await closeShiftAsDayRollover(s);
        } catch {
          // No bloquear el listado si un cierre falla
        }
      }
    }
    today.sort(
      (a, b) =>
        String(a.grupo).localeCompare(String(b.grupo), 'es') ||
        String(a.startedAt).localeCompare(String(b.startedAt))
    );
    return { success: true, data: today };
  } catch (error: any) {
    return { success: false, error: error?.message || 'No se pudieron listar los turnos del día.' };
  }
}

/** Entrar a un turno ya activo de hoy (sin recrear). */
export async function enterTalladoShift(shiftId: string): Promise<{
  success: boolean;
  data?: TalladoShift;
  error?: string;
}> {
  try {
    if (!shiftId) return { success: false, error: 'Turno inválido.' };
    const { getDoc } = await import('firebase/firestore');
    const snap = await getDoc(doc(firestore, SHIFTS_COL, shiftId));
    if (!snap.exists()) return { success: false, error: 'El turno no existe.' };
    const shift = { id: snap.id, ...snap.data() } as TalladoShift;
    const todayKey = talladoLocalDayKey();
    if (shift.status !== 'active') {
      return { success: false, error: 'Ese turno ya no está activo.' };
    }
    if (!shiftBelongsToDay(shift, todayKey)) {
      await closeShiftAsDayRollover(shift);
      return { success: false, error: 'Ese turno es de otro día. Cree uno nuevo para hoy.' };
    }
    if (!shift.dayKey) {
      await updateDoc(doc(firestore, SHIFTS_COL, shift.id), { dayKey: todayKey });
      shift.dayKey = todayKey;
    }
    return { success: true, data: shift };
  } catch (error: any) {
    return { success: false, error: error?.message || 'No se pudo entrar al turno.' };
  }
}

export async function getTalladoShift(
  shiftId: string
): Promise<{ success: boolean; data?: TalladoShift | null; error?: string }> {
  try {
    if (!shiftId) return { success: false, error: 'Turno inválido.' };
    const { getDoc } = await import('firebase/firestore');
    const d = await getDoc(doc(firestore, SHIFTS_COL, shiftId));
    if (!d.exists()) return { success: true, data: null };
    return { success: true, data: { id: d.id, ...d.data() } as TalladoShift };
  } catch (error: any) {
    return { success: false, error: error?.message || 'Error al cargar el turno.' };
  }
}

export async function listTalladoShiftBundle(shiftId: string): Promise<{
  success: boolean;
  shift?: TalladoShift | null;
  units?: TalladoUnit[];
  pauses?: TalladoPause[];
  error?: string;
}> {
  try {
    if (!shiftId) return { success: false, error: 'Turno inválido.' };
    const { getDoc } = await import('firebase/firestore');
    const shiftSnap = await getDoc(doc(firestore, SHIFTS_COL, shiftId));
    if (!shiftSnap.exists()) return { success: true, shift: null, units: [], pauses: [] };

    const [unitsSnap, pausesSnap] = await Promise.all([
      getDocs(query(collection(firestore, UNITS_COL), where('shiftId', '==', shiftId), limit(500))),
      getDocs(query(collection(firestore, PAUSES_COL), where('shiftId', '==', shiftId), limit(200))),
    ]);

    const units = unitsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() } as TalladoUnit))
      .filter((u) => !isTalladoSoftDeleted(u))
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
    const pauses = pausesSnap.docs
      .map((d) => ({ id: d.id, ...d.data() } as TalladoPause))
      .filter((p) => !isTalladoSoftDeleted(p))
      .sort((a, b) => String(b.pausedAt).localeCompare(String(a.pausedAt)));

    const shiftData = { id: shiftSnap.id, ...shiftSnap.data() } as TalladoShift;
    if (isTalladoSoftDeleted(shiftData)) {
      return { success: true, shift: null, units: [], pauses: [] };
    }

    return {
      success: true,
      shift: shiftData,
      units,
      pauses,
    };
  } catch (error: any) {
    console.error('listTalladoShiftBundle:', error);
    return { success: false, error: error?.message || 'Error al cargar el turno.' };
  }
}

function resolveTalladoSource(lookup: TalladoTransferLookup): TalladoUnit['source'] {
  return (
    lookup.source ||
    (lookup.matchedBy === 'catalogo'
      ? 'catalogo'
      : lookup.matchedBy === 'recepcion_caja'
        ? 'recepcion'
        : 'transfers')
  );
}

function isLookupAlreadyDone(prior: TalladoUnit[], lookup: TalladoTransferLookup, scanCode: string) {
  return prior.find((u) => {
    if (u.status !== 'done') return false;
    if (lookup.packingUnitId) return u.packingUnitId === lookup.packingUnitId;
    return !u.packingUnitId && unitMatchesScanCode(u, scanCode);
  });
}

/**
 * Confirma una unidad en un solo paso (done inmediato).
 * El ritmo del reporte lo marca la jornada del grupo; aquí solo suma cantidad.
 */
export async function confirmTalladoUnitFromLookup(input: {
  shiftId: string;
  lookup: TalladoTransferLookup;
  userId: string;
  userName: string;
  grupo: string;
  skipOpenPauseCheck?: boolean;
  /** Check del operario; si no viene, se sugiere según el camino (source). */
  etiquetadoModo?: TalladoEtiquetadoModo | null;
}): Promise<{ success: boolean; data?: TalladoUnit; error?: string }> {
  try {
    if (!input.shiftId) return { success: false, error: 'Sin turno activo.' };
    const gate = await requireActiveShiftForToday(input.shiftId);
    if (!gate.ok) return { success: false, error: gate.error };
    const scanCode = normalizeTalladoScanCode(input.lookup.scanCode);
    if (!scanCode) return { success: false, error: 'Código inválido.' };

    if (!input.skipOpenPauseCheck) {
      const openPause = await getDocs(
        query(
          collection(firestore, PAUSES_COL),
          where('shiftId', '==', input.shiftId),
          where('status', '==', 'open'),
          limit(1)
        )
      );
      if (!openPause.empty) {
        return { success: false, error: 'El grupo está en pausa. Reanude antes de escanear.' };
      }
    }

    const prior = await findUnitsMatchingCode(scanCode);
    const openUnits = prior.filter((u) => u.status === 'in_progress');
    if (openUnits.length > 0) {
      const existing = openUnits[0];
      return {
        success: false,
        error: `El código ${existing.scanCode} quedó abierto (legado). Escanee de nuevo para cerrarlo y luego registre uno nuevo.`,
      };
    }

    const doneSame = isLookupAlreadyDone(prior, input.lookup, scanCode);
    if (doneSame) {
      return { success: false, error: alreadyDoneError(doneSame) };
    }

    const source = resolveTalladoSource(input.lookup);
    const etiquetadoModo = resolveTalladoEtiquetadoModo(
      input.etiquetadoModo ?? input.lookup.etiquetadoModo,
      source
    );

    let cantidad = Math.max(0, Number(input.lookup.cantidad) || 0);
    let referencia = input.lookup.referencia;
    let numeroTF = input.lookup.numeroTF;
    let packingUnitId = input.lookup.packingUnitId;
    let codigoAlterno = input.lookup.codigoAlterno;
    const receptionOperationId = input.lookup.receptionOperationId;

    // Re-resuelve qty en servidor si el lookup llegó en 0 (stats incompletos / ID hint).
    if (
      source === 'recepcion' &&
      receptionOperationId &&
      cantidad <= 0
    ) {
      const resolved = await resolveReceptionBoxQty(
        receptionOperationId,
        String(packingUnitId || codigoAlterno || '').trim(),
        {
          unitNumber:
            input.lookup.unitNumber != null
              ? Number(input.lookup.unitNumber)
              : Number(scanCode) || undefined,
        }
      );
      if (resolved.qty > 0) {
        cantidad = resolved.qty;
        if (resolved.refs.length) {
          referencia = resolved.refs.join(', ');
          numeroTF = resolved.refs[0] || numeroTF;
        }
        if (resolved.packingUnitId) {
          packingUnitId = resolved.packingUnitId;
          codigoAlterno = resolved.packingUnitId;
        }
      }
    }

    const now = new Date().toISOString();
    const dayKey = talladoLocalDayKey(new Date(now));
    const ref = doc(collection(firestore, UNITS_COL));
    const row: TalladoUnit = {
      id: ref.id,
      shiftId: input.shiftId,
      grupo: input.grupo,
      scanCode,
      transferIds: input.lookup.transferIds || [],
      numeroTF,
      codigoAlterno,
      bodegaDestino: input.lookup.bodegaDestino || DEFAULT_DESTINO_SIN_REMISION,
      bodegaOrigen: input.lookup.bodegaOrigen,
      marca: input.lookup.marca,
      grupoMercancia: input.lookup.grupoMercancia,
      source,
      referencia,
      talla: input.lookup.talla,
      cantidad,
      startedAt: now,
      endedAt: now,
      dayKey,
      durationMs: 0,
      durationNetMs: 0,
      userId: input.userId,
      userName: input.userName || 'Operario',
      status: 'done',
      unitNumber: input.lookup.unitNumber,
      packingUnitId,
      receptionOperationId,
      rkIdentifier: input.lookup.rkIdentifier,
      yaEtiquetada: input.lookup.yaEtiquetada,
      etiquetadoModo,
    };
    try {
      await setDoc(ref, stripUndefinedDeep(row) as TalladoUnit);
    } catch (writeErr: any) {
      console.error('confirmTalladoUnitFromLookup write failed:', writeErr);
      return {
        success: false,
        error:
          writeErr?.message ||
          'Error al guardar la lectura en Firestore. No se confirmó el escaneo; reintente.',
      };
    }
    return { success: true, data: row };
  } catch (error: any) {
    console.error('confirmTalladoUnitFromLookup:', error);
    return { success: false, error: error?.message || 'No se pudo confirmar la unidad.' };
  }
}

export async function startTalladoUnit(input: {
  shiftId: string;
  lookup: TalladoTransferLookup;
  userId: string;
  userName: string;
  grupo: string;
  /** Si el cliente ya sabe que no hay pausa abierta, evita 1 lectura. */
  skipOpenPauseCheck?: boolean;
  etiquetadoModo?: TalladoEtiquetadoModo | null;
}): Promise<{ success: boolean; data?: TalladoUnit; error?: string }> {
  // Compat: el flujo operario usa confirmación en un escaneo.
  return confirmTalladoUnitFromLookup(input);
}

/** Cambia modo etiquetado (costos) en una unidad ya cerrada. */
export async function updateTalladoUnitEtiquetadoModo(input: {
  unitId: string;
  etiquetadoModo: TalladoEtiquetadoModo | null;
}): Promise<{ success: boolean; data?: TalladoUnit; error?: string }> {
  try {
    if (!input.unitId) return { success: false, error: 'Unidad inválida.' };
    const ref = doc(firestore, UNITS_COL, input.unitId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return { success: false, error: 'La unidad no existe.' };
    const current = { id: snap.id, ...snap.data() } as TalladoUnit;
    const modo = resolveTalladoEtiquetadoModo(input.etiquetadoModo, current.source);
    if (modo) {
      await updateDoc(ref, { etiquetadoModo: modo });
      return { success: true, data: { ...current, etiquetadoModo: modo } };
    }
    await updateDoc(ref, { etiquetadoModo: deleteField() });
    const { etiquetadoModo: _removed, ...rest } = current;
    return { success: true, data: rest as TalladoUnit };
  } catch (error: any) {
    return { success: false, error: error?.message || 'No se pudo actualizar el modo de etiquetado.' };
  }
}

/**
 * Recalcula cantidad (y ref) de una unidad de cruce recepción con qty 0 / incorrecta.
 * Usa packUnitsById o escaneos; no toca recepción.
 */
export async function repairTalladoUnitReceptionQty(unitId: string): Promise<{
  success: boolean;
  data?: TalladoUnit;
  error?: string;
}> {
  try {
    if (!unitId) return { success: false, error: 'Unidad inválida.' };
    const ref = doc(firestore, UNITS_COL, unitId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return { success: false, error: 'La unidad no existe.' };
    const unit = { id: snap.id, ...snap.data() } as TalladoUnit;
    const receptionId = String(unit.receptionOperationId || '').trim();
    const packingUnitHint = String(unit.packingUnitId || unit.codigoAlterno || '').trim();
    const unitNumber =
      unit.unitNumber != null && Number.isFinite(Number(unit.unitNumber))
        ? Number(unit.unitNumber)
        : Number(unit.scanCode) || undefined;
    if (!receptionId || (!packingUnitHint && !(unitNumber && unitNumber >= 1))) {
      return { success: false, error: 'Esta unidad no es de cruce recepción (falta RK/caja).' };
    }
    const resolved = await resolveReceptionBoxQty(receptionId, packingUnitHint, { unitNumber });
    if (resolved.qty <= 0) {
      return {
        success: false,
        error:
          'No se encontró cantidad en recepción para esa caja (packUnitsById / escaneos / plan etiquetado).',
      };
    }
    const referencia = resolved.refs.length ? resolved.refs.join(', ') : unit.referencia;
    const numeroTF = resolved.refs[0] || unit.numeroTF;
    const packingUnitId = resolved.packingUnitId || packingUnitHint || unit.packingUnitId;
    await updateDoc(ref, {
      cantidad: resolved.qty,
      ...(referencia ? { referencia } : {}),
      ...(numeroTF ? { numeroTF } : {}),
      ...(packingUnitId
        ? { packingUnitId, codigoAlterno: packingUnitId }
        : {}),
      ...(unitNumber != null && Number.isFinite(unitNumber) && !unit.unitNumber
        ? { unitNumber }
        : {}),
    });
    return {
      success: true,
      data: {
        ...unit,
        cantidad: resolved.qty,
        referencia: referencia || unit.referencia,
        numeroTF: numeroTF || unit.numeroTF,
        packingUnitId: packingUnitId || unit.packingUnitId,
        codigoAlterno: packingUnitId || unit.codigoAlterno,
        unitNumber: unit.unitNumber ?? unitNumber,
      },
    };
  } catch (error: any) {
    return { success: false, error: error?.message || 'No se pudo corregir la cantidad.' };
  }
}

/** Corrige todas las unidades de recepción con cantidad 0 de un turno. */
export async function repairTalladoShiftReceptionQtys(shiftId: string): Promise<{
  success: boolean;
  fixed?: number;
  skipped?: number;
  error?: string;
}> {
  try {
    if (!shiftId) return { success: false, error: 'Turno inválido.' };
    const snap = await getDocs(
      query(collection(firestore, UNITS_COL), where('shiftId', '==', shiftId), limit(500))
    );
    let fixed = 0;
    let skipped = 0;
    for (const d of snap.docs) {
      const u = { id: d.id, ...d.data() } as TalladoUnit;
      if (u.source !== 'recepcion') continue;
      if (Number(u.cantidad) > 0) continue;
      const res = await repairTalladoUnitReceptionQty(u.id);
      if (res.success) fixed += 1;
      else skipped += 1;
    }
    return { success: true, fixed, skipped };
  } catch (error: any) {
    return { success: false, error: error?.message || 'No se pudieron corregir las cantidades.' };
  }
}

/**
 * Admin/supervisor: fija manualmente la cantidad de una unidad (p. ej. caja recepción
 * tallada por menos und. que el plan). No toca recepción.
 */
export async function adminUpdateTalladoUnitCantidad(input: {
  unitId: string;
  cantidad: number;
}): Promise<{ success: boolean; data?: TalladoUnit; error?: string }> {
  try {
    if (!input.unitId) return { success: false, error: 'Unidad inválida.' };
    const qty = Math.round(Number(input.cantidad));
    if (!Number.isFinite(qty) || qty < 0) {
      return { success: false, error: 'Cantidad inválida (use un número ≥ 0).' };
    }
    const ref = doc(firestore, UNITS_COL, input.unitId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return { success: false, error: 'La unidad no existe.' };
    const current = { id: snap.id, ...snap.data() } as TalladoUnit;
    await updateDoc(ref, { cantidad: qty });
    return { success: true, data: { ...current, cantidad: qty } };
  } catch (error: any) {
    return { success: false, error: error?.message || 'No se pudo actualizar la cantidad.' };
  }
}

/**
 * Admin/supervisor: soft-elimina un registro de unidad (archiva en talladoUnitDeletes).
 * No toca recepción.
 */
export async function adminDeleteTalladoUnit(
  unitId: string,
  actor?: TalladoDeleteActor
): Promise<{
  success: boolean;
  archived?: boolean;
  error?: string;
}> {
  try {
    if (!unitId) return { success: false, error: 'Unidad inválida.' };
    const ref = doc(firestore, UNITS_COL, unitId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return { success: false, error: 'La unidad no existe.' };
    const unit = { id: snap.id, ...snap.data() } as TalladoUnit;
    if (isTalladoSoftDeleted(unit)) return { success: true, archived: true };
    await archiveAndSoftDeleteUnit(unit, {
      deletedBy: actor?.deletedBy,
      deletedByEmail: actor?.deletedByEmail,
      deletedByName: actor?.deletedByName,
      reason: actor?.reason || 'Eliminación admin de unidad',
      source: 'admin_delete',
    });
    return { success: true, archived: true };
  } catch (error: any) {
    console.error('adminDeleteTalladoUnit:', error);
    return { success: false, error: error?.message || 'No se pudo eliminar el registro.' };
  }
}

export async function finishTalladoUnit(input: {
  shiftId: string;
  scanCode: string;
  /** Si ya se resolvió la unidad abierta, evita re-consultar. */
  unit?: TalladoUnit;
  openMatches?: TalladoUnit[];
}): Promise<{ success: boolean; data?: TalladoUnit; error?: string }> {
  try {
    const scanCode = normalizeTalladoScanCode(input.scanCode);
    if (!input.shiftId || !scanCode) return { success: false, error: 'Datos incompletos.' };

    const matches =
      input.openMatches && input.openMatches.length > 0
        ? input.openMatches.filter((u) => !isTalladoSoftDeleted(u))
        : input.unit
          ? [input.unit].filter((u) => !isTalladoSoftDeleted(u))
          : await findInProgressUnitsByCode(scanCode);

    if (matches.length === 0) {
      return { success: false, error: 'No hay Inicio abierto para este código.' };
    }

    // Preferir unidad del turno actual; si no, la más antigua
    const unit =
      input.unit && !isTalladoSoftDeleted(input.unit)
        ? input.unit
        : matches.find((u) => u.shiftId === input.shiftId) || matches[0];
    const endedAt = new Date().toISOString();
    const durationMs = Math.max(0, new Date(endedAt).getTime() - new Date(unit.startedAt).getTime());
    const dayKey = unit.dayKey || talladoLocalDayKey(new Date(unit.startedAt));

    // Pausas: solo las del turno de la unidad (límite bajo para no colgar el cierre).
    const pausesSnap = await getDocs(
      query(
        collection(firestore, PAUSES_COL),
        where('shiftId', '==', unit.shiftId),
        limit(80)
      )
    );
    const pauses = pausesSnap.docs
      .map((d) => d.data() as TalladoPause)
      .filter((p) => !isTalladoSoftDeleted(p));
    const durationNetMs = computeNetDurationMs(unit.startedAt, endedAt, pauses);

    const patch = {
      endedAt,
      durationMs,
      durationNetMs,
      status: 'done' as const,
      dayKey,
      shiftId: unit.shiftId || input.shiftId,
      startedAt: unit.startedAt,
    };
    try {
      await updateDoc(doc(firestore, UNITS_COL, unit.id), patch);
    } catch (writeErr: any) {
      console.error('finishTalladoUnit write failed:', writeErr);
      return {
        success: false,
        error:
          writeErr?.message ||
          'Error al guardar el cierre en Firestore. No se confirmó el Fin; reintente.',
      };
    }

    // Duplicados abiertos del mismo código: solo in_progress; archivar antes de soft-borrar.
    const dups = matches.filter((dup) => dup.id !== unit.id && dup.status === 'in_progress');
    for (const dup of dups) {
      try {
        await archiveAndSoftDeleteUnit(dup, {
          source: 'finish_dup_cleanup',
          reason: `Duplicado in_progress al cerrar ${unit.scanCode}`,
          deletedBy: unit.userId,
          deletedByName: unit.userName,
        });
      } catch (dupErr) {
        console.error('finishTalladoUnit dup archive failed:', dupErr);
      }
    }

    return { success: true, data: { ...unit, ...patch } };
  } catch (error: any) {
    console.error('finishTalladoUnit:', error);
    return { success: false, error: error?.message || 'No se pudo cerrar la unidad.' };
  }
}

/** Escaneo: 1 lectura confirma la unidad (done). Si hay in_progress legado → cierra Fin. */
export async function scanTalladoCode(input: {
  shiftId: string;
  rawCode: string;
  userId: string;
  userName: string;
  grupo: string;
  autoStart?: boolean;
  /** Recepción fija para # caja (obligatoria en cruce recepción). */
  receptionOperationId?: string;
  /** Check del operario (null/omit = sugerir según camino). */
  etiquetadoModo?: TalladoEtiquetadoModo | null;
}): Promise<{
  success: boolean;
  action?: 'finished' | 'confirmed' | 'pick_reception' | 'ready_to_start' | 'auto_started';
  lookup?: TalladoTransferLookup;
  candidates?: TalladoTransferLookup[];
  unit?: TalladoUnit;
  error?: string;
}> {
  try {
    const scanCode = normalizeTalladoScanCode(input.rawCode);
    if (!scanCode) return { success: false, error: 'Código vacío.' };

    const prior = await findUnitsMatchingCode(scanCode);
    const openMatches = prior
      .filter((u) => u.status === 'in_progress')
      .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));

    // Compat unidades abiertas del modelo Inicio/Fin anterior.
    if (openMatches.length > 0) {
      const fin = await finishTalladoUnit({
        shiftId: input.shiftId,
        scanCode: openMatches[0].scanCode || scanCode,
        unit: openMatches.find((u) => u.shiftId === input.shiftId) || openMatches[0],
        openMatches,
      });
      if (!fin.success) return { success: false, error: fin.error };
      return { success: true, action: 'finished', unit: fin.data };
    }

    const lookup = await lookupTransferForTallado(scanCode, {
      receptionOperationId: input.receptionOperationId,
    });
    if (!lookup.success) return { success: false, error: lookup.error };

    if (lookup.candidates && lookup.candidates.length > 1 && !lookup.data) {
      return {
        success: true,
        action: 'pick_reception',
        candidates: lookup.candidates,
        error: lookup.error,
      };
    }

    if (!lookup.data) return { success: false, error: lookup.error || 'Sin datos de lookup.' };

    const doneSame = isLookupAlreadyDone(prior, lookup.data, scanCode);
    if (doneSame) {
      return { success: false, error: alreadyDoneError(doneSame) };
    }

    const confirmed = await confirmTalladoUnitFromLookup({
      shiftId: input.shiftId,
      lookup: lookup.data,
      userId: input.userId,
      userName: input.userName,
      grupo: input.grupo,
      etiquetadoModo: input.etiquetadoModo,
    });
    if (!confirmed.success) {
      return { success: false, error: confirmed.error, lookup: lookup.data };
    }
    return {
      success: true,
      action: 'confirmed',
      lookup: lookup.data,
      unit: confirmed.data,
    };
  } catch (error: any) {
    return { success: false, error: error?.message || 'Error al procesar el escaneo.' };
  }
}

export async function startTalladoPause(input: {
  shiftId: string;
  grupo: string;
  type: TalladoPauseType;
  note?: string;
  userId: string;
  userName: string;
}): Promise<{ success: boolean; data?: TalladoPause; error?: string }> {
  try {
    if (!input.shiftId) return { success: false, error: 'Sin turno activo.' };
    const gate = await requireActiveShiftForToday(input.shiftId);
    if (!gate.ok) return { success: false, error: gate.error };
    if (input.type === 'otros' && !String(input.note || '').trim()) {
      return { success: false, error: 'En “Otros” indique el motivo de la pausa.' };
    }

    const openPause = await getDocs(
      query(
        collection(firestore, PAUSES_COL),
        where('shiftId', '==', input.shiftId),
        where('status', '==', 'open'),
        limit(1)
      )
    );
    if (!openPause.empty) {
      return { success: false, error: 'Ya hay una pausa abierta. Reanude antes de iniciar otra.' };
    }

    const now = new Date().toISOString();
    const ref = doc(collection(firestore, PAUSES_COL));
    const row: TalladoPause = {
      id: ref.id,
      shiftId: input.shiftId,
      grupo: input.grupo,
      type: input.type,
      note: input.type === 'otros' ? String(input.note || '').trim() : input.note?.trim() || undefined,
      pausedAt: now,
      userId: input.userId,
      userName: input.userName || 'Operario',
      status: 'open',
    };
    await setDoc(ref, stripUndefinedDeep(row) as TalladoPause);

    if (input.type === 'fin_jornada') {
      const todayKey = talladoLocalDayKey();
      await updateDoc(doc(firestore, SHIFTS_COL, input.shiftId), {
        endedAt: now,
        status: 'closed',
        dayKey: gate.shift.dayKey || todayKey,
        closedReason: 'fin_jornada',
      });
    }

    return { success: true, data: row };
  } catch (error: any) {
    return { success: false, error: error?.message || 'No se pudo iniciar la pausa.' };
  }
}

export async function resumeTalladoPause(
  shiftId: string
): Promise<{ success: boolean; data?: TalladoPause; error?: string }> {
  try {
    const openPause = await getDocs(
      query(
        collection(firestore, PAUSES_COL),
        where('shiftId', '==', shiftId),
        where('status', '==', 'open'),
        limit(1)
      )
    );
    if (openPause.empty) return { success: false, error: 'No hay pausa abierta.' };

    const pauseDoc = openPause.docs[0];
    const pause = { id: pauseDoc.id, ...pauseDoc.data() } as TalladoPause;
    const resumedAt = new Date().toISOString();
    const durationMs = Math.max(
      0,
      new Date(resumedAt).getTime() - new Date(pause.pausedAt).getTime()
    );
    const patch = { resumedAt, durationMs, status: 'closed' as const };
    await updateDoc(doc(firestore, PAUSES_COL, pause.id), patch);
    return { success: true, data: { ...pause, ...patch } };
  } catch (error: any) {
    return { success: false, error: error?.message || 'No se pudo reanudar.' };
  }
}

async function fetchTalladoShiftsByIds(ids: string[]): Promise<TalladoShift[]> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return [];
  const out: TalladoShift[] = [];
  for (let i = 0; i < unique.length; i += 10) {
    const chunk = unique.slice(i, i + 10);
    const snap = await getDocs(
      query(collection(firestore, SHIFTS_COL), where(documentId(), 'in', chunk))
    );
    snap.docs.forEach((d) => out.push({ id: d.id, ...d.data() } as TalladoShift));
  }
  return out;
}

/**
 * Carga turnos/unidades/pausas del día.
 * 1) Rango ISO Bogotá (rápido).
 * 2) Si vacío o falla: pagina por startedAt desc hasta pasar el día (cubre histórico).
 */
async function loadTalladoCollectionsForDay(dayKey: string): Promise<{
  shifts: TalladoShift[];
  units: TalladoUnit[];
  pauses: TalladoPause[];
}> {
  const { startMs, endMs } = talladoBogotaDayBounds(dayKey);
  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(endMs).toISOString();

  const toMs = (value: unknown): number => {
    if (!value) return NaN;
    if (typeof value === 'string' || typeof value === 'number') {
      const t = new Date(value).getTime();
      return Number.isFinite(t) ? t : NaN;
    }
    if (value instanceof Date) return value.getTime();
    if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
      try {
        return (value as { toDate: () => Date }).toDate().getTime();
      } catch {
        return NaN;
      }
    }
    return NaN;
  };

  const inDay = (iso: unknown) => {
    const ms = toMs(iso);
    return Number.isFinite(ms) && ms >= startMs && ms <= endMs;
  };

  // --- Fast path: queries por rango ---
  try {
    const [shiftsByStart, shiftsByDayKey, unitsByStart, unitsByEnd, pausesSnap] = await Promise.all([
      getDocs(
        query(
          collection(firestore, SHIFTS_COL),
          where('startedAt', '>=', startIso),
          where('startedAt', '<=', endIso),
          limit(500)
        )
      ),
      getDocs(
        query(collection(firestore, SHIFTS_COL), where('dayKey', '==', dayKey), limit(500))
      ).catch(() => null),
      getDocs(
        query(
          collection(firestore, UNITS_COL),
          where('startedAt', '>=', startIso),
          where('startedAt', '<=', endIso),
          limit(3000)
        )
      ),
      getDocs(
        query(
          collection(firestore, UNITS_COL),
          where('endedAt', '>=', startIso),
          where('endedAt', '<=', endIso),
          limit(1500)
        )
      ).catch(() => null),
      getDocs(
        query(
          collection(firestore, PAUSES_COL),
          where('pausedAt', '>=', startIso),
          where('pausedAt', '<=', endIso),
          limit(1500)
        )
      ),
    ]);

    const shiftMap = new Map<string, TalladoShift>();
    for (const d of shiftsByStart.docs) {
      shiftMap.set(d.id, { id: d.id, ...d.data() } as TalladoShift);
    }
    if (shiftsByDayKey) {
      for (const d of shiftsByDayKey.docs) {
        shiftMap.set(d.id, { id: d.id, ...d.data() } as TalladoShift);
      }
    }
    const unitMap = new Map<string, TalladoUnit>();
    for (const d of unitsByStart.docs) {
      unitMap.set(d.id, { id: d.id, ...d.data() } as TalladoUnit);
    }
    if (unitsByEnd) {
      for (const d of unitsByEnd.docs) {
        unitMap.set(d.id, { id: d.id, ...d.data() } as TalladoUnit);
      }
    }
    const pauses = pausesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as TalladoPause));

    // Solo cortocircuitar si ya hay unidades del día. Si solo llegaron turnos
    // (p.ej. por dayKey) pero 0 units, hay que paginar: el rango por startedAt
    // a veces no matchea ISO legacy y el dashboard quedaba en 0 und (días 12/14).
    // Turnos multi-día (sin dayKey / startedAt de otro día) se recuperan por shiftId
    // de las unidades: el dashboard no depende de dayKey del turno.
    if (unitMap.size > 0) {
      const units = filterActiveTalladoUnits(Array.from(unitMap.values()));
      const missingIds = Array.from(
        new Set(
          units
            .map((u) => u.shiftId)
            .filter((id): id is string => !!id && !shiftMap.has(id))
        )
      );
      if (missingIds.length > 0) {
        for (const s of await fetchTalladoShiftsByIds(missingIds)) {
          shiftMap.set(s.id, s);
        }
      }
      return {
        shifts: filterActiveTalladoShifts(Array.from(shiftMap.values())),
        units,
        pauses: filterActiveTalladoPauses(pauses),
      };
    }
  } catch (err) {
    console.warn('loadTalladoCollectionsForDay range failed, paging:', err);
  }

  // --- Fallback: paginar hacia atrás en el tiempo hasta pasar el día ---
  const shiftMap = new Map<string, TalladoShift>();
  const unitMap = new Map<string, TalladoUnit>();
  const pauseMap = new Map<string, TalladoPause>();

  const pageUnits = async () => {
    let cursor: Awaited<ReturnType<typeof getDocs>>['docs'][number] | null = null;
    for (let page = 0; page < 50; page++) {
      const q = cursor
        ? query(
            collection(firestore, UNITS_COL),
            orderBy('startedAt', 'desc'),
            startAfter(cursor),
            limit(400)
          )
        : query(collection(firestore, UNITS_COL), orderBy('startedAt', 'desc'), limit(400));
      const snap = await getDocs(q);
      if (snap.empty) break;
      for (const d of snap.docs) {
        const u = { id: d.id, ...d.data() } as TalladoUnit;
        if (
          isTalladoSameLocalDay(u.startedAt, dayKey) ||
          isTalladoSameLocalDay(u.endedAt, dayKey) ||
          inDay(u.startedAt) ||
          inDay(u.endedAt)
        ) {
          unitMap.set(d.id, u);
        }
      }
      cursor = snap.docs[snap.docs.length - 1];
      const oldestMs = toMs((cursor.data() as TalladoUnit).startedAt);
      if (Number.isFinite(oldestMs) && oldestMs < startMs) break;
    }
  };

  const pageShifts = async () => {
    let cursor: Awaited<ReturnType<typeof getDocs>>['docs'][number] | null = null;
    for (let page = 0; page < 30; page++) {
      const q = cursor
        ? query(
            collection(firestore, SHIFTS_COL),
            orderBy('startedAt', 'desc'),
            startAfter(cursor),
            limit(200)
          )
        : query(collection(firestore, SHIFTS_COL), orderBy('startedAt', 'desc'), limit(200));
      const snap = await getDocs(q);
      if (snap.empty) break;
      for (const d of snap.docs) {
        const s = { id: d.id, ...d.data() } as TalladoShift;
        if (shiftBelongsToDay(s, dayKey) || isTalladoSameLocalDay(s.startedAt, dayKey) || inDay(s.startedAt)) {
          shiftMap.set(d.id, s);
        }
      }
      cursor = snap.docs[snap.docs.length - 1];
      const oldestMs = toMs((cursor.data() as TalladoShift).startedAt);
      if (Number.isFinite(oldestMs) && oldestMs < startMs) break;
    }
  };

  const pagePauses = async () => {
    let cursor: Awaited<ReturnType<typeof getDocs>>['docs'][number] | null = null;
    for (let page = 0; page < 30; page++) {
      const q = cursor
        ? query(
            collection(firestore, PAUSES_COL),
            orderBy('pausedAt', 'desc'),
            startAfter(cursor),
            limit(300)
          )
        : query(collection(firestore, PAUSES_COL), orderBy('pausedAt', 'desc'), limit(300));
      const snap = await getDocs(q);
      if (snap.empty) break;
      for (const d of snap.docs) {
        const p = { id: d.id, ...d.data() } as TalladoPause;
        if (isTalladoSameLocalDay(p.pausedAt, dayKey) || inDay(p.pausedAt)) {
          pauseMap.set(d.id, p);
        }
      }
      cursor = snap.docs[snap.docs.length - 1];
      const oldestMs = toMs((cursor.data() as TalladoPause).pausedAt);
      if (Number.isFinite(oldestMs) && oldestMs < startMs) break;
    }
  };

  await Promise.all([pageUnits(), pageShifts(), pagePauses()]);

  const units = Array.from(unitMap.values());
  const missingIds = Array.from(
    new Set(
      units.map((u) => u.shiftId).filter((id): id is string => !!id && !shiftMap.has(id))
    )
  );
  if (missingIds.length > 0) {
    for (const s of await fetchTalladoShiftsByIds(missingIds)) {
      shiftMap.set(s.id, s);
    }
  }

  return {
    shifts: filterActiveTalladoShifts(Array.from(shiftMap.values())),
    units: filterActiveTalladoUnits(units),
    pauses: filterActiveTalladoPauses(Array.from(pauseMap.values())),
  };
}

export async function listTalladoDashboard(opts?: {
  dayKey?: string;
}): Promise<{
  success: boolean;
  shifts?: TalladoShift[];
  units?: TalladoUnit[];
  pauses?: TalladoPause[];
  error?: string;
}> {
  try {
    const dayKey = opts?.dayKey || talladoLocalDayKey();

    let { shifts, units, pauses } = await loadTalladoCollectionsForDay(dayKey);

    units = units.filter(
      (u) => isTalladoSameLocalDay(u.startedAt, dayKey) || isTalladoSameLocalDay(u.endedAt, dayKey)
    );
    const unitShiftIds = new Set(units.map((u) => u.shiftId).filter(Boolean) as string[]);
    shifts = shifts.filter(
      (s) =>
        shiftBelongsToDay(s, dayKey) ||
        isTalladoSameLocalDay(s.startedAt, dayKey) ||
        unitShiftIds.has(s.id)
    );

    const known = new Set(shifts.map((s) => s.id));
    const missingIds = Array.from(
      new Set(units.map((u) => u.shiftId).filter((id): id is string => !!id && !known.has(id)))
    );
    if (missingIds.length > 0) {
      const recovered = await fetchTalladoShiftsByIds(missingIds);
      shifts = [...shifts, ...recovered];
    }

    const filtered = filterTalladoBundleToDay(dayKey, shifts, units, pauses);
    filtered.shifts.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));

    return {
      success: true,
      shifts: filtered.shifts,
      units: filtered.units,
      pauses: filtered.pauses,
    };
  } catch (error: any) {
    console.error('listTalladoDashboard:', error);
    return { success: false, error: error?.message || 'No se pudo cargar el dashboard.' };
  }
}

export async function updateTalladoShiftPeople(
  shiftId: string,
  peopleCount: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const n = Math.max(1, Math.round(Number(peopleCount) || 0));
    await updateDoc(doc(firestore, SHIFTS_COL, shiftId), { peopleCount: n });
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error?.message || 'No se pudo actualizar personas.' };
  }
}

/** Admin: fija o limpia la hora real de inicio productivo del turno. */
export async function updateTalladoShiftProductivityStart(
  shiftId: string,
  productivityStartedAt: string | null
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!shiftId) return { success: false, error: 'Turno no indicado.' };
    if (productivityStartedAt == null || productivityStartedAt === '') {
      await updateDoc(doc(firestore, SHIFTS_COL, shiftId), { productivityStartedAt: deleteField() });
      return { success: true };
    }
    const ms = new Date(productivityStartedAt).getTime();
    if (!Number.isFinite(ms)) {
      return { success: false, error: 'Fecha/hora de inicio inválida.' };
    }
    await updateDoc(doc(firestore, SHIFTS_COL, shiftId), {
      productivityStartedAt: new Date(ms).toISOString(),
    });
    return { success: true };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'No se pudo actualizar la hora de inicio.',
    };
  }
}

/** Monitor admin: turnos activos, unidades abiertas y códigos leídos del día. */
export async function listTalladoLiveMonitor(opts?: {
  dayKey?: string;
  cleanup?: boolean;
}): Promise<{
  success: boolean;
  shifts?: TalladoShift[];
  activeUnits?: TalladoUnit[];
  todayUnits?: TalladoUnit[];
  openPauses?: TalladoPause[];
  cleanup?: { deletedUnits: number; closedShifts: number };
  error?: string;
}> {
  try {
    let cleanupResult: Awaited<ReturnType<typeof cleanupTalladoDuplicates>> | null = null;
    if (opts?.cleanup) {
      cleanupResult = await cleanupTalladoDuplicates();
    }

    const dayKey = opts?.dayKey || talladoLocalDayKey();

    let { shifts, units, pauses } = await loadTalladoCollectionsForDay(dayKey);

    // Monitor: si el día es hoy y hace falta ver active sin und aún, mezclar active recientes.
    if (dayKey === talladoLocalDayKey()) {
      const activeSnap = await getDocs(
        query(collection(firestore, SHIFTS_COL), where('status', '==', 'active'), limit(100))
      ).catch(() => null);
      if (activeSnap) {
        const byId = new Map(shifts.map((s) => [s.id, s]));
        for (const d of activeSnap.docs) {
          const s = { id: d.id, ...d.data() } as TalladoShift;
          if (isTalladoSoftDeleted(s)) continue;
          if (shiftBelongsToDay(s, dayKey) || isTalladoSameLocalDay(s.startedAt, dayKey)) {
            byId.set(s.id, s);
          }
        }
        shifts = Array.from(byId.values());
      }
    }

    units = units.filter(
      (u) =>
        !isTalladoSoftDeleted(u) &&
        (isTalladoSameLocalDay(u.startedAt, dayKey) || isTalladoSameLocalDay(u.endedAt, dayKey))
    );
    const unitShiftIds = new Set(units.map((u) => u.shiftId).filter(Boolean) as string[]);
    shifts = shifts.filter(
      (s) =>
        !isTalladoSoftDeleted(s) &&
        (s.status === 'active' ||
          shiftBelongsToDay(s, dayKey) ||
          isTalladoSameLocalDay(s.startedAt, dayKey) ||
          unitShiftIds.has(s.id))
    );

    const known = new Set(shifts.map((s) => s.id));
    const missingIds = Array.from(
      new Set(units.map((u) => u.shiftId).filter((id): id is string => !!id && !known.has(id)))
    );
    if (missingIds.length > 0) {
      const recovered = await fetchTalladoShiftsByIds(missingIds);
      shifts = [...shifts, ...recovered];
    }

    const filtered = filterTalladoBundleToDay(dayKey, shifts, units, pauses);
    // En vivo también muestra turnos active del día (aunque aún sin unidades)
    const liveShifts = [
      ...filtered.shifts,
      ...shifts.filter(
        (s) =>
          s.status === 'active' &&
          isTalladoSameLocalDay(s.startedAt, dayKey) &&
          !filtered.shifts.some((x) => x.id === s.id)
      ),
    ].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));

    const shiftIds = new Set(liveShifts.map((s) => s.id));
    const todayUnits = filtered.units.sort((a, b) =>
      String(b.startedAt).localeCompare(String(a.startedAt))
    );
    const activeUnits = todayUnits
      .filter((u) => u.status === 'in_progress')
      .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
    const openPauses = pauses
      .filter(
        (p) =>
          p.status === 'open' &&
          (shiftIds.has(p.shiftId) || isTalladoSameLocalDay(p.pausedAt, dayKey))
      )
      .sort((a, b) => String(b.pausedAt).localeCompare(String(a.pausedAt)));

    return {
      success: true,
      shifts: liveShifts,
      activeUnits,
      todayUnits,
      openPauses,
      cleanup: cleanupResult?.success
        ? { deletedUnits: cleanupResult.deletedUnits || 0, closedShifts: cleanupResult.closedShifts || 0 }
        : undefined,
    };
  } catch (error: any) {
    console.error('listTalladoLiveMonitor:', error);
    return { success: false, error: error?.message || 'No se pudo cargar el monitor en vivo.' };
  }
}

/**
 * Soft-borra solo unidades in_progress duplicadas (mismo código) dejando la lectura más antigua.
 * NUNCA toca unidades finished/done. Siempre archiva en talladoUnitDeletes.
 * Cierra turnos activos duplicados del mismo grupo dejando el más antiguo.
 */
export async function cleanupTalladoDuplicates(actor?: TalladoDeleteActor): Promise<{
  success: boolean;
  deletedUnits?: number;
  closedShifts?: number;
  reassignedUnits?: number;
  error?: string;
}> {
  try {
    let deletedUnits = 0;
    let closedShifts = 0;
    let reassignedUnits = 0;

    const deleteMeta = {
      deletedBy: actor?.deletedBy || 'system',
      deletedByEmail: actor?.deletedByEmail,
      deletedByName: actor?.deletedByName || 'cleanup',
      reason: actor?.reason || 'Limpieza de duplicados in_progress',
      source: 'cleanup_duplicates' as const,
    };

    // --- Unidades activas duplicadas por código (solo in_progress) ---
    const openUnits = await listInProgressUnits();
    const byCode = new Map<string, TalladoUnit[]>();
    for (const u of openUnits) {
      if (u.status !== 'in_progress') continue;
      const key = normalizeTalladoScanCode(u.scanCode) || normalizeTalladoScanCode(u.numeroTF) || u.id;
      const list = byCode.get(key) || [];
      list.push(u);
      byCode.set(key, list);
    }
    for (const list of byCode.values()) {
      if (list.length < 2) continue;
      list.sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
      const [, ...dups] = list;
      for (const dup of dups) {
        if (dup.status !== 'in_progress') continue;
        await archiveAndSoftDeleteUnit(dup, deleteMeta);
        deletedUnits += 1;
      }
    }

    // --- Turnos activos duplicados por grupo ---
    const activeShifts = await listActiveShifts();
    const byGrupo = new Map<string, TalladoShift[]>();
    for (const s of activeShifts) {
      const key = normalizeGrupoKey(s.grupo) || s.id;
      const list = byGrupo.get(key) || [];
      list.push(s);
      byGrupo.set(key, list);
    }

    const allUnitsSnap = await getDocs(query(collection(firestore, UNITS_COL), limit(1000)));
    const allUnits = allUnitsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() } as TalladoUnit))
      .filter((u) => !isTalladoSoftDeleted(u));

    for (const list of byGrupo.values()) {
      if (list.length < 2) continue;
      list.sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
      const [kept, ...dups] = list;
      for (const dup of dups) {
        // Mover unidades del turno duplicado al turno más viejo
        const owned = allUnits.filter((u) => u.shiftId === dup.id);
        for (const u of owned) {
          if (u.status === 'in_progress') {
            const keptOpen = allUnits.find(
              (x) =>
                x.id !== u.id &&
                x.shiftId === kept.id &&
                x.status === 'in_progress' &&
                unitMatchesScanCode(x, u.scanCode)
            );
            if (keptOpen) {
              // Solo soft-delete del duplicado in_progress; nunca finished.
              await archiveAndSoftDeleteUnit(u, {
                ...deleteMeta,
                reason: `Duplicado in_progress al consolidar turno ${dup.id} → ${kept.id}`,
              });
              deletedUnits += 1;
            } else {
              await updateDoc(doc(firestore, UNITS_COL, u.id), { shiftId: kept.id, grupo: kept.grupo });
              reassignedUnits += 1;
              u.shiftId = kept.id;
            }
          } else {
            // Finished: solo reasignar shiftId, NUNCA borrar.
            await updateDoc(doc(firestore, UNITS_COL, u.id), { shiftId: kept.id, grupo: kept.grupo });
            reassignedUnits += 1;
          }
        }

        // Pausas del turno duplicado → al kept
        const pausesSnap = await getDocs(
          query(collection(firestore, PAUSES_COL), where('shiftId', '==', dup.id), limit(100))
        );
        for (const p of pausesSnap.docs) {
          const pdata = p.data() as TalladoPause;
          if (isTalladoSoftDeleted(pdata)) continue;
          await updateDoc(p.ref, { shiftId: kept.id, grupo: kept.grupo });
        }

        await updateDoc(doc(firestore, SHIFTS_COL, dup.id), {
          status: 'closed',
          endedAt: new Date().toISOString(),
          closedReason: 'duplicate_grupo_cleanup',
        });
        closedShifts += 1;
      }
    }

    return { success: true, deletedUnits, closedShifts, reassignedUnits };
  } catch (error: any) {
    console.error('cleanupTalladoDuplicates:', error);
    return { success: false, error: error?.message || 'No se pudieron limpiar duplicados.' };
  }
}

/** Upsert catálogo de cajas (Excel) para Tallado sin remisión/TF. */
export async function importTalladoCatalog(input: {
  rows: TalladoCatalogImportRow[];
  userId: string;
  userName?: string;
  replaceAll?: boolean;
}): Promise<{
  success: boolean;
  upserted?: number;
  deleted?: number;
  error?: string;
}> {
  try {
    const rows = Array.isArray(input.rows) ? input.rows : [];
    if (rows.length === 0) return { success: false, error: 'El archivo no trajo filas válidas.' };
    if (!input.userId) return { success: false, error: 'Usuario no autenticado.' };

    let deleted = 0;
    if (input.replaceAll) {
      const existing = await getDocs(query(collection(firestore, CATALOG_COL), limit(2000)));
      for (const d of existing.docs) {
        await deleteDoc(d.ref);
        deleted += 1;
      }
    }

    const now = new Date().toISOString();
    let upserted = 0;
    for (const row of rows) {
      const codigoBarras = normalizeTalladoScanCode(row.codigoBarras);
      if (!codigoBarras) continue;
      const cantidad = Math.max(0, Math.round(Number(row.cantidad) || 0));
      if (cantidad <= 0) continue;

      // Doc id = código normalizado para upsert estable
      const safeId = codigoBarras.replace(/[\/#?[\]]/g, '_').slice(0, 700);
      const ref = doc(firestore, CATALOG_COL, safeId);
      const item: TalladoCatalogItem = {
        id: safeId,
        codigoBarras,
        referencia: String(row.referencia || codigoBarras).trim().toUpperCase(),
        talla: String(row.talla || '—').trim().toUpperCase(),
        cantidad,
        uploadedAt: now,
        uploadedBy: input.userId,
        uploadedByName: input.userName || undefined,
        active: true,
      };
      await setDoc(ref, stripUndefinedDeep(item) as TalladoCatalogItem);
      upserted += 1;
    }

    return { success: true, upserted, deleted };
  } catch (error: any) {
    console.error('importTalladoCatalog:', error);
    return { success: false, error: error?.message || 'No se pudo importar el catálogo.' };
  }
}

export async function getTalladoCatalogStats(): Promise<{
  success: boolean;
  count?: number;
  totalQty?: number;
  lastUploadedAt?: string;
  error?: string;
}> {
  try {
    const snap = await getDocs(query(collection(firestore, CATALOG_COL), limit(2000)));
    let totalQty = 0;
    let lastUploadedAt = '';
    for (const d of snap.docs) {
      const item = d.data() as TalladoCatalogItem;
      if (item.active === false) continue;
      totalQty += Number(item.cantidad) || 0;
      if (item.uploadedAt && item.uploadedAt > lastUploadedAt) lastUploadedAt = item.uploadedAt;
    }
    return {
      success: true,
      count: snap.size,
      totalQty,
      lastUploadedAt: lastUploadedAt || undefined,
    };
  } catch (error: any) {
    return { success: false, error: error?.message || 'No se pudo leer el catálogo.' };
  }
}

export async function clearTalladoCatalog(): Promise<{
  success: boolean;
  deleted?: number;
  error?: string;
}> {
  try {
    const snap = await getDocs(query(collection(firestore, CATALOG_COL), limit(2000)));
    let deleted = 0;
    for (const d of snap.docs) {
      await deleteDoc(d.ref);
      deleted += 1;
    }
    return { success: true, deleted };
  } catch (error: any) {
    return { success: false, error: error?.message || 'No se pudo vaciar el catálogo.' };
  }
}

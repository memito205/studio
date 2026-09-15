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
  updateDoc,
  where,
} from 'firebase/firestore';
import { firestore } from '@/services/firebase';
import type {
  TalladoCatalogImportRow,
  TalladoCatalogItem,
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
import { isTalladoSameLocalDay, talladoLocalDayKey, filterTalladoBundleToDay } from '@/lib/talladoProductivity';

const SHIFTS_COL = 'talladoShifts';
const UNITS_COL = 'talladoUnits';
const PAUSES_COL = 'talladoPauses';
const TRANSFERS_COL = 'transfers';
const CATALOG_COL = 'talladoCatalog';
const PACKING_UNITS_COL = 'packingUnits';
const LABELING_OPS_COL = 'labelingOperations';
const RECEPTION_OPS_COL = 'receptionOperations';

const DEFAULT_DESTINO_SIN_REMISION = 'MERCANCIA SIN REMISIONAR';
/** # caja recepción: solo dígitos cortos (no confundir con TF largos). */
const RECEPTION_BOX_NUMBER_RE = /^\d{1,4}$/;

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
  // Lectores a veces emiten ' o , en vez del guion medio (-)
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[\u2018\u2019\u201A\uFF07`´′ʼ']/g, '-')
    .replace(/[,;]/g, '-')
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
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as TalladoUnit));
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
      .filter((u) => unitMatchesScanCode(u, code))
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
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as TalladoShift));
}

/** Turno pertenece al día (dayKey explícito o startedAt en Bogotá). */
function shiftBelongsToDay(shift: TalladoShift, dayKey: string): boolean {
  if (shift.dayKey) return shift.dayKey === dayKey;
  return isTalladoSameLocalDay(shift.startedAt, dayKey);
}

async function closeShiftAsDayRollover(shiftId: string, endedAt: string): Promise<void> {
  await updateDoc(doc(firestore, SHIFTS_COL, shiftId), {
    status: 'closed',
    endedAt,
    closedReason: 'day_rollover',
  });
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
  }
): TalladoTransferLookup {
  const items = opts.unit.items && typeof opts.unit.items === 'object' ? Object.values(opts.unit.items) : [];
  const refQty = new Map<string, number>();
  const tallas = new Set<string>();
  let cantidad = 0;
  for (const row of items) {
    const qty = Math.max(0, Number(row?.packedQuantity) || 0);
    cantidad += qty;
    const ref = String(row?.item?.referencia || '').trim();
    if (ref) refQty.set(ref, (refQty.get(ref) || 0) + qty);
    const talla = String(row?.item?.talla || row?.item?.size || '').trim();
    if (talla) tallas.add(talla);
  }
  const refsSorted = Array.from(refQty.entries()).sort((a, b) => b[1] - a[1]);
  const referencia = refsSorted.map(([r]) => r).join(', ') || undefined;
  const primaryRef = refsSorted[0]?.[0];
  const unitNumber = Number(opts.unit.id) || Number(scanCode) || 0;
  const rk = String(opts.rkIdentifier || '').trim();

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
    lineCount: Math.max(1, items.length),
    source: 'recepcion',
    referencia,
    talla: tallas.size ? Array.from(tallas).join(', ') : undefined,
    unitNumber: unitNumber || undefined,
    packingUnitId: opts.packingUnitFirestoreId,
    receptionOperationId: opts.unit.reception_id,
    rkIdentifier: rk || undefined,
    yaEtiquetada: opts.yaEtiquetada,
  };
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

  const snap = await getDocs(
    query(
      collection(firestore, PACKING_UNITS_COL),
      where('reception_id', '==', receptionId),
      where('id', '==', unitNumber),
      limit(3)
    )
  );
  if (snap.empty) {
    return {
      success: false,
      error: `No hay caja #${unitNumber} en la recepción seleccionada.`,
    };
  }

  const d = snap.docs[0];
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

  return {
    success: true,
    data: packingUnitToReceptionLookup(scanCode, {
      unit,
      packingUnitFirestoreId: d.id,
      rkIdentifier,
      yaEtiquetada,
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
 * Admin: elimina el turno y sus unidades/pausas.
 * No toca recepción ni transferencias.
 */
export async function adminDeleteTalladoShift(shiftId: string): Promise<{
  success: boolean;
  deletedUnits?: number;
  deletedPauses?: number;
  error?: string;
}> {
  try {
    if (!shiftId) return { success: false, error: 'Turno inválido.' };
    const shiftRef = doc(firestore, SHIFTS_COL, shiftId);
    const snap = await getDoc(shiftRef);
    if (!snap.exists()) return { success: false, error: 'El turno no existe.' };

    const [unitsSnap, pausesSnap] = await Promise.all([
      getDocs(query(collection(firestore, UNITS_COL), where('shiftId', '==', shiftId), limit(500))),
      getDocs(query(collection(firestore, PAUSES_COL), where('shiftId', '==', shiftId), limit(200))),
    ]);

    await Promise.all(unitsSnap.docs.map((d) => deleteDoc(d.ref)));
    await Promise.all(pausesSnap.docs.map((d) => deleteDoc(d.ref)));
    await deleteDoc(shiftRef);

    return {
      success: true,
      deletedUnits: unitsSnap.size,
      deletedPauses: pausesSnap.size,
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

    // Cruce recepción por # caja: solo con RK/recepción elegida (el # se reinicia por operación).
    if (RECEPTION_BOX_NUMBER_RE.test(scanCode)) {
      const fromReception = await lookupReceptionBoxForTallado(
        scanCode,
        opts?.receptionOperationId
      );
      if (fromReception.success && fromReception.data) {
        return fromReception;
      }
      return {
        success: false,
        error:
          fromReception.error ||
          `No se encontró caja #${scanCode} en la recepción seleccionada (tampoco en TF/catálogo).`,
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

    // Turnos activos de días anteriores: cerrar; no reanudar.
    for (const stale of sameGrupo.filter((s) => !shiftBelongsToDay(s, todayKey))) {
      await closeShiftAsDayRollover(stale.id, now);
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
    await setDoc(ref, stripUndefinedDeep(row) as TalladoShift);
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
    const now = new Date().toISOString();
    const active = await listActiveShifts();
    const today: TalladoShift[] = [];
    for (const s of active) {
      if (shiftBelongsToDay(s, key)) {
        today.push(s);
      } else {
        try {
          await closeShiftAsDayRollover(s.id, now);
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
      await closeShiftAsDayRollover(shift.id, new Date().toISOString());
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
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
    const pauses = pausesSnap.docs
      .map((d) => ({ id: d.id, ...d.data() } as TalladoPause))
      .sort((a, b) => String(b.pausedAt).localeCompare(String(a.pausedAt)));

    return {
      success: true,
      shift: { id: shiftSnap.id, ...shiftSnap.data() } as TalladoShift,
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
}): Promise<{ success: boolean; data?: TalladoUnit; error?: string }> {
  try {
    if (!input.shiftId) return { success: false, error: 'Sin turno activo.' };
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

    const now = new Date().toISOString();
    const ref = doc(collection(firestore, UNITS_COL));
    const row: TalladoUnit = {
      id: ref.id,
      shiftId: input.shiftId,
      grupo: input.grupo,
      scanCode,
      transferIds: input.lookup.transferIds || [],
      numeroTF: input.lookup.numeroTF,
      codigoAlterno: input.lookup.codigoAlterno,
      bodegaDestino: input.lookup.bodegaDestino || DEFAULT_DESTINO_SIN_REMISION,
      bodegaOrigen: input.lookup.bodegaOrigen,
      marca: input.lookup.marca,
      grupoMercancia: input.lookup.grupoMercancia,
      source: resolveTalladoSource(input.lookup),
      referencia: input.lookup.referencia,
      talla: input.lookup.talla,
      cantidad: Math.max(0, Number(input.lookup.cantidad) || 0),
      startedAt: now,
      endedAt: now,
      durationMs: 0,
      durationNetMs: 0,
      userId: input.userId,
      userName: input.userName || 'Operario',
      status: 'done',
      unitNumber: input.lookup.unitNumber,
      packingUnitId: input.lookup.packingUnitId,
      receptionOperationId: input.lookup.receptionOperationId,
      rkIdentifier: input.lookup.rkIdentifier,
      yaEtiquetada: input.lookup.yaEtiquetada,
    };
    await setDoc(ref, stripUndefinedDeep(row) as TalladoUnit);
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
}): Promise<{ success: boolean; data?: TalladoUnit; error?: string }> {
  // Compat: el flujo operario usa confirmación en un escaneo.
  return confirmTalladoUnitFromLookup(input);
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
        ? input.openMatches
        : input.unit
          ? [input.unit]
          : await findInProgressUnitsByCode(scanCode);

    if (matches.length === 0) {
      return { success: false, error: 'No hay Inicio abierto para este código.' };
    }

    // Preferir unidad del turno actual; si no, la más antigua
    const unit =
      input.unit ||
      matches.find((u) => u.shiftId === input.shiftId) ||
      matches[0];
    const endedAt = new Date().toISOString();
    const durationMs = Math.max(0, new Date(endedAt).getTime() - new Date(unit.startedAt).getTime());

    // Pausas: solo las del turno de la unidad (límite bajo para no colgar el cierre).
    const pausesSnap = await getDocs(
      query(
        collection(firestore, PAUSES_COL),
        where('shiftId', '==', unit.shiftId),
        limit(80)
      )
    );
    const pauses = pausesSnap.docs.map((d) => d.data() as TalladoPause);
    const durationNetMs = computeNetDurationMs(unit.startedAt, endedAt, pauses);

    const patch = {
      endedAt,
      durationMs,
      durationNetMs,
      status: 'done' as const,
    };
    await updateDoc(doc(firestore, UNITS_COL, unit.id), patch);

    // Si quedaron duplicados abiertos del mismo código, borrarlos (deja cerrado el más viejo)
    const dups = matches.filter((dup) => dup.id !== unit.id);
    if (dups.length > 0) {
      await Promise.all(dups.map((dup) => deleteDoc(doc(firestore, UNITS_COL, dup.id))));
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
      await updateDoc(doc(firestore, SHIFTS_COL, input.shiftId), {
        endedAt: now,
        status: 'closed',
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

    // ordered desc so "recientes" no se pierdan con limit aleatorio
    const [shiftsSnap, unitsSnap, pausesSnap] = await Promise.all([
      getDocs(query(collection(firestore, SHIFTS_COL), orderBy('startedAt', 'desc'), limit(500))),
      getDocs(query(collection(firestore, UNITS_COL), orderBy('startedAt', 'desc'), limit(1500))),
      getDocs(query(collection(firestore, PAUSES_COL), orderBy('pausedAt', 'desc'), limit(800))),
    ]);

    let shifts = shiftsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as TalladoShift));
    let units = unitsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as TalladoUnit));
    let pauses = pausesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as TalladoPause));

    // Primero unidades del día; luego turnos ligados (evita arrastrar histórico de active viejos)
    units = units.filter(
      (u) => isTalladoSameLocalDay(u.startedAt, dayKey) || isTalladoSameLocalDay(u.endedAt, dayKey)
    );
    const unitShiftIds = new Set(units.map((u) => u.shiftId).filter(Boolean) as string[]);
    shifts = shifts.filter(
      (s) => isTalladoSameLocalDay(s.startedAt, dayKey) || unitShiftIds.has(s.id)
    );

    // Recuperar turnos referenciados por unidades del día que no vinieron en el limit
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

    const [shiftsSnap, unitsSnap, pausesSnap] = await Promise.all([
      getDocs(query(collection(firestore, SHIFTS_COL), orderBy('startedAt', 'desc'), limit(500))),
      getDocs(query(collection(firestore, UNITS_COL), orderBy('startedAt', 'desc'), limit(1500))),
      getDocs(query(collection(firestore, PAUSES_COL), orderBy('pausedAt', 'desc'), limit(800))),
    ]);

    let shifts = shiftsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as TalladoShift));
    let units = unitsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as TalladoUnit));
    let pauses = pausesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as TalladoPause));

    units = units.filter(
      (u) => isTalladoSameLocalDay(u.startedAt, dayKey) || isTalladoSameLocalDay(u.endedAt, dayKey)
    );
    const unitShiftIds = new Set(units.map((u) => u.shiftId).filter(Boolean) as string[]);
    shifts = shifts.filter(
      (s) =>
        s.status === 'active' ||
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
 * Borra unidades in_progress duplicadas (mismo código) dejando la lectura más antigua.
 * Cierra turnos activos duplicados del mismo grupo dejando el más antiguo.
 */
export async function cleanupTalladoDuplicates(): Promise<{
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

    // --- Unidades activas duplicadas por código ---
    const openUnits = await listInProgressUnits();
    const byCode = new Map<string, TalladoUnit[]>();
    for (const u of openUnits) {
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
        await deleteDoc(doc(firestore, UNITS_COL, dup.id));
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
    const allUnits = allUnitsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as TalladoUnit));

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
              await deleteDoc(doc(firestore, UNITS_COL, u.id));
              deletedUnits += 1;
            } else {
              await updateDoc(doc(firestore, UNITS_COL, u.id), { shiftId: kept.id, grupo: kept.grupo });
              reassignedUnits += 1;
              u.shiftId = kept.id;
            }
          } else {
            await updateDoc(doc(firestore, UNITS_COL, u.id), { shiftId: kept.id, grupo: kept.grupo });
            reassignedUnits += 1;
          }
        }

        // Pausas del turno duplicado → al kept
        const pausesSnap = await getDocs(
          query(collection(firestore, PAUSES_COL), where('shiftId', '==', dup.id), limit(100))
        );
        for (const p of pausesSnap.docs) {
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

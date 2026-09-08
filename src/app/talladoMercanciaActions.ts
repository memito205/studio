'use server';

import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
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
} from '@/types';

const SHIFTS_COL = 'talladoShifts';
const UNITS_COL = 'talladoUnits';
const PAUSES_COL = 'talladoPauses';
const TRANSFERS_COL = 'transfers';
const CATALOG_COL = 'talladoCatalog';

const DEFAULT_DESTINO_SIN_REMISION = 'MERCANCIA SIN REMISIONAR';

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
  return (
    normalizeTalladoScanCode(unit.scanCode) === code ||
    normalizeTalladoScanCode(unit.numeroTF) === code ||
    normalizeTalladoScanCode(unit.codigoAlterno || '') === code
  );
}

async function listInProgressUnits(): Promise<TalladoUnit[]> {
  const snap = await getDocs(
    query(collection(firestore, UNITS_COL), where('status', '==', 'in_progress'), limit(500))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as TalladoUnit));
}

async function listActiveShifts(): Promise<TalladoShift[]> {
  const snap = await getDocs(
    query(collection(firestore, SHIFTS_COL), where('status', '==', 'active'), limit(200))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as TalladoShift));
}

/** Busca unidades ya registradas (cualquier estado) que coincidan con el código / TF / alterno. */
async function findUnitsMatchingCode(scanCode: string): Promise<TalladoUnit[]> {
  const code = normalizeTalladoScanCode(scanCode);
  if (!code) return [];

  const variants = Array.from(
    new Set([code, code.replace(/-/g, "'"), code.replace(/-/g, ','), code.replace(/-/g, '')])
  );

  const found = new Map<string, TalladoUnit>();
  const fields = ['scanCode', 'numeroTF', 'codigoAlterno'] as const;
  for (const field of fields) {
    for (const variant of variants) {
      const snap = await getDocs(
        query(collection(firestore, UNITS_COL), where(field, '==', variant), limit(40))
      );
      for (const d of snap.docs) {
        found.set(d.id, { id: d.id, ...d.data() } as TalladoUnit);
      }
    }
  }

  // Filtrar solo coincidencias reales del código (por si codigoAlterno vacío trajo ruido)
  const matched = Array.from(found.values()).filter((u) => unitMatchesScanCode(u, code));
  if (matched.length > 0) {
    return matched.sort((a, b) =>
      String(b.endedAt || b.startedAt).localeCompare(String(a.endedAt || a.startedAt))
    );
  }

  // Fallback: recientes por si el código se guardó con formato raro
  const recent = await getDocs(query(collection(firestore, UNITS_COL), limit(400)));
  for (const d of recent.docs) {
    const u = { id: d.id, ...d.data() } as TalladoUnit;
    if (unitMatchesScanCode(u, code)) found.set(u.id, u);
  }

  return Array.from(found.values())
    .filter((u) => unitMatchesScanCode(u, code))
    .sort((a, b) =>
      String(b.endedAt || b.startedAt).localeCompare(String(a.endedAt || a.startedAt))
    );
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
    marca: item.referencia || 'Sin referencia',
    grupoMercancia: item.talla ? `Talla ${item.talla}` : undefined,
    cantidad: Math.max(0, Number(item.cantidad) || 0),
    lineCount: 1,
    source: 'catalogo',
    referencia: item.referencia,
    talla: item.talla,
    catalogId: item.id,
  };
}

async function lookupCatalogForTallado(scanCode: string): Promise<TalladoTransferLookup | null> {
  const variants = Array.from(
    new Set([
      scanCode,
      scanCode.replace(/-/g, "'"),
      scanCode.replace(/-/g, ','),
      scanCode.replace(/-/g, ''),
    ])
  );

  for (const variant of variants) {
    const snap = await getDocs(
      query(
        collection(firestore, CATALOG_COL),
        where('codigoBarras', '==', variant),
        where('active', '==', true),
        limit(5)
      )
    );
    if (!snap.empty) {
      const item = { id: snap.docs[0].id, ...snap.docs[0].data() } as TalladoCatalogItem;
      return catalogToLookup(scanCode, item);
    }
  }

  // Fallback sin índice compuesto: buscar solo por código
  for (const variant of variants) {
    const snap = await getDocs(
      query(collection(firestore, CATALOG_COL), where('codigoBarras', '==', variant), limit(5))
    );
    if (!snap.empty) {
      const item = { id: snap.docs[0].id, ...snap.docs[0].data() } as TalladoCatalogItem;
      if (item.active === false) continue;
      return catalogToLookup(scanCode, item);
    }
  }

  return null;
}

export async function lookupTransferForTallado(
  rawCode: string
): Promise<{ success: boolean; data?: TalladoTransferLookup; error?: string }> {
  try {
    const scanCode = normalizeTalladoScanCode(rawCode);
    if (!scanCode) return { success: false, error: 'Escanee un código válido.' };

    const col = collection(firestore, TRANSFERS_COL);

    const byTf = await getDocs(query(col, where('numeroTF', '==', scanCode), limit(50)));
    if (!byTf.empty) {
      const docs = byTf.docs.map((d) => ({ id: d.id, ...d.data() } as TransferEntry));
      return { success: true, data: aggregateTransfers(scanCode, 'numeroTF', docs) };
    }

    // Variantes comunes de numeroTF (con/sin ceros / prefijo TF)
    const digits = scanCode.replace(/\D/g, '');
    if (digits && digits !== scanCode) {
      const byDigits = await getDocs(query(col, where('numeroTF', '==', digits), limit(50)));
      if (!byDigits.empty) {
        const docs = byDigits.docs.map((d) => ({ id: d.id, ...d.data() } as TransferEntry));
        return { success: true, data: aggregateTransfers(scanCode, 'numeroTF', docs) };
      }
    }

    const byAlt = await getDocs(query(col, where('codigoAlterno', '==', scanCode), limit(50)));
    if (!byAlt.empty) {
      const docs = byAlt.docs.map((d) => ({ id: d.id, ...d.data() } as TransferEntry));
      return { success: true, data: aggregateTransfers(scanCode, 'codigoAlterno', docs) };
    }

    // Variantes guardadas con ' o , en vez de -
    const altVariants = Array.from(
      new Set([
        scanCode.replace(/-/g, "'"),
        scanCode.replace(/-/g, ','),
        String(rawCode || '').trim(),
        String(rawCode || '').trim().toUpperCase(),
      ])
    ).filter((v) => v && v !== scanCode);

    for (const variant of altVariants) {
      const byVariant = await getDocs(query(col, where('codigoAlterno', '==', variant), limit(50)));
      if (!byVariant.empty) {
        const docs = byVariant.docs.map((d) => ({ id: d.id, ...d.data() } as TransferEntry));
        return { success: true, data: aggregateTransfers(scanCode, 'codigoAlterno', docs) };
      }
    }

    // Alternativa: catálogo Excel (caja / ref / talla / cant) — destino SIN REMISIONAR
    const fromCatalog = await lookupCatalogForTallado(scanCode);
    if (fromCatalog) {
      return { success: true, data: fromCatalog };
    }

    return {
      success: false,
      error: `No se encontró el código "${scanCode}" en transferencias ni en el catálogo de cajas (sin remisión).`,
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

    const grupoKey = normalizeGrupoKey(grupo);
    const active = await listActiveShifts();
    const sameGrupo = active
      .filter((s) => normalizeGrupoKey(s.grupo) === grupoKey)
      .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));

    if (sameGrupo.length > 0) {
      const kept = sameGrupo[0];
      // Cerrar turnos activos duplicados del mismo grupo (deja el más viejo)
      for (const dup of sameGrupo.slice(1)) {
        await updateDoc(doc(firestore, SHIFTS_COL, dup.id), {
          status: 'closed',
          endedAt: new Date().toISOString(),
          closedReason: 'duplicate_grupo',
        });
      }
      if (peopleCount !== kept.peopleCount) {
        await updateDoc(doc(firestore, SHIFTS_COL, kept.id), { peopleCount });
        kept.peopleCount = peopleCount;
      }
      return { success: true, data: { ...kept, grupo }, rejoined: true };
    }

    const now = new Date().toISOString();
    const ref = doc(collection(firestore, SHIFTS_COL));
    const row: TalladoShift = {
      id: ref.id,
      grupo,
      peopleCount,
      userId: input.userId,
      userName: input.userName || 'Operario',
      startedAt: now,
      status: 'active',
    };
    await setDoc(ref, stripUndefinedDeep(row) as TalladoShift);
    return { success: true, data: row, rejoined: false };
  } catch (error: any) {
    return { success: false, error: error?.message || 'No se pudo iniciar el turno.' };
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

export async function startTalladoUnit(input: {
  shiftId: string;
  lookup: TalladoTransferLookup;
  userId: string;
  userName: string;
  grupo: string;
}): Promise<{ success: boolean; data?: TalladoUnit; error?: string }> {
  try {
    if (!input.shiftId) return { success: false, error: 'Sin turno activo.' };
    const scanCode = normalizeTalladoScanCode(input.lookup.scanCode);
    if (!scanCode) return { success: false, error: 'Código inválido.' };

    // Bloquear si hay pausa abierta
    const openPause = await getDocs(
      query(
        collection(firestore, PAUSES_COL),
        where('shiftId', '==', input.shiftId),
        where('status', '==', 'open'),
        limit(1)
      )
    );
    if (!openPause.empty) {
      return { success: false, error: 'El grupo está en pausa. Reanude antes de iniciar una unidad.' };
    }

    // Global: no permitir la misma unidad activa dos veces (cualquier turno)
    const openUnits = (await listInProgressUnits())
      .filter((u) => unitMatchesScanCode(u, scanCode))
      .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
    if (openUnits.length > 0) {
      const existing = openUnits[0];
      if (existing.shiftId === input.shiftId) {
        return {
          success: false,
          error: 'Esta unidad ya tiene Inicio. Escanee de nuevo para marcar Fin.',
        };
      }
      return {
        success: false,
        error: `El código ${existing.scanCode} ya está activo desde ${existing.startedAt} (grupo ${existing.grupo}). Cierre Fin antes de reiniciarlo.`,
      };
    }

    // No reiniciar unidades que ya tienen Fin
    const prior = await findUnitsMatchingCode(scanCode);
    const done = prior.find((u) => u.status === 'done');
    if (done) {
      return { success: false, error: alreadyDoneError(done) };
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
      source: input.lookup.source || (input.lookup.matchedBy === 'catalogo' ? 'catalogo' : 'transfers'),
      referencia: input.lookup.referencia,
      talla: input.lookup.talla,
      cantidad: Math.max(0, Number(input.lookup.cantidad) || 0),
      startedAt: now,
      userId: input.userId,
      userName: input.userName || 'Operario',
      status: 'in_progress',
    };
    await setDoc(ref, stripUndefinedDeep(row) as TalladoUnit);
    return { success: true, data: row };
  } catch (error: any) {
    console.error('startTalladoUnit:', error);
    return { success: false, error: error?.message || 'No se pudo iniciar la unidad.' };
  }
}

export async function finishTalladoUnit(input: {
  shiftId: string;
  scanCode: string;
}): Promise<{ success: boolean; data?: TalladoUnit; error?: string }> {
  try {
    const scanCode = normalizeTalladoScanCode(input.scanCode);
    if (!input.shiftId || !scanCode) return { success: false, error: 'Datos incompletos.' };

    const matches = (await listInProgressUnits())
      .filter((u) => unitMatchesScanCode(u, scanCode))
      .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));

    if (matches.length === 0) {
      return { success: false, error: 'No hay Inicio abierto para este código.' };
    }

    // Preferir unidad del turno actual; si no, la más antigua
    const unit = matches.find((u) => u.shiftId === input.shiftId) || matches[0];
    const endedAt = new Date().toISOString();
    const durationMs = Math.max(0, new Date(endedAt).getTime() - new Date(unit.startedAt).getTime());

    const pausesSnap = await getDocs(
      query(collection(firestore, PAUSES_COL), where('shiftId', '==', unit.shiftId), limit(200))
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
    for (const dup of matches) {
      if (dup.id === unit.id) continue;
      await deleteDoc(doc(firestore, UNITS_COL, dup.id));
    }

    return { success: true, data: { ...unit, ...patch } };
  } catch (error: any) {
    console.error('finishTalladoUnit:', error);
    return { success: false, error: error?.message || 'No se pudo cerrar la unidad.' };
  }
}

/** Escaneo inteligente: si hay unidad abierta → Fin; si no → deja listo para Inicio (devuelve lookup). */
export async function scanTalladoCode(input: {
  shiftId: string;
  rawCode: string;
  userId: string;
  userName: string;
  grupo: string;
  autoStart?: boolean;
}): Promise<{
  success: boolean;
  action?: 'finished' | 'ready_to_start' | 'auto_started';
  lookup?: TalladoTransferLookup;
  unit?: TalladoUnit;
  error?: string;
}> {
  try {
    const scanCode = normalizeTalladoScanCode(input.rawCode);
    if (!scanCode) return { success: false, error: 'Código vacío.' };

    const openMatches = (await listInProgressUnits())
      .filter((u) => unitMatchesScanCode(u, scanCode))
      .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));

    if (openMatches.length > 0) {
      const fin = await finishTalladoUnit({
        shiftId: input.shiftId,
        scanCode: openMatches[0].scanCode || scanCode,
      });
      if (!fin.success) return { success: false, error: fin.error };
      return { success: true, action: 'finished', unit: fin.data };
    }

    // Si ya tuvo Fin, bloquear (no volver a preparar Inicio)
    const prior = await findUnitsMatchingCode(scanCode);
    const done = prior.find((u) => u.status === 'done');
    if (done) {
      return { success: false, error: alreadyDoneError(done) };
    }

    const lookup = await lookupTransferForTallado(scanCode);
    if (!lookup.success || !lookup.data) return { success: false, error: lookup.error };

    if (input.autoStart) {
      const started = await startTalladoUnit({
        shiftId: input.shiftId,
        lookup: lookup.data,
        userId: input.userId,
        userName: input.userName,
        grupo: input.grupo,
      });
      if (!started.success) return { success: false, error: started.error, lookup: lookup.data };
      return { success: true, action: 'auto_started', lookup: lookup.data, unit: started.data };
    }

    return { success: true, action: 'ready_to_start', lookup: lookup.data };
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
    // Carga reciente (límite) — suficiente para dashboard operativo del día
    const [shiftsSnap, unitsSnap, pausesSnap] = await Promise.all([
      getDocs(query(collection(firestore, SHIFTS_COL), limit(200))),
      getDocs(query(collection(firestore, UNITS_COL), limit(1000))),
      getDocs(query(collection(firestore, PAUSES_COL), limit(500))),
    ]);

    let shifts = shiftsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as TalladoShift));
    let units = unitsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as TalladoUnit));
    let pauses = pausesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as TalladoPause));

    const dayKey =
      opts?.dayKey ||
      (() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      })();

    shifts = shifts.filter((s) => String(s.startedAt || '').startsWith(dayKey));
    const shiftIds = new Set(shifts.map((s) => s.id));
    units = units.filter(
      (u) => shiftIds.has(u.shiftId) || String(u.startedAt || '').startsWith(dayKey)
    );
    pauses = pauses.filter(
      (p) => shiftIds.has(p.shiftId) || String(p.pausedAt || '').startsWith(dayKey)
    );

    return { success: true, shifts, units, pauses };
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

    const dayKey =
      opts?.dayKey ||
      (() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      })();

    const [shiftsSnap, unitsSnap, pausesSnap] = await Promise.all([
      getDocs(query(collection(firestore, SHIFTS_COL), limit(200))),
      getDocs(query(collection(firestore, UNITS_COL), limit(1000))),
      getDocs(query(collection(firestore, PAUSES_COL), limit(500))),
    ]);

    let shifts = shiftsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as TalladoShift));
    let units = unitsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as TalladoUnit));
    let pauses = pausesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as TalladoPause));

    shifts = shifts
      .filter((s) => String(s.startedAt || '').startsWith(dayKey) || s.status === 'active')
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));

    const shiftIds = new Set(shifts.map((s) => s.id));
    const todayUnits = units
      .filter((u) => shiftIds.has(u.shiftId) || String(u.startedAt || '').startsWith(dayKey))
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));

    const activeUnits = todayUnits
      .filter((u) => u.status === 'in_progress')
      .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));

    const openPauses = pauses
      .filter(
        (p) =>
          p.status === 'open' &&
          (shiftIds.has(p.shiftId) || String(p.pausedAt || '').startsWith(dayKey))
      )
      .sort((a, b) => String(b.pausedAt).localeCompare(String(a.pausedAt)));

    return {
      success: true,
      shifts: shifts.filter((s) => s.status === 'active' || String(s.startedAt || '').startsWith(dayKey)),
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

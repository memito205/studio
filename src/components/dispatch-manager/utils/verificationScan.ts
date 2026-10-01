import { format } from 'date-fns';
import type { VerificationItem } from '@/types';
import { lookupTransferForVerification } from '@/app/actions';
import { normalizeDestination } from './excel';
import { weekdayShortEs } from '@/lib/warehouseLocations';

export const upperKey = (value: unknown) => String(value ?? '').trim().toUpperCase();
export const altKey = (value: unknown) => upperKey(value).replace(/\s+/g, '');
export const normalizeScanCode = (value: string) => value.trim().toUpperCase().replace(/['\/]/g, '-');

export type ItemMatch = { index: number } | { ambiguous: string[] } | null;

/** Busca una lectura por código de rótulo, número de TF solo o código alterno. */
export const findItemForCode = (items: VerificationItem[], code: string): ItemMatch => {
  const exact = items.findIndex((item) => upperKey(item.codigo) === code);
  if (exact !== -1) return { index: exact };

  const byTf = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => upperKey(item.tftCruce) === code || upperKey(item.tfOriginal) === code);
  if (byTf.length > 0) {
    const pending = byTf.filter(({ item }) => !item.scanned);
    const pool = pending.length > 0 ? pending : byTf;
    const destinos = Array.from(new Set(pool.map(({ item }) => item.destino)));
    if (destinos.length > 1) return { ambiguous: destinos };
    return { index: pool[0].index };
  }

  const alt = altKey(code);
  const byAlt = items.findIndex((item) => item.codigoAlterno && altKey(item.codigoAlterno) === alt);
  return byAlt !== -1 ? { index: byAlt } : null;
};

export const arrivalLabel = (iso?: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : `${weekdayShortEs(d)} ${format(d, 'dd/MM')}`;
};

/** Id de documento seguro para Firestore a partir del código del ítem. */
export const scanDocId = (codigo: string) => upperKey(codigo).replace(/\//g, '-').slice(0, 300) || 'SIN-CODIGO';

export type OutOfPlanResolution =
  | { ok: true; item: VerificationItem; reason: string }
  | { ok: false; type: 'error' | 'duplicate'; message: string; detail?: string };

/**
 * Resuelve una lectura que no está en la lista: primero excluidas por límite,
 * luego consulta la TF (Recibido en Bodega y destino de la validación).
 */
export async function resolveOutOfPlanCode(
  code: string,
  ctx: { excluded: VerificationItem[]; sessionDestinos: Set<string>; existing: VerificationItem[][] }
): Promise<OutOfPlanResolution> {
  if (ctx.existing.some((list) => findItemForCode(list, code))) {
    return { ok: false, type: 'duplicate', message: '¡CÓDIGO YA ESCANEADO!' };
  }
  const excludedMatch = findItemForCode(ctx.excluded, code);
  if (excludedMatch && 'index' in excludedMatch) {
    return { ok: true, item: ctx.excluded[excludedMatch.index], reason: 'Estaba excluida por el límite del destino.' };
  }

  const res = await lookupTransferForVerification(code);
  if (res.error) return { ok: false, type: 'error', message: 'ERROR CONSULTANDO LA TF', detail: res.error };
  if (res.pendingAlt) {
    return {
      ok: false,
      type: 'error',
      message: 'CÓDIGO ALTERNO SIN TF — NO SE PUEDE DESPACHAR',
      detail: `Déjela en su ubicación (${res.pendingAlt.ubicacion || 'sin ubicación'}) hasta que aparezca la TF.`,
    };
  }
  if (res.groups.length === 0) return { ok: false, type: 'error', message: '¡CÓDIGO NO ENCONTRADO!' };

  const received = res.groups.filter((g) => g.statuses.includes('Recibido en Bodega'));
  if (received.length === 0) {
    const states = Array.from(new Set(res.groups.flatMap((g) => g.statuses))).join(', ');
    return { ok: false, type: 'error', message: 'TF NO ESTÁ EN RECIBIDO EN BODEGA', detail: `Estado actual: ${states}.` };
  }
  const inSessionDest = received.filter((g) => ctx.sessionDestinos.has(normalizeDestination(g.bodegaDestino)));
  if (inSessionDest.length === 0) {
    return {
      ok: false,
      type: 'error',
      message: 'DESTINO FUERA DE ESTA VALIDACIÓN',
      detail: `La TF va para ${received.map((g) => normalizeDestination(g.bodegaDestino)).join(', ')}.`,
    };
  }
  if (inSessionDest.length > 1) {
    return {
      ok: false,
      type: 'error',
      message: 'TF EN VARIOS DESTINOS — LEA EL RÓTULO DESTINO-TF',
      detail: inSessionDest.map((g) => normalizeDestination(g.bodegaDestino)).join(', '),
    };
  }

  const g = inSessionDest[0];
  const codigo = `${g.bodegaDestino.trim()}-${g.numeroTF}`.toUpperCase().replace(/'/g, '-');
  if (ctx.existing.some((list) => findItemForCode(list, codigo))) {
    return { ok: false, type: 'duplicate', message: '¡CÓDIGO YA ESCANEADO!' };
  }
  return {
    ok: true,
    reason: 'No estaba en el cruce de esta validación.',
    item: {
      codigo,
      tftCruce: g.numeroTF,
      fechaTft: g.fecha ? format(new Date(g.fecha), 'dd/MM/yyyy') : '-',
      cantTft: String(g.cantidad || ''),
      destino: normalizeDestination(g.bodegaDestino),
      empacador: '',
      contenidoOriginal: g.numeroTF,
      tfOriginal: g.numeroTF,
      scanned: false,
      ...(g.marca ? { marca: g.marca } : {}),
      ...(g.ubicacion ? { ubicacion: g.ubicacion } : {}),
      ...(g.fechaLlegada ? { fechaLlegada: g.fechaLlegada } : {}),
      ...(g.codigoAlterno ? { codigoAlterno: g.codigoAlterno } : {}),
    },
  };
}

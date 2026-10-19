import type { DriverRouteTask } from '@/types';

const norm = (v: unknown) => String(v || '').trim().toUpperCase().replace(/\s+/g, ' ');

/**
 * Misma secuencia que el planificador (RutasModule `standardNorteRoute`).
 * Códigos B1…B22 / MOLINOS; en app suelen verse como BR 01, MOL, etc.
 */
export const STANDARD_NORTE_ROUTE = [
  'TRASLADOS',
  'BODEGA PIONEROS',
  'PIONEROS',
  'GARANTIAS',
  'TRYNO',
  'B5',
  'B2',
  'B4',
  'SISTEMAS',
  'OFICINA',
  'RECEPCION',
  'B12',
  'MOLINOS',
  'B1',
  'B11',
  'B22',
  'B15',
  'B9',
  'B18',
  'B13',
  'B19 OUTLET',
  'B19',
  'B20',
] as const;

const NORTE_INDEX = new Map<string, number>(STANDARD_NORTE_ROUTE.map((p, i) => [p, i]));

/** Prioridad residual para puntos fuera del estándar (menor = más temprano). */
export function pointPriority(point: unknown): number {
  const p = norm(point);
  if (/CAJ[OÓ]N/.test(p)) return 0;
  if (p === 'TRASLADOS') return 1;
  if (p === 'GARANTIAS' || p === 'GARANTÍAS') return 2;
  if (p === 'OFICINA') return 3;
  if (p === 'RECEPCION' || p === 'RECEPCIÓN') return 4;
  if (p === 'BODEGA' || p.startsWith('BODEGA ')) return 5;
  return 100;
}

export function isCajonPoint(point: unknown): boolean {
  return /CAJ[OÓ]N/i.test(String(point || ''));
}

/** Recogida que viene de camión (última milla / handoff). Va antes que Cajón Norte. */
export function isTruckHandoffTask(t: {
  pickupKind?: string | null;
  handoffFromManifestId?: string | null;
  pickupPoint?: string | null;
}): boolean {
  if (t.pickupKind === 'camion') return true;
  if (t.handoffFromManifestId) return true;
  return /^CAMION\b/i.test(String(t.pickupPoint || '').trim());
}

const HANDOFF_VISIT_PREFIX = 'HANDOFF:';

/**
 * Normaliza nombres de la app al código del planificador Norte.
 * Ej: "BR 12" → B12, "MOL" → MOLINOS, "B2 JUNIN" → B2, "GARANTÍAS" → GARANTIAS.
 */
export function toNorteKey(point: unknown): string {
  const p = norm(point);
  if (!p) return '';
  if (isCajonPoint(p)) return 'CAJON NORTE';
  if (p === 'GARANTÍAS' || p === 'GARANTIAS') return 'GARANTIAS';
  if (p === 'MOL' || p === 'MOLINO' || p === 'MOLINOS') return 'MOLINOS';
  if (p === 'RECEPCIÓN') return 'RECEPCION';
  if (p === 'TRASLADO') return 'TRASLADOS';
  if (p === 'B19 OUTLET' || p === 'B19-OUTLET' || p === 'OUTLET B19') return 'B19 OUTLET';

  const br = p.match(/^BR?\s*0*(\d+)\b/);
  if (br) return `B${Number(br[1])}`;

  const bName = p.match(/^B\s*0*(\d+)\b/);
  if (bName) {
    const key = `B${Number(bName[1])}`;
    if (NORTE_INDEX.has(key)) return key;
  }

  return p;
}

/** Índice en la ruta Norte (0…n). Fuera de lista → 1000+. */
export function norteRank(point: unknown): number {
  const key = toNorteKey(point);
  if (!key || key === 'CAJON NORTE') return 9990;
  const idx = NORTE_INDEX.get(key);
  if (idx !== undefined) return idx;
  return 1000 + pointPriority(key);
}

/**
 * Clave estable para agrupar paradas (B1 ≡ BR 01 ≡ BR1).
 * Si no hay clave Norte, usa el nombre normalizado.
 */
export function stopGroupKey(point: unknown): string {
  const key = toNorteKey(point);
  if (key) return key;
  return norm(point) || 'SIN PUNTO';
}

/** Etiqueta visible al unir alias: prefiere "BR 01" sobre "B1". */
export function preferredStopLabel(labels: string[]): string {
  const clean = labels.map((l) => String(l || '').trim()).filter(Boolean);
  if (!clean.length) return 'Sin punto';
  const br = clean.find((l) => /^BR\s*\d/i.test(l));
  if (br) return br.toUpperCase().replace(/\s+/g, ' ');
  const byLen = [...clean].sort((a, b) => b.length - a.length || a.localeCompare(b));
  return byLen[0];
}

export type OrderedRouteTask = DriverRouteTask & { order: number; deliverOrder: number };

/** Parsea texto del planificador: `B12, MOLINOS, B1` o saltos de línea. */
export function parseRouteOrderText(text: string): string[] {
  return String(text || '')
    .split(/[,;\n\r\t]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export type ComputeMessengerDayOrdersOpts = {
  /** Orden pegado (como en el planificador). Los puntos de la ruta que no vengan van al final. */
  customVisitOrder?: string[];
};

/**
 * Recalcula order/deliverOrder.
 * Prioridad fija de visitas:
 *  1) Recogidas de camión (handoff / última milla)
 *  2) Cajón Norte (recogida)
 *  3) Ruta Norte / orden pegado
 *  4) Cajón Norte (entrega al final, si aplica)
 */
export function computeMessengerDayOrders(
  tasks: DriverRouteTask[],
  opts?: ComputeMessengerDayOrdersOpts
): OrderedRouteTask[] {
  const active = tasks.filter((t) => t.status !== 'cancelada' && !t.reassignedTo);
  if (!active.length) return [];

  const hasCajonPickup = active.some((t) => t.pickupPoint && isCajonPoint(t.pickupPoint));
  const hasCajonDeliver = active.some((t) => isCajonPoint(t.deliverPoint));

  /** Etiquetas de puntos de cruce camión (CAMION ESR736, …), orden estable. */
  const handoffPickupLabels: string[] = [];
  active.forEach((t) => {
    if (!isTruckHandoffTask(t) || !t.pickupPoint || isCajonPoint(t.pickupPoint)) return;
    const label = norm(t.pickupPoint);
    if (label && !handoffPickupLabels.includes(label)) handoffPickupLabels.push(label);
  });
  handoffPickupLabels.sort((a, b) => a.localeCompare(b));

  type Meta = { hint: number };
  const points = new Map<string, Meta>();

  const touch = (raw: unknown, hint: number) => {
    if (!raw) return;
    if (isCajonPoint(raw)) return;
    // Los puntos CAMION* se ordenan aparte (siempre primero).
    if (/^CAMION\b/i.test(String(raw).trim())) return;
    const key = toNorteKey(raw);
    if (!key || key === 'CAJON NORTE') return;
    const prev = points.get(key);
    if (!prev) points.set(key, { hint });
    else prev.hint = Math.min(prev.hint, hint);
  };

  active.forEach((t) => {
    const ord = typeof t.order === 'number' ? t.order : 9999;
    const dOrd = typeof t.deliverOrder === 'number' ? t.deliverOrder : 9999;
    if (!isTruckHandoffTask(t)) touch(t.pickupPoint, ord);
    touch(t.deliverPoint, Math.min(dOrd, t.pickupPoint ? 9999 : ord));
  });

  const customKeys = (opts?.customVisitOrder || [])
    .map((p) => toNorteKey(p))
    .filter((k) => k && k !== 'CAJON NORTE#END');
  const customUnique: string[] = [];
  customKeys.forEach((k) => {
    if (!customUnique.includes(k)) customUnique.push(k);
  });
  const useCustom = customUnique.length > 0;

  const visitKeys: string[] = [];
  const pushVisit = (key: string) => {
    if (!key || visitKeys.includes(key)) return;
    visitKeys.push(key);
  };

  // 1) Siempre primero: lo que viene de los camiones.
  handoffPickupLabels.forEach((label) => pushVisit(HANDOFF_VISIT_PREFIX + label));

  // 2) Cajón Norte (recogida) — primero o segundo.
  if (hasCajonPickup && !(useCustom && customUnique.includes('CAJON NORTE'))) {
    pushVisit('CAJON NORTE');
  }

  if (useCustom) {
    customUnique.forEach((key) => {
      if (key === 'CAJON NORTE') {
        if (hasCajonPickup || hasCajonDeliver) pushVisit('CAJON NORTE');
        return;
      }
      if (points.has(key)) pushVisit(key);
    });
    Array.from(points.entries())
      .sort((a, b) => a[1].hint - b[1].hint || a[0].localeCompare(b[0]))
      .forEach(([key]) => pushVisit(key));
  } else {
    STANDARD_NORTE_ROUTE.forEach((key) => {
      if (points.has(key)) pushVisit(key);
    });
    Array.from(points.entries())
      .filter(([key]) => !NORTE_INDEX.has(key))
      .sort((a, b) => a[1].hint - b[1].hint || a[0].localeCompare(b[0]))
      .forEach(([key]) => pushVisit(key));
  }

  if (hasCajonDeliver) {
    if (hasCajonPickup) pushVisit('CAJON NORTE#END');
    else pushVisit('CAJON NORTE');
  }

  const visitIndex = (point: string, kind: 'pickup' | 'deliver', task?: DriverRouteTask): number => {
    if (kind === 'pickup' && task && isTruckHandoffTask(task) && point) {
      const idx = visitKeys.indexOf(HANDOFF_VISIT_PREFIX + norm(point));
      return idx >= 0 ? idx : 0;
    }
    const key = toNorteKey(point);
    if (kind === 'deliver' && key === 'CAJON NORTE') {
      const end = visitKeys.indexOf('CAJON NORTE#END');
      if (end >= 0) return end;
      return visitKeys.lastIndexOf('CAJON NORTE');
    }
    if (kind === 'pickup' && key === 'CAJON NORTE') {
      const idx = visitKeys.indexOf('CAJON NORTE');
      return idx >= 0 ? idx : handoffPickupLabels.length > 0 ? 1 : 0;
    }
    const idx = visitKeys.indexOf(key);
    return idx >= 0 ? idx : 1000 + norteRank(point);
  };

  return active.map((t) => {
    const pickup = t.pickupPoint ? norm(t.pickupPoint) : '';
    const deliver = norm(t.deliverPoint);
    const order = pickup ? visitIndex(pickup, 'pickup', t) + 1 : undefined;
    let deliverOrder = deliver ? visitIndex(deliver, 'deliver', t) + 1 : undefined;
    if (order != null && deliverOrder != null && deliverOrder <= order) {
      deliverOrder = order + 1;
    }
    return {
      ...t,
      order: order ?? deliverOrder ?? 9999,
      deliverOrder: deliverOrder ?? order ?? 9999,
    };
  });
}

/** Índice de visita de un punto para UI (sin #END). */
export function stopVisitRank(point: string, tasks: DriverRouteTask[]): number {
  const ordered = computeMessengerDayOrders(tasks);
  const key = toNorteKey(point);
  if (key === 'CAJON NORTE') {
    const sample = ordered.find((t) => t.pickupPoint && isCajonPoint(t.pickupPoint));
    if (sample) return sample.order;
  }
  const asPick = ordered.find((t) => toNorteKey(t.pickupPoint) === key);
  if (asPick) return asPick.order;
  const asDeliver = ordered.find((t) => toNorteKey(t.deliverPoint) === key);
  return asDeliver?.deliverOrder ?? 9999;
}

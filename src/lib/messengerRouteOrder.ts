import type { DriverRouteTask } from '@/types';

const norm = (v: unknown) => String(v || '').trim().toUpperCase().replace(/\s+/g, ' ');

/** Prioridad de puntos especiales (menor = más temprano). */
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

export type OrderedRouteTask = DriverRouteTask & { order: number; deliverOrder: number };

/**
 * Recalcula `order` (recogida) y `deliverOrder` (entrega) para un día del mensajero.
 *
 * Visitas:
 * 1) CAJON NORTE (solo recogidas del cajón)
 * 2) TRASLADOS
 * 3) GARANTIAS
 * 4) resto de puntos (tiendas), agrupados; misma tienda junta
 * 5) CAJON NORTE al final si hay entregas a cajón (dejar mercancía)
 */
export function computeMessengerDayOrders(tasks: DriverRouteTask[]): OrderedRouteTask[] {
  const active = tasks.filter((t) => t.status !== 'cancelada' && !t.reassignedTo);
  if (!active.length) return [];

  const hasCajonPickup = active.some((t) => t.pickupPoint && isCajonPoint(t.pickupPoint));
  const hasCajonDeliver = active.some((t) => isCajonPoint(t.deliverPoint));
  const hasTraslados = active.some(
    (t) => norm(t.pickupPoint) === 'TRASLADOS' || norm(t.deliverPoint) === 'TRASLADOS'
  );
  const hasGarantias = active.some((t) => {
    const a = norm(t.pickupPoint);
    const b = norm(t.deliverPoint);
    return a === 'GARANTIAS' || a === 'GARANTÍAS' || b === 'GARANTIAS' || b === 'GARANTÍAS';
  });

  const otherPoints = new Map<string, number>();
  active.forEach((t) => {
    [t.pickupPoint, t.deliverPoint].forEach((raw) => {
      if (!raw) return;
      const p = norm(raw);
      if (!p || isCajonPoint(p) || p === 'TRASLADOS' || p === 'GARANTIAS' || p === 'GARANTÍAS') return;
      const prev = otherPoints.get(p);
      const hint = typeof t.order === 'number' ? t.order : typeof t.deliverOrder === 'number' ? t.deliverOrder : 9999;
      otherPoints.set(p, prev === undefined ? hint : Math.min(prev, hint));
    });
  });

  const visit: string[] = [];
  if (hasCajonPickup) visit.push('CAJON NORTE');
  if (hasTraslados) visit.push('TRASLADOS');
  if (hasGarantias) visit.push('GARANTIAS');
  Array.from(otherPoints.entries())
    .sort((a, b) => pointPriority(a[0]) - pointPriority(b[0]) || a[1] - b[1] || a[0].localeCompare(b[0]))
    .forEach(([p]) => visit.push(p));
  // Entregas a cajón al final (dejar lo que no se pudo entregar), si no quedó solo como 1ª parada de recogida.
  if (hasCajonDeliver) {
    const last = visit[visit.length - 1];
    if (last !== 'CAJON NORTE' || !hasCajonPickup) {
      if (visit[visit.length - 1] !== 'CAJON NORTE') visit.push('CAJON NORTE');
    } else if (hasCajonPickup && hasCajonDeliver) {
      // Ya está al inicio por recogida: añadir segunda visita al final para dejar.
      visit.push('CAJON NORTE#END');
    }
  }

  const visitIndex = (point: string, kind: 'pickup' | 'deliver'): number => {
    const p = norm(point);
    if (kind === 'deliver' && isCajonPoint(p)) {
      const end = visit.indexOf('CAJON NORTE#END');
      if (end >= 0) return end;
      // Solo cajón como entrega (sin recogida previa en lista): última aparición
      const idx = visit.lastIndexOf('CAJON NORTE');
      return idx >= 0 ? idx : visit.length + 50;
    }
    if (kind === 'pickup' && isCajonPoint(p)) {
      const idx = visit.indexOf('CAJON NORTE');
      return idx >= 0 ? idx : 0;
    }
    const idx = visit.findIndex((v) => v === p || norm(v) === p);
    return idx >= 0 ? idx : 1000 + pointPriority(p);
  };

  return active.map((t) => {
    const pickup = t.pickupPoint ? norm(t.pickupPoint) : '';
    const deliver = norm(t.deliverPoint);
    const order = pickup ? visitIndex(pickup, 'pickup') + 1 : undefined;
    let deliverOrder = deliver ? visitIndex(deliver, 'deliver') + 1 : undefined;
    // Garantiza entrega después de recogida cuando ambos existen.
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
  const sample = ordered.find(
    (t) => norm(t.pickupPoint) === norm(point) || (norm(t.deliverPoint) === norm(point) && !isCajonPoint(point))
  );
  if (sample && norm(sample.pickupPoint) === norm(point)) return sample.order;
  const asDeliver = ordered.find((t) => norm(t.deliverPoint) === norm(point));
  return asDeliver?.deliverOrder ?? 9999;
}

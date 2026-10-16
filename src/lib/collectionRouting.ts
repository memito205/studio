import { normalizeStoreCode } from '@/lib/deliveryStores';
import type { DeliveryStore, TransferEntry } from '@/types';

/**
 * Mensajero (flujo Cajón): Juan Esteban Castañeda u operarios marcados isMessenger.
 * Off-route / no entrega → Cajón; nunca Validado Supervisor ni Entregado en Ruta.
 */
export function isMessengerDriver(opts: {
  displayName?: string | null;
  email?: string | null;
  isMessenger?: boolean | null;
}): boolean {
  if (opts.isMessenger === true) return true;
  const raw = `${opts.displayName || ''} ${opts.email || ''}`;
  const n = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ');
  const hasJuan = /\bJUAN\b/.test(n);
  const hasEsteban = /\bESTEBAN\b/.test(n);
  const hasCastaneda = /\bCASTANEDA\b/.test(n);
  // Juan Esteban Castañeda (con o sin segundo nombre completo)
  if (hasCastaneda && (hasJuan || hasEsteban)) return true;
  if (hasJuan && hasEsteban && hasCastaneda) return true;
  return false;
}

/** Normaliza destino TF a claves comparables (código + texto). */
export function destinationKeys(destino: unknown, match?: (v: unknown) => DeliveryStore | undefined): string[] {
  const raw = String(destino || '').trim();
  if (!raw) return [];
  const keys = new Set<string>();
  keys.add(normalizeStoreCode(raw));
  keys.add(raw.toUpperCase().replace(/\s+/g, ' ').trim());
  if (match) {
    const store = match(raw);
    if (store) {
      keys.add(normalizeStoreCode(store.codigoErp));
      keys.add(normalizeStoreCode(store.nombreCorto));
      (store.codigosEquivalentes || []).forEach((c) => keys.add(normalizeStoreCode(c)));
    }
  }
  return Array.from(keys).filter(Boolean);
}

export function isDestinationOnRoute(
  destino: unknown,
  onRouteKeys: Set<string>,
  match?: (v: unknown) => DeliveryStore | undefined
): boolean {
  if (onRouteKeys.size === 0) return false;
  return destinationKeys(destino, match).some((k) => onRouteKeys.has(k));
}

export type CollectionRouteBucket = 'on_route' | 'messenger_cajon' | 'supervisor';

export function classifyCollectedTransfer(
  transfer: Pick<TransferEntry, 'bodegaDestino'>,
  opts: { onRouteKeys: Set<string>; isMessenger: boolean; match?: (v: unknown) => DeliveryStore | undefined }
): CollectionRouteBucket {
  if (isDestinationOnRoute(transfer.bodegaDestino, opts.onRouteKeys, opts.match)) {
    return 'on_route';
  }
  if (opts.isMessenger) return 'messenger_cajon';
  return 'supervisor';
}

/** Día Bogotá YYYY-MM-DD. */
export function bogotaDayKey(d: Date = new Date()): string {
  const bogota = new Date(d.getTime() - 5 * 3600 * 1000);
  const y = bogota.getUTCFullYear();
  const m = String(bogota.getUTCMonth() + 1).padStart(2, '0');
  const day = String(bogota.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

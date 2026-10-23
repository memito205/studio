import type { TransferStatus } from '@/types';

const TRANSFER_STATUSES: TransferStatus[] = [
  'En Tránsito',
  'Recolectado en Ruta',
  'Entregado en Ruta',
  'Validado Supervisor',
  'Recibido en Bodega',
  'Enviado a Destino',
  'Entregado en Tienda',
  'Novedad de Entrega',
];

export function normalizeTransferRoutePart(value: string | undefined | null): string {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

const COMMITTED_ROUTE_STATUSES: TransferStatus[] = [
  'Enviado a Destino',
  'Entregado en Tienda',
  'Entregado en Ruta',
  'Novedad de Entrega',
];

/** La línea ya salió en una relación o tiene prueba de entrega. Su destino no se reescribe. */
export function isTransferCommittedToRoute(data: {
  status?: TransferStatus | null;
  manifestId?: unknown;
  podManifestDocId?: unknown;
  podStopId?: unknown;
}): boolean {
  if (data.manifestId || data.podManifestDocId || data.podStopId) return true;
  return !!data.status && COMMITTED_ROUTE_STATUSES.includes(data.status);
}

/** Misma clave que el cargue de la base: TF + marca + grupo. */
export function transferBrandKey(t: { numeroTF?: unknown; marca?: unknown; grupo?: unknown }): string {
  return `${t.numeroTF}-${String(t.marca || '').trim().toUpperCase()}-${String(t.grupo || '').trim().toUpperCase()}`;
}

export function transferOriginDestKey(t: { bodegaOrigen?: unknown; bodegaDestino?: unknown }): string {
  return `${String(t.bodegaOrigen || '').trim().toUpperCase()}|${String(t.bodegaDestino || '').trim().toUpperCase()}`;
}

/**
 * Si la fila del archivo es otro origen/destino y la línea ya está en una relación,
 * no se toca esa línea: la ruta nueva queda aparte, en Recibido en Bodega.
 */
export function pickExistingTransferLine<T extends { data: { bodegaOrigen?: unknown; bodegaDestino?: unknown; status?: TransferStatus | null; manifestId?: unknown; podManifestDocId?: unknown; podStopId?: unknown } }>(
  docs: T[],
  incoming: { bodegaOrigen?: unknown; bodegaDestino?: unknown }
): { kind: 'update'; line: T } | { kind: 'split'; sibling: T } | { kind: 'add' } {
  const route = transferOriginDestKey(incoming);
  const same = docs.find((d) => transferOriginDestKey(d.data) === route);
  if (same) return { kind: 'update', line: same };
  const editable = docs.find((d) => !isTransferCommittedToRoute(d.data));
  if (editable) return { kind: 'update', line: editable };
  if (docs[0]) return { kind: 'split', sibling: docs[0] };
  return { kind: 'add' };
}

/** Clave operativa TF + origen + destino (sin placa). */
export function buildTransferRouteKey(
  numeroTF: string,
  bodegaOrigen: string,
  bodegaDestino: string
): string {
  return `${normalizeTransferRoutePart(numeroTF)}|${normalizeTransferRoutePart(bodegaOrigen)}|${normalizeTransferRoutePart(bodegaDestino)}`;
}

export function parseTransferStatusValue(value: string | undefined | null): TransferStatus | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const match = TRANSFER_STATUSES.find((s) => s.toLowerCase() === raw.toLowerCase());
  return match ?? null;
}

export function findCaseInsensitiveKey(row: Record<string, unknown>, candidates: string[]): string | undefined {
  const keys = Object.keys(row);
  for (const candidate of candidates) {
    const found = keys.find((k) => k.trim().toLowerCase() === candidate.toLowerCase());
    if (found) return found;
  }
  return undefined;
}

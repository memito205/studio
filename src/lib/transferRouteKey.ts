import type { TransferStatus } from '@/types';

const TRANSFER_STATUSES: TransferStatus[] = [
  'En Tránsito',
  'Recolectado en Ruta',
  'Entregado en Ruta',
  'Validado Supervisor',
  'Recibido en Bodega',
  'Enviado a Destino',
];

export function normalizeTransferRoutePart(value: string | undefined | null): string {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
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

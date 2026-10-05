import type { DeliveryPhotoCategory, DeliveryStopStatus, DriverRouteTask } from '@/types';

/** "TF 123" o, en envíos sin TF, la descripción con su código. */
export const routeTaskLabel = (t: Pick<DriverRouteTask, 'kind' | 'numeroTF' | 'description'>) =>
  t.kind === 'libre' ? `${t.description || 'Envío'} (${t.numeroTF})` : `TF ${t.numeroTF}`;

/** Texto del planificador que parece número de TF (solo dígitos, con o sin prefijo TF). */
export const looksLikeTfNumber = (v: string) => /^(TF[-\s]?)?\d{3,}$/i.test(String(v || '').trim());

export const MAX_DELIVERY_PHOTOS = 20;

/** Solo las relaciones creadas desde aquí aparecen en la app del conductor (05/10/2026 9:45 a. m. Colombia). */
export const POD_START_AT = new Date('2026-10-05T14:45:00Z');

export const PHOTO_CATEGORIES: Array<{ id: DeliveryPhotoCategory; label: string; required?: boolean }> = [
  { id: 'remision', label: 'Remisión firmada', required: true },
  { id: 'mercancia', label: 'Mercancía entregada' },
  { id: 'fachada', label: 'Fachada / quien recibe' },
  { id: 'otra', label: 'Otra' },
];

export const NOT_DELIVERED_REASONS = [
  'Tienda cerrada',
  'Tienda no recibe (sin espacio / sin personal)',
  'Rechazada por la tienda',
  'Caja dañada',
  'No se alcanzó a llegar',
  'Caja no estaba en el vehículo',
  'Otro',
];

export const STOP_STATUS_LABEL: Record<DeliveryStopStatus, string> = {
  pendiente: 'Pendiente',
  entregada: 'Entregada',
  parcial: 'Entrega parcial',
  no_entregada: 'No entregada',
};

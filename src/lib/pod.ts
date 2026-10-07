import type { DeliveryPhotoCategory, DeliveryStopStatus, DriverRouteTask, StoreReceptionStatus } from '@/types';

/** "TF 123" o, en envíos sin TF, la descripción con su código. */
export const routeTaskLabel = (t: Pick<DriverRouteTask, 'kind' | 'numeroTF' | 'description'>) =>
  t.kind === 'libre' ? `${t.description || 'Envío'} (${t.numeroTF})` : `TF ${t.numeroTF}`;

/** Texto del planificador que parece número de TF (solo dígitos, con o sin prefijo TF). */
export const looksLikeTfNumber = (v: string) => /^(TF[-\s]?)?\d{3,}$/i.test(String(v || '').trim());

export const MAX_DELIVERY_PHOTOS = 20;

/** Solo las relaciones creadas desde aquí aparecen en la app del conductor (05/10/2026 9:45 a. m. Colombia). */
export const POD_START_AT = new Date('2026-10-05T14:45:00Z');

/** Las tiendas solo ven/reciben por relación las creadas desde el 09/10/2026 (hora Colombia). */
export const STORE_RECEPTION_START_AT = new Date('2026-10-09T05:00:00Z');

/** Id de la parada de una tienda dentro de la relación (igual que `createManifestStops`). */
export const storeStopId = (storeCode: string) => String(storeCode || '').replace(/\//g, '-');

export const STORE_RECEPTION_LABEL: Record<StoreReceptionStatus, string> = {
  completa: 'Recibida completa',
  con_faltantes: 'Cerrada con faltantes',
  completada_por_conductor: 'Completada (entrega del conductor aprobada)',
  no_entregada: 'No entregada por el conductor',
  cerrada_por_logistica: 'Cerrada por logística',
};

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

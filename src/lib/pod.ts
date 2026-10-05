import type { DeliveryPhotoCategory, DeliveryStopStatus } from '@/types';

export const MAX_DELIVERY_PHOTOS = 20;

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

import type { EcommerceOrder } from '@/types';
import { normalizeEcommerceGuide } from '@/lib/ecommerceDispatch';

/** Documentos `ecommerceOrderIndex/s{n}`: mapa `o` pedidoId -> huella de los campos que trae el reporte. */
export const ECOM_INDEX_SHARDS = 16;

export const ecomIndexShard = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % ECOM_INDEX_SHARDS;
};

/** Huella de los campos del archivo. La guía solo entra cuando viene en el reporte, para no releer pedidos que no traen esa columna. */
export const ecomOrderFingerprint = (o: Pick<EcommerceOrder, 'estado' | 'tienda' | 'bodega' | 'valorTotal' | 'transportadora' | 'guia'>) => {
  const guide = normalizeEcommerceGuide(o.guia);
  const s = [o.estado || '', o.tienda || '', o.bodega || '', String(o.valorTotal ?? ''), o.transportadora || ''].join('\u0001') + (guide ? `\u0001${guide}` : '');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
};

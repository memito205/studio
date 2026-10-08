import type { EcommerceOrder } from '@/types';

/** Documentos `ecommerceOrderIndex/s{n}`: mapa `o` pedidoId -> huella de los campos que trae el reporte. */
export const ECOM_INDEX_SHARDS = 16;

export const ecomIndexShard = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % ECOM_INDEX_SHARDS;
};

/** Huella (FNV-1a 32 bits) de los campos del archivo; dispatchDate no entra porque se edita aparte. */
export const ecomOrderFingerprint = (o: Pick<EcommerceOrder, 'estado' | 'tienda' | 'bodega' | 'valorTotal' | 'transportadora'>) => {
  const s = [o.estado || '', o.tienda || '', o.bodega || '', String(o.valorTotal ?? ''), o.transportadora || ''].join('\u0001');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
};

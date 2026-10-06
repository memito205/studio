import { collection, getDocs } from 'firebase/firestore';
import { firestore } from '@/services/firebase';
import type { DeliveryStore } from '@/types';

/**
 * Maestro de tiendas en memoria del servidor (por instancia). Lo usan acciones de alta frecuencia
 * (cada escaneo en tienda, cada parada registrada); sin caché cada llamada leía toda la colección.
 */
const TTL_MS = 10 * 60 * 1000;
let cache: { at: number; stores: DeliveryStore[] } | null = null;
let inflight: Promise<DeliveryStore[]> | null = null;

export async function getDeliveryStoresCached(): Promise<DeliveryStore[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.stores;
  if (!inflight) {
    inflight = getDocs(collection(firestore, 'deliveryStores'))
      .then((snap) => {
        const stores = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as DeliveryStore);
        cache = { at: Date.now(), stores };
        return stores;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function invalidateDeliveryStoresCache() {
  cache = null;
}

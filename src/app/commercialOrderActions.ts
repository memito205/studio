'use server';

import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { firestore } from '@/services/firebase';

export type CommercialReceptionOption = {
  id: string;
  rk: string;
  supplier: string;
  status: string;
  scanned: number;
};

export type CommercialStockLine = {
  referencia: string;
  nombre: string;
  talla: string;
  cantidad: number;
};

const asText = (value: unknown) => String(value ?? '').trim();

/** Últimas recepciones. 40 lecturas, una sola vez al abrir la lista. */
export async function listRecentReceptionsForCommercial(): Promise<{
  data?: CommercialReceptionOption[];
  error?: string;
}> {
  try {
    const snap = await getDocs(
      query(collection(firestore, 'receptionOperations'), orderBy('created_at', 'desc'), limit(40))
    );
    const data = snap.docs.map((d) => {
      const row = d.data();
      return {
        id: d.id,
        rk: asText(row.rk_identifier) || d.id,
        supplier: asText(row.supplier),
        status: asText(row.status),
        scanned: Number(row.totalScannedQuantity) || 0,
      };
    });
    return { data };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'No se pudieron leer las recepciones.';
    return { error: message };
  }
}

/**
 * Talla y cantidad leída de una recepción.
 * Una consulta por reception_id. Tope 8000 documentos para no recorrer la colección.
 */
export async function loadReceptionStockForCommercial(
  receptionId: string
): Promise<{ data?: CommercialStockLine[]; truncated?: boolean; error?: string }> {
  const id = asText(receptionId);
  if (!id) return { error: 'Elija una recepción.' };
  try {
    const snap = await getDocs(
      query(collection(firestore, 'scannedItems'), where('reception_id', '==', id), limit(8000))
    );
    const grouped = new Map<string, CommercialStockLine>();
    snap.docs.forEach((d) => {
      const row = d.data();
      const referencia = asText(row.reference);
      const talla = asText(row.talla);
      const cantidad = Number(row.quantity) || 0;
      if (!referencia || !talla || cantidad <= 0) return;
      const key = `${referencia}\u0001${talla}`;
      const prev = grouped.get(key);
      if (prev) prev.cantidad += cantidad;
      else grouped.set(key, { referencia, nombre: asText(row.item), talla, cantidad });
    });
    return { data: Array.from(grouped.values()), truncated: snap.size >= 8000 };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'No se pudo leer lo escaneado.';
    return { error: message };
  }
}

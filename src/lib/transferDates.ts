/** Fechas de transferencias que deben ser estables (no cambian al reimprimir ni al volver a recibir). */

const toDate = (v: unknown): Date | null => {
  if (!v) return null;
  const d =
    v instanceof Date
      ? v
      : typeof (v as any)?.toDate === 'function'
        ? (v as any).toDate()
        : typeof (v as any)?.seconds === 'number'
          ? new Date((v as any).seconds * 1000)
          : new Date(v as any);
  return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
};

type TransferLike = {
  status?: string;
  recibidoAt?: unknown;
  statusHistory?: Array<{ status?: string; at?: unknown }> | unknown;
};

/**
 * Primera llegada a bodega: la entrada más antigua "Recibido en Bodega" del historial;
 * sin historial, `recibidoAt` solo si la TF ya está en Recibido en Bodega o Enviado a Destino. Null si nunca llegó.
 */
export function firstWarehouseArrival(t: TransferLike): Date | null {
  const history = Array.isArray(t.statusHistory) ? t.statusHistory : [];
  let earliest: Date | null = null;
  history.forEach((h: any) => {
    if (h?.status !== 'Recibido en Bodega') return;
    const d = toDate(h.at);
    if (d && (!earliest || d < earliest)) earliest = d;
  });
  if (earliest) return earliest;
  return t.status === 'Recibido en Bodega' || t.status === 'Enviado a Destino' ? toDate(t.recibidoAt) : null;
}

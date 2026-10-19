/**
 * TF en ruta / Mis entregas sin legalizar.
 * No debe cambiarse el estado a mano hasta entrega, no entrega, cajón o dejar en bodega.
 */
export function isTransferLockedInRoute(t: {
  status?: string | null;
  misEntregasTaskOpen?: boolean | null;
}): boolean {
  if (t.misEntregasTaskOpen === true) return true;
  return t.status === 'Enviado a Destino';
}

export function transferLockedInRouteMessage(t: {
  numeroTF?: string | null;
  id?: string | null;
  status?: string | null;
  misEntregasTaskOpen?: boolean | null;
}): string {
  const tf = String(t.numeroTF || t.id || 'TF').trim() || 'TF';
  if (t.misEntregasTaskOpen === true) {
    return `La TF ${tf} está en Mis entregas del conductor. Solo se legaliza con entrega, no entrega, dejar en cajón o dejar en bodega (no se puede cambiar el estado a mano).`;
  }
  if (t.status === 'Enviado a Destino') {
    return `La TF ${tf} ya está Enviado a Destino (en relación de entrega / en ruta). No se puede cambiar el estado hasta que el conductor legalice la parada.`;
  }
  return `La TF ${tf} está en ruta y no admite cambio de estado manual.`;
}

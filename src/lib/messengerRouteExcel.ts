import * as XLSX from 'xlsx';
import type { DriverRouteTask } from '@/types';
import { isCajonPoint, stopGroupKey, toNorteKey } from '@/lib/messengerRouteOrder';

/** Misma estructura que exportNorteMessengerRoute (Rutas → Excel mensajero). */
export type MessengerRouteExcelRow = {
  FECHA: string;
  'NUMERO TF': string;
  Atributo: 'RECOGER' | 'ENTREGAR';
  Valor: string;
  ORDEN: number;
  FIRMA: string;
};

/** Fecha de día `yyyy-MM-dd` → `dd/MM/yyyy`. */
export function formatMessengerRouteDate(day: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const [y, m, d] = day.split('-');
    return `${d}/${m}/${y}`;
  }
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${now.getFullYear()}`;
}

function tfLabel(t: DriverRouteTask): string {
  if (t.kind === 'libre') return String(t.description || t.refText || t.numeroTF || '').trim();
  return String(t.numeroTF || '').trim();
}

const CAJON_LABEL = 'CAJON NORTE';
/** Visit sort muy alto: entregas inválidas (ya pasamos el destino) van al final como cajón. */
const CAJON_END_VISIT = 900_000;

/**
 * Arma filas RECOGER/ENTREGAR como el Excel del mensajero.
 *
 * Igual que el planificador Norte: si la recogida es en una parada posterior a la del
 * destino, no se vuelve a esa tienda — la ENTREGAR sale como CAJON NORTE al final.
 * (La decisión real de dejar en cajón la toma el mensajero en la app; el Excel solo
 * muestra el orden lógico para no confundir.)
 */
export function buildMessengerRouteExcelRows(tasks: DriverRouteTask[]): MessengerRouteExcelRow[] {
  type Action = {
    visit: number;
    day: string;
    tf: string;
    atributo: 'RECOGER' | 'ENTREGAR';
    valor: string;
    stopKey: string;
  };
  const byKey = new Map<string, DriverRouteTask[]>();
  tasks
    .filter((t) => t.status !== 'cancelada' && !t.reassignedTo)
    .forEach((t) => {
      const key = `${t.day || ''}|${t.driverId || ''}`;
      const list = byKey.get(key) || [];
      list.push(t);
      byKey.set(key, list);
    });

  const rows: MessengerRouteExcelRow[] = [];
  Array.from(byKey.keys())
    .sort()
    .forEach((key) => {
      const list = byKey.get(key) || [];

      // Primera aparición de cada parada en la ruta (order / deliverOrder guardados).
      const stopFirstVisit = new Map<string, number>();
      const touchStop = (point: string, visit: number) => {
        if (!point || isCajonPoint(point)) return;
        const sk = stopGroupKey(point);
        const prev = stopFirstVisit.get(sk);
        if (prev === undefined || visit < prev) stopFirstVisit.set(sk, visit);
      };
      list.forEach((t) => {
        const pickOrd = typeof t.order === 'number' ? t.order : 9999;
        const delOrd = typeof t.deliverOrder === 'number' ? t.deliverOrder : pickOrd + 5000;
        if (t.pickupPoint) touchStop(String(t.pickupPoint), pickOrd);
        if (t.deliverPoint) touchStop(String(t.deliverPoint), delOrd);
      });

      const stopSequence = Array.from(stopFirstVisit.entries())
        .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
        .map(([sk]) => sk);
      const stopIndex = new Map(stopSequence.map((sk, i) => [sk, i]));

      const actions: Action[] = [];
      list.forEach((t) => {
        const tf = tfLabel(t);
        if (!tf) return;
        const day = t.day || '';
        const pickup = String(t.pickupPoint || '').trim();
        const deliver = String(t.deliverPoint || '').trim();
        const pickOrd = typeof t.order === 'number' ? t.order : 9999;
        const delOrd = typeof t.deliverOrder === 'number' ? t.deliverOrder : pickOrd + 5000;

        const dKey = deliver && !isCajonPoint(deliver) ? stopGroupKey(deliver) : '';
        const dIdx = dKey ? stopIndex.get(dKey) : undefined;
        const pIdx = pickup ? stopIndex.get(stopGroupKey(pickup)) : undefined;
        // Recogida después de haber pasado por el destino → no volver; entrega lógica = cajón.
        const pickupAfterDestination =
          !!pickup &&
          !!deliver &&
          !isCajonPoint(deliver) &&
          pIdx !== undefined &&
          dIdx !== undefined &&
          pIdx > dIdx;

        if (pickup) {
          // Si esa TF no alcanza el destino hoy, al recoger ya ve para qué tienda era.
          const pickValor =
            pickupAfterDestination && deliver ? `${pickup} (→ ${deliver})` : pickup;
          actions.push({
            visit: pickOrd,
            day,
            tf,
            atributo: 'RECOGER',
            valor: pickValor,
            stopKey: stopGroupKey(pickup),
          });
        }

        if (!deliver) return;

        // Ya es cajón / bodega especial: conservar destino si venía en notas no aplica; mostrar cajón.
        if (isCajonPoint(deliver) || toNorteKey(deliver) === 'BODEGA') {
          actions.push({
            visit: delOrd,
            day,
            tf,
            atributo: 'ENTREGAR',
            valor: isCajonPoint(deliver) ? CAJON_LABEL : deliver,
            stopKey: 'CAJON NORTE',
          });
          return;
        }

        if (pickupAfterDestination) {
          // Cajón + almacén destino original (para que al imprimir sepa para dónde era).
          actions.push({
            visit: CAJON_END_VISIT + delOrd,
            day,
            tf,
            atributo: 'ENTREGAR',
            valor: `${CAJON_LABEL} (→ ${deliver})`,
            stopKey: 'CAJON NORTE',
          });
          return;
        }

        actions.push({
          visit: delOrd,
          day,
          tf,
          atributo: 'ENTREGAR',
          valor: deliver,
          stopKey: dKey,
        });
      });

      actions.sort(
        (a, b) =>
          a.visit - b.visit ||
          (a.atributo === 'RECOGER' ? 0 : 1) - (b.atributo === 'RECOGER' ? 0 : 1) ||
          a.valor.localeCompare(b.valor) ||
          a.tf.localeCompare(b.tf, undefined, { numeric: true })
      );
      const fecha = formatMessengerRouteDate(list[0]?.day || '');
      actions.forEach((a, i) => {
        rows.push({
          FECHA: fecha,
          'NUMERO TF': a.tf,
          Atributo: a.atributo,
          Valor: a.valor,
          ORDEN: i + 1,
          FIRMA: '',
        });
      });
    });

  return rows;
}

export function downloadMessengerRouteExcel(
  tasks: DriverRouteTask[],
  opts?: { fileName?: string; sheetName?: string }
): { ok: boolean; rows: number; taskCount: number; drivers: number; error?: string } {
  const active = tasks.filter((t) => t.status !== 'cancelada' && !t.reassignedTo);
  const taskCount = active.length;
  const drivers = new Set(active.map((t) => t.driverId).filter(Boolean)).size;
  const data = buildMessengerRouteExcelRows(tasks);
  if (data.length === 0) return { ok: false, rows: 0, taskCount: 0, drivers: 0, error: 'No hay tareas para exportar.' };
  try {
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, opts?.sheetName || 'Ruta Mensajero');
    const day = active[0]?.day || tasks[0]?.day || formatMessengerRouteDate('').split('/').reverse().join('-');
    const safeDay = /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : day.replace(/\//g, '-');
    const driverPart =
      drivers === 1 ? `_${String(active[0]?.driverName || 'mensajero').replace(/\s+/g, '_')}` : drivers > 1 ? `_${drivers}mensajeros` : '';
    XLSX.writeFile(workbook, opts?.fileName || `RUTA_DEL_MENSAJERO_${safeDay}${driverPart}.xlsx`);
    return { ok: true, rows: data.length, taskCount, drivers };
  } catch (e: any) {
    return { ok: false, rows: 0, taskCount: 0, drivers: 0, error: e?.message || 'No se pudo generar el Excel.' };
  }
}

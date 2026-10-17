import * as XLSX from 'xlsx';
import type { DriverRouteTask } from '@/types';

/** Misma estructura que exportNorteMessengerRoute (Rutas → Excel mensajero). */
export type MessengerRouteExcelRow = {
  FECHA: string;
  'NUMERO TF': string;
  Atributo: 'RECOGER' | 'ENTREGAR';
  Valor: string;
  ORDEN: number;
  FIRMA: string;
};

const isCajonPoint = (v: unknown) => /CAJ[OÓ]N/i.test(String(v || ''));

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

/**
 * Arma filas RECOGER/ENTREGAR como el Excel del mensajero.
 * CAJON NORTE (recogida) va primero; ORDEN se renumera 1..n.
 */
export function buildMessengerRouteExcelRows(tasks: DriverRouteTask[]): MessengerRouteExcelRow[] {
  type Action = { sort: number; day: string; tf: string; atributo: 'RECOGER' | 'ENTREGAR'; valor: string };
  const actions: Action[] = [];

  tasks
    .filter((t) => t.status !== 'cancelada' && !t.reassignedTo)
    .forEach((t) => {
      const tf = tfLabel(t);
      if (!tf) return;
      const day = t.day || '';
      const pickup = String(t.pickupPoint || '').trim();
      const deliver = String(t.deliverPoint || '').trim();
      const baseOrder = typeof t.order === 'number' ? t.order : isCajonPoint(pickup) ? 1 : 9999;
      const deliverOrd =
        typeof t.deliverOrder === 'number' ? t.deliverOrder : pickup ? baseOrder + 5000 : baseOrder;

      if (pickup) {
        // Cajón: sort muy bajo para quedar al inicio aunque order venga mal.
        const sort = isCajonPoint(pickup) ? baseOrder : baseOrder + 10;
        actions.push({ sort, day, tf, atributo: 'RECOGER', valor: pickup });
      }
      if (deliver) {
        actions.push({
          sort: isCajonPoint(pickup) ? deliverOrd + 10 : deliverOrd + 10,
          day,
          tf,
          atributo: 'ENTREGAR',
          valor: deliver,
        });
      }
    });

  actions.sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      a.sort - b.sort ||
      (a.atributo === 'RECOGER' ? 0 : 1) - (b.atributo === 'RECOGER' ? 0 : 1) ||
      a.tf.localeCompare(b.tf, undefined, { numeric: true })
  );

  // Dentro del mismo día: RECOGER en CAJON primero, luego resto por sort, ORDEN correlativo.
  const byDay = new Map<string, Action[]>();
  actions.forEach((a) => {
    const list = byDay.get(a.day) || [];
    list.push(a);
    byDay.set(a.day, list);
  });

  const rows: MessengerRouteExcelRow[] = [];
  Array.from(byDay.keys())
    .sort()
    .forEach((day) => {
      const list = byDay.get(day) || [];
      list.sort((a, b) => {
        const aCajon = a.atributo === 'RECOGER' && isCajonPoint(a.valor) ? 0 : 1;
        const bCajon = b.atributo === 'RECOGER' && isCajonPoint(b.valor) ? 0 : 1;
        return aCajon - bCajon || a.sort - b.sort || a.atributo.localeCompare(b.atributo) || a.tf.localeCompare(b.tf, undefined, { numeric: true });
      });
      const fecha = formatMessengerRouteDate(day);
      list.forEach((a, i) => {
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
): { ok: boolean; rows: number; error?: string } {
  const data = buildMessengerRouteExcelRows(tasks);
  if (data.length === 0) return { ok: false, rows: 0, error: 'No hay tareas para exportar.' };
  try {
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, opts?.sheetName || 'Ruta Mensajero');
    const day = tasks[0]?.day || formatMessengerRouteDate('').split('/').reverse().join('-');
    const safeDay = /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : day.replace(/\//g, '-');
    XLSX.writeFile(workbook, opts?.fileName || `RUTA_DEL_MENSAJERO_${safeDay}.xlsx`);
    return { ok: true, rows: data.length };
  } catch (e: any) {
    return { ok: false, rows: 0, error: e?.message || 'No se pudo generar el Excel.' };
  }
}

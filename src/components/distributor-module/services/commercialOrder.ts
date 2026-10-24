import * as XLSX from 'xlsx';
import { findCaseInsensitiveKey } from '@/lib/parsingUtils';
import { calculateAutoCurves, distribute } from './distributor';
import type { Allocation, StockItem } from '../types';

export type CommercialInputRow = {
  referencia: string;
  nit: string;
  cant: number | null;
  precio: number;
  bodega: string;
};

export type CommercialHeader = {
  nitUnico: string;
  sucursal: string;
  tipoCliente: string;
  condPago: string;
  vendedor: string;
  co: string;
  bodegaDefault: string;
  listaPrecio: string;
  dias: number;
  nroPedido: number;
  fecha: string;
};

const cellText = (value: unknown) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Number.isInteger(value) ? value : value).replace(/\.0+$/, '').trim();
  }
  return String(value).trim();
};

const headerOf = (row: Record<string, unknown>, ...names: string[]) => {
  const key = findCaseInsensitiveKey(row, ...names);
  return key ? row[key] : undefined;
};

export const parseCommercialRows = (json: Record<string, unknown>[]): CommercialInputRow[] => {
  return json
    .map((row) => {
      const referencia = cellText(headerOf(row, 'REFERENCIA', 'REF'));
      const precio = Number(cellText(headerOf(row, 'PRECIO', 'PRECIO_UNI', 'PRECIO UNI')).replace(',', '.'));
      const cantRaw = cellText(headerOf(row, 'CANT', 'CANTIDAD'));
      const cant = cantRaw === '' ? null : Number(cantRaw.replace(',', '.'));
      return {
        referencia,
        nit: cellText(headerOf(row, 'NIT', 'TERCERO', 'CLIENTE')),
        cant: cant !== null && Number.isFinite(cant) ? cant : null,
        precio,
        bodega: cellText(headerOf(row, 'BODEGA')).toUpperCase(),
      };
    })
    .filter((row) => row.referencia);
};

const splitEqual = (total: number, parts: number) => {
  const safe = Math.max(0, Math.floor(total));
  const n = Math.max(1, parts);
  const base = Math.floor(safe / n);
  let rest = safe - base * n;
  return Array.from({ length: n }, () => {
    const extra = rest > 0 ? 1 : 0;
    if (rest > 0) rest -= 1;
    return base + extra;
  });
};

const stockByRef = (stock: StockItem[]) => {
  const map = new Map<string, number>();
  stock.forEach((item) => {
    const ref = String(item.REFERENCIA).trim();
    map.set(ref, (map.get(ref) || 0) + Number(item['CANTD LEIDA']) || 0);
  });
  return map;
};

export type ResolvedCommercialLine = {
  referencia: string;
  nit: string;
  bodega: string;
  cant: number;
  precio: number;
  destino: string;
};

/** Arma el plan: NIT de la fila o el de pantalla, bodega de la fila o la de pantalla, cantidad vacía repartida. */
export const resolveCommercialLines = (
  rows: CommercialInputRow[],
  stock: StockItem[],
  header: CommercialHeader
): { lines: ResolvedCommercialLine[]; notes: string[] } => {
  const notes: string[] = [];
  const bodegaDefault = header.bodegaDefault.trim().toUpperCase();
  const nitUnico = header.nitUnico.trim();
  const available = stockByRef(stock);
  const byRef = new Map<string, CommercialInputRow[]>();
  rows.forEach((row) => {
    const list = byRef.get(row.referencia) || [];
    list.push(row);
    byRef.set(row.referencia, list);
  });

  const lines: ResolvedCommercialLine[] = [];
  for (const [referencia, group] of byRef) {
    const stockQty = available.get(referencia) || 0;
    if (stockQty <= 0) {
      throw new Error(`La referencia ${referencia} no está en lo leído de la recepción.`);
    }
    const specified = group.reduce((sum, row) => sum + (row.cant !== null ? row.cant : 0), 0);
    if (specified > stockQty) {
      throw new Error(`La referencia ${referencia} pide ${specified} y lo leído son ${stockQty}.`);
    }
    const empty = group.filter((row) => row.cant === null);
    const shares = splitEqual(stockQty - specified, Math.max(empty.length, 1));
    let emptyIndex = 0;
    group.forEach((row) => {
      const nit = row.nit || nitUnico;
      if (!nit) throw new Error(`La referencia ${referencia} no tiene NIT. Escríbalo en el archivo o en el campo de un solo cliente.`);
      if (!Number.isFinite(row.precio) || row.precio <= 0) {
        throw new Error(`La referencia ${referencia} del NIT ${nit} no tiene precio.`);
      }
      const bodega = row.bodega || bodegaDefault;
      if (!bodega) throw new Error(`La referencia ${referencia} del NIT ${nit} no tiene bodega.`);
      const cant = row.cant !== null ? row.cant : shares[emptyIndex++] || 0;
      if (cant <= 0) return;
      const destino = `${nit}||${bodega}`;
      const existing = lines.find((line) => line.destino === destino && line.referencia === referencia);
      if (existing) {
        if (existing.precio !== row.precio) {
          throw new Error(`La referencia ${referencia} del NIT ${nit} en ${bodega} tiene dos precios distintos.`);
        }
        existing.cant += cant;
        return;
      }
      lines.push({ referencia, nit, bodega, cant, precio: row.precio, destino });
    });
  }
  if (lines.length === 0) throw new Error('No quedó cantidad por repartir.');
  if (rows.some((row) => row.cant === null)) {
    notes.push('Las cantidades vacías se partieron con lo leído de cada referencia.');
  }
  return { lines, notes };
};

const ymd = (fecha: string) => fecha.replace(/-/g, '');

const sizeToExte = (talla: string): number | string => {
  const normalized = String(talla).replace(',', '.').trim();
  const numeric = parseFloat(normalized);
  if (Number.isNaN(numeric)) return talla;
  const mapping: Record<string, number> = {
    '100': 10, '105': 10.5, '110': 11, '120': 12, '80': 8, '85': 8.5, '90': 9, '95': 9.5, '70': 7, '75': 7.5, '130': 13,
  };
  if (mapping[normalized]) return mapping[normalized];
  if (Number.isInteger(numeric) && numeric > 30) return numeric / 10;
  return numeric;
};

export const buildCommercialWorkbook = (
  stock: StockItem[],
  lines: ResolvedCommercialLine[],
  header: CommercialHeader
) => {
  const plan = lines.map((line) => ({
    REFERENCIA: line.referencia,
    BODEGA: line.destino,
    CANT: line.cant,
  }));
  const curves = calculateAutoCurves(stock);
  const allocation: Allocation = distribute(stock, plan, curves);
  const priceOf = new Map(lines.map((line) => [`${line.destino}\u0001${line.referencia}`, line.precio]));
  const bodegaOf = new Map(lines.map((line) => [line.destino, line.bodega]));
  const nitOf = new Map(lines.map((line) => [line.destino, line.nit]));

  const nits = Array.from(new Set(lines.map((line) => line.nit))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const fecha = ymd(header.fecha);
  const co = header.co.trim() || '999';
  const pedidos: Record<string, string | number | null>[] = [];
  const movto: Record<string, string | number>[] = [];
  let short = 0;

  nits.forEach((nit, index) => {
    const numDoc = index + 1;
    const nroPedido = header.nroPedido + index;
    const destinos = Array.from(nitOf.entries()).filter(([, value]) => value === nit).map(([key]) => key);
    let registro = 1;
    let units = 0;
    destinos.forEach((destino) => {
      const refs = allocation[destino] || {};
      Object.entries(refs).forEach(([ref, detail]) => {
        short += Math.max(0, detail.requested - detail.allocated);
        detail.items.forEach((item) => {
          if (item.quantity <= 0) return;
          units += item.quantity;
          movto.push({
            CO: Number(co) || co,
            NRO_DOCTO: numDoc,
            NRO_REGISTRO: registro,
            REF: ref,
            EXT: sizeToExte(item.talla),
            BODEGA: bodegaOf.get(destino) || header.bodegaDefault,
            CO_MVTO: Number(co) || co,
            FECHA_ENTREGA: Number(fecha),
            NRO_DIAS: header.dias,
            LISTA_PRECIO: header.listaPrecio.trim() || 'VME',
            CANT: item.quantity,
            PRECIO_UNI: priceOf.get(`${destino}\u0001${ref}`) || 0,
          });
          registro += 1;
        });
      });
    });
    if (units <= 0) return;
    const tercero = /^\d+$/.test(nit) ? Number(nit) : nit;
    pedidos.push({
      CO: Number(co) || co,
      NUMDOC: numDoc,
      FECHA_PEDIDO: Number(fecha),
      TERCERO: tercero,
      SUCURSAL: header.sucursal.trim() || '001',
      TERCERO_DESP: tercero,
      SUCURSAL_DESP: header.sucursal.trim() || '001',
      TIPO_CLIENTE: header.tipoCliente.trim() || '0002',
      CO_FACT: Number(co) || co,
      FECHA_ENT: Number(fecha),
      'NRO:DIAS_ENTREGA': header.dias,
      NRO_PEDIDO: nroPedido,
      COND_PAGO: header.condPago.trim() || 'M30',
      NOTAS: null,
      PTO_ENVIO: '000',
      VENDEDOR_PEDIDO: Number(header.vendedor) || header.vendedor,
    });
  });

  if (pedidos.length === 0) throw new Error('El reparto no asignó unidades. Revise las cantidades y las tallas leídas.');
  return { pedidos, movto, short };
};

export const downloadCommercialWorkbook = (
  pedidos: Record<string, string | number | null>[],
  movto: Record<string, string | number>[]
) => {
  const book = XLSX.utils.book_new();
  const pedidosSheet = XLSX.utils.json_to_sheet(pedidos);
  const movtoSheet = XLSX.utils.json_to_sheet(movto);
  XLSX.utils.book_append_sheet(book, pedidosSheet, 'Pedidos ');
  XLSX.utils.book_append_sheet(book, movtoSheet, 'Movto Pedidos comercial');
  XLSX.writeFile(book, 'Pedidos_comercial.xlsx');
};

export const downloadCommercialTemplate = () => {
  const rows = [
    { REFERENCIA: '441920BEI', NIT: '805027987', CANT: 90, PRECIO: 63070, BODEGA: 'BDIS2' },
    { REFERENCIA: '441920BEI', NIT: '900123456', CANT: '', PRECIO: 63070, BODEGA: 'BODVI' },
  ];
  const sheet = XLSX.utils.json_to_sheet(rows, { header: ['REFERENCIA', 'NIT', 'CANT', 'PRECIO', 'BODEGA'] });
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Cantidades');
  XLSX.writeFile(book, 'Plantilla_Pedido_Comercial.xlsx');
};

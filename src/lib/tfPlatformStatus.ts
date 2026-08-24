import type { TfPlatformEstado, TfPlatformStatusRecord } from '@/types';

export type AnalyzerRowInput = Record<string, any>;

const normalizeDocId = (val: any): string => {
  const digitsOnly = String(val || '').replace(/\D/g, '');
  return digitsOnly ? String(Number(digitsOnly)) : '';
};

const normalizeWarehouse = (val: any): string => String(val || '').trim().toUpperCase();

export const buildTfPlatformDocId = (numeroTF: string, bodegaDestino: string): string => {
  const tf = normalizeDocId(numeroTF);
  const whs = normalizeWarehouse(bodegaDestino).replace(/[^A-Z0-9]/g, '_');
  return `${tf}_${whs}`;
};

const statusPriority = (status: string): number => {
  switch (status) {
    case 'ENTREGADO':
      return 40;
    case 'EN RUTA HOY':
      return 30;
    case 'EN BODEGA':
      return 20;
    case 'VALIDAR CON AMBAS TIENDAS':
      return 10;
    default:
      return status ? 5 : 0;
  }
};

const extractEvidenceLinks = (row: AnalyzerRowInput, imageField?: string): string[] => {
  const raw = String(row[imageField || ''] || row['image'] || row['LINK IMAGENES.1.1.1'] || '').trim();
  if (!raw) return [];
  return raw
    .split('|')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('http'));
};

const classifyRow = (
  row: AnalyzerRowInput,
  fields: {
    doc: string;
    warehouse: string;
    estadoPlataforma?: string;
    hoyRuta?: string;
    fechaFinalizado?: string;
    image?: string;
  },
  routeStatusMap: Map<string, string>,
  receivedInWarehouseKeys: Set<string> = new Set()
): TfPlatformEstado => {
  const platVal = String(row[fields.estadoPlataforma || 'estadoPlataforma'] || row['estadoPlataforma'] || '')
    .trim()
    .toUpperCase();
  const hoyVal = String(row[fields.hoyRuta || 'hoyRuta'] || row['hoyRuta'] || '')
    .trim()
    .toUpperCase();
  const bodegaVal = String(row['estadoBodega'] || '').trim().toUpperCase();
  const hasImage = extractEvidenceLinks(row, fields.image).length > 0;
  const hasFechaFin = Boolean(row[fields.fechaFinalizado || 'fechaFinalizado'] || row['fechaFinalizado']);

  const tf = normalizeDocId(row[fields.doc]);
  const whs = normalizeWarehouse(row[fields.warehouse]);
  const routeKey = tf && whs ? `${tf}|${whs}` : '';
  const routeStatus = routeKey ? routeStatusMap.get(routeKey) : undefined;
  const receivedInWarehouse = routeKey ? receivedInWarehouseKeys.has(routeKey) : false;

  if (platVal === 'ENTREGADO' || platVal === 'FINALIZADO' || hasImage || hasFechaFin) {
    return 'ENTREGADO';
  }
  if (
    hoyVal === 'EN RUTA HOY' ||
    hoyVal === 'TRUE' ||
    platVal === 'EN RUTA HOY' ||
    routeStatus === 'EN RUTA HOY' ||
    routeStatus === 'ESTA EN RUTA' ||
    routeStatus === 'EN CARGUE'
  ) {
    return 'EN RUTA HOY';
  }
  if (
    bodegaVal === 'EN BODEGA' ||
    platVal === 'EN BODEGA' ||
    routeStatus === 'ESTA EN BODEGA PPAL' ||
    receivedInWarehouse
  ) {
    return 'EN BODEGA';
  }
  return 'VALIDAR CON AMBAS TIENDAS';
};

/**
 * Unifica filas del analizador a 1 registro por TF+destino con estado plataforma final.
 */
export function buildTfPlatformStatusRecords(
  rows: AnalyzerRowInput[],
  columnMap: {
    doc?: string;
    warehouse?: string;
    qty?: string;
    fecha?: string;
    marca?: string;
    grupo?: string;
    estadoPlataforma?: string;
    hoyRuta?: string;
    fechaFinalizado?: string;
    image?: string;
  },
  routeStatusMap: Map<string, string> = new Map(),
  updatedBy?: string,
  receivedInWarehouseKeys: Set<string> | string[] = new Set()
): Omit<TfPlatformStatusRecord, 'updatedAt'>[] {
  if (!columnMap.doc || !columnMap.warehouse) return [];

  const receivedSet =
    receivedInWarehouseKeys instanceof Set
      ? receivedInWarehouseKeys
      : new Set(receivedInWarehouseKeys || []);

  const map = new Map<string, Omit<TfPlatformStatusRecord, 'updatedAt'> & { _priority: number }>();

  rows.forEach((row) => {
    const numeroTF = normalizeDocId(row[columnMap.doc!]);
    const bodegaDestino = normalizeWarehouse(row[columnMap.warehouse!]);
    if (!numeroTF || !bodegaDestino) return;

    const id = buildTfPlatformDocId(numeroTF, bodegaDestino);
    const qty = Number(row[columnMap.qty || ''] || row['CANTIDAD'] || row['Cantidad'] || 0) || 0;
    const estado = classifyRow(
      row,
      {
        doc: columnMap.doc!,
        warehouse: columnMap.warehouse!,
        estadoPlataforma: columnMap.estadoPlataforma,
        hoyRuta: columnMap.hoyRuta,
        fechaFinalizado: columnMap.fechaFinalizado,
        image: columnMap.image,
      },
      routeStatusMap,
      receivedSet
    );
    const links = extractEvidenceLinks(row, columnMap.image);
    const marca = columnMap.marca ? String(row[columnMap.marca] || '').trim() : '';
    const grupo = columnMap.grupo ? String(row[columnMap.grupo] || '').trim() : '';
    const fechaDocumento = columnMap.fecha ? row[columnMap.fecha] : row['Fecha'] || null;
    const fechaFinalizado =
      row[columnMap.fechaFinalizado || 'fechaFinalizado'] || row['fechaFinalizado'] || null;

    const existing = map.get(id);
    if (!existing) {
      map.set(id, {
        id,
        numeroTF,
        bodegaDestino,
        estadoPlataforma: estado,
        evidenceLinks: links,
        fechaDocumento: fechaDocumento instanceof Date ? fechaDocumento : fechaDocumento || null,
        fechaFinalizado: fechaFinalizado instanceof Date ? fechaFinalizado : fechaFinalizado || null,
        cantidad: qty,
        marca: marca || undefined,
        grupo: grupo || undefined,
        updatedBy,
        source: 'analizador_4_pasos',
        _priority: statusPriority(estado),
      });
      return;
    }

    existing.cantidad += qty;
    if (marca) {
      const parts = (existing.marca || '').split(',').map((p) => p.trim()).filter(Boolean);
      if (!parts.includes(marca)) existing.marca = parts.length ? `${parts.join(', ')}, ${marca}` : marca;
    }
    if (grupo) {
      const parts = (existing.grupo || '').split(',').map((p) => p.trim()).filter(Boolean);
      if (!parts.includes(grupo)) existing.grupo = parts.length ? `${parts.join(', ')}, ${grupo}` : grupo;
    }
    links.forEach((l) => {
      if (!existing.evidenceLinks.includes(l)) existing.evidenceLinks.push(l);
    });

    const prio = statusPriority(estado);
    if (prio > existing._priority) {
      existing.estadoPlataforma = estado;
      existing._priority = prio;
      if (fechaFinalizado) {
        existing.fechaFinalizado =
          fechaFinalizado instanceof Date ? fechaFinalizado : (fechaFinalizado as any);
      }
    }
  });

  return Array.from(map.values()).map(({ _priority, ...rest }) => rest);
}

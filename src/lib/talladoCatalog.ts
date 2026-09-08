import * as XLSX from 'xlsx';
import { findCaseInsensitiveKey } from '@/lib/parsingUtils';
import type { TalladoCatalogImportRow } from '@/types';

export const TALLADO_DEFAULT_DESTINO = 'MERCANCIA SIN REMISIONAR';

export const TALLADO_CATALOG_TEMPLATE_HEADERS = [
  'Codigo Barras',
  'Referencia',
  'Talla',
  'Cantidad',
] as const;

function normalizeBarcodeCell(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\u2018\u2019\u201A\uFF07`´′ʼ']/g, '-')
    .replace(/[,;]/g, '-')
    .replace(/\s+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Parsea hoja Excel/CSV del catálogo Tallado (caja sin remisión). */
export function parseTalladoCatalogSheet(workbook: XLSX.WorkBook): {
  rows: TalladoCatalogImportRow[];
  skipped: number;
  errors: string[];
} {
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { rows: [], skipped: 0, errors: ['El archivo no tiene hojas.'] };
  const sheet = workbook.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  const rows: TalladoCatalogImportRow[] = [];
  const errors: string[] = [];
  let skipped = 0;

  json.forEach((row, idx) => {
    const line = idx + 2;
    const barcodeKey = findCaseInsensitiveKey(
      row,
      'codigo barras',
      'código barras',
      'codigo de barras',
      'código de barras',
      'codigobarras',
      'barcode',
      'ean',
      'upc',
      'codigo',
      'código'
    );
    const refKey = findCaseInsensitiveKey(row, 'referencia', 'ref', 'sku', 'estilo', 'modelo');
    const tallaKey = findCaseInsensitiveKey(row, 'talla', 'size', 'talle');
    const qtyKey = findCaseInsensitiveKey(row, 'cantidad', 'cant', 'qty', 'unidades', 'uds');

    const codigoBarras = normalizeBarcodeCell(barcodeKey ? row[barcodeKey] : '');
    const referencia = String(refKey ? row[refKey] : '')
      .trim()
      .toUpperCase();
    const talla = String(tallaKey ? row[tallaKey] : '')
      .trim()
      .toUpperCase();
    const cantidad = Number(qtyKey ? row[qtyKey] : 0);

    if (!codigoBarras && !referencia && !talla && !cantidad) {
      skipped += 1;
      return;
    }
    if (!codigoBarras) {
      errors.push(`Fila ${line}: falta Código Barras.`);
      skipped += 1;
      return;
    }
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      errors.push(`Fila ${line} (${codigoBarras}): cantidad inválida.`);
      skipped += 1;
      return;
    }

    rows.push({
      codigoBarras,
      referencia: referencia || codigoBarras,
      talla: talla || '—',
      cantidad: Math.round(cantidad),
    });
  });

  // Si el mismo código aparece varias veces, sumar cantidades y conservar última ref/talla
  const byCode = new Map<string, TalladoCatalogImportRow>();
  for (const r of rows) {
    const prev = byCode.get(r.codigoBarras);
    if (!prev) {
      byCode.set(r.codigoBarras, { ...r });
    } else {
      byCode.set(r.codigoBarras, {
        codigoBarras: r.codigoBarras,
        referencia: r.referencia || prev.referencia,
        talla: r.talla || prev.talla,
        cantidad: prev.cantidad + r.cantidad,
      });
    }
  }

  return { rows: Array.from(byCode.values()), skipped, errors: errors.slice(0, 30) };
}

export function downloadTalladoCatalogTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    [...TALLADO_CATALOG_TEMPLATE_HEADERS],
    ['210-4578-01', 'REF12345', '39', 12],
    ['210-4578-02', 'REF12345', '40', 12],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'CatalogoTallado');
  XLSX.writeFile(wb, 'plantilla_tallado_catalogo_caja.xlsx');
}

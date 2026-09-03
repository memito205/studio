import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import JSZip from 'jszip';
import { format } from 'date-fns';
import type { MerchandiseItem, VerificationItem } from '@/types';

export type StoreSummarySourceRow = {
  destino: string;
  tft: string;
  cantTft: number;
  marca?: string;
};

type UniqueTf = {
  tft: string;
  cantTft: number;
  marca: string;
};

type StoreSummary = {
  destino: string;
  documents: UniqueTf[];
  totalDocs: number;
  totalCantTft: number;
  byBrand: Array<{ marca: string; cantTft: number; tfCount: number }>;
};

const normalizeDest = (value: string | undefined | null): string =>
  String(value || 'SIN DESTINO').trim().toUpperCase() || 'SIN DESTINO';

const normalizeTf = (value: string | undefined | null): string => {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw || raw === '-' || raw === 'NO ENCONTRADO' || raw === 'N/A') return '';
  return raw;
};

const normalizeMarca = (value: string | undefined | null): string => {
  const raw = String(value || '').trim().toUpperCase();
  return raw || 'SIN MARCA';
};

const parseCant = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value);
  const n = Number(String(value ?? '').replace(',', '.').trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const sanitizeFilePart = (value: string): string =>
  value
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 60) || 'SIN_DESTINO';

/** Agrupa por destino → TFs únicas (máx. Cant TFT) y resumen por marca. */
export function buildStoreSummaries(rows: StoreSummarySourceRow[]): StoreSummary[] {
  const byDest = new Map<string, Map<string, UniqueTf>>();

  rows.forEach((row) => {
    const tft = normalizeTf(row.tft);
    if (!tft) return;
    const destino = normalizeDest(row.destino);
    const cantTft = parseCant(row.cantTft);
    const marca = normalizeMarca(row.marca);

    if (!byDest.has(destino)) byDest.set(destino, new Map());
    const tfMap = byDest.get(destino)!;
    const existing = tfMap.get(tft);
    if (!existing) {
      tfMap.set(tft, { tft, cantTft, marca });
      return;
    }
    if (cantTft > existing.cantTft) existing.cantTft = cantTft;
    if (existing.marca === 'SIN MARCA' && marca !== 'SIN MARCA') existing.marca = marca;
  });

  return Array.from(byDest.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([destino, tfMap]) => {
      const documents = Array.from(tfMap.values()).sort((a, b) =>
        a.tft.localeCompare(b.tft, undefined, { numeric: true, sensitivity: 'base' })
      );
      const brandMap = new Map<string, { cantTft: number; tfCount: number }>();
      documents.forEach((doc) => {
        const cur = brandMap.get(doc.marca) || { cantTft: 0, tfCount: 0 };
        cur.cantTft += doc.cantTft;
        cur.tfCount += 1;
        brandMap.set(doc.marca, cur);
      });
      const byBrand = Array.from(brandMap.entries())
        .map(([marca, stats]) => ({ marca, ...stats }))
        .sort((a, b) => b.cantTft - a.cantTft || a.marca.localeCompare(b.marca));

      return {
        destino,
        documents,
        totalDocs: documents.length,
        totalCantTft: documents.reduce((sum, d) => sum + d.cantTft, 0),
        byBrand,
      };
    })
    .filter((s) => s.totalDocs > 0);
}

function createStorePdf(
  summary: StoreSummary,
  meta?: { sessionName?: string; generatedAt?: Date }
): jsPDF {
  const doc = new jsPDF();
  const generatedAt = meta?.generatedAt || new Date();
  let y = 18;

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(`Resumen de despacho — ${summary.destino}`, 14, y);
  y += 8;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  if (meta?.sessionName) {
    doc.text(`Sesión: ${meta.sessionName}`, 14, y);
    y += 5;
  }
  doc.text(`Generado: ${format(generatedAt, 'dd/MM/yyyy HH:mm')}`, 14, y);
  y += 8;

  doc.setFont('helvetica', 'bold');
  doc.text(`Documentos (TFs únicas): ${summary.totalDocs}`, 14, y);
  y += 5;
  doc.text(`Total cantidad TFT: ${summary.totalCantTft}`, 14, y);
  y += 8;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Números de TF', 14, y);
  y += 2;

  autoTable(doc, {
    startY: y,
    head: [['# TF', 'Cant. TFT', 'Marca']],
    body: summary.documents.map((d) => [d.tft, String(d.cantTft), d.marca]),
    theme: 'grid',
    headStyles: { fillColor: [30, 30, 30], fontSize: 9 },
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: {
      0: { cellWidth: 45 },
      1: { cellWidth: 28, halign: 'right' },
    },
  });

  const afterTfTable =
    (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 10;
  let y2 = afterTfTable + 10;

  if (y2 > 260) {
    doc.addPage();
    y2 = 20;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Resumen por marca', 14, y2);
  y2 += 2;

  autoTable(doc, {
    startY: y2,
    head: [['Marca', 'Cant. TFT', '# TFs']],
    body: summary.byBrand.map((b) => [b.marca, String(b.cantTft), String(b.tfCount)]),
    theme: 'grid',
    headStyles: { fillColor: [30, 30, 30], fontSize: 9 },
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: {
      1: { halign: 'right' },
      2: { halign: 'right' },
    },
    foot: [['TOTAL', String(summary.totalCantTft), String(summary.totalDocs)]],
    footStyles: { fillColor: [240, 240, 240], fontStyle: 'bold', textColor: [0, 0, 0] },
  });

  return doc;
}

export function merchandiseItemsToSummaryRows(items: MerchandiseItem[]): StoreSummarySourceRow[] {
  return items.map((item) => ({
    destino: item.destino,
    tft: item.tftMatch || item.tf || '',
    cantTft: item.tftCantidad ?? 0,
    marca: item.marca,
  }));
}

export function verificationItemsToSummaryRows(items: VerificationItem[]): StoreSummarySourceRow[] {
  return items.map((item) => ({
    destino: item.destino,
    tft: item.tftCruce,
    cantTft: parseCant(item.cantTft),
    marca: item.marca,
  }));
}

/**
 * Genera un PDF por tienda. Si hay más de una, descarga un ZIP con todos.
 * Si hay una sola, descarga el PDF directo.
 */
export async function downloadStoreSummaryPdfs(
  rows: StoreSummarySourceRow[],
  options?: { sessionName?: string }
): Promise<{ success: boolean; storeCount: number; fileName?: string; error?: string }> {
  try {
    const summaries = buildStoreSummaries(rows);
    if (summaries.length === 0) {
      return { success: false, storeCount: 0, error: 'No hay TFs válidas para generar el resumen.' };
    }

    const stamp = format(new Date(), 'yyyyMMdd_HHmm');
    const sessionSlug = options?.sessionName
      ? sanitizeFilePart(options.sessionName)
      : 'despacho';
    const meta = { sessionName: options?.sessionName, generatedAt: new Date() };

    if (summaries.length === 1) {
      const only = summaries[0];
      const pdf = createStorePdf(only, meta);
      const fileName = `Resumen_${sanitizeFilePart(only.destino)}_${stamp}.pdf`;
      pdf.save(fileName);
      return { success: true, storeCount: 1, fileName };
    }

    const zip = new JSZip();
    summaries.forEach((summary) => {
      const pdf = createStorePdf(summary, meta);
      const blob = pdf.output('blob');
      zip.file(`Resumen_${sanitizeFilePart(summary.destino)}.pdf`, blob);
    });

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const fileName = `Resumen_Tiendas_${sessionSlug}_${stamp}.zip`;
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    return { success: true, storeCount: summaries.length, fileName };
  } catch (error: any) {
    console.error('Error generating store summary PDFs:', error);
    return {
      success: false,
      storeCount: 0,
      error: error?.message || 'No se pudieron generar los PDF por tienda.',
    };
  }
}

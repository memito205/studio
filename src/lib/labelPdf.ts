import jsPDF from 'jspdf';
import JsBarcode from 'jsbarcode';
import { format } from 'date-fns';
import { weekdayShortEs } from '@/lib/warehouseLocations';
import { firstWarehouseArrival } from '@/lib/transferDates';

/** Papel de rótulo: 10 cm de ancho x 5 cm de alto. Todo en milímetros. */
const PAGE_W = 100;
const PAGE_H = 50;
const MARGIN = 2;
const DAY_BLOCK_W = 22;
const CONTENT_X = MARGIN + DAY_BLOCK_W + 3;
const CONTENT_W = PAGE_W - CONTENT_X - MARGIN - 1;

export type TransferLabelData = {
  numeroTF: string;
  bodegaDestino: string;
  cantidad?: number | string;
  ubicacion?: string;
  storageOrder?: string | number;
  codigoAlterno?: string;
  fecha?: unknown;
  recibidoAt?: unknown;
  status?: string;
  statusHistory?: unknown;
};

export type TransferLabelOptions = {
  hideBarcode?: boolean;
  /** La TF se está recibiendo en este momento: si nunca había llegado, el día es hoy. */
  receivingNow?: boolean;
};

/** Día del bloque negro: fecha de la TF (no cambia al recibir ni reimprimir); sin ella, primera llegada a bodega. */
export function labelDayDate(t: TransferLabelData, receivingNow = false): Date | null {
  return toDate(t.fecha) || firstWarehouseArrival(t) || (receivingNow ? new Date() : null);
}

export type AltCodeStickerData = {
  codigoAlterno: string;
  ubicacion?: string;
  status?: string;
  linkedNumeroTF?: string;
  linkedDestino?: string;
  packerName?: string;
  registeredByName?: string;
  registeredAt: string | Date;
  /** Si existe (registro tardío / carga inicial), el bloque del día usa esta fecha y no la del registro. */
  llegadaAt?: string | Date;
};

const toDate = (v: unknown): Date | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : typeof (v as any)?.toDate === 'function' ? (v as any).toDate() : new Date(v as any);
  return Number.isNaN(d.getTime()) ? null : d;
};

const newLabelDoc = () => new jsPDF({ orientation: 'landscape', unit: 'mm', format: [PAGE_W, PAGE_H] });

/** Tamaño de letra (pt) más grande que cabe en el ancho indicado. */
function fitFont(doc: jsPDF, text: string, maxWidth: number, maxPt: number, minPt = 6): number {
  for (let pt = maxPt; pt > minPt; pt -= 0.5) {
    doc.setFontSize(pt);
    if (doc.getTextWidth(text) <= maxWidth) return pt;
  }
  doc.setFontSize(minPt);
  return minPt;
}

function drawFitted(doc: jsPDF, text: string, x: number, baselineY: number, maxWidth: number, maxPt: number, minPt = 6) {
  fitFont(doc, text, maxWidth, maxPt, minPt);
  doc.text(text, x, baselineY);
}

function drawDayBlock(doc: jsPDF, date: Date | null) {
  doc.setFillColor(0, 0, 0);
  doc.roundedRect(MARGIN, MARGIN, DAY_BLOCK_W, PAGE_H - MARGIN * 2, 2, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  const cx = MARGIN + DAY_BLOCK_W / 2;
  const day = date ? weekdayShortEs(date) : '--';
  const dm = date ? format(date, 'dd/MM') : '--/--';
  fitFont(doc, day, DAY_BLOCK_W - 3, 24);
  doc.text(day, cx, PAGE_H / 2 - 1, { align: 'center' });
  fitFont(doc, dm, DAY_BLOCK_W - 3, 18);
  doc.text(dm, cx, PAGE_H / 2 + 8, { align: 'center' });
  doc.setTextColor(0, 0, 0);
}

function drawLocationBox(doc: jsPDF, ubicacion: string, top: number, height = 7) {
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.6);
  doc.roundedRect(CONTENT_X, top, CONTENT_W, height, 1, 1, 'S');
  doc.setFont('helvetica', 'bold');
  drawFitted(doc, `UBIC: ${ubicacion}`, CONTENT_X + 1.5, top + height - 1.9, CONTENT_W - 3, 14);
}

function drawBarcode(doc: jsPDF, value: string, top: number, height: number) {
  const canvas = document.createElement('canvas');
  JsBarcode(canvas, value, { format: 'CODE128', displayValue: false, margin: 0, height: 100, width: 3 });
  doc.addImage(canvas.toDataURL('image/png'), 'PNG', CONTENT_X, top, CONTENT_W, height);
}

export function addTransferLabelPage(doc: jsPDF, t: TransferLabelData, opts: TransferLabelOptions = {}) {
  const arrival = labelDayDate(t, opts.receivingNow);
  const tfDate = toDate(t.fecha);
  const right = CONTENT_X + CONTENT_W;
  drawDayBlock(doc, arrival);

  const alt = String(t.codigoAlterno || '').trim();
  const dy = alt ? 1 : 0;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.text('TRANSFERENCIA INTERNA', CONTENT_X, 5.5);
  const headerW = doc.getTextWidth('TRANSFERENCIA INTERNA');
  if (tfDate) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    const label = `TF del ${format(tfDate, 'dd/MM/yyyy')}`;
    if (alt) doc.text(label, CONTENT_X + headerW + 2, 5.5);
    else doc.text(label, CONTENT_X, 8.8);
  }
  if (alt) {
    doc.setFont('helvetica', 'bold');
    drawFitted(doc, `ALT ${alt}`, CONTENT_X, 10.8, CONTENT_W, 11);
  }
  if (t.storageOrder) {
    const label = `ORDEN ${t.storageOrder}`;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    const w = doc.getTextWidth(label) + 3;
    doc.setFillColor(0, 0, 0);
    doc.roundedRect(right - w, 2.8, w, 4.6, 0.6, 0.6, 'F');
    doc.setTextColor(255, 255, 255);
    doc.text(label, right - w / 2, 6.1, { align: 'center' });
    doc.setTextColor(0, 0, 0);
  }

  doc.setFont('helvetica', 'bold');
  drawFitted(doc, `TF ${t.numeroTF}`, CONTENT_X, 18.5 + dy, CONTENT_W, alt ? 26 : 28);

  const unid = `UNID ${t.cantidad || 1}`;
  doc.setFontSize(11);
  const unidW = doc.getTextWidth(unid);
  doc.text(unid, right, 25.5 + dy, { align: 'right' });
  drawFitted(doc, `DESTINO ${String(t.bodegaDestino || '').trim()}`, CONTENT_X, 25.5 + dy, CONTENT_W - unidW - 3, 14);

  const hasUbic = !!String(t.ubicacion || '').trim();
  if (hasUbic) drawLocationBox(doc, String(t.ubicacion).trim(), 28 + dy);

  if (!opts.hideBarcode) {
    const value = `${t.bodegaDestino}-${t.numeroTF}`.toUpperCase();
    const top = (hasUbic ? 36.5 : 29.5) + dy;
    drawBarcode(doc, value, top, PAGE_H - top - 5.5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.text(value, CONTENT_X + CONTENT_W / 2, PAGE_H - 2.3, { align: 'center' });
  }
}

export function buildTransferLabelsPdf(transfers: TransferLabelData[], opts: TransferLabelOptions = {}): jsPDF {
  const doc = newLabelDoc();
  transfers.forEach((t, i) => {
    if (i > 0) doc.addPage([PAGE_W, PAGE_H], 'landscape');
    addTransferLabelPage(doc, t, opts);
  });
  return doc;
}

export function buildAltCodeStickersPdf(list: AltCodeStickerData[]): jsPDF {
  const doc = newLabelDoc();
  list.forEach((r, i) => {
    if (i > 0) doc.addPage([PAGE_W, PAGE_H], 'landscape');
    drawAltCodeSticker(doc, r);
  });
  return doc;
}

export function buildAltCodeStickerPdf(r: AltCodeStickerData): jsPDF {
  const doc = newLabelDoc();
  drawAltCodeSticker(doc, r);
  return doc;
}

function drawAltCodeSticker(doc: jsPDF, r: AltCodeStickerData) {
  const registeredAt = toDate(r.registeredAt) || new Date();
  const linked = r.status === 'linked';
  const llegada = toDate(r.llegadaAt);
  drawDayBlock(doc, llegada || registeredAt);

  doc.setFont('helvetica', 'bold');
  drawFitted(
    doc,
    linked ? `CÓDIGO ALTERNO · TF ${r.linkedNumeroTF || ''}` : 'CÓDIGO ALTERNO - PENDIENTE TF',
    CONTENT_X,
    5.5,
    CONTENT_W,
    8
  );
  drawFitted(doc, `ALT ${r.codigoAlterno}`, CONTENT_X, 15.5, CONTENT_W, 26);

  let y = 17;
  if (linked && r.linkedDestino) {
    drawFitted(doc, `DESTINO ${r.linkedDestino}`, CONTENT_X, 22, CONTENT_W, 12);
    y = 23;
  }
  if (r.ubicacion) {
    drawLocationBox(doc, r.ubicacion, y + 1.5);
    y += 9.5;
  }

  const top = y + 2;
  drawBarcode(doc, r.codigoAlterno, top, PAGE_H - top - 6);
  doc.setFont('helvetica', 'normal');
  drawFitted(
    doc,
    `Registro: ${r.packerName || r.registeredByName || '—'} - ${format(registeredAt, llegada ? 'dd/MM h:mm a' : 'h:mm a')}`,
    CONTENT_X,
    PAGE_H - 2.3,
    CONTENT_W,
    7
  );
}

export function openPdfForPrint(doc: jsPDF) {
  doc.autoPrint();
  window.open(doc.output('bloburl'), '_blank');
}

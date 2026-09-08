import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { StoreCapacityProfile, StoreFootwearCapacityBreakdown } from '@/types';
import { formatCapacityPctLabel } from '@/lib/storeCapacity';

export type StoreCapacityPdfRow = {
  profile: StoreCapacityProfile;
  breakdown: StoreFootwearCapacityBreakdown;
};

function fmtNum(n: number | undefined | null, digits = 0) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('es-CO', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits > 0 ? Math.min(digits, 1) : 0,
  });
}

function statusLabel(b: StoreFootwearCapacityBreakdown): string {
  if (b.hoyExceedsWithoutBox) return 'NO CABE HOY';
  if (b.hoyExceedsWithBox) return 'REQUIERE S/CAJA';
  if (b.futuraExceedsWithoutBox) return 'RIESGO FUTURO';
  if (b.proximaExceedsWithBox) return 'TF → mezcla';
  return 'OK';
}

function statusExplain(b: StoreFootwearCapacityBreakdown): string {
  if (b.hoyExceedsWithoutBox) {
    return 'El calzado de hoy supera incluso la capacidad máxima física (sin caja). Hay que liberar espacio o no enviar más.';
  }
  if (b.hoyExceedsWithBox) {
    return 'Hoy no cabe manteniendo caja original; sí podría caber sacando pares de caja (s/caja).';
  }
  if (b.futuraExceedsWithoutBox) {
    return 'Con inbound TF + CEDI y restando el pronóstico de salidas, la tienda queda en riesgo aunque se use s/caja.';
  }
  if (b.proximaExceedsWithBox) {
    return 'Al sumar el inbound TF (Excel), la próxima carga puede exigir mezclar cajones con y sin caja.';
  }
  return 'La tienda tiene cupo razonable en los tres horizontes con la información actual.';
}

function ensureSpace(doc: jsPDF, y: number, need: number): number {
  const pageH = doc.internal.pageSize.getHeight();
  if (y + need > pageH - 40) {
    doc.addPage();
    return 40;
  }
  return y;
}

function writeWrapped(doc: jsPDF, text: string, x: number, y: number, maxW: number, lineH = 12): number {
  const lines = doc.splitTextToSize(text, maxW) as string[];
  doc.text(lines, x, y);
  return y + lines.length * lineH;
}

function writeGuide(doc: jsPDF, startY: number, garmentsPerDrawer: number, forecastHorizonDays: number): number {
  let y = startY;
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Cómo leer este reporte', 40, y);
  y += 16;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);

  const paragraphs = [
    'Este PDF resume la capacidad de cajones de calzado por tienda (PDV). Sirve para saber si una tienda puede recibir mercancía hoy, cuando llegue lo que ya va en camino (TF), o más adelante (CEDI + proyección).',
    'c/caja (con caja): capacidad conservadora, pares guardados con su caja original. Es la lectura “segura”.',
    's/caja (sin caja): capacidad máxima física si se puede sacar de caja. Solo se usa cuando c/caja no alcanza.',
    'Hoy: solo lo que ya está en almacén de la tienda (inventario − exhibición de outlet − comprometido a sacar).',
    'Próxima: Hoy + inbound TF del Excel (mercancía que se espera recibir próximamente). No usa cruces automáticos de transferencias.',
    `Futura: (Hoy − salidas esperadas en ${forecastHorizonDays} día(s)) + inbound TF + calzado en proceso en CEDI.`,
    `La ropa ocupa cajones (~${garmentsPerDrawer} prendas por cajón) y reduce el cupo efectivo de calzado. Los accesorios no afectan este cupo.`,
    'Si el % dice “+X% exceso”, significa que el inventario supera la capacidad: ese X es cuánto se pasa del 100% (ej. ocupación 200% → +100% exceso). Si dice un % sin “exceso”, es ocupación normal (0–100%).',
    'Estados: OK = cupo razonable · REQUIERE S/CAJA = hoy solo cabe sin caja · NO CABE HOY = ni s/caja alcanza · RIESGO FUTURO = problema al proyectar · TF → mezcla = el inbound TF aprieta el cupo con caja.',
  ];

  for (const p of paragraphs) {
    y = ensureSpace(doc, y, 36);
    y = writeWrapped(doc, `• ${p}`, 40, y, 720, 11);
    y += 4;
  }
  return y + 8;
}

function writeStoreDetail(
  doc: jsPDF,
  row: StoreCapacityPdfRow,
  garmentsPerDrawer: number,
  forecastHorizonDays: number,
  startY: number
): number {
  const { profile: p, breakdown: b } = row;
  let y = ensureSpace(doc, startY, 80);

  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(`${p.pdvCode}${p.pdvName ? ` — ${p.pdvName}` : ''}`, 40, y);
  y += 14;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(
    `Estado: ${statusLabel(b)}  ·  Tipo: ${p.exhibitionAffectsCapacity ? 'Outlet (resta exhibición)' : 'Tienda estándar'}  ·  Cajones: ${fmtNum(b.totalDrawers)}`,
    40,
    y
  );
  y += 12;
  y = writeWrapped(doc, statusExplain(b), 40, y, 720, 11);
  y += 6;

  autoTable(doc, {
    startY: y,
    head: [['Concepto', 'Cantidad', 'Qué significa']],
    body: [
      [
        'Calzado en almacén (neto)',
        fmtNum(b.calzadoOnHand),
        'Pares que ocupan cajones hoy (ya descontada exhibición/comprometido si aplica).',
      ],
      [
        'Inbound TF (Excel)',
        fmtNum(b.calzadoInTransit),
        'Calzado pendiente de recibir según archivo de TF inbound. Entra en Próxima y Futura.',
      ],
      [
        'CEDI en proceso',
        fmtNum(b.calzadoEnProceso),
        'Calzado que aún está en el CEDI camino a la tienda. Solo suma en Futura.',
      ],
      [
        `Pronóstico salidas (${forecastHorizonDays}d)`,
        b.forecastCalzadoOutflow > 0 ? `−${fmtNum(Math.round(b.forecastCalzadoOutflow))}` : 'Sin histórico',
        b.forecastSamples > 0
          ? `Estimado con ${b.forecastSamples} muestra(s) de baja de inventario. Libera cupo en Futura.`
          : 'Sin suficiente historial; Futura no descuenta salidas esperadas.',
      ],
      [
        'Ropa en almacén / inbound',
        `${fmtNum(b.ropaOnHand)} / ${fmtNum(b.ropaInTransit)}`,
        `La ropa usa cajones (~${garmentsPerDrawer} prendas/cajón) y reduce cupo de calzado.`,
      ],
      [
        'Cajones usados por ropa',
        fmtNum(b.drawersUsedByClothing),
        `De ${fmtNum(b.totalDrawers)} cajones, estos quedan ocupados por ropa; quedan ${fmtNum(b.drawersAvailableForFootwear)} para calzado.`,
      ],
      [
        'Cupo efectivo c/caja · s/caja',
        `${fmtNum(Math.round(b.effectiveCapacityWithBox))} · ${fmtNum(Math.round(b.effectiveCapacityWithoutBox))}`,
        'Pares de calzado que caben después de restar el espacio que toma la ropa.',
      ],
    ],
    styles: { fontSize: 8, cellPadding: 3, valign: 'top' },
    columnStyles: {
      0: { cellWidth: 140, fontStyle: 'bold' },
      1: { cellWidth: 90, halign: 'right' },
      2: { cellWidth: 490 },
    },
    headStyles: { fillColor: [15, 118, 110] },
    margin: { left: 40, right: 40 },
  });

  y = ((doc as any).lastAutoTable?.finalY || y) + 10;

  autoTable(doc, {
    startY: y,
    head: [
      [
        'Horizonte',
        'Ocupa (pares)',
        'Cupo c/caja',
        'Disp. c/caja',
        '% c/caja',
        'Cupo s/caja',
        'Disp. s/caja',
        '% s/caja',
      ],
    ],
    body: [
      [
        'Hoy (solo almacén)',
        fmtNum(Math.round(b.hoyOccupied)),
        fmtNum(Math.round(b.hoyEffectiveCapacityWithBox)),
        fmtNum(Math.round(b.hoyAvailableWithBox)),
        formatCapacityPctLabel(b.hoyOccupancyPctWithBox, b.hoyExceedsWithBox),
        fmtNum(Math.round(b.hoyEffectiveCapacityWithoutBox)),
        fmtNum(Math.round(b.hoyAvailableWithoutBox)),
        formatCapacityPctLabel(b.hoyOccupancyPctWithoutBox, b.hoyExceedsWithoutBox),
      ],
      [
        'Próxima (+ inbound TF)',
        fmtNum(Math.round(b.proximaOccupied)),
        fmtNum(Math.round(b.proximaEffectiveCapacityWithBox)),
        fmtNum(Math.round(b.proximaAvailableWithBox)),
        formatCapacityPctLabel(b.proximaOccupancyPctWithBox, b.proximaExceedsWithBox),
        fmtNum(Math.round(b.proximaEffectiveCapacityWithoutBox)),
        fmtNum(Math.round(b.proximaAvailableWithoutBox)),
        formatCapacityPctLabel(b.proximaOccupancyPctWithoutBox, b.proximaExceedsWithoutBox),
      ],
      [
        'Futura (+CEDI −salidas)',
        fmtNum(Math.round(b.futuraOccupied)),
        fmtNum(Math.round(b.futuraEffectiveCapacityWithBox)),
        fmtNum(Math.round(b.futuraAvailableWithBox)),
        formatCapacityPctLabel(b.futuraOccupancyPctWithBox, b.futuraExceedsWithBox),
        fmtNum(Math.round(b.futuraEffectiveCapacityWithoutBox)),
        fmtNum(Math.round(b.futuraAvailableWithoutBox)),
        formatCapacityPctLabel(b.futuraOccupancyPctWithoutBox, b.futuraExceedsWithoutBox),
      ],
    ],
    styles: { fontSize: 7.5, cellPadding: 2.5, halign: 'right' },
    columnStyles: { 0: { halign: 'left', fontStyle: 'bold', cellWidth: 120 } },
    headStyles: { fillColor: [30, 64, 175], halign: 'center' },
    margin: { left: 40, right: 40 },
  });

  y = ((doc as any).lastAutoTable?.finalY || y) + 10;
  y = ensureSpace(doc, y, 50);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('Sugerencia de mezcla de cajas (Hoy)', 40, y);
  y += 12;
  doc.setFont('helvetica', 'normal');
  y = writeWrapped(doc, b.hoyBoxMix?.summary || 'Sin sugerencia.', 40, y, 720, 11);
  y += 6;
  doc.setFont('helvetica', 'bold');
  doc.text('Sugerencia de mezcla de cajas (Futura)', 40, y);
  y += 12;
  doc.setFont('helvetica', 'normal');
  y = writeWrapped(doc, b.futuraBoxMix?.summary || 'Sin sugerencia.', 40, y, 720, 11);

  if (p.notes?.trim()) {
    y += 8;
    y = ensureSpace(doc, y, 30);
    doc.setFont('helvetica', 'bold');
    doc.text('Notas del maestro', 40, y);
    y += 12;
    doc.setFont('helvetica', 'normal');
    y = writeWrapped(doc, p.notes.trim(), 40, y, 720, 11);
  }

  // Cajones del maestro
  if ((p.drawers || []).length > 0) {
    y += 10;
    y = ensureSpace(doc, y, 40);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('Maestro de cajones', 40, y);
    y += 6;
    autoTable(doc, {
      startY: y,
      head: [['Medida', 'Cajones', 'Pares c/caja', 'Pares s/caja', 'Total c/caja', 'Total s/caja']],
      body: (p.drawers || []).map((d) => {
        const count = Number(d.drawerCount) || 0;
        const w = Number(d.capacityWithBox) || 0;
        const wo = Number(d.capacityWithoutBox) || 0;
        return [
          d.measure || '—',
          fmtNum(count),
          fmtNum(w),
          fmtNum(wo),
          fmtNum(count * w),
          fmtNum(count * wo),
        ];
      }),
      styles: { fontSize: 7.5, cellPadding: 2.5 },
      headStyles: { fillColor: [71, 85, 105] },
      margin: { left: 40, right: 40 },
    });
    y = ((doc as any).lastAutoTable?.finalY || y) + 8;
  }

  return y + 16;
}

/** PDF consolidado: guía + resumen de red + detalle por tienda. */
export function downloadStoreCapacityReportPdf(opts: {
  rows: StoreCapacityPdfRow[];
  garmentsPerDrawer: number;
  forecastHorizonDays: number;
  title?: string;
}) {
  const rows = opts.rows || [];
  const garmentsPerDrawer = opts.garmentsPerDrawer || 100;
  const forecastHorizonDays = opts.forecastHorizonDays || 7;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const generated = new Date().toLocaleString('es-CO', { hour12: false });

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(opts.title || 'Reporte Capacidad de tiendas', 40, 36);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(
    `Generado: ${generated}  ·  Tiendas: ${rows.length}  ·  Prendas/cajón: ${garmentsPerDrawer}  ·  Horizonte pronóstico: ${forecastHorizonDays} día(s)`,
    40,
    52
  );

  let y = writeGuide(doc, 68, garmentsPerDrawer, forecastHorizonDays);

  y = ensureSpace(doc, y, 30);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Resumen de la red (todas las tiendas del reporte)', 40, y);
  y += 8;

  autoTable(doc, {
    startY: y,
    head: [
      [
        'PDV',
        'Estado',
        'Almacén',
        'Inbound TF',
        'CEDI',
        'Pronóst.',
        'Hoy c/ · s/',
        'Próxima c/ · s/',
        'Futura c/ · s/',
      ],
    ],
    body:
      rows.length === 0
        ? [['—', 'Sin tiendas', '—', '—', '—', '—', '—', '—', '—']]
        : rows.map(({ profile: p, breakdown: b }) => [
            p.pdvCode,
            statusLabel(b),
            fmtNum(b.calzadoOnHand),
            fmtNum(b.calzadoInTransit),
            fmtNum(b.calzadoEnProceso),
            b.forecastCalzadoOutflow > 0 ? `−${fmtNum(Math.round(b.forecastCalzadoOutflow))}` : '—',
            `${formatCapacityPctLabel(b.hoyOccupancyPctWithBox, b.hoyExceedsWithBox)} · ${formatCapacityPctLabel(b.hoyOccupancyPctWithoutBox, b.hoyExceedsWithoutBox)}`,
            `${formatCapacityPctLabel(b.proximaOccupancyPctWithBox, b.proximaExceedsWithBox)} · ${formatCapacityPctLabel(b.proximaOccupancyPctWithoutBox, b.proximaExceedsWithoutBox)}`,
            `${formatCapacityPctLabel(b.futuraOccupancyPctWithBox, b.futuraExceedsWithBox)} · ${formatCapacityPctLabel(b.futuraOccupancyPctWithoutBox, b.futuraExceedsWithoutBox)}`,
          ]),
    styles: { fontSize: 7, cellPadding: 2.5 },
    headStyles: { fillColor: [30, 64, 175] },
    margin: { left: 40, right: 40 },
  });

  y = ((doc as any).lastAutoTable?.finalY || y) + 20;

  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  y = ensureSpace(doc, y, 24);
  doc.text('Detalle por tienda', 40, y);
  y += 14;

  for (const row of rows) {
    y = writeStoreDetail(doc, row, garmentsPerDrawer, forecastHorizonDays, y);
  }

  const day = new Date().toISOString().slice(0, 10);
  doc.save(`capacidad_tiendas_${day}.pdf`);
}

/** PDF de una sola tienda (incluye la misma guía breve). */
export function downloadStoreCapacityStorePdf(opts: {
  row: StoreCapacityPdfRow;
  garmentsPerDrawer: number;
  forecastHorizonDays: number;
}) {
  downloadStoreCapacityReportPdf({
    rows: [opts.row],
    garmentsPerDrawer: opts.garmentsPerDrawer,
    forecastHorizonDays: opts.forecastHorizonDays,
    title: `Capacidad tienda ${opts.row.profile.pdvCode}`,
  });
}

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { TalladoPause, TalladoShift, TalladoUnit } from '@/types';

const PAUSE_LABELS: Record<string, string> = {
  desayuno: 'Desayuno',
  almuerzo: 'Almuerzo',
  fin_jornada: 'Fin jornada',
  otros: 'Otros',
};

function fmtTime(iso?: string) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es-CO', { hour12: false });
  } catch {
    return iso;
  }
}

function fmtDuration(ms?: number) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m} min`;
  return `${h}h ${m}m`;
}

export function downloadTalladoReportPdf(opts: {
  shift: TalladoShift;
  units: TalladoUnit[];
  pauses: TalladoPause[];
}) {
  const { shift, units, pauses } = opts;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const done = units.filter((u) => u.status === 'done');
  const inProg = units.filter((u) => u.status === 'in_progress');
  const qtyDone = done.reduce((s, u) => s + (Number(u.cantidad) || 0), 0);
  const pauseMs = pauses.reduce((s, p) => {
    if (p.durationMs != null) return s + p.durationMs;
    if (p.status === 'open') return s + Math.max(0, Date.now() - new Date(p.pausedAt).getTime());
    return s;
  }, 0);
  const netMs = done.reduce((s, u) => s + (Number(u.durationNetMs ?? u.durationMs) || 0), 0);

  doc.setFontSize(16);
  doc.text('Reporte Tallado de mercancía', 40, 36);
  doc.setFontSize(10);
  doc.text(`Grupo: ${shift.grupo}  ·  Personas: ${shift.peopleCount}  ·  Operario: ${shift.userName}`, 40, 54);
  doc.text(
    `Inicio turno: ${fmtTime(shift.startedAt)}  ·  Unidades: ${done.length} cerradas / ${inProg.length} en proceso  ·  Cantidad: ${qtyDone}`,
    40,
    68
  );
  doc.text(`Tiempo neto unidades: ${fmtDuration(netMs)}  ·  Tiempo en pausas: ${fmtDuration(pauseMs)}`, 40, 82);

  autoTable(doc, {
    startY: 96,
    head: [['Código', 'TF', 'Destino', 'Marca', 'Cant.', 'Inicio', 'Fin', 'Bruto', 'Neto']],
    body: units.map((u) => [
      u.scanCode,
      u.numeroTF,
      u.bodegaDestino,
      u.marca,
      String(u.cantidad),
      fmtTime(u.startedAt),
      fmtTime(u.endedAt),
      fmtDuration(u.durationMs),
      fmtDuration(u.durationNetMs ?? u.durationMs),
    ]),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [30, 64, 175] },
  });

  const afterUnits = (doc as any).lastAutoTable?.finalY || 120;
  doc.setFontSize(11);
  doc.text('Pausas colectivas del grupo', 40, afterUnits + 22);
  autoTable(doc, {
    startY: afterUnits + 30,
    head: [['Tipo', 'Motivo', 'Inicio', 'Fin', 'Duración']],
    body:
      pauses.length === 0
        ? [['—', 'Sin pausas', '—', '—', '—']]
        : pauses.map((p) => [
            PAUSE_LABELS[p.type] || p.type,
            p.note || '—',
            fmtTime(p.pausedAt),
            fmtTime(p.resumedAt),
            fmtDuration(
              p.durationMs ??
                (p.status === 'open' ? Date.now() - new Date(p.pausedAt).getTime() : undefined)
            ),
          ]),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [180, 83, 9] },
  });

  const safeGrupo = shift.grupo.replace(/[^\w\-]+/g, '_');
  doc.save(`tallado_${safeGrupo}_${shift.startedAt.slice(0, 10)}.pdf`);
}

'use server';

import { format } from 'date-fns';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { firestore } from '@/services/firebase';
import type {
  BodegaTvEntregaSummary,
  BodegaTvPendingGoodRow,
  BodegaTvProcessRow,
  BodegaTvProcessSummary,
} from '@/lib/bodegaTvTypes';

const COLLECTION = 'bodega_process_summaries';
const LATEST_DOC = 'latest';
const SOURCE = 'plataforma_logistica';

export type PublishWarehouseProcessInput = {
  publishedBy: string;
  processes: Array<{
    id: string;
    observation: string;
    totalQuantity: number;
    totalPacked: number;
    packedPercentage: number;
    fechaEntrega?: string;
    procesoObservacion?: string;
    isVXM?: boolean;
    conteoPorcentaje?: number;
    etiquetadoPorcentaje?: number;
    revisionCalidadPorcentaje?: number;
    remisionPorcentaje?: number;
  }>;
  pendingGoods?: Array<{
    id: string;
    marca: string;
    cantidadEntrada: number;
    fechaEntradaAprox: string;
  }>;
  entregas?: Array<{
    vehiculo: string;
    items: Array<{ ubicacion: string; marca: string; cantidad: number }>;
  }>;
};

function todayKeyLocal(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

function stripUndefinedDeep(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)).filter((item) => item !== undefined);
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined) continue;
    const cleaned = stripUndefinedDeep(v);
    if (cleaned !== undefined) out[k] = cleaned;
  }
  return out;
}

function buildProcessRows(
  processes: PublishWarehouseProcessInput['processes'],
  dayKey: string
): BodegaTvProcessRow[] {
  return (processes || []).map((p) => {
    const isVXM = Boolean(p.isVXM);
    const packedPercentage = Number(p.packedPercentage) || 0;
    const fechaEntrega = String(p.fechaEntrega || '').trim() || undefined;
    const isOverdue = Boolean(
      fechaEntrega && fechaEntrega <= dayKey && packedPercentage < 100
    );
    const stages = isVXM
      ? [
          { label: 'Calidad', pct: Number(p.revisionCalidadPorcentaje) || 0 },
          { label: 'Remisión', pct: Number(p.remisionPorcentaje) || 0 },
        ]
      : [
          { label: 'Conteo', pct: Number(p.conteoPorcentaje) || 0 },
          { label: 'Etiquetado', pct: Number(p.etiquetadoPorcentaje) || 0 },
        ];
    const note = String(p.procesoObservacion || '').trim() || undefined;
    return {
      id: String(p.id || ''),
      name: String(p.observation || 'Sin nombre').trim() || 'Sin nombre',
      type: isVXM ? 'VXM' : 'RIM',
      packedPercentage,
      totalQuantity: Number(p.totalQuantity) || 0,
      totalPacked: Number(p.totalPacked) || 0,
      fechaEntrega,
      isOverdue,
      stages,
      note,
    };
  });
}

function buildPendingGoods(
  pending: PublishWarehouseProcessInput['pendingGoods']
): BodegaTvPendingGoodRow[] {
  return (pending || []).map((g) => ({
    id: String(g.id || ''),
    marca: String(g.marca || '—').trim() || '—',
    cantidadEntrada: Number(g.cantidadEntrada) || 0,
    fechaEntradaAprox: String(g.fechaEntradaAprox || '').trim() || dayFallback(),
  }));
}

function dayFallback(): string {
  return todayKeyLocal();
}

function buildEntregas(
  entregas: PublishWarehouseProcessInput['entregas']
): BodegaTvEntregaSummary[] | undefined {
  if (!entregas?.length) return undefined;
  return entregas.map((e) => {
    const items = e.items || [];
    return {
      vehiculo: String(e.vehiculo || 'S/V').trim() || 'S/V',
      itemCount: items.length,
      totalQty: items.reduce((s, it) => s + (Number(it.cantidad) || 0), 0),
    };
  });
}

function buildTotals(
  processes: BodegaTvProcessRow[],
  pendingGoods: BodegaTvPendingGoodRow[]
): BodegaTvProcessSummary['totals'] {
  const rimCount = processes.filter((p) => p.type === 'RIM').length;
  const vxmCount = processes.filter((p) => p.type === 'VXM').length;
  const overdueCount = processes.filter((p) => p.isOverdue).length;
  const avgProgress =
    processes.length > 0
      ? processes.reduce((s, p) => s + (Number(p.packedPercentage) || 0), 0) / processes.length
      : 0;
  return {
    processCount: processes.length,
    rimCount,
    vxmCount,
    overdueCount,
    avgProgress,
    pendingCount: pendingGoods.length,
  };
}

/** Publica el resumen en memoria de Procesos de Bodega a Firestore (TV). */
export async function publishWarehouseProcessSummary(
  input: PublishWarehouseProcessInput
): Promise<{ success: boolean; data?: BodegaTvProcessSummary; error?: string }> {
  try {
    const dayKey = todayKeyLocal();
    const publishedBy = String(input.publishedBy || '').trim() || 'Sistema';
    const processes = buildProcessRows(input.processes || [], dayKey);
    const pendingGoods = buildPendingGoods(input.pendingGoods);
    const entregas = buildEntregas(input.entregas);

    if (processes.length === 0 && pendingGoods.length === 0) {
      return {
        success: false,
        error: 'No hay procesos ni ingresos pendientes para publicar.',
      };
    }

    const payload: BodegaTvProcessSummary = {
      publishedAt: new Date().toISOString(),
      publishedBy,
      dayKey,
      source: SOURCE,
      processes,
      pendingGoods,
      ...(entregas ? { entregas } : {}),
      totals: buildTotals(processes, pendingGoods),
    };

    await setDoc(
      doc(firestore, COLLECTION, LATEST_DOC),
      stripUndefinedDeep(payload) as BodegaTvProcessSummary
    );

    return { success: true, data: payload };
  } catch (error: any) {
    console.error('publishWarehouseProcessSummary:', error);
    return {
      success: false,
      error: error?.message || 'No se pudo publicar el resumen a Bodega Live.',
    };
  }
}

/** Lee el último resumen publicado (para TV / sync). */
export async function getLatestWarehouseProcessSummary(): Promise<{
  success: boolean;
  data?: BodegaTvProcessSummary | null;
  error?: string;
}> {
  try {
    const snap = await getDoc(doc(firestore, COLLECTION, LATEST_DOC));
    if (!snap.exists()) {
      return { success: true, data: null };
    }
    return { success: true, data: snap.data() as BodegaTvProcessSummary };
  } catch (error: any) {
    console.error('getLatestWarehouseProcessSummary:', error);
    return {
      success: false,
      error: error?.message || 'No se pudo leer el resumen de procesos.',
      data: null,
    };
  }
}

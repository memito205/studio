'use client';

import React from 'react';
import type {
  BodegaTvAreaSnapshot,
  BodegaTvHourlyBucket,
  BodegaTvPackingOrderSummary,
  BodegaTvPersonRank,
  BodegaTvProcessRow,
  BodegaTvProcessSummary,
  BodegaTvReceptionOpSummary,
  BodegaTvSnapshot,
} from '@/lib/bodegaTvTypes';
import { ClipboardList, Package, Tags, ScanLine, Warehouse, Trophy, Users, Gauge, ShoppingCart } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

/** Áreas del resumen principal (slide 1). El resto va al resumen complementario. */
export const BODEGA_TV_CORE_AREA_KEYS = ['empaque', 'etiquetado', 'tallado', 'recepcion'] as const;

const AREA_ACCENT: Record<string, string> = {
  empaque: 'text-sky-400',
  etiquetado: 'text-violet-400',
  tallado: 'text-emerald-400',
  recepcion: 'text-amber-400',
  ventas_mayor: 'text-rose-400',
};

const AREA_ICON = {
  empaque: Package,
  etiquetado: Tags,
  tallado: ScanLine,
  recepcion: Warehouse,
  ventas_mayor: ShoppingCart,
} as const;

export const BODEGA_TV_PAGE_SIZE = 2;
/** Operaciones de recepción por slide (antes del ranking de operarios). */
export const RECEPTION_OPS_PAGE_SIZE = 3;
/** Pedidos En Empaque (Ventas x Mayor) por slide. */
export const PACKING_ORDERS_PAGE_SIZE = 3;
/** Procesos de Bodega (RIM/VXM) por slide. */
export const PROCESS_SUMMARY_PAGE_SIZE = 3;

function fmt(n: number, digits = 0) {
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('es-CO', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function RankTable({
  ranking,
  showCompliance,
  rankOffset = 0,
}: {
  ranking: BodegaTvPersonRank[];
  showCompliance?: boolean;
  rankOffset?: number;
}) {
  if (!ranking.length) {
    return (
      <div className="flex-1 flex items-center justify-center text-[1.5em] text-slate-500 font-semibold">
        Sin actividad registrada hoy
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-visible md:overflow-hidden flex flex-col justify-start md:justify-center gap-[0.85em] md:gap-[1.1em] pb-[1em] md:pb-0">
      <div className="hidden md:grid grid-cols-[4.2em_minmax(0,2.6fr)_repeat(3,minmax(5.5em,0.9fr))] gap-x-[1.2em] text-[0.95em] font-bold uppercase tracking-wider text-slate-500 px-[0.4em]">
        <span>#</span>
        <span>Persona / Grupo</span>
        <span className="text-right">Unidades</span>
        <span className="text-right">U/H</span>
        <span className="text-right">{showCompliance ? 'Cumpl. %' : 'Detalle'}</span>
      </div>
      <div className="space-y-[0.75em] md:space-y-[1em]">
        {ranking.map((row, idx) => {
          const rank = rankOffset + idx + 1;
          return (
            <div
              key={`${row.name}-${rank}`}
              className={`flex flex-col gap-[0.65em] md:grid md:grid-cols-[4.2em_minmax(0,2.6fr)_repeat(3,minmax(5.5em,0.9fr))] md:gap-x-[1.2em] md:items-center rounded-[1em] px-[1em] py-[0.95em] md:py-[1.15em] border ${
                rank === 1
                  ? 'bg-amber-500/10 border-amber-500/40'
                  : 'bg-slate-900/80 border-slate-700'
              }`}
            >
              <div className="flex items-start gap-[0.75em] md:contents min-w-0">
                <span
                  className={`w-[2.4em] h-[2.4em] md:w-[2.6em] md:h-[2.6em] rounded-full flex items-center justify-center font-black text-[1.15em] md:text-[1.25em] shrink-0 ${
                    rank === 1
                      ? 'bg-amber-400 text-slate-950'
                      : rank === 2
                        ? 'bg-slate-300 text-slate-900'
                        : rank === 3
                          ? 'bg-orange-700 text-white'
                          : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  {rank}
                </span>
                <div className="min-w-0 flex-1 md:pr-[0.4em]">
                  <div className="text-[1.35em] md:text-[1.85em] font-extrabold text-slate-100 leading-[1.15] break-words whitespace-normal">
                    {row.name}
                  </div>
                  {row.meta ? (
                    <div className="text-[0.9em] md:text-[0.95em] text-slate-400 font-semibold mt-[0.35em] break-words whitespace-normal leading-snug">
                      {row.meta}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-[0.5em] md:contents">
                <div className="text-center md:text-right">
                  <div className="md:hidden text-[0.7em] uppercase tracking-wider text-slate-500 font-bold mb-[0.2em]">
                    Und
                  </div>
                  <div className="text-[1.55em] md:text-[2em] font-black tabular-nums leading-none">
                    {fmt(row.units)}
                  </div>
                </div>
                <div className="text-center md:text-right">
                  <div className="md:hidden text-[0.7em] uppercase tracking-wider text-slate-500 font-bold mb-[0.2em]">
                    U/H
                  </div>
                  <div className="text-[1.55em] md:text-[2em] font-black tabular-nums text-sky-300 leading-none">
                    {fmt(row.productivity, 1)}
                  </div>
                </div>
                <div className="text-center md:text-right">
                  <div className="md:hidden text-[0.7em] uppercase tracking-wider text-slate-500 font-bold mb-[0.2em]">
                    {showCompliance ? 'Cumpl.' : 'Det.'}
                  </div>
                  <div className="text-[1.55em] md:text-[2em] font-black tabular-nums leading-none">
                    {showCompliance && typeof row.compliance === 'number'
                      ? `${fmt(row.compliance, 0)}%`
                      : '—'}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function BodegaOverviewSlide({
  data,
  areas: areasProp,
  title,
  subtitle,
  summaryMode = 'global',
}: {
  data: BodegaTvSnapshot;
  /** Si se pasa, solo se muestran estas áreas (p. ej. core o complementarias). */
  areas?: BodegaTvAreaSnapshot[];
  title?: string;
  subtitle?: string;
  /** global = KPIs del snapshot; local = KPIs solo de las áreas mostradas. */
  summaryMode?: 'global' | 'local';
}) {
  const isExternos = data.mode === 'externos';
  const areas = areasProp ?? data.areas;
  const areaColsMd =
    areas.length <= 1
      ? 'md:grid-cols-1'
      : areas.length === 2
        ? 'md:grid-cols-2'
        : areas.length === 3
          ? 'md:grid-cols-3'
          : 'md:grid-cols-4';

  const localUnits = areas.reduce((s, a) => s + (Number(a.units) || 0), 0);
  const localOps = areas.reduce((s, a) => s + (Number(a.operators) || 0), 0);
  let localCompSum = 0;
  let localCompW = 0;
  for (const a of areas) {
    if (typeof a.compliance === 'number' && Number.isFinite(a.compliance) && a.units > 0) {
      localCompSum += a.compliance * a.units;
      localCompW += a.units;
    }
  }
  const summaryUnits = summaryMode === 'local' ? localUnits : data.summary.totalUnits;
  const summaryOps = summaryMode === 'local' ? localOps : data.summary.operators;
  const summaryComp =
    summaryMode === 'local'
      ? localCompW > 0
        ? localCompSum / localCompW
        : 0
      : data.summary.avgCompliance;

  const heading =
    title ||
    (isExternos ? 'Resumen externos · Hoy' : 'Resumen operación bodega · Hoy');
  const sub =
    subtitle ||
    (isExternos
      ? 'Tallado + Etiquetado Externo · Recursos = personas únicas'
      : 'Recursos = personas únicas · Cumplimiento = promedio ponderado por und');

  return (
    <div className="w-full h-full flex flex-col min-h-0 max-md:h-auto">
      <h2 className="text-[1.35em] md:text-[1.85em] font-black tracking-tight text-slate-100 mb-[0.35em] flex items-center gap-[0.55em] leading-none">
        <Trophy className="w-[1.1em] h-[1.1em] text-amber-400 shrink-0" />
        {heading}
      </h2>
      <p className="text-[0.85em] text-slate-500 font-semibold mb-[1em] leading-snug">{sub}</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-[0.85em] md:gap-[1.1em] mb-[1.2em] shrink-0">
        <div className="rounded-[1em] border-2 border-slate-600 bg-slate-900 px-[1.2em] py-[1em] md:py-[1.3em] text-center">
          <div className="text-[0.8em] uppercase tracking-widest text-slate-400 font-bold mb-[0.4em]">
            Unidades totales
          </div>
          <div className="text-[2.6em] md:text-[3.4em] font-black text-blue-400 leading-none">
            {fmt(summaryUnits)}
          </div>
        </div>
        <div className="rounded-[1em] border-2 border-slate-600 bg-slate-900 px-[1.2em] py-[1em] md:py-[1.3em] text-center">
          <div className="text-[0.8em] uppercase tracking-widest text-slate-400 font-bold mb-[0.4em]">
            Cumplimiento medio
          </div>
          <div className="text-[2.6em] md:text-[3.4em] font-black text-emerald-400 leading-none">
            {fmt(summaryComp, 0)}%
          </div>
        </div>
        <div className="rounded-[1em] border-2 border-slate-600 bg-slate-900 px-[1.2em] py-[1em] md:py-[1.3em] text-center">
          <div className="text-[0.8em] uppercase tracking-widest text-slate-400 font-bold mb-[0.4em]">
            Recursos activos
          </div>
          <div className="text-[2.6em] md:text-[3.4em] font-black text-violet-400 leading-none">
            {fmt(summaryOps)}
          </div>
        </div>
      </div>

      <div className={`grid grid-cols-1 sm:grid-cols-2 ${areaColsMd} gap-[1em] flex-1 min-h-0 max-md:pb-[1em]`}>
        {areas.map((area) => {
          const Icon = AREA_ICON[area.key as keyof typeof AREA_ICON] || Package;
          const etiquetadoExtras = (area.extras || []).filter((ex) =>
            ['Und LIVE', 'Cajas', 'Refs finalizadas'].includes(ex.label)
          );
          return (
            <div
              key={area.key}
              className="rounded-[1em] border-2 border-slate-700 bg-slate-900/90 px-[1em] py-[1em] flex flex-col min-h-0 overflow-hidden"
            >
              <div className="flex items-center gap-[0.45em] mb-[0.55em] shrink-0">
                <Icon
                  className={`w-[1.05em] h-[1.05em] shrink-0 ${AREA_ACCENT[area.key] || 'text-slate-300'}`}
                />
                <span
                  className={`text-[1.25em] font-black leading-tight ${AREA_ACCENT[area.key] || 'text-slate-200'}`}
                >
                  {area.title}
                </span>
              </div>
              <div className="text-[2.1em] md:text-[2.5em] font-black text-slate-100 mb-[0.1em] leading-none shrink-0">
                {fmt(area.units)}
              </div>
              <div className="text-[0.8em] text-slate-400 font-semibold mb-[0.55em] shrink-0">
                unidades hoy
              </div>
              {area.key === 'etiquetado' && etiquetadoExtras.length > 0 ? (
                <div className="mb-[0.55em] flex flex-wrap gap-[0.35em] shrink-0">
                  {etiquetadoExtras.map((ex) => (
                    <div
                      key={ex.label}
                      className="rounded-md border border-slate-700 bg-slate-950/70 px-[0.45em] py-[0.2em] text-[0.78em] font-semibold leading-tight"
                    >
                      <span className="text-slate-500 mr-[0.3em]">{ex.label}</span>
                      <span className="tabular-nums text-emerald-300">{ex.value}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="mt-auto space-y-[0.4em] text-[1.05em] shrink-0 pt-[0.35em]">
                <div className="flex justify-between gap-[0.4em]">
                  <span className="text-slate-500 flex items-center gap-[0.3em]">
                    <Gauge className="w-[0.85em] h-[0.85em]" /> U/H
                  </span>
                  <span className="font-black tabular-nums">{fmt(area.productivity, 1)}</span>
                </div>
                <div className="flex justify-between gap-[0.4em]">
                  <span className="text-slate-500 flex items-center gap-[0.3em]">
                    <Users className="w-[0.85em] h-[0.85em]" /> Pers.
                  </span>
                  <span className="font-black tabular-nums">{fmt(area.operators)}</span>
                </div>
                <div className="flex justify-between gap-[0.4em]">
                  <span className="text-slate-500">Cumpl.</span>
                  <span className="font-black tabular-nums text-emerald-400">
                    {typeof area.compliance === 'number' ? `${fmt(area.compliance, 0)}%` : '—'}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function BodegaAreaDetailSlide({
  area,
  rankingPage,
  pageIndex,
  pageCount,
}: {
  area: BodegaTvAreaSnapshot;
  rankingPage: BodegaTvPersonRank[];
  pageIndex: number;
  pageCount: number;
}) {
  const Icon = AREA_ICON[area.key as keyof typeof AREA_ICON] || Package;
  const showCompliance =
    area.key === 'empaque' ||
    area.key === 'etiquetado' ||
    area.key === 'recepcion' ||
    area.key === 'ventas_mayor' ||
    typeof area.compliance === 'number' ||
    rankingPage.some((r) => typeof r.compliance === 'number');
  const rankOffset = pageIndex * BODEGA_TV_PAGE_SIZE;
  const tvExtras = (area.extras || []).filter((ex) =>
    [
      'Personas',
      'Grupos',
      'Jornada',
      'Pausas',
      'Horas',
      'Horas prod.',
      'Interno',
      'Externo',
      'Und LIVE',
      'Cajas',
      'Refs finalizadas',
      'Refs legacy',
      'En Empaque',
      'Meta U/H',
    ].includes(ex.label)
  );

  return (
    <div className="w-full h-full flex flex-col min-h-0 max-md:h-auto">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between mb-[0.9em] gap-[0.75em] md:gap-[1em] shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-[0.55em] mb-[0.35em]">
            <Icon className={`w-[1.35em] h-[1.35em] shrink-0 ${AREA_ACCENT[area.key]}`} />
            <h2
              className={`text-[1.7em] md:text-[2.4em] font-black tracking-tight leading-none ${AREA_ACCENT[area.key]}`}
            >
              {area.title}
            </h2>
          </div>
          <p className="text-[1em] text-slate-400 font-semibold">
            Ranking · día en curso
            {pageCount > 1 ? ` · página ${pageIndex + 1}/${pageCount}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-[0.55em] md:gap-[0.7em] shrink-0">
          <div className="rounded-[0.85em] border-2 border-slate-600 bg-slate-900 px-[0.85em] md:px-[1em] py-[0.65em] md:py-[0.75em] text-center min-w-[5.2em] md:min-w-[6.5em] flex-1 md:flex-none">
            <div className="text-[0.65em] uppercase tracking-widest text-slate-500 font-bold">
              Unidades
            </div>
            <div className="text-[1.45em] md:text-[1.7em] font-black text-slate-100 tabular-nums leading-none mt-[0.2em]">
              {fmt(area.units)}
            </div>
          </div>
          <div className="rounded-[0.85em] border-2 border-slate-600 bg-slate-900 px-[0.85em] md:px-[1em] py-[0.65em] md:py-[0.75em] text-center min-w-[5.2em] md:min-w-[6.5em] flex-1 md:flex-none">
            <div className="text-[0.65em] uppercase tracking-widest text-slate-500 font-bold">U/H</div>
            <div className="text-[1.45em] md:text-[1.7em] font-black text-sky-300 tabular-nums leading-none mt-[0.2em]">
              {fmt(area.productivity, 1)}
            </div>
          </div>
          <div className="rounded-[0.85em] border-2 border-slate-600 bg-slate-900 px-[0.85em] md:px-[1em] py-[0.65em] md:py-[0.75em] text-center min-w-[5.2em] md:min-w-[6.5em] flex-1 md:flex-none">
            <div className="text-[0.65em] uppercase tracking-widest text-slate-500 font-bold">
              Pers.
            </div>
            <div className="text-[1.45em] md:text-[1.7em] font-black text-violet-300 tabular-nums leading-none mt-[0.2em]">
              {fmt(area.operators)}
            </div>
          </div>
          {typeof area.compliance === 'number' ? (
            <div className="rounded-[0.85em] border-2 border-slate-600 bg-slate-900 px-[0.85em] md:px-[1em] py-[0.65em] md:py-[0.75em] text-center min-w-[5.2em] md:min-w-[6.5em] flex-1 md:flex-none">
              <div className="text-[0.65em] uppercase tracking-widest text-slate-500 font-bold">
                Cumpl.
              </div>
              <div className="text-[1.45em] md:text-[1.7em] font-black text-emerald-400 tabular-nums leading-none mt-[0.2em]">
                {fmt(area.compliance, 0)}%
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {tvExtras.length > 0 ? (
        <div className="flex flex-wrap gap-[0.55em] mb-[0.75em] shrink-0">
          {tvExtras.map((ex) => (
            <div
              key={ex.label}
              className="rounded-full border border-slate-600 bg-slate-900/80 px-[0.9em] py-[0.35em] text-[0.85em] max-w-full"
            >
              <span className="text-slate-500 font-semibold mr-[0.4em]">{ex.label}:</span>
              <span className="font-bold text-slate-200 break-words">{ex.value}</span>
            </div>
          ))}
        </div>
      ) : null}

      <RankTable
        ranking={rankingPage}
        showCompliance={showCompliance}
        rankOffset={rankOffset}
      />
    </div>
  );
}

export function BodegaRecepcionOpsSlide({
  area,
  opsPage,
  pageIndex,
  pageCount,
}: {
  area: BodegaTvAreaSnapshot;
  opsPage: BodegaTvReceptionOpSummary[];
  pageIndex: number;
  pageCount: number;
}) {
  const Icon = AREA_ICON.recepcion;

  return (
    <div className="w-full h-full flex flex-col min-h-0 max-md:h-auto">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between mb-[0.9em] gap-[0.75em] md:gap-[1em] shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-[0.55em] mb-[0.35em]">
            <Icon className={`w-[1.35em] h-[1.35em] shrink-0 ${AREA_ACCENT.recepcion}`} />
            <h2
              className={`text-[1.7em] md:text-[2.4em] font-black tracking-tight leading-none ${AREA_ACCENT.recepcion}`}
            >
              {area.title}
            </h2>
          </div>
          <p className="text-[1em] text-slate-400 font-semibold">
            Operaciones en paralelo · día en curso
            {pageCount > 1 ? ` · página ${pageIndex + 1}/${pageCount}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-[0.55em] md:gap-[0.7em] shrink-0">
          <div className="rounded-[0.85em] border-2 border-slate-600 bg-slate-900 px-[0.85em] md:px-[1em] py-[0.65em] md:py-[0.75em] text-center min-w-[5.2em] md:min-w-[6.5em] flex-1 md:flex-none">
            <div className="text-[0.65em] uppercase tracking-widest text-slate-500 font-bold">
              Ops
            </div>
            <div className="text-[1.45em] md:text-[1.7em] font-black text-amber-300 tabular-nums leading-none mt-[0.2em]">
              {fmt((area.receptionOps || []).length)}
            </div>
          </div>
          <div className="rounded-[0.85em] border-2 border-slate-600 bg-slate-900 px-[0.85em] md:px-[1em] py-[0.65em] md:py-[0.75em] text-center min-w-[5.2em] md:min-w-[6.5em] flex-1 md:flex-none">
            <div className="text-[0.65em] uppercase tracking-widest text-slate-500 font-bold">
              Contado
            </div>
            <div className="text-[1.45em] md:text-[1.7em] font-black text-slate-100 tabular-nums leading-none mt-[0.2em]">
              {fmt(
                (area.receptionOps || []).reduce(
                  (s, op) => s + (Number(op.unitsCounted ?? op.unitsToday) || 0),
                  0
                )
              )}
            </div>
          </div>
        </div>
      </div>

      {!opsPage.length ? (
        <div className="flex-1 flex items-center justify-center text-[1.5em] text-slate-500 font-semibold">
          Sin operaciones activas hoy
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-visible md:overflow-hidden flex flex-col justify-start md:justify-center gap-[0.75em] md:gap-[0.9em] pb-[1em] md:pb-0">
          <div className="hidden md:grid grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_minmax(5em,0.7fr)_minmax(6em,0.9fr)_minmax(5em,0.7fr)_minmax(5.5em,0.75fr)] gap-x-[0.9em] text-[0.85em] font-bold uppercase tracking-wider text-slate-500 px-[0.4em]">
            <span>RK</span>
            <span>Proveedor</span>
            <span className="text-right">Estado</span>
            <span className="text-right">Contado</span>
            <span className="text-right">Pers.</span>
            <span className="text-right">Avance</span>
          </div>
          <div className="space-y-[0.75em] md:space-y-[0.85em]">
            {opsPage.map((op) => {
              const active = op.status === 'in_progress' || op.status === 'paused';
              const counted = Number(op.unitsCounted ?? op.unitsToday) || 0;
              return (
                <div
                  key={op.id}
                  className={`flex flex-col gap-[0.55em] md:grid md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_minmax(5em,0.7fr)_minmax(6em,0.9fr)_minmax(5em,0.7fr)_minmax(5.5em,0.75fr)] md:gap-x-[0.9em] md:items-center rounded-[1em] px-[1em] py-[0.9em] md:py-[1em] border ${
                    active
                      ? 'bg-amber-500/10 border-amber-500/40'
                      : 'bg-slate-900/80 border-slate-700'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="md:hidden text-[0.7em] uppercase tracking-wider text-slate-500 font-bold mb-[0.15em]">
                      RK
                    </div>
                    <div className="text-[1.35em] md:text-[1.55em] font-black text-slate-100 leading-tight break-words">
                      {op.rkIdentifier}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="md:hidden text-[0.7em] uppercase tracking-wider text-slate-500 font-bold mb-[0.15em]">
                      Proveedor
                    </div>
                    <div className="text-[1.1em] md:text-[1.25em] font-bold text-slate-300 leading-tight break-words">
                      {op.supplier}
                    </div>
                  </div>
                  <div className="flex items-center justify-between md:block gap-[0.5em]">
                    <div className="md:hidden text-[0.7em] uppercase tracking-wider text-slate-500 font-bold">
                      Estado
                    </div>
                    <div
                      className={`md:text-right text-[1.05em] md:text-[1.15em] font-extrabold ${
                        op.status === 'in_progress'
                          ? 'text-amber-300'
                          : op.status === 'paused'
                            ? 'text-orange-300'
                            : op.status === 'completed'
                              ? 'text-emerald-400'
                              : 'text-slate-400'
                      }`}
                    >
                      {op.statusLabel}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-[0.5em] md:contents">
                    <div className="text-center md:text-right">
                      <div className="md:hidden text-[0.7em] uppercase tracking-wider text-slate-500 font-bold mb-[0.15em]">
                        Contado
                      </div>
                      <div className="text-[1.4em] md:text-[1.7em] font-black tabular-nums leading-none">
                        {fmt(counted)}
                        {op.expectedQuantity > 0 ? (
                          <span className="block text-[0.55em] font-semibold text-slate-500 mt-[0.25em]">
                            / {fmt(op.expectedQuantity)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="text-center md:text-right">
                      <div className="md:hidden text-[0.7em] uppercase tracking-wider text-slate-500 font-bold mb-[0.15em]">
                        Pers.
                      </div>
                      <div className="text-[1.4em] md:text-[1.7em] font-black tabular-nums text-violet-300 leading-none">
                        {fmt(op.operatorsToday)}
                      </div>
                    </div>
                    <div className="text-center md:text-right">
                      <div className="md:hidden text-[0.7em] uppercase tracking-wider text-slate-500 font-bold mb-[0.15em]">
                        Avance
                      </div>
                      <div className="text-[1.4em] md:text-[1.7em] font-black tabular-nums text-sky-300 leading-none">
                        {typeof op.progressPct === 'number' ? `${fmt(op.progressPct, 0)}%` : '—'}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function BodegaVentasMayorPackingSlide({
  area,
  ordersPage,
  pageIndex,
  pageCount,
}: {
  area: BodegaTvAreaSnapshot;
  ordersPage: BodegaTvPackingOrderSummary[];
  pageIndex: number;
  pageCount: number;
}) {
  const Icon = AREA_ICON.ventas_mayor;
  const allOrders = area.packingOrders || [];
  const metaUh = (area.extras || []).find((ex) => ex.label === 'Meta U/H')?.value;

  return (
    <div className="w-full h-full flex flex-col min-h-0 max-md:h-auto">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between mb-[0.9em] gap-[0.75em] md:gap-[1em] shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-[0.55em] mb-[0.35em]">
            <Icon className={`w-[1.35em] h-[1.35em] shrink-0 ${AREA_ACCENT.ventas_mayor}`} />
            <h2
              className={`text-[1.7em] md:text-[2.4em] font-black tracking-tight leading-none ${AREA_ACCENT.ventas_mayor}`}
            >
              {area.title}
            </h2>
          </div>
          <p className="text-[1em] text-slate-400 font-semibold">
            Pedidos En Empaque · avance packed / total
            {metaUh ? ` · Meta: ${metaUh} U/H` : ''}
            {pageCount > 1 ? ` · página ${pageIndex + 1}/${pageCount}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-[0.55em] md:gap-[0.7em] shrink-0">
          <div className="rounded-[0.85em] border-2 border-slate-600 bg-slate-900 px-[0.85em] md:px-[1em] py-[0.65em] md:py-[0.75em] text-center min-w-[5.2em] md:min-w-[6.5em] flex-1 md:flex-none">
            <div className="text-[0.65em] uppercase tracking-widest text-slate-500 font-bold">
              Pedidos
            </div>
            <div className="text-[1.45em] md:text-[1.7em] font-black text-rose-300 tabular-nums leading-none mt-[0.2em]">
              {fmt(allOrders.length)}
            </div>
          </div>
          <div className="rounded-[0.85em] border-2 border-slate-600 bg-slate-900 px-[0.85em] md:px-[1em] py-[0.65em] md:py-[0.75em] text-center min-w-[5.2em] md:min-w-[6.5em] flex-1 md:flex-none">
            <div className="text-[0.65em] uppercase tracking-widest text-slate-500 font-bold">
              Empacado
            </div>
            <div className="text-[1.45em] md:text-[1.7em] font-black text-slate-100 tabular-nums leading-none mt-[0.2em]">
              {fmt(allOrders.reduce((s, o) => s + (Number(o.packedUnits) || 0), 0))}
            </div>
          </div>
          <div className="rounded-[0.85em] border-2 border-slate-600 bg-slate-900 px-[0.85em] md:px-[1em] py-[0.65em] md:py-[0.75em] text-center min-w-[5.2em] md:min-w-[6.5em] flex-1 md:flex-none">
            <div className="text-[0.65em] uppercase tracking-widest text-slate-500 font-bold">
              Restante
            </div>
            <div className="text-[1.45em] md:text-[1.7em] font-black text-amber-300 tabular-nums leading-none mt-[0.2em]">
              {fmt(allOrders.reduce((s, o) => s + (Number(o.remainingUnits) || 0), 0))}
            </div>
          </div>
        </div>
      </div>

      {!ordersPage.length ? (
        <div className="flex-1 flex items-center justify-center text-[1.5em] text-slate-500 font-semibold">
          Sin pedidos En Empaque
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-visible md:overflow-hidden flex flex-col justify-start md:justify-center gap-[0.75em] md:gap-[0.9em] pb-[1em] md:pb-0">
          <div className="hidden md:grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_minmax(7em,1fr)_minmax(5em,0.7fr)_minmax(5.5em,0.75fr)] gap-x-[0.9em] text-[0.85em] font-bold uppercase tracking-wider text-slate-500 px-[0.4em]">
            <span>Pedido</span>
            <span>Cliente</span>
            <span className="text-right">Empacado</span>
            <span className="text-right">Restante</span>
            <span className="text-right">Avance</span>
          </div>
          <div className="space-y-[0.75em] md:space-y-[0.85em]">
            {ordersPage.map((order) => {
              const packed = Number(order.packedUnits) || 0;
              const total = Number(order.totalUnits) || 0;
              const remaining = Number(order.remainingUnits) || 0;
              return (
                <div
                  key={order.id}
                  className="flex flex-col gap-[0.55em] md:grid md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_minmax(7em,1fr)_minmax(5em,0.7fr)_minmax(5.5em,0.75fr)] md:gap-x-[0.9em] md:items-center rounded-[1em] px-[1em] py-[0.9em] md:py-[1em] border bg-rose-500/10 border-rose-500/35"
                >
                  <div className="min-w-0">
                    <div className="md:hidden text-[0.7em] uppercase tracking-wider text-slate-500 font-bold mb-[0.15em]">
                      Pedido
                    </div>
                    <div className="text-[1.35em] md:text-[1.55em] font-black text-slate-100 leading-tight break-words">
                      {order.id}
                    </div>
                    {order.ordenDeCompra ? (
                      <div className="text-[0.85em] text-slate-500 font-semibold mt-[0.15em] break-words">
                        OC {order.ordenDeCompra}
                      </div>
                    ) : null}
                  </div>
                  <div className="min-w-0">
                    <div className="md:hidden text-[0.7em] uppercase tracking-wider text-slate-500 font-bold mb-[0.15em]">
                      Cliente
                    </div>
                    <div className="text-[1.1em] md:text-[1.25em] font-bold text-slate-300 leading-tight break-words">
                      {order.cliente}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-[0.5em] md:contents">
                    <div className="text-center md:text-right">
                      <div className="md:hidden text-[0.7em] uppercase tracking-wider text-slate-500 font-bold mb-[0.15em]">
                        Empacado
                      </div>
                      <div className="text-[1.4em] md:text-[1.7em] font-black tabular-nums leading-none">
                        {fmt(packed)}
                        {total > 0 ? (
                          <span className="block text-[0.55em] font-semibold text-slate-500 mt-[0.25em]">
                            / {fmt(total)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="text-center md:text-right">
                      <div className="md:hidden text-[0.7em] uppercase tracking-wider text-slate-500 font-bold mb-[0.15em]">
                        Restante
                      </div>
                      <div className="text-[1.4em] md:text-[1.7em] font-black tabular-nums text-amber-300 leading-none">
                        {fmt(remaining)}
                      </div>
                    </div>
                    <div className="text-center md:text-right">
                      <div className="md:hidden text-[0.7em] uppercase tracking-wider text-slate-500 font-bold mb-[0.15em]">
                        Avance
                      </div>
                      <div className="text-[1.4em] md:text-[1.7em] font-black tabular-nums text-sky-300 leading-none">
                        {typeof order.progressPct === 'number' ? `${fmt(order.progressPct, 0)}%` : '—'}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ProcessStagesCompact({ stages }: { stages: BodegaTvProcessRow['stages'] }) {
  if (!stages?.length) return null;
  return (
    <div className="flex flex-wrap gap-[0.4em] mt-[0.35em]">
      {stages.map((st) => (
        <span
          key={st.label}
          className="rounded-full border border-slate-600 bg-slate-950/60 px-[0.65em] py-[0.2em] text-[0.75em] md:text-[0.8em] font-bold text-slate-300"
        >
          <span className="text-slate-500 mr-[0.3em]">{st.label}</span>
          <span className="tabular-nums text-slate-100">{fmt(st.pct, 0)}%</span>
        </span>
      ))}
    </div>
  );
}

export function BodegaProcessSummarySlide({
  summary,
  processesPage,
  pageIndex,
  pageCount,
}: {
  summary: BodegaTvProcessSummary | null | undefined;
  processesPage: BodegaTvProcessRow[];
  pageIndex: number;
  pageCount: number;
}) {
  const publishedLabel = summary?.publishedAt
    ? format(new Date(summary.publishedAt), "dd MMM · HH:mm", { locale: es })
    : null;
  const totals = summary?.totals;
  const pending = summary?.pendingGoods || [];
  const showPendingStrip = pending.length > 0 && pageIndex === 0;

  return (
    <div className="w-full h-full flex flex-col min-h-0 max-md:h-auto">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between mb-[0.9em] gap-[0.75em] md:gap-[1em] shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-[0.55em] mb-[0.35em]">
            <ClipboardList className="w-[1.35em] h-[1.35em] shrink-0 text-cyan-400" />
            <h2 className="text-[1.7em] md:text-[2.4em] font-black tracking-tight leading-none text-cyan-400">
              Procesos de Bodega
            </h2>
          </div>
          <p className="text-[1em] text-slate-400 font-semibold">
            {summary
              ? `Publicado ${publishedLabel || '—'}${summary.publishedBy ? ` · ${summary.publishedBy}` : ''}`
              : 'Resumen manual desde Plataforma Logística'}
            {pageCount > 1 ? ` · página ${pageIndex + 1}/${pageCount}` : ''}
          </p>
        </div>
        {summary ? (
          <div className="flex flex-wrap gap-[0.55em] md:gap-[0.7em] shrink-0">
            <div className="rounded-[0.85em] border-2 border-slate-600 bg-slate-900 px-[0.85em] md:px-[1em] py-[0.65em] md:py-[0.75em] text-center min-w-[5.2em] md:min-w-[6.5em] flex-1 md:flex-none">
              <div className="text-[0.65em] uppercase tracking-widest text-slate-500 font-bold">
                Procesos
              </div>
              <div className="text-[1.45em] md:text-[1.7em] font-black text-cyan-300 tabular-nums leading-none mt-[0.2em]">
                {fmt(totals?.processCount || 0)}
              </div>
            </div>
            <div className="rounded-[0.85em] border-2 border-slate-600 bg-slate-900 px-[0.85em] md:px-[1em] py-[0.65em] md:py-[0.75em] text-center min-w-[5.2em] md:min-w-[6.5em] flex-1 md:flex-none">
              <div className="text-[0.65em] uppercase tracking-widest text-slate-500 font-bold">
                Avance medio
              </div>
              <div className="text-[1.45em] md:text-[1.7em] font-black text-sky-300 tabular-nums leading-none mt-[0.2em]">
                {fmt(totals?.avgProgress || 0, 0)}%
              </div>
            </div>
            <div className="rounded-[0.85em] border-2 border-slate-600 bg-slate-900 px-[0.85em] md:px-[1em] py-[0.65em] md:py-[0.75em] text-center min-w-[5.2em] md:min-w-[6.5em] flex-1 md:flex-none">
              <div className="text-[0.65em] uppercase tracking-widest text-slate-500 font-bold">
                Atrasados
              </div>
              <div
                className={`text-[1.45em] md:text-[1.7em] font-black tabular-nums leading-none mt-[0.2em] ${
                  (totals?.overdueCount || 0) > 0 ? 'text-red-400' : 'text-slate-100'
                }`}
              >
                {fmt(totals?.overdueCount || 0)}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {!summary ? (
        <div className="flex-1 flex items-center justify-center text-[1.5em] text-slate-500 font-semibold">
          Sin resumen publicado
        </div>
      ) : !processesPage.length ? (
        <div className="flex-1 flex items-center justify-center text-[1.5em] text-slate-500 font-semibold">
          Sin procesos en el resumen
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-visible md:overflow-hidden flex flex-col gap-[0.75em] md:gap-[0.85em] pb-[1em] md:pb-0">
          <div className="flex-1 min-h-0 flex flex-col justify-start md:justify-center gap-[0.75em] md:gap-[0.85em]">
            <div className="hidden md:grid grid-cols-[4.5em_minmax(0,2fr)_minmax(7em,1.1fr)_minmax(5.5em,0.75fr)] gap-x-[0.9em] text-[0.85em] font-bold uppercase tracking-wider text-slate-500 px-[0.4em]">
              <span>Tipo</span>
              <span>Proceso</span>
              <span className="text-right">Empacado</span>
              <span className="text-right">Avance</span>
            </div>
            <div className="space-y-[0.75em] md:space-y-[0.85em]">
              {processesPage.map((proc) => {
                const packed = Number(proc.totalPacked) || 0;
                const total = Number(proc.totalQuantity) || 0;
                const overdue = Boolean(proc.isOverdue);
                return (
                  <div
                    key={proc.id || proc.name}
                    className={`flex flex-col gap-[0.55em] md:grid md:grid-cols-[4.5em_minmax(0,2fr)_minmax(7em,1.1fr)_minmax(5.5em,0.75fr)] md:gap-x-[0.9em] md:items-center rounded-[1em] px-[1em] py-[0.9em] md:py-[1em] border ${
                      overdue
                        ? 'bg-red-500/10 border-red-500/40'
                        : proc.type === 'VXM'
                          ? 'bg-sky-500/10 border-sky-500/35'
                          : 'bg-emerald-500/10 border-emerald-500/35'
                    }`}
                  >
                    <div className="flex items-center gap-[0.55em] md:block">
                      <span
                        className={`inline-flex items-center justify-center rounded-full px-[0.7em] py-[0.25em] text-[0.85em] md:text-[0.95em] font-black ${
                          proc.type === 'VXM'
                            ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                            : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        }`}
                      >
                        {proc.type}
                      </span>
                      {overdue ? (
                        <span className="md:hidden rounded-full bg-red-600 text-white text-[0.7em] font-black px-[0.65em] py-[0.2em]">
                          ATRASADO
                        </span>
                      ) : null}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-[0.45em]">
                        <div className="text-[1.25em] md:text-[1.45em] font-black text-slate-100 leading-tight break-words">
                          {proc.name}
                        </div>
                        {overdue ? (
                          <span className="hidden md:inline-flex rounded-full bg-red-600 text-white text-[0.7em] font-black px-[0.65em] py-[0.2em]">
                            ATRASADO
                          </span>
                        ) : null}
                      </div>
                      <ProcessStagesCompact stages={proc.stages} />
                    </div>
                    <div className="grid grid-cols-2 gap-[0.5em] md:contents">
                      <div className="text-center md:text-right">
                        <div className="md:hidden text-[0.7em] uppercase tracking-wider text-slate-500 font-bold mb-[0.15em]">
                          Empacado
                        </div>
                        <div className="text-[1.4em] md:text-[1.7em] font-black tabular-nums leading-none">
                          {fmt(packed)}
                          {total > 0 ? (
                            <span className="block text-[0.55em] font-semibold text-slate-500 mt-[0.25em]">
                              / {fmt(total)}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="text-center md:text-right">
                        <div className="md:hidden text-[0.7em] uppercase tracking-wider text-slate-500 font-bold mb-[0.15em]">
                          Avance
                        </div>
                        <div
                          className={`text-[1.4em] md:text-[1.7em] font-black tabular-nums leading-none ${
                            overdue ? 'text-red-400' : 'text-sky-300'
                          }`}
                        >
                          {fmt(proc.packedPercentage, 0)}%
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {showPendingStrip ? (
            <div className="shrink-0 rounded-[0.85em] border border-slate-700 bg-slate-900/80 px-[0.9em] py-[0.7em]">
              <div className="text-[0.75em] uppercase tracking-widest text-slate-500 font-bold mb-[0.45em]">
                Próximos ingresos ({pending.length})
              </div>
              <div className="flex flex-wrap gap-[0.45em]">
                {pending.slice(0, 8).map((g) => (
                  <span
                    key={g.id || g.marca}
                    className="rounded-full border border-slate-600 bg-slate-950/70 px-[0.75em] py-[0.3em] text-[0.85em] font-bold text-slate-200"
                  >
                    <span className="text-amber-300">{g.marca}</span>
                    <span className="text-slate-500 mx-[0.35em]">·</span>
                    <span className="tabular-nums">{fmt(g.cantidadEntrada)}</span>
                    {g.fechaEntradaAprox ? (
                      <>
                        <span className="text-slate-500 mx-[0.35em]">·</span>
                        <span className="text-slate-400 text-[0.9em]">{g.fechaEntradaAprox}</span>
                      </>
                    ) : null}
                  </span>
                ))}
                {pending.length > 8 ? (
                  <span className="rounded-full border border-slate-700 px-[0.75em] py-[0.3em] text-[0.85em] font-bold text-slate-500">
                    +{pending.length - 8} más
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

const REMAINDER_PAGE_SIZE = 2;

export function BodegaRemainderAssignmentsSlide({
  rows,
  pageIndex,
  pageCount,
}: {
  rows: import('@/lib/bodegaTvTypes').BodegaTvRemainderAssignmentRow[];
  pageIndex: number;
  pageCount: number;
}) {
  return (
    <div className="w-full h-full flex flex-col min-h-0 max-md:h-auto">
      <div className="shrink-0 mb-[0.75em]">
        <h2 className="text-[1.7em] md:text-[2.4em] font-black tracking-tight text-amber-300 leading-none mb-[0.3em]">
          Físico vs Distribución
        </h2>
        <p className="text-[1.05em] text-slate-400 font-semibold">
          Solo asignadas / tomadas (sin validar) · operario · ubicación · remanente
          {pageCount > 1 ? ` · ${pageIndex + 1}/${pageCount}` : ''}
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-[1.8em] text-slate-500 font-semibold">
          Sin asignaciones activas
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-visible md:overflow-hidden flex flex-col justify-start md:justify-center gap-[0.9em] md:gap-[1.15em] pb-[1em] md:pb-0">
          {rows.map((row, idx) => {
            const n = pageIndex * REMAINDER_PAGE_SIZE + idx + 1;
            return (
              <div
                key={`${row.reference}-${row.operatorName}-${idx}`}
                className="rounded-[1.1em] border-2 border-slate-600 bg-slate-900/95 px-[1em] md:px-[1.25em] py-[1em] md:py-[1.2em] flex flex-col gap-[0.75em] md:grid md:grid-cols-[3.2em_minmax(0,1.35fr)_minmax(0,1.15fr)_minmax(0,1.2fr)_minmax(7em,0.85fr)] md:gap-x-[1.1em] md:items-center"
              >
                <div className="flex items-center gap-[0.75em] md:contents">
                  <span className="w-[2.5em] h-[2.5em] md:w-[2.8em] md:h-[2.8em] rounded-full flex items-center justify-center font-black text-[1.2em] md:text-[1.35em] shrink-0 bg-amber-400/90 text-slate-950">
                    {n}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="text-[0.85em] uppercase tracking-wider text-slate-500 font-bold mb-[0.25em]">
                      Operario
                    </div>
                    <div className="text-[1.45em] md:text-[1.95em] font-extrabold text-slate-100 leading-[1.12] break-words whitespace-normal">
                      {row.operatorName}
                    </div>
                    <div className="text-[1em] md:text-[1.05em] text-slate-400 font-semibold mt-[0.35em] truncate">
                      {row.rkIdentifier || '—'} · {row.statusLabel}
                    </div>
                  </div>
                </div>

                <div className="min-w-0">
                  <div className="text-[0.85em] uppercase tracking-wider text-slate-500 font-bold mb-[0.25em]">
                    Referencia
                  </div>
                  <div className="text-[1.55em] md:text-[2em] font-black text-amber-200 leading-[1.1] break-words whitespace-normal">
                    {row.reference}
                  </div>
                </div>

                <div className="min-w-0">
                  <div className="text-[0.85em] uppercase tracking-wider text-slate-500 font-bold mb-[0.25em]">
                    Ubicación
                  </div>
                  <div className="text-[1.4em] md:text-[1.85em] font-extrabold text-sky-300 leading-[1.12] break-words whitespace-normal">
                    {row.locationName || 'Sin ubicación'}
                  </div>
                </div>

                <div className="min-w-0 md:text-right border-t border-slate-700 pt-[0.65em] md:border-0 md:pt-0">
                  <div className="text-[0.85em] uppercase tracking-wider text-slate-500 font-bold mb-[0.25em]">
                    Remanente
                  </div>
                  <div className="text-[2.1em] md:text-[2.6em] font-black tabular-nums text-slate-50 leading-none">
                    {fmt(row.expectedRemainderQty)}
                  </div>
                  <div
                    className={`text-[1.05em] md:text-[1.1em] font-bold mt-[0.45em] leading-snug ${
                      row.remainderComplete
                        ? 'text-emerald-300'
                        : row.status === 'submitted'
                          ? 'text-amber-300'
                          : 'text-slate-400'
                    }`}
                  >
                    {row.legalizationLabel || 'Pendiente'}
                  </div>
                  {row.returnedQty != null ? (
                    <div className="text-[0.95em] text-slate-500 tabular-nums mt-[0.2em]">
                      Dev. {fmt(row.returnedQty)}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export { REMAINDER_PAGE_SIZE };

export const HOURLY_PAGE_SIZE = 8;

export function BodegaAreaHourlySlide({
  area,
  buckets,
  pageIndex,
  pageCount,
}: {
  area: BodegaTvAreaSnapshot;
  buckets: BodegaTvHourlyBucket[];
  pageIndex: number;
  pageCount: number;
}) {
  const Icon = AREA_ICON[area.key as keyof typeof AREA_ICON] || Package;
  const maxUnits = Math.max(1, ...buckets.map((b) => b.units));

  return (
    <div className="w-full h-full flex flex-col min-h-0 max-md:h-auto">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between mb-[0.75em] gap-[0.75em] md:gap-[1em] shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-[0.55em] mb-[0.35em]">
            <Icon className={`w-[1.35em] h-[1.35em] shrink-0 ${AREA_ACCENT[area.key]}`} />
            <h2
              className={`text-[1.55em] md:text-[2.2em] font-black tracking-tight leading-none ${AREA_ACCENT[area.key]}`}
            >
              {area.title} · Por horas
            </h2>
          </div>
          <p className="text-[1em] text-slate-400 font-semibold">
            Unidades y productividad (U/H) por franja · Bogotá
            {pageCount > 1 ? ` · página ${pageIndex + 1}/${pageCount}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-[0.55em] md:gap-[0.7em] shrink-0">
          <div className="rounded-[0.85em] border-2 border-slate-600 bg-slate-900 px-[0.85em] md:px-[1em] py-[0.65em] md:py-[0.75em] text-center min-w-[5.2em] md:min-w-[6.5em] flex-1 md:flex-none">
            <div className="text-[0.65em] uppercase tracking-widest text-slate-500 font-bold">
              Und día
            </div>
            <div className="text-[1.45em] md:text-[1.7em] font-black text-slate-100 tabular-nums leading-none mt-[0.2em]">
              {fmt(area.units)}
            </div>
          </div>
          <div className="rounded-[0.85em] border-2 border-slate-600 bg-slate-900 px-[0.85em] md:px-[1em] py-[0.65em] md:py-[0.75em] text-center min-w-[5.2em] md:min-w-[6.5em] flex-1 md:flex-none">
            <div className="text-[0.65em] uppercase tracking-widest text-slate-500 font-bold">
              U/H día
            </div>
            <div className="text-[1.45em] md:text-[1.7em] font-black text-sky-300 tabular-nums leading-none mt-[0.2em]">
              {fmt(area.productivity, 1)}
            </div>
          </div>
        </div>
      </div>

      {buckets.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-[1.5em] text-slate-500 font-semibold">
          Sin producción por hora registrada hoy
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col pb-[1em] md:pb-0">
          <div className="hidden md:grid grid-cols-[5.5em_minmax(0,1.4fr)_minmax(5em,0.7fr)_minmax(5em,0.7fr)_minmax(4em,0.55fr)] gap-x-[1em] text-[0.9em] font-bold uppercase tracking-wider text-slate-500 px-[0.4em] mb-[0.55em] shrink-0">
            <span>Hora</span>
            <span>Producción</span>
            <span className="text-right">Unidades</span>
            <span className="text-right">U/H</span>
            <span className="text-right">Pers.</span>
          </div>
          <div className="flex-1 min-h-0 space-y-[0.55em] overflow-visible md:overflow-hidden">
            {buckets.map((row) => {
              const barPct = Math.max(4, Math.round((row.units / maxUnits) * 100));
              return (
                <div
                  key={row.hourLabel}
                  className="flex flex-col gap-[0.45em] md:grid md:grid-cols-[5.5em_minmax(0,1.4fr)_minmax(5em,0.7fr)_minmax(5em,0.7fr)_minmax(4em,0.55fr)] md:gap-x-[1em] md:items-center rounded-[0.85em] border border-slate-700 bg-slate-900/85 px-[0.9em] py-[0.7em]"
                >
                  <div className="flex items-center justify-between md:block">
                    <div className="text-[1.35em] md:text-[1.55em] font-black tabular-nums text-slate-100 leading-none">
                      {row.hourLabel}
                    </div>
                    <div className="md:hidden text-[1.2em] font-black tabular-nums text-sky-300">
                      {fmt(row.productivity, 1)} U/H
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="h-[0.85em] rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          area.key === 'tallado' ? 'bg-emerald-400' : 'bg-violet-400'
                        }`}
                        style={{ width: `${barPct}%` }}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-[0.5em] md:contents text-center">
                    <div>
                      <div className="md:hidden text-[0.65em] uppercase tracking-wider text-slate-500 font-bold mb-[0.1em]">
                        Und
                      </div>
                      <div className="text-[1.4em] md:text-[1.7em] font-black tabular-nums md:text-right leading-none">
                        {fmt(row.units)}
                      </div>
                    </div>
                    <div className="hidden md:block text-[1.7em] font-black tabular-nums text-right text-sky-300 leading-none">
                      {fmt(row.productivity, 1)}
                    </div>
                    <div>
                      <div className="md:hidden text-[0.65em] uppercase tracking-wider text-slate-500 font-bold mb-[0.1em]">
                        Pers.
                      </div>
                      <div className="text-[1.25em] md:text-[1.45em] font-bold tabular-nums md:text-right text-slate-300 leading-none">
                        {row.people != null && row.people > 0 ? fmt(row.people) : '—'}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

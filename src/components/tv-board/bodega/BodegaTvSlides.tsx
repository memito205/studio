'use client';

import React from 'react';
import type { BodegaTvAreaSnapshot, BodegaTvPersonRank, BodegaTvSnapshot } from '@/lib/bodegaTvTypes';
import { Package, Tags, ScanLine, Warehouse, Trophy, Users, Gauge } from 'lucide-react';

const AREA_ACCENT: Record<string, string> = {
  empaque: 'text-sky-400',
  etiquetado: 'text-violet-400',
  tallado: 'text-emerald-400',
  recepcion: 'text-amber-400',
};

const AREA_ICON = {
  empaque: Package,
  etiquetado: Tags,
  tallado: ScanLine,
  recepcion: Warehouse,
} as const;

export const BODEGA_TV_PAGE_SIZE = 2;

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
    <div className="flex-1 min-h-0 overflow-hidden flex flex-col justify-center gap-[1.1em]">
      <div className="grid grid-cols-[4.2em_minmax(0,2.6fr)_repeat(3,minmax(5.5em,0.9fr))] gap-x-[1.2em] text-[0.95em] font-bold uppercase tracking-wider text-slate-500 px-[0.4em]">
        <span>#</span>
        <span>Persona / Grupo</span>
        <span className="text-right">Unidades</span>
        <span className="text-right">U/H</span>
        <span className="text-right">{showCompliance ? 'Cumpl. %' : 'Detalle'}</span>
      </div>
      <div className="space-y-[1em]">
        {ranking.map((row, idx) => {
          const rank = rankOffset + idx + 1;
          return (
            <div
              key={`${row.name}-${rank}`}
              className={`grid grid-cols-[4.2em_minmax(0,2.6fr)_repeat(3,minmax(5.5em,0.9fr))] gap-x-[1.2em] items-center rounded-[1em] px-[1em] py-[1.15em] border ${
                rank === 1
                  ? 'bg-amber-500/10 border-amber-500/40'
                  : 'bg-slate-900/80 border-slate-700'
              }`}
            >
              <span
                className={`w-[2.6em] h-[2.6em] rounded-full flex items-center justify-center font-black text-[1.25em] shrink-0 ${
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
              <div className="min-w-0 pr-[0.4em]">
                <div className="text-[1.85em] font-extrabold text-slate-100 leading-[1.15] break-words whitespace-normal">
                  {row.name}
                </div>
                {row.meta ? (
                  <div className="text-[0.95em] text-slate-400 font-semibold mt-[0.35em] break-words whitespace-normal leading-snug">
                    {row.meta}
                  </div>
                ) : null}
              </div>
              <div className="text-[2em] font-black text-right tabular-nums leading-none">
                {fmt(row.units)}
              </div>
              <div className="text-[2em] font-black text-right tabular-nums text-sky-300 leading-none">
                {fmt(row.productivity, 1)}
              </div>
              <div className="text-[2em] font-black text-right tabular-nums leading-none">
                {showCompliance && typeof row.compliance === 'number'
                  ? `${fmt(row.compliance, 0)}%`
                  : '—'}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function BodegaOverviewSlide({ data }: { data: BodegaTvSnapshot }) {
  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <h2 className="text-[1.85em] font-black tracking-tight text-slate-100 mb-[0.35em] flex items-center gap-[0.55em] leading-none">
        <Trophy className="w-[1.1em] h-[1.1em] text-amber-400 shrink-0" />
        Resumen operación bodega · Hoy
      </h2>
      <p className="text-[0.85em] text-slate-500 font-semibold mb-[1em] leading-snug">
        Recursos = personas únicas · Cumplimiento = empaque ponderado
      </p>

      <div className="grid grid-cols-3 gap-[1.1em] mb-[1.2em] shrink-0">
        <div className="rounded-[1em] border-2 border-slate-600 bg-slate-900 px-[1.2em] py-[1.3em] text-center">
          <div className="text-[0.8em] uppercase tracking-widest text-slate-400 font-bold mb-[0.4em]">
            Unidades totales
          </div>
          <div className="text-[3.4em] font-black text-blue-400 leading-none">
            {fmt(data.summary.totalUnits)}
          </div>
        </div>
        <div className="rounded-[1em] border-2 border-slate-600 bg-slate-900 px-[1.2em] py-[1.3em] text-center">
          <div className="text-[0.8em] uppercase tracking-widest text-slate-400 font-bold mb-[0.4em]">
            Cumplimiento medio
          </div>
          <div className="text-[3.4em] font-black text-emerald-400 leading-none">
            {fmt(data.summary.avgCompliance, 0)}%
          </div>
        </div>
        <div className="rounded-[1em] border-2 border-slate-600 bg-slate-900 px-[1.2em] py-[1.3em] text-center">
          <div className="text-[0.8em] uppercase tracking-widest text-slate-400 font-bold mb-[0.4em]">
            Recursos activos
          </div>
          <div className="text-[3.4em] font-black text-violet-400 leading-none">
            {fmt(data.summary.operators)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-[1em] flex-1 min-h-0">
        {data.areas.map((area) => {
          const Icon = AREA_ICON[area.key];
          return (
            <div
              key={area.key}
              className="rounded-[1em] border-2 border-slate-700 bg-slate-900/90 px-[1.1em] py-[1.2em] flex flex-col min-h-0"
            >
              <div className="flex items-center gap-[0.5em] mb-[0.85em]">
                <Icon className={`w-[1.15em] h-[1.15em] shrink-0 ${AREA_ACCENT[area.key]}`} />
                <span className={`text-[1.35em] font-black leading-tight ${AREA_ACCENT[area.key]}`}>
                  {area.title}
                </span>
              </div>
              <div className="text-[2.8em] font-black text-slate-100 mb-[0.15em] leading-none">
                {fmt(area.units)}
              </div>
              <div className="text-[0.9em] text-slate-400 font-semibold mb-[0.9em]">unidades hoy</div>
              {area.key === 'etiquetado' ? (
                <div className="mb-[0.75em] space-y-[0.25em] text-[0.95em] font-semibold text-slate-300">
                  {(area.extras || [])
                    .filter((ex) => ['Und LIVE', 'Cajas', 'Refs finalizadas'].includes(ex.label))
                    .map((ex) => (
                      <div key={ex.label} className="flex justify-between gap-[0.4em]">
                        <span className="text-slate-500">{ex.label}</span>
                        <span className="tabular-nums text-emerald-300">{ex.value}</span>
                      </div>
                    ))}
                </div>
              ) : null}
              <div className="mt-auto space-y-[0.55em] text-[1.15em]">
                <div className="flex justify-between gap-[0.5em]">
                  <span className="text-slate-500 flex items-center gap-[0.35em]">
                    <Gauge className="w-[0.9em] h-[0.9em]" /> U/H
                  </span>
                  <span className="font-black tabular-nums">{fmt(area.productivity, 1)}</span>
                </div>
                <div className="flex justify-between gap-[0.5em]">
                  <span className="text-slate-500 flex items-center gap-[0.35em]">
                    <Users className="w-[0.9em] h-[0.9em]" /> Pers.
                  </span>
                  <span className="font-black tabular-nums">{fmt(area.operators)}</span>
                </div>
                {typeof area.compliance === 'number' ? (
                  <div className="flex justify-between gap-[0.5em]">
                    <span className="text-slate-500">Cumpl.</span>
                    <span className="font-black tabular-nums">{fmt(area.compliance, 0)}%</span>
                  </div>
                ) : null}
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
  const Icon = AREA_ICON[area.key];
  const showCompliance =
    area.key === 'empaque' ||
    area.key === 'etiquetado' ||
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
    ].includes(ex.label)
  );

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="flex items-end justify-between mb-[0.9em] gap-[1em] shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-[0.55em] mb-[0.35em]">
            <Icon className={`w-[1.35em] h-[1.35em] shrink-0 ${AREA_ACCENT[area.key]}`} />
            <h2
              className={`text-[2.4em] font-black tracking-tight leading-none ${AREA_ACCENT[area.key]}`}
            >
              {area.title}
            </h2>
          </div>
          <p className="text-[1em] text-slate-400 font-semibold">
            Ranking · día en curso
            {pageCount > 1 ? ` · página ${pageIndex + 1}/${pageCount}` : ''}
          </p>
        </div>
        <div className="flex gap-[0.7em] shrink-0">
          <div className="rounded-[0.85em] border-2 border-slate-600 bg-slate-900 px-[1em] py-[0.75em] text-center min-w-[6.5em]">
            <div className="text-[0.65em] uppercase tracking-widest text-slate-500 font-bold">
              Unidades
            </div>
            <div className="text-[1.7em] font-black text-slate-100 tabular-nums leading-none mt-[0.2em]">
              {fmt(area.units)}
            </div>
          </div>
          <div className="rounded-[0.85em] border-2 border-slate-600 bg-slate-900 px-[1em] py-[0.75em] text-center min-w-[6.5em]">
            <div className="text-[0.65em] uppercase tracking-widest text-slate-500 font-bold">U/H</div>
            <div className="text-[1.7em] font-black text-sky-300 tabular-nums leading-none mt-[0.2em]">
              {fmt(area.productivity, 1)}
            </div>
          </div>
          <div className="rounded-[0.85em] border-2 border-slate-600 bg-slate-900 px-[1em] py-[0.75em] text-center min-w-[6.5em]">
            <div className="text-[0.65em] uppercase tracking-widest text-slate-500 font-bold">
              Pers.
            </div>
            <div className="text-[1.7em] font-black text-violet-300 tabular-nums leading-none mt-[0.2em]">
              {fmt(area.operators)}
            </div>
          </div>
          {typeof area.compliance === 'number' ? (
            <div className="rounded-[0.85em] border-2 border-slate-600 bg-slate-900 px-[1em] py-[0.75em] text-center min-w-[6.5em]">
              <div className="text-[0.65em] uppercase tracking-widest text-slate-500 font-bold">
                Cumpl.
              </div>
              <div className="text-[1.7em] font-black text-emerald-400 tabular-nums leading-none mt-[0.2em]">
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

const REMAINDER_PAGE_SIZE = 6;

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
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="shrink-0 mb-[0.9em]">
        <h2 className="text-[2.2em] font-black tracking-tight text-amber-300 leading-none mb-[0.35em]">
          Referencias asignadas
        </h2>
        <p className="text-[0.95em] text-slate-400 font-semibold">
          Físico vs Distribución · operario · ref · ubicación
          {pageCount > 1 ? ` · página ${pageIndex + 1}/${pageCount}` : ''}
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-[1.4em] text-slate-500 font-semibold">
          Sin asignaciones activas
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col justify-start gap-[0.55em]">
          <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1.1fr)_minmax(0,1.2fr)_5.5em] gap-x-[0.9em] text-[0.85em] font-bold uppercase tracking-wider text-slate-500 px-[0.35em]">
            <div>Operario</div>
            <div>Referencia</div>
            <div>Ubicación</div>
            <div className="text-right">Rem.</div>
          </div>
          {rows.map((row, idx) => (
            <div
              key={`${row.reference}-${row.operatorName}-${idx}`}
              className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1.1fr)_minmax(0,1.2fr)_5.5em] gap-x-[0.9em] items-center rounded-[0.75em] border border-slate-700 bg-slate-900/90 px-[0.75em] py-[0.65em]"
            >
              <div className="min-w-0">
                <div className="font-black text-[1.05em] text-slate-100 truncate">{row.operatorName}</div>
                <div className="text-[0.75em] text-slate-500 truncate">
                  {row.rkIdentifier || '—'} · {row.statusLabel}
                </div>
              </div>
              <div className="font-bold text-[1.05em] text-amber-200 truncate">{row.reference}</div>
              <div className="text-[0.95em] text-slate-300 truncate">{row.locationName || 'Sin ubicación'}</div>
              <div className="text-right font-black tabular-nums text-slate-100">
                {fmt(row.expectedRemainderQty)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export { REMAINDER_PAGE_SIZE };

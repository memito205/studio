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
      <div className="flex-1 flex items-center justify-center text-3xl text-slate-500 font-semibold">
        Sin actividad registrada hoy
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-hidden flex flex-col justify-center gap-5">
      <div className="grid grid-cols-[5rem_minmax(0,2.4fr)_repeat(3,minmax(7rem,0.85fr))] gap-x-8 text-2xl font-bold uppercase tracking-wider text-slate-500 px-3">
        <span>#</span>
        <span>Persona / Grupo</span>
        <span className="text-right">Unidades</span>
        <span className="text-right">U/H</span>
        <span className="text-right">{showCompliance ? 'Cumpl. %' : 'Detalle'}</span>
      </div>
      <div className="space-y-5">
        {ranking.map((row, idx) => {
          const rank = rankOffset + idx + 1;
          return (
            <div
              key={`${row.name}-${rank}`}
              className={`grid grid-cols-[5rem_minmax(0,2.4fr)_repeat(3,minmax(7rem,0.85fr))] gap-x-8 items-center rounded-3xl px-6 py-7 border ${
                rank === 1
                  ? 'bg-amber-500/10 border-amber-500/40'
                  : 'bg-slate-900/70 border-slate-800'
              }`}
            >
              <span
                className={`w-16 h-16 rounded-full flex items-center justify-center font-black text-3xl shrink-0 ${
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
              <div className="min-w-0 pr-2">
                <div className="text-4xl xl:text-5xl font-extrabold text-slate-100 leading-tight break-words whitespace-normal">
                  {row.name}
                </div>
                {row.meta ? (
                  <div className="text-xl text-slate-500 font-semibold mt-2 break-words whitespace-normal leading-snug">
                    {row.meta}
                  </div>
                ) : null}
              </div>
              <div className="text-5xl font-black text-right tabular-nums">{fmt(row.units)}</div>
              <div className="text-5xl font-black text-right tabular-nums text-sky-300">
                {fmt(row.productivity, 1)}
              </div>
              <div className="text-5xl font-black text-right tabular-nums">
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
    <div className="w-full h-full flex flex-col">
      <h2 className="text-5xl font-black tracking-tight text-slate-100 mb-2 flex items-center gap-4">
        <Trophy className="w-12 h-12 text-amber-400 shrink-0" />
        Resumen operación bodega · Hoy
      </h2>
      <p className="text-lg text-slate-500 font-semibold mb-6 max-w-5xl leading-snug">
        Recursos activos = personas únicas (sin repetir entre áreas). Cumplimiento = empaque ponderado
        por unidades.
      </p>

      <div className="grid grid-cols-3 gap-6 mb-8">
        <div className="rounded-3xl border border-slate-700 bg-slate-900/80 px-8 py-7 text-center">
          <div className="text-xl uppercase tracking-widest text-slate-400 font-bold mb-2">
            Unidades totales
          </div>
          <div className="text-7xl font-black text-blue-400 leading-none">
            {fmt(data.summary.totalUnits)}
          </div>
        </div>
        <div className="rounded-3xl border border-slate-700 bg-slate-900/80 px-8 py-7 text-center">
          <div className="text-xl uppercase tracking-widest text-slate-400 font-bold mb-2">
            Cumplimiento medio
          </div>
          <div className="text-7xl font-black text-emerald-400 leading-none">
            {fmt(data.summary.avgCompliance, 0)}%
          </div>
        </div>
        <div className="rounded-3xl border border-slate-700 bg-slate-900/80 px-8 py-7 text-center">
          <div className="text-xl uppercase tracking-widest text-slate-400 font-bold mb-2">
            Recursos activos
          </div>
          <div className="text-7xl font-black text-violet-400 leading-none">
            {fmt(data.summary.operators)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-5 flex-1 min-h-0">
        {data.areas.map((area) => {
          const Icon = AREA_ICON[area.key];
          return (
            <div
              key={area.key}
              className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6 flex flex-col min-h-0"
            >
              <div className="flex items-center gap-3 mb-5">
                <Icon className={`w-10 h-10 shrink-0 ${AREA_ACCENT[area.key]}`} />
                <span className={`text-3xl font-black leading-tight ${AREA_ACCENT[area.key]}`}>
                  {area.title}
                </span>
              </div>
              <div className="text-6xl font-black text-slate-100 mb-1 leading-none">
                {fmt(area.units)}
              </div>
              <div className="text-xl text-slate-400 font-semibold mb-5">unidades hoy</div>
              <div className="mt-auto space-y-3 text-2xl">
                <div className="flex justify-between gap-3">
                  <span className="text-slate-500 flex items-center gap-2">
                    <Gauge className="w-5 h-5" /> U/H
                  </span>
                  <span className="font-bold tabular-nums">{fmt(area.productivity, 1)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-slate-500 flex items-center gap-2">
                    <Users className="w-5 h-5" /> Pers.
                  </span>
                  <span className="font-bold tabular-nums">{fmt(area.operators)}</span>
                </div>
                {typeof area.compliance === 'number' ? (
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-500">Cumpl.</span>
                    <span className="font-bold tabular-nums">{fmt(area.compliance, 0)}%</span>
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
  const showCompliance = area.key === 'empaque';
  const rankOffset = pageIndex * BODEGA_TV_PAGE_SIZE;
  // Solo chips cortos en TV; el resto satura y empuja el ranking.
  const tvExtras = (area.extras || []).filter((ex) =>
    ['Personas', 'Grupos', 'Jornada', 'Pausas', 'Horas', 'Horas prod.', 'Interno', 'Externo'].includes(
      ex.label
    )
  );

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="flex items-end justify-between mb-5 gap-6 shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-4 mb-2">
            <Icon className={`w-12 h-12 shrink-0 ${AREA_ACCENT[area.key]}`} />
            <h2 className={`text-6xl font-black tracking-tight leading-none ${AREA_ACCENT[area.key]}`}>
              {area.title}
            </h2>
          </div>
          <p className="text-2xl text-slate-400 font-semibold">
            Ranking · día en curso
            {pageCount > 1 ? ` · página ${pageIndex + 1}/${pageCount}` : ''}
          </p>
        </div>
        <div className="flex gap-4 shrink-0">
          <div className="rounded-2xl border border-slate-700 bg-slate-900/80 px-6 py-4 text-center min-w-[150px]">
            <div className="text-sm uppercase tracking-widest text-slate-500 font-bold">Unidades</div>
            <div className="text-4xl font-black text-slate-100 tabular-nums">{fmt(area.units)}</div>
          </div>
          <div className="rounded-2xl border border-slate-700 bg-slate-900/80 px-6 py-4 text-center min-w-[150px]">
            <div className="text-sm uppercase tracking-widest text-slate-500 font-bold">U/H</div>
            <div className="text-4xl font-black text-sky-300 tabular-nums">
              {fmt(area.productivity, 1)}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-700 bg-slate-900/80 px-6 py-4 text-center min-w-[150px]">
            <div className="text-sm uppercase tracking-widest text-slate-500 font-bold">Pers.</div>
            <div className="text-4xl font-black text-violet-300 tabular-nums">
              {fmt(area.operators)}
            </div>
          </div>
          {typeof area.compliance === 'number' ? (
            <div className="rounded-2xl border border-slate-700 bg-slate-900/80 px-6 py-4 text-center min-w-[150px]">
              <div className="text-sm uppercase tracking-widest text-slate-500 font-bold">Cumpl.</div>
              <div className="text-4xl font-black text-emerald-400 tabular-nums">
                {fmt(area.compliance, 0)}%
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {tvExtras.length > 0 ? (
        <div className="flex flex-wrap gap-3 mb-4 shrink-0">
          {tvExtras.map((ex) => (
            <div
              key={ex.label}
              className="rounded-full border border-slate-700 bg-slate-900/60 px-5 py-2 text-lg max-w-full"
            >
              <span className="text-slate-500 font-semibold mr-2">{ex.label}:</span>
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

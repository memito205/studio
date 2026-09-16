'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { getBodegaTvSnapshot } from '@/app/bodegaTvActions';
import type { BodegaTvMode, BodegaTvSnapshot } from '@/lib/bodegaTvTypes';
import {
  BodegaAreaDetailSlide,
  BodegaAreaHourlySlide,
  BodegaOverviewSlide,
  BodegaRecepcionOpsSlide,
  BodegaRemainderAssignmentsSlide,
  BODEGA_TV_CORE_AREA_KEYS,
  BODEGA_TV_PAGE_SIZE,
  HOURLY_PAGE_SIZE,
  RECEPTION_OPS_PAGE_SIZE,
  REMAINDER_PAGE_SIZE,
} from './bodega/BodegaTvSlides';

const SLIDE_DURATION_MS = 7000;
const DATA_SYNC_INTERVAL = 45 * 1000;

export default function BodegaTvBoard({ mode = 'full' }: { mode?: BodegaTvMode }) {
  const [data, setData] = useState<BodegaTvSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const fetchSnapshot = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await getBodegaTvSnapshot({ mode });
      if (result.success && result.data) {
        setData(result.data);
        setError(null);
        setLastSyncedAt(new Date());
      } else {
        setError(result.error || 'Sin datos');
      }
    } catch (e: any) {
      console.error(e);
      setError(e?.message || 'Error de sincronización');
    } finally {
      setIsLoading(false);
    }
  }, [mode]);

  useEffect(() => {
    fetchSnapshot();
    const id = setInterval(fetchSnapshot, DATA_SYNC_INTERVAL);
    return () => clearInterval(id);
  }, [fetchSnapshot]);

  const slides = useMemo(() => {
    if (!data) return [] as React.ReactNode[];
    const coreKeySet = new Set<string>(BODEGA_TV_CORE_AREA_KEYS);
    const coreAreas = data.areas.filter((a) => coreKeySet.has(a.key));
    const extraAreas = data.areas.filter((a) => !coreKeySet.has(a.key));

    const nodes: React.ReactNode[] = [
      <BodegaOverviewSlide
        key="overview"
        data={data}
        areas={mode === 'externos' ? data.areas : coreAreas}
        summaryMode={mode === 'externos' ? 'global' : 'local'}
      />,
    ];

    // Slide complementario (Ventas x Mayor, etc.) — solo TV completa.
    if (mode === 'full' && extraAreas.length > 0) {
      nodes.push(
        <BodegaOverviewSlide
          key="overview-extra"
          data={data}
          areas={extraAreas}
          title="Resumen · Ventas y otros · Hoy"
          subtitle="Módulos complementarios · misma jornada · sin mezclar con el resumen principal"
          summaryMode="local"
        />
      );
    }

    // Remanentes solo en TV completa (no en monitor de externos).
    if (mode === 'full') {
      const assignments = data.remainderAssignments || [];
      const remainderPages =
        assignments.length === 0 ? 1 : Math.max(1, Math.ceil(assignments.length / REMAINDER_PAGE_SIZE));
      for (let pageIndex = 0; pageIndex < remainderPages; pageIndex++) {
        const pageRows =
          assignments.length === 0
            ? []
            : assignments.slice(
                pageIndex * REMAINDER_PAGE_SIZE,
                pageIndex * REMAINDER_PAGE_SIZE + REMAINDER_PAGE_SIZE
              );
        nodes.push(
          <BodegaRemainderAssignmentsSlide
            key={`remainder-p${pageIndex}`}
            rows={pageRows}
            pageIndex={pageIndex}
            pageCount={remainderPages}
          />
        );
      }
    }

    for (const area of data.areas) {
      // Recepción: resumen por operación (pueden ir varias en paralelo) antes del ranking.
      if (area.key === 'recepcion') {
        const ops = area.receptionOps || [];
        const opsPageCount = Math.max(1, Math.ceil(Math.max(ops.length, 1) / RECEPTION_OPS_PAGE_SIZE));
        for (let pageIndex = 0; pageIndex < opsPageCount; pageIndex++) {
          const opsPage = ops.slice(
            pageIndex * RECEPTION_OPS_PAGE_SIZE,
            pageIndex * RECEPTION_OPS_PAGE_SIZE + RECEPTION_OPS_PAGE_SIZE
          );
          nodes.push(
            <BodegaRecepcionOpsSlide
              key={`recepcion-ops-p${pageIndex}`}
              area={area}
              opsPage={opsPage}
              pageIndex={pageIndex}
              pageCount={opsPageCount}
            />
          );
        }
      }

      const ranking = area.ranking || [];
      const pageCount = Math.max(1, Math.ceil(ranking.length / BODEGA_TV_PAGE_SIZE));
      for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
        const rankingPage = ranking.slice(
          pageIndex * BODEGA_TV_PAGE_SIZE,
          pageIndex * BODEGA_TV_PAGE_SIZE + BODEGA_TV_PAGE_SIZE
        );
        nodes.push(
          <BodegaAreaDetailSlide
            key={`area-${area.key}-p${pageIndex}`}
            area={area}
            rankingPage={rankingPage}
            pageIndex={pageIndex}
            pageCount={pageCount}
          />
        );
      }

      // Solo Monitor Live Externos: productividad por horas (und + U/H).
      if (mode === 'externos') {
        const hourly = area.hourlyBuckets || [];
        const hourlyPages = Math.max(1, Math.ceil(Math.max(hourly.length, 1) / HOURLY_PAGE_SIZE));
        for (let pageIndex = 0; pageIndex < hourlyPages; pageIndex++) {
          const pageBuckets = hourly.slice(
            pageIndex * HOURLY_PAGE_SIZE,
            pageIndex * HOURLY_PAGE_SIZE + HOURLY_PAGE_SIZE
          );
          nodes.push(
            <BodegaAreaHourlySlide
              key={`hourly-${area.key}-p${pageIndex}`}
              area={area}
              buckets={pageBuckets}
              pageIndex={pageIndex}
              pageCount={hourlyPages}
            />
          );
        }
      }
    }

    return nodes;
  }, [data, mode]);

  useEffect(() => {
    if (slides.length <= 1) return;
    const id = setInterval(() => {
      setCurrentSlideIndex((prev) => (prev + 1) % slides.length);
    }, SLIDE_DURATION_MS);
    return () => clearInterval(id);
  }, [slides.length]);

  // No reiniciar al slide 0 en cada sync (eso hacía que Físico vs Distribución casi no se viera).
  useEffect(() => {
    setCurrentSlideIndex((prev) => {
      if (slides.length === 0) return 0;
      return prev >= slides.length ? 0 : prev;
    });
  }, [slides.length]);

  const isExternos = mode === 'externos';
  const titleAccent = isExternos ? 'text-violet-400' : 'text-emerald-400';
  const badgeClass = isExternos
    ? 'bg-violet-500/15 border-violet-500/30 text-violet-300'
    : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300';
  const syncAccent = isExternos ? 'text-violet-400' : 'text-emerald-400';

  return (
    <div
      className={[
        'bodega-tv-root h-[100dvh] w-[100dvw] bg-slate-950 text-slate-100 font-sans flex flex-col',
        // Móvil: scroll; PC/TV (≥768px): kiosk fullscreen sin scroll (igual que antes).
        'overflow-y-auto md:overflow-hidden',
        // Tipografía nítida por viewport (sin transform:scale → evita blur en Chromecast).
        'max-md:[font-size:clamp(13px,3.6vw,16px)] md:[font-size:clamp(20px,2.65vmin,42px)]',
      ].join(' ')}
    >
      <header className="flex flex-col md:flex-row md:justify-between md:items-center shrink-0 px-[2.2vmin] pt-[1.6vmin] pb-[1.2vmin] gap-[1vmin] md:gap-[2vmin]">
        <div className="flex flex-wrap items-center gap-[0.8vmin] md:gap-[1.4vmin] min-w-0">
          {isExternos ? (
            <h1 className="text-[1.55em] md:text-[2.2em] font-black tracking-tight text-white whitespace-normal md:whitespace-nowrap leading-none">
              MONITOR LIVE <span className={`${titleAccent} font-black`}>EXTERNOS</span>
            </h1>
          ) : (
            <h1 className="text-[1.85em] md:text-[2.6em] font-black tracking-tight text-emerald-400 whitespace-normal md:whitespace-nowrap leading-none">
              BODEGA<span className="text-white font-light ml-[0.35em]">LIVE</span>
            </h1>
          )}
          {isLoading ? (
            <RefreshCw className={`w-[1.2em] h-[1.2em] animate-spin ${syncAccent} shrink-0`} />
          ) : null}
          <div className={`px-[0.8em] py-[0.35em] rounded-lg border text-[0.85em] font-bold whitespace-nowrap ${badgeClass}`}>
            HOY {data?.dayKey || '—'}
          </div>
        </div>

        <button
          type="button"
          onClick={() => void fetchSnapshot()}
          className="flex items-center self-stretch md:self-auto justify-center bg-slate-900/90 px-[1.1em] py-[0.55em] rounded-full border border-slate-700 hover:bg-slate-800 transition-colors shrink-0"
        >
          <Clock className="w-[1em] h-[1em] text-slate-400 mr-[0.55em]" />
          <span className="text-[0.95em] font-medium whitespace-nowrap text-slate-300">
            Corte: {lastSyncedAt ? format(lastSyncedAt, 'hh:mm a', { locale: es }) : '---'}
          </span>
          <span className={`ml-[0.8em] pl-[0.8em] border-l border-slate-700 text-[0.7em] font-bold uppercase tracking-widest ${syncAccent}`}>
            Sincronizar
          </span>
        </button>
      </header>

      <main className="flex-1 min-h-0 relative px-[2.2vmin] pb-[0.6vmin] max-md:min-h-[70dvh]">
        {!data && isLoading ? (
          <div className="h-full flex flex-col items-center justify-center gap-[1em] text-slate-400">
            <RefreshCw className={`w-[2em] h-[2em] animate-spin ${syncAccent}`} />
            <p className="text-[1.4em] font-semibold">
              {isExternos ? 'Cargando monitor de externos…' : 'Cargando operación de bodega…'}
            </p>
          </div>
        ) : error && !data ? (
          <div className="h-full flex items-center justify-center text-[1.5em] text-red-400 font-bold px-[2em] text-center">
            {error}
          </div>
        ) : (
          slides.map((slide, idx) => (
            <div
              key={idx}
              className={`absolute inset-x-[2.2vmin] inset-y-0 overflow-y-auto md:overflow-hidden transition-opacity duration-500 ${
                idx === currentSlideIndex ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'
              }`}
            >
              {slide}
            </div>
          ))
        )}
      </main>

      <footer className="shrink-0 flex flex-col-reverse gap-[0.6em] md:flex-row md:items-center md:justify-between px-[2.2vmin] pb-[1.4vmin] pt-[0.8vmin]">
        <div className="flex gap-[0.55em] flex-wrap max-w-full md:max-w-[70%]">
          {slides.map((_, idx) => (
            <div
              key={idx}
              className={`h-[0.45em] rounded-full transition-all ${
                idx === currentSlideIndex
                  ? `w-[1.8em] ${isExternos ? 'bg-violet-400' : 'bg-emerald-400'}`
                  : 'w-[0.45em] bg-slate-700'
              }`}
            />
          ))}
        </div>
        <div className="text-[0.7em] font-bold uppercase tracking-widest text-slate-500">
          Slide {slides.length ? currentSlideIndex + 1 : 0} / {slides.length} · 7s · sync 45s
        </div>
      </footer>
    </div>
  );
}

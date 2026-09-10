'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { getBodegaTvSnapshot } from '@/app/bodegaTvActions';
import type { BodegaTvSnapshot } from '@/lib/bodegaTvTypes';
import {
  BodegaAreaDetailSlide,
  BodegaOverviewSlide,
  BodegaRemainderAssignmentsSlide,
  BODEGA_TV_PAGE_SIZE,
  REMAINDER_PAGE_SIZE,
} from './bodega/BodegaTvSlides';

const SLIDE_DURATION_MS = 5000;
const DATA_SYNC_INTERVAL = 45 * 1000;

export default function BodegaTvBoard() {
  const [data, setData] = useState<BodegaTvSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const fetchSnapshot = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await getBodegaTvSnapshot();
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
  }, []);

  useEffect(() => {
    fetchSnapshot();
    const id = setInterval(fetchSnapshot, DATA_SYNC_INTERVAL);
    return () => clearInterval(id);
  }, [fetchSnapshot]);

  const slides = useMemo(() => {
    if (!data) return [] as React.ReactNode[];
    const nodes: React.ReactNode[] = [<BodegaOverviewSlide key="overview" data={data} />];

    for (const area of data.areas) {
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
    }

    const assignments = data.remainderAssignments || [];
    if (assignments.length > 0) {
      const pageCount = Math.max(1, Math.ceil(assignments.length / REMAINDER_PAGE_SIZE));
      for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
        const pageRows = assignments.slice(
          pageIndex * REMAINDER_PAGE_SIZE,
          pageIndex * REMAINDER_PAGE_SIZE + REMAINDER_PAGE_SIZE
        );
        nodes.push(
          <BodegaRemainderAssignmentsSlide
            key={`remainder-p${pageIndex}`}
            rows={pageRows}
            pageIndex={pageIndex}
            pageCount={pageCount}
          />
        );
      }
    }

    return nodes;
  }, [data]);

  useEffect(() => {
    if (slides.length <= 1) return;
    const id = setInterval(() => {
      setCurrentSlideIndex((prev) => (prev + 1) % slides.length);
    }, SLIDE_DURATION_MS);
    return () => clearInterval(id);
  }, [slides.length]);

  useEffect(() => {
    setCurrentSlideIndex(0);
  }, [data?.generatedAt]);

  return (
    <div
      className="bodega-tv-root h-[100dvh] w-[100dvw] overflow-hidden bg-slate-950 text-slate-100 font-sans flex flex-col"
      style={{
        // Tipografía nítida por viewport (sin transform:scale → evita blur en Chromecast).
        // Base alta para TV / cast: el contenido llena la pantalla con rem relativos.
        fontSize: 'clamp(20px, 2.65vmin, 42px)',
      }}
    >
      <header className="flex justify-between items-center shrink-0 px-[2.2vmin] pt-[1.6vmin] pb-[1.2vmin] gap-[2vmin]">
        <div className="flex items-center gap-[1.4vmin] min-w-0">
          <h1 className="text-[2.6em] font-black tracking-tight text-emerald-400 whitespace-nowrap leading-none">
            BODEGA<span className="text-white font-light ml-[0.35em]">LIVE</span>
          </h1>
          {isLoading ? (
            <RefreshCw className="w-[1.2em] h-[1.2em] animate-spin text-emerald-400 shrink-0" />
          ) : null}
          <div className="bg-emerald-500/15 px-[0.8em] py-[0.35em] rounded-lg border border-emerald-500/30 text-emerald-300 text-[0.85em] font-bold whitespace-nowrap">
            HOY {data?.dayKey || '—'}
          </div>
        </div>

        <button
          type="button"
          onClick={() => void fetchSnapshot()}
          className="flex items-center bg-slate-900/90 px-[1.1em] py-[0.55em] rounded-full border border-slate-700 hover:bg-slate-800 transition-colors shrink-0"
        >
          <Clock className="w-[1em] h-[1em] text-slate-400 mr-[0.55em]" />
          <span className="text-[0.95em] font-medium whitespace-nowrap text-slate-300">
            Corte: {lastSyncedAt ? format(lastSyncedAt, 'hh:mm a', { locale: es }) : '---'}
          </span>
          <span className="ml-[0.8em] pl-[0.8em] border-l border-slate-700 text-[0.7em] font-bold text-emerald-400 uppercase tracking-widest">
            Sincronizar
          </span>
        </button>
      </header>

      <main className="flex-1 min-h-0 relative px-[2.2vmin] pb-[0.6vmin]">
        {!data && isLoading ? (
          <div className="h-full flex flex-col items-center justify-center gap-[1em] text-slate-400">
            <RefreshCw className="w-[2em] h-[2em] animate-spin text-emerald-400" />
            <p className="text-[1.4em] font-semibold">Cargando operación de bodega…</p>
          </div>
        ) : error && !data ? (
          <div className="h-full flex items-center justify-center text-[1.5em] text-red-400 font-bold px-[2em] text-center">
            {error}
          </div>
        ) : (
          slides.map((slide, idx) => (
            <div
              key={idx}
              className={`absolute inset-x-[2.2vmin] inset-y-0 transition-opacity duration-500 ${
                idx === currentSlideIndex ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'
              }`}
            >
              {slide}
            </div>
          ))
        )}
      </main>

      <footer className="shrink-0 flex items-center justify-between px-[2.2vmin] pb-[1.4vmin] pt-[0.8vmin]">
        <div className="flex gap-[0.55em] flex-wrap max-w-[70%]">
          {slides.map((_, idx) => (
            <div
              key={idx}
              className={`h-[0.45em] rounded-full transition-all ${
                idx === currentSlideIndex ? 'w-[1.8em] bg-emerald-400' : 'w-[0.45em] bg-slate-700'
              }`}
            />
          ))}
        </div>
        <div className="text-[0.7em] font-bold uppercase tracking-widest text-slate-500">
          Slide {slides.length ? currentSlideIndex + 1 : 0} / {slides.length} · 5s · sync 45s
        </div>
      </footer>
    </div>
  );
}

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
  BODEGA_TV_PAGE_SIZE,
} from './bodega/BodegaTvSlides';

const SLIDE_DURATION_MS = 5000;
const DATA_SYNC_INTERVAL = 45 * 1000;
const DESIGN_W = 1920;
const DESIGN_H = 1080;

function useTvFitScale(baseW = DESIGN_W, baseH = DESIGN_H) {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const update = () => {
      const next = Math.min(window.innerWidth / baseW, window.innerHeight / baseH);
      setScale(Number.isFinite(next) && next > 0 ? next : 1);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [baseW, baseH]);

  return scale;
}

export default function BodegaTvBoard() {
  const scale = useTvFitScale();
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
    <div className="h-screen w-screen overflow-hidden bg-black flex items-center justify-center">
      <div
        className="relative bg-slate-950 text-slate-100 font-sans overflow-hidden shadow-2xl"
        style={{
          width: DESIGN_W,
          height: DESIGN_H,
          transform: `scale(${scale})`,
          transformOrigin: 'center center',
        }}
      >
        <div className="flex flex-col h-full w-full overflow-hidden px-12 py-8">
          <header className="flex justify-between items-center mb-6 shrink-0">
            <div className="flex items-center gap-4 min-w-0">
              <h1 className="text-5xl font-black tracking-tight text-emerald-400 drop-shadow-lg whitespace-nowrap">
                BODEGA<span className="text-white font-light ml-2">LIVE</span>
              </h1>
              {isLoading ? <RefreshCw className="w-8 h-8 animate-spin text-emerald-400 shrink-0" /> : null}
              <div className="bg-emerald-500/15 px-4 py-1.5 rounded-lg border border-emerald-500/30 text-emerald-300 text-lg font-bold whitespace-nowrap">
                HOY {data?.dayKey || '—'}
              </div>
            </div>

            <button
              type="button"
              onClick={() => void fetchSnapshot()}
              className="flex items-center bg-slate-900/80 backdrop-blur-md px-6 py-3 rounded-full border border-slate-800 shadow-xl cursor-pointer hover:bg-slate-800 transition-colors shrink-0"
            >
              <Clock className="w-6 h-6 text-slate-400 mr-3" />
              <span className="text-xl font-medium whitespace-nowrap text-slate-300">
                Corte: {lastSyncedAt ? format(lastSyncedAt, 'hh:mm a', { locale: es }) : '---'}
              </span>
              <span className="ml-4 pl-4 border-l border-slate-700 text-sm font-bold text-emerald-400 uppercase tracking-widest">
                Sincronizar
              </span>
            </button>
          </header>

          <main className="flex-1 min-h-0 relative">
            {!data && isLoading ? (
              <div className="h-full flex flex-col items-center justify-center gap-4 text-slate-400">
                <RefreshCw className="w-14 h-14 animate-spin text-emerald-400" />
                <p className="text-3xl font-semibold">Cargando operación de bodega…</p>
              </div>
            ) : error && !data ? (
              <div className="h-full flex items-center justify-center text-3xl text-red-400 font-bold px-8 text-center">
                {error}
              </div>
            ) : (
              slides.map((slide, idx) => (
                <div
                  key={idx}
                  className={`absolute inset-0 transition-opacity duration-500 ${
                    idx === currentSlideIndex ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'
                  }`}
                >
                  {slide}
                </div>
              ))
            )}
          </main>

          <footer className="mt-5 flex items-center justify-between shrink-0">
            <div className="flex gap-2.5 flex-wrap max-w-[70%]">
              {slides.map((_, idx) => (
                <div
                  key={idx}
                  className={`h-3 rounded-full transition-all ${
                    idx === currentSlideIndex ? 'w-10 bg-emerald-400' : 'w-3 bg-slate-700'
                  }`}
                />
              ))}
            </div>
            <div className="text-base font-bold uppercase tracking-widest text-slate-500">
              Slide {slides.length ? currentSlideIndex + 1 : 0} / {slides.length} · 5s · sync 45s
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}

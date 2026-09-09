"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { getBodegaTvSnapshot } from '@/app/bodegaTvActions';
import type { BodegaTvSnapshot } from '@/lib/bodegaTvTypes';
import { BodegaAreaDetailSlide, BodegaOverviewSlide } from './bodega/BodegaTvSlides';

const SLIDE_DURATION = 12000;
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
    return [
      <BodegaOverviewSlide key="overview" data={data} />,
      ...data.areas.map((area) => (
        <BodegaAreaDetailSlide key={`area-${area.key}`} area={area} />
      )),
    ];
  }, [data]);

  useEffect(() => {
    if (slides.length <= 1) return;
    const id = setInterval(() => {
      setCurrentSlideIndex((prev) => (prev + 1) % slides.length);
    }, SLIDE_DURATION);
    return () => clearInterval(id);
  }, [slides.length]);

  useEffect(() => {
    setCurrentSlideIndex(0);
  }, [data?.generatedAt]);

  return (
    <div className="flex flex-col h-full w-full overflow-hidden p-10 lg:p-14 font-sans relative bg-slate-950 text-slate-100">
      <header className="flex justify-between items-center mb-8 px-2 shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-5xl font-black tracking-tight text-emerald-400 drop-shadow-lg text-nowrap">
            BODEGA<span className="text-white font-light ml-2">LIVE</span>
          </h1>
          {isLoading ? <RefreshCw className="w-7 h-7 animate-spin text-emerald-400" /> : null}
          <div className="bg-emerald-500/15 px-3 py-1 rounded-lg border border-emerald-500/30 text-emerald-300 text-sm font-bold">
            HOY {data?.dayKey || '—'}
          </div>
        </div>

        <button
          type="button"
          onClick={() => void fetchSnapshot()}
          className="flex items-center bg-slate-900/80 backdrop-blur-md px-6 py-3 rounded-full border border-slate-800 shadow-xl cursor-pointer hover:bg-slate-800 transition-colors"
        >
          <Clock className="w-6 h-6 text-slate-400 mr-3" />
          <span className="text-xl font-medium text-nowrap text-slate-300">
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
            <RefreshCw className="w-12 h-12 animate-spin text-emerald-400" />
            <p className="text-2xl font-semibold">Cargando operación de bodega…</p>
          </div>
        ) : error && !data ? (
          <div className="h-full flex items-center justify-center text-2xl text-red-400 font-bold">
            {error}
          </div>
        ) : (
          slides.map((slide, idx) => (
            <div
              key={idx}
              className={`absolute inset-0 transition-opacity duration-700 ${
                idx === currentSlideIndex ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'
              }`}
            >
              {slide}
            </div>
          ))
        )}
      </main>

      <footer className="mt-6 flex items-center justify-between shrink-0 px-2">
        <div className="flex gap-2">
          {slides.map((_, idx) => (
            <div
              key={idx}
              className={`h-2.5 rounded-full transition-all ${
                idx === currentSlideIndex ? 'w-10 bg-emerald-400' : 'w-2.5 bg-slate-700'
              }`}
            />
          ))}
        </div>
        <div className="text-sm font-bold uppercase tracking-widest text-slate-500">
          Slide {slides.length ? currentSlideIndex + 1 : 0} / {slides.length} · rotación 12s · sync 45s
        </div>
      </footer>
    </div>
  );
}

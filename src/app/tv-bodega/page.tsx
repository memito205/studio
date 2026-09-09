import React from 'react';
import BodegaTvBoard from '@/components/tv-board/BodegaTvBoard';

export const metadata = {
  title: 'Tablero TV - Operación Bodega',
  description: 'Panel kiosk unificado: empaque, etiquetado, tallado y recepción',
};

export default function TvBodegaPage() {
  return (
    <div className="min-h-screen w-full bg-black flex items-center justify-center font-sans overflow-hidden">
      <div className="w-full max-h-screen aspect-video max-w-[calc(100vh*16/9)] relative bg-slate-950 text-white shadow-2xl overflow-hidden ring-1 ring-slate-800">
        <BodegaTvBoard />
      </div>
    </div>
  );
}

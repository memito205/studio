import React from 'react';
import EcommerceTvBoard from '@/components/tv-board/EcommerceTvBoard';

export const metadata = {
  title: 'Tablero TV - Ecommerce',
  description: 'Panel de visualización Kiosk TV para la operación de Ecommerce',
};

export default function TvEcommercePage() {
  return (
    <div className="min-h-screen w-full bg-black flex items-center justify-center font-sans overflow-hidden">
      <div className="w-full max-h-screen aspect-video max-w-[calc(100vh*16/9)] relative bg-slate-950 text-white shadow-2xl overflow-hidden ring-1 ring-slate-800">
        <EcommerceTvBoard />
      </div>
    </div>
  );
}

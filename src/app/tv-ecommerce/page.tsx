import React from 'react';
import EcommerceTvBoard from '@/components/tv-board/EcommerceTvBoard';

export const metadata = {
  title: 'Tablero TV - Ecommerce',
  description: 'Panel de visualización Kiosk TV para la operación de Ecommerce',
};

export default function TvEcommercePage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white font-sans overflow-hidden">
      <EcommerceTvBoard />
    </div>
  );
}

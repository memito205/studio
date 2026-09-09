import React from 'react';
import BodegaTvBoard from '@/components/tv-board/BodegaTvBoard';

export const metadata = {
  title: 'Tablero TV - Operación Bodega',
  description: 'Panel kiosk unificado: empaque, etiquetado, tallado y recepción',
};

export default function TvBodegaPage() {
  return (
    <div className="h-screen w-screen bg-black overflow-hidden">
      <BodegaTvBoard />
    </div>
  );
}

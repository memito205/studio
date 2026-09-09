import React from 'react';
import BodegaTvBoard from '@/components/tv-board/BodegaTvBoard';

export const metadata = {
  title: 'Tablero TV - Operación Bodega',
  description: 'Panel kiosk unificado: empaque, etiquetado, tallado y recepción',
};

export default function TvBodegaPage() {
  return (
    <main className="h-[100dvh] w-[100dvw] overflow-hidden bg-black">
      <BodegaTvBoard />
    </main>
  );
}

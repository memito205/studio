import React from 'react';
import BodegaTvBoard from '@/components/tv-board/BodegaTvBoard';

export const metadata = {
  title: 'Monitor Live Externos',
  description: 'Kiosk: tallado y etiquetado externo del día',
};

export default function TvBodegaExternosPage() {
  return (
    <main className="h-[100dvh] w-[100dvw] overflow-hidden bg-black">
      <BodegaTvBoard mode="externos" />
    </main>
  );
}

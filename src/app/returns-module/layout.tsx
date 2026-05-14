import type { ReactNode } from 'react';

/** Límite y runtime para server actions invocadas desde esta ruta (ingesta puede ser pesada). */
export const maxDuration = 120;
export const runtime = 'nodejs';

export default function ReturnsModuleLayout({ children }: { children: ReactNode }) {
  return children;
}

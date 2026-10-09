'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, Info, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { playScanSound } from '@/lib/scanSound';

export type ScanFlashType = 'success' | 'warning' | 'duplicate' | 'error' | 'multi-session' | 'out-of-plan';

export type ScanFlashResult = {
  type: ScanFlashType;
  message: string;
  code: string;
  detail?: string;
};

const STYLE: Record<ScanFlashType, { bg: string; ms: number; tone: 'ok' | 'warn' | 'bad'; Icon: React.ElementType }> = {
  success: { bg: 'bg-green-600', ms: 1300, tone: 'ok', Icon: CheckCircle2 },
  warning: { bg: 'bg-blue-700', ms: 2800, tone: 'warn', Icon: Info },
  'out-of-plan': { bg: 'bg-blue-700', ms: 2800, tone: 'warn', Icon: Info },
  'multi-session': { bg: 'bg-amber-600', ms: 3500, tone: 'warn', Icon: AlertTriangle },
  duplicate: { bg: 'bg-orange-600', ms: 3500, tone: 'bad', Icon: Copy },
  error: { bg: 'bg-red-700', ms: 4500, tone: 'bad', Icon: XCircle },
};

export const SCAN_PANEL_CLASS: Record<ScanFlashType, string> = {
  success: 'bg-green-50 border-green-600 text-green-800',
  warning: 'bg-blue-50 border-blue-700 text-blue-950',
  'out-of-plan': 'bg-blue-50 border-blue-700 text-blue-950',
  'multi-session': 'bg-amber-50 border-amber-700 text-amber-950',
  duplicate: 'bg-orange-50 border-orange-600 text-orange-800',
  error: 'bg-red-50 border-red-600 text-red-800',
};

function playTone(tone: 'ok' | 'warn' | 'bad') {
  playScanSound(tone === 'bad' ? 'alarm' : tone);
}

/** Aviso grande a pantalla completa tras cada lectura; no toma el foco, se puede seguir leyendo. */
export function ScanResultFlash({ result }: { result: ScanFlashResult | null }) {
  const [shown, setShown] = useState<ScanFlashResult | null>(null);

  useEffect(() => {
    if (!result) return;
    const style = STYLE[result.type];
    setShown(result);
    playTone(style.tone);
    const timer = setTimeout(() => setShown(null), style.ms);
    return () => clearTimeout(timer);
  }, [result]);

  if (!shown) return null;
  const { bg, Icon } = STYLE[shown.type];
  return (
    <div className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center p-6">
      <div className={cn('w-full max-w-4xl rounded-2xl px-8 py-10 text-center text-white shadow-2xl ring-8 ring-white/40', bg)}>
        <Icon className="mx-auto h-24 w-24" />
        <p className="mt-4 text-4xl font-black uppercase leading-tight md:text-6xl">{shown.message}</p>
        <p className="mt-4 font-mono text-2xl font-bold md:text-4xl">{shown.code}</p>
        {shown.detail && <p className="mt-4 text-xl font-semibold md:text-3xl">{shown.detail}</p>}
      </div>
    </div>
  );
}

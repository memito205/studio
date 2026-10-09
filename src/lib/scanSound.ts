'use client';

/**
 * Sonidos de lectura para toda la suite:
 * - ok: beep corto agudo (lectura aceptada)
 * - warn: doble beep medio (aviso que no bloquea)
 * - alarm: sirena (error que exige atención: no existe, duplicada, destino/ubicación incorrecta…)
 */
export type ScanSoundKind = 'ok' | 'warn' | 'alarm';

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  audioCtx = audioCtx || new Ctx();
  if (audioCtx.state === 'suspended') void audioCtx.resume().catch(() => undefined);
  return audioCtx;
}

function beep(ctx: AudioContext, start: number, freq: number, dur: number, type: OscillatorType, vol: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(vol, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

function siren(ctx: AudioContext, start: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sawtooth';
  const cycles = 3;
  const half = 0.28;
  osc.frequency.setValueAtTime(650, start);
  for (let i = 0; i < cycles; i++) {
    const t = start + i * half * 2;
    osc.frequency.linearRampToValueAtTime(1500, t + half);
    osc.frequency.linearRampToValueAtTime(650, t + half * 2);
  }
  const end = start + cycles * half * 2;
  gain.gain.setValueAtTime(0.32, start);
  gain.gain.setValueAtTime(0.32, end - 0.05);
  gain.gain.linearRampToValueAtTime(0.0001, end);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(end + 0.02);
}

export function playScanSound(kind: ScanSoundKind): void {
  try {
    const ctx = getCtx();
    if (!ctx) return;
    const t = ctx.currentTime + 0.01;
    if (kind === 'ok') {
      beep(ctx, t, 1250, 0.13, 'sine', 0.3);
    } else if (kind === 'warn') {
      beep(ctx, t, 760, 0.16, 'square', 0.18);
      beep(ctx, t + 0.24, 760, 0.16, 'square', 0.18);
    } else {
      siren(ctx, t);
    }
  } catch {
    /* sin audio */
  }
}

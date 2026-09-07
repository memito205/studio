'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';

interface TalladoCameraScannerProps {
  disabled?: boolean;
  onDetected: (code: string) => void;
}

const SCANNER_ID = 'tallado-html5-qrcode';

export function TalladoCameraScanner({ disabled, onDetected }: TalladoCameraScannerProps) {
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastCodeRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    const start = async () => {
      setStarting(true);
      setError(null);
      try {
        // Esperar a que el div exista en el DOM
        await new Promise((r) => setTimeout(r, 50));
        if (cancelled) return;

        const scanner = new Html5Qrcode(SCANNER_ID, {
          verbose: false,
          formatsToSupport: [
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.CODE_93,
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.ITF,
            Html5QrcodeSupportedFormats.QR_CODE,
            Html5QrcodeSupportedFormats.DATA_MATRIX,
          ],
        });
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: 'environment' },
          {
            fps: 8,
            qrbox: (viewW, viewH) => {
              const w = Math.min(Math.floor(viewW * 0.88), 360);
              const h = Math.min(Math.floor(viewH * 0.35), 160);
              return { width: Math.max(180, w), height: Math.max(80, h) };
            },
            aspectRatio: 1.777,
          },
          (decodedText) => {
            const code = String(decodedText || '').trim();
            if (!code) return;
            const now = Date.now();
            if (code === lastCodeRef.current.code && now - lastCodeRef.current.at < 2500) return;
            lastCodeRef.current = { code, at: now };
            onDetectedRef.current(code);
          },
          () => {
            /* ignore frame misses */
          }
        );
      } catch (e: any) {
        console.error('TalladoCameraScanner:', e);
        setError(
          e?.message?.includes('Permission') || e?.name === 'NotAllowedError'
            ? 'Permiso de cámara denegado. Actívelo en el navegador.'
            : e?.message || 'No se pudo abrir la cámara. Use HTTPS o digite el código.'
        );
        setOpen(false);
      } finally {
        if (!cancelled) setStarting(false);
      }
    };

    void start();

    return () => {
      cancelled = true;
      const scanner = scannerRef.current;
      scannerRef.current = null;
      if (scanner) {
        scanner
          .stop()
          .then(() => scanner.clear())
          .catch(() => {
            try {
              scanner.clear();
            } catch {
              /* ignore */
            }
          });
      }
    };
  }, [open]);

  useEffect(() => {
    if (disabled && open) setOpen(false);
  }, [disabled, open]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant={open ? 'secondary' : 'default'}
          disabled={disabled || starting}
          onClick={() => setOpen((v) => !v)}
        >
          {starting ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : open ? (
            <CameraOff className="mr-1.5 h-4 w-4" />
          ) : (
            <Camera className="mr-1.5 h-4 w-4" />
          )}
          {open ? 'Cerrar cámara' : 'Escanear con cámara'}
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {open ? (
        <div className="rounded-md overflow-hidden border bg-black/90">
          <div id={SCANNER_ID} className="w-full min-h-[220px]" />
          <p className="text-xs text-center text-white/80 py-1.5 px-2">
            Apunte al código de barras / etiqueta. Tras leer, puede confirmar Inicio o reescaneear para Fin.
          </p>
        </div>
      ) : null}
    </div>
  );
}

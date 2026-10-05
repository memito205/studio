"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { CheckCircle2, Loader2, RefreshCw, ScanLine } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth-context';
import { getDeliveryStores } from '@/app/deliveryActions';
import { getStoreReceipts, receiveAtStore, type StoreReceiveResponse } from '@/app/podActions';
import type { DeliveryStore, StoreReceipt, StoreReceiptResult, TransferActor } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

export const RECEIPT_LABEL: Record<StoreReceiptResult, { label: string; className: string }> = {
  recibida: { label: 'Recibida', className: 'bg-green-600 text-white' },
  ya_recibida: { label: 'Ya recibida', className: 'bg-amber-500 text-white' },
  otro_destino: { label: 'Otra tienda', className: 'bg-red-600 text-white' },
  alterno_sin_tf: { label: 'Alterno sin TF', className: 'bg-orange-600 text-white' },
  no_encontrada: { label: 'No encontrada', className: 'bg-slate-500 text-white' },
};

const BANNER: Record<StoreReceiveResponse['result'], string> = {
  recibida: 'border-green-400 bg-green-50 text-green-900',
  ya_recibida: 'border-amber-400 bg-amber-50 text-amber-900',
  otro_destino: 'border-red-400 bg-red-50 text-red-900',
  alterno_sin_tf: 'border-orange-400 bg-orange-50 text-orange-900',
  no_encontrada: 'border-slate-400 bg-slate-50 text-slate-900',
  error: 'border-red-400 bg-red-50 text-red-900',
};

const bogotaDay = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);

function beep(ok: boolean) {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = ok ? 880 : 220;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (ok ? 0.12 : 0.4));
    if (!ok) navigator.vibrate?.(300);
  } catch {
    /* sin audio */
  }
}

/** Recibido en tienda por escaneo. Rol tiendas: tienda fija; admin/supervisor eligen la tienda. */
export function StoreReceiveCard() {
  const { user, userName, role, storeCode } = useAuth();
  const isStore = role === 'tiendas';
  const actor: TransferActor | undefined = useMemo(
    () =>
      user?.uid
        ? { userId: user.uid, displayName: (userName || '').trim() || user.displayName || user.email || 'Usuario' }
        : undefined,
    [user, userName]
  );

  const [stores, setStores] = useState<DeliveryStore[]>([]);
  const [selectedStore, setSelectedStore] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<StoreReceiveResponse | null>(null);
  const [today, setToday] = useState<StoreReceipt[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeStore = isStore ? storeCode || '' : selectedStore;
  const storeName = stores.find((s) => s.codigoErp === activeStore)?.nombreCorto || activeStore;

  useEffect(() => {
    getDeliveryStores().then((r) => setStores((r.data || []).filter((s) => s.activo !== false)));
  }, []);

  const loadToday = useCallback(async () => {
    if (!activeStore) return setToday([]);
    const res = await getStoreReceipts({ day: bogotaDay(), storeCode: activeStore });
    setToday(res.data || []);
  }, [activeStore]);

  useEffect(() => {
    void loadToday();
  }, [loadToday]);

  const submit = async () => {
    const value = code.trim();
    if (!value || !actor || !activeStore || busy) return;
    setBusy(true);
    const res = await receiveAtStore({ code: value, storeCode: activeStore, actor });
    setBusy(false);
    setCode('');
    setLast(res);
    beep(res.result === 'recibida');
    void loadToday();
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  if (!actor) return null;
  if (isStore && !storeCode) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-amber-800">
          Su usuario no tiene una tienda asignada. Pida a logística que la asigne para poder recibir mercancía escaneando.
        </CardContent>
      </Card>
    );
  }

  const received = today.filter((r) => r.result === 'recibida');
  const warnings = today.filter((r) => r.result !== 'recibida');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ScanLine className="h-5 w-5" /> Recibir mercancía {storeName ? `· ${storeName}` : ''}
        </CardTitle>
        <CardDescription>
          Escanee la etiqueta (DESTINO-TF), el número de TF o el código alterno de cada caja que llega. Queda registrado quién, cuándo y en
          qué tienda, y la TF pasa a Entregado en Tienda.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isStore && (
          <Select value={selectedStore} onValueChange={setSelectedStore}>
            <SelectTrigger className="w-72">
              <SelectValue placeholder="Tienda que recibe (admin)" />
            </SelectTrigger>
            <SelectContent>
              {stores.map((s) => (
                <SelectItem key={s.codigoErp} value={s.codigoErp}>
                  {s.nombreCorto} · {s.codigoErp}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className="flex gap-2">
          <Input
            ref={inputRef}
            autoFocus
            value={code}
            disabled={!activeStore}
            placeholder={activeStore ? 'Escanee o escriba y presione Enter' : 'Elija la tienda'}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
            className="h-12 text-lg"
          />
          <Button className="h-12" disabled={!code.trim() || busy || !activeStore} onClick={() => void submit()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            <span className="ml-2">Recibir</span>
          </Button>
        </div>

        {last && (
          <div className={cn('rounded-md border-2 p-3', BANNER[last.result])}>
            <p className="text-base font-bold">{last.message}</p>
            {last.result === 'recibida' && (
              <p className="text-sm">
                {last.unidades} und · {last.lines} línea(s){last.codigoAlterno ? ` · código alterno ${last.codigoAlterno}` : ''}
              </p>
            )}
            {last.result === 'ya_recibida' && last.previousAt && (
              <p className="text-sm">
                Recibida el {format(new Date(last.previousAt), 'dd/MM/yyyy HH:mm')}
                {last.previousByName ? ` por ${last.previousByName}` : ''}.
              </p>
            )}
          </div>
        )}

        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Hoy: <b className="text-green-700">{received.length}</b> recibida(s)
            {warnings.length > 0 && (
              <>
                {' '}· <b className="text-red-700">{warnings.length}</b> advertencia(s)
              </>
            )}
          </p>
          <Button variant="ghost" size="sm" onClick={() => void loadToday()}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Actualizar
          </Button>
        </div>

        {today.length > 0 && (
          <div className="max-h-80 overflow-y-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Hora</TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead>TF</TableHead>
                  <TableHead>Und</TableHead>
                  <TableHead>Resultado</TableHead>
                  <TableHead>Usuario</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {today.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">{format(new Date(r.at), 'HH:mm:ss')}</TableCell>
                    <TableCell className="text-xs">{r.code}</TableCell>
                    <TableCell className="font-bold">{r.numeroTF || '—'}</TableCell>
                    <TableCell>{r.unidades ?? '—'}</TableCell>
                    <TableCell>
                      <Badge className={RECEIPT_LABEL[r.result]?.className}>{RECEIPT_LABEL[r.result]?.label || r.result}</Badge>
                      {r.otherDestino && <span className="ml-1 text-xs text-red-700">{r.otherDestino}</span>}
                    </TableCell>
                    <TableCell className="text-xs">{r.byName}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

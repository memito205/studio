"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { CheckCircle2, Loader2, RefreshCw, ScanLine } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth-context';
import { getDeliveryStores } from '@/app/deliveryActions';
import {
  closeStoreReception,
  getStoreManifestDetail,
  getStoreManifests,
  getStoreReceipts,
  receiveAtStore,
  type StoreManifestDetail,
  type StoreManifestSummary,
  type StoreReceiveResponse,
} from '@/app/podActions';
import { STORE_RECEPTION_LABEL } from '@/lib/pod';
import { Textarea } from '@/components/ui/textarea';
import type { DeliveryStore, StoreReceipt, StoreReceiptResult, TransferActor } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { playScanSound } from '@/lib/scanSound';

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

function beep(result: StoreReceiveResponse['result']) {
  const kind = result === 'recibida' ? 'ok' : result === 'ya_recibida' ? 'warn' : 'alarm';
  playScanSound(kind);
  if (kind === 'alarm') navigator.vibrate?.([300, 100, 300]);
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

  const [manifests, setManifests] = useState<StoreManifestSummary[]>([]);
  const [detail, setDetail] = useState<StoreManifestDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [closeNote, setCloseNote] = useState('');
  const [closing, setClosing] = useState(false);
  const [notInRelation, setNotInRelation] = useState<string | null>(null);

  const loadManifests = useCallback(async () => {
    if (!activeStore) return setManifests([]);
    const res = await getStoreManifests(activeStore);
    setManifests(res.data || []);
  }, [activeStore]);

  useEffect(() => {
    setDetail(null);
    void loadManifests();
  }, [loadManifests]);

  const openManifest = async (manifestDocId: string) => {
    setLoadingDetail(true);
    setCloseNote('');
    setNotInRelation(null);
    const res = await getStoreManifestDetail(manifestDocId, activeStore);
    setLoadingDetail(false);
    if (res.data) setDetail(res.data);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const digits = (v: string) => {
    const d = String(v || '').replace(/\D/g, '');
    return d ? String(Number(d)) : '';
  };

  /** Devuelve true si la TF leída no pertenece a la relación abierta. */
  const markReadInDetail = (res: StoreReceiveResponse): boolean => {
    if (!detail || detail.reception) return false;
    if (res.result !== 'recibida' && res.result !== 'ya_recibida') return false;
    const tf = digits(res.numeroTF || '');
    const alt = String(res.codigoAlterno || '').toUpperCase();
    const hit = detail.tfs.find((t) => (tf && digits(t.numeroTF) === tf) || (alt && String(t.codigoAlterno || '').toUpperCase() === alt));
    if (!hit) {
      setNotInRelation(`La TF ${res.numeroTF || alt} no pertenece a la relación #${detail.manifestId} (quedó recibida en la tienda igual).`);
      return true;
    }
    setNotInRelation(null);
    const at = new Date().toISOString();
    setDetail({
      ...detail,
      tfs: detail.tfs.map((t) => (t === hit && !t.readAt ? { ...t, readAt: at, readByName: actor?.displayName } : t)),
    });
    return false;
  };

  const handleClose = async () => {
    if (!detail || !actor) return;
    setClosing(true);
    const res = await closeStoreReception({ manifestDocId: detail.manifestDocId, storeCode: activeStore, note: closeNote, actor });
    setClosing(false);
    if (!res.success) {
      setLast({ result: 'error', message: res.error || 'No se pudo cerrar la recepción.' });
      return;
    }
    setLast(null);
    await openManifest(detail.manifestDocId);
    void loadManifests();
  };

  const submit = async () => {
    const value = code.trim();
    if (!value || !actor || !activeStore || busy) return;
    setBusy(true);
    const res = await receiveAtStore({ code: value, storeCode: activeStore, actor });
    setBusy(false);
    setCode('');
    setLast(res);
    const outOfRelation = markReadInDetail(res);
    beep(outOfRelation ? 'error' : res.result);
    void loadToday();
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const readCount = detail ? detail.tfs.filter((t) => t.readAt).length : 0;
  const missingTfs = detail ? detail.tfs.filter((t) => !t.readAt) : [];

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
          Abra la relación que le llegó y escanee la etiqueta (DESTINO-TF), el número de TF o el código alterno de cada caja. Al terminar,
          cierre la recepción: el sistema le muestra qué TF faltan. Queda registrado quién, cuándo y en qué tienda.
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

        {activeStore && (
          <div className="space-y-2 rounded-md border p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Relaciones enviadas a la tienda</p>
              <Button variant="ghost" size="sm" onClick={() => void loadManifests()}>
                <RefreshCw className="mr-1 h-3.5 w-3.5" /> Actualizar
              </Button>
            </div>
            {manifests.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No hay relaciones abiertas para esta tienda. Puede leer las cajas sueltas igual.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {manifests.map((m) => (
                  <Button
                    key={m.manifestDocId}
                    size="sm"
                    variant={detail?.manifestDocId === m.manifestDocId ? 'default' : 'outline'}
                    onClick={() => void openManifest(m.manifestDocId)}
                    className="h-auto py-1.5 text-left"
                  >
                    <span>
                      <b>#{m.manifestId}</b> · {format(new Date(m.createdAt), 'dd/MM HH:mm')}
                      {m.resource ? ` · ${m.resource}` : ''}
                      <span className="block text-[11px] font-normal">
                        {m.receptionStatus ? STORE_RECEPTION_LABEL[m.receptionStatus] : 'Pendiente por recibir'}
                      </span>
                    </span>
                  </Button>
                ))}
              </div>
            )}
            {loadingDetail && <Loader2 className="h-4 w-4 animate-spin" />}
          </div>
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

        {notInRelation && (
          <div className="rounded-md border-2 border-amber-400 bg-amber-50 p-3 text-sm font-semibold text-amber-900">{notInRelation}</div>
        )}

        {detail && (
          <div className="space-y-3 rounded-md border-2 border-primary/30 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">
                Relación #{detail.manifestId}
                {detail.driver ? ` · ${detail.driver}` : ''}
              </p>
              <Badge variant={readCount === detail.tfs.length ? 'default' : 'secondary'}>
                Leídas {readCount} de {detail.tfs.length} TF
              </Badge>
            </div>
            <div className="max-h-72 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>TF</TableHead>
                    <TableHead>Código alterno</TableHead>
                    <TableHead>Und</TableHead>
                    <TableHead>Lectura</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.tfs.map((t) => (
                    <TableRow key={t.numeroTF} className={t.readAt ? 'bg-green-50' : ''}>
                      <TableCell className="font-bold">{t.numeroTF}</TableCell>
                      <TableCell className="font-mono text-xs">{t.codigoAlterno || '—'}</TableCell>
                      <TableCell>{t.unidades}</TableCell>
                      <TableCell className="text-xs">
                        {t.readAt ? (
                          <span className="text-green-700">
                            ✓ {format(new Date(t.readAt), 'dd/MM HH:mm')}
                            {t.readByName ? ` · ${t.readByName}` : ''}
                          </span>
                        ) : (
                          <span className="text-red-700">Falta</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {detail.reception ? (
              <div className="rounded-md bg-muted/50 p-2 text-sm">
                <b>{STORE_RECEPTION_LABEL[detail.reception.status]}</b>
                {detail.reception.at ? ` · ${format(new Date(detail.reception.at), 'dd/MM/yyyy HH:mm')}` : ''}
                {detail.reception.byName ? ` · ${detail.reception.byName}` : ''}
                {detail.reception.missingTfs?.length ? (
                  <span className="block text-red-700">Faltantes: {detail.reception.missingTfs.join(', ')}</span>
                ) : null}
                {detail.reception.note && <span className="block">Novedad: {detail.reception.note}</span>}
              </div>
            ) : (
              <div className="space-y-2">
                {missingTfs.length > 0 && (
                  <Textarea
                    rows={2}
                    value={closeNote}
                    onChange={(e) => setCloseNote(e.target.value)}
                    placeholder={`Faltan ${missingTfs.length} TF. Para cerrar así, escriba la novedad (ej. no llegó la caja).`}
                  />
                )}
                <Button
                  className="w-full"
                  variant={missingTfs.length > 0 ? 'destructive' : 'default'}
                  disabled={closing || (missingTfs.length > 0 && !closeNote.trim())}
                  onClick={() => void handleClose()}
                >
                  {closing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {missingTfs.length > 0 ? `Cerrar recepción con ${missingTfs.length} faltante(s)` : 'Cerrar recepción completa'}
                </Button>
              </div>
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

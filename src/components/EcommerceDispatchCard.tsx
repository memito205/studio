'use client';

import React, { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';
import { Loader2, Search } from 'lucide-react';
import { app } from '@/services/firebase';
import { useAuth } from '@/hooks/use-auth-context';
import { useToast } from '@/hooks/use-toast';
import { compressImage } from '@/lib/podQueue';
import { ECOM_DISPATCH_BODEGA, ECOM_DISPATCH_DESTINOS, bogotaDayKey } from '@/lib/ecommerceDispatch';
import {
  annulEcommerceDispatch,
  closeEcommerceDispatch,
  listEcommerceDispatchesByMonth,
  lookupEcommerceOrderForDispatch,
  searchEcommerceDispatchByOrder,
  searchEcommerceDispatchesByDay,
  type EcomDispatchView,
} from '@/app/ecommerceDispatchActions';
import type { TransferActor } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import JSZip from 'jszip';

type Line = { id: string; tienda: string };

const localNow = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const Photos = ({ list }: { list: EcomDispatchView['photos'] }) => (
  <div className="flex flex-wrap gap-2">
    {list.map((p, i) => (
      <a key={p.path || p.url || i} href={p.url} target="_blank" rel="noreferrer" className="block h-24 w-24 overflow-hidden rounded border bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={p.url} alt={`Hoja ${i + 1}`} className="h-full w-full object-cover" />
      </a>
    ))}
  </div>
);

const DispatchCard = ({ item }: { item: EcomDispatchView }) => (
  <div className="rounded-md border p-3 space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-semibold">{item.destino}</span>
      <span className="text-sm text-muted-foreground">{item.carrier}</span>
      <Badge variant={item.status === 'anulado' ? 'secondary' : 'default'}>
        {item.status === 'anulado' ? 'Anulado' : 'Cerrado'}
      </Badge>
    </div>
    <p className="text-sm">
      {item.dispatchAt ? format(new Date(item.dispatchAt), 'dd/MM/yyyy HH:mm') : 'Sin hora'} · {item.orderIds.length} pedido(s) · cerró {item.closedByName || 'BODVI'}
    </p>
    <Photos list={item.photos} />
  </div>
);

export function EcommerceDispatchCard({ canCreate, canBackup }: { canCreate: boolean; canBackup: boolean }) {
  const { user, userName } = useAuth();
  const { toast } = useToast();
  const actor: TransferActor | undefined = useMemo(
    () =>
      user?.uid
        ? { userId: user.uid, displayName: (userName || '').trim() || user.displayName || user.email || 'Usuario' }
        : undefined,
    [user, userName]
  );

  const [destino, setDestino] = useState<string>(ECOM_DISPATCH_DESTINOS[0]);
  const [carrier, setCarrier] = useState('');
  const [when, setWhen] = useState(localNow);
  const [scan, setScan] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [orderQuery, setOrderQuery] = useState('');
  const [day, setDay] = useState(() => bogotaDayKey(new Date()));
  const [dayDestino, setDayDestino] = useState<string>(ECOM_DISPATCH_DESTINOS[0]);
  const [found, setFound] = useState<EcomDispatchView | null>(null);
  const [dayList, setDayList] = useState<EcomDispatchView[] | null>(null);
  const [month, setMonth] = useState(() => bogotaDayKey(new Date()).slice(0, 7));

  const addOrder = async () => {
    const id = scan.trim();
    if (!id || busy) return;
    if (lines.some((l) => l.id === id)) {
      setScan('');
      return;
    }
    setBusy(true);
    const res = await lookupEcommerceOrderForDispatch(id, destino);
    setBusy(false);
    if (res.error || !res.id) {
      toast({ variant: 'destructive', title: 'Pedido', description: res.error || 'No se pudo agregar.' });
      return;
    }
    setLines((prev) => [...prev, { id: res.id!, tienda: res.tienda || destino }]);
    setScan('');
  };

  const closeDispatch = async () => {
    if (!actor || !user) {
      toast({ variant: 'destructive', title: 'Sesión', description: 'Vuelva a iniciar sesión.' });
      return;
    }
    if (lines.length === 0) {
      toast({ variant: 'destructive', title: 'Pedidos', description: 'Escanee los pedidos de este despacho.' });
      return;
    }
    if (files.length === 0) {
      toast({ variant: 'destructive', title: 'Fotos', description: 'Suba las fotos de las hojas firmadas.' });
      return;
    }
    setBusy(true);
    try {
      const storage = getStorage(app);
      const monthKey = bogotaDayKey(new Date(when)).slice(0, 7);
      const stamp = Date.now();
      const photos = [];
      for (let i = 0; i < files.length; i++) {
        const blob = await compressImage(files[i]);
        const path = `despachos-ecommerce/${monthKey}/${ECOM_DISPATCH_BODEGA}/${destino}/${stamp}-${i + 1}.jpg`;
        const r = ref(storage, path);
        await uploadBytes(r, blob, {
          contentType: 'image/jpeg',
          customMetadata: { uploadedBy: user.uid, category: 'hoja' },
        });
        photos.push({ path, url: await getDownloadURL(r) });
      }
      const res = await closeEcommerceDispatch({
        destino,
        carrier,
        dispatchAt: new Date(when).toISOString(),
        orderIds: lines.map((l) => l.id),
        photos,
        actor,
      });
      if (!res.success) {
        toast({ variant: 'destructive', title: 'No se cerró', description: res.error });
        return;
      }
      toast({ title: 'Despacho cerrado', description: `${lines.length} pedido(s) con la hora indicada.` });
      setLines([]);
      setFiles([]);
      setCarrier('');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'No se pudieron subir las fotos.';
      toast({ variant: 'destructive', title: 'Fotos', description: message });
    } finally {
      setBusy(false);
    }
  };

  const searchOrder = async () => {
    setBusy(true);
    setFound(null);
    setDayList(null);
    const res = await searchEcommerceDispatchByOrder(orderQuery);
    setBusy(false);
    if (res.error || !res.data) {
      toast({ variant: 'destructive', title: 'Prueba', description: res.error || 'Sin resultado.' });
      return;
    }
    setFound(res.data);
  };

  const searchDay = async () => {
    setBusy(true);
    setFound(null);
    setDayList(null);
    const res = await searchEcommerceDispatchesByDay(dayDestino, day);
    setBusy(false);
    if (res.error) {
      toast({ variant: 'destructive', title: 'Prueba', description: res.error });
      return;
    }
    setDayList(res.data || []);
    if (!res.data?.length) toast({ title: 'Sin despachos', description: `${dayDestino} no tiene despachos el ${day}.` });
  };

  const annul = async (item: EcomDispatchView) => {
    if (!actor) return;
    if (!window.confirm(`¿Anular el despacho de ${item.destino} (${item.orderIds.length} pedidos)? Las horas vuelven a quedar vacías. Las fotos se conservan.`)) return;
    setBusy(true);
    const res = await annulEcommerceDispatch(item.id, actor);
    setBusy(false);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'No se anuló', description: res.error });
      return;
    }
    toast({ title: 'Despacho anulado' });
    setFound((cur) => (cur?.id === item.id ? { ...cur, status: 'anulado' } : cur));
    setDayList((cur) => cur?.map((d) => (d.id === item.id ? { ...d, status: 'anulado' } : d)) || cur);
  };

  const downloadMonth = async () => {
    setBusy(true);
    const res = await listEcommerceDispatchesByMonth(month);
    if (res.error || !res.data) {
      setBusy(false);
      toast({ variant: 'destructive', title: 'Respaldo', description: res.error || 'Sin datos.' });
      return;
    }
    const photos = res.data.flatMap((d) => d.photos.map((p, i) => ({ name: `${d.day || month}_${d.destino}_${d.id}_${i + 1}.jpg`, url: p.url })));
    if (photos.length === 0) {
      setBusy(false);
      toast({ title: 'Sin fotos', description: `No hay despachos en ${month}.` });
      return;
    }
    try {
      const zip = new JSZip();
      for (const photo of photos) {
        const blob = await fetch(photo.url).then((r) => r.blob());
        zip.file(photo.name, blob);
      }
      const out = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(out);
      a.download = `despachos-ecommerce_${month}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast({
        title: 'Respaldo descargado',
        description: `${photos.length} foto(s) de ${res.data.length} despacho(s).${res.data.length >= 200 ? ' Hay más de 200 despachos: este zip trae los primeros 200.' : ''}`,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'No se pudo armar el zip.';
      toast({ variant: 'destructive', title: 'Respaldo', description: message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Despacho ecommerce</CardTitle>
        <CardDescription>
          BODVI. Elija el destino, escanee todos los pedidos y suba las fotos de las hojas. La hora que indique queda en el tablero.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {canCreate && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {ECOM_DISPATCH_DESTINOS.map((d) => (
                <Button key={d} type="button" size="sm" variant={destino === d ? 'default' : 'outline'} onClick={() => setDestino(d)}>
                  {d}
                </Button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Transportadora</Label>
                <Input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="Ej. Servientrega" />
              </div>
              <div className="space-y-1">
                <Label>Fecha y hora en que se lo llevan</Label>
                <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Pedido</Label>
              <div className="flex gap-2">
                <Input
                  value={scan}
                  onChange={(e) => setScan(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void addOrder();
                    }
                  }}
                  placeholder="Escanear o escribir el número"
                />
                <Button type="button" onClick={() => void addOrder()} disabled={busy || !scan.trim()}>
                  Agregar
                </Button>
              </div>
            </div>
            {lines.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {lines.map((l) => (
                  <Badge key={l.id} variant="secondary" className="gap-1">
                    {l.id}
                    <button type="button" className="ml-1" onClick={() => setLines((prev) => prev.filter((x) => x.id !== l.id))} aria-label={`Quitar ${l.id}`}>
                      ×
                    </button>
                  </Badge>
                ))}
              </div>
            )}
            <div className="space-y-1">
              <Label>Fotos de las hojas</Label>
              <Input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => setFiles(Array.from(e.target.files || []))}
              />
              {files.length > 0 && <p className="text-xs text-muted-foreground">{files.length} foto(s) lista(s).</p>}
            </div>
            <Button type="button" onClick={() => void closeDispatch()} disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Cerrar despacho ({lines.length})
            </Button>
          </div>
        )}

        <div className="space-y-3 border-t pt-4">
          <p className="text-sm font-medium">Buscar prueba</p>
          <div className="flex gap-2">
            <Input
              value={orderQuery}
              onChange={(e) => setOrderQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void searchOrder()}
              placeholder="Número de pedido"
            />
            <Button type="button" variant="secondary" onClick={() => void searchOrder()} disabled={busy || !orderQuery.trim()}>
              <Search className="mr-2 h-4 w-4" /> Pedido
            </Button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Input type="date" className="w-44" value={day} onChange={(e) => setDay(e.target.value)} />
            <select className="h-10 rounded-md border bg-background px-2 text-sm" value={dayDestino} onChange={(e) => setDayDestino(e.target.value)}>
              {ECOM_DISPATCH_DESTINOS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <Button type="button" variant="outline" onClick={() => void searchDay()} disabled={busy}>
              Día y destino
            </Button>
          </div>
          {found && (
            <div className="space-y-2">
              <DispatchCard item={found} />
              {found.status === 'cerrado' && (
                <Button type="button" variant="outline" size="sm" onClick={() => void annul(found)} disabled={busy}>
                  Anular este despacho
                </Button>
              )}
            </div>
          )}
          {dayList && dayList.length > 0 && (
            <div className="space-y-3">
              {dayList.map((item) => (
                <div key={item.id} className="space-y-2">
                  <DispatchCard item={item} />
                  {item.status === 'cerrado' && (
                    <Button type="button" variant="outline" size="sm" onClick={() => void annul(item)} disabled={busy}>
                      Anular
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {canBackup && (
          <div className="flex flex-wrap items-end gap-2 border-t pt-4">
            <div className="space-y-1">
              <Label>Respaldo de fotos</Label>
              <Input type="month" className="w-44" value={month} onChange={(e) => setMonth(e.target.value)} />
            </div>
            <Button type="button" variant="outline" onClick={() => void downloadMonth()} disabled={busy}>
              Descargar mes
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { Archive, ArrowLeft, Camera, CheckCircle2, ImagePlus, Loader2, MapPin, PackageCheck, PackageX, RefreshCw, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { RouteTaskAction } from '@/app/routeTaskActions';
import { compressImage, enqueueDelivery, type QueuedPhoto, type QueuedRouteSubmission } from '@/lib/podQueue';
import { MAX_DELIVERY_PHOTOS, NOT_DELIVERED_REASONS, PHOTO_CATEGORIES, routeTaskLabel } from '@/lib/pod';
import { isMessengerDriver } from '@/lib/collectionRouting';
import { pointPriority, preferredStopLabel, stopGroupKey } from '@/lib/messengerRouteOrder';
import type { DeliveryPhotoCategory, DriverRouteTask, TransferActor } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

const NOT_PICKED_REASONS = [
  'Mercancía no estaba lista',
  'Tienda / punto cerrado',
  'No hubo tiempo en la ruta',
  'Vehículo sin espacio',
  'La TF no corresponde / no existe',
  'Otro',
];

type Group = {
  key: string;
  point: string;
  kind: 'recoger' | 'entregar';
  deliverType: DriverRouteTask['deliverType'];
  tasks: DriverRouteTask[];
  /** Entrega visible en su parada pero aún sin recoger: no se puede registrar. */
  locked?: boolean;
  sortOrder: number;
  stop: number;
};
type Gps = { lat: number; lng: number; accuracyM?: number; at: string };

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function captureGps(): Promise<Gps | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: Math.round(pos.coords.accuracy),
          at: new Date(pos.timestamp).toISOString(),
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  });
}

const NO_ORDER = 9999;

const isCajonPoint = (point: string) => /CAJ[OÓ]N/i.test(point || '');

/** Destino de tienda guardado en la TF, aunque la parada haya quedado como Cajón Norte. */
const storeDestOf = (t: DriverRouteTask): string => {
  const d = String(t.bodegaDestino || '').trim();
  if (!d || isCajonPoint(d)) return '';
  if (/^(BODEGA|BODEGA PIONEROS|PIONEROS|RECEPCION)$/i.test(d)) return '';
  return d;
};

const storeDestLabel = (tasks: DriverRouteTask[]): string => {
  const dests = Array.from(new Set(tasks.map(storeDestOf).filter(Boolean)));
  if (dests.length === 1) return dests[0];
  if (dests.length > 1) return 'destino';
  return '';
};

export const deliverOrderOf = (t: DriverRouteTask) => t.deliverOrder ?? (t.pickupPoint ? NO_ORDER : t.order ?? NO_ORDER);

/**
 * Paradas en el orden del planificador: en cada punto, lo que se recoge y lo que se entrega.
 * La entrega de una TF aún sin recoger se muestra bloqueada en su punto de entrega.
 * `queuedTaskIds`: registros guardados en el celular que aún se están enviando.
 *
 * Las entregas bloqueadas NO mueven el orden de paradas (evita que CAJÓN/tiendas salten a mitad de ruta).
 */
export function groupRouteTasks(tasks: DriverRouteTask[], queuedTaskIds: Set<string> = new Set()): Group[] {
  // Respeta order/deliverOrder guardados (Reordenar Norte u orden pegado). Unifica B1 / BR 01.
  const labelsByStop = new Map<string, string[]>();

  const map = new Map<string, Group>();
  const add = (
    key: string,
    base: Omit<Group, 'key' | 'tasks' | 'sortOrder' | 'stop'>,
    t: DriverRouteTask,
    ord: number,
    rawPoint: string
  ) => {
    const g = map.get(key) || { key, ...base, tasks: [], sortOrder: ord, stop: 0 };
    g.tasks.push(t);
    g.sortOrder = Math.min(g.sortOrder, ord);
    map.set(key, g);
    const sk = stopGroupKey(rawPoint);
    const labs = labelsByStop.get(sk) || [];
    labs.push(rawPoint);
    labelsByStop.set(sk, labs);
  };
  tasks.forEach((t) => {
    const queued = queuedTaskIds.has(t.id);
    if (t.status === 'por_recoger') {
      if (!queued) {
        const point = t.pickupPoint || t.bodegaOrigen || 'Sin punto';
        const sk = stopGroupKey(point);
        add(`recoger|${sk}`, { point, kind: 'recoger', deliverType: t.deliverType }, t, t.order ?? NO_ORDER, point);
      }
      const del = t.deliverPoint || 'Sin punto';
      const skDel = stopGroupKey(del);
      add(
        `pendiente|${skDel}|${t.deliverType}`,
        { point: del, kind: 'entregar', deliverType: t.deliverType, locked: true },
        t,
        deliverOrderOf(t),
        del
      );
    } else if (!queued) {
      const del = t.deliverPoint || 'Sin punto';
      const skDel = stopGroupKey(del);
      add(
        `entregar|${skDel}|${t.deliverType}`,
        { point: del, kind: 'entregar', deliverType: t.deliverType },
        t,
        deliverOrderOf(t),
        del
      );
    }
  });
  // Unifica etiqueta visible (BR 01 gana sobre B1).
  map.forEach((g) => {
    const sk = stopGroupKey(g.point);
    g.point = preferredStopLabel(labelsByStop.get(sk) || [g.point]);
  });
  const groups = Array.from(map.values());
  const pointOrder = new Map<string, number>();
  groups.forEach((g) => {
    const sk = stopGroupKey(g.point);
    if (g.locked && groups.some((o) => stopGroupKey(o.point) === sk && !o.locked)) return;
    const base = g.sortOrder + pointPriority(g.point) * 0.001;
    pointOrder.set(sk, Math.min(pointOrder.get(sk) ?? NO_ORDER, base));
  });
  groups.forEach((g) => {
    const sk = stopGroupKey(g.point);
    if (!pointOrder.has(sk)) pointOrder.set(sk, g.sortOrder + pointPriority(g.point) * 0.001);
  });
  const rank = (g: Group) => (g.kind === 'recoger' ? 0 : g.locked ? 2 : 1);
  groups.sort(
    (a, b) =>
      pointOrder.get(stopGroupKey(a.point))! - pointOrder.get(stopGroupKey(b.point))! ||
      rank(a) - rank(b) ||
      a.sortOrder - b.sortOrder ||
      a.point.localeCompare(b.point)
  );
  let stop = 0;
  let lastKey = '';
  groups.forEach((g) => {
    const sk = stopGroupKey(g.point);
    if (sk !== lastKey) {
      stop++;
      lastKey = sk;
    }
    g.stop = stop;
  });
  return groups;
}

const RouteTaskForm: React.FC<{
  group: Group;
  action: RouteTaskAction;
  actor: TransferActor;
  onCancel: () => void;
  onQueued: () => void;
}> = ({ group, action, actor, onCancel, onQueued }) => {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(group.tasks.map((t) => t.id)));
  const [photos, setPhotos] = useState<Array<QueuedPhoto & { preview: string }>>([]);
  const [receivedBy, setReceivedBy] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [busyPhotos, setBusyPhotos] = useState(false);
  const [saving, setSaving] = useState(false);
  const [gps, setGps] = useState<Gps | null>(null);
  const [gpsState, setGpsState] = useState<'loading' | 'ok' | 'error'>('loading');
  const cameraRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const galleryRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const failing = action === 'no_recoger' || action === 'no_entregar';
  const chosenTasks = group.tasks.filter((t) => selected.has(t.id));
  const deliverOriginal =
    action === 'entregar' && isCajonPoint(group.point) && chosenTasks.some((t) => t.kind !== 'libre' && storeDestOf(t));
  const toStore =
    action === 'entregar' &&
    chosenTasks.some((t) => t.kind !== 'libre') &&
    (group.deliverType === 'tienda' || deliverOriginal);
  const libreDelivery = action === 'entregar' && chosenTasks.some((t) => t.kind === 'libre');
  const categories = action === 'recoger'
    ? [{ id: 'mercancia' as DeliveryPhotoCategory, label: 'Mercancía recogida', required: true }]
    : action === 'cajon'
    ? [{ id: 'mercancia' as DeliveryPhotoCategory, label: 'Mercancía en el cajón', required: true }]
    : action === 'bodega'
    ? [{ id: 'mercancia' as DeliveryPhotoCategory, label: 'Mercancía en bodega', required: true }]
    : action === 'entregar'
      ? PHOTO_CATEGORIES.map((c) => ({ ...c, required: toStore && c.required }))
      : [{ id: 'otra' as DeliveryPhotoCategory, label: 'Evidencia (opcional)', required: false }];

  const getGps = useCallback(async () => {
    setGpsState('loading');
    const g = await captureGps();
    setGps(g);
    setGpsState(g ? 'ok' : 'error');
  }, []);
  useEffect(() => {
    void getGps();
  }, [getGps]);
  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const addPhotos = async (category: DeliveryPhotoCategory, files: FileList | null) => {
    if (!files || files.length === 0) return;
    const room = MAX_DELIVERY_PHOTOS - photos.length;
    if (room <= 0) return;
    setBusyPhotos(true);
    try {
      const added = await Promise.all(
        Array.from(files).slice(0, room).map(async (f) => {
          const blob = await compressImage(f);
          return { id: newId(), category, blob, preview: URL.createObjectURL(blob) };
        })
      );
      setPhotos((prev) => [...prev, ...added]);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'No se pudo agregar la foto', description: e?.message });
    } finally {
      setBusyPhotos(false);
    }
  };

  const removePhoto = (id: string) =>
    setPhotos((prev) => {
      const p = prev.find((x) => x.id === id);
      if (p) URL.revokeObjectURL(p.preview);
      return prev.filter((x) => x.id !== id);
    });

  const problems: string[] = [];
  if (selected.size === 0) problems.push('Seleccione al menos una TF.');
  if (failing && !reason) problems.push('Indique el motivo.');
  if (action === 'recoger' && photos.length === 0) problems.push('Tome la foto de lo que recoge.');
  if (action === 'cajon' && photos.length === 0) problems.push('Tome la foto de la mercancía en el cajón.');
  if (action === 'bodega' && photos.length === 0) problems.push('Tome la foto de la mercancía en bodega.');
  if (toStore && !photos.some((p) => p.category === 'remision')) problems.push('Tome la foto de la remisión firmada.');
  if (libreDelivery && photos.length === 0) problems.push('Tome la foto de la entrega.');
  if ((toStore || libreDelivery) && !receivedBy.trim()) problems.push('Escriba el nombre de quien recibe.');

  const handleConfirm = async () => {
    if (problems.length > 0) return;
    setSaving(true);
    try {
      const chosen = group.tasks.filter((t) => selected.has(t.id));
      const submissionId = newId();
      const actionLabel =
        action === 'cajon'
          ? 'Dejar en cajón'
          : action === 'bodega'
            ? 'Dejar en bodega'
            : `${failing ? 'No ' : ''}${action.includes('recoger') ? 'recoger' : 'entregar'}`;
      const record: QueuedRouteSubmission = {
        kind: 'route',
        submissionId,
        label: `${actionLabel} · ${group.point} (${chosen.length} TF)`,
        storeKey: (chosen[0].deliverStoreCode || group.point || 'RUTA').replace(/[\/\s]+/g, '-'),
        monthKey: format(new Date(), 'yyyy-MM'),
        input: {
          action,
          taskIds: chosen.map((t) => t.id),
          submissionId,
          gps,
          receivedByName: receivedBy.trim() || undefined,
          reason: reason || undefined,
          notes: notes.trim() || undefined,
          actor,
        },
        photos: photos.map(({ preview: _p, ...p }) => p),
        createdAt: Date.now(),
      };
      await enqueueDelivery(record);
      onQueued();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'No se pudo guardar en el celular', description: e?.message });
      setSaving(false);
    }
  };

  const title = {
    recoger: 'Recoger',
    no_recoger: 'No recogida',
    entregar: group.deliverType === 'bodega' && !deliverOriginal ? 'Dejar en bodega' : 'Entregar en tienda',
    no_entregar: 'No entregada',
    cajon: 'Dejar en cajón',
    bodega: 'Dejar en bodega',
  }[action];

  return (
    <div className="space-y-4">
      <Button variant="outline" onClick={onCancel} disabled={saving} className="w-full justify-start">
        <ArrowLeft className="mr-2 h-4 w-4" /> Volver
      </Button>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">
            {title} · {deliverOriginal ? storeDestLabel(chosenTasks) || group.point : group.point}
          </CardTitle>
          <CardDescription>Marque las TF de este registro.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y rounded-md border p-0">
          {group.tasks.map((t) => (
            <label key={t.id} className="flex items-center gap-3 p-2">
              <Checkbox
                checked={selected.has(t.id)}
                onCheckedChange={(c) =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (c) next.add(t.id);
                    else next.delete(t.id);
                    return next;
                  })
                }
              />
              <span className="flex-1">
                <span className="font-semibold">{routeTaskLabel(t)}</span>
                <span className="block text-xs text-muted-foreground">
                  {group.kind === 'recoger' ? `Entregar en ${t.deliverPoint}` : t.bodegaOrigen ? `Desde ${t.bodegaOrigen}` : ''}
                  {t.notes ? ` · ${t.notes}` : ''}
                </span>
              </span>
              {t.kind !== 'libre' && <span className="text-xs text-muted-foreground">{t.unidades} und</span>}
            </label>
          ))}
        </CardContent>
      </Card>

      {failing && (
        <div className="space-y-1">
          <Label className="text-xs">Motivo *</Label>
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger><SelectValue placeholder="Seleccione el motivo..." /></SelectTrigger>
            <SelectContent>
              {(action === 'no_recoger' ? NOT_PICKED_REASONS : NOT_DELIVERED_REASONS).map((r) => (
                <SelectItem key={r} value={r}>{r}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Fotos ({photos.length}/{MAX_DELIVERY_PHOTOS})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {categories.map((c) => {
            const list = photos.filter((p) => p.category === c.id);
            return (
              <div key={c.id} className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    {c.label}
                    {c.required && <span className="text-red-600"> *</span>}
                  </span>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant="secondary" disabled={busyPhotos} onClick={() => cameraRefs.current[c.id]?.click()}>
                      <Camera className="mr-1 h-4 w-4" /> Cámara
                    </Button>
                    <Button type="button" size="sm" variant="outline" disabled={busyPhotos} onClick={() => galleryRefs.current[c.id]?.click()}>
                      <ImagePlus className="h-4 w-4" />
                    </Button>
                  </div>
                  <input
                    ref={(el) => { cameraRefs.current[c.id] = el; }}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => { void addPhotos(c.id, e.target.files); e.target.value = ''; }}
                  />
                  <input
                    ref={(el) => { galleryRefs.current[c.id] = el; }}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => { void addPhotos(c.id, e.target.files); e.target.value = ''; }}
                  />
                </div>
                {list.length > 0 && (
                  <div className="grid grid-cols-4 gap-2">
                    {list.map((p) => (
                      <div key={p.id} className="relative aspect-square overflow-hidden rounded border">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.preview} alt={c.label} className="h-full w-full object-cover" />
                        <button type="button" className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white" onClick={() => removePhoto(p.id)}>
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-6">
          {(toStore || libreDelivery) && (
            <div className="space-y-1">
              <Label htmlFor="rt-received">Nombre de quien recibe *</Label>
              <Input id="rt-received" value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} />
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="rt-notes">Observaciones</Label>
            <Textarea id="rt-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="flex items-center justify-between gap-2 rounded-md bg-muted/50 p-2 text-xs">
            <span className="flex items-center gap-1">
              <MapPin className="h-4 w-4" />
              {gpsState === 'loading' && 'Obteniendo ubicación...'}
              {gpsState === 'ok' && gps && `Ubicación capturada (±${gps.accuracyM ?? '?'} m)`}
              {gpsState === 'error' && 'Sin ubicación. Se puede registrar igual.'}
            </span>
            {gpsState !== 'loading' && (
              <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => void getGps()}>
                <RefreshCw className="h-3 w-3" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {problems.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-red-700">
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}
      <Button
        className={cn('h-12 w-full', failing && 'bg-red-600 hover:bg-red-700')}
        disabled={saving || busyPhotos || problems.length > 0}
        onClick={() => void handleConfirm()}
      >
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
        Confirmar: {title}
      </Button>
    </div>
  );
};

const renderGroupCards = (
  groups: Group[],
  queuedTaskIds: Set<string>,
  onOpenForm: (form: { group: Group; action: RouteTaskAction } | null) => void,
  opts?: { showStopNumbers?: boolean; freeCollection?: boolean; lockedByPriorDay?: boolean }
) =>
  groups.map((g, i) => (
    <Card key={g.key} className={cn(g.locked && 'border-dashed bg-muted/30', opts?.freeCollection && 'border-amber-200')}>
      {opts?.showStopNumbers !== false && (i === 0 || groups[i - 1].stop !== g.stop) && (
        <p className="px-6 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Parada {g.stop}</p>
      )}
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{g.point}</CardTitle>
            <CardDescription>
              {g.tasks.length} envío(s) · {g.tasks.reduce((n, t) => n + (t.unidades || 0), 0)} und · placa {g.tasks[0].placa}
            </CardDescription>
          </div>
          <Badge
            className={
              g.locked
                ? 'bg-gray-400 text-white'
                : opts?.freeCollection
                  ? 'bg-amber-600 text-white'
                  : g.kind === 'recoger'
                    ? 'bg-blue-600 text-white'
                    : 'bg-emerald-600 text-white'
            }
          >
            {opts?.freeCollection
              ? isCajonPoint(g.point)
                ? 'Recogida → cajón'
                : 'Recogida de hoy'
              : g.kind === 'recoger'
                ? 'Recoger'
                : isCajonPoint(g.point)
                  ? storeDestLabel(g.tasks)
                    ? 'Entregar o cajón'
                    : 'Dejar en cajón'
                  : g.deliverType === 'bodega'
                    ? 'Dejar en bodega'
                    : 'Entregar'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          {g.tasks
            .map((t) =>
              `${routeTaskLabel(t)}${g.kind === 'recoger' ? ` → ${t.deliverPoint}` : ''}${
                g.locked ? (queuedTaskIds.has(t.id) ? ' (recogida enviándose)' : ` (recoger primero en ${t.pickupPoint || 'origen'})`) : ''
              }`
            )
            .join(' · ')}
        </p>
        {g.tasks.some((t) => t.lastRejection) && (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950">
            Rechazada: {g.tasks.find((t) => t.lastRejection)?.lastRejection?.note}
            {' — registre de nuevo.'}
          </p>
        )}
        {g.tasks.some((t) => t.waitingForHandoff) && (
          <p className="rounded-md border border-orange-300 bg-orange-50 p-2 text-xs text-orange-950">
            Esperando handoff del camión
            {g.tasks.find((t) => t.handoffManifestNumber)
              ? ` (relación #${g.tasks.find((t) => t.handoffManifestNumber)?.handoffManifestNumber})`
              : ''}
            . Cuando el camión registre la entrega al mensajero podrá recoger/entregar.
          </p>
        )}
        {opts?.lockedByPriorDay ? (
          <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
            Visible en la ruta. Se habilita cuando cierre el día anterior.
          </p>
        ) : g.locked ? (
          <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
            Se habilita cuando se registre la recogida y se actualice la lista.
          </p>
        ) : g.tasks.every((t) => t.waitingForHandoff) ? (
          <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
            Acciones bloqueadas hasta el handoff del camión.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {g.kind === 'entregar' && isCajonPoint(g.point) && !storeDestLabel(g.tasks) ? (
              <Button onClick={() => onOpenForm({ group: g, action: 'cajon' })}>
                <Archive className="mr-2 h-4 w-4" /> Dejar en cajón
              </Button>
            ) : (
              <Button onClick={() => onOpenForm({ group: g, action: g.kind === 'recoger' ? 'recoger' : 'entregar' })}>
                <PackageCheck className="mr-2 h-4 w-4" />{' '}
                {g.kind === 'recoger' ? 'Recoger' : storeDestLabel(g.tasks) && isCajonPoint(g.point) ? `Entregar en ${storeDestLabel(g.tasks)}` : 'Entregar'}
              </Button>
            )}
            {!(g.kind === 'entregar' && isCajonPoint(g.point) && !storeDestLabel(g.tasks)) && g.kind === 'recoger' && (
              <Button
                variant="outline"
                className="text-red-700"
                onClick={() => onOpenForm({ group: g, action: 'no_recoger' })}
              >
                <PackageX className="mr-2 h-4 w-4" /> No recogida
              </Button>
            )}
            {g.kind === 'entregar' && !isCajonPoint(g.point) && g.deliverType !== 'tienda' && (
              <Button
                variant="outline"
                className="text-red-700"
                onClick={() => onOpenForm({ group: g, action: 'no_entregar' })}
              >
                <PackageX className="mr-2 h-4 w-4" /> No entregada
              </Button>
            )}
            {g.kind === 'entregar' && (g.deliverType === 'tienda' || (!!storeDestLabel(g.tasks) && isCajonPoint(g.point))) && (
              isMessengerDriver({ displayName: g.tasks[0]?.driverName }) || isCajonPoint(g.point) ? (
                <Button variant="secondary" onClick={() => onOpenForm({ group: g, action: 'cajon' })}>
                  <Archive className="mr-2 h-4 w-4" /> Dejar en Cajón Norte
                </Button>
              ) : (
                <Button variant="secondary" className="col-span-2" onClick={() => onOpenForm({ group: g, action: 'bodega' })}>
                  <Archive className="mr-2 h-4 w-4" /> No se pudo entregar: dejar en bodega
                </Button>
              )
            )}
            {g.kind === 'entregar' && g.deliverType === 'tienda' && !isCajonPoint(g.point) && (
              <Button
                variant="outline"
                className="col-span-2 text-red-700"
                onClick={() => onOpenForm({ group: g, action: 'no_entregar' })}
              >
                <PackageX className="mr-2 h-4 w-4" /> No entregada
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  ));

const fmtDayLabel = (day: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  const [y, m, d] = day.split('-');
  return `${d}/${m}/${y}`;
};

/** Lista de recolecciones/entregas asignadas al conductor (sin sondeo: carga al abrir y al actualizar). */
export const DriverRouteTasksSection: React.FC<{
  tasks: DriverRouteTask[];
  loading: boolean;
  queuedTaskIds: Set<string>;
  onReload: () => void;
  onOpenForm: (form: { group: Group; action: RouteTaskAction } | null) => void;
}> = ({ tasks, loading, queuedTaskIds, onReload, onOpenForm }) => {
  const today = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);
  const days = useMemo(
    () => Array.from(new Set(tasks.map((t) => t.day).filter(Boolean))).sort(),
    [tasks]
  );
  const priorDays = useMemo(() => days.filter((d) => d < today), [days, today]);
  const rejectedOpen = useMemo(
    () => tasks.filter((t) => t.lastRejection && (t.status === 'por_entregar' || t.status === 'por_recoger')),
    [tasks]
  );
  const pendingSend = tasks.filter((t) => queuedTaskIds.has(t.id)).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Mi ruta: recolecciones y entregas</h2>
        <Button size="sm" variant="ghost" onClick={onReload} disabled={loading}>
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
        </Button>
      </div>
      {pendingSend > 0 && <p className="text-xs text-amber-700">{pendingSend} TF registrada(s) en el celular, enviándose.</p>}
      {priorDays.length > 0 && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <p className="font-semibold">Debe cerrar la ruta del día anterior</p>
          <p className="text-xs mt-1">
            Tiene pendientes del {priorDays.map(fmtDayLabel).join(', ')}. Ciérrelas primero. Si le montaron última milla, igual aparece abajo en la ruta de hoy: puede verla, y la habilita al cerrar el día anterior.
          </p>
        </div>
      )}
      {rejectedOpen.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <p className="font-semibold">Entrega(s) rechazada(s): registre de nuevo</p>
          <ul className="mt-1 list-disc pl-4 text-xs">
            {rejectedOpen.slice(0, 5).map((t) => (
              <li key={t.id}>
                {routeTaskLabel(t)} · {t.lastRejection?.note}
                {t.lastRejection?.byName ? ` (${t.lastRejection.byName})` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
      {loading && tasks.length === 0 ? (
        <div className="py-4 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
      ) : days.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tiene recolecciones ni entregas pendientes.</p>
      ) : (
        days.map((day) => {
          const dayTasks = tasks.filter((t) => t.day === day);
          const freeTasks = dayTasks.filter((t) => t.source === 'recoleccion_libre');
          const planTasks = dayTasks.filter((t) => t.source !== 'recoleccion_libre');
          const freeGroups = groupRouteTasks(freeTasks, queuedTaskIds);
          const planGroups = groupRouteTasks(planTasks, queuedTaskIds);
          const isPrior = day < today;
          return (
            <div key={day} className={cn('space-y-2', isPrior && 'rounded-md border border-red-200 p-2')}>
              <p
                className={cn(
                  'text-xs font-semibold uppercase tracking-wide',
                  isPrior ? 'text-red-800' : 'text-muted-foreground'
                )}
              >
                {isPrior ? `Pendientes · ${fmtDayLabel(day)} (cerrar primero)` : `Ruta · ${fmtDayLabel(day)}`}
              </p>
              {freeGroups.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Recogidas</p>
                  {renderGroupCards(freeGroups, queuedTaskIds, onOpenForm, {
                    showStopNumbers: false,
                    freeCollection: true,
                    lockedByPriorDay: !isPrior && priorDays.length > 0,
                  })}
                </div>
              )}
              {planGroups.length > 0 && (
                <div className="space-y-2">
                  {freeGroups.length > 0 && (
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Asignadas / planificador
                    </p>
                  )}
                  {renderGroupCards(planGroups, queuedTaskIds, onOpenForm, {
                    lockedByPriorDay: !isPrior && priorDays.length > 0,
                  })}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
};

export { RouteTaskForm };
export type RouteTaskGroup = Group;

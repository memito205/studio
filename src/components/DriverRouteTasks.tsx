"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { ArrowLeft, Camera, CheckCircle2, ImagePlus, Loader2, MapPin, PackageCheck, PackageX, RefreshCw, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { RouteTaskAction } from '@/app/routeTaskActions';
import { compressImage, enqueueDelivery, type QueuedPhoto, type QueuedRouteSubmission } from '@/lib/podQueue';
import { MAX_DELIVERY_PHOTOS, NOT_DELIVERED_REASONS, PHOTO_CATEGORIES } from '@/lib/pod';
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

type Group = { key: string; point: string; kind: 'recoger' | 'entregar'; deliverType: DriverRouteTask['deliverType']; tasks: DriverRouteTask[] };
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

export function groupRouteTasks(tasks: DriverRouteTask[]): Group[] {
  const map = new Map<string, Group>();
  tasks.forEach((t) => {
    const kind = t.status === 'por_recoger' ? 'recoger' : 'entregar';
    const point = kind === 'recoger' ? t.pickupPoint || t.bodegaOrigen || 'Sin punto' : t.deliverPoint;
    const key = `${kind}|${point}|${kind === 'entregar' ? t.deliverType : ''}`;
    const g = map.get(key) || { key, point, kind, deliverType: t.deliverType, tasks: [] };
    g.tasks.push(t);
    map.set(key, g);
  });
  return Array.from(map.values()).sort(
    (a, b) => (a.kind === b.kind ? 0 : a.kind === 'recoger' ? -1 : 1) || Math.min(...a.tasks.map((t) => t.order ?? 9999)) - Math.min(...b.tasks.map((t) => t.order ?? 9999))
  );
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
  const toStore = action === 'entregar' && group.deliverType === 'tienda';
  const categories = action === 'recoger'
    ? [{ id: 'mercancia' as DeliveryPhotoCategory, label: 'Mercancía recogida', required: true }]
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
  if (toStore && !photos.some((p) => p.category === 'remision')) problems.push('Tome la foto de la remisión firmada.');
  if (toStore && !receivedBy.trim()) problems.push('Escriba el nombre de quien recibe.');

  const handleConfirm = async () => {
    if (problems.length > 0) return;
    setSaving(true);
    try {
      const chosen = group.tasks.filter((t) => selected.has(t.id));
      const submissionId = newId();
      const record: QueuedRouteSubmission = {
        kind: 'route',
        submissionId,
        label: `${failing ? 'No ' : ''}${action.includes('recoger') ? 'recoger' : 'entregar'} · ${group.point} (${chosen.length} TF)`,
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
    entregar: group.deliverType === 'bodega' ? 'Dejar en bodega' : 'Entregar en tienda',
    no_entregar: 'No entregada',
  }[action];

  return (
    <div className="space-y-4">
      <Button variant="outline" onClick={onCancel} disabled={saving} className="w-full justify-start">
        <ArrowLeft className="mr-2 h-4 w-4" /> Volver
      </Button>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">{title} · {group.point}</CardTitle>
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
                <span className="font-semibold">TF {t.numeroTF}</span>
                <span className="block text-xs text-muted-foreground">
                  {group.kind === 'recoger' ? `Entregar en ${t.deliverPoint}` : t.bodegaOrigen ? `Desde ${t.bodegaOrigen}` : ''}
                  {t.notes ? ` · ${t.notes}` : ''}
                </span>
              </span>
              <span className="text-xs text-muted-foreground">{t.unidades} und</span>
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
          {toStore && (
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

/** Lista de recolecciones/entregas asignadas al conductor (sin sondeo: carga al abrir y al actualizar). */
export const DriverRouteTasksSection: React.FC<{
  tasks: DriverRouteTask[];
  loading: boolean;
  queuedTaskIds: Set<string>;
  onReload: () => void;
  onOpenForm: (form: { group: Group; action: RouteTaskAction } | null) => void;
}> = ({ tasks, loading, queuedTaskIds, onReload, onOpenForm }) => {
  const groups = useMemo(() => groupRouteTasks(tasks.filter((t) => !queuedTaskIds.has(t.id))), [tasks, queuedTaskIds]);
  const pendingSend = tasks.filter((t) => queuedTaskIds.has(t.id)).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Recolecciones asignadas</h2>
        <Button size="sm" variant="ghost" onClick={onReload} disabled={loading}>
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
        </Button>
      </div>
      {pendingSend > 0 && <p className="text-xs text-amber-700">{pendingSend} TF registrada(s) en el celular, enviándose.</p>}
      {loading && tasks.length === 0 ? (
        <div className="py-4 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
      ) : groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tiene recolecciones pendientes.</p>
      ) : (
        groups.map((g) => (
          <Card key={g.key}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base">{g.point}</CardTitle>
                  <CardDescription>
                    {g.tasks.length} TF · {g.tasks.reduce((n, t) => n + (t.unidades || 0), 0)} und · placa {g.tasks[0].placa}
                  </CardDescription>
                </div>
                <Badge className={g.kind === 'recoger' ? 'bg-blue-600 text-white' : 'bg-emerald-600 text-white'}>
                  {g.kind === 'recoger' ? 'Recoger' : g.deliverType === 'bodega' ? 'Dejar en bodega' : 'Entregar'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {g.tasks.map((t) => `TF ${t.numeroTF}${g.kind === 'recoger' ? ` → ${t.deliverPoint}` : ''}`).join(' · ')}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button onClick={() => onOpenForm({ group: g, action: g.kind === 'recoger' ? 'recoger' : 'entregar' })}>
                  <PackageCheck className="mr-2 h-4 w-4" /> {g.kind === 'recoger' ? 'Recoger' : 'Entregar'}
                </Button>
                <Button variant="outline" className="text-red-700" onClick={() => onOpenForm({ group: g, action: g.kind === 'recoger' ? 'no_recoger' : 'no_entregar' })}>
                  <PackageX className="mr-2 h-4 w-4" /> {g.kind === 'recoger' ? 'No recogida' : 'No entregada'}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
};

export { RouteTaskForm };
export type RouteTaskGroup = Group;

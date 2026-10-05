"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  CloudOff,
  ImagePlus,
  Loader2,
  MapPin,
  Navigation,
  RefreshCw,
  Truck,
  X,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth-context';
import { useToast } from '@/hooks/use-toast';
import { getManifestStopsDetail, getOpenDeliveryManifests, type StopWithTfs } from '@/app/podActions';
import {
  compressImage,
  enqueueDelivery,
  listQueued,
  onQueueChange,
  processQueue,
  type QueuedDelivery,
  type QueuedPhoto,
} from '@/lib/podQueue';
import { MAX_DELIVERY_PHOTOS, NOT_DELIVERED_REASONS, PHOTO_CATEGORIES, STOP_STATUS_LABEL } from '@/lib/pod';
import { DEFAULT_STORE_RADIUS_M } from '@/lib/deliveryStores';
import type { DeliveryManifest, DeliveryPhotoCategory, DeliveryStopStatus, TransferActor } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

type Mode = 'todo' | 'parcial' | 'ninguno';
type Gps = { lat: number; lng: number; accuracyM?: number; at: string };

const STATUS_CLASS: Record<DeliveryStopStatus, string> = {
  pendiente: 'bg-slate-200 text-slate-800',
  entregada: 'bg-green-600 text-white',
  parcial: 'bg-amber-500 text-white',
  no_entregada: 'bg-red-600 text-white',
};

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const distanceMeters = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
};

const mapsUrl = (stop: StopWithTfs) =>
  Number.isFinite(stop.storeLat) && Number.isFinite(stop.storeLng)
    ? `https://www.google.com/maps/dir/?api=1&destination=${stop.storeLat},${stop.storeLng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stop.storeAddress || stop.storeName || stop.destino)}`;

function useGps(active: boolean) {
  const [gps, setGps] = useState<Gps | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [error, setError] = useState('');
  const capture = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setState('error');
      setError('Este celular no permite ubicación.');
      return;
    }
    setState('loading');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: Math.round(pos.coords.accuracy),
          at: new Date(pos.timestamp).toISOString(),
        });
        setState('ok');
      },
      (err) => {
        setState('error');
        setError(err.code === err.PERMISSION_DENIED ? 'Permiso de ubicación negado.' : 'No se pudo obtener la ubicación.');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  }, []);
  useEffect(() => {
    if (active) capture();
    else {
      setGps(null);
      setState('idle');
    }
  }, [active, capture]);
  return { gps, state, error, capture };
}

const DeliveryForm: React.FC<{
  manifest: DeliveryManifest;
  stop: StopWithTfs;
  actor: TransferActor;
  onCancel: () => void;
  onQueued: () => void;
}> = ({ manifest, stop, actor, onCancel, onQueued }) => {
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>('todo');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(stop.tfs.map((t) => t.numeroTF)));
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [bulkReason, setBulkReason] = useState('');
  const [photos, setPhotos] = useState<Array<QueuedPhoto & { preview: string }>>([]);
  const [receivedBy, setReceivedBy] = useState('');
  const [notes, setNotes] = useState('');
  const [busyPhotos, setBusyPhotos] = useState(false);
  const [saving, setSaving] = useState(false);
  const { gps, state: gpsState, error: gpsError, capture } = useGps(true);
  const cameraRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const galleryRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const deliveredTfs = useMemo(() => {
    if (mode === 'todo') return stop.tfs.map((t) => t.numeroTF);
    return stop.tfs
      .filter((t) => t.storeReceivedAt || (mode === 'parcial' && selected.has(t.numeroTF)))
      .map((t) => t.numeroTF);
  }, [mode, selected, stop.tfs]);
  const notDeliveredTfs = stop.tfs.filter((t) => !deliveredTfs.includes(t.numeroTF));
  const needsProof = stop.tfs.some((t) => deliveredTfs.includes(t.numeroTF) && !t.storeReceivedAt);
  const reasonOf = (tf: string) => reasons[tf] || bulkReason;

  const distance =
    gps && Number.isFinite(stop.storeLat) && Number.isFinite(stop.storeLng)
      ? distanceMeters(gps, { lat: stop.storeLat!, lng: stop.storeLng! })
      : null;

  const addPhotos = async (category: DeliveryPhotoCategory, files: FileList | null) => {
    if (!files || files.length === 0) return;
    const room = MAX_DELIVERY_PHOTOS - photos.length;
    if (room <= 0) {
      toast({ variant: 'destructive', title: `Máximo ${MAX_DELIVERY_PHOTOS} fotos por entrega.` });
      return;
    }
    setBusyPhotos(true);
    try {
      const list = Array.from(files).slice(0, room);
      const added = await Promise.all(
        list.map(async (f) => {
          const blob = await compressImage(f);
          return { id: newId(), category, blob, preview: URL.createObjectURL(blob) };
        })
      );
      setPhotos((prev) => [...prev, ...added]);
      if (files.length > room) toast({ title: `Solo se agregaron ${room} fotos (máximo ${MAX_DELIVERY_PHOTOS}).` });
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
  if (needsProof && !photos.some((p) => p.category === 'remision')) problems.push('Tome al menos una foto de la remisión firmada.');
  if (needsProof && !receivedBy.trim()) problems.push('Escriba el nombre de quien recibe.');
  if (notDeliveredTfs.some((t) => !reasonOf(t.numeroTF))) problems.push('Indique el motivo de las TF no entregadas.');
  if (mode === 'parcial' && !needsProof) problems.push('En entrega parcial marque al menos una TF entregada.');

  const handleConfirm = async () => {
    if (problems.length > 0) return;
    setSaving(true);
    try {
      const record: QueuedDelivery = {
        submissionId: newId(),
        label: `Relación #${manifest.manifestId} · ${stop.storeName || stop.destino}`,
        storeKey: (stop.storeCode || stop.id || 'SIN-TIENDA').replace(/[\/\s]+/g, '-'),
        monthKey: format(new Date(), 'yyyy-MM'),
        input: {
          manifestDocId: manifest.id,
          stopId: stop.id,
          submissionId: '',
          deliveredTfs,
          notDelivered: Object.fromEntries(notDeliveredTfs.map((t) => [t.numeroTF, reasonOf(t.numeroTF)])),
          gps,
          receivedByName: receivedBy.trim(),
          notes: notes.trim(),
          actor,
        },
        photos: photos.map(({ preview: _p, ...p }) => p),
        createdAt: Date.now(),
      };
      record.input.submissionId = record.submissionId;
      await enqueueDelivery(record);
      onQueued();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'No se pudo guardar en el celular', description: e?.message });
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Button variant="outline" onClick={onCancel} disabled={saving} className="w-full justify-start">
        <ArrowLeft className="mr-2 h-4 w-4" /> Volver a las paradas
      </Button>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">{stop.storeName || stop.destino}</CardTitle>
          <CardDescription>
            {stop.tfs.length} TF · {stop.unidades} und{stop.storeAddress ? ` · ${stop.storeAddress}` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {([
              ['todo', 'Entregar todo'],
              ['parcial', 'Parcial'],
              ['ninguno', 'No entregado'],
            ] as Array<[Mode, string]>).map(([m, label]) => (
              <Button
                key={m}
                type="button"
                variant={mode === m ? 'default' : 'outline'}
                className={cn('h-12 text-xs', mode === m && m === 'ninguno' && 'bg-red-600 hover:bg-red-700')}
                onClick={() => setMode(m)}
              >
                {label}
              </Button>
            ))}
          </div>

          {mode !== 'todo' && (
            <div className="space-y-2">
              <Label className="text-xs">Motivo para las no entregadas</Label>
              <Select value={bulkReason} onValueChange={setBulkReason}>
                <SelectTrigger><SelectValue placeholder="Seleccione el motivo..." /></SelectTrigger>
                <SelectContent>
                  {NOT_DELIVERED_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="divide-y rounded-md border">
            {stop.tfs.map((t) => {
              const isDelivered = deliveredTfs.includes(t.numeroTF);
              return (
                <div key={t.numeroTF} className="p-2 space-y-1">
                  <label className="flex items-center gap-3">
                    {t.storeReceivedAt ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : mode === 'parcial' ? (
                      <Checkbox
                        checked={selected.has(t.numeroTF)}
                        onCheckedChange={(c) =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (c) next.add(t.numeroTF);
                            else next.delete(t.numeroTF);
                            return next;
                          })
                        }
                      />
                    ) : isDelivered ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : (
                      <X className="h-4 w-4 text-red-600" />
                    )}
                    <span className="flex-1">
                      <span className="font-semibold">TF {t.numeroTF}</span>
                      {t.codigoAlterno && <span className="ml-2 font-mono text-xs text-muted-foreground">{t.codigoAlterno}</span>}
                      {t.storeReceivedAt && (
                        <span className="block text-xs text-green-700">
                          Ya recibida por la tienda{t.storeReceivedByName ? ` (${t.storeReceivedByName})` : ''}
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">{t.unidades} und</span>
                  </label>
                  {!isDelivered && mode === 'parcial' && (
                    <Select value={reasons[t.numeroTF] || ''} onValueChange={(v) => setReasons((p) => ({ ...p, [t.numeroTF]: v }))}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder={bulkReason ? `Motivo: ${bulkReason}` : 'Motivo de esta TF...'} />
                      </SelectTrigger>
                      <SelectContent>
                        {NOT_DELIVERED_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Fotos ({photos.length}/{MAX_DELIVERY_PHOTOS})</CardTitle>
          <CardDescription>
            {needsProof
              ? 'La remisión firmada es obligatoria (puede tomar varias hojas).'
              : deliveredTfs.length > 0
                ? 'Opcional: la tienda ya registró el recibo escaneando.'
                : 'Opcional cuando no se entrega.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {PHOTO_CATEGORIES.map((c) => {
            const list = photos.filter((p) => p.category === c.id);
            return (
              <div key={c.id} className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    {c.label}
                    {c.required && needsProof && <span className="text-red-600"> *</span>}
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
                        <button
                          type="button"
                          className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white"
                          onClick={() => removePhoto(p.id)}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {busyPhotos && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Preparando fotos...
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-6">
          {deliveredTfs.length > 0 && (
            <div className="space-y-1">
              <Label htmlFor="pod-received">Nombre de quien recibe{needsProof ? ' *' : ''}</Label>
              <Input id="pod-received" value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} />
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="pod-notes">Observaciones</Label>
            <Textarea id="pod-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="flex items-center justify-between gap-2 rounded-md bg-muted/50 p-2 text-xs">
            <span className="flex items-center gap-1">
              <MapPin className="h-4 w-4" />
              {gpsState === 'loading' && 'Obteniendo ubicación...'}
              {gpsState === 'ok' && gps && `Ubicación capturada (±${gps.accuracyM ?? '?'} m)`}
              {gpsState === 'error' && `${gpsError} Se puede registrar igual.`}
            </span>
            {gpsState !== 'loading' && (
              <Button type="button" size="sm" variant="ghost" className="h-7" onClick={capture}>
                <RefreshCw className="h-3 w-3" />
              </Button>
            )}
          </div>
          {distance !== null && distance > DEFAULT_STORE_RADIUS_M && (
            <p className="rounded-md border border-amber-400 bg-amber-50 p-2 text-xs text-amber-900">
              Está a {distance} m de la tienda. Puede registrar igual; quedará marcado para revisión.
            </p>
          )}
        </CardContent>
      </Card>

      {problems.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-red-700">
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}
      <Button className="h-12 w-full" disabled={saving || busyPhotos || problems.length > 0} onClick={() => void handleConfirm()}>
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
        Confirmar {mode === 'todo' ? 'entrega' : mode === 'parcial' ? 'entrega parcial' : 'no entrega'}
      </Button>
    </div>
  );
};

export const DriverDeliveriesModule: React.FC<{ onReturn: () => void }> = ({ onReturn }) => {
  const { user, userName, role } = useAuth();
  const { toast } = useToast();
  const isReviewer = role === 'admin' || role === 'supervisor';
  const actor: TransferActor | undefined = useMemo(
    () =>
      user?.uid
        ? { userId: user.uid, displayName: (userName || '').trim() || user.displayName || user.email || 'Usuario' }
        : undefined,
    [user, userName]
  );

  const [manifests, setManifests] = useState<DeliveryManifest[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<DeliveryManifest | null>(null);
  const [stops, setStops] = useState<StopWithTfs[]>([]);
  const [loadingStops, setLoadingStops] = useState(false);
  const [formStop, setFormStop] = useState<StopWithTfs | null>(null);
  const [queued, setQueued] = useState<QueuedDelivery[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [online, setOnline] = useState(true);

  const loadManifests = useCallback(async () => {
    if (!user?.uid) return;
    setLoading(true);
    const res = await getOpenDeliveryManifests({ driverUserId: user.uid, all: isReviewer });
    if (res.error) toast({ variant: 'destructive', title: 'Error', description: res.error });
    setManifests(res.data || []);
    setLoading(false);
  }, [user?.uid, isReviewer, toast]);

  const loadStops = useCallback(
    async (m: DeliveryManifest) => {
      setLoadingStops(true);
      const res = await getManifestStopsDetail(m.id);
      if (res.error) toast({ variant: 'destructive', title: 'Error', description: res.error });
      setStops(res.stops || []);
      if (res.manifest) setActive(res.manifest);
      setLoadingStops(false);
    },
    [toast]
  );

  const refreshQueued = useCallback(() => {
    listQueued().then(setQueued).catch(() => setQueued([]));
  }, []);

  const sync = useCallback(async () => {
    if (!user?.uid) return;
    setSyncing(true);
    const results = await processQueue(user.uid);
    setSyncing(false);
    refreshQueued();
    results.forEach((r) => {
      if (r.ok) toast({ title: 'Entrega registrada', description: r.label });
      else if (r.conflict) toast({ variant: 'destructive', title: 'No se registró', description: `${r.label}: ${r.error}` });
    });
    if (results.some((r) => r.ok || r.conflict)) {
      void loadManifests();
      if (active) void loadStops(active);
    }
  }, [user?.uid, refreshQueued, toast, loadManifests, loadStops, active]);

  useEffect(() => {
    void loadManifests();
  }, [loadManifests]);

  useEffect(() => {
    refreshQueued();
    const off = onQueueChange(refreshQueued);
    const goOnline = () => {
      setOnline(true);
      void sync();
    };
    const goOffline = () => setOnline(false);
    setOnline(typeof navigator === 'undefined' ? true : navigator.onLine);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      off();
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [refreshQueued, sync]);

  useEffect(() => {
    if (queued.length === 0) return;
    const t = setInterval(() => void sync(), 30000);
    return () => clearInterval(t);
  }, [queued.length, sync]);

  const queuedStopIds = useMemo(() => new Set(queued.map((q) => `${q.input.manifestDocId}|${q.input.stopId}`)), [queued]);

  if (!actor) {
    return <p className="p-8 text-center text-muted-foreground">Inicie sesión para ver sus entregas.</p>;
  }

  if (active && formStop) {
    return (
      <div className="mx-auto max-w-xl p-4">
        <DeliveryForm
          manifest={active}
          stop={formStop}
          actor={actor}
          onCancel={() => setFormStop(null)}
          onQueued={() => {
            setFormStop(null);
            toast({ title: 'Entrega guardada', description: 'Se está enviando. Si no hay señal, se envía sola al volver.' });
            void sync();
          }}
        />
      </div>
    );
  }

  const queueBanner = queued.length > 0 && (
    <div className="flex items-center justify-between gap-2 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">
      <span className="flex items-center gap-2">
        <CloudOff className="h-4 w-4" />
        {queued.length} entrega(s) guardada(s) en el celular sin enviar{!online ? ' (sin señal)' : ''}.
      </span>
      <Button size="sm" variant="outline" disabled={syncing} onClick={() => void sync()}>
        {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Enviar ahora'}
      </Button>
    </div>
  );

  if (active) {
    const done = stops.filter((s) => s.status !== 'pendiente').length;
    return (
      <div className="mx-auto max-w-xl space-y-4 p-4">
        <Button variant="outline" className="w-full justify-start" onClick={() => { setActive(null); setStops([]); void loadManifests(); }}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Mis relaciones
        </Button>
        {queueBanner}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">Relación #{active.manifestId}</h2>
            <p className="text-xs text-muted-foreground">
              {active.resource} · {active.driver || 'Sin conductor'} · {done}/{stops.length} paradas
            </p>
          </div>
          <Button size="icon" variant="ghost" onClick={() => void loadStops(active)} disabled={loadingStops}>
            <RefreshCw className={cn('h-4 w-4', loadingStops && 'animate-spin')} />
          </Button>
        </div>
        {loadingStops && stops.length === 0 ? (
          <div className="py-10 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div>
        ) : (
          stops.map((s) => {
            const isQueued = queuedStopIds.has(`${active.id}|${s.id}`);
            return (
              <Card key={s.id} className={cn(s.status !== 'pendiente' && 'opacity-80')}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base">{s.storeName || s.destino}</CardTitle>
                      <CardDescription>
                        {s.tfs.length} TF · {s.unidades} und{s.storeAddress ? ` · ${s.storeAddress}` : ''}
                      </CardDescription>
                    </div>
                    <Badge className={isQueued ? 'bg-amber-500 text-white' : STATUS_CLASS[s.status]}>
                      {isQueued ? 'Por enviar' : STOP_STATUS_LABEL[s.status]}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {s.status !== 'pendiente' ? (
                    <div className="space-y-1 text-xs text-muted-foreground">
                      {s.completedAt && <p>Registrada {format(new Date(s.completedAt), 'dd/MM HH:mm')} por {s.completedByName}</p>}
                      {s.receivedByName && <p>Recibió: {s.receivedByName}</p>}
                      {(s.notDeliveredTransferIds?.length || 0) > 0 && (
                        <p className="text-red-700">No entregadas: {Object.entries(s.notDeliveredReasons || {}).map(([tf, r]) => `TF ${tf} (${r})`).join(', ')}</p>
                      )}
                      <p>{s.photos?.length || 0} foto(s){typeof s.distanceM === 'number' ? ` · a ${s.distanceM} m de la tienda` : ''}</p>
                    </div>
                  ) : (
                    <>
                    {s.lastRejection && (
                      <p className="text-xs text-red-800 bg-red-50 border border-red-200 rounded-md px-2 py-1.5">
                        Registro rechazado por {s.lastRejection.byName}: {s.lastRejection.note}. Vuelva a registrar esta parada.
                      </p>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="outline" asChild>
                        <a href={mapsUrl(s)} target="_blank" rel="noreferrer">
                          <Navigation className="mr-2 h-4 w-4" /> Cómo llegar
                        </a>
                      </Button>
                      <Button disabled={isQueued} onClick={() => setFormStop(s)}>
                        <Truck className="mr-2 h-4 w-4" /> Registrar
                      </Button>
                    </div>
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Mis entregas</h1>
          <p className="text-xs text-muted-foreground">
            {isReviewer ? 'Todas las relaciones en ruta.' : 'Relaciones en ruta asignadas a usted.'}
          </p>
        </div>
        <Button variant="outline" onClick={onReturn}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Volver
        </Button>
      </div>
      {queueBanner}
      <div className="flex justify-end">
        <Button size="sm" variant="ghost" onClick={() => void loadManifests()} disabled={loading}>
          <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} /> Actualizar
        </Button>
      </div>
      {loading ? (
        <div className="py-10 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div>
      ) : manifests.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No hay relaciones en ruta{isReviewer ? '' : ' asignadas a usted'}. La relación aparece cuando la crean con su usuario como conductor.
        </p>
      ) : (
        manifests.map((m) => (
          <Card key={m.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Relación #{m.manifestId}</CardTitle>
              <CardDescription>
                {m.createdAt ? format(new Date(m.createdAt), 'dd/MM/yyyy HH:mm') : ''} · {m.resource}
                {isReviewer ? ` · ${m.driver || 'Sin conductor'}` : ''}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-between gap-2">
              <span className="text-sm">
                {m.stopsDone || 0}/{m.stopsCount || 0} paradas · {m.transferIds?.length || 0} líneas
              </span>
              <Button onClick={() => { setActive(m); void loadStops(m); }}>Ver paradas</Button>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
};

"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, Loader2, MapPin, RefreshCw, Search, Undo2, UserCog, XCircle } from 'lucide-react';
import { PodArchiveTab } from '@/components/PodArchiveTab';
import { RouteTasksAdminTab } from '@/components/RouteTasksAdminTab';
import { useAuth } from '@/hooks/use-auth-context';
import { useToast } from '@/hooks/use-toast';
import {
  approveDeliveryManifest,
  closeDeliveryManifestWithoutApp,
  findTfsByAltCode,
  getManifestStopsDetail,
  getPodAdminManifests,
  getPodNovedades,
  getPodPlatformShare,
  getStoreReceipts,
  reassignDeliveryManifestDriver,
  rejectDeliveryStop,
  resolvePodNovedades,
  type AdminManifest,
  type AdminStop,
  type PodNovedadLine,
  type StopWithTfs,
} from '@/app/podActions';
import { PHOTO_CATEGORIES, STOP_STATUS_LABEL, STORE_RECEPTION_LABEL } from '@/lib/pod';
import type { DeliveryManifestStatus, DeliveryPhoto, DeliveryStopStatus, StoreReceipt, TransferActor } from '@/types';
import { RECEIPT_LABEL } from '@/components/StoreReceiveCard';
import { DriverUserSelect, type DriverValue } from '@/components/DriverUserSelect';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

const MANIFEST_STATUS: Record<DeliveryManifestStatus, { label: string; className: string }> = {
  en_ruta: { label: 'En ruta', className: 'bg-blue-600 text-white' },
  pendiente_validacion: { label: 'Por validar', className: 'bg-amber-500 text-white' },
  cerrada: { label: 'Cerrada', className: 'bg-green-700 text-white' },
};

const STOP_CLASS: Record<DeliveryStopStatus, string> = {
  pendiente: 'bg-slate-200 text-slate-800',
  entregada: 'bg-green-600 text-white',
  parcial: 'bg-amber-500 text-white',
  no_entregada: 'bg-red-600 text-white',
};

const VISITS_PER_WEEK_GOAL = 3;

const photoLabel = (c: DeliveryPhoto['category']) => PHOTO_CATEGORIES.find((p) => p.id === c)?.label || c;
const fmt = (d: unknown, pattern = 'dd/MM/yyyy HH:mm') => {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d as string);
  return Number.isNaN(date.getTime()) ? '—' : format(date, pattern);
};
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');
const monthRange = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return { from: new Date(y, m - 1, 1), to: new Date(y, m, 0, 23, 59, 59, 999) };
};

type NoteRequest = {
  title: string;
  description: string;
  required: boolean;
  confirmLabel: string;
  destructive?: boolean;
  /** true = cerrar el diálogo. */
  onConfirm: (note: string) => Promise<boolean>;
};

function NoteDialog({ request, onClose }: { request: NoteRequest | null; onClose: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setNote(''), [request]);
  if (!request) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{request.title}</DialogTitle>
          <DialogDescription>{request.description}</DialogDescription>
        </DialogHeader>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={request.required ? 'Obligatorio' : 'Opcional'}
          rows={3}
        />
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>Cancelar</Button>
          <Button
            variant={request.destructive ? 'destructive' : 'default'}
            disabled={busy || (request.required && !note.trim())}
            onClick={async () => {
              setBusy(true);
              try {
                if (await request.onConfirm(note.trim())) onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {request.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChangeDriverDialog({
  manifest,
  actor,
  onClose,
  onDone,
}: {
  manifest: AdminManifest;
  actor: TransferActor;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [driver, setDriver] = useState<DriverValue>({ driver: '' });
  const [placa, setPlaca] = useState(manifest.resource || '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!driver.driverUserId) return;
    setBusy(true);
    const res = await reassignDeliveryManifestDriver({
      manifestDocId: manifest.id,
      driverUserId: driver.driverUserId,
      driverName: driver.driver,
      placa,
      note,
      actor,
    });
    setBusy(false);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'No se cambió el conductor', description: res.error });
      return;
    }
    toast({ title: `Relación #${manifest.manifestId} asignada a ${driver.driver}`, description: 'Le aparece en "Mis entregas" al actualizar.' });
    onDone();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cambiar conductor · Relación #{manifest.manifestId}</DialogTitle>
          <DialogDescription>
            Actual: {manifest.driver || 'sin conductor'} · placa {manifest.resource || '—'}. La relación sale de la app del conductor
            actual y aparece en la del nuevo. Las paradas ya registradas se conservan.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Nuevo conductor *</Label>
            <DriverUserSelect value={driver} onChange={setDriver} />
            {driver.driver && !driver.driverUserId && <p className="text-xs text-red-600">Debe ser un usuario conductor (con app).</p>}
          </div>
          <div className="space-y-1">
            <Label>Placa</Label>
            <Input value={placa} onChange={(e) => setPlaca(e.target.value.toUpperCase())} />
          </div>
          <div className="space-y-1">
            <Label>Motivo *</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Ej: se asignó por error al conductor equivocado" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>Cancelar</Button>
          <Button disabled={busy || !driver.driverUserId || !note.trim()} onClick={() => void save()}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Cambiar conductor
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManifestDetail({
  manifest,
  actor,
  onClose,
  onChanged,
  askNote,
}: {
  manifest: AdminManifest;
  actor: TransferActor;
  onClose: () => void;
  onChanged: () => void;
  askNote: (r: NoteRequest) => void;
}) {
  const { toast } = useToast();
  const [detail, setDetail] = useState<Map<string, StopWithTfs>>(new Map());
  const [loading, setLoading] = useState(true);
  const [photo, setPhoto] = useState<DeliveryPhoto | null>(null);
  const [changingDriver, setChangingDriver] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getManifestStopsDetail(manifest.id)
      .then((res) => {
        if (alive && res.stops) setDetail(new Map(res.stops.map((s) => [s.id, s])));
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [manifest]);

  const status = manifest.deliveryStatus || 'en_ruta';
  const done = manifest.stops.filter((s) => s.status !== 'pendiente').length;

  const approve = () =>
    askNote({
      title: `Aprobar relación #${manifest.manifestId}`,
      description: 'La relación queda cerrada con todas sus paradas aprobadas.',
      required: false,
      confirmLabel: 'Aprobar y cerrar',
      onConfirm: async (note) => {
        const res = await approveDeliveryManifest({ manifestDocId: manifest.id, note, actor });
        if (!res.success) {
          toast({ variant: 'destructive', title: 'No se pudo aprobar', description: res.error });
          return false;
        }
        toast({ title: `Relación #${manifest.manifestId} aprobada` });
        onChanged();
        onClose();
        return true;
      },
    });

  const closeWithoutApp = () =>
    askNote({
      title: `Cerrar relación #${manifest.manifestId} sin app`,
      description: manifest.legacy
        ? 'Relación anterior a la app. Se cierra sin cambiar el estado de sus TF.'
        : `Quedan ${manifest.stops.length - done} parada(s) sin registrar. Se cierra sin cambiar el estado de esas TF.`,
      required: true,
      confirmLabel: 'Cerrar relación',
      destructive: true,
      onConfirm: async (note) => {
        const res = await closeDeliveryManifestWithoutApp({ manifestDocId: manifest.id, note, actor });
        if (!res.success) {
          toast({ variant: 'destructive', title: 'No se pudo cerrar', description: res.error });
          return false;
        }
        toast({ title: `Relación #${manifest.manifestId} cerrada` });
        onChanged();
        onClose();
        return true;
      },
    });

  const reject = (stop: AdminStop) =>
    askNote({
      title: `Rechazar registro · ${stop.storeName || stop.destino}`,
      description:
        'La parada vuelve a pendiente y sus TF a "Enviado a Destino". El conductor verá esta nota y debe registrarla de nuevo.',
      required: true,
      confirmLabel: 'Rechazar',
      destructive: true,
      onConfirm: async (note) => {
        const res = await rejectDeliveryStop({ manifestDocId: manifest.id, stopId: stop.id, note, actor });
        if (!res.success) {
          toast({ variant: 'destructive', title: 'No se pudo rechazar', description: res.error });
          return false;
        }
        toast({
          title: 'Parada rechazada',
          description: res.skipped ? `${res.skipped} línea(s) ya habían cambiado de estado y no se tocaron.` : undefined,
        });
        onChanged();
        onClose();
        return true;
      },
    });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            Relación #{manifest.manifestId}
            <Badge className={MANIFEST_STATUS[status].className}>{MANIFEST_STATUS[status].label}</Badge>
            {manifest.legacy && <Badge variant="outline">Anterior a la app</Badge>}
          </DialogTitle>
          <DialogDescription>
            {fmt(manifest.createdAt)} · Placa {manifest.resource || '—'} · {manifest.driver || 'Sin conductor'} · {done}/
            {manifest.stops.length} paradas
          </DialogDescription>
        </DialogHeader>

        {manifest.validatedAt && (
          <p className="text-xs text-green-900 bg-green-50 border border-green-200 rounded-md px-2 py-1.5">
            Aprobada {fmt(manifest.validatedAt)} por {manifest.validatedByName}
            {manifest.validationNote ? ` · ${manifest.validationNote}` : ''}
          </p>
        )}
        {manifest.closedWithoutApp && (
          <p className="text-xs text-slate-800 bg-slate-100 border rounded-md px-2 py-1.5">
            Cerrada sin app {fmt(manifest.closedAt)} por {manifest.closedByName} · {manifest.closedNote}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {status === 'pendiente_validacion' && (
            <Button onClick={approve}>
              <CheckCircle2 className="mr-2 h-4 w-4" /> Aprobar y cerrar
            </Button>
          )}
          {status === 'en_ruta' && !manifest.legacy && (
            <Button variant="outline" onClick={() => setChangingDriver(true)}>
              <UserCog className="mr-2 h-4 w-4" /> Cambiar conductor
            </Button>
          )}
          {status === 'en_ruta' && (
            <Button variant="outline" onClick={closeWithoutApp}>
              <XCircle className="mr-2 h-4 w-4" /> Cerrar sin app
            </Button>
          )}
        </div>
        {changingDriver && (
          <ChangeDriverDialog
            manifest={manifest}
            actor={actor}
            onClose={() => setChangingDriver(false)}
            onDone={() => {
              setChangingDriver(false);
              onChanged();
              onClose();
            }}
          />
        )}
        {(manifest.driverHistory || []).length > 0 && (
          <div className="text-xs bg-blue-50 border border-blue-200 rounded-md px-2 py-1.5 space-y-0.5 text-blue-950">
            {(manifest.driverHistory || []).map((h, i) => (
              <p key={i}>
                Conductor cambiado {fmt(h.at)} por {h.byName}: {h.fromName || 'sin conductor'} ({h.fromPlaca || '—'}) → {h.toName} (
                {h.toPlaca || '—'}) · {h.note}
              </p>
            ))}
          </div>
        )}

        <div className="space-y-3">
          {manifest.stops.map((s) => {
            const d = detail.get(s.id);
            return (
              <Card key={s.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base">{s.storeName || s.destino}</CardTitle>
                      <CardDescription>
                        {s.numerosTF?.length || 0} TF · {s.unidades} und
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={STOP_CLASS[s.status || 'pendiente']}>{STOP_STATUS_LABEL[s.status || 'pendiente']}</Badge>
                      {s.status !== 'pendiente' && status !== 'cerrada' && (
                        <Button size="sm" variant="outline" className="text-red-700" onClick={() => reject(s)}>
                          <Undo2 className="mr-1 h-3.5 w-3.5" /> Rechazar
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {s.storeReception && (
                    <p
                      className={cn(
                        'text-xs rounded-md border px-2 py-1',
                        s.storeReception.status === 'con_faltantes' ? 'border-red-200 bg-red-50 text-red-800' : 'border-green-200 bg-green-50 text-green-800'
                      )}
                    >
                      Recepción tienda: {STORE_RECEPTION_LABEL[s.storeReception.status]} · {fmt(s.storeReception.at)} · {s.storeReception.byName}
                      {s.storeReception.missingTfs?.length ? ` · Faltantes: ${s.storeReception.missingTfs.join(', ')}` : ''}
                      {s.storeReception.note ? ` · ${s.storeReception.note}` : ''}
                    </p>
                  )}
                  {s.lastRejection && s.status === 'pendiente' && (
                    <p className="text-xs text-red-800 bg-red-50 border border-red-200 rounded-md px-2 py-1">
                      Rechazada {fmt(s.lastRejection.at)} por {s.lastRejection.byName}: {s.lastRejection.note}
                    </p>
                  )}
                  {s.status !== 'pendiente' && (
                    <div className="grid gap-1 text-xs sm:grid-cols-2">
                      <p>Registrada: {fmt(s.completedAt)} · {s.completedByName || '—'}</p>
                      <p>Recibió: {s.receivedByName || '—'}</p>
                      <p className={cn(s.distanceAlert && 'font-bold text-red-700')}>
                        {s.distanceAlert && <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />}
                        Distancia: {typeof s.distanceM === 'number' ? `${s.distanceM} m (radio ${s.radiusM} m)` : 'sin ubicación de tienda'}
                        {s.gps && (
                          <a
                            className="ml-2 text-blue-700 underline"
                            href={`https://www.google.com/maps?q=${s.gps.lat},${s.gps.lng}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <MapPin className="inline h-3.5 w-3.5" /> ver
                          </a>
                        )}
                      </p>
                      {s.notes && <p>Notas: {s.notes}</p>}
                    </div>
                  )}

                  {(s.photos?.length || 0) > 0 && (
                    <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                      {s.photos!.map((p, i) =>
                        p.archived ? (
                          <div key={p.path || i} className="flex h-20 flex-col justify-center rounded border bg-muted p-1 text-[10px] text-muted-foreground" title={p.archivedFile}>
                            <span className="font-bold">{photoLabel(p.category)}</span>
                            Archivada en el PC
                            <span className="truncate">{p.archivedFile?.split('/').slice(-2).join('/')}</span>
                          </div>
                        ) : (
                        <button key={p.path || i} type="button" className="text-left" onClick={() => setPhoto(p)}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={p.url} alt={photoLabel(p.category)} loading="lazy" className="h-20 w-full rounded border object-cover" />
                          <span className="block truncate text-[10px] text-muted-foreground">{photoLabel(p.category)}</span>
                        </button>
                        )
                      )}
                    </div>
                  )}

                  {loading && !d ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    d && (
                      <div className="flex flex-wrap gap-1">
                        {d.tfs.map((tf) => {
                          const reason = s.notDeliveredReasons?.[tf.numeroTF];
                          return (
                            <span
                              key={tf.numeroTF}
                              title={tf.status}
                              className={cn(
                                'rounded border px-1.5 py-0.5 text-[11px]',
                                tf.status === 'Entregado en Tienda' && 'border-green-300 bg-green-50 text-green-900',
                                tf.status === 'Novedad de Entrega' && 'border-red-300 bg-red-50 text-red-900'
                              )}
                            >
                              TF {tf.numeroTF}
                              {tf.codigoAlterno ? ` · ${tf.codigoAlterno}` : ''} · {tf.unidades} und
                              {reason ? ` · ${reason}` : ''}
                            </span>
                          );
                        })}
                      </div>
                    )
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {photo && (
          <Dialog open onOpenChange={(o) => !o && setPhoto(null)}>
            <DialogContent className="max-w-5xl">
              <DialogHeader>
                <DialogTitle>{photoLabel(photo.category)}</DialogTitle>
              </DialogHeader>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt={photoLabel(photo.category)} className="max-h-[75vh] w-full object-contain" />
              <a className="text-sm text-blue-700 underline" href={photo.url} target="_blank" rel="noreferrer">
                Abrir en otra pestaña
              </a>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
}

type NovedadGroup = {
  key: string;
  ids: string[];
  numeroTF: string;
  bodegaDestino: string;
  cantidad: number;
  codigoAlterno?: string;
  motivo: string;
  at: string | null;
  byName?: string;
  manifestId?: number;
  placa?: string;
};

function NovedadesTab({ actor, askNote }: { actor: TransferActor; askNote: (r: NoteRequest) => void }) {
  const { toast } = useToast();
  const [lines, setLines] = useState<PodNovedadLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    const res = await getPodNovedades();
    setLoading(false);
    if (res.error) return toast({ variant: 'destructive', title: 'Error', description: res.error });
    setLines(res.data || []);
    setSelected(new Set());
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => {
    const map = new Map<string, NovedadGroup>();
    lines.forEach((l) => {
      const key = `${l.numeroTF}|${l.bodegaDestino.toUpperCase()}`;
      const g = map.get(key) || { ...l, key, ids: [], cantidad: 0 };
      g.ids.push(l.id);
      g.cantidad += l.cantidad;
      map.set(key, g);
    });
    return Array.from(map.values()).sort((a, b) => (a.at || '').localeCompare(b.at || ''));
  }, [lines]);

  const selectedIds = groups.filter((g) => selected.has(g.key)).flatMap((g) => g.ids);

  const resolve = (action: 'reprogramar' | 'devolver') =>
    askNote({
      title: action === 'reprogramar' ? `Reprogramar ${selected.size} TF` : `Devolver a bodega ${selected.size} TF`,
      description:
        action === 'reprogramar'
          ? 'Vuelven a "Recibido en Bodega" marcadas como REPROGRAMADAS y salen de primera en el Gestor.'
          : 'Vuelven a "Recibido en Bodega" y salen en el Gestor como cualquier otra.',
      required: false,
      confirmLabel: action === 'reprogramar' ? 'Reprogramar' : 'Devolver a bodega',
      onConfirm: async (note) => {
        const res = await resolvePodNovedades({ transferIds: selectedIds, action, note, actor });
        if (!res.success) {
          toast({ variant: 'destructive', title: 'No se pudo aplicar', description: res.error });
          return false;
        }
        toast({
          title: action === 'reprogramar' ? 'TF reprogramadas' : 'TF devueltas a bodega',
          description: `${res.updated} línea(s) actualizadas${res.skipped ? ` · ${res.skipped} ya habían cambiado` : ''}.`,
        });
        await load();
        return true;
      },
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} /> Actualizar
        </Button>
        <Button size="sm" disabled={selected.size === 0} onClick={() => resolve('reprogramar')}>
          Reprogramar ({selected.size})
        </Button>
        <Button size="sm" variant="outline" disabled={selected.size === 0} onClick={() => resolve('devolver')}>
          Devolver a bodega ({selected.size})
        </Button>
        <span className="text-sm text-muted-foreground">{groups.length} TF con novedad</span>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <Checkbox
                  checked={groups.length > 0 && selected.size === groups.length}
                  onCheckedChange={(c) => setSelected(c ? new Set(groups.map((g) => g.key)) : new Set())}
                />
              </TableHead>
              <TableHead>TF</TableHead>
              <TableHead>Cód. alterno</TableHead>
              <TableHead>Destino</TableHead>
              <TableHead>Und</TableHead>
              <TableHead>Motivo</TableHead>
              <TableHead>Reportada</TableHead>
              <TableHead>Conductor</TableHead>
              <TableHead>Relación</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                  {loading ? 'Cargando…' : 'No hay TF con novedad de entrega.'}
                </TableCell>
              </TableRow>
            ) : (
              groups.map((g) => (
                <TableRow key={g.key}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(g.key)}
                      onCheckedChange={(c) =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (c) next.add(g.key);
                          else next.delete(g.key);
                          return next;
                        })
                      }
                    />
                  </TableCell>
                  <TableCell className="font-bold">{g.numeroTF}</TableCell>
                  <TableCell>{g.codigoAlterno || '—'}</TableCell>
                  <TableCell>{g.bodegaDestino}</TableCell>
                  <TableCell>{g.cantidad}</TableCell>
                  <TableCell className="text-red-800">{g.motivo || '—'}</TableCell>
                  <TableCell className="text-xs">{fmt(g.at, 'dd/MM HH:mm')}</TableCell>
                  <TableCell className="text-xs">{g.byName || '—'}</TableCell>
                  <TableCell className="text-xs">
                    {g.manifestId ? `#${g.manifestId}` : '—'}
                    {g.placa ? ` · ${g.placa}` : ''}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

type Share = { entregados: number; app: number; quick: number; inferidos: number };

function IndicatorsTab({ manifests, month, share }: { manifests: AdminManifest[]; month: string; share: Share | null }) {
  const stats = useMemo(() => {
    const { from, to } = monthRange(month);
    const end = to.getTime() > Date.now() ? new Date() : to;
    const weeks = Math.max(1, (end.getTime() - from.getTime()) / (7 * 24 * 3600 * 1000));
    const inMonth = manifests.filter(
      (m) => !m.legacy && m.createdAt && new Date(m.createdAt) >= from && new Date(m.createdAt) <= to
    );

    let stopsDone = 0;
    let tfDelivered = 0;
    let tfNot = 0;
    let distanceAlerts = 0;
    const hours: number[] = [];
    const reasons = new Map<string, number>();
    const drivers = new Map<string, { stops: number; ok: number; not: number; hours: number[] }>();
    const stores = new Map<string, { days: Set<string>; ok: number; not: number }>();

    inMonth.forEach((m) =>
      m.stops.forEach((s) => {
        if (!s.status || s.status === 'pendiente') return;
        stopsDone++;
        tfDelivered += s.deliveredTfs.length;
        tfNot += s.notDeliveredTfs.length;
        if (s.distanceAlert) distanceAlerts++;
        Object.values(s.notDeliveredReasons || {}).forEach((r) => reasons.set(r, (reasons.get(r) || 0) + 1));
        const h =
          s.completedAt && m.createdAt
            ? (new Date(s.completedAt).getTime() - new Date(m.createdAt).getTime()) / 3600000
            : NaN;
        if (Number.isFinite(h) && h >= 0) hours.push(h);

        const driver = s.completedByName || m.driver || 'Sin nombre';
        const dr = drivers.get(driver) || { stops: 0, ok: 0, not: 0, hours: [] };
        dr.stops++;
        dr.ok += s.deliveredTfs.length;
        dr.not += s.notDeliveredTfs.length;
        if (Number.isFinite(h) && h >= 0) dr.hours.push(h);
        drivers.set(driver, dr);

        const store = s.storeName || s.destino;
        const st = stores.get(store) || { days: new Set<string>(), ok: 0, not: 0 };
        if (s.deliveredTfs.length > 0 && s.completedAt) st.days.add(fmt(s.completedAt, 'yyyy-MM-dd'));
        st.ok += s.deliveredTfs.length;
        st.not += s.notDeliveredTfs.length;
        stores.set(store, st);
      })
    );

    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
    return {
      relations: inMonth.length,
      pendingValidation: inMonth.filter((m) => m.deliveryStatus === 'pendiente_validacion').length,
      stopsDone,
      tfDelivered,
      tfNot,
      distanceAlerts,
      avgHours: avg(hours),
      reasons: Array.from(reasons.entries()).sort((a, b) => b[1] - a[1]),
      drivers: Array.from(drivers.entries())
        .map(([name, d]) => ({ name, ...d, avgHours: avg(d.hours) }))
        .sort((a, b) => b.stops - a.stops),
      stores: Array.from(stores.entries())
        .map(([name, s]) => ({ name, visits: s.days.size, perWeek: s.days.size / weeks, ok: s.ok, not: s.not }))
        .sort((a, b) => a.perWeek - b.perWeek),
    };
  }, [manifests, month]);

  const hoursLabel = (h: number) => (Number.isFinite(h) ? `${h.toFixed(1)} h` : '—');
  const kpi = (title: string, value: React.ReactNode, hint?: string) => (
    <Card>
      <CardHeader className="pb-1">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
      {hint && <CardContent className="pt-0 text-xs text-muted-foreground">{hint}</CardContent>}
    </Card>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpi('Entregas efectivas', pct(stats.tfDelivered, stats.tfDelivered + stats.tfNot), `${stats.tfDelivered} TF entregadas · ${stats.tfNot} no entregadas`)}
        {kpi('Paradas registradas', stats.stopsDone, `${stats.relations} relaciones · ${stats.pendingValidation} por validar`)}
        {kpi('Despacho → entrega', hoursLabel(stats.avgHours), 'Promedio desde que se crea la relación')}
        {kpi('Alertas de distancia', stats.distanceAlerts, 'Registros fuera del radio de la tienda')}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Prueba de entrega en plataforma (TF entregadas del mes)</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {share ? (
            <div className="grid gap-2 sm:grid-cols-4">
              <p>App conductor: <b>{share.app}</b> ({pct(share.app, share.entregados)})</p>
              <p>Quick: <b>{share.quick}</b> ({pct(share.quick, share.entregados)})</p>
              <p>Inferidas: <b>{share.inferidos}</b> ({pct(share.inferidos, share.entregados)})</p>
              <p>Total: <b>{share.entregados}</b></p>
            </div>
          ) : (
            <p className="text-muted-foreground">Sin datos.</p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">No entregas por motivo</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                {stats.reasons.length === 0 ? (
                  <TableRow><TableCell className="text-muted-foreground">Sin no entregas.</TableCell></TableRow>
                ) : (
                  stats.reasons.map(([r, n]) => (
                    <TableRow key={r}>
                      <TableCell>{r}</TableCell>
                      <TableCell className="text-right font-bold">{n}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Por conductor</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Conductor</TableHead>
                  <TableHead>Paradas</TableHead>
                  <TableHead>Efectividad</TableHead>
                  <TableHead>Tiempo prom.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.drivers.map((d) => (
                  <TableRow key={d.name}>
                    <TableCell>{d.name}</TableCell>
                    <TableCell>{d.stops}</TableCell>
                    <TableCell>{pct(d.ok, d.ok + d.not)} <span className="text-xs text-muted-foreground">({d.ok}/{d.ok + d.not})</span></TableCell>
                    <TableCell>{hoursLabel(d.avgHours)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Por tienda · meta {VISITS_PER_WEEK_GOAL} visitas por semana</CardTitle>
          <CardDescription>Visita = día con al menos una TF entregada.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tienda</TableHead>
                <TableHead>Visitas</TableHead>
                <TableHead>Visitas / semana</TableHead>
                <TableHead>Efectividad</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.stores.map((s) => (
                <TableRow key={s.name}>
                  <TableCell>{s.name}</TableCell>
                  <TableCell>{s.visits}</TableCell>
                  <TableCell>
                    <span className={cn('font-bold', s.perWeek >= VISITS_PER_WEEK_GOAL ? 'text-green-700' : 'text-red-700')}>
                      {s.perWeek.toFixed(1)}
                    </span>
                  </TableCell>
                  <TableCell>{pct(s.ok, s.ok + s.not)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

/** Escaneos de recibo en tienda de un día; las advertencias primero. */
function StoreReceiptsTab() {
  const [day, setDay] = useState(() => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10));
  const [rows, setRows] = useState<StoreReceipt[]>([]);
  const [loading, setLoading] = useState(false);
  const [onlyWarnings, setOnlyWarnings] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await getStoreReceipts({ day });
    setLoading(false);
    setRows(res.data || []);
  }, [day]);

  useEffect(() => {
    void load();
  }, [load]);

  const warnings = rows.filter((r) => r.result !== 'recibida');
  const shown = (onlyWarnings ? warnings : rows)
    .slice()
    .sort((a, b) => Number(a.result === 'recibida') - Number(b.result === 'recibida') || String(b.at).localeCompare(String(a.at)));
  const byStore = new Map<string, number>();
  rows.filter((r) => r.result === 'recibida').forEach((r) => byStore.set(r.storeName, (byStore.get(r.storeName) || 0) + 1));

  const exportXlsx = () => {
    const data = rows.map((r) => ({
      Hora: format(new Date(r.at), 'dd/MM/yyyy HH:mm:ss'),
      Tienda: r.storeName,
      Código: r.code,
      TF: r.numeroTF || '',
      'Código alterno': r.codigoAlterno || '',
      Unidades: r.unidades ?? '',
      Resultado: RECEIPT_LABEL[r.result]?.label || r.result,
      'Destino real': r.otherDestino || '',
      Usuario: r.byName,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Recibido');
    XLSX.writeFile(wb, `Recibido_tienda_${day}.xlsx`);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" className="w-44" value={day} onChange={(e) => setDay(e.target.value)} />
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={onlyWarnings} onCheckedChange={(v) => setOnlyWarnings(Boolean(v))} /> Solo advertencias
        </label>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />} Actualizar
        </Button>
        <Button variant="outline" size="sm" onClick={exportXlsx} disabled={!rows.length}>
          <Download className="mr-1 h-3.5 w-3.5" /> Excel
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        <b className="text-green-700">{rows.length - warnings.length}</b> recibida(s) ·{' '}
        <b className="text-red-700">{warnings.length}</b> advertencia(s)
        {byStore.size > 0 && ` · ${[...byStore.entries()].map(([s, n]) => `${s}: ${n}`).join(' · ')}`}
      </p>
      <div className="max-h-[60vh] overflow-auto rounded-md border">
        <Table>
          <TableHeader className="sticky top-0 bg-background">
            <TableRow>
              <TableHead>Hora</TableHead>
              <TableHead>Tienda</TableHead>
              <TableHead>Código</TableHead>
              <TableHead>TF</TableHead>
              <TableHead>Und</TableHead>
              <TableHead>Resultado</TableHead>
              <TableHead>Usuario</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  {loading ? <Loader2 className="inline h-5 w-5 animate-spin" /> : 'Sin escaneos este día.'}
                </TableCell>
              </TableRow>
            ) : (
              shown.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">{format(new Date(r.at), 'HH:mm:ss')}</TableCell>
                  <TableCell>{r.storeName}</TableCell>
                  <TableCell className="text-xs">{r.code}</TableCell>
                  <TableCell className="font-bold">{r.numeroTF || '—'}</TableCell>
                  <TableCell>{r.unidades ?? '—'}</TableCell>
                  <TableCell>
                    <Badge className={RECEIPT_LABEL[r.result]?.className}>{RECEIPT_LABEL[r.result]?.label || r.result}</Badge>
                    {r.otherDestino && <span className="ml-1 text-xs text-red-700">{r.otherDestino}</span>}
                  </TableCell>
                  <TableCell className="text-xs">{r.byName}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

type StatusFilter = 'todas' | DeliveryManifestStatus | 'novedad' | 'alerta';

/** Una fila por parada de las relaciones filtradas. */
function exportRelations(list: AdminManifest[], month: string) {
  const rows = list.flatMap((m) =>
    m.stops.map((s) => ({
      Relación: m.manifestId,
      Creada: fmt(m.createdAt),
      Placa: m.resource || '',
      Conductor: m.driver || '',
      'Estado relación': MANIFEST_STATUS[m.deliveryStatus || 'en_ruta'].label,
      'Anterior a la app': m.legacy ? 'Sí' : '',
      Tienda: s.storeName || s.destino,
      'Estado parada': STOP_STATUS_LABEL[s.status || 'pendiente'],
      'TF entregadas': s.deliveredTfs.join(', '),
      'TF no entregadas': s.notDeliveredTfs.map((tf) => `${tf} (${s.notDeliveredReasons?.[tf] || ''})`).join(', '),
      Unidades: s.unidades,
      Registrada: s.completedAt ? fmt(s.completedAt) : '',
      Registró: s.completedByName || '',
      'Quién recibió': s.receivedByName || '',
      'Distancia (m)': typeof s.distanceM === 'number' ? s.distanceM : '',
      'Alerta distancia': s.distanceAlert ? 'Sí' : '',
      Fotos: s.photos?.length || 0,
      'Fotos archivadas': s.photos?.filter((p) => p.archived).length || 0,
      Notas: s.notes || '',
      'Último rechazo': s.lastRejection ? `${s.lastRejection.byName}: ${s.lastRejection.note}` : '',
      'Recepción tienda': s.storeReception
        ? `${STORE_RECEPTION_LABEL[s.storeReception.status]}${s.storeReception.missingTfs?.length ? ` · Faltantes: ${s.storeReception.missingTfs.join(', ')}` : ''}${s.storeReception.note ? ` · ${s.storeReception.note}` : ''}`
        : '',
      Aprobada: m.validatedAt ? `${fmt(m.validatedAt)} · ${m.validatedByName || ''}` : '',
      'Cerrada sin app': m.closedWithoutApp ? `${fmt(m.closedAt)} · ${m.closedByName || ''} · ${m.closedNote || ''}` : '',
    }))
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Paradas');
  XLSX.writeFile(wb, `Entregas_${month}.xlsx`);
}

export const PodAdminModule: React.FC<{ onReturn: () => void }> = ({ onReturn }) => {
  const { user, userName, role } = useAuth();
  const { toast } = useToast();
  const actor: TransferActor | undefined = useMemo(
    () =>
      user?.uid
        ? { userId: user.uid, displayName: (userName || '').trim() || user.displayName || user.email || 'Usuario' }
        : undefined,
    [user, userName]
  );

  const [month, setMonth] = useState(() => format(new Date(), 'yyyy-MM'));
  const [manifests, setManifests] = useState<AdminManifest[]>([]);
  const [share, setShare] = useState<Share | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('todas');
  const [search, setSearch] = useState('');
  const [altTfs, setAltTfs] = useState<string[]>([]);
  const [selected, setSelected] = useState<AdminManifest | null>(null);
  const [noteRequest, setNoteRequest] = useState<NoteRequest | null>(null);

  const load = useCallback(async () => {
    const { from, to } = monthRange(month);
    setLoading(true);
    const [res, shareRes] = await Promise.all([
      getPodAdminManifests({ from: from.toISOString(), to: to.toISOString() }),
      getPodPlatformShare({ from: from.toISOString(), to: to.toISOString() }),
    ]);
    setLoading(false);
    if (res.error) toast({ variant: 'destructive', title: 'Error', description: res.error });
    setManifests(res.data || []);
    setShare(shareRes.data || null);
  }, [month, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const term = search.trim();
    if (term.length < 3) {
      setAltTfs([]);
      return;
    }
    const t = setTimeout(() => {
      findTfsByAltCode(term).then((r) => setAltTfs(r.data || []));
    }, 500);
    return () => clearTimeout(t);
  }, [search]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const tfDigits = term.replace(/\D/g, '');
    return manifests.filter((m) => {
      if (statusFilter === 'novedad' && !m.stops.some((s) => s.notDeliveredTfs.length > 0)) return false;
      if (statusFilter === 'alerta' && !m.stops.some((s) => s.distanceAlert)) return false;
      if (['en_ruta', 'pendiente_validacion', 'cerrada'].includes(statusFilter) && (m.deliveryStatus || 'en_ruta') !== statusFilter)
        return false;
      if (!term) return true;
      const text = [m.manifestId, m.resource, m.driver, ...m.stops.flatMap((s) => [s.storeName, s.destino, s.completedByName, s.receivedByName])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (text.includes(term)) return true;
      const tfs = m.stops.flatMap((s) => (s.numerosTF || []).map((tf) => String(tf).trim()));
      if (tfDigits && tfs.some((tf) => tf.replace(/\D/g, '') === tfDigits)) return true;
      return altTfs.length > 0 && tfs.some((tf) => altTfs.includes(tf));
    });
  }, [manifests, statusFilter, search, altTfs]);

  const counts = useMemo(
    () => ({
      en_ruta: manifests.filter((m) => (m.deliveryStatus || 'en_ruta') === 'en_ruta').length,
      pendiente_validacion: manifests.filter((m) => m.deliveryStatus === 'pendiente_validacion').length,
    }),
    [manifests]
  );

  if (!actor) return <p className="p-8 text-center text-muted-foreground">Inicie sesión.</p>;

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={onReturn}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Entregas · validación</h1>
            <p className="text-sm text-muted-foreground">
              {counts.pendiente_validacion} por validar · {counts.en_ruta} en ruta
            </p>
          </div>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <Label className="text-xs">Mes</Label>
            <Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="w-40" />
          </div>
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} /> Actualizar
          </Button>
        </div>
      </div>

      <Tabs defaultValue="relaciones">
        <TabsList>
          <TabsTrigger value="relaciones">Relaciones</TabsTrigger>
          <TabsTrigger value="novedades">Novedades</TabsTrigger>
          <TabsTrigger value="indicadores">Indicadores</TabsTrigger>
          <TabsTrigger value="tienda">Recibido en tienda</TabsTrigger>
          <TabsTrigger value="recolecciones">Recolecciones</TabsTrigger>
          <TabsTrigger value="respaldo">Respaldo de fotos</TabsTrigger>
        </TabsList>

        <TabsContent value="relaciones" className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-[260px] flex-1">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="TF, código alterno, tienda, conductor, placa o # relación"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas</SelectItem>
                <SelectItem value="pendiente_validacion">Por validar</SelectItem>
                <SelectItem value="en_ruta">En ruta</SelectItem>
                <SelectItem value="cerrada">Cerradas</SelectItem>
                <SelectItem value="novedad">Con novedades</SelectItem>
                <SelectItem value="alerta">Con alerta de distancia</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" disabled={filtered.length === 0} onClick={() => exportRelations(filtered, month)}>
              <Download className="mr-2 h-4 w-4" /> Exportar Excel
            </Button>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Relación</TableHead>
                  <TableHead>Creada</TableHead>
                  <TableHead>Placa</TableHead>
                  <TableHead>Conductor</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Paradas</TableHead>
                  <TableHead>Alertas</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                      {loading ? 'Cargando…' : 'No hay relaciones con ese filtro.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((m) => {
                    const st = m.deliveryStatus || 'en_ruta';
                    const done = m.stops.filter((s) => s.status !== 'pendiente').length;
                    const novedades = m.stops.reduce((n, s) => n + s.notDeliveredTfs.length, 0);
                    const alerts = m.stops.filter((s) => s.distanceAlert).length;
                    return (
                      <TableRow key={m.id} className="cursor-pointer" onClick={() => setSelected(m)}>
                        <TableCell className="font-bold">
                          #{m.manifestId}
                          {m.legacy && <Badge variant="outline" className="ml-2 text-[10px]">Anterior a la app</Badge>}
                        </TableCell>
                        <TableCell className="text-xs">{fmt(m.createdAt, 'dd/MM HH:mm')}</TableCell>
                        <TableCell>{m.resource || '—'}</TableCell>
                        <TableCell>{m.driver || '—'}</TableCell>
                        <TableCell>
                          <Badge className={MANIFEST_STATUS[st].className}>{MANIFEST_STATUS[st].label}</Badge>
                          {m.closedWithoutApp && <span className="ml-1 text-[10px] text-muted-foreground">sin app</span>}
                        </TableCell>
                        <TableCell>
                          {done}/{m.stops.length}
                        </TableCell>
                        <TableCell className="text-xs">
                          {novedades > 0 && <span className="mr-2 text-red-700">{novedades} no entregada(s)</span>}
                          {alerts > 0 && (
                            <span className="text-amber-700">
                              <AlertTriangle className="mr-0.5 inline h-3.5 w-3.5" />
                              {alerts} distancia
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button size="sm" variant="outline">Ver</Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="novedades">
          <NovedadesTab actor={actor} askNote={setNoteRequest} />
        </TabsContent>

        <TabsContent value="indicadores">
          <IndicatorsTab manifests={manifests} month={month} share={share} />
        </TabsContent>

        <TabsContent value="tienda">
          <StoreReceiptsTab />
        </TabsContent>

        <TabsContent value="recolecciones">
          <RouteTasksAdminTab />
        </TabsContent>

        <TabsContent value="respaldo">
          <PodArchiveTab actor={actor} isAdmin={role === 'admin'} />
        </TabsContent>
      </Tabs>

      {selected && (
        <ManifestDetail
          manifest={selected}
          actor={actor}
          onClose={() => setSelected(null)}
          onChanged={() => void load()}
          askNote={setNoteRequest}
        />
      )}
      <NoteDialog request={noteRequest} onClose={() => setNoteRequest(null)} />
    </div>
  );
};

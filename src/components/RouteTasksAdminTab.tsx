"use client";

import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { CheckCircle2, Download, Loader2, Search, Undo2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth-context';
import { useToast } from '@/hooks/use-toast';
import { getRouteTasksByRange, markRouteTasksRevalidated, rejectRouteTaskDelivery } from '@/app/routeTaskActions';
import { ROUTE_TASK_STATUS } from '@/components/RouteTasksAssignView';
import { deliverOrderOf } from '@/components/DriverRouteTasks';
import { downloadMessengerRouteExcel } from '@/lib/messengerRouteExcel';
import type { DriverRouteTask, DriverRouteTaskPhoto, DriverRouteTaskStatus, TransferActor } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

const fmt = (d?: Date) => (d ? format(new Date(d), 'dd/MM HH:mm') : '');

const Photos: React.FC<{ list?: DriverRouteTaskPhoto[] }> = ({ list }) =>
  list?.length ? (
    <div className="flex gap-1">
      {list.slice(0, 4).map((p) => (
        <a key={p.path} href={p.url} target="_blank" rel="noreferrer" className="h-9 w-9 overflow-hidden rounded border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.url} alt={p.category || 'foto'} className="h-full w-full object-cover" />
        </a>
      ))}
      {list.length > 4 && <span className="text-xs text-muted-foreground">+{list.length - 4}</span>}
    </div>
  ) : null;

type StopLine = { task: DriverRouteTask; kind: 'recoger' | 'entregar'; state: 'hecho' | 'novedad' | 'pendiente' | 'bloqueada'; order: number };
type DriverRoute = {
  key: string;
  driverId: string;
  driverName: string;
  placa: string;
  day: string;
  total: number;
  picked: number;
  withPickup: number;
  delivered: number;
  pending: number;
  failed: number;
  lastAt?: Date;
  stops: Array<{ n: number; point: string; lines: StopLine[] }>;
};

const routeKey = (t: DriverRouteTask) => `${t.day}|${t.driverId}`;

/** Avance por mensajero y día, con sus paradas en el orden del planificador (sin lecturas extra). */
function buildDriverRoutes(tasks: DriverRouteTask[]): DriverRoute[] {
  const byKey = new Map<string, DriverRouteTask[]>();
  tasks
    .filter((t) => t.status !== 'cancelada')
    .forEach((t) => byKey.set(routeKey(t), [...(byKey.get(routeKey(t)) || []), t]));
  return Array.from(byKey.entries())
    .map(([key, list]) => {
      const lines: Array<StopLine & { point: string }> = [];
      list.forEach((t) => {
        if (t.pickupPoint) {
          lines.push({
            task: t,
            kind: 'recoger',
            point: t.pickupPoint,
            order: t.order ?? 9999,
            state: t.pickedAt ? 'hecho' : t.status === 'no_recogida' ? 'novedad' : 'pendiente',
          });
        }
        if (t.status === 'no_recogida') return;
        lines.push({
          task: t,
          kind: 'entregar',
          point: t.deliverPoint,
          order: deliverOrderOf(t),
          state:
            t.status === 'entregada' ? 'hecho' : t.status === 'no_entregada' ? 'novedad' : t.status === 'por_recoger' ? 'bloqueada' : 'pendiente',
        });
      });
      const pointOrder = new Map<string, number>();
      lines.forEach((l) => pointOrder.set(l.point, Math.min(pointOrder.get(l.point) ?? 9999, l.order)));
      const points = Array.from(pointOrder.keys()).sort((a, b) => pointOrder.get(a)! - pointOrder.get(b)! || a.localeCompare(b));
      const stops = points.map((point, i) => ({
        n: i + 1,
        point,
        lines: lines
          .filter((l) => l.point === point)
          .sort((a, b) => a.order - b.order || (a.kind === 'recoger' ? -1 : 1)),
      }));
      const times = list
        .flatMap((t) => [t.pickedAt, t.deliveredAt, t.failedAt])
        .filter(Boolean)
        .map((d) => new Date(d as Date).getTime());
      return {
        key,
        driverId: list[0].driverId,
        driverName: list[0].driverName,
        placa: list[0].placa,
        day: list[0].day,
        total: list.length,
        picked: list.filter((t) => !!t.pickedAt).length,
        withPickup: list.filter((t) => !!t.pickupPoint).length,
        delivered: list.filter((t) => t.status === 'entregada').length,
        pending: list.filter((t) => t.status === 'por_recoger' || t.status === 'por_entregar').length,
        failed: list.filter((t) => t.status === 'no_recogida' || t.status === 'no_entregada').length,
        lastAt: times.length ? new Date(Math.max(...times)) : undefined,
        stops,
      };
    })
    .sort((a, b) => b.day.localeCompare(a.day) || a.driverName.localeCompare(b.driverName));
}

const LINE_STATE: Record<StopLine['state'], string> = {
  hecho: 'text-green-700',
  novedad: 'text-red-700',
  pendiente: 'text-amber-700',
  bloqueada: 'text-muted-foreground',
};

function lineText(l: StopLine): string {
  const t = l.task;
  const what = t.kind === 'libre' ? `${t.description || t.numeroTF}` : `TF ${t.numeroTF}`;
  if (l.kind === 'recoger') {
    if (l.state === 'hecho') return `Recogió ${what} · ${fmt(t.pickedAt)}`;
    if (l.state === 'novedad') return `No recogió ${what} · ${t.failReason || ''}`;
    return `Por recoger ${what} (→ ${t.deliverPoint})`;
  }
  if (l.state === 'hecho' && t.leftInCajon) return `Dejó ${what} en el cajón · ${fmt(t.deliveredAt)}`;
  if (l.state === 'hecho') return `Entregó ${what} · ${fmt(t.deliveredAt)}${t.receivedByName ? ` · recibió ${t.receivedByName}` : ''}`;
  if (l.state === 'novedad') return `No entregó ${what} · ${t.failReason || ''}`;
  if (l.state === 'bloqueada') return `Entregar ${what} (falta recogerla en ${t.pickupPoint})`;
  return `Por entregar ${what}`;
}

const REJECTABLE: DriverRouteTaskStatus[] = ['entregada', 'no_entregada', 'no_recogida'];

/** Recolecciones de ruta por día: 1 consulta por día (sin carga automática). */
export function RouteTasksAdminTab() {
  const { toast } = useToast();
  const { user, userName } = useAuth();
  const actor: TransferActor | undefined = useMemo(
    () => (user?.uid ? { userId: user.uid, displayName: (userName || user.displayName || user.email || '').trim() || user.uid } : undefined),
    [user, userName]
  );
  const [from, setFrom] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [to, setTo] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [text, setText] = useState('');
  const [tasks, setTasks] = useState<DriverRouteTask[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<DriverRouteTaskStatus | 'todas' | 'por_revalidar'>('todas');
  const [routeSel, setRouteSel] = useState<string | null>(null);
  const day = from === to ? from : `${from}_a_${to}`;

  const load = async () => {
    setLoading(true);
    const res = await getRouteTasksByRange(from, to);
    setLoading(false);
    if (res.error) toast({ variant: 'destructive', title: 'Error', description: res.error });
    setTasks(res.data || []);
    setRouteSel(null);
  };

  const rejectTask = async (t: DriverRouteTask) => {
    if (!actor) {
      toast({ variant: 'destructive', title: 'Sesión', description: 'Inicie sesión para rechazar.' });
      return;
    }
    const note = window.prompt(
      `Motivo del rechazo para ${t.driverName} (TF ${t.kind === 'libre' ? t.description || t.numeroTF : t.numeroTF}).\nEl mensajero deberá registrar de nuevo esta entrega.`
    );
    if (note === null) return;
    if (!String(note).trim()) {
      toast({ variant: 'destructive', title: 'Motivo obligatorio', description: 'Escriba el motivo del rechazo.' });
      return;
    }
    setRejectingId(t.id);
    const res = await rejectRouteTaskDelivery({ taskIds: [t.id], note: String(note).trim(), actor });
    setRejectingId(null);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'No se pudo rechazar', description: res.error });
      return;
    }
    toast({
      title: 'Entrega rechazada',
      description: 'Volvió a Mis entregas del mensajero para que la cierre bien. No podrá montar ruta de un día nuevo mientras tenga esta pendiente.',
    });
    void load();
  };

  const markReviewed = async (t: DriverRouteTask) => {
    if (!actor) return;
    setMarkingId(t.id);
    const res = await markRouteTasksRevalidated({ taskIds: [t.id], actor });
    setMarkingId(null);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'No se pudo marcar', description: res.error });
      return;
    }
    toast({ title: 'Revisada', description: 'Ya no aparece en “Por revalidar”.' });
    void load();
  };

  const markAllPendingReviewed = async () => {
    if (!actor) return;
    const ids = (tasks || []).filter((t) => t.pendingRevalidation).map((t) => t.id);
    if (!ids.length) return;
    if (!window.confirm(`¿Marcar ${ids.length} prueba(s) reenviada(s) como revisadas?`)) return;
    setMarkingId('all');
    const res = await markRouteTasksRevalidated({ taskIds: ids, actor });
    setMarkingId(null);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'No se pudo marcar', description: res.error });
      return;
    }
    toast({ title: 'Revisadas', description: `${res.updated || 0} prueba(s) marcadas.` });
    void load();
  };

  const kpi = useMemo(() => {
    const c: Record<DriverRouteTaskStatus, number> = { por_recoger: 0, por_entregar: 0, entregada: 0, no_recogida: 0, no_entregada: 0, cancelada: 0 };
    (tasks || []).forEach((t) => c[t.status]++);
    const assigned = (tasks || []).filter((t) => t.status !== 'cancelada').length;
    const picked = (tasks || []).filter((t) => !!t.pickedAt).length;
    const withPickup = (tasks || []).filter((t) => !!t.pickupPoint && t.status !== 'cancelada').length;
    const pendingRevalidation = (tasks || []).filter((t) => t.pendingRevalidation).length;
    return { c, assigned, picked, withPickup, pendingRevalidation };
  }, [tasks]);

  const routes = useMemo(() => buildDriverRoutes(tasks || []), [tasks]);
  const selectedRoute = routes.find((r) => r.key === routeSel);

  const needle = text.trim().toUpperCase();
  const visible = (tasks || []).filter(
    (t) =>
      (!routeSel || routeKey(t) === routeSel) &&
      (filter === 'todas' ||
        (filter === 'por_revalidar' ? !!t.pendingRevalidation : t.status === filter)) &&
      (!needle ||
        [t.numeroTF, t.description, t.refText, t.pickupPoint, t.deliverPoint, t.driverName, t.placa, t.receivedByName, t.notes]
          .some((v) => String(v || '').toUpperCase().includes(needle)))
  );

  const exportXlsx = () => {
    const rows = visible.map((t) => ({
      Día: t.day,
      Tipo: t.kind === 'libre' ? 'Sin TF' : 'TF',
      'TF / código': t.numeroTF,
      Descripción: t.description || '',
      Conductor: t.driverName,
      Placa: t.placa,
      Origen: t.source,
      Recoger: t.pickupPoint || '',
      Entregar: t.deliverPoint,
      Estado: ROUTE_TASK_STATUS[t.status].label,
      Recogida: fmt(t.pickedAt),
      Entregada: fmt(t.deliveredAt),
      'Recibió': t.receivedByName || '',
      'TF marcada entregada': t.tfMarkedDelivered ? 'Sí' : '',
      'Dejada en cajón': t.leftInCajon ? 'Sí' : '',
      'Por revalidar': t.pendingRevalidation ? 'Sí' : '',
      'Reenviada tras rechazo': fmt(t.resentAfterRejectionAt),
      'Motivo rechazo': t.lastRejection?.note || '',
      'Distancia (m)': t.distanceM ?? '',
      Motivo: t.failReason || '',
      Unidades: t.unidades,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Recolecciones');
    XLSX.writeFile(wb, `Recolecciones_ruta_${day}.xlsx`);
  };

  /** Misma estructura que el Excel del planificador (FECHA, NUMERO TF, Atributo, Valor, ORDEN, FIRMA). */
  const exportMessengerRouteExcel = (driverFilter?: { driverId: string; driverName: string; day: string }) => {
    // Sin filtro explícito: usa el mensajero seleccionado en “Avance”. No mezcla los 3.
    const effective =
      driverFilter ||
      (selectedRoute
        ? { driverId: selectedRoute.driverId, driverName: selectedRoute.driverName, day: selectedRoute.day }
        : undefined);

    if (!effective) {
      const driversInView = new Set(visible.map((t) => t.driverId)).size;
      if (driversInView > 1) {
        toast({
          variant: 'destructive',
          title: 'Elija un mensajero',
          description: `Hay ${driversInView} mensajeros en la consulta (${visible.length} envíos). Pulse su tarjeta en “Avance por mensajero” y luego Excel ruta mensajero. Cada envío genera fila RECOGER + ENTREGAR.`,
        });
        return;
      }
    }

    const list = effective
      ? (tasks || []).filter((t) => t.driverId === effective.driverId && t.day === effective.day)
      : visible;
    const res = downloadMessengerRouteExcel(list, {
      fileName: effective
        ? `RUTA_DEL_MENSAJERO_${effective.day}_${effective.driverName.replace(/\s+/g, '_')}.xlsx`
        : `RUTA_DEL_MENSAJERO_${from === to ? from : `${from}_${to}`}.xlsx`,
    });
    if (!res.ok) toast({ variant: 'destructive', title: 'Excel ruta mensajero', description: res.error });
    else {
      toast({
        title: `Excel · ${effective?.driverName || 'ruta'}`,
        description: `${res.taskCount} envío(s) → ${res.rows} fila(s) (RECOGER + ENTREGAR, como el Excel del planificador).`,
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recolecciones de ruta</CardTitle>
        <CardDescription>
          Rechazar → el mensajero reenvía → aparece en <strong>Por revalidar</strong> para revisar solo esas. Mientras tenga día anterior abierto no se monta ruta nueva.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <Input type="date" className="w-44" value={from} onChange={(e) => setFrom(e.target.value)} title="Desde" />
          <Input type="date" className="w-44" value={to} onChange={(e) => setTo(e.target.value)} title="Hasta (máx. 31 días)" />
          <Button onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />} Consultar
          </Button>
          {tasks && (
            <Input
              className="w-72"
              placeholder="Buscar: TF, código MSJ, descripción, punto, conductor…"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          )}
          {tasks && tasks.length > 0 && (
            <>
              <Button variant="secondary" onClick={() => exportMessengerRouteExcel()}>
                <Download className="mr-2 h-4 w-4" /> Excel ruta mensajero
              </Button>
              <Button variant="outline" onClick={exportXlsx}>
                <Download className="mr-2 h-4 w-4" /> Excel detalle
              </Button>
            </>
          )}
        </div>
        {tasks && (
          <>
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {[
                ['Asignadas', kpi.assigned, ''],
                ['Recogidas', `${kpi.picked}/${kpi.withPickup}`, 'text-indigo-700'],
                ['No recogidas', kpi.c.no_recogida, 'text-red-700'],
                ['Entregadas', kpi.c.entregada, 'text-green-700'],
                ['No entregadas', kpi.c.no_entregada, 'text-orange-700'],
                ['Pendientes', kpi.c.por_recoger + kpi.c.por_entregar, 'text-blue-700'],
              ].map(([label, value, cls]) => (
                <div key={String(label)} className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className={`text-2xl font-bold ${cls}`}>{value}</p>
                </div>
              ))}
            </div>
            {routes.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-semibold">Avance por mensajero</p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {routes.map((r) => {
                    const done = r.pending === 0;
                    const sel = routeSel === r.key;
                    return (
                      <button
                        key={r.key}
                        type="button"
                        onClick={() => setRouteSel(sel ? null : r.key)}
                        className={`rounded-md border p-3 text-left transition ${sel ? 'border-blue-600 ring-2 ring-blue-200' : 'hover:bg-muted/50'}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-semibold">{r.driverName}</p>
                            <p className="text-xs text-muted-foreground">
                              {r.placa}
                              {from !== to ? ` · ${r.day}` : ''}
                              {r.lastAt ? ` · último registro ${fmt(r.lastAt)}` : ''}
                            </p>
                          </div>
                          <Badge
                            className={
                              !done ? 'bg-amber-500 text-white' : r.failed > 0 ? 'bg-orange-600 text-white' : 'bg-green-600 text-white'
                            }
                          >
                            {!done ? `Faltan ${r.pending}` : r.failed > 0 ? 'Finalizada con novedades' : 'Ruta completa'}
                          </Badge>
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded bg-muted">
                          <div className="h-full bg-green-600" style={{ width: `${Math.round(((r.total - r.pending) / r.total) * 100)}%` }} />
                        </div>
                        <p className="mt-2 text-xs">
                          {r.total} TF/envíos · recogidas {r.picked}/{r.withPickup} · entregadas {r.delivered}
                          {r.failed > 0 && <span className="text-red-700"> · {r.failed} novedad(es)</span>}
                        </p>
                      </button>
                    );
                  })}
                </div>
                {selectedRoute && (
                  <div className="space-y-2 rounded-md border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold">
                        Ruta de {selectedRoute.driverName} · {selectedRoute.day}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">La tabla de abajo quedó filtrada a este mensajero.</span>
                      </p>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          exportMessengerRouteExcel({
                            driverId: selectedRoute.driverId,
                            driverName: selectedRoute.driverName,
                            day: selectedRoute.day,
                          })
                        }
                      >
                        <Download className="mr-1 h-3.5 w-3.5" /> Excel ruta mensajero
                      </Button>
                    </div>
                    {selectedRoute.stops.map((s) => (
                      <div key={s.point} className="rounded border p-2">
                        <p className="text-xs font-semibold uppercase text-muted-foreground">
                          Parada {s.n} · <span className="text-foreground">{s.point}</span>
                        </p>
                        <ul className="mt-1 space-y-0.5 text-xs">
                          {s.lines.map((l) => (
                            <li key={`${l.task.id}-${l.kind}`} className={LINE_STATE[l.state]}>
                              {l.state === 'hecho' ? '✓ ' : l.state === 'novedad' ? '✗ ' : '○ '}
                              {lineText(l)}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={filter === 'todas' ? 'default' : 'outline'} className="cursor-pointer" onClick={() => setFilter('todas')}>Todas ({tasks.length})</Badge>
              <Badge
                variant="outline"
                className={cn(
                  'cursor-pointer',
                  filter === 'por_revalidar' ? 'bg-violet-600 text-white' : 'border-violet-400 text-violet-800'
                )}
                onClick={() => setFilter('por_revalidar')}
              >
                Por revalidar ({kpi.pendingRevalidation})
              </Badge>
              {(Object.keys(ROUTE_TASK_STATUS) as DriverRouteTaskStatus[]).map((s) => (
                <Badge
                  key={s}
                  variant="outline"
                  className={`cursor-pointer ${filter === s ? ROUTE_TASK_STATUS[s].className : ''}`}
                  onClick={() => setFilter(s)}
                >
                  {ROUTE_TASK_STATUS[s].label} ({kpi.c[s]})
                </Badge>
              ))}
              {kpi.pendingRevalidation > 0 && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="ml-auto"
                  disabled={markingId === 'all' || !actor}
                  onClick={() => void markAllPendingReviewed()}
                >
                  {markingId === 'all' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1 h-3.5 w-3.5" />}
                  Marcar todas revisadas
                </Button>
              )}
            </div>
            {filter === 'por_revalidar' && (
              <p className="text-xs text-violet-800">
                Solo pruebas que el mensajero envió de nuevo después de un rechazo. Revise fotos y marque “Revisada”.
              </p>
            )}
            <div className="max-h-[60vh] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>TF</TableHead>
                    <TableHead>Conductor</TableHead>
                    <TableHead>Recoger</TableHead>
                    <TableHead>Entregar</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Recogida</TableHead>
                    <TableHead>Entrega</TableHead>
                    <TableHead>Motivo / detalle</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.length === 0 ? (
                    <TableRow><TableCell colSpan={9} className="h-16 text-center text-muted-foreground">Sin tareas.</TableCell></TableRow>
                  ) : (
                    visible.map((t) => (
                      <TableRow key={t.id} className={cn(t.pendingRevalidation && 'bg-violet-50')}>
                        <TableCell className="font-medium">
                          {t.kind === 'libre' ? t.description : t.numeroTF}
                          <span className="block text-xs text-muted-foreground">
                            {t.kind === 'libre' ? `Sin TF · ${t.numeroTF}` : `${t.unidades} und`}
                            {from !== to ? ` · ${t.day}` : ''}
                          </span>
                          {t.pendingRevalidation && (
                            <Badge className="mt-1 bg-violet-600 text-white">Reenviada · por validar</Badge>
                          )}
                        </TableCell>
                        <TableCell>{t.driverName}<span className="block text-xs text-muted-foreground">{t.placa}</span></TableCell>
                        <TableCell>{t.pickupPoint || '—'}</TableCell>
                        <TableCell>{t.deliverPoint}</TableCell>
                        <TableCell><Badge className={ROUTE_TASK_STATUS[t.status].className}>{ROUTE_TASK_STATUS[t.status].label}</Badge></TableCell>
                        <TableCell className="text-xs">
                          {fmt(t.pickedAt)}
                          <Photos list={t.pickupPhotos} />
                        </TableCell>
                        <TableCell className="text-xs">
                          {fmt(t.deliveredAt)}
                          {t.resentAfterRejectionAt && (
                            <span className="block font-medium text-violet-800">Reenviada {fmt(t.resentAfterRejectionAt)}</span>
                          )}
                          {t.receivedByName && <span className="block">Recibió: {t.receivedByName}</span>}
                          {typeof t.distanceM === 'number' && <span className="block text-muted-foreground">a {t.distanceM} m</span>}
                          {t.tfMarkedDelivered && <span className="block text-green-700">TF entregada en plataforma</span>}
                          {t.leftInCajon && <span className="block font-medium text-amber-700">Dejada en CAJON NORTE</span>}
                          <Photos list={t.deliveryPhotos} />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {t.failReason ? `${t.failReason}${t.failedByName ? ` (${t.failedByName})` : ''}` : t.notes || ''}
                          {t.lastRejection && (
                            <span className="mt-1 block text-red-700">
                              Rechazo previo: {t.lastRejection.note}
                              {t.lastRejection.byName ? ` (${t.lastRejection.byName})` : ''}
                            </span>
                          )}
                          {t.revalidatedAt && (
                            <span className="mt-1 block text-green-700">
                              Revisada {fmt(t.revalidatedAt)}
                              {t.revalidatedByName ? ` · ${t.revalidatedByName}` : ''}
                            </span>
                          )}
                          {t.reassignedTo && <span className="block">Reasignada</span>}
                        </TableCell>
                        <TableCell className="space-y-1 text-right">
                          {t.pendingRevalidation && (
                            <Button
                              size="sm"
                              variant="secondary"
                              className="w-full"
                              disabled={markingId === t.id || !actor}
                              onClick={() => void markReviewed(t)}
                            >
                              {markingId === t.id ? (
                                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                              )}
                              Revisada
                            </Button>
                          )}
                          {REJECTABLE.includes(t.status) && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="w-full text-red-700"
                              disabled={rejectingId === t.id || !actor}
                              onClick={() => void rejectTask(t)}
                            >
                              {rejectingId === t.id ? (
                                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Undo2 className="mr-1 h-3.5 w-3.5" />
                              )}
                              Rechazar
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

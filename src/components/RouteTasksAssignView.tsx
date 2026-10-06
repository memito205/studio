"use client";

import React, { useCallback, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Ban, Loader2, RefreshCw, Search, Send, Shuffle } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth-context';
import { useToast } from '@/hooks/use-toast';
import { getTransfersByStatus } from '@/app/actions';
import { getDeliveryStores } from '@/app/deliveryActions';
import { cancelRouteTasks, createRouteTasks, getRouteTasksByDay, reassignRouteTasks } from '@/app/routeTaskActions';
import { DriverUserSelect, type DriverValue } from '@/components/DriverUserSelect';
import type { DeliveryStore, DriverRouteTask, DriverRouteTaskStatus, TransferActor, TransferEntry } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export const ROUTE_TASK_STATUS: Record<DriverRouteTaskStatus, { label: string; className: string }> = {
  por_recoger: { label: 'Por recoger', className: 'bg-blue-600 text-white' },
  por_entregar: { label: 'Recogida / por entregar', className: 'bg-indigo-600 text-white' },
  entregada: { label: 'Entregada', className: 'bg-green-600 text-white' },
  no_recogida: { label: 'No recogida', className: 'bg-red-600 text-white' },
  no_entregada: { label: 'No entregada', className: 'bg-orange-600 text-white' },
  cancelada: { label: 'Cancelada', className: 'bg-slate-400 text-white' },
};

type TfGroup = { key: string; numeroTF: string; bodegaOrigen: string; bodegaDestino: string; ids: string[]; unidades: number };
type DeliverTo = 'bodega' | 'destino' | 'otra';
const ALL = '__todas__';

export const RouteTasksAssignView: React.FC = () => {
  const { user, userName } = useAuth();
  const { toast } = useToast();
  const actor: TransferActor | undefined = useMemo(
    () => (user?.uid ? { userId: user.uid, displayName: (userName || '').trim() || user.displayName || user.email || 'Usuario' } : undefined),
    [user, userName]
  );
  const [search, setSearch] = useState('');
  const [fOrigin, setFOrigin] = useState(ALL);
  const [fDest, setFDest] = useState(ALL);
  const [lines, setLines] = useState<TransferEntry[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [driver, setDriver] = useState<DriverValue>({ driver: '' });
  const [placa, setPlaca] = useState('');
  const [day, setDay] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [deliverTo, setDeliverTo] = useState<DeliverTo>('bodega');
  const [otherStore, setOtherStore] = useState('');
  const [stores, setStores] = useState<DeliveryStore[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [dayTasks, setDayTasks] = useState<DriverRouteTask[] | null>(null);
  const [loadingDay, setLoadingDay] = useState(false);
  const [taskSel, setTaskSel] = useState<Set<string>>(new Set());
  const [free, setFree] = useState({ description: '', pickup: '', deliver: '', notes: '' });
  const [savingFree, setSavingFree] = useState(false);

  const handleAddFree = async () => {
    if (!actor || !driverReady) return;
    setSavingFree(true);
    const res = await createRouteTasks({
      tasks: [{
        kind: 'libre',
        description: free.description.trim(),
        pickupPoint: free.pickup.trim() || undefined,
        deliverPoint: free.deliver.trim(),
        notes: free.notes.trim() || undefined,
      }],
      driverId: driver.driverUserId!,
      driverName: driver.driver,
      placa,
      day,
      source: 'transferencias',
      actor,
    });
    setSavingFree(false);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'No se creó', description: res.error });
      return;
    }
    toast({ title: 'Envío sin TF asignado', description: `${free.description} · ${driver.driver}` });
    setFree({ description: '', pickup: '', deliver: '', notes: '' });
    void loadDay(day);
  };

  const groups = useMemo(() => {
    const map = new Map<string, TfGroup>();
    lines.forEach((t) => {
      const key = `${t.numeroTF}|${t.bodegaOrigen}|${t.bodegaDestino}`;
      const g = map.get(key) || { key, numeroTF: t.numeroTF, bodegaOrigen: t.bodegaOrigen, bodegaDestino: t.bodegaDestino, ids: [], unidades: 0 };
      g.ids.push(t.id);
      g.unidades += Number(t.cantidad) || 0;
      map.set(key, g);
    });
    return Array.from(map.values()).sort((a, b) => a.numeroTF.localeCompare(b.numeroTF, undefined, { numeric: true }));
  }, [lines]);

  const origins = useMemo(() => Array.from(new Set(groups.map((g) => g.bodegaOrigen))).sort(), [groups]);
  const destinations = useMemo(() => Array.from(new Set(groups.map((g) => g.bodegaDestino))).sort(), [groups]);
  const visibleGroups = useMemo(() => {
    const tf = search.trim().toUpperCase();
    return groups.filter(
      (g) =>
        (fOrigin === ALL || g.bodegaOrigen === fOrigin) &&
        (fDest === ALL || g.bodegaDestino === fDest) &&
        (!tf || g.numeroTF.toUpperCase().includes(tf))
    );
  }, [groups, fOrigin, fDest, search]);
  const allVisibleSelected = visibleGroups.length > 0 && visibleGroups.every((g) => selected.has(g.key));
  const selectedUnits = groups.filter((g) => selected.has(g.key)).reduce((n, g) => n + g.unidades, 0);

  /** Trae todas las TF En Tránsito una vez (~800 líneas); los filtros trabajan en pantalla sin nuevas lecturas. */
  const loadInTransit = async () => {
    setSearching(true);
    const res = await getTransfersByStatus('En Tránsito', 3000);
    setSearching(false);
    if (res.error) {
      toast({ variant: 'destructive', title: 'Error', description: res.error });
      return;
    }
    setLines(res.data || []);
    setSelected(new Set());
    setFOrigin(ALL);
    setFDest(ALL);
    if (!res.data?.length) toast({ title: 'Sin resultados', description: 'No hay TF En Tránsito.' });
  };

  const toggleVisible = (on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      visibleGroups.forEach((g) => (on ? next.add(g.key) : next.delete(g.key)));
      return next;
    });

  const ensureStores = async () => {
    if (stores) return;
    const res = await getDeliveryStores();
    setStores((res.data || []).filter((s) => s.activo !== false).sort((a, b) => a.nombreCorto.localeCompare(b.nombreCorto)));
  };

  const loadDay = useCallback(async (d: string) => {
    setLoadingDay(true);
    const res = await getRouteTasksByDay(d);
    setLoadingDay(false);
    if (res.error) toast({ variant: 'destructive', title: 'Error', description: res.error });
    setDayTasks(res.data || []);
    setTaskSel(new Set());
  }, [toast]);

  const driverReady = !!driver.driverUserId && placa.trim().length >= 3 && !!day;

  const handleAssign = async () => {
    if (!actor || !driverReady) return;
    if (deliverTo === 'otra' && !otherStore) {
      toast({ variant: 'destructive', title: 'Elija la tienda de entrega.' });
      return;
    }
    const chosen = groups.filter((g) => selected.has(g.key));
    setSaving(true);
    const res = await createRouteTasks({
      tasks: chosen.map((g) => ({
        numeroTF: g.numeroTF,
        transferIds: g.ids,
        pickupPoint: g.bodegaOrigen,
        deliverPoint: deliverTo === 'bodega' ? 'BODEGA' : deliverTo === 'destino' ? g.bodegaDestino : otherStore,
      })),
      driverId: driver.driverUserId!,
      driverName: driver.driver,
      placa,
      day,
      source: 'transferencias',
      actor,
    });
    setSaving(false);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'No se asignó', description: res.error });
      return;
    }
    toast({
      title: `${res.created} TF asignadas a ${driver.driver}`,
      description: res.skipped?.length ? `Omitidas: ${res.skipped.map((s) => `TF ${s.numeroTF} (${s.reason})`).join(', ')}` : undefined,
    });
    const skippedTfs = new Set((res.skipped || []).map((s) => s.numeroTF));
    const assignedIds = new Set(chosen.filter((g) => !skippedTfs.has(g.numeroTF)).flatMap((g) => g.ids));
    setLines((prev) => prev.filter((l) => !assignedIds.has(l.id)));
    setSelected(new Set());
    void loadDay(day);
  };

  const handleCancel = async () => {
    if (!actor || taskSel.size === 0) return;
    const res = await cancelRouteTasks({ taskIds: Array.from(taskSel), actor });
    if (!res.success) toast({ variant: 'destructive', title: 'Error', description: res.error });
    else toast({ title: `${res.cancelled} tarea(s) cancelada(s)` });
    void loadDay(day);
  };

  const handleReassign = async () => {
    if (!actor || taskSel.size === 0 || !driverReady) return;
    const res = await reassignRouteTasks({ taskIds: Array.from(taskSel), driverId: driver.driverUserId!, driverName: driver.driver, placa, day, actor });
    if (!res.success) toast({ variant: 'destructive', title: 'No se reasignó', description: res.error });
    else toast({ title: `${res.created} TF reasignadas a ${driver.driver} (${day})` });
    void loadDay(day);
  };

  const kpi = useMemo(() => {
    const c: Record<DriverRouteTaskStatus, number> = { por_recoger: 0, por_entregar: 0, entregada: 0, no_recogida: 0, no_entregada: 0, cancelada: 0 };
    (dayTasks || []).forEach((t) => c[t.status]++);
    return c;
  }, [dayTasks]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Asignar recolecciones a ruta</CardTitle>
          <CardDescription>
            Busque TF En Tránsito, elija conductor (usuario con app), placa, día y a dónde se entregan. Le aparecen en &quot;Mis entregas&quot;.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1">
              <Label>Conductor *</Label>
              <DriverUserSelect value={driver} onChange={setDriver} />
              {driver.driver && !driver.driverUserId && <p className="text-xs text-red-600">Debe ser un usuario conductor para que le aparezca en la app.</p>}
            </div>
            <div className="space-y-1">
              <Label>Placa *</Label>
              <Input value={placa} onChange={(e) => setPlaca(e.target.value.toUpperCase())} placeholder="ABC123" />
            </div>
            <div className="space-y-1">
              <Label>Día *</Label>
              <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Entregar en</Label>
              <Select value={deliverTo} onValueChange={(v) => { setDeliverTo(v as DeliverTo); if (v === 'otra') void ensureStores(); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bodega">Bodega (recepción normal)</SelectItem>
                  <SelectItem value="destino">Tienda destino de la TF</SelectItem>
                  <SelectItem value="otra">Otra tienda</SelectItem>
                </SelectContent>
              </Select>
              {deliverTo === 'otra' && (
                <Select value={otherStore} onValueChange={setOtherStore}>
                  <SelectTrigger><SelectValue placeholder={stores ? 'Elija la tienda...' : 'Cargando...'} /></SelectTrigger>
                  <SelectContent>
                    {(stores || []).map((s) => <SelectItem key={s.id} value={s.codigoErp}>{s.nombreCorto} · {s.codigoErp}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          <div className="grid gap-2 rounded-lg border bg-muted/50 p-3 md:grid-cols-[auto_1fr_1fr_1fr]">
            <Button onClick={() => void loadInTransit()} disabled={searching}>
              {searching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              {lines.length ? 'Recargar En Tránsito' : 'Cargar TF En Tránsito'}
            </Button>
            <Select value={fOrigin} onValueChange={setFOrigin} disabled={!groups.length}>
              <SelectTrigger><SelectValue placeholder="Bodega origen" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todas las bodegas origen</SelectItem>
                {origins.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={fDest} onValueChange={setFDest} disabled={!groups.length}>
              <SelectTrigger><SelectValue placeholder="Bodega destino" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todas las bodegas destino</SelectItem>
                {destinations.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input placeholder="Filtrar # TF" value={search} onChange={(e) => setSearch(e.target.value)} disabled={!groups.length} />
          </div>

          {groups.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">
                Mostrando {visibleGroups.length} de {groups.length} TF · seleccionadas <b>{selected.size}</b> ({selectedUnits} und)
              </span>
              <Button size="sm" variant="outline" onClick={() => toggleVisible(true)} disabled={!visibleGroups.length || allVisibleSelected}>
                Seleccionar las {visibleGroups.length} filtradas
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} disabled={!selected.size}>
                Quitar selección
              </Button>
              <div className="flex-1" />
              <Button onClick={() => void handleAssign()} disabled={saving || selected.size === 0 || !driverReady}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />} Asignar {selected.size} TF
              </Button>
            </div>
          )}
          {groups.length > 0 && !driverReady && selected.size > 0 && (
            <p className="text-xs text-amber-700">Para asignar elija arriba conductor (usuario de la app), placa y día.</p>
          )}

          {groups.length > 0 && (
            <div className="max-h-[50vh] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox checked={allVisibleSelected} onCheckedChange={(c) => toggleVisible(!!c)} />
                    </TableHead>
                    <TableHead># TF</TableHead>
                    <TableHead>Recoger en (origen)</TableHead>
                    <TableHead>Destino TF</TableHead>
                    <TableHead className="text-right">Und</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleGroups.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="h-16 text-center text-muted-foreground">Ninguna TF con esos filtros.</TableCell></TableRow>
                  )}
                  {visibleGroups.map((g) => (
                    <TableRow key={g.key} data-state={selected.has(g.key) ? 'selected' : undefined}>
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
                      <TableCell className="font-medium">{g.numeroTF}</TableCell>
                      <TableCell>{g.bodegaOrigen}</TableCell>
                      <TableCell>{g.bodegaDestino}</TableCell>
                      <TableCell className="text-right">{g.unidades}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Agregar envío sin TF</CardTitle>
          <CardDescription>
            Sobres, documentos, encargos de oficina, garantías… Usa el conductor, placa y día de arriba. Queda con código MSJ para buscarlo después.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <datalist id="route-points">
            {(stores || []).map((s) => <option key={s.id} value={s.nombreCorto} />)}
            {['OFICINA', 'TRASLADOS', 'GARANTIAS', 'RECEPCION', 'SISTEMAS', 'BODEGA'].map((p) => <option key={p} value={p} />)}
          </datalist>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1 md:col-span-2">
              <Label>Qué se envía *</Label>
              <Input value={free.description} maxLength={200} placeholder="Ej: Sobre contabilidad, 2 cajas garantía" onChange={(e) => setFree((f) => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Recoger en</Label>
              <Input list="route-points" value={free.pickup} placeholder="Vacío = ya lo lleva" onFocus={() => void ensureStores()} onChange={(e) => setFree((f) => ({ ...f, pickup: e.target.value.toUpperCase() }))} />
            </div>
            <div className="space-y-1">
              <Label>Entregar en *</Label>
              <Input list="route-points" value={free.deliver} onFocus={() => void ensureStores()} onChange={(e) => setFree((f) => ({ ...f, deliver: e.target.value.toUpperCase() }))} />
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Input className="max-w-md" placeholder="Observación (a quién, teléfono, etc.)" value={free.notes} onChange={(e) => setFree((f) => ({ ...f, notes: e.target.value }))} />
            <Button onClick={() => void handleAddFree()} disabled={savingFree || !driverReady || !free.description.trim() || !free.deliver.trim()}>
              {savingFree ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />} Asignar envío
            </Button>
            {!driverReady && <span className="text-xs text-muted-foreground">Elija arriba conductor, placa y día.</span>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>Tareas del día {day}</CardTitle>
              <CardDescription>Seleccione no recogidas / no entregadas para reasignarlas con el conductor, placa y día de arriba.</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => void loadDay(day)} disabled={loadingDay}>
                <RefreshCw className={`mr-2 h-4 w-4 ${loadingDay ? 'animate-spin' : ''}`} /> {dayTasks ? 'Actualizar' : 'Ver tareas'}
              </Button>
              <Button variant="outline" onClick={() => void handleReassign()} disabled={taskSel.size === 0 || !driverReady}>
                <Shuffle className="mr-2 h-4 w-4" /> Reasignar ({taskSel.size})
              </Button>
              <Button variant="outline" className="text-red-700" onClick={() => void handleCancel()} disabled={taskSel.size === 0}>
                <Ban className="mr-2 h-4 w-4" /> Cancelar
              </Button>
            </div>
          </div>
        </CardHeader>
        {dayTasks && (
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2 text-xs">
              {(Object.keys(ROUTE_TASK_STATUS) as DriverRouteTaskStatus[]).map((s) => (
                <Badge key={s} className={ROUTE_TASK_STATUS[s].className}>{ROUTE_TASK_STATUS[s].label}: {kpi[s]}</Badge>
              ))}
            </div>
            <div className="max-h-[50vh] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>TF / envío</TableHead>
                    <TableHead>Conductor / placa</TableHead>
                    <TableHead>Recoger</TableHead>
                    <TableHead>Entregar</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Detalle</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dayTasks.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="h-16 text-center text-muted-foreground">Sin tareas este día.</TableCell></TableRow>
                  ) : (
                    dayTasks.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell>
                          {t.status !== 'entregada' && !t.reassignedTo && (
                            <Checkbox
                              checked={taskSel.has(t.id)}
                              onCheckedChange={(c) =>
                                setTaskSel((prev) => {
                                  const next = new Set(prev);
                                  if (c) next.add(t.id);
                                  else next.delete(t.id);
                                  return next;
                                })
                              }
                            />
                          )}
                        </TableCell>
                        <TableCell className="font-medium">
                          {t.kind === 'libre' ? <>{t.description}<span className="block text-xs text-amber-700">Sin TF · {t.numeroTF}</span></> : t.numeroTF}
                        </TableCell>
                        <TableCell>{t.driverName} · {t.placa}</TableCell>
                        <TableCell>{t.pickupPoint || '—'}</TableCell>
                        <TableCell>{t.deliverPoint}</TableCell>
                        <TableCell>
                          <Badge className={ROUTE_TASK_STATUS[t.status].className}>{ROUTE_TASK_STATUS[t.status].label}</Badge>
                          {t.reassignedTo && <span className="ml-1 text-xs text-muted-foreground">reasignada</span>}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {t.failReason || (t.receivedByName ? `Recibió ${t.receivedByName}` : '')}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
};

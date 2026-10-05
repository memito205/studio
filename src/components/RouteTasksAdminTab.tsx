"use client";

import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { Download, Loader2, Search } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getRouteTasksByRange } from '@/app/routeTaskActions';
import { ROUTE_TASK_STATUS } from '@/components/RouteTasksAssignView';
import type { DriverRouteTask, DriverRouteTaskPhoto, DriverRouteTaskStatus } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

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

/** Recolecciones de ruta por día: 1 consulta por día (sin carga automática). */
export function RouteTasksAdminTab() {
  const { toast } = useToast();
  const [from, setFrom] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [to, setTo] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [text, setText] = useState('');
  const [tasks, setTasks] = useState<DriverRouteTask[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<DriverRouteTaskStatus | 'todas'>('todas');
  const day = from === to ? from : `${from}_a_${to}`;

  const load = async () => {
    setLoading(true);
    const res = await getRouteTasksByRange(from, to);
    setLoading(false);
    if (res.error) toast({ variant: 'destructive', title: 'Error', description: res.error });
    setTasks(res.data || []);
  };

  const kpi = useMemo(() => {
    const c: Record<DriverRouteTaskStatus, number> = { por_recoger: 0, por_entregar: 0, entregada: 0, no_recogida: 0, no_entregada: 0, cancelada: 0 };
    (tasks || []).forEach((t) => c[t.status]++);
    const assigned = (tasks || []).filter((t) => t.status !== 'cancelada').length;
    const picked = (tasks || []).filter((t) => !!t.pickedAt).length;
    const withPickup = (tasks || []).filter((t) => !!t.pickupPoint && t.status !== 'cancelada').length;
    return { c, assigned, picked, withPickup };
  }, [tasks]);

  const needle = text.trim().toUpperCase();
  const visible = (tasks || []).filter(
    (t) =>
      (filter === 'todas' || t.status === filter) &&
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
      'Distancia (m)': t.distanceM ?? '',
      Motivo: t.failReason || '',
      Unidades: t.unidades,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Recolecciones');
    XLSX.writeFile(wb, `Recolecciones_ruta_${day}.xlsx`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recolecciones de ruta</CardTitle>
        <CardDescription>Tareas asignadas desde Transferencias o el planificador: recogidas con foto, no recogidas y entregas.</CardDescription>
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
            <Button variant="outline" onClick={exportXlsx}>
              <Download className="mr-2 h-4 w-4" /> Excel
            </Button>
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
            <div className="flex flex-wrap gap-2">
              <Badge variant={filter === 'todas' ? 'default' : 'outline'} className="cursor-pointer" onClick={() => setFilter('todas')}>Todas ({tasks.length})</Badge>
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
            </div>
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="h-16 text-center text-muted-foreground">Sin tareas.</TableCell></TableRow>
                  ) : (
                    visible.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="font-medium">
                          {t.kind === 'libre' ? t.description : t.numeroTF}
                          <span className="block text-xs text-muted-foreground">
                            {t.kind === 'libre' ? `Sin TF · ${t.numeroTF}` : `${t.unidades} und`}
                            {from !== to ? ` · ${t.day}` : ''}
                          </span>
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
                          {t.receivedByName && <span className="block">Recibió: {t.receivedByName}</span>}
                          {typeof t.distanceM === 'number' && <span className="block text-muted-foreground">a {t.distanceM} m</span>}
                          {t.tfMarkedDelivered && <span className="block text-green-700">TF entregada en plataforma</span>}
                          <Photos list={t.deliveryPhotos} />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {t.failReason ? `${t.failReason}${t.failedByName ? ` (${t.failedByName})` : ''}` : t.notes || ''}
                          {t.reassignedTo && <span className="block">Reasignada</span>}
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

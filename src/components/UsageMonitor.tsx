"use client";

import React, { useMemo, useState } from 'react';
import { Activity, Loader2, RefreshCw } from 'lucide-react';
import { getUsageDays, type UsageDay } from '@/app/usageActions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

/** Lecturas/día por encima de las cuales el día se marca en alerta. */
const ALERT_READS_PER_DAY = 600_000;

/** Pistas de qué pantalla genera cada consulta (por prefijo de colección + filtros). */
const HINTS: Array<[RegExp, string]> = [
  [/^cyclicInventoryLines\|inventoryDate==$/, 'Inventario cíclico: día completo'],
  [/^cyclicInventoryLines/, 'Inventario cíclico'],
  [/^transfers\|status==\|lim10000/, 'Analizador / Gestor de despachos (Recibido en Bodega)'],
  [/^transfers\|numeroTFin/, 'Despachos: líneas de las TF'],
  [/^transfers\|bodegaOrigen==/, 'Transferencias por bodega origen'],
  [/^transfers\|fecha/, 'Transferencias por rango de fechas'],
  [/^transfers\|numeroTF==/, 'Consulta de una TF'],
  [/^tf_platform_status/, 'Estado plataforma / Consulta TF'],
  [/^transfers_analysis/, 'Analizador de transferencias'],
  [/^ecommerceOrders/, 'Pedidos e-commerce'],
  [/^packedItems/, 'Empaque e-commerce'],
  [/^scannedItems/, 'Recepción: ítems leídos'],
  [/^receptionOperations/, 'Recepción'],
  [/^collectionLogs/, 'Registro de recolecciones'],
  [/^talladoCatalog/, 'Tallado: catálogo'],
  [/^talladoUnits/, 'Tallado'],
  [/^altCodeReceipts/, 'Códigos alternos'],
  [/^deliveryManifests/, 'Relaciones de entrega'],
  [/^labelingOperations/, 'Etiquetado'],
  [/^productDatabase/, 'Maestro de productos'],
  [/^users/, 'Usuarios'],
  [/^routeTasks/, 'Rutas mensajero'],
  [/^verificationSessions/, 'Verificación / cargue'],
];
const hintOf = (key: string) => HINTS.find(([re]) => re.test(key))?.[1] || '';

const fmt = (n: number) => Math.round(n).toLocaleString('es-CO');

export function UsageMonitor() {
  const [days, setDays] = useState<UsageDay[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getUsageDays(14);
      if (res.error) setError(res.error);
      setDays(res.data || []);
      setSelected((s) => s || res.data?.[0]?.day || null);
    } catch {
      setError('No se pudo cargar. Recargue la página (Ctrl+F5).');
    } finally {
      setLoading(false);
    }
  };

  const current = useMemo(() => days?.find((d) => d.day === selected) || null, [days, selected]);
  const closed = useMemo(() => (days || []).slice(1).filter((d) => d.total > 0), [days]);
  const avg = closed.length ? closed.reduce((s, d) => s + d.total, 0) / closed.length : 0;
  const monthUsd = closed.length ? (closed.reduce((s, d) => s + d.estUsd, 0) / closed.length) * 30 : 0;
  const maxTotal = Math.max(1, ...(days || []).map((d) => d.total));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5" /> Consumo Firebase (lecturas)
        </CardTitle>
        <CardDescription>
          Lecturas por día medidas en la app, costo estimado y qué consultas consumen más. Se consulta solo al oprimir el botón.
          Vercel y el almacenamiento de fotos se revisan en sus consolas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          {days ? 'Actualizar' : 'Ver consumo'}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}

        {days && (
          <>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Hoy (hasta ahora)</p>
                <p className="text-2xl font-bold">{fmt(days[0]?.total || 0)}</p>
                <p className="text-xs text-muted-foreground">≈ US$ {(days[0]?.estUsd || 0).toFixed(2)}</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Promedio diario (días cerrados)</p>
                <p className="text-2xl font-bold">{fmt(avg)}</p>
                <p className="text-xs text-muted-foreground">Alerta desde {fmt(ALERT_READS_PER_DAY)}/día</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Proyección mensual lecturas</p>
                <p className="text-2xl font-bold">US$ {monthUsd.toFixed(2)}</p>
                <p className="text-xs text-muted-foreground">50.000 lecturas/día gratis · US$0,06 por 100.000</p>
              </div>
            </div>

            <div className="space-y-1">
              {days.map((d) => (
                <button
                  key={d.day}
                  type="button"
                  onClick={() => setSelected(d.day)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-muted',
                    selected === d.day && 'bg-muted font-semibold'
                  )}
                >
                  <span className="w-24 shrink-0">{d.day}</span>
                  <span className="h-3 flex-1 rounded bg-muted">
                    <span
                      className={cn('block h-3 rounded', d.total > ALERT_READS_PER_DAY ? 'bg-red-600' : 'bg-primary')}
                      style={{ width: `${(d.total / maxTotal) * 100}%` }}
                    />
                  </span>
                  <span className="w-24 shrink-0 text-right">{fmt(d.total)}</span>
                  <span className="w-16 shrink-0 text-right text-muted-foreground">${d.estUsd.toFixed(2)}</span>
                </button>
              ))}
            </div>

            {current && (
              <div className="space-y-2">
                <p className="text-sm font-semibold">
                  Qué consumió el {current.day}: {fmt(current.total)} lecturas (servidor {fmt(current.servidor)} · navegador{' '}
                  {fmt(current.navegador)})
                </p>
                <div className="max-h-[50vh] overflow-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-right">Lecturas</TableHead>
                        <TableHead className="text-right">%</TableHead>
                        <TableHead className="text-right">Llamadas</TableHead>
                        <TableHead className="text-right">Docs/llamada</TableHead>
                        <TableHead>Pantalla probable</TableHead>
                        <TableHead>Consulta</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {current.top.map((r) => {
                        const perCall = r.calls ? r.docs / r.calls : 0;
                        return (
                          <TableRow key={`${r.side}|${r.key}`}>
                            <TableCell className="text-right font-medium">{fmt(r.docs)}</TableCell>
                            <TableCell className="text-right">{current.total ? ((r.docs / current.total) * 100).toFixed(1) : '0'}%</TableCell>
                            <TableCell className="text-right">{fmt(r.calls)}</TableCell>
                            <TableCell className="text-right">
                              <span className={cn(perCall >= 500 && 'font-semibold text-red-700')}>{fmt(perCall)}</span>
                            </TableCell>
                            <TableCell className="text-xs">{hintOf(r.key)}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              <Badge variant="outline" className="mr-1 px-1 py-0 text-[10px]">{r.side}</Badge>
                              {r.key}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-xs text-muted-foreground">
                  En rojo: consultas que traen 500 o más documentos por llamada; son las primeras candidatas a optimizar.
                </p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

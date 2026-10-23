"use client";

import React, { useState } from 'react';
import { ArrowLeft, Loader2, Search, Package, Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getTfPlatformStatusByTf } from '@/app/actions';
import { lookupLibreRouteTasks, lookupLibreRouteTasksByExternalCode } from '@/app/routeTaskActions';
import { isExternalLibreCode, normalizeLibreRouteCode } from '@/lib/libreRouteCode';
import { ROUTE_TASK_STATUS } from '@/components/RouteTasksAssignView';
import type { DriverRouteTask } from '@/types';
import type { TfPlatformEstado } from '@/types';
import { format } from 'date-fns';
import { StoreReceiveCard } from '@/components/StoreReceiveCard';
import { EcommerceDispatchCard } from '@/components/EcommerceDispatchCard';
import { AnalyzerSnapshotView } from '@/components/AnalyzerSnapshotView';
import { useAuth } from '@/hooks/use-auth-context';
import { serverActionErrorText } from '@/lib/serverActionError';

const statusBadge = (status: string, entregaInferida?: boolean) => {
  switch (status as TfPlatformEstado) {
    case 'ENTREGADO':
      if (entregaInferida) {
        return (
          <Badge className="bg-teal-700 hover:bg-teal-700 border border-dashed border-teal-200">
            ENTREGADO · inferido
          </Badge>
        );
      }
      return <Badge className="bg-green-600 hover:bg-green-600">ENTREGADO</Badge>;
    case 'EN RUTA HOY':
      return <Badge className="bg-blue-600 hover:bg-blue-600">EN RUTA HOY</Badge>;
    case 'RECOLECTADO EN RUTA':
      return <Badge className="bg-violet-600 hover:bg-violet-600">RECOLECTADO EN RUTA</Badge>;
    case 'EN BODEGA':
      return <Badge className="bg-amber-500 hover:bg-amber-500 text-white">EN BODEGA</Badge>;
    case 'NOVEDAD DE ENTREGA':
      return <Badge className="bg-red-700 hover:bg-red-700">NOVEDAD DE ENTREGA</Badge>;
    case 'VALIDAR CON AMBAS TIENDAS':
      return <Badge variant="destructive">VALIDAR CON AMBAS TIENDAS</Badge>;
    default:
      return <Badge variant="secondary">{status || 'N/D'}</Badge>;
  }
};

const inferidoMotivoLabel = (motivo?: string): string => {
  switch (motivo) {
    case 'dia_siguiente':
      return 'Pasó a ENTREGADO porque EN RUTA HOY era de un día anterior (no por evidencia de entrega).';
    case 'fuera_de_transito':
      return 'Pasó a ENTREGADO porque ya no está en transferencias En Tránsito (no por evidencia de entrega).';
    case 'fuera_de_ruta':
      return 'Pasó a ENTREGADO porque ya no está en una relación de ruta abierta (no por evidencia de entrega).';
    case 'fuera_del_lote_publicado':
      return 'Pasó a ENTREGADO porque no vino en la última publicación del analizador (no por evidencia de entrega).';
    default:
      return 'Pasó a ENTREGADO por cierre automático de EN RUTA HOY (no por evidencia de entrega).';
  }
};

const formatMaybeDate = (value: any): string => {
  if (!value) return 'N/A';
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return format(d, 'dd/MM/yyyy');
  } catch {
    return String(value);
  }
};

const formatMaybeDateTime = (value: any): string => {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : format(d, 'dd/MM/yyyy HH:mm');
};

const TaskPhotos: React.FC<{ title: string; list?: DriverRouteTask['deliveryPhotos'] }> = ({ title, list }) => {
  if (!list?.length) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{title}</p>
      <div className="flex flex-wrap gap-2">
        {list.map((p, i) => (
          <a
            key={p.path || p.url || i}
            href={p.url}
            target="_blank"
            rel="noreferrer"
            className="block h-24 w-24 overflow-hidden rounded border bg-muted"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt={p.category || title} className="h-full w-full object-cover" />
          </a>
        ))}
      </div>
    </div>
  );
};

interface TfPlatformLookupModuleProps {
  onReturn: () => void;
}

export const TfPlatformLookupModule: React.FC<TfPlatformLookupModuleProps> = ({ onReturn }) => {
  const { role, storeCode } = useAuth();
  const isBodvi = role === 'tiendas' && (storeCode || '').trim().toUpperCase() === 'BODVI';
  const canReviewDispatch = role === 'admin' || role === 'supervisor';
  const [tfQuery, setTfQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<any[]>([]);
  const [libreResults, setLibreResults] = useState<DriverRouteTask[]>([]);

  const runSearchByTf = async () => {
    setIsLoading(true);
    setError(null);
    setResults([]);
    setLibreResults([]);
    const libreCode = normalizeLibreRouteCode(tfQuery);
    const externalCode = isExternalLibreCode(tfQuery) ? tfQuery.trim().replace(/\s+/g, '') : '';
    try {
      if (libreCode || externalCode) {
        const libre = libreCode
          ? await lookupLibreRouteTasks(tfQuery)
          : await lookupLibreRouteTasksByExternalCode(externalCode);
        if (libre.error) setError(libre.error);
        else {
          setLibreResults(libre.data || []);
          if (!libre.data?.length) {
            setError(
              libreCode
                ? `No hay un envío sin TF con el consecutivo ${libreCode}.`
                : `No hay un envío sin TF con el código ${externalCode}.`
            );
          }
        }
        return;
      }
      const res = await getTfPlatformStatusByTf(tfQuery);
      if (res.error) setError(res.error);
      else {
        setResults(res.data || []);
        if (!res.data?.length) setError('No se encontraron estados plataforma para esa TF. Deben publicarse desde Plataforma Logística (Analizador, 4 pasos). Colección: tf_platform_status.');
      }
    } catch (e) {
      setError(serverActionErrorText(e));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-primary/10 rounded-lg">
            <Store className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Consulta Estado TF (Plataforma)</h1>
            <p className="text-sm text-muted-foreground">
              Solo estado plataforma: entregado, en ruta hoy, novedad de entrega, recolectado en ruta, en bodega o validar —
              con placas y evidencias si existen.
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={onReturn}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Volver
        </Button>
      </div>

      {role !== 'office' && <StoreReceiveCard />}

      {(isBodvi || canReviewDispatch) && (
        <EcommerceDispatchCard canCreate={isBodvi} canBackup={canReviewDispatch} />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Buscar</CardTitle>
          <CardDescription>
            Busque una TF por número, un envío sin TF por el código que aparece (ej. 1669491421137-01) o por su consecutivo MSJ, o vea las TF de su tienda en el último reporte del analizador.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="tf">
            <TabsList className="mb-4">
              <TabsTrigger value="tf">Por número TF</TabsTrigger>
              <TabsTrigger value="reporte">Último reporte bodega</TabsTrigger>
            </TabsList>
            <TabsContent value="reporte">
              <AnalyzerSnapshotView />
            </TabsContent>
            <TabsContent value="tf" className="space-y-3">
              <div className="space-y-1">
                <Label>Número TF, código del envío o consecutivo MSJ</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="Ej. 8389, 1669491421137-01 o MSJ-20261022-010"
                    value={tfQuery}
                    onChange={(e) => setTfQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && runSearchByTf()}
                  />
                  <Button onClick={runSearchByTf} disabled={isLoading || !tfQuery.trim()}>
                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    <span className="ml-2">Buscar</span>
                  </Button>
                </div>
              </div>
            </TabsContent>
          </Tabs>
          {error && (
            <div className="mt-4 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-3">
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      {libreResults.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Package className="h-5 w-5" />
            Envío sin TF · {libreResults.length} registro(s)
          </h2>
          {libreResults.map((t) => (
            <Card key={t.id}>
              <CardContent className="pt-6 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm text-muted-foreground">Código</p>
                    <p className="text-xl font-bold">{t.description || t.refText || t.numeroTF}</p>
                    <p className="text-xs text-muted-foreground">Consecutivo {t.numeroTF}</p>
                  </div>
                  <Badge className={ROUTE_TASK_STATUS[t.status]?.className || ''}>
                    {ROUTE_TASK_STATUS[t.status]?.label || t.status}
                    {t.reassignedTo ? ' · reasignada' : ''}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground">Conductor</p>
                    <p className="font-medium">{t.driverName || 'N/D'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Placa</p>
                    <p className="font-medium">{t.placa || 'N/D'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Día</p>
                    <p className="font-medium">{t.day || 'N/D'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Recoger</p>
                    <p className="font-medium">{t.pickupPoint || 'Ya lo lleva'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Entregar</p>
                    <p className="font-medium">{t.deliverPoint || 'N/D'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Recogida</p>
                    <p className="font-medium">{t.pickedAt ? formatMaybeDateTime(t.pickedAt) : '—'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Entrega</p>
                    <p className="font-medium">{t.deliveredAt ? formatMaybeDateTime(t.deliveredAt) : '—'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Recibió</p>
                    <p className="font-medium">{t.receivedByName || '—'}</p>
                  </div>
                </div>
                <TaskPhotos title="Foto de entrega" list={t.deliveryPhotos} />
                <TaskPhotos title="Foto de recogida" list={t.pickupPhotos} />
                {!t.deliveryPhotos?.length && !t.pickupPhotos?.length && (
                  <p className="text-xs text-muted-foreground">Sin foto de entrega.</p>
                )}
                {t.notes && <p className="text-xs text-muted-foreground">{t.notes}</p>}
                {t.failReason && <p className="text-xs text-red-800">Motivo: {t.failReason}</p>}
                {t.leftInCajon && <p className="text-xs text-amber-800">Dejado en Cajón Norte</p>}
                {t.leftInBodega && <p className="text-xs text-slate-800">Dejado en bodega</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Package className="h-5 w-5" />
            {results.length} resultado(s)
          </h2>
          {results.map((row) => (
            <Card key={row.id}>
              <CardContent className="pt-6 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm text-muted-foreground">Número TF</p>
                    <p className="text-xl font-bold">{row.numeroTF}</p>
                  </div>
                  {row.podSource === 'app' && row.estadoPlataforma === 'ENTREGADO' ? (
                    <Badge className="bg-green-700 hover:bg-green-700">
                      {row.pod?.kind === 'tienda' ? 'ENTREGADO · recibido en tienda' : 'ENTREGADO · app conductor'}
                    </Badge>
                  ) : (
                    statusBadge(row.estadoPlataforma, Boolean(row.entregaInferida))
                  )}
                </div>
                {row.podSource === 'app' && row.pod && (
                  <p className="text-xs text-green-900 bg-green-50 border border-green-200 rounded-md px-2 py-1.5">
                    {row.pod.kind === 'tienda' ? `Recibido escaneando en ${row.pod.storeName || 'la tienda'}` : 'Entregado con la app del conductor'}
                    {row.pod.at ? ` el ${formatMaybeDateTime(row.pod.at)}` : ''}
                    {row.pod.byName ? ` · ${row.pod.kind === 'tienda' ? 'Usuario' : 'Conductor'}: ${row.pod.byName}` : ''}
                    {row.pod.receivedByName ? ` · Recibió: ${row.pod.receivedByName}` : ''}
                    {row.pod.manifestId ? ` · Relación #${row.pod.manifestId}` : ''}
                    {typeof row.pod.distanceM === 'number' ? ` · a ${row.pod.distanceM} m de la tienda` : ''}
                    {row.podPhotosArchived ? ' · Fotos de la app archivadas en el PC (pedir a logística)' : ''}
                  </p>
                )}
                {row.storeReceipt && row.pod?.kind !== 'tienda' && (
                  <p className="text-xs text-green-900 bg-green-50 border border-green-200 rounded-md px-2 py-1.5">
                    Confirmada por la tienda {row.storeReceipt.storeName || ''}
                    {row.storeReceipt.at ? ` el ${formatMaybeDateTime(row.storeReceipt.at)}` : ''}
                    {row.storeReceipt.byName ? ` · ${row.storeReceipt.byName}` : ''}
                  </p>
                )}
                {row.podNovedad && row.estadoPlataforma !== 'ENTREGADO' && (
                  <p className="text-xs text-red-900 bg-red-50 border border-red-200 rounded-md px-2 py-1.5">
                    Novedad de entrega: {row.podNovedad.motivo || 'sin motivo'}
                    {row.podNovedad.at ? ` (${formatMaybeDateTime(row.podNovedad.at)})` : ''}
                    {row.podNovedad.byName ? ` · ${row.podNovedad.byName}` : ''}
                  </p>
                )}
                {row.estadoPlataforma === 'ENTREGADO' && row.entregaInferida && (
                  <p className="text-xs text-teal-900 bg-teal-50 border border-teal-200 border-dashed rounded-md px-2 py-1.5">
                    {inferidoMotivoLabel(row.entregaInferidaMotivo)}
                  </p>
                )}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground">Bodega origen</p>
                    <p className="font-medium">{row.bodegaOrigen || 'N/D'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Bodega destino</p>
                    <p className="font-medium">{row.bodegaDestino}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Placa entrega</p>
                    <p className="font-medium">{row.placaEntrega || 'N/D'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Placa recolección</p>
                    <p className="font-medium">{row.placaRecoleccion || 'N/D'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Cantidad</p>
                    <p className="font-medium">{Number(row.cantidad || 0).toLocaleString('es-ES')}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Fecha documento</p>
                    <p className="font-medium">{formatMaybeDate(row.fechaDocumento)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Fecha finalizado</p>
                    <p className="font-medium">{formatMaybeDate(row.fechaFinalizado)}</p>
                  </div>
                </div>
                {row.estadoPlataforma === 'VALIDAR CON AMBAS TIENDAS' && (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
                    Validar entre bodegas: origen <b>{row.bodegaOrigen || 'N/D'}</b> → destino <b>{row.bodegaDestino}</b>
                  </p>
                )}
                {(row.marca || row.grupo) && (
                  <p className="text-xs text-muted-foreground">
                    {row.marca ? `Marca: ${row.marca}` : ''}
                    {row.marca && row.grupo ? ' · ' : ''}
                    {row.grupo ? `Grupo: ${row.grupo}` : ''}
                  </p>
                )}
                {Array.isArray(row.evidenceLinks) && row.evidenceLinks.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {row.evidenceLinks.map((link: string, idx: number) => (
                      <a
                        key={`${row.id}-ev-${idx}`}
                        href={link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-blue-600 hover:underline bg-blue-50 border border-blue-200 px-2 py-1 rounded"
                      >
                        {row.podSource === 'app' && idx < Number(row.pod?.photosCount || 0) ? `Foto ${idx + 1}` : `Evidencia ${idx + 1}`}
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Sin evidencias publicadas.</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default TfPlatformLookupModule;

"use client";

import React, { useState } from 'react';
import { ArrowLeft, Loader2, Search, Package, Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getTfPlatformStatusByTf, getTfPlatformStatusByWarehouse } from '@/app/actions';
import type { TfPlatformEstado } from '@/types';
import { format } from 'date-fns';

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

interface TfPlatformLookupModuleProps {
  onReturn: () => void;
}

export const TfPlatformLookupModule: React.FC<TfPlatformLookupModuleProps> = ({ onReturn }) => {
  const [tfQuery, setTfQuery] = useState('');
  const [warehouseQuery, setWarehouseQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<any[]>([]);

  const runSearchByTf = async () => {
    setIsLoading(true);
    setError(null);
    setResults([]);
    const res = await getTfPlatformStatusByTf(tfQuery);
    if (res.error) setError(res.error);
    else {
      setResults(res.data || []);
      if (!res.data?.length) setError('No se encontraron estados plataforma para esa TF. Deben publicarse desde Plataforma Logística (Analizador, 4 pasos). Colección: tf_platform_status.');
    }
    setIsLoading(false);
  };

  const runSearchByWarehouse = async () => {
    setIsLoading(true);
    setError(null);
    setResults([]);
    const res = await getTfPlatformStatusByWarehouse(warehouseQuery);
    if (res.error) setError(res.error);
    else {
      setResults(res.data || []);
      if (!res.data?.length) {
        setError(
          'No hay TF publicadas para esa bodega destino. Los datos solo aparecen después de que logística complete los 4 pasos del Analizador (Plataforma Logística) y vea el aviso “Estados publicados para tiendas”. Colección Firestore: tf_platform_status.'
        );
      }
    }
    setIsLoading(false);
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
              Solo estado plataforma: entregado, en ruta hoy, recolectado en ruta, en bodega o validar —
              con placas y evidencias si existen.
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={onReturn}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Volver
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Buscar</CardTitle>
          <CardDescription>
            Filtre por número de TF o por bodega destino (por bodega: de fecha más antigua a más nueva).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="tf">
            <TabsList className="mb-4">
              <TabsTrigger value="tf">Por número TF</TabsTrigger>
              <TabsTrigger value="bodega">Por bodega destino</TabsTrigger>
            </TabsList>
            <TabsContent value="tf" className="space-y-3">
              <div className="space-y-1">
                <Label>Número TF</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="Ej. 8389"
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
            <TabsContent value="bodega" className="space-y-3">
              <div className="space-y-1">
                <Label>Bodega destino</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="Ej. 20101"
                    value={warehouseQuery}
                    onChange={(e) => setWarehouseQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && runSearchByWarehouse()}
                  />
                  <Button onClick={runSearchByWarehouse} disabled={isLoading || !warehouseQuery.trim()}>
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
                  {statusBadge(row.estadoPlataforma, Boolean(row.entregaInferida))}
                </div>
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
                        Evidencia {idx + 1}
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

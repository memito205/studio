'use client';

import React, { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { ArrowLeft, Loader2, MapPinned, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { geocodeMetroAddresses, resolveMetroStores, routeMetroDistances } from '@/app/metroDispatchActions';
import { MetroStreetMap } from '@/components/metro-dispatch/MetroStreetMap';
import {
  VALLE_ABURRA,
  addressCacheKey,
  buildAddressQuery,
  chunkList,
  classifyMunicipio,
  foldPlace,
  median,
  type ValleMunicipio,
} from '@/lib/metroDispatch';

type StorePin = {
  code: string;
  name: string;
  ciudad: string;
  lat: number | null;
  lng: number | null;
};

type OrderPoint = {
  pedidoId: string;
  storeCode: string;
  storeName: string;
  ciudadExcel: string;
  barrio: string;
  lat: number | null;
  lng: number | null;
  municipio: string;
  valle: ValleMunicipio | null;
  km: number | null;
  minutes: number | null;
};

const headerKey = (value: unknown) => foldPlace(value).replace(/ /g, '');

function readSheetRows(file: ArrayBuffer): Record<string, unknown>[] {
  const book = XLSX.read(file, { type: 'array' });
  const sheet = book.Sheets[book.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, unknown>[];
}

function pick(row: Record<string, unknown>, key: string): string {
  for (const [header, value] of Object.entries(row)) {
    if (headerKey(header) === key) return String(value ?? '').trim();
  }
  return '';
}

function formatKm(value: number | null): string {
  if (value == null) return '—';
  return value.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function MetroDispatchModule({ onReturnToSuite }: { onReturnToSuite: () => void }) {
  const { toast } = useToast();
  const abortRef = useRef(false);
  const [fileName, setFileName] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [orders, setOrders] = useState<OrderPoint[]>([]);
  const [stores, setStores] = useState<StorePin[]>([]);
  const [missingStores, setMissingStores] = useState<string[]>([]);
  const [geoFailed, setGeoFailed] = useState(0);
  const [billedGeo, setBilledGeo] = useState(0);
  const [billedRoutes, setBilledRoutes] = useState(0);
  const [cachedGeo, setCachedGeo] = useState(0);
  const [cachedRoutes, setCachedRoutes] = useState(0);
  const [storeFilter, setStoreFilter] = useState('__all');

  const filtered = useMemo(
    () => (storeFilter === '__all' ? orders : orders.filter((o) => o.storeCode === storeFilter)),
    [orders, storeFilter],
  );

  const summary = useMemo(() => {
    const valley = filtered.filter((o) => o.valle);
    const outside = filtered.filter((o) => !o.valle);
    const withKm = valley.filter((o) => o.km != null);
    const kms = withKm.map((o) => o.km as number);
    const avg = kms.length ? kms.reduce((a, b) => a + b, 0) / kms.length : null;
    const byMunicipio = VALLE_ABURRA.map((name) => {
      const rows = valley.filter((o) => o.valle === name);
      const rowKm = rows.map((o) => o.km).filter((n): n is number => n != null);
      return {
        name,
        count: rows.length,
        pct: valley.length ? (rows.length / valley.length) * 100 : 0,
        avg: rowKm.length ? rowKm.reduce((a, b) => a + b, 0) / rowKm.length : null,
        median: median(rowKm),
      };
    }).filter((row) => row.count > 0);
    const barrioMap = new Map<string, { barrio: string; municipio: string; count: number; kms: number[] }>();
    valley.forEach((order) => {
      const barrio = order.barrio || 'Sin barrio';
      const municipio = order.valle || order.municipio || '';
      const key = `${foldPlace(barrio)}|${municipio}`;
      const current = barrioMap.get(key) || { barrio, municipio, count: 0, kms: [] };
      current.count += 1;
      if (order.km != null) current.kms.push(order.km);
      barrioMap.set(key, current);
    });
    const byBarrio = [...barrioMap.values()]
      .map((row) => ({
        barrio: row.barrio,
        municipio: row.municipio,
        count: row.count,
        pct: valley.length ? (row.count / valley.length) * 100 : 0,
        avg: row.kms.length ? row.kms.reduce((a, b) => a + b, 0) / row.kms.length : null,
      }))
      .sort((a, b) => b.count - a.count);
    const outsideMap = new Map<string, number>();
    outside.forEach((o) => {
      const label = o.municipio || o.ciudadExcel || 'Sin municipio';
      outsideMap.set(label, (outsideMap.get(label) || 0) + 1);
    });
    const outsideRows = [...outsideMap.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
    return {
      total: filtered.length,
      valley: valley.length,
      outside: outside.length,
      avg,
      median: median(kms),
      over10: kms.filter((n) => n > 10).length,
      over15: kms.filter((n) => n > 15).length,
      over20: kms.filter((n) => n > 20).length,
      withKm: withKm.length,
      byMunicipio,
      byBarrio,
      outsideRows,
      heat: valley.filter((o) => o.lat != null && o.lng != null),
    };
  }, [filtered]);

  const storePins = useMemo(() => {
    const codes = new Set(filtered.map((o) => o.storeCode));
    return stores.filter((s) => codes.has(s.code) && s.lat != null && s.lng != null);
  }, [filtered, stores]);

  const onFile = async (file: File) => {
    abortRef.current = false;
    setRunning(true);
    setProgress(2);
    setStatus('Leyendo el archivo…');
    setOrders([]);
    setFileName(file.name);
    try {
      const raw = readSheetRows(await file.arrayBuffer());
      const parsed = raw
        .map((row) => {
          const direccion = pick(row, 'PEDDIRECCION');
          const barrio = pick(row, 'PEDBARRIO');
          const ciudad = pick(row, 'PEDCIUDAD');
          const storeCode = pick(row, 'NOMBRESUITE');
          const query = buildAddressQuery(direccion, barrio, ciudad);
          return {
            pedidoId: pick(row, 'PEDID'),
            storeCode,
            storeLabel: pick(row, 'NOMBRE'),
            ciudadExcel: ciudad,
            barrio,
            query,
            key: addressCacheKey(query),
          };
        })
        .filter((row) => row.query && row.storeCode);
      if (!parsed.length) {
        toast({ variant: 'destructive', title: 'El archivo no trae pedidos', description: 'Hacen falta NOMBRE SUITE, PED_DIRECCION, PED_BARRIO y PED_CIUDAD.' });
        return;
      }

      setStatus('Buscando las tiendas en el maestro…');
      const storeResult = await resolveMetroStores(parsed.map((row) => row.storeCode));
      if (!storeResult.ok) throw new Error(storeResult.error || 'No se leyeron las tiendas.');
      const byInput = new Map(storeResult.matches.map((m) => [foldPlace(m.input).replace(/ /g, ''), m]));
      const pinByCode = new Map<string, StorePin>();
      storeResult.matches.forEach((m) => {
        if (!pinByCode.has(m.code)) pinByCode.set(m.code, { code: m.code, name: m.name, ciudad: m.ciudad, lat: m.lat, lng: m.lng });
      });
      setStores([...pinByCode.values()]);
      setMissingStores(storeResult.missing);
      setStoreFilter(pinByCode.size === 1 ? [...pinByCode.keys()][0] : '__all');

      const uniqueQueries = new Map<string, string>();
      parsed.forEach((row) => {
        if (!uniqueQueries.has(row.key)) uniqueQueries.set(row.key, row.query);
      });
      const geoHits = new Map<string, { lat: number; lng: number; municipio: string; valle: ValleMunicipio | null }>();
      let failed = 0;
      let geoBilled = 0;
      let geoCache = 0;
      const queries = [...uniqueQueries.entries()].map(([key, query]) => ({ key, query }));
      const geoChunks = chunkList(queries, 20);
      for (let i = 0; i < geoChunks.length; i++) {
        if (abortRef.current) return;
        setStatus(`Ubicando direcciones ${Math.min(queries.length, (i + 1) * 20)} de ${queries.length}…`);
        setProgress(5 + Math.round(((i + 1) / geoChunks.length) * 55));
        const result = await geocodeMetroAddresses(geoChunks[i].map((row) => ({ query: row.query })));
        geoBilled += result.billed;
        geoCache += result.fromCache;
        if (!result.ok && result.fatal) throw new Error(result.error || 'Google rechazó la geocodificación.');
        result.hits.forEach((hit) => geoHits.set(hit.key, hit));
        failed += result.failed.length;
      }
      setGeoFailed(failed);
      setBilledGeo(geoBilled);
      setCachedGeo(geoCache);

      const draft: OrderPoint[] = parsed.map((row) => {
        const store = byInput.get(foldPlace(row.storeCode).replace(/ /g, ''));
        const geo = geoHits.get(row.key);
        const valle = geo
          ? geo.valle || (geo.municipio ? null : classifyMunicipio(row.ciudadExcel))
          : classifyMunicipio(row.ciudadExcel);
        return {
          pedidoId: row.pedidoId,
          storeCode: store?.code || row.storeCode,
          storeName: store?.name || row.storeLabel || row.storeCode,
          ciudadExcel: row.ciudadExcel,
          barrio: row.barrio,
          lat: geo?.lat ?? null,
          lng: geo?.lng ?? null,
          municipio: geo?.municipio || row.ciudadExcel,
          valle,
          km: null,
          minutes: null,
        };
      });

      const routeGroups = new Map<string, { origin: StorePin; dests: Map<string, { key: string; lat: number; lng: number }> }>();
      draft.forEach((order) => {
        if (!order.valle || order.lat == null || order.lng == null) return;
        const origin = pinByCode.get(order.storeCode);
        if (!origin || origin.lat == null || origin.lng == null) return;
        const group = routeGroups.get(origin.code) || { origin, dests: new Map() };
        const destKey = `${order.lat.toFixed(4)}|${order.lng.toFixed(4)}`;
        if (!group.dests.has(destKey)) group.dests.set(destKey, { key: destKey, lat: order.lat, lng: order.lng });
        routeGroups.set(origin.code, group);
      });

      const kmByStoreDest = new Map<string, { km: number; minutes: number }>();
      const groups = [...routeGroups.values()];
      let routeBilled = 0;
      let routeCache = 0;
      let doneGroups = 0;
      for (const group of groups) {
        const dests = [...group.dests.values()];
        const parts = chunkList(dests, 25);
        for (const part of parts) {
          if (abortRef.current) return;
          doneGroups++;
          setStatus(`Calculando kilómetros de ${group.origin.name}…`);
          setProgress(62 + Math.min(34, doneGroups));
          const result = await routeMetroDistances({
            origin: { lat: group.origin.lat as number, lng: group.origin.lng as number },
            destinations: part,
          });
          routeBilled += result.billed;
          routeCache += result.fromCache;
          if (!result.ok && result.fatal) throw new Error(result.error || 'Google rechazó el cálculo de kilómetros.');
          result.hits.forEach((hit) => kmByStoreDest.set(`${group.origin.code}|${hit.key}`, hit));
        }
      }
      setBilledRoutes(routeBilled);
      setCachedRoutes(routeCache);

      draft.forEach((order) => {
        if (order.lat == null || order.lng == null) return;
        const hit = kmByStoreDest.get(`${order.storeCode}|${order.lat.toFixed(4)}|${order.lng.toFixed(4)}`);
        if (!hit) return;
        order.km = hit.km;
        order.minutes = hit.minutes;
      });
      setOrders(draft);
      setProgress(100);
      setStatus(`${draft.length.toLocaleString('es-CO')} pedidos listos.`);
    } catch (e) {
      toast({ variant: 'destructive', title: 'No se pudo armar el mapa', description: e instanceof Error ? e.message : 'Error desconocido.' });
      setStatus('');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" onClick={onReturnToSuite}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Suite
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">Mapa de despachos</h1>
          <p className="text-sm text-muted-foreground">Valle de Aburrá. Kilómetros de manejo, sin tráfico.</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pedidos</CardTitle>
          <CardDescription>
            Columnas: NOMBRE, NOMBRE SUITE, PED_ID, PED_DIRECCION, PED_BARRIO, PED_CIUDAD. La tienda sale del maestro que ya tiene coordenadas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {running ? 'Procesando…' : 'Subir Excel'}
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              disabled={running}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void onFile(file);
              }}
            />
          </label>
          {fileName ? <p className="text-sm text-muted-foreground">{fileName}</p> : null}
          {running || progress > 0 ? (
            <div className="space-y-1">
              <Progress value={progress} />
              <p className="text-sm">{status}</p>
            </div>
          ) : null}
          {running ? (
            <Button variant="outline" onClick={() => { abortRef.current = true; }}>
              Detener
            </Button>
          ) : null}
          {missingStores.length ? (
            <p className="text-sm text-amber-700">Sin tienda en el maestro: {missingStores.join(', ')}. Esos pedidos no entran al promedio de kilómetros.</p>
          ) : null}
          {orders.length ? (
            <p className="text-xs text-muted-foreground">
              Geocodificación nueva: {billedGeo.toLocaleString('es-CO')} · ya guardada: {cachedGeo.toLocaleString('es-CO')} · sin ubicar: {geoFailed.toLocaleString('es-CO')}.
              Rutas nuevas: {billedRoutes.toLocaleString('es-CO')} · ya guardadas: {cachedRoutes.toLocaleString('es-CO')}.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {orders.length ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm font-medium" htmlFor="metro-store">Tienda</label>
            <select
              id="metro-store"
              className="h-10 rounded-md border bg-background px-3 text-sm"
              value={storeFilter}
              onChange={(e) => setStoreFilter(e.target.value)}
            >
              <option value="__all">Todas</option>
              {stores.map((store) => (
                <option key={store.code} value={store.code}>
                  {store.name} · {store.code}{store.lat == null ? ' · sin coordenadas' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Pedidos del Valle" value={summary.valley.toLocaleString('es-CO')} hint={`${summary.outside.toLocaleString('es-CO')} por fuera`} />
            <Kpi label="Km promedio" value={formatKm(summary.avg)} hint={summary.median == null ? 'Sin rutas' : `Mediana ${formatKm(summary.median)} km`} />
            <Kpi label="Más de 10 km" value={summary.over10.toLocaleString('es-CO')} hint={`${summary.over15.toLocaleString('es-CO')} pasan de 15 · ${summary.over20.toLocaleString('es-CO')} de 20`} />
            <Kpi label="Con kilómetro" value={summary.withKm.toLocaleString('es-CO')} hint={`De ${summary.valley.toLocaleString('es-CO')} en el área`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPinned className="h-5 w-5" />
                  Valle de Aburrá
                </CardTitle>
                <CardDescription>Callejero gratuito. El punto negro es la tienda y el naranja concentra los pedidos.</CardDescription>
              </CardHeader>
              <CardContent>
                <MetroStreetMap
                  orders={summary.heat.map((order) => ({
                    lat: order.lat as number,
                    lng: order.lng as number,
                    barrio: order.barrio,
                    municipio: order.valle || order.municipio,
                    km: order.km,
                  }))}
                  stores={storePins.map((store) => ({
                    name: store.name,
                    lat: store.lat as number,
                    lng: store.lng as number,
                  }))}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Por municipio</CardTitle>
                <CardDescription>Solo pedidos dentro del Valle de Aburrá.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Municipio</TableHead>
                      <TableHead className="text-right">Pedidos</TableHead>
                      <TableHead className="text-right">%</TableHead>
                      <TableHead className="text-right">Km prom.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.byMunicipio.map((row) => (
                      <TableRow key={row.name}>
                        <TableCell>{row.name}</TableCell>
                        <TableCell className="text-right">{row.count.toLocaleString('es-CO')}</TableCell>
                        <TableCell className="text-right">{row.pct.toFixed(1)}</TableCell>
                        <TableCell className="text-right">{formatKm(row.avg)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
            <CardHeader>
              <CardTitle>Por barrio</CardTitle>
              <CardDescription>Sale de la columna PED_BARRIO. Sigue el filtro de la tienda y solo cuenta el Valle de Aburrá.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="max-h-[420px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Barrio</TableHead>
                      <TableHead>Municipio</TableHead>
                      <TableHead className="text-right">Pedidos</TableHead>
                      <TableHead className="text-right">%</TableHead>
                      <TableHead className="text-right">Km prom.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.byBarrio.map((row) => (
                      <TableRow key={`${row.municipio}-${row.barrio}`}>
                        <TableCell>{row.barrio}</TableCell>
                        <TableCell>{row.municipio}</TableCell>
                        <TableCell className="text-right">{row.count.toLocaleString('es-CO')}</TableCell>
                        <TableCell className="text-right">{row.pct.toFixed(1)}</TableCell>
                        <TableCell className="text-right">{formatKm(row.avg)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              </CardContent>
          </Card>
          </div>

          {summary.outsideRows.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Por fuera del área</CardTitle>
                <CardDescription>Estos pedidos no entran al promedio de kilómetros de la flota metropolitana.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Municipio</TableHead>
                      <TableHead className="text-right">Pedidos</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.outsideRows.slice(0, 40).map((row) => (
                      <TableRow key={row.name}>
                        <TableCell>{row.name}</TableCell>
                        <TableCell className="text-right">{row.count.toLocaleString('es-CO')}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

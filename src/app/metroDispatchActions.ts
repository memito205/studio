'use server';

import { createHash } from 'crypto';
import { collection, doc, documentId, getDocs, query, setDoc, where } from 'firebase/firestore';
import { firestore } from '@/services/firebase';
import { buildStoreMatcher } from '@/lib/deliveryStores';
import { getDeliveryStoresCached } from '@/lib/deliveryStoresCache';
import {
  addressCacheKey,
  classifyMunicipio,
  routeCacheKey,
  type ValleMunicipio,
} from '@/lib/metroDispatch';

const GEO_COLLECTION = 'metroGeoCache';
const ROUTE_COLLECTION = 'metroRouteCache';
const GEO_LIMIT = 25;
const ROUTE_LIMIT = 25;

type MetroGeoHit = {
  key: string;
  lat: number;
  lng: number;
  municipio: string;
  valle: ValleMunicipio | null;
  formatted: string;
};

type MetroRouteHit = {
  key: string;
  km: number;
  minutes: number;
};

type CacheRead = Record<string, unknown>;

function docId(key: string): string {
  return createHash('sha1').update(key).digest('hex');
}

function mapsKey(): string {
  return String(process.env.GOOGLE_MAPS_API_KEY || '').trim();
}

async function readByIds(collectionName: string, ids: string[]): Promise<Map<string, CacheRead>> {
  const out = new Map<string, CacheRead>();
  try {
    for (let i = 0; i < ids.length; i += 30) {
      const slice = ids.slice(i, i + 30).filter(Boolean);
      if (!slice.length) continue;
      const snap = await getDocs(query(collection(firestore, collectionName), where(documentId(), 'in', slice)));
      snap.forEach((d) => out.set(d.id, d.data() as CacheRead));
    }
  } catch {
    return out;
  }
  return out;
}

async function remember(collectionName: string, id: string, data: Record<string, unknown>) {
  try {
    await setDoc(doc(firestore, collectionName, id), data);
  } catch {
    // Si las reglas no dejan escribir, el resultado de esta carga igual se muestra.
  }
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

function pickComponent(components: { long_name?: string; types?: string[] }[]): string {
  const preferred = ['locality', 'administrative_area_level_2', 'administrative_area_level_3'];
  for (const type of preferred) {
    const hit = components.find((c) => (c.types || []).includes(type));
    if (hit?.long_name) return String(hit.long_name).replace(/^Municipio de\s+/i, '').trim();
  }
  return '';
}

export async function resolveMetroStores(codes: string[]): Promise<{
  ok: boolean;
  error?: string;
  matches: { input: string; code: string; name: string; ciudad: string; lat: number | null; lng: number | null }[];
  missing: string[];
}> {
  try {
    const unique = [...new Set(codes.map((c) => String(c || '').trim()).filter(Boolean))];
    const all = await getDeliveryStoresCached();
    const match = buildStoreMatcher(all);
    const matches: { input: string; code: string; name: string; ciudad: string; lat: number | null; lng: number | null }[] = [];
    const missing: string[] = [];
    for (const input of unique) {
      const store = match(input);
      if (!store) {
        missing.push(input);
        continue;
      }
      matches.push({
        input,
        code: store.codigoErp,
        name: store.nombreCorto || store.nombreTienda || store.codigoErp,
        ciudad: store.ciudad || '',
        lat: store.latitud,
        lng: store.longitud,
      });
    }
    return { ok: true, matches, missing };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudo leer el maestro de tiendas.', matches: [], missing: [] };
  }
}

export async function geocodeMetroAddresses(addresses: { query: string }[]): Promise<{
  ok: boolean;
  error?: string;
  fatal?: boolean;
  hits: MetroGeoHit[];
  failed: { key: string; error: string }[];
  fromCache: number;
  billed: number;
}> {
  const slice = addresses.slice(0, GEO_LIMIT);
  const hits: MetroGeoHit[] = [];
  const failed: { key: string; error: string }[] = [];
  let fromCache = 0;
  let billed = 0;
  const key = mapsKey();
  if (!key) {
    return { ok: false, fatal: true, error: 'Falta GOOGLE_MAPS_API_KEY en el servidor.', hits, failed, fromCache, billed };
  }

  const keyed = slice
    .map((row) => ({ query: String(row.query || '').trim(), key: addressCacheKey(row.query || '') }))
    .filter((row) => row.key);
  const ids = keyed.map((row) => docId(row.key));
  const cached = await readByIds(GEO_COLLECTION, ids);
  const pending: typeof keyed = [];

  keyed.forEach((row) => {
    const data = cached.get(docId(row.key));
    const lat = num(data?.lat);
    const lng = num(data?.lng);
    if (lat == null || lng == null) {
      pending.push(row);
      return;
    }
    fromCache++;
    hits.push({
      key: row.key,
      lat,
      lng,
      municipio: String(data?.municipio || ''),
      valle: classifyMunicipio(data?.valle || data?.municipio),
      formatted: String(data?.formatted || ''),
    });
  });

  let fatal: string | null = null;
  await pool(pending, 6, async (row) => {
    if (fatal) return;
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', row.query);
    url.searchParams.set('components', 'country:CO');
    url.searchParams.set('region', 'co');
    url.searchParams.set('bounds', '5.99,-75.72|6.50,-75.28');
    url.searchParams.set('key', key);
    const res = await fetch(url);
    const body = (await res.json()) as {
      status?: string;
      error_message?: string;
      results?: { formatted_address?: string; geometry?: { location?: { lat?: number; lng?: number } }; address_components?: { long_name?: string; types?: string[] }[] }[];
    };
    billed++;
    if (body.status === 'REQUEST_DENIED' || body.status === 'OVER_QUERY_LIMIT') {
      fatal = body.error_message || body.status || 'Google rechazó la geocodificación.';
      return;
    }
    const first = body.results?.[0];
    const lat = num(first?.geometry?.location?.lat);
    const lng = num(first?.geometry?.location?.lng);
    if (body.status !== 'OK' || lat == null || lng == null) {
      failed.push({ key: row.key, error: body.status || 'Sin resultado' });
      return;
    }
    const municipio = pickComponent(first?.address_components || []);
    const valle = classifyMunicipio(municipio);
    const hit: MetroGeoHit = {
      key: row.key,
      lat,
      lng,
      municipio,
      valle,
      formatted: String(first?.formatted_address || ''),
    };
    hits.push(hit);
    await remember(GEO_COLLECTION, docId(row.key), {
      key: row.key,
      query: row.query,
      lat,
      lng,
      municipio,
      valle: valle || '',
      formatted: hit.formatted,
      updatedAt: new Date().toISOString(),
    });
  });

  if (fatal) return { ok: false, fatal: true, error: fatal, hits, failed, fromCache, billed };
  return { ok: true, hits, failed, fromCache, billed };
}

function parseDurationSeconds(raw: unknown): number | null {
  const text = String(raw ?? '');
  const match = text.match(/([0-9]+(?:\.[0-9]+)?)s/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

async function readMatrix(res: Response): Promise<Record<string, unknown>[]> {
  const text = (await res.text()).trim();
  if (!text) return [];
  if (text.startsWith('[')) return JSON.parse(text) as Record<string, unknown>[];
  if (text.startsWith('{')) {
    const body = JSON.parse(text) as { error?: { message?: string } };
    throw new Error(body.error?.message || 'Routes no devolvió la matriz.');
  }
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

export async function routeMetroDistances(input: {
  origin: { lat: number; lng: number };
  destinations: { key: string; lat: number; lng: number }[];
}): Promise<{
  ok: boolean;
  error?: string;
  fatal?: boolean;
  hits: MetroRouteHit[];
  fromCache: number;
  billed: number;
}> {
  const destinations = input.destinations.slice(0, ROUTE_LIMIT);
  const hits: MetroRouteHit[] = [];
  let fromCache = 0;
  let billed = 0;
  const key = mapsKey();
  if (!key) {
    return { ok: false, fatal: true, error: 'Falta GOOGLE_MAPS_API_KEY en el servidor.', hits, fromCache, billed };
  }
  const originLat = num(input.origin?.lat);
  const originLng = num(input.origin?.lng);
  if (originLat == null || originLng == null) {
    return { ok: false, error: 'La tienda no tiene coordenadas.', hits, fromCache, billed };
  }

  const pending: { key: string; lat: number; lng: number; cacheKey: string }[] = [];
  const cacheKeys = destinations.map((d) => routeCacheKey(originLat, originLng, d.lat, d.lng));
  const cached = await readByIds(ROUTE_COLLECTION, cacheKeys.map(docId));

  destinations.forEach((d, index) => {
    const cacheKey = cacheKeys[index];
    const data = cached.get(docId(cacheKey));
    const km = num(data?.km);
    const minutes = num(data?.minutes);
    if (km == null || minutes == null) {
      pending.push({ key: d.key, lat: d.lat, lng: d.lng, cacheKey });
      return;
    }
    fromCache++;
    hits.push({ key: d.key, km, minutes });
  });

  if (!pending.length) return { ok: true, hits, fromCache, billed };

  const res = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'originIndex,destinationIndex,distanceMeters,duration,condition,status',
    },
    body: JSON.stringify({
      origins: [{ waypoint: { location: { latLng: { latitude: originLat, longitude: originLng } } } }],
      destinations: pending.map((d) => ({ waypoint: { location: { latLng: { latitude: d.lat, longitude: d.lng } } } })),
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_UNAWARE',
    }),
  });
  billed += pending.length;
  if (!res.ok) {
    const detail = await res.text();
    const denied = res.status === 403 || /REQUEST_DENIED|PERMISSION_DENIED|API key/i.test(detail);
    return {
      ok: false,
      fatal: denied,
      error: denied
        ? 'Google rechazó Routes. En la clave hay que permitir Geocoding API y Routes API.'
        : `Routes respondió ${res.status}.`,
      hits,
      fromCache,
      billed,
    };
  }

  let rows: Record<string, unknown>[] = [];
  try {
    rows = await readMatrix(res);
  } catch (e) {
    return { ok: false, fatal: true, error: e instanceof Error ? e.message : 'No se pudo leer la matriz de rutas.', hits, fromCache, billed };
  }

  for (const row of rows) {
    const index = num(row.destinationIndex) ?? (rows.length === 1 ? 0 : null);
    if (index == null || !pending[index]) continue;
    const dest = pending[index];
    const meters = num(row.distanceMeters);
    const seconds = parseDurationSeconds(row.duration);
    if (meters == null || seconds == null) continue;
    const hit = { key: dest.key, km: Math.round((meters / 1000) * 100) / 100, minutes: Math.round(seconds / 60) };
    hits.push(hit);
    await remember(ROUTE_COLLECTION, docId(dest.cacheKey), {
      key: dest.cacheKey,
      km: hit.km,
      minutes: hit.minutes,
      updatedAt: new Date().toISOString(),
    });
  }

  return { ok: true, hits, fromCache, billed };
}

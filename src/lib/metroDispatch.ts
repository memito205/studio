/** Valle de Aburrá. El nombre manda: un recuadro de coordenadas se come a Rionegro. */
export const VALLE_ABURRA = [
  'Medellín',
  'Bello',
  'Copacabana',
  'Girardota',
  'Barbosa',
  'Envigado',
  'Itagüí',
  'Sabaneta',
  'La Estrella',
  'Caldas',
] as const;

export type ValleMunicipio = (typeof VALLE_ABURRA)[number];

const VALLE_INDEX = new Map<string, ValleMunicipio>(
  VALLE_ABURRA.map((name) => [foldPlace(name), name]),
);

/** Corregimientos que Google a veces devuelve en vez de Medellín. */
const CORREGIMIENTOS: Record<string, ValleMunicipio> = {
  'SAN ANTONIO DE PRADO': 'Medellín',
  ALTAVISTA: 'Medellín',
  'SAN CRISTOBAL': 'Medellín',
  'SANTA ELENA': 'Medellín',
  PALMITAS: 'Medellín',
};

export const VALLE_CENTROIDS: Record<ValleMunicipio, { lat: number; lng: number }> = {
  Medellín: { lat: 6.2442, lng: -75.5812 },
  Bello: { lat: 6.3373, lng: -75.558 },
  Copacabana: { lat: 6.3463, lng: -75.5086 },
  Girardota: { lat: 6.3776, lng: -75.4486 },
  Barbosa: { lat: 6.4381, lng: -75.3316 },
  Envigado: { lat: 6.1699, lng: -75.587 },
  Itagüí: { lat: 6.1719, lng: -75.6113 },
  Sabaneta: { lat: 6.1515, lng: -75.6166 },
  'La Estrella': { lat: 6.1577, lng: -75.643 },
  Caldas: { lat: 6.0911, lng: -75.6357 },
};

/** Recuadro solo para dibujar, no para decidir si el pedido es del área. */
export const VALLE_PLOT = {
  minLat: 6.02,
  maxLat: 6.48,
  minLng: -75.72,
  maxLng: -75.3,
};

export function foldPlace(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifyMunicipio(raw: unknown): ValleMunicipio | null {
  const folded = foldPlace(raw).replace(/^MUNICIPIO DE /, '');
  if (!folded) return null;
  return VALLE_INDEX.get(folded) || CORREGIMIENTOS[folded] || null;
}

export function buildAddressQuery(direccion: string, barrio: string, ciudad: string): string {
  return [direccion, barrio, ciudad, 'Antioquia', 'Colombia']
    .map((p) => String(p || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(', ');
}

/** Misma llave en el navegador y en el servidor, para no geocodificar dos veces. */
export function addressCacheKey(query: string): string {
  return foldPlace(query);
}

export function routeCacheKey(originLat: number, originLng: number, destLat: number, destLng: number): string {
  return `${originLat.toFixed(4)},${originLng.toFixed(4)}|${destLat.toFixed(4)},${destLng.toFixed(4)}`;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function chunkList<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

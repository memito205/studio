'use client';

import { useEffect, useRef } from 'react';
import type { Map as MlMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

export type StreetMapPoint = {
  lat: number;
  lng: number;
  barrio: string;
  municipio: string;
  km: number | null;
};

export type StreetMapStore = {
  name: string;
  lat: number;
  lng: number;
};

const STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

function ordersGeo(orders: StreetMapPoint[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: orders.map((order) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [order.lng, order.lat] },
      properties: {
        barrio: order.barrio || 'Sin barrio',
        municipio: order.municipio || '',
        km: order.km,
      },
    })),
  };
}

function storesGeo(stores: StreetMapStore[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: stores.map((store) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [store.lng, store.lat] },
      properties: { name: store.name },
    })),
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    if (ch === '&') return '&amp;';
    if (ch === '<') return '&lt;';
    if (ch === '>') return '&gt;';
    if (ch === '"') return '&quot;';
    return '&#39;';
  });
}

export function MetroStreetMap({ orders, stores }: { orders: StreetMapPoint[]; stores: StreetMapStore[] }) {
  const holder = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const ordersRef = useRef(orders);
  const storesRef = useRef(stores);
  ordersRef.current = orders;
  storesRef.current = stores;

  useEffect(() => {
    const node = holder.current;
    if (!node) return;
    let disposed = false;
    let map: MlMap | null = null;

    const paint = (target: MlMap) => {
      const orderSource = target.getSource('orders') as { setData: (data: GeoJSON.FeatureCollection) => void } | undefined;
      const storeSource = target.getSource('stores') as { setData: (data: GeoJSON.FeatureCollection) => void } | undefined;
      const currentOrders = ordersRef.current;
      const currentStores = storesRef.current;
      orderSource?.setData(ordersGeo(currentOrders));
      storeSource?.setData(storesGeo(currentStores));
      const coords: [number, number][] = [
        ...currentOrders.map((order) => [order.lng, order.lat] as [number, number]),
        ...currentStores.map((store) => [store.lng, store.lat] as [number, number]),
      ];
      if (coords.length === 1) {
        target.jumpTo({ center: coords[0], zoom: 13 });
        return;
      }
      if (coords.length > 1) {
        const lngs = coords.map((c) => c[0]);
        const lats = coords.map((c) => c[1]);
        target.fitBounds(
          [
            [Math.min(...lngs), Math.min(...lats)],
            [Math.max(...lngs), Math.max(...lats)],
          ],
          { padding: 48, maxZoom: 13, duration: 0 },
        );
      }
    };

    void (async () => {
      const maplibregl = await import('maplibre-gl');
      if (disposed) return;
      map = new maplibregl.Map({
        container: node,
        style: STYLE,
        center: [-75.5812, 6.2442],
        zoom: 11,
        attributionControl: { compact: true },
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      map.on('load', () => {
        if (!map) return;
        map.addSource('orders', { type: 'geojson', data: EMPTY });
        map.addLayer({
          id: 'orders-heat',
          type: 'circle',
          source: 'orders',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 5, 14, 10],
            'circle-color': '#c2410c',
            'circle-opacity': 0.4,
            'circle-blur': 0.55,
          },
        });
        map.addSource('stores', { type: 'geojson', data: EMPTY });
        map.addLayer({
          id: 'store-dots',
          type: 'circle',
          source: 'stores',
          paint: {
            'circle-radius': 7,
            'circle-color': '#0f172a',
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff',
          },
        });
        map.on('click', 'orders-heat', (event) => {
          const feature = event.features?.[0];
          const props = feature?.properties;
          if (!map || !props) return;
          const km = props.km == null || props.km === 'null' ? 'Sin kilómetro' : `${Number(props.km).toLocaleString('es-CO', { maximumFractionDigits: 1 })} km`;
          new maplibregl.Popup({ closeButton: false })
            .setLngLat(event.lngLat)
            .setHTML(`<strong>${escapeHtml(String(props.barrio || 'Sin barrio'))}</strong><br/>${escapeHtml(String(props.municipio || ''))}<br/>${escapeHtml(km)}`)
            .addTo(map);
        });
        map.on('click', 'store-dots', (event) => {
          const name = event.features?.[0]?.properties?.name;
          if (!map || !name) return;
          new maplibregl.Popup({ closeButton: false })
            .setLngLat(event.lngLat)
            .setHTML(`<strong>${escapeHtml(String(name))}</strong><br/>Tienda`)
            .addTo(map);
        });
        map.on('mouseenter', 'orders-heat', () => {
          map?.getCanvas().style.setProperty('cursor', 'pointer');
        });
        map.on('mouseleave', 'orders-heat', () => {
          map?.getCanvas().style.setProperty('cursor', '');
        });
        paint(map);
      });
      mapRef.current = map;
    })();

    return () => {
      disposed = true;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded() || !map.getSource('orders')) return;
    const orderSource = map.getSource('orders') as { setData: (data: GeoJSON.FeatureCollection) => void };
    const storeSource = map.getSource('stores') as { setData: (data: GeoJSON.FeatureCollection) => void };
    orderSource.setData(ordersGeo(orders));
    storeSource.setData(storesGeo(stores));
    const coords: [number, number][] = [
      ...orders.map((order) => [order.lng, order.lat] as [number, number]),
      ...stores.map((store) => [store.lng, store.lat] as [number, number]),
    ];
    if (coords.length === 1) {
      map.flyTo({ center: coords[0], zoom: 13 });
      return;
    }
    if (coords.length > 1) {
      const lngs = coords.map((c) => c[0]);
      const lats = coords.map((c) => c[1]);
      map.fitBounds(
        [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ],
        { padding: 48, maxZoom: 13 },
      );
    }
  }, [orders, stores]);

  return <div ref={holder} className="h-[520px] w-full overflow-hidden rounded-lg border" />;
}

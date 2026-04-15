"use client";

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { loadEcommerceOrders } from '@/app/actions';
import type { EcommerceOrder } from '@/types';
import { calculateSlaHours, parseFlexibleDate } from '@/lib/parsingUtils';
import { OverviewSlide } from './OverviewSlide';
import { BrandDistributionSlide } from './BrandDistributionSlide';
import { HourlyTrendSlide } from './HourlyTrendSlide';
import { StatusFunnelSlide } from './StatusFunnelSlide';
import { DelayedByStoreSlide } from './DelayedByStoreSlide';
import { TransporterPendingSlide } from './TransporterPendingSlide';
import { EcommerceAnalysisSlide } from './EcommerceAnalysisSlide';
import { EfficiencySlide } from './EfficiencySlide';
import { DispatchSlide } from './DispatchSlide';
import { Clock, RefreshCw, Settings, X, Check } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { getShipments } from '@/app/actions';
import type { DispatchSessionInfo } from '@/types';

const SLIDE_DURATION = 10000; // 10 seconds per slide
const AUTO_SYNC_INTERVAL = 60 * 60 * 1000; // Sync automatically occasionally

export default function EcommerceTvBoard() {
  const [orders, setOrders] = useState<EcommerceOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  
  const [selectedStores, setSelectedStores] = useState<string[]>([]);
  const [selectedBodegas, setSelectedBodegas] = useState<string[]>([]);
  const [shipments, setShipments] = useState<DispatchSessionInfo[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  useEffect(() => {
     const saved = localStorage.getItem('tvDashboardStores');
     if (saved) {
         try { setSelectedStores(JSON.parse(saved)); } catch (e) {}
     }
     const savedBodegas = localStorage.getItem('tvDashboardBodegas');
     if (savedBodegas) {
         try { setSelectedBodegas(JSON.parse(savedBodegas)); } catch (e) {}
     }
  }, []);

  const toggleStore = (store: string) => {
      const updated = selectedStores.includes(store) ? selectedStores.filter(s => s !== store) : [...selectedStores, store];
      setSelectedStores(updated);
      localStorage.setItem('tvDashboardStores', JSON.stringify(updated));
  };

  const toggleBodega = (bodega: string) => {
      const updated = selectedBodegas.includes(bodega) ? selectedBodegas.filter(s => s !== bodega) : [...selectedBodegas, bodega];
      setSelectedBodegas(updated);
      localStorage.setItem('tvDashboardBodegas', JSON.stringify(updated));
  };

  const fetchOrders = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await loadEcommerceOrders();
      if (!error && data) {
        setOrders(data);
      }
      
      const shipmentsResult = await getShipments();
      if (shipmentsResult.success && shipmentsResult.data) {
          setShipments(shipmentsResult.data);
      }

      setLastSyncedAt(new Date());
    } catch (e) {
      console.error("Error fetching orders for TV:", e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Sync Timer
  useEffect(() => {
    fetchOrders();

    const fetchInterval = setInterval(() => {
      fetchOrders();
    }, AUTO_SYNC_INTERVAL);

    // Also set up a mechanism to sync exactly at HH:05
    const syncAtHourFive = () => {
        const now = new Date();
        if (now.getMinutes() === 5) {
            fetchOrders();
        }
    };
    
    // Check every minute if we are at HH:05
    const minuteSyncCheck = setInterval(syncAtHourFive, 60000);

    return () => {
      clearInterval(fetchInterval);
      clearInterval(minuteSyncCheck);
    };
  }, [fetchOrders]);

  // Timer setup replaced effectively below
  // We removed the static carousel timer to make it dynamic based on slides length

  // Basic Metrics Calculation based on `isCurrentlyDelayed` logic
  const metrics = useMemo(() => {
    const total = orders.length;
    let pending = 0;
    let dispatched = 0;
    let delayed = 0;
    let pedidosHoy = 0;
    
    // Simplification for the TV representation
    const dispatchedStates = ['en transporte externo', 'en transporte interno', 'entregado', 'en tienda'];
    const cancelledStates = ['cancelado', 'pendiente cancelar'];
    const nonPendingStates = [...dispatchedStates, ...cancelledStates, 'pendiente pago'];

    const storeCounts: Record<string, number> = {};
    const statusCounts: Record<string, number> = {};
    const delayedByStore: Record<string, number> = {};
    
    // NEW: grouped by store and status
    const estadosPorTienda: Record<string, Record<string, number>> = {};
    // NEW: transporter pending
    const transportadoraPendiente: Record<string, number> = {};
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const hourlyCounts: Record<string, number> = {};
    for (let i = 6; i <= 20; i++) {
        hourlyCounts[`${i}:00`] = 0;
    }

    orders.forEach((o) => {
      const storeName = o.tienda || 'OTROS';
      let bodegaNames: string[] = [];
      if (Array.isArray(o.bodega)) bodegaNames = o.bodega;
      else if (o.bodega) bodegaNames = [o.bodega];
      else bodegaNames = ['SIN BODEGA'];

      // If store filtering is active, skip non-selected stores
      if (selectedStores.length > 0 && !selectedStores.includes(storeName)) {
          return;
      }

      // If bodega filtering is active, check if ANY of the order's bodegas match
      if (selectedBodegas.length > 0 && !bodegaNames.some(b => selectedBodegas.includes(b))) {
          return;
      }

      const estado = (o.estado || '').trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, ' ');
      
      const fechaPed = parseFlexibleDate(o.fechaPedido);
      if (fechaPed) {
          if (fechaPed >= today) {
              pedidosHoy++;
          }
      }

      const isDispatchedAllTime = dispatchedStates.includes(estado) || o.dispatchDate;

      if (o.dispatchDate) {
          const dispatchTime = new Date(o.dispatchDate);
          if (dispatchTime >= today) {
              dispatched++; // Despachos Hoy
              const hour = dispatchTime.getHours();
              hourlyCounts[`${hour}:00`] = (hourlyCounts[`${hour}:00`] || 0) + 1;
          }
      }

      if (!isDispatchedAllTime && !nonPendingStates.includes(estado)) {
        pending++;
        
        // Count statuses
        const statusName = o.estado || 'SIN ESTADO';
        statusCounts[statusName] = (statusCounts[statusName] || 0) + 1;
        
        if (!estadosPorTienda[storeName]) estadosPorTienda[storeName] = {};
        estadosPorTienda[storeName][statusName] = (estadosPorTienda[storeName][statusName] || 0) + 1;
        
        if (estado === 'pendiente transporte') {
            const trans = String(o.transportadora || 'SIN ASIGNAR').replace('null', 'SIN ASIGNAR');
            transportadoraPendiente[trans] = (transportadoraPendiente[trans] || 0) + 1;
        }
        
        // Determine if delayed (rough estimate > 48hrs if not holidays aware in this isolated logic)
        const orderDate = o.fechaPedido ? new Date(o.fechaPedido) : new Date();
        const diffHours = (new Date().getTime() - orderDate.getTime()) / (1000 * 60 * 60);
        if (diffHours > 48) {
           delayed++;
           delayedByStore[storeName] = (delayedByStore[storeName] || 0) + 1;
        }
      }

      // Store Distribution for all pending
      if (!nonPendingStates.includes(estado) && !o.dispatchDate) {
         storeCounts[storeName] = (storeCounts[storeName] || 0) + 1;
      }
    });

    return { total, pending, dispatched, delayed, pedidosHoy, storeCounts, statusCounts, hourlyCounts, delayedByStore, estadosPorTienda, transportadoraPendiente };
  }, [orders, selectedStores, selectedBodegas]);

  const availableStores = useMemo(() => {
     const standardStores = ['Addi', 'Branchos', 'Dafiti', 'Falabella', 'Mercado Libre'];
     const dynamicStores = Array.from(new Set(orders.map(o => {
          if (!o.tienda) return 'OTROS';
          // Capitalize standard to match the database normally
          return o.tienda;
     })));
     return Array.from(new Set([...standardStores, ...dynamicStores].map(s => s.toUpperCase()))).sort();
  }, [orders]);

  const availableBodegas = useMemo(() => {
      let dynamic: string[] = [];
      orders.forEach(o => {
          if (Array.isArray(o.bodega)) dynamic.push(...o.bodega);
          else if (o.bodega) dynamic.push(o.bodega);
          else dynamic.push('SIN BODEGA');
      });
      return Array.from(new Set(dynamic.map(s => s.toUpperCase()))).sort();
  }, [orders]);

  const slidesToPresent = useMemo(() => {
      const selectedStoresToDisplay = (selectedStores.length > 0 ? selectedStores : availableStores)
           .filter(s => metrics.storeCounts[s] > 0); // Only loop funnels for stores with active pending packages

      return [
          <OverviewSlide key="summary" metrics={metrics} />,
          <EcommerceAnalysisSlide key="analysis" orders={orders} />,
          <EfficiencySlide key="efficiency" orders={orders} holidays={[]} />,
          <DispatchSlide key="dispatch" shipments={shipments} />,
          <BrandDistributionSlide key="brands" storeCounts={metrics.storeCounts} />,
          <HourlyTrendSlide key="trend" hourlyCounts={metrics.hourlyCounts} />,
          <DelayedByStoreSlide key="delayed" delayedByStore={metrics.delayedByStore} />,
          <StatusFunnelSlide key="status-general" statusCounts={metrics.statusCounts} />,
          ...selectedStoresToDisplay.map(store => (
              <StatusFunnelSlide key={`status-${store}`} store={store} statusCounts={metrics.estadosPorTienda[store] || {}} />
          )),
          <TransporterPendingSlide key="transporter" transporterCounts={metrics.transportadoraPendiente} />
      ];
  }, [metrics, selectedStores, availableStores]);

  // Slides Carousel Timer
  useEffect(() => {
    const slideAmount = slidesToPresent.length || 1;
    const slideInterval = setInterval(() => {
      setCurrentSlideIndex((prev) => (prev + 1) % slideAmount);
    }, SLIDE_DURATION);
    return () => clearInterval(slideInterval);
  }, [slidesToPresent.length]);

  return (
    <div className="flex flex-col h-full w-full overflow-hidden p-8 font-sans pb-16 relative">
        <header className="flex justify-between items-center mb-12">
            <div className="flex items-center gap-4">
                <h1 className="text-5xl font-black tracking-tight text-blue-400 drop-shadow-lg">
                    ECOMMERCE<span className="text-white font-light ml-2">LIVE</span>
                </h1>
                {isLoading && <RefreshCw className="w-8 h-8 animate-spin text-blue-400" />}
                <div className="flex gap-2 ml-4">
                    {selectedStores.length > 0 && (
                        <div className="bg-blue-500/20 px-3 py-1 rounded-lg border border-blue-500/30 text-blue-400 text-sm font-bold">
                            {selectedStores.length} TIENDAS
                        </div>
                    )}
                    {selectedBodegas.length > 0 && (
                        <div className="bg-purple-500/20 px-3 py-1 rounded-lg border border-purple-500/30 text-purple-400 text-sm font-bold">
                            {selectedBodegas.length} BODEGAS
                        </div>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-4">
                <div className="flex items-center bg-slate-900/80 backdrop-blur-md px-6 py-3 rounded-full border border-slate-800 shadow-xl cursor-pointer" onClick={fetchOrders}>
                    <Clock className="w-6 h-6 text-slate-400 mr-3" />
                    <span className="text-xl font-medium text-slate-300">
                        Corte: {lastSyncedAt ? format(lastSyncedAt, "hh:mm a", { locale: es }) : '---'}
                    </span>
                    <span className="ml-4 pl-4 border-l border-slate-700 text-sm font-bold text-blue-400 uppercase tracking-widest hover:text-blue-300">
                        Sincronizar
                    </span>
                </div>
                
                <button 
                    onClick={() => setIsSettingsOpen(true)}
                    className="flex items-center gap-3 px-6 py-3 bg-slate-900/80 backdrop-blur-md rounded-full border border-slate-800 shadow-xl cursor-pointer hover:bg-slate-800 transition-colors group"
                >
                    <Settings className="w-6 h-6 text-slate-400 group-hover:rotate-90 transition-transform duration-500" />
                    <span className="text-slate-300 font-bold tracking-wider">FILTROS</span>
                </button>
            </div>
        </header>

        {isSettingsOpen && (
            <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-sm flex items-center justify-center p-8">
                <div className="bg-slate-900 border border-slate-700 rounded-3xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col">
                    <div className="p-8 border-b border-slate-800 flex justify-between items-center">
                        <h2 className="text-4xl font-bold text-slate-100">Configuración de Tiendas</h2>
                        <button onClick={() => setIsSettingsOpen(false)} className="p-2 rounded-full hover:bg-slate-800 text-slate-400">
                            <X className="w-8 h-8" />
                        </button>
                    </div>
                    <div className="p-8 flex-1 overflow-y-auto">
                        <div className="mb-8 p-6 bg-slate-800/20 rounded-3xl border border-slate-800/50 shadow-inner">
                            <h3 className="text-2xl font-bold text-slate-200 mb-4 flex items-center gap-3">
                                <div className="w-2 h-8 bg-blue-500 rounded-full"></div>
                                Filtro por Tiendas
                            </h3>
                            <p className="text-lg text-slate-400 mb-6 font-medium">
                                Selecciona las tiendas que deseas incluir en el tablero. Si no seleccionas ninguna, se mostrarán todas por defecto.
                            </p>
                            <div className="flex gap-4 overflow-x-auto pb-4 pt-2 snap-x px-2 custom-scrollbar-horizontal mask-fade-right">
                                {availableStores.map(store => {
                                    const isSelected = selectedStores.includes(store);
                                    return (
                                        <div 
                                            key={store}
                                            onClick={() => toggleStore(store)}
                                            className={`min-w-[280px] snap-center shrink-0 p-6 rounded-2xl border-2 flex items-center justify-between cursor-pointer transition-all ${
                                                isSelected ? 'border-blue-500 bg-blue-500/10' : 'border-slate-800 bg-slate-950 hover:border-slate-700'
                                            }`}
                                        >
                                            <span className="text-2xl font-semibold text-slate-200">{store}</span>
                                            <div className={`shrink-0 ml-4 w-8 h-8 rounded-full border-2 flex items-center justify-center ${isSelected ? 'border-blue-500 bg-blue-500' : 'border-slate-600'}`}>
                                                {isSelected && <Check className="w-5 h-5 text-white" />}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>

                        <div className="p-6 bg-slate-800/20 rounded-3xl border border-slate-800/50 shadow-inner">
                            <h3 className="text-2xl font-bold text-slate-200 mb-4 flex items-center gap-3">
                                <div className="w-2 h-8 bg-purple-500 rounded-full"></div>
                                Filtro por Bodegas
                            </h3>
                            <p className="text-lg text-slate-400 mb-6 font-medium">
                                Selecciona las bodegas que deseas incluir en el tablero. Si no seleccionas ninguna, se evaluarán los pedidos de todas las bodegas.
                            </p>
                            <div className="flex gap-4 overflow-x-auto pb-4 pt-2 snap-x px-2 custom-scrollbar-horizontal mask-fade-right">
                                {availableBodegas.map(bodega => {
                                    const isSelected = selectedBodegas.includes(bodega);
                                    return (
                                        <div 
                                            key={bodega}
                                            onClick={() => toggleBodega(bodega)}
                                            className={`min-w-[280px] snap-center shrink-0 p-6 rounded-2xl border-2 flex items-center justify-between cursor-pointer transition-all ${
                                                isSelected ? 'border-blue-500 bg-blue-500/10' : 'border-slate-800 bg-slate-950 hover:border-slate-700'
                                            }`}
                                        >
                                            <span className="text-2xl font-semibold text-slate-200">{bodega}</span>
                                            <div className={`shrink-0 ml-4 w-8 h-8 rounded-full border-2 flex items-center justify-center ${isSelected ? 'border-blue-500 bg-blue-500' : 'border-slate-600'}`}>
                                                {isSelected && <Check className="w-5 h-5 text-white" />}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    </div>
                    <div className="p-8 border-t border-slate-800 flex justify-end">
                        <button onClick={() => setIsSettingsOpen(false)} className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-4 rounded-xl text-xl font-bold transition-colors">
                            Guardar y Cerrar
                        </button>
                    </div>
                </div>
            </div>
        )}

        <main className="flex-1 w-full h-full relative overflow-hidden">
            {slidesToPresent.map((slide, idx) => (
                <div
                    key={idx}
                    className={`absolute inset-0 w-full h-full flex flex-col justify-center items-center transition-all duration-1000 ease-in-out ${
                        idx === currentSlideIndex 
                            ? 'opacity-100 translate-x-0 scale-100 z-10' 
                            : 'opacity-0 translate-x-8 scale-95 z-0 pointer-events-none'
                    }`}
                >
                    {slide}
                </div>
            ))}
        </main>

        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 max-w-[90vw] overflow-x-auto flex gap-4 bg-slate-900/50 p-3 rounded-full backdrop-blur-sm border border-slate-800">
            {slidesToPresent.map((_, idx) => (
                <div 
                    key={idx} 
                    className={`h-3 rounded-full transition-all duration-500 ease-out ${idx === currentSlideIndex ? 'bg-blue-500 w-16' : 'bg-slate-700 w-4'}`}
                />
            ))}
        </div>
    </div>
  );
}

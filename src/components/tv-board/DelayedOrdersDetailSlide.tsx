"use client";

import React, { useMemo } from 'react';
import { EcommerceOrder } from '@/types';
import { differenceInDays, format } from 'date-fns';
import { es } from 'date-fns/locale';
import { AlertTriangle, Clock, Calendar } from 'lucide-react';

interface DelayedOrdersDetailSlideProps {
  orders: EcommerceOrder[];
}

export const DelayedOrdersDetailSlide: React.FC<DelayedOrdersDetailSlideProps> = ({ orders }) => {
  const delayedOrders = useMemo(() => {
    const today = new Date();
    return orders
      .filter(o => !o.dispatchDate && o.fechaPedido)
      .map(o => {
          const orderDate = new Date(o.fechaPedido!);
          const daysDelayed = differenceInDays(today, orderDate);
          return { ...o, daysDelayed };
      })
      .filter(o => o.daysDelayed >= 2) // SLA > 48h
      .sort((a, b) => b.daysDelayed - a.daysDelayed)
      .slice(0, 10); // Show top 10 oldest
  }, [orders]);

  return (
    <div className="flex flex-col h-full w-full gap-8 animate-in fade-in zoom-in duration-700 p-8">
      <div className="bg-slate-900/40 backdrop-blur-md rounded-[2.5rem] border border-slate-800/50 p-10 flex flex-col shadow-2xl h-full">
        <div className="flex items-center justify-between mb-10">
          <h3 className="text-4xl font-black text-slate-100 uppercase tracking-tighter flex items-center gap-6">
            <div className="p-4 bg-red-500/20 rounded-2xl border border-red-500/30">
                <AlertTriangle className="w-12 h-12 text-red-500 animate-pulse" />
            </div>
            Auditoría de Pedidos Atrasados (+48h)
          </h3>
          <div className="px-6 py-3 bg-red-500 text-white rounded-full font-bold text-xl shadow-lg shadow-red-500/20">
            {delayedOrders.length > 0 ? `${delayedOrders.length} PEDIDOS CRÍTICOS` : 'SIN PEDIDOS CRÍTICOS'}
          </div>
        </div>

        {delayedOrders.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-6 opacity-50">
             <div className="p-10 bg-slate-800/30 rounded-full">
                <Clock className="w-32 h-32 text-slate-500" />
             </div>
             <p className="text-3xl font-medium text-slate-400">Excelente: No hay pedidos pendientes con atraso críptico.</p>
          </div>
        ) : (
          <div className="flex-1 overflow-hidden">
            <table className="w-full text-left border-separate border-spacing-y-4">
              <thead>
                <tr className="text-slate-400 text-xl uppercase tracking-widest font-bold">
                  <th className="pb-4 pl-8">ID Pedido / Factura</th>
                  <th className="pb-4">Tienda</th>
                  <th className="pb-4">Fecha Pedido</th>
                  <th className="pb-4">Días Atraso</th>
                  <th className="pb-4 pr-8">Estado</th>
                </tr>
              </thead>
              <tbody>
                {delayedOrders.map((o, idx) => (
                  <tr 
                    key={o.id || idx} 
                    className="bg-slate-800/40 hover:bg-slate-800/60 transition-colors group"
                  >
                    <td className="py-6 pl-8 rounded-l-3xl text-2xl font-black text-white group-hover:text-blue-400 tracking-tight">
                      {o.nroPedido || o.factura || 'S/N'}
                    </td>
                    <td className="py-6">
                      <span className="px-5 py-2 bg-slate-700/50 rounded-xl text-xl font-bold text-slate-300">
                        {o.tienda || 'OTROS'}
                      </span>
                    </td>
                    <td className="py-6 text-xl text-slate-400 font-medium">
                      <div className="flex items-center gap-3">
                         <Calendar className="w-6 h-6 opacity-50" />
                         {o.fechaPedido ? format(new Date(o.fechaPedido), 'dd MMM yyyy', { locale: es }) : '---'}
                      </div>
                    </td>
                    <td className="py-6">
                       <div className="flex items-center gap-3">
                        <div className={`w-3 h-3 rounded-full ${o.daysDelayed > 5 ? 'bg-red-500 animate-pulse' : 'bg-orange-500'}`} />
                        <span className={`text-3xl font-black ${o.daysDelayed > 5 ? 'text-red-400' : 'text-orange-400'}`}>
                          {o.daysDelayed} Días
                        </span>
                       </div>
                    </td>
                    <td className="py-6 pr-8 rounded-r-3xl">
                       <span className="px-6 py-2 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-full text-lg font-black uppercase">
                         {o.estado || 'PENDIENTE'}
                       </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-8 text-center text-slate-500 text-lg italic bg-slate-800/20 py-4 rounded-2xl">
          * Mostrando los 10 pedidos más antiguos que superan el SLA de 48 horas establecido por la operación.
        </div>
      </div>
    </div>
  );
};

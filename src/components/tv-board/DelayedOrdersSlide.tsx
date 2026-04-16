"use client";

import React, { useMemo } from 'react';
import { EcommerceOrder } from '@/types';
import { differenceInDays, format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Clock, Calendar, Hash, Store } from 'lucide-react';

interface DelayedOrdersSlideProps {
  orders: EcommerceOrder[];
}

export const DelayedOrdersSlide: React.FC<DelayedOrdersSlideProps> = ({ orders }) => {
  const delayedOrders = useMemo(() => {
    const today = new Date();
    return orders
      .filter(o => !o.dispatchDate && o.fechaPedido)
      .map(o => {
          const orderDate = new Date(o.fechaPedido!);
          const daysDelayed = differenceInDays(today, orderDate);
          return { ...o, daysDelayed };
      })
      .sort((a, b) => b.daysDelayed - a.daysDelayed)
      .slice(0, 15); // Show top 15 oldest
  }, [orders]);

  if (delayedOrders.length === 0) return null;

  return (
    <div className="flex flex-col h-full w-full gap-8 animate-in fade-in zoom-in duration-700 p-8">
      <div className="bg-slate-900/40 backdrop-blur-md rounded-[2.5rem] border border-slate-800/50 p-10 flex flex-col shadow-2xl h-full">
        <div className="flex items-center justify-between mb-8">
          <h3 className="text-4xl font-black text-slate-100 uppercase tracking-tighter flex items-center gap-6">
            <div className="p-4 bg-orange-500/20 rounded-2xl border border-orange-500/30">
                <Clock className="w-12 h-12 text-orange-500" />
            </div>
            Pedidos Pendientes por Antigüedad
          </h3>
          <div className="px-8 py-3 bg-slate-800 text-slate-300 rounded-full font-bold text-xl border border-slate-700">
            {delayedOrders.length} PEDIDOS EN COLA
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          <table className="w-full text-left border-separate border-spacing-y-3">
            <thead>
              <tr className="text-slate-500 text-lg uppercase tracking-widest font-bold">
                <th className="pb-4 pl-8 flex items-center gap-2"><Hash className="w-5 h-5" /> Nro Pedido</th>
                <th className="pb-4"><Store className="w-5 h-5" /> Tienda</th>
                <th className="pb-4"><Calendar className="w-5 h-5" /> Fecha Pedido</th>
                <th className="pb-4 pr-8 text-right text-orange-400">Días Atraso</th>
              </tr>
            </thead>
            <tbody>
              {delayedOrders.map((o, idx) => (
                <tr 
                  key={o.id || idx} 
                  className="bg-slate-800/20 hover:bg-slate-800/40 transition-all group"
                >
                  <td className="py-5 pl-8 rounded-l-3xl text-2xl font-black text-white group-hover:text-blue-400 tracking-tight">
                    {o.ped_factura || o.id || 'S/N'}
                  </td>
                  <td className="py-5">
                    <span className="text-2xl font-bold text-slate-300">
                      {o.tienda || 'OTROS'}
                    </span>
                  </td>
                  <td className="py-5 text-2xl text-slate-400 font-medium">
                    {o.fechaPedido ? format(new Date(o.fechaPedido), 'dd MMM yyyy', { locale: es }) : '---'}
                  </td>
                  <td className="py-5 pr-8 rounded-r-3xl text-right">
                    <span className={`text-3xl font-black ${o.daysDelayed > 3 ? 'text-red-500' : 'text-orange-400'}`}>
                      {o.daysDelayed} d
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 text-center text-slate-500 text-lg font-medium py-3 border-t border-slate-800/50">
          Prioridad de despacho basada en la fecha de creación del pedido.
        </div>
      </div>
    </div>
  );
};

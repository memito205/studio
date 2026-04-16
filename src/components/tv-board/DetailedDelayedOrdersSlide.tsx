"use client";

import React, { useMemo } from 'react';
import { EcommerceOrder, DelayedOrderLog } from '@/types';
import { differenceInDays, format, subDays, isAfter } from 'date-fns';
import { es } from 'date-fns/locale';
import { Clock, Calendar, Hash, Store, MessageSquare } from 'lucide-react';

interface DetailedDelayedOrdersSlideProps {
  orders: any[]; // Expecting pre-processed objects or EcommerceOrder
  logs: DelayedOrderLog[];
  pageTitle?: string;
  totalCritical?: number;
}

export const DetailedDelayedOrdersSlide: React.FC<DetailedDelayedOrdersSlideProps> = ({ orders, logs, pageTitle, totalCritical }) => {
  const logMap = useMemo(() => new Map(logs.map(l => [l.id, l])), [logs]);

  const itemsToShow = useMemo(() => {
    return orders.map(o => {
      const log = logMap.get(o.id);
      const lastJustification = log?.justifications && log.justifications.length > 0
        ? [...log.justifications].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0]
        : null;
      return { ...o, lastJustification };
    });
  }, [orders, logMap]);

  if (itemsToShow.length === 0) return null;

  return (
    <div className="flex flex-col h-full w-full gap-8 animate-in fade-in zoom-in duration-700 p-8">
      <div className="bg-slate-900/40 backdrop-blur-md rounded-[2.5rem] border border-slate-800/50 p-10 flex flex-col shadow-2xl h-full">
        <div className="flex items-center justify-between mb-8">
          <div className="flex flex-col">
              <h3 className="text-4xl font-black text-slate-100 uppercase tracking-tighter flex items-center gap-6">
                <div className="p-4 bg-red-500/20 rounded-2xl border border-red-500/30">
                    <Clock className="w-12 h-12 text-red-500" />
                </div>
                Detalle de Pedidos Atrasados
              </h3>
              {pageTitle && <span className="text-xl font-bold text-blue-400 mt-2 ml-[88px] uppercase tracking-widest">{pageTitle}</span>}
          </div>
          <div className="px-8 py-3 bg-red-500/20 text-red-400 rounded-full font-bold text-xl border border-red-500/30">
            {totalCritical || itemsToShow.length} CRÍTICOS TOTALES
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          <table className="w-full text-left border-separate border-spacing-y-4">
            <thead>
              <tr className="text-slate-500 text-lg uppercase tracking-widest font-bold">
                <th className="pb-4 pl-8 flex items-center gap-2 w-[20%]"><Hash className="w-5 h-5" /> Nro Pedido</th>
                <th className="pb-4 w-[15%]"><Store className="w-5 h-5" /> Tienda</th>
                <th className="pb-4 w-[15%]"><Calendar className="w-5 h-5" /> Fecha</th>
                <th className="pb-4 flex items-center gap-2"><MessageSquare className="w-5 h-5" /> Justificación Operativa</th>
                <th className="pb-4 pr-8 text-right text-red-400 w-[10%]">Atraso</th>
              </tr>
            </thead>
            <tbody>
              {itemsToShow.map((o, idx) => (
                <tr 
                  key={o.id || idx} 
                  className="bg-slate-800/20 hover:bg-slate-800/40 transition-all group"
                >
                  <td className="py-2 pl-8 rounded-l-3xl text-2xl font-black text-white group-hover:text-blue-400 tracking-tight">
                    {o.cleanNroPed || o.id}
                  </td>
                  <td className="py-2 text-2xl font-bold text-slate-300">
                      {o.tienda || 'OTROS'}
                  </td>
                  <td className="py-2 text-xl text-slate-400 font-medium">
                    {o.fechaPedido ? format(new Date(o.fechaPedido), 'dd MMM', { locale: es }) : '---'}
                  </td>
                  <td className="py-2">
                    {o.lastJustification ? (
                        <div className="flex flex-col">
                            <span className="text-xl text-slate-200 line-clamp-2 italic font-medium leading-tight">
                                "{o.lastJustification.text}"
                            </span>
                            <span className="text-sm text-slate-500 mt-1 uppercase font-bold tracking-tighter">
                                {o.lastJustification.userName || 'Sistema'} • {format(new Date(o.lastJustification.date), 'dd/MM HH:mm')}
                            </span>
                        </div>
                    ) : (
                        <span className="text-lg text-slate-600 font-bold uppercase tracking-widest italic">
                            Sin justificación registrada
                        </span>
                    )}
                  </td>
                  <td className="py-2 pr-8 rounded-r-3xl text-right">
                    <span className={`text-4xl font-black ${o.daysDelayed > 3 ? 'text-red-500' : 'text-orange-400'}`}>
                      {o.daysDelayed}d
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 text-center text-slate-500 text-lg font-bold py-4 border-t border-slate-800/50 uppercase tracking-[0.2em]">
            Prioridad alta para gestión en Bitrix / SAC
        </div>
      </div>
    </div>
  );
};

"use client";

import React, { useMemo } from 'react';
import { EcommerceOrder } from '@/types';
import { startOfWeek, endOfWeek, format } from 'date-fns';
import { es } from 'date-fns/locale';
import { calculateSlaHours } from '@/lib/parsingUtils';
import { CalendarDays, TrendingUp, Clock } from 'lucide-react';

interface WeeklyDispatchSummarySlideProps {
  orders: EcommerceOrder[];
  holidays: Date[];
}

export const WeeklyDispatchSummarySlide: React.FC<WeeklyDispatchSummarySlideProps> = ({ orders, holidays }) => {
  const weeklyStats = useMemo(() => {
    const dispatchedOrders = orders.filter(o => o.dispatchDate && o.fechaPedido);
    const weekStats = new Map<string, { 
        startDate: Date; 
        endDate: Date; 
        '0-1 Días': number; 
        '1-2 Días': number; 
        '2-3 Días': number; 
        '>3 Días': number; 
        total: number; 
        totalDispatchDays: number; 
    }>();

    dispatchedOrders.forEach(order => {
      const dispatchDate = new Date(order.dispatchDate!);
      const weekStart = startOfWeek(dispatchDate, { weekStartsOn: 1 });
      const weekEnd = endOfWeek(dispatchDate, { weekStartsOn: 1 });
      const weekKey = format(weekStart, 'yyyy-MM-dd');
      
      if (!weekStats.has(weekKey)) {
          weekStats.set(weekKey, { 
              startDate: weekStart, 
              endDate: weekEnd, 
              '0-1 Días': 0, 
              '1-2 Días': 0, 
              '2-3 Días': 0, 
              '>3 Días': 0, 
              total: 0, 
              totalDispatchDays: 0 
          });
      }
      
      const stats = weekStats.get(weekKey)!;
      stats.total++;
      const days = calculateSlaHours(new Date(order.fechaPedido!), dispatchDate, holidays) / 24;
      stats.totalDispatchDays += days;
      
      if (days <= 1) stats['0-1 Días']++;
      else if (days <= 2) stats['1-2 Días']++;
      else if (days <= 3) stats['2-3 Días']++;
      else stats['>3 Días']++;
    });

    return Array.from(weekStats.entries())
      .map(([weekKey, stats]) => {
        const total = stats.total;
        return {
          weekKey,
          weekLabel: `Semana del ${format(stats.startDate, 'dd MMM', { locale: es })} al ${format(stats.endDate, 'dd MMM yyyy', { locale: es })}`,
          ...stats,
          averageDispatchDays: total > 0 ? stats.totalDispatchDays / total : 0,
          '0_1_Perc': total > 0 ? (stats['0-1 Días'] / total) * 100 : 0,
          '1_2_Perc': total > 0 ? (stats['1-2 Días'] / total) * 100 : 0,
          '2_3_Perc': total > 0 ? (stats['2-3 Días'] / total) * 100 : 0,
          'gt3_Perc': total > 0 ? (stats['>3 Días'] / total) * 100 : 0,
        };
      })
      .sort((a, b) => b.weekKey.localeCompare(a.weekKey))
      .slice(0, 4); // Show last 4 weeks for better 16:9 fit
  }, [orders, holidays]);

  return (
    <div className="flex flex-col h-full w-full gap-8 animate-in fade-in zoom-in duration-700 p-4 lg:p-12">
      <div className="bg-slate-900/40 backdrop-blur-md rounded-[3rem] border border-slate-800/50 p-12 lg:p-16 flex flex-col shadow-2xl h-full">
        <div className="flex items-center justify-between mb-10">
          <h3 className="text-4xl font-black text-slate-100 uppercase tracking-tighter flex items-center gap-6">
            <div className="p-4 bg-blue-500/20 rounded-2xl border border-blue-500/30">
                <CalendarDays className="w-12 h-12 text-blue-500" />
            </div>
            Resumen Semanal de Tiempos de Despacho
          </h3>
          <div className="flex gap-4">
              <div className="px-6 py-2 bg-slate-800 text-blue-400 rounded-full font-bold text-lg border border-slate-700">
                  HISTÓRICO 5 SEMANAS
              </div>
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          <table className="w-full text-left border-separate border-spacing-y-4">
            <thead>
              <tr className="text-slate-500 text-lg uppercase tracking-widest font-bold">
                <th className="pb-4 pl-8">Periodo Semana</th>
                <th className="pb-4 text-center">Total</th>
                <th className="pb-4 text-center">Promedio</th>
                <th className="pb-4 text-center bg-green-500/10 rounded-t-2xl">0-1d</th>
                <th className="pb-4 text-center bg-blue-500/10 rounded-t-2xl">1-2d</th>
                <th className="pb-4 text-center bg-orange-500/10 rounded-t-2xl">2-3d</th>
                <th className="pb-4 text-center pr-8 bg-red-500/10 rounded-t-2xl text-red-400">&gt;3d</th>
              </tr>
            </thead>
            <tbody>
              {weeklyStats.map((week) => (
                <tr 
                  key={week.weekKey} 
                  className="bg-slate-800/20 hover:bg-slate-800/40 transition-all group"
                >
                  <td className="py-4 pl-8 rounded-l-3xl text-2xl font-bold text-slate-100 group-hover:text-blue-400">
                    {week.weekLabel}
                  </td>
                  <td className="py-4 text-center text-3xl font-black text-white">
                    {week.total}
                  </td>
                  <td className="py-4 text-center">
                    <div className="flex flex-col items-center">
                        <span className="text-3xl font-black text-blue-400">{week.averageDispatchDays.toFixed(1)}</span>
                        <span className="text-xs font-bold text-slate-500 uppercase">Días</span>
                    </div>
                  </td>
                  <td className="py-4 text-center bg-green-500/5">
                    <div className="flex flex-col items-center">
                        <span className="text-2xl font-bold text-green-400">{week['0-1 Días']}</span>
                        <span className="text-xs font-medium text-green-500/50">{week['0_1_Perc'].toFixed(0)}%</span>
                    </div>
                  </td>
                  <td className="py-4 text-center bg-blue-500/5">
                    <div className="flex flex-col items-center">
                        <span className="text-2xl font-bold text-blue-400">{week['1-2 Días']}</span>
                        <span className="text-xs font-medium text-blue-500/50">{week['1_2_Perc'].toFixed(0)}%</span>
                    </div>
                  </td>
                  <td className="py-4 text-center bg-orange-500/5">
                    <div className="flex flex-col items-center">
                        <span className="text-2xl font-bold text-orange-400">{week['2-3 Días']}</span>
                        <span className="text-xs font-medium text-orange-500/50">{week['2_3_Perc'].toFixed(0)}%</span>
                    </div>
                  </td>
                  <td className="py-4 text-center pr-8 rounded-r-3xl bg-red-500/5">
                    <div className="flex flex-col items-center">
                        <span className="text-2xl font-bold text-red-500">{week['>3 Días']}</span>
                        <span className="text-xs font-medium text-red-500/50">{week['gt3_Perc'].toFixed(0)}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-8 flex items-center justify-between text-slate-500 text-lg font-medium p-6 bg-slate-950/30 rounded-3xl border border-slate-800/50">
          <div className="flex items-center gap-3">
              <TrendingUp className="w-6 h-6 text-blue-500" />
              <span>Eficiencia basada en días calendario excluyendo festivos.</span>
          </div>
          <div className="flex items-center gap-3">
              <Clock className="w-6 h-6 text-green-500" />
              <span>Meta: Despacho en menos de 48 horas (2 días).</span>
          </div>
        </div>
      </div>
    </div>
  );
};

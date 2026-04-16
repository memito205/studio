"use client";

import React, { useMemo } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList, AreaChart, Area } from 'recharts';
import { EcommerceOrder } from '@/types';
import { format, subDays, isAfter } from 'date-fns';
import { es } from 'date-fns/locale';
import { calculateSlaHours } from '@/lib/parsingUtils';
import { BarChart3, TrendingUp, Zap } from 'lucide-react';

interface EfficiencyGraphsSlideProps {
  orders: EcommerceOrder[];
  holidays: Date[];
}

export const EfficiencyGraphsSlide: React.FC<EfficiencyGraphsSlideProps> = ({ orders, holidays }) => {
  const wasDispatchedLate = (order: EcommerceOrder) => {
    if (!order.dispatchDate || !order.fechaPedido) return false;
    const dispatchDate = new Date(order.dispatchDate);
    const orderDate = new Date(order.fechaPedido);
    const hours = calculateSlaHours(orderDate, dispatchDate, holidays);
    return hours > 48;
  };

  const effectivenessByDay = useMemo(() => {
    const dayStats = new Map<string, { total: number, onTime: number }>();
    const thirtyDaysAgo = subDays(new Date(), 30);

    orders.forEach(order => {
      if (order.dispatchDate) {
        const d = new Date(order.dispatchDate);
        if (isAfter(d, thirtyDaysAgo)) {
            const dayKey = format(d, 'yyyy-MM-dd');
            const stats = dayStats.get(dayKey) || { total: 0, onTime: 0 };
            stats.total++;
            if (!wasDispatchedLate(order)) stats.onTime++;
            dayStats.set(dayKey, stats);
        }
      }
    });

    return Array.from(dayStats.entries())
      .map(([day, stats]) => ({
        name: format(new Date(day + 'T00:00:00'), 'dd MMM', { locale: es }),
        date: day,
        Efectividad: stats.total > 0 ? (stats.onTime / stats.total) * 100 : 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [orders, holidays]);

  const effectivenessByMonth = useMemo(() => {
    const monthStats = new Map<string, { total: number, onTime: number }>();
    
    orders.forEach(order => {
      if (order.dispatchDate) {
        const monthKey = format(new Date(order.dispatchDate), 'yyyy-MM');
        const stats = monthStats.get(monthKey) || { total: 0, onTime: 0 };
        stats.total++;
        if (!wasDispatchedLate(order)) stats.onTime++;
        monthStats.set(monthKey, stats);
      }
    });

    return Array.from(monthStats.entries())
      .map(([month, stats]) => ({
        name: format(new Date(month + '-02'), 'MMM yyyy', { locale: es }),
        date: month,
        Efectividad: stats.total > 0 ? (stats.onTime / stats.total) * 100 : 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-6); // last 6 months
  }, [orders, holidays]);

  return (
    <div className="flex flex-col h-full w-full gap-8 animate-in fade-in zoom-in duration-700 p-8">
      <div className="grid grid-cols-1 grid-rows-2 gap-8 h-full">
        {/* Daily Effectiveness */}
        <div className="bg-slate-900/40 backdrop-blur-md rounded-[2.5rem] border border-slate-800/50 p-8 flex flex-col shadow-2xl">
          <div className="flex items-center justify-between mb-6">
              <h3 className="text-3xl font-black text-slate-100 uppercase tracking-tighter flex items-center gap-4">
                <BarChart3 className="w-10 h-10 text-blue-400" />
                Efectividad de Despacho Diaria (30 Días)
              </h3>
              <div className="px-4 py-1 bg-blue-500/20 text-blue-400 rounded-full text-sm font-black border border-blue-500/30">
                  META: 95%
              </div>
          </div>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={effectivenessByDay}>
                <defs>
                  <linearGradient id="colorEff" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="name" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} dy={10} />
                <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} unit="%" domain={[0, 100]} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '16px' }}
                  itemStyle={{ color: '#60a5fa', fontWeight: 'bold' }}
                />
                <Area 
                  type="monotone" 
                  dataKey="Efectividad" 
                  stroke="#3b82f6" 
                  strokeWidth={4} 
                  fillOpacity={1} 
                  fill="url(#colorEff)" 
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Monthly Effectiveness */}
        <div className="bg-slate-900/40 backdrop-blur-md rounded-[2.5rem] border border-slate-800/50 p-8 flex flex-col shadow-2xl">
          <div className="flex items-center justify-between mb-6">
              <h3 className="text-3xl font-black text-slate-100 uppercase tracking-tighter flex items-center gap-4">
                <TrendingUp className="w-10 h-10 text-purple-400" />
                Tendencia de Cumplimiento Mensual
              </h3>
              <div className="flex items-center gap-2 text-purple-400 font-bold">
                  <Zap className="w-5 h-5 fill-purple-400" />
                  <span>SLA 48H</span>
              </div>
          </div>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={effectivenessByMonth}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="name" stroke="#64748b" fontSize={14} tickLine={false} axisLine={false} dy={10} />
                <YAxis stroke="#64748b" fontSize={14} tickLine={false} axisLine={false} unit="%" domain={[0, 100]} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '16px' }}
                />
                <Line 
                  type="stepAfter" 
                  dataKey="Efectividad" 
                  stroke="#a855f7" 
                  strokeWidth={6} 
                  dot={{ r: 8, fill: '#a855f7', stroke: '#0f172a', strokeWidth: 3 }}
                >
                  <LabelList dataKey="Efectividad" position="top" offset={20} fill="#d8b4fe" fontSize={16} fontWeight="900" formatter={(val: number) => `${val.toFixed(1)}%`} />
                </Line>
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};

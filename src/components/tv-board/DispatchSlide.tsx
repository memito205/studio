"use client";

import React, { useMemo } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList } from 'recharts';
import { EcommerceOrder } from '@/types';
import { format, subDays, isAfter, isSameDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { Truck, CheckCircle, AlertCircle, GaugeCircle } from 'lucide-react';
import { calculateSlaHours } from '@/lib/parsingUtils';

interface DispatchSlideProps {
  orders: EcommerceOrder[];
}

export const DispatchSlide: React.FC<DispatchSlideProps> = ({ orders }) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 1. Calculate Daily KPIs
  const dailyMetrics = useMemo(() => {
    const dispatchesToday = orders.filter(o => o.dispatchDate && isSameDay(new Date(o.dispatchDate), today));
    const total = dispatchesToday.length;
    
    let onTime = 0;
    dispatchesToday.forEach(o => {
        const orderDate = o.fechaPedido ? new Date(o.fechaPedido) : null;
        const dispatchDate = new Date(o.dispatchDate!);
        if (orderDate) {
            // Simplified 48h SLA for TV
            const diff = calculateSlaHours(orderDate, dispatchDate, []);
            if (diff <= 48) onTime++;
        } else {
            onTime++;
        }
    });

    const late = total - onTime;
    const compliance = total > 0 ? (onTime / total) * 100 : 100;

    return { total, onTime, late, compliance };
  }, [orders]);

  // 2. Dispatch Trend (Last 14 days)
  const dispatchTrend = useMemo(() => {
    const dayMap = new Map<string, number>();
    const fourteenDaysAgo = subDays(new Date(), 14);
    
    for (let i = 0; i < 14; i++) {
        const d = format(subDays(new Date(), i), 'yyyy-MM-dd');
        dayMap.set(d, 0);
    }

    orders.forEach(o => {
      if (o.dispatchDate) {
        const d = new Date(o.dispatchDate);
        if (isAfter(d, fourteenDaysAgo)) {
            const dayKey = format(d, 'yyyy-MM-dd');
            dayMap.set(dayKey, (dayMap.get(dayKey) || 0) + 1);
        }
      }
    });

    return Array.from(dayMap.entries())
      .map(([date, count]) => ({ 
        date, 
        label: format(new Date(date + 'T00:00:00'), 'dd MMM', { locale: es }), 
        count 
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [orders]);

  return (
    <div className="flex flex-col h-full w-full gap-8 animate-in fade-in zoom-in duration-700 p-8">
      {/* Header Stat Cards */}
      <div className="grid grid-cols-4 gap-8">
        <div className="bg-blue-600/20 backdrop-blur-md rounded-3xl border border-blue-500/30 p-8 flex items-center gap-6 shadow-xl">
            <div className="p-4 bg-blue-500 rounded-2xl">
                <Truck className="w-10 h-10 text-white" />
            </div>
            <div>
                <p className="text-blue-400 font-bold uppercase tracking-widest text-sm">Despachos Hoy</p>
                <h4 className="text-5xl font-black text-white">{dailyMetrics.total}</h4>
            </div>
        </div>

        <div className="bg-green-600/20 backdrop-blur-md rounded-3xl border border-green-500/30 p-8 flex items-center gap-6 shadow-xl">
            <div className="p-4 bg-green-500 rounded-2xl">
                <CheckCircle className="w-10 h-10 text-white" />
            </div>
            <div>
                <p className="text-green-400 font-bold uppercase tracking-widest text-sm">A Tiempo</p>
                <h4 className="text-5xl font-black text-white">{dailyMetrics.onTime}</h4>
            </div>
        </div>

        <div className="bg-red-600/20 backdrop-blur-md rounded-3xl border border-red-500/30 p-8 flex items-center gap-6 shadow-xl">
            <div className="p-4 bg-red-500 rounded-2xl">
                <AlertCircle className="w-10 h-10 text-white" />
            </div>
            <div>
                <p className="text-red-400 font-bold uppercase tracking-widest text-sm">Atrasados</p>
                <h4 className="text-5xl font-black text-white">{dailyMetrics.late}</h4>
            </div>
        </div>

        <div className="bg-purple-600/20 backdrop-blur-md rounded-3xl border border-purple-500/30 p-8 flex items-center gap-6 shadow-xl">
            <div className="p-4 bg-purple-500 rounded-2xl">
                <GaugeCircle className="w-10 h-10 text-white" />
            </div>
            <div>
                <p className="text-purple-400 font-bold uppercase tracking-widest text-sm">Cumplimiento %</p>
                <h4 className="text-5xl font-black text-white">{dailyMetrics.compliance.toFixed(1)}%</h4>
            </div>
        </div>
      </div>

      {/* Main Chart */}
      <div className="flex-1 min-h-0 bg-slate-900/40 backdrop-blur-md rounded-[2.5rem] border border-slate-800/50 p-10 flex flex-col shadow-2xl">
        <h3 className="text-3xl font-bold text-slate-300 mb-8 uppercase tracking-widest text-center flex items-center justify-center gap-4">
            <div className="w-3 h-10 bg-blue-500 rounded-full"></div>
            Tendencia de Despachos (Histórico 14 Días)
        </h3>
        <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={dispatchTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
              <XAxis dataKey="label" stroke="#94a3b8" fontSize={16} tickLine={false} axisLine={false} dy={15} />
              <YAxis stroke="#94a3b8" fontSize={16} tickLine={false} axisLine={false} />
              <Tooltip 
                contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '12px' }}
                itemStyle={{ color: '#3b82f6' }}
              />
              <Line 
                  type="monotone" 
                  dataKey="count" 
                  name="Envíos" 
                  stroke="#3b82f6" 
                  strokeWidth={6} 
                  dot={{ r: 10, fill: '#3b82f6', stroke: '#0f172a', strokeWidth: 4 }}
                  activeDot={{ r: 14, fill: '#fff' }}
              >
                  <LabelList dataKey="count" position="top" fill="#60a5fa" fontSize={18} fontWeight="bold" offset={15} />
              </Line>
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

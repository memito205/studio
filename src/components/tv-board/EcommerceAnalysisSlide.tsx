"use client";

import React, { useMemo } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LineChart, Line } from 'recharts';
import { EcommerceOrder } from '@/types';
import { format, subDays, isAfter } from 'date-fns';
import { es } from 'date-fns/locale';

interface EcommerceAnalysisSlideProps {
  orders: EcommerceOrder[];
}

export const EcommerceAnalysisSlide: React.FC<EcommerceAnalysisSlideProps> = ({ orders }) => {
  // 1. Data for Participation by Store
  const storeParticipation = useMemo(() => {
    const storeMap = new Map<string, number>();
    orders.forEach(order => {
      const store = order.tienda || 'SIN TIENDA';
      storeMap.set(store, (storeMap.get(store) || 0) + 1);
    });
    
    return Array.from(storeMap.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8); // Top 8
  }, [orders]);

  // 2. Data for Order Trend (Last 14 days)
  const orderTrend = useMemo(() => {
    const dayMap = new Map<string, number>();
    const fourteenDaysAgo = subDays(new Date(), 14);
    
    // Initialize days
    for (let i = 0; i < 14; i++) {
        const d = format(subDays(new Date(), i), 'yyyy-MM-dd');
        dayMap.set(d, 0);
    }

    orders.forEach(order => {
      if (order.fechaPedido) {
        const d = new Date(order.fechaPedido);
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
      <div className="grid grid-cols-2 gap-8 h-full">
        {/* Participation Chart */}
        <div className="bg-slate-900/40 backdrop-blur-md rounded-[2.5rem] border border-slate-800/50 p-8 flex flex-col shadow-2xl">
          <h3 className="text-3xl font-bold text-slate-300 mb-8 uppercase tracking-widest text-center">
            Participación por Tienda
          </h3>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={storeParticipation} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                <XAxis type="number" stroke="#94a3b8" fontSize={14} tickLine={false} axisLine={false} />
                <YAxis 
                   dataKey="name" 
                   type="category" 
                   stroke="#94a3b8" 
                   fontSize={16} 
                   width={120}
                   tickLine={false} 
                   axisLine={false}
                />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '12px' }}
                  itemStyle={{ color: '#60a5fa' }}
                />
                <Bar 
                  dataKey="value" 
                  name="Pedidos" 
                  fill="#60a5fa" 
                  radius={[0, 10, 10, 0]} 
                  barSize={30}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Trend Chart */}
        <div className="bg-slate-900/40 backdrop-blur-md rounded-[2.5rem] border border-slate-800/50 p-8 flex flex-col shadow-2xl">
          <h3 className="text-3xl font-bold text-slate-300 mb-8 uppercase tracking-widest text-center">
            Tendencia Últimos 14 Días
          </h3>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={orderTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="label" stroke="#94a3b8" fontSize={14} tickLine={false} axisLine={false} />
                <YAxis stroke="#94a3b8" fontSize={14} tickLine={false} axisLine={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '12px' }}
                  itemStyle={{ color: '#22d3ee' }}
                />
                <Line 
                    type="monotone" 
                    dataKey="count" 
                    name="Pedidos" 
                    stroke="#22d3ee" 
                    strokeWidth={5} 
                    dot={{ r: 8, fill: '#22d3ee', stroke: '#0f172a', strokeWidth: 3 }}
                    activeDot={{ r: 12, fill: '#fff' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};

"use client";

import React, { useMemo } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LabelList } from 'recharts';
import { EcommerceOrder } from '@/types';
import { ShieldCheck, Timer, TrendingUp } from 'lucide-react';

interface EfficiencySlideProps {
  orders: EcommerceOrder[];
  holidays: Date[];
}

export const EfficiencySlide: React.FC<EfficiencySlideProps> = ({ orders, holidays }) => {
  
  // 1. Calculate Historical Efficiency (SLA 48h)
  const stats = useMemo(() => {
    const dispatchedOrders = orders.filter(o => o.dispatchDate && o.fechaPedido);
    if (dispatchedOrders.length === 0) return { efficiency: 0, avgDays: 0, total: 0 };

    let onTime = 0;
    let totalDays = 0;

    dispatchedOrders.forEach(order => {
        const orderDate = new Date(order.fechaPedido!);
        const dispatchDate = new Date(order.dispatchDate!);
        const diffHours = (dispatchDate.getTime() - orderDate.getTime()) / (1000 * 60 * 60);
        
        if (diffHours <= 48) onTime++;
        totalDays += diffHours / 24;
    });

    return {
        efficiency: (onTime / dispatchedOrders.length) * 100,
        avgDays: totalDays / dispatchedOrders.length,
        total: dispatchedOrders.length
    };
  }, [orders]);

  // 2. Efficiency by Store
  const storeEfficiency = useMemo(() => {
     const storeMap = new Map<string, { total: number; onTime: number }>();
     
     orders.filter(o => o.dispatchDate && o.fechaPedido).forEach(order => {
         const store = order.tienda || 'SIN TIENDA';
         const entry = storeMap.get(store) || { total: 0, onTime: 0 };
         entry.total++;
         
         const diffHours = (new Date(order.dispatchDate!).getTime() - new Date(order.fechaPedido!).getTime()) / (1000 * 60 * 60);
         if (diffHours <= 48) entry.onTime++;
         storeMap.set(store, entry);
     });

     return Array.from(storeMap.entries())
        .map(([name, data]) => ({ 
            name, 
            value: (data.onTime / data.total) * 100 
        }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10);
  }, [orders]);

  const getEfficiencyColor = (val: number) => {
      if (val >= 90) return '#22c55e'; // Green
      if (val >= 75) return '#eab308'; // Amber
      return '#ef4444'; // Red
  };

  return (
    <div className="flex flex-col h-full w-full gap-8 animate-in fade-in slide-in-from-bottom-12 duration-1000 p-8">
      {/* Top Stats */}
      <div className="grid grid-cols-3 gap-8">
        <div className="bg-slate-900/40 backdrop-blur-md rounded-[2.5rem] border border-slate-800/50 p-8 flex items-center gap-8 shadow-2xl">
          <div className="p-6 bg-green-500/10 rounded-3xl">
            <ShieldCheck className="w-16 h-16 text-green-400" />
          </div>
          <div>
            <p className="text-xl font-bold text-slate-400 uppercase tracking-widest mb-2">Eficiencia SLA</p>
            <p className="text-6xl font-black text-white">{stats.efficiency.toFixed(1)}%</p>
          </div>
        </div>

        <div className="bg-slate-900/40 backdrop-blur-md rounded-[2.5rem] border border-slate-800/50 p-8 flex items-center gap-8 shadow-2xl">
          <div className="p-6 bg-blue-500/10 rounded-3xl">
            <Timer className="w-16 h-16 text-blue-400" />
          </div>
          <div>
            <p className="text-xl font-bold text-slate-400 uppercase tracking-widest mb-2">Días Promedio</p>
            <p className="text-6xl font-black text-white">{stats.avgDays.toFixed(1)} <span className="text-2xl font-normal text-slate-500">días</span></p>
          </div>
        </div>

        <div className="bg-slate-900/40 backdrop-blur-md rounded-[2.5rem] border border-slate-800/50 p-8 flex items-center gap-8 shadow-2xl">
          <div className="p-6 bg-purple-500/10 rounded-3xl">
            <TrendingUp className="w-16 h-16 text-purple-400" />
          </div>
          <div>
            <p className="text-xl font-bold text-slate-400 uppercase tracking-widest mb-2">Total Despachos</p>
            <p className="text-6xl font-black text-white">{stats.total.toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* Efficiency Chart */}
      <div className="flex-1 bg-slate-900/40 backdrop-blur-md rounded-[2.5rem] border border-slate-800/50 p-10 flex flex-col shadow-2xl min-h-0">
          <h3 className="text-3xl font-bold text-slate-300 mb-10 uppercase tracking-[0.3em] text-center">
            Eficiencia Puntualidad por Tienda (SLA 48h)
          </h3>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={storeEfficiency} margin={{ bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <XAxis 
                    dataKey="name" 
                    stroke="#94a3b8" 
                    fontSize={14} 
                    tickLine={false} 
                    axisLine={false}
                    angle={-25}
                    textAnchor="end"
                />
                <YAxis unit="%" stroke="#94a3b8" fontSize={14} tickLine={false} axisLine={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '12px' }}
                  formatter={(val: number) => [`${val.toFixed(1)}%`, 'Eficiencia']}
                />
                <Bar 
                  dataKey="value" 
                  radius={[10, 10, 0, 0]} 
                  barSize={60}
                >
                  <LabelList dataKey="value" position="top" fill="#94a3b8" fontSize={14} offset={10} formatter={(val: number) => `${val.toFixed(1)}%`} />
                  {storeEfficiency.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={getEfficiencyColor(entry.value)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
      </div>
    </div>
  );
};

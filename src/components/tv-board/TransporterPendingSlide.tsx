import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, LabelList, Tooltip, Cell } from 'recharts';
import { Truck } from 'lucide-react';

interface TransporterPendingSlideProps {
  transporterCounts: Record<string, number>;
}

const COLORS = ['#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899']; 

export const TransporterPendingSlide: React.FC<TransporterPendingSlideProps> = ({ transporterCounts }) => {
  const data = Object.entries(transporterCounts)
    .filter(([_, count]) => count > 0)
    .map(([transporter, count]) => ({
        transporter: transporter || 'SIN ASIGNAR',
        count
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10); 

  return (
    <div className="w-full h-full flex flex-col items-center justify-center p-12">
      <h2 className="text-6xl font-extrabold text-slate-100 mb-12 tracking-tight flex items-center gap-6">
        <Truck className="w-16 h-16 text-indigo-400" />
        Pendientes por Transportadora
      </h2>
      
      <div className="w-full max-w-7xl h-[600px] bg-slate-900/50 rounded-3xl border border-slate-700/50 p-8 shadow-2xl pt-20">
        {data.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 100, right: 30, left: 20, bottom: 50 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <YAxis hide domain={[0, 'auto']} padding={{ top: 60 }} />
                <XAxis 
                  dataKey="transporter" 
                  stroke="#94a3b8" 
                  tick={{ fill: '#94a3b8', fontSize: 24, fontWeight: 'bold' }} 
                  axisLine={false}
                  tickLine={false}
                  dy={20}
                  interval={0}
                />
                <Tooltip 
                  cursor={{ fill: '#1e293b' }}
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', fontSize: '24px', fontWeight: 'bold', color: '#fff' }}
                />
                <Bar 
                  dataKey="count" 
                  radius={[8, 8, 0, 0]}
                  animationDuration={2000}
                >
                  {data.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                  <LabelList 
                    dataKey="count" 
                    position="top" 
                    fill="#ffffff" 
                    fontSize={44} 
                    fontWeight="black" 
                    dy={-15}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
        ) : (
            <div className="w-full h-full flex items-center justify-center">
                 <span className="text-5xl text-slate-500 font-medium">No hay despachos pendientes</span>
            </div>
        )}
      </div>
    </div>
  );
};

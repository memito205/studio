import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, LabelList, Tooltip, Cell } from 'recharts';

interface DelayedByStoreSlideProps {
  delayedByStore: Record<string, number>;
}

const COLORS = ['#ef4444', '#f87171', '#fca5a5', '#dc2626', '#b91c1c']; // Red shades for delayed

export const DelayedByStoreSlide: React.FC<DelayedByStoreSlideProps> = ({ delayedByStore }) => {
  const data = Object.entries(delayedByStore)
    .filter(([_, count]) => count > 0)
    .map(([store, count]) => ({
        store,
        count
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10); // Display top 10 to fit TV

  return (
    <div className="w-full h-full flex flex-col items-center justify-center p-12">
      <h2 className="text-6xl font-extrabold text-slate-100 mb-12 tracking-tight">
        Atrasos por Tienda
      </h2>
      
      <div className="w-full max-w-7xl h-[600px] bg-slate-900/50 rounded-3xl border border-slate-700/50 p-8 shadow-2xl pt-16">
        {data.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 80, right: 30, left: 20, bottom: 50 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <YAxis hide domain={[0, 'auto']} padding={{ top: 40 }} />
                <XAxis 
                  dataKey="store" 
                  stroke="#94a3b8" 
                  tick={{ fill: '#94a3b8', fontSize: 20, fontWeight: 'bold' }} 
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
                    fill="#f1f5f9" 
                    fontSize={36} 
                    fontWeight="bold" 
                    dy={-10}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
        ) : (
            <div className="w-full h-full flex items-center justify-center">
                 <span className="text-5xl text-slate-500 font-medium">Ninguna tienda presenta atrasos</span>
            </div>
        )}
      </div>
    </div>
  );
};

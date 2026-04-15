import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, LabelList, Tooltip } from 'recharts';

interface HourlyTrendSlideProps {
  hourlyCounts: Record<string, number>;
}

export const HourlyTrendSlide: React.FC<HourlyTrendSlideProps> = ({ hourlyCounts }) => {
  const data = Object.entries(hourlyCounts).map(([hour, count]) => ({
    hour,
    count
  }));

  const maxCount = Math.max(...data.map(d => d.count), 1);

  return (
    <div className="w-full h-full flex flex-col items-center justify-center p-12">
      <h2 className="text-6xl font-extrabold text-slate-100 mb-12 tracking-tight">
        Ritmo de Despachos (Hoy)
      </h2>
      
      <div className="w-full max-w-7xl h-[600px] bg-slate-900/50 rounded-3xl border border-slate-700/50 p-8 shadow-2xl pt-16">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
            <XAxis 
              dataKey="hour" 
              stroke="#94a3b8" 
              tick={{ fill: '#94a3b8', fontSize: 24, fontWeight: 'bold' }} 
              axisLine={false}
              tickLine={false}
              dy={10}
            />
            <Tooltip 
              cursor={{ fill: '#1e293b' }}
              contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', fontSize: '24px', fontWeight: 'bold', color: '#fff' }}
            />
            <Bar 
              dataKey="count" 
              fill="#3b82f6" 
              radius={[8, 8, 0, 0]}
              animationDuration={2000}
            >
              <LabelList 
                dataKey="count" 
                position="top" 
                fill="#ffffff" 
                fontSize={40} 
                fontWeight="black" 
                formatter={(val: number) => val > 0 ? val : ''}
                dy={-15}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

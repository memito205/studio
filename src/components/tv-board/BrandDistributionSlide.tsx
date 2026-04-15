import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';

interface BrandDistributionSlideProps {
  storeCounts: Record<string, number>;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#6366f1'];

export const BrandDistributionSlide: React.FC<BrandDistributionSlideProps> = ({ storeCounts }) => {
  const data = Object.entries(storeCounts)
    .map(([name, value], index) => ({
      name,
      value,
      fill: COLORS[index % COLORS.length]
    }))
    .sort((a, b) => b.value - a.value);

  const renderCustomizedLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent, index }: any) => {
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * Math.PI / 180);
    const y = cy + radius * Math.sin(-midAngle * Math.PI / 180);

    if (percent < 0.05) return null;

    return (
      <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" className="text-3xl font-bold">
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    );
  };

  return (
    <div className="w-full h-full flex flex-col items-center justify-center p-12">
      <h2 className="text-6xl font-extrabold text-slate-100 mb-12 tracking-tight">
        Distribución por Tienda (Pendientes)
      </h2>
      
      <div className="w-full max-w-6xl h-[600px] bg-slate-900/50 rounded-3xl border border-slate-700/50 p-8 shadow-2xl">
        {data.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={renderCustomizedLabel}
                outerRadius={250}
                innerRadius={120}
                dataKey="value"
                stroke="transparent"
              >
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Pie>
              <Legend 
                verticalAlign="middle" 
                align="right" 
                layout="vertical"
                iconType="circle"
                iconSize={32}
                wrapperStyle={{ fontSize: '32px', color: '#f1f5f9', fontWeight: 'bold' }}
              />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-5xl text-slate-500 font-medium">No hay pedidos pendientes</span>
          </div>
        )}
      </div>
    </div>
  );
};

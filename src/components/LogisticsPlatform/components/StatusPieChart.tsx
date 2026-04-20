
import React from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';
import { PieChartIcon } from './icons';

interface StatusPieChartProps {
    data: { name: string; value: number }[];
}

const COLORS = {
    'En Tránsito': '#34d399', // emerald-400
    'Pendiente de Envío': '#fb923c', // orange-400
    'Recibida': '#60a5fa', // blue-400
    'Otro': '#a8a29e' // stone-400
};

const StatusPieChart: React.FC<StatusPieChartProps> = ({ data }) => {
    if (!data || data.length === 0) {
        return null;
    }

    const RADIAN = Math.PI / 180;
    const renderCustomizedLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent, index }: any) => {
        const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
        const x = cx + radius * Math.cos(-midAngle * RADIAN);
        const y = cy + radius * Math.sin(-midAngle * RADIAN);

        if (percent < 0.05) return null; // Don't render labels for small slices

        return (
            <text x={x} y={y} fill="white" textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" className="font-bold text-xs">
                {`${(percent * 100).toFixed(0)}%`}
            </text>
        );
    };

    return (
        <div className="bg-white rounded-lg shadow-lg p-6">
            <h3 className="text-lg font-semibold text-gray-800 flex items-center mb-4">
                <PieChartIcon className="h-6 w-6 mr-3 text-green-600" />
                Distribución de Estados
            </h3>
            <div style={{ width: '100%', height: 300 }}>
                <ResponsiveContainer>
                    <PieChart>
                        <Pie
                            data={data}
                            cx="50%"
                            cy="50%"
                            labelLine={false}
                            label={renderCustomizedLabel}
                            outerRadius={120}
                            fill="#8884d8"
                            dataKey="value"
                            nameKey="name"
                        >
                            {data.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[entry.name as keyof typeof COLORS] || COLORS['Otro']} />
                            ))}
                        </Pie>
                        <Tooltip formatter={(value: number) => [value.toLocaleString('es-ES'), 'Documentos']} />
                        <Legend iconSize={12} wrapperStyle={{fontSize: "14px"}} />
                    </PieChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};

export default StatusPieChart;

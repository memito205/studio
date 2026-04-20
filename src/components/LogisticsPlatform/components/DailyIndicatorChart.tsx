import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { LineChartIcon } from './icons';

interface DailyIndicatorChartProps {
  data: { 'FECHA': string; 'Total Documentos': number }[];
}

const DailyIndicatorChart: React.FC<DailyIndicatorChartProps> = ({ data }) => {
  if (!data || data.length === 0) {
    return null;
  }

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="flex items-center mb-4">
        <LineChartIcon className="h-6 w-6 text-green-600 mr-3"/>
        <h2 className="text-xl font-bold text-gray-800">Indicador Diario: Total de Documentos (Gráfico)</h2>
      </div>
      <div style={{ width: '100%', height: 400 }}>
        <ResponsiveContainer>
          <AreaChart
            data={data}
            margin={{
              top: 5,
              right: 30,
              left: 20,
              bottom: 80,
            }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="FECHA" angle={-45} textAnchor="end" interval="preserveStartEnd" tick={{ fontSize: 11 }} />
            <YAxis allowDecimals={false} dataKey="Total Documentos" />
            <Tooltip
              contentStyle={{
                backgroundColor: 'rgba(255, 255, 255, 0.9)',
                border: '1px solid #ccc',
                borderRadius: '0.5rem',
              }}
            />
            <Area 
                type="monotone" 
                dataKey="Total Documentos"
                stroke="#5B9A31"
                fill="#5B9A31"
                fillOpacity={0.6}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default DailyIndicatorChart;

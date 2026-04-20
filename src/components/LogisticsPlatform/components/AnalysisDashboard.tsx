import React from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { AnalysisResult } from '../types';
import { ChartIcon } from './icons';

interface AnalysisDashboardProps {
  data: AnalysisResult[];
}

const AnalysisDashboard: React.FC<AnalysisDashboardProps> = ({ data }) => {
  if (!data || data.length === 0) {
    return null;
  }

  return (
    <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
      <div className="flex items-center mb-4">
        <ChartIcon className="h-6 w-6 text-green-600 mr-3"/>
        <h2 className="text-xl font-bold text-gray-800">Análisis: Documentos y Cantidades por Bodega</h2>
      </div>
      <div style={{ width: '100%', height: 400 }}>
        <ResponsiveContainer>
          <ComposedChart
            data={data}
            margin={{
              top: 5,
              right: 30,
              left: 20,
              bottom: 80, // Increased margin for rotated labels
            }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" angle={-45} textAnchor="end" interval={0} tick={{ fontSize: 11 }} />
            <YAxis yAxisId="left" orientation="left" stroke="#5B9A31" allowDecimals={false} />
            <YAxis yAxisId="right" orientation="right" stroke="#FF8042" allowDecimals={false} />
            <Tooltip
              contentStyle={{
                backgroundColor: 'rgba(255, 255, 255, 0.9)',
                border: '1px solid #ccc',
                borderRadius: '0.5rem',
              }}
              formatter={(value: number) => value.toLocaleString('es-ES')}
            />
            <Legend verticalAlign="top" wrapperStyle={{ paddingBottom: '20px' }}/>
            <Bar yAxisId="left" dataKey="documentos" fill="#5B9A31" name="Nro. de Documentos Únicos" />
            <Line yAxisId="right" type="monotone" dataKey="cantidad" stroke="#FF8042" strokeWidth={2} name="Cantidad Total" dot={{ r: 3 }} activeDot={{ r: 5 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default AnalysisDashboard;

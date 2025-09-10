
"use client";
import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList } from 'recharts';
import { Transaction, TransactionType } from '../../types';
import { formatCompactCurrency, formatPercentage, formatMillionsCurrency } from '../../services/formatters';
import { BarChartIcon } from '../../components/icons';

interface MonthlyAnalysisChartProps {
  data: Transaction[];
  year: number;
  isPrinting?: boolean;
}

export const MonthlyAnalysisChart: React.FC<MonthlyAnalysisChartProps> = ({ data, year, isPrinting }) => {
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const sales = payload.find((p: any) => p.dataKey === 'sales')?.value || 0;
      const returns = payload.find((p: any) => p.dataKey === 'returns')?.value || 0;
      const rate = sales > 0 ? returns / sales : 0;
      return (
        <div className="bg-white dark:bg-slate-800 p-4 rounded-md shadow-lg border border-slate-200 dark:border-slate-700">
          <p className="label font-bold text-slate-800 dark:text-slate-200">{`${label} ${year}`}</p>
          <p className="text-sales">{`Ventas: ${formatMillionsCurrency(sales)}`}</p>
          <p className="text-returns">{`Devoluciones: ${formatCompactCurrency(returns)}`}</p>
          <p className="text-slate-500 dark:text-slate-400">{`Participación: ${formatPercentage(rate)}`}</p>
        </div>
      );
    }
    return null;
  };


  const chartData = useMemo(() => {
    const monthlyData = Array.from({ length: 12 }, (_, i) => ({
      name: new Date(year, i).toLocaleString('es-CO', { month: 'short' }),
      sales: 0,
      returns: 0,
    }));

    data.forEach(item => {
      const month = item.date.getMonth();
      if (item.type === TransactionType.Sale) {
        monthlyData[month].sales += item.value;
      } else if (item.type === TransactionType.Return) {
        monthlyData[month].returns += item.value;
      }
    });

    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();

    return year === currentYear ? monthlyData.slice(0, currentMonth + 1) : monthlyData;
  }, [data, year]);

  const yMax = Math.max(...chartData.map(d => d.sales), 0);
  const tickInterval = 350_000_000;
  const yAxisMax = yMax > 0 ? Math.ceil(yMax / tickInterval) * tickInterval : tickInterval;
  const yAxisTicks = Array.from({ length: 5 }, (_, i) => i * (yAxisMax / 4));


  const CustomizedXAxisTick = (props: any) => {
    const { x, y, payload } = props;
    const dataPoint = chartData[payload.index];
    const rate = dataPoint.sales > 0 ? dataPoint.returns / dataPoint.sales : 0;
  
    return (
      <g transform={`translate(${x},${y})`}>
        <text x={0} y={0} dy={16} textAnchor="middle" fill="#64748b" className="dark:fill-slate-400 text-xs">
          {payload.value} de {year}
        </text>
        <text x={0} y={0} dy={30} textAnchor="middle" fill={rate > 0.15 ? '#f43f5e' : '#64748b'} className={rate > 0.15 ? 'dark:fill-rose-500' : 'dark:fill-slate-400'} fontSize="12px" fontWeight="bold">
          {formatPercentage(rate)}
        </text>
      </g>
    );
  };
  
  const chart = (
      <BarChart 
        data={chartData} 
        margin={{ top: 30, right: 20, left: 30, bottom: 60 }} // Increased bottom margin for labels
        {...(isPrinting && { width: 960, height: 450 })} // Fixed size for printing
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" className="dark:stroke-slate-700" />
        <XAxis dataKey="name" tick={<CustomizedXAxisTick />} axisLine={false} tickLine={false} />
        <YAxis
          tickFormatter={(value) => formatCompactCurrency(Number(value))}
          axisLine={false}
          tickLine={false}
          tick={{ fill: '#64748b', className: 'dark:fill-slate-400', fontSize: '12px' }}
          domain={[0, yAxisMax]}
          ticks={yAxisTicks}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(100, 116, 139, 0.1)' }}/>
        <Legend
          verticalAlign="top"
          align="right"
          wrapperStyle={{ top: '-10px', right: '0px' }}
          formatter={(value) => <span className="text-slate-700 dark:text-slate-300 capitalize">{value}</span>}
          iconType="circle"
        />
        <Bar dataKey="sales" name="Ventas" fill="var(--color-sales)" radius={[4, 4, 0, 0]}>
            <LabelList 
                dataKey="sales" 
                position="top" 
                formatter={(value: number) => value > 0 ? formatMillionsCurrency(value) : ''} 
                style={{ fontSize: '12px' }} 
                className="fill-slate-600 dark:fill-slate-400 font-medium"
            />
        </Bar>
        <Bar dataKey="returns" name="Devoluciones" fill="var(--color-returns)" radius={[4, 4, 0, 0]}>
            <LabelList 
                dataKey="returns" 
                position="top" 
                formatter={(value: number) => value > 0 ? formatCompactCurrency(value) : ''} 
                style={{ fontSize: '12px' }}
                className="fill-rose-500 dark:fill-rose-500 font-medium"
            />
        </Bar>
      </BarChart>
  );

  return (
    <div className="bg-white dark:bg-slate-800 p-6 rounded-lg shadow-md print-avoid-break print-no-shadow">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Análisis Mensual (Año {year})</h3>
        <button className="p-1.5 bg-slate-100 dark:bg-slate-700/50 rounded-md text-slate-500 dark:text-slate-400 no-print">
          <BarChartIcon className="w-5 h-5" />
        </button>
      </div>
      {isPrinting ? (
        <div className="flex justify-center">
            {chart}
        </div>
      ) : (
        <div style={{ width: '100%', height: 400 }}>
            <ResponsiveContainer>
                {chart}
            </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

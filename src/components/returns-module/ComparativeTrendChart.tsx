import React, { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Transaction, TransactionType } from '../../types';
import { formatCompactCurrency, formatPercentage, formatPercentagePoints, formatMillionsCurrency } from '../../services/formatters';
import { LineChartIcon } from './icons';

export enum ChartType {
  ReturnRate = 'ReturnRate',
  Sales = 'Sales',
  Returns = 'Returns',
}

interface ComparativeTrendChartProps {
  currentYearData: Transaction[];
  previousYearData: Transaction[];
  currentYear: number;
  type: ChartType;
  isPrinting?: boolean;
}

const processDataForChart = (data: Transaction[], year: number, type: ChartType) => {
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
  
    return monthlyData.map(monthData => {
      if (type === ChartType.ReturnRate) {
        return monthData.sales > 0 ? monthData.returns / monthData.sales : 0;
      }
      return type === ChartType.Sales ? monthData.sales : monthData.returns;
    });
};

export const ComparativeTrendChart: React.FC<ComparativeTrendChartProps> = ({ currentYearData, previousYearData, currentYear, type, isPrinting }) => {
  const chartConfig = useMemo(() => ({
    [ChartType.ReturnRate]: {
      title: 'Tendencia Comparativa de % Devolución (p.p.)',
      formatter: (value: number) => formatPercentage(value),
      diffFormatter: (value: number) => formatPercentagePoints(value),
      line1Color: 'var(--color-returns)',
      line2Color: '#94a3b8',
      legend1: `% Devolución ${currentYear}`,
      legend2: `% Devolución ${currentYear - 1}`,
      labelColor: 'var(--color-returns)',
    },
    [ChartType.Sales]: {
      title: 'Tendencia Comparativa de Ventas ($)',
      formatter: (value: number) => formatCompactCurrency(value),
      tooltipFormatter: (value: number) => formatMillionsCurrency(value),
      diffFormatter: (value: number) => `+${(value * 100).toFixed(1)}%`,
      line1Color: 'var(--color-sales)',
      line2Color: '#94a3b8',
      legend1: `Ventas ${currentYear}`,
      legend2: `Ventas ${currentYear - 1}`,
      labelColor: 'var(--color-sales)',
    },
    [ChartType.Returns]: {
      title: 'Tendencia Comparativa de Devoluciones ($)',
      formatter: (value: number) => formatCompactCurrency(value),
      tooltipFormatter: (value: number) => formatMillionsCurrency(value),
      diffFormatter: (value: number) => `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`,
      line1Color: 'var(--color-returns)',
      line2Color: '#94a3b8',
      legend1: `Devoluciones ${currentYear}`,
      legend2: `Devoluciones ${currentYear - 1}`,
      labelColor: 'var(--color-returns)',
    },
  }[type]), [currentYear, type]);

  const chartData = useMemo(() => {
    const currentData = processDataForChart(currentYearData, currentYear, type);
    const previousData = processDataForChart(previousYearData, currentYear - 1, type);
    
    const currentMonth = new Date().getFullYear() === currentYear ? new Date().getMonth() : 11;

    return Array.from({ length: 12 }, (_, i) => ({
      name: new Date(currentYear, i).toLocaleString('es-CO', { month: 'short' }),
      current: i <= currentMonth ? currentData[i] : null,
      previous: previousData[i],
      diff: type === ChartType.ReturnRate 
            ? currentData[i] - previousData[i] 
            : previousData[i] > 0 ? (currentData[i] - previousData[i]) / previousData[i] : 0,
    }));
  }, [currentYearData, previousYearData, currentYear, type]);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const currentPayload = payload.find((p: any) => p.dataKey === 'current');
      const previousPayload = payload.find((p: any) => p.dataKey === 'previous');
      const tooltipValueFormatter = (chartConfig as any).tooltipFormatter || chartConfig.formatter;


      return (
        <div className="bg-white dark:bg-slate-800 p-2 rounded-md shadow-lg border border-slate-200 dark:border-slate-700 text-sm">
          <p className="label font-bold text-slate-800 dark:text-slate-200">{label}</p>
          {currentPayload && currentPayload.value != null && (
            <p style={{ color: chartConfig.line1Color }}>
              {`${chartConfig.legend1}: ${tooltipValueFormatter(currentPayload.value)}`}
            </p>
          )}
          {previousPayload && previousPayload.value != null && (
            <p style={{ color: chartConfig.line2Color }}>
              {`${chartConfig.legend2}: ${tooltipValueFormatter(previousPayload.value)}`}
            </p>
          )}
        </div>
      );
    }
    return null;
  };

  const CustomizedLabel = (props: any) => {
    const { x, y, value, index } = props;
    const diff = chartData[index].diff;
    if (!value || !diff) return null;
  
    const color = (type === ChartType.Returns && diff < 0) ? 'var(--color-sales)' : chartConfig.labelColor;
    return (
      <text x={x} y={y} dy={-10} fill={color} fontSize={12} textAnchor="middle">
        {chartConfig.diffFormatter(diff)}
      </text>
    );
  };
  
  const chart = (
    <LineChart
        data={chartData}
        margin={{ top: 20, right: 30, left: 20, bottom: 60 }} // Increased bottom margin for legend
        {...(isPrinting && { width: 960, height: 350 })} // Fixed size for printing
    >
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" className="dark:stroke-slate-700" />
        <XAxis dataKey="name" tick={{ fill: '#64748b', className: 'dark:fill-slate-400', fontSize: '12px' }} axisLine={false} tickLine={false}/>
        <YAxis tickFormatter={chartConfig.formatter} tick={{ fill: '#64748b', className: 'dark:fill-slate-400', fontSize: '12px' }} axisLine={false} tickLine={false} />
        <Tooltip content={<CustomTooltip />} />
        <Legend
            verticalAlign="bottom"
            wrapperStyle={{ paddingTop: '20px' }}
            formatter={(value) => <span className="text-slate-700 dark:text-slate-300">{value}</span>}
            iconType="circle"
        />
        <Line type="monotone" dataKey="current" name={chartConfig.legend1} stroke={chartConfig.line1Color} strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} connectNulls>
        </Line>
        <Line type="monotone" dataKey="previous" name={chartConfig.legend2} stroke={chartConfig.line2Color} strokeDasharray="5 5" strokeWidth={2} />
    </LineChart>
  );

  return (
    <div className="bg-white dark:bg-slate-800 p-6 rounded-lg shadow-md print-avoid-break print-no-shadow">
       <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{chartConfig.title}</h3>
        <button className="p-1.5 bg-slate-100 dark:bg-slate-700/50 rounded-md text-slate-500 dark:text-slate-400 no-print">
          <LineChartIcon className="w-5 h-5" />
        </button>
      </div>
      {isPrinting ? (
        <div className="flex justify-center">
            {chart}
        </div>
      ) : (
        <div style={{ width: '100%', height: 300 }}>
            <ResponsiveContainer>
                {chart}
            </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

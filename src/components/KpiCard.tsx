
import React from 'react';
import { formatCurrency, formatNumber, formatPercentage } from '../services/formatters';

interface KpiCardProps {
  title: string;
  value: number;
  year: number;
  type: 'currency' | 'percentage' | 'number';
  Icon: React.ElementType;
  valueClassName?: string;
}

export const KpiCard: React.FC<KpiCardProps> = ({ title, value, year, type, Icon, valueClassName = '' }) => {
  const formattedValue = () => {
    switch (type) {
      case 'currency':
        return formatCurrency(value);
      case 'percentage':
        return formatPercentage(value);
      case 'number':
        return formatNumber(value);
      default:
        return value;
    }
  };

  const finalValueClassName = valueClassName
    ? `kpi-value text-3xl font-bold mt-2 ${valueClassName}`
    : 'kpi-value text-3xl font-bold mt-2 text-slate-800 dark:text-slate-100';

  return (
    <div className="kpi-card-print-wrapper bg-white dark:bg-slate-800 p-5 rounded-lg shadow-md flex flex-col justify-between print-no-shadow">
      <div>
        <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
          <p className="text-sm font-medium">{title}</p>
          <div className="bg-indigo-100 dark:bg-indigo-900/50 text-indigo-500 dark:text-indigo-400 p-1.5 rounded-full">
            <Icon className="w-5 h-5" />
          </div>
        </div>
        <p className="text-xs text-slate-400 dark:text-slate-500">Mostrando datos del año {year}</p>
      </div>
      <p className={finalValueClassName}>
        {formattedValue()}
      </p>
    </div>
  );
};

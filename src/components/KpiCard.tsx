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

function formatKpiValue(type: KpiCardProps['type'], value: number): string {
  switch (type) {
    case 'currency':
      return formatCurrency(value);
    case 'percentage':
      return formatPercentage(value);
    case 'number':
      return formatNumber(value);
    default:
      return String(value);
  }
}

/** Tipografía más chica cuando la cifra es larga (evita que se corte en el borde). */
function valueTextSizeClass(formatted: string): string {
  const len = formatted.length;
  if (len >= 15) return 'text-lg sm:text-xl';
  if (len >= 12) return 'text-xl sm:text-2xl';
  if (len >= 9) return 'text-2xl sm:text-3xl';
  return 'text-3xl';
}

export const KpiCard: React.FC<KpiCardProps> = ({ title, value, year, type, Icon, valueClassName = '' }) => {
  const formatted = formatKpiValue(type, value);
  const sizeClass = valueTextSizeClass(formatted);

  const finalValueClassName = [
    'kpi-value font-bold mt-2 leading-tight tabular-nums tracking-tight break-words min-w-0',
    sizeClass,
    valueClassName || 'text-slate-800 dark:text-slate-100',
  ].join(' ');

  return (
    <div className="kpi-card-print-wrapper bg-white dark:bg-slate-800 p-4 sm:p-5 rounded-lg shadow-md flex flex-col justify-between min-w-0 overflow-hidden print-no-shadow">
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-2 text-slate-500 dark:text-slate-400">
          <p className="text-sm font-medium leading-snug pr-1">{title}</p>
          <div className="bg-indigo-100 dark:bg-indigo-900/50 text-indigo-500 dark:text-indigo-400 p-1.5 rounded-full flex-shrink-0">
            <Icon className="w-5 h-5" />
          </div>
        </div>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Mostrando datos del año {year}</p>
      </div>
      <p className={finalValueClassName} title={formatted}>
        {formatted}
      </p>
    </div>
  );
};

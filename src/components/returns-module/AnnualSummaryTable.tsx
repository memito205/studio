import React, { useMemo } from 'react';
import { Transaction, TransactionType } from '../../types';
import { formatCurrency, formatPercentage, formatPercentagePoints } from '../../services/formatters';
import { BarChartIcon } from './icons';

interface AnnualSummaryTableProps {
  currentYearData: Transaction[];
  previousYearData: Transaction[];
  currentYear: number;
}

const calculateMetrics = (data: Transaction[]) => {
  const sales = data.filter(d => d.type === TransactionType.Sale).reduce((sum, item) => sum + item.value, 0);
  const returns = data.filter(d => d.type === TransactionType.Return).reduce((sum, item) => sum + item.value, 0);
  const participation = sales > 0 ? returns / sales : 0;
  return { sales, returns, participation };
};

export const AnnualSummaryTable: React.FC<AnnualSummaryTableProps> = ({ currentYearData, previousYearData, currentYear }) => {
  const currentMetrics = useMemo(() => calculateMetrics(currentYearData), [currentYearData]);
  const previousMetrics = useMemo(() => calculateMetrics(previousYearData), [previousYearData]);

  const diffs = {
    sales: currentMetrics.sales - previousMetrics.sales,
    returns: currentMetrics.returns - previousMetrics.returns,
    participation: currentMetrics.participation - previousMetrics.participation,
  };

  const variations = {
    sales: previousMetrics.sales > 0 ? diffs.sales / previousMetrics.sales : 0,
    returns: previousMetrics.returns > 0 ? diffs.returns / previousMetrics.returns : 0,
  };

  const renderVariation = (value: number) => {
    const isPositive = value >= 0;
    const colorClass = isPositive ? 'text-green-500' : 'text-red-500';
    return <span className={colorClass}>{isPositive ? '+' : ''}{(value * 100).toFixed(1)}%</span>;
  };
  
  const TableRow: React.FC<{label: string; prevValue: React.ReactNode; currValue: React.ReactNode; diff: React.ReactNode; variation: React.ReactNode}> = ({label, prevValue, currValue, diff, variation}) => (
      <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
          <td className="py-3 px-4 text-left font-semibold text-slate-800 dark:text-slate-200">{label}</td>
          <td className="py-3 px-4 text-right">{prevValue}</td>
          <td className="py-3 px-4 text-right">{currValue}</td>
          <td className="py-3 px-4 text-right">{diff}</td>
          <td className="py-3 px-4 text-right">{variation}</td>
      </tr>
  );

  return (
    <div className="bg-white dark:bg-slate-800 p-6 rounded-lg shadow-md print-avoid-break print-no-shadow">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Resumen Comparativo Anual</h3>
        <button className="p-1.5 bg-slate-100 dark:bg-slate-700/50 rounded-md text-slate-500 dark:text-slate-400 no-print">
          <BarChartIcon className="w-5 h-5" />
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-slate-500 dark:text-slate-400 font-medium">
              <th className="py-2 px-4 text-left">Métrica</th>
              <th className="py-2 px-4 text-right">{currentYear - 1}</th>
              <th className="py-2 px-4 text-right">{currentYear}</th>
              <th className="py-2 px-4 text-right">Diferencia</th>
              <th className="py-2 px-4 text-right">Var. %</th>
            </tr>
          </thead>
          <tbody>
            <TableRow label="Ventas" prevValue={formatCurrency(previousMetrics.sales)} currValue={formatCurrency(currentMetrics.sales)} diff={formatCurrency(diffs.sales)} variation={renderVariation(variations.sales)} />
            <TableRow label="Devoluciones" prevValue={formatCurrency(previousMetrics.returns)} currValue={formatCurrency(currentMetrics.returns)} diff={formatCurrency(diffs.returns)} variation={renderVariation(variations.returns)} />
            <TableRow label="% Participación Dev." prevValue={formatPercentage(previousMetrics.participation)} currValue={formatPercentage(currentMetrics.participation)} diff={formatPercentagePoints(diffs.participation)} variation={<span>-</span>} />
          </tbody>
        </table>
      </div>
    </div>
  );
};

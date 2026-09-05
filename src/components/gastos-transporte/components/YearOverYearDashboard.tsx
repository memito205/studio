
import React, { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LineChart, Line } from 'recharts';
import { CarrierData } from '../types';
import { formatCurrency, formatNumber } from '../utils/formatters';

interface YearOverYearDashboardProps {
  carriers: CarrierData[];
}

const YearOverYearDashboard: React.FC<YearOverYearDashboardProps> = ({ carriers }) => {
  const allYears = useMemo(() => {
    const years = new Set<string>();
    carriers.forEach(c => c.data.forEach(d => {
      if (d.fecha) years.add(d.fecha.substring(0, 4));
    }));
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [carriers]);

  const [currentYear, setCurrentYear] = useState(allYears[0] || new Date().getFullYear().toString());
  const previousYear = (parseInt(currentYear) - 1).toString();

  const monthlyComparison = useMemo(() => {
    const data = Array.from({ length: 12 }, (_, i) => {
      const month = (i + 1).toString().padStart(2, '0');
      return {
        month,
        name: new Date(2000, i, 1).toLocaleString('es-CO', { month: 'short' }),
        current: 0,
        previous: 0
      };
    });

    carriers.forEach(c => {
      c.data.forEach(d => {
        const year = d.fecha.substring(0, 4);
        const month = d.fecha.substring(5, 7);
        const monthIndex = parseInt(month) - 1;
        if (year === currentYear) {
          data[monthIndex].current += d.costo;
        } else if (year === previousYear) {
          data[monthIndex].previous += d.costo;
        }
      });
    });

    return data;
  }, [carriers, currentYear, previousYear]);

  const conceptBreakdown = useMemo(() => {
    const breakdown: { [key: string]: { current: number, previous: number } } = {};
    
    carriers.forEach(c => {
      c.data.forEach(d => {
        const year = d.fecha.substring(0, 4);
        const concept = d.contable || 'SIN CONCEPTO';
        
        if (!breakdown[concept]) {
          breakdown[concept] = { current: 0, previous: 0 };
        }
        
        if (year === currentYear) {
          breakdown[concept].current += d.costo;
        } else if (year === previousYear) {
          breakdown[concept].previous += d.costo;
        }
      });
    });

    return Object.entries(breakdown)
      .map(([name, values]) => ({ name, ...values }))
      .sort((a, b) => b.current - a.current);
  }, [carriers, currentYear, previousYear]);

  const totals = useMemo(() => {
    const currentTotal = monthlyComparison.reduce((acc, m) => acc + m.current, 0);
    const previousTotal = monthlyComparison.reduce((acc, m) => acc + m.previous, 0);
    const diff = currentTotal - previousTotal;
    const percent = previousTotal > 0 ? (diff / previousTotal) * 100 : 0;
    return { currentTotal, previousTotal, diff, percent };
  }, [monthlyComparison]);

  if (allYears.length === 0) {
    return (
      <div className="bg-white p-10 rounded-xl shadow-lg text-center">
        <p className="text-slate-500 italic">No hay datos suficientes para realizar la comparativa anual.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-xl shadow-lg flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Comparativa Año a Año</h2>
          <p className="text-slate-500">Gasto de transporte: {currentYear} vs {previousYear}</p>
        </div>
        <div className="w-48">
          <label className="block text-xs font-medium text-slate-500 uppercase">Año Actual</label>
          <select 
            value={currentYear} 
            onChange={e => setCurrentYear(e.target.value)}
            className="mt-1 block w-full border rounded-md p-2 text-sm"
          >
            {allYears.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-lg border-l-4 border-blue-500">
          <h4 className="text-sm font-medium text-slate-500 uppercase">Total {currentYear}</h4>
          <p className="text-3xl font-bold text-slate-800 mt-1">{formatCurrency(totals.currentTotal)}</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-lg border-l-4 border-slate-400">
          <h4 className="text-sm font-medium text-slate-500 uppercase">Total {previousYear}</h4>
          <p className="text-3xl font-bold text-slate-600 mt-1">{formatCurrency(totals.previousTotal)}</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-lg border-l-4 border-indigo-500">
          <h4 className="text-sm font-medium text-slate-500 uppercase">Variación</h4>
          <div className="flex items-baseline space-x-2">
            <p className={`text-3xl font-bold mt-1 ${totals.diff > 0 ? 'text-red-600' : 'text-green-600'}`}>
              {totals.diff > 0 ? '+' : ''}{formatCurrency(totals.diff)}
            </p>
            <span className={`text-sm font-semibold ${totals.diff > 0 ? 'text-red-500' : 'text-green-500'}`}>
              ({totals.percent > 0 ? '+' : ''}{totals.percent.toFixed(1)}%)
            </span>
          </div>
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-lg h-[450px]">
        <h3 className="text-xl font-bold text-slate-800 mb-6">Tendencia Mensual Comparativa</h3>
        <ResponsiveContainer width="100%" height="90%">
          <BarChart data={monthlyComparison} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" />
            <YAxis tickFormatter={v => formatCurrency(v, true)} />
            <Tooltip 
              formatter={(value: number) => formatCurrency(value)}
              contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
            />
            <Legend verticalAlign="top" align="right" height={36}/>
            <Bar dataKey="previous" name={`Gasto ${previousYear}`} fill="#cbd5e1" radius={[4, 4, 0, 0]} />
            <Bar dataKey="current" name={`Gasto ${currentYear}`} fill="#3b82f6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-lg h-[450px]">
        <h3 className="text-xl font-bold text-slate-800 mb-6">Gasto por Concepto (Top 10)</h3>
        <ResponsiveContainer width="100%" height="90%">
          <BarChart 
            data={conceptBreakdown.slice(0, 10)} 
            layout="vertical"
            margin={{ top: 5, right: 30, left: 40, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
            <XAxis type="number" tickFormatter={v => formatCurrency(v, true)} />
            <YAxis dataKey="name" type="category" width={150} tick={{ fontSize: 10 }} />
            <Tooltip formatter={(v: number) => formatCurrency(v)} />
            <Legend />
            <Bar dataKey="previous" name={previousYear} fill="#cbd5e1" radius={[0, 4, 4, 0]} />
            <Bar dataKey="current" name={currentYear} fill="#6366f1" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-lg">
          <h3 className="text-xl font-bold text-slate-800 mb-4">Análisis por Mes</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Mes</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">{previousYear}</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">{currentYear}</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Diferencia</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-200">
                {monthlyComparison.map((m) => {
                  const diff = m.current - m.previous;
                  const pct = m.previous > 0 ? (diff / m.previous) * 100 : 0;
                  return (
                    <tr key={m.month} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-slate-900">{m.name}</td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-right text-slate-600">{formatCurrency(m.previous)}</td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-right font-semibold text-slate-900">{formatCurrency(m.current)}</td>
                      <td className={`px-4 py-4 whitespace-nowrap text-sm text-right font-medium ${diff > 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {pct > 0 ? '+' : ''}{pct.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-lg">
          <h3 className="text-xl font-bold text-slate-800 mb-4">Detalle por Concepto (Contable)</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Concepto</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">{previousYear}</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">{currentYear}</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Dif ($)</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Var %</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-200">
                {conceptBreakdown.map((c, i) => {
                  const diff = c.current - c.previous;
                  const pct = c.previous > 0 ? (diff / c.previous) * 100 : 0;
                  return (
                    <tr key={i} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-slate-900 truncate max-w-[150px]" title={c.name}>{c.name}</td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-right text-slate-600">{formatCurrency(c.previous)}</td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-right font-semibold text-slate-900">{formatCurrency(c.current)}</td>
                      <td className={`px-4 py-4 whitespace-nowrap text-sm text-right font-medium ${diff > 0 ? 'text-red-500' : 'text-green-500'}`}>
                        {formatCurrency(diff)}
                      </td>
                      <td className={`px-4 py-4 whitespace-nowrap text-sm text-right font-bold ${diff > 0 ? 'text-red-500' : 'text-green-500'}`}>
                        {pct > 0 ? '+' : ''}{pct.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default YearOverYearDashboard;

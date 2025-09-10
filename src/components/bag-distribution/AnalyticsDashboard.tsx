
import React, { useMemo, useState } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { ProcessedRow, MonthlyTotalConsumption, ConsumptionByItem, ConsumptionByBodega, BodegaAdjustmentStats } from '@/types';
import { MONTH_NAMES_ES, MAIN_CONSUMPTION_DOC_TYPES, ADJUSTMENT_DOC_TYPES } from './constants';

interface AnalyticsDashboardProps {
  processedRows: ProcessedRow[];
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-slate-700 p-2 border border-slate-600 rounded shadow-lg text-sm">
        <p className="label text-sky-300">{`${label}`}</p>
        {payload.map((entry: any, index: number) => (
          <p key={`item-${index}`} style={{ color: entry.color }}>
            {`${entry.name}: ${entry.value !== undefined && entry.value !== null ? Number(entry.value).toLocaleString() : 'N/D'}`}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({ processedRows }) => {
  const [selectedYears, setSelectedYears] = useState<string[]>([]);
  const [selectedMonths, setSelectedMonths] = useState<string[]>([]); // Storing month numbers as strings "1", "2", ... "12"
  const [selectedBodegas, setSelectedBodegas] = useState<string[]>([]);

  const uniqueYears = useMemo(() => {
    const years = new Set(processedRows.map(row => row.date.getFullYear().toString()));
    return Array.from(years).sort((a, b) => parseInt(b) - parseInt(a));
  }, [processedRows]);

  const uniqueMonths = useMemo(() => {
    return MONTH_NAMES_ES.map((name, index) => ({ value: (index + 1).toString(), label: name }));
  }, []);

  const uniqueBodegas = useMemo(() => {
    const bodegas = new Set(processedRows.map(row => row.bodega).filter(Boolean) as string[]);
    return Array.from(bodegas).sort();
  }, [processedRows]);

  const filteredRows = useMemo(() => {
    return processedRows.filter(row => {
      const yearMatch = selectedYears.length === 0 || selectedYears.includes(row.date.getFullYear().toString());
      const monthMatch = selectedMonths.length === 0 || selectedMonths.includes((row.date.getMonth() + 1).toString());
      const bodegaMatch = selectedBodegas.length === 0 || (row.bodega && selectedBodegas.includes(row.bodega));
      return yearMatch && monthMatch && bodegaMatch;
    });
  }, [processedRows, selectedYears, selectedMonths, selectedBodegas]);
  
  const monthlyConsumptionData = useMemo((): MonthlyTotalConsumption[] => {
    const monthlyMap = new Map<string, { totalConsumption: number; date: Date }>();
    filteredRows.forEach(row => {
      const year = row.date.getFullYear();
      const month = row.date.getMonth(); // 0-indexed for Date
      const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
      
      const current = monthlyMap.get(monthKey) || { totalConsumption: 0, date: new Date(year, month, 1) };
      current.totalConsumption += row.quantity;
      monthlyMap.set(monthKey, current);
    });
    
    return Array.from(monthlyMap.entries())
      .map(([key, value]) => ({
        name: `${MONTH_NAMES_ES[value.date.getMonth()]} ${value.date.getFullYear()}`,
        totalConsumption: value.totalConsumption,
        date: value.date,
      }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [filteredRows]);

  const itemConsumptionData = useMemo((): ConsumptionByItem[] => {
    const itemMap = new Map<string, number>();
    filteredRows.forEach(row => {
      itemMap.set(row.itemCode, (itemMap.get(row.itemCode) || 0) + row.quantity);
    });
    return Array.from(itemMap.entries())
      .map(([itemCode, totalConsumption]) => ({ itemCode, totalConsumption }))
      .sort((a, b) => b.totalConsumption - a.totalConsumption);
  }, [filteredRows]);

  const bodegaConsumptionData = useMemo((): ConsumptionByBodega[] => {
    const bodegaMap = new Map<string, number>();
    filteredRows.forEach(row => {
      if (row.bodega) {
        bodegaMap.set(row.bodega, (bodegaMap.get(row.bodega) || 0) + row.quantity);
      }
    });
    if (bodegaMap.size === 0) return [];
    return Array.from(bodegaMap.entries())
      .map(([bodega, totalConsumption]) => ({ bodega, totalConsumption }))
      .sort((a, b) => b.totalConsumption - a.totalConsumption);
  }, [filteredRows]);

  const bodegaAdjustmentAnalysis = useMemo((): BodegaAdjustmentStats[] => {
    const analysisMap = new Map<string, Omit<BodegaAdjustmentStats, 'bodega' | 'ajsPercentage'>>();
    filteredRows.forEach(row => {
      if (!row.bodega) return;
      
      const current = analysisMap.get(row.bodega) || { mainConsumption: 0, ajsConsumption: 0, totalConsumption: 0 };
      
      if (MAIN_CONSUMPTION_DOC_TYPES.includes(row.docType)) {
        current.mainConsumption += row.quantity;
      } else if (ADJUSTMENT_DOC_TYPES.includes(row.docType)) {
        current.ajsConsumption += row.quantity;
      }
      current.totalConsumption += row.quantity;
      analysisMap.set(row.bodega, current);
    });

    return Array.from(analysisMap.entries())
      .map(([bodega, stats]) => ({
        bodega,
        ...stats,
        ajsPercentage: stats.totalConsumption > 0 ? (stats.ajsConsumption / stats.totalConsumption) * 100 : 0,
      }))
      .sort((a, b) => b.totalConsumption - a.totalConsumption);
  }, [filteredRows]);

  const handleMultiSelectChange = (setter: React.Dispatch<React.SetStateAction<string[]>>) => (event: React.ChangeEvent<HTMLSelectElement>) => {
    const options = event.target.options;
    const value: string[] = [];
    for (let i = 0, l = options.length; i < l; i++) {
      if (options[i].selected) {
        value.push(options[i].value);
      }
    }
    setter(value);
  };

  if (processedRows.length === 0) {
    return <p className="text-center text-slate-400 py-8">No hay datos procesados para el análisis.</p>;
  }

  return (
    <div className="space-y-8">
      {/* Filtros */}
      <div className="bg-slate-800 shadow-xl rounded-xl p-6">
        <h3 className="text-xl font-semibold mb-4 text-sky-400 border-b border-sky-600 pb-2">Filtros del Dashboard</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label htmlFor="year-filter" className="block text-sm font-medium text-slate-300 mb-1">Año(s):</label>
            <select
              id="year-filter"
              multiple
              value={selectedYears}
              onChange={handleMultiSelectChange(setSelectedYears)}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 focus:ring-1 focus:ring-sky-500 focus:border-sky-500 outline-none h-32"
            >
              {uniqueYears.map(year => <option key={year} value={year}>{year}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="month-filter" className="block text-sm font-medium text-slate-300 mb-1">Mes(es):</label>
            <select
              id="month-filter"
              multiple
              value={selectedMonths}
              onChange={handleMultiSelectChange(setSelectedMonths)}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 focus:ring-1 focus:ring-sky-500 focus:border-sky-500 outline-none h-32"
            >
              {uniqueMonths.map(month => <option key={month.value} value={month.value}>{month.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="bodega-filter" className="block text-sm font-medium text-slate-300 mb-1">Bodega(s):</label>
            <select
              id="bodega-filter"
              multiple
              value={selectedBodegas}
              onChange={handleMultiSelectChange(setSelectedBodegas)}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 focus:ring-1 focus:ring-sky-500 focus:border-sky-500 outline-none h-32"
            >
              {uniqueBodegas.map(bodega => <option key={bodega} value={bodega}>{bodega}</option>)}
            </select>
          </div>
        </div>
        <button 
            onClick={() => { setSelectedYears([]); setSelectedMonths([]); setSelectedBodegas([]); }}
            className="mt-4 bg-sky-600 hover:bg-sky-700 text-white font-semibold py-2 px-4 rounded-md text-sm transition-colors"
        >
            Limpiar Filtros
        </button>
      </div>

      <div className="bg-slate-800 shadow-xl rounded-xl p-6">
        <h3 className="text-2xl font-semibold mb-6 text-sky-400 border-b border-sky-600 pb-2">Consumo Total Mensual</h3>
        {monthlyConsumptionData.length > 0 ? (
          <div className="h-96 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyConsumptionData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#4A5568" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#A0AEC0' }} />
                <YAxis tick={{ fontSize: 11, fill: '#A0AEC0' }} tickFormatter={(value) => Number(value).toLocaleString()} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ color: '#E2E8F0', fontSize: '12px' }} />
                <Line type="monotone" dataKey="totalConsumption" name="Consumo Total" stroke="#38BDF8" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-slate-400 text-center py-4">No hay datos para los filtros seleccionados.</p>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        <div className="bg-slate-800 shadow-xl rounded-xl p-6">
          <h3 className="text-2xl font-semibold mb-6 text-sky-400 border-b border-sky-600 pb-2">Consumo por Ítem</h3>
           {itemConsumptionData.length > 0 ? (
            <div className="h-96 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={itemConsumptionData.slice(0, 15)} layout="vertical" margin={{ top: 5, right: 30, left: 30, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#4A5568" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#A0AEC0' }} tickFormatter={(value) => Number(value).toLocaleString()} />
                  <YAxis dataKey="itemCode" type="category" tick={{ fontSize: 10, fill: '#A0AEC0' }} width={80} interval={0} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ color: '#E2E8F0', fontSize: '12px' }} />
                  <Bar dataKey="totalConsumption" name="Consumo Total" fill="#34D399" barSize={20} />
                </BarChart>
              </ResponsiveContainer>
              {itemConsumptionData.length > 15 && <p className="text-xs text-slate-500 mt-2 text-center">Mostrando los 15 ítems con mayor consumo.</p>}
            </div>
          ) : (
            <p className="text-slate-400 text-center py-4">No hay datos para los filtros seleccionados.</p>
          )}
        </div>

        <div className="bg-slate-800 shadow-xl rounded-xl p-6">
          <h3 className="text-2xl font-semibold mb-6 text-sky-400 border-b border-sky-600 pb-2">Consumo por Bodega</h3>
          {bodegaConsumptionData.length > 0 ? (
            <div className="h-96 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={bodegaConsumptionData.slice(0, 15)} layout="vertical" margin={{ top: 5, right: 30, left: 30, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#4A5568" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#A0AEC0' }} tickFormatter={(value) => Number(value).toLocaleString()} />
                  <YAxis dataKey="bodega" type="category" tick={{ fontSize: 10, fill: '#A0AEC0' }} width={80} interval={0} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ color: '#E2E8F0', fontSize: '12px' }} />
                  <Bar dataKey="totalConsumption" name="Consumo Total" fill="#FBBF24" barSize={20} />
                </BarChart>
              </ResponsiveContainer>
               {bodegaConsumptionData.length > 15 && <p className="text-xs text-slate-500 mt-2 text-center">Mostrando las 15 bodegas con mayor consumo.</p>}
            </div>
          ) : (
            <p className="text-slate-400 text-center py-4">No se encontró información de bodegas o no hay datos para los filtros seleccionados.</p>
          )}
        </div>
      </div>

      <div className="bg-slate-800 shadow-xl rounded-xl p-6">
        <h3 className="text-2xl font-semibold mb-6 text-sky-400 border-b border-sky-600 pb-2">Análisis de Ajustes por Bodega</h3>
        {bodegaAdjustmentAnalysis.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-left text-sm">
              <thead className="bg-slate-700 text-slate-300">
                <tr>
                  <th className="p-3">Bodega</th>
                  <th className="p-3 text-right">Cons. Principal (RMV/RMP)</th>
                  <th className="p-3 text-right">Cons. Ajustes (AJS)</th>
                  <th className="p-3 text-right">Cons. Total</th>
                  <th className="p-3 text-right">Ajustes (% del Total)</th>
                </tr>
              </thead>
              <tbody>
                {bodegaAdjustmentAnalysis.map(stats => (
                  <tr key={stats.bodega} className="border-b border-slate-700 hover:bg-slate-750">
                    <td className="p-3 font-medium">{stats.bodega}</td>
                    <td className="p-3 text-right">{stats.mainConsumption.toLocaleString()}</td>
                    <td className="p-3 text-right">{stats.ajsConsumption.toLocaleString()}</td>
                    <td className="p-3 text-right font-semibold">{stats.totalConsumption.toLocaleString()}</td>
                    <td className={`p-3 text-right font-semibold ${stats.ajsPercentage !== null && stats.ajsPercentage > 0 ? 'text-amber-400' : ''}`}>
                      {stats.ajsPercentage !== null ? `${stats.ajsPercentage.toFixed(1)}%` : 'N/A'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-slate-400 text-center py-4">No hay datos de bodegas con ajustes para los filtros seleccionados.</p>
        )}
      </div>

    </div>
  );
};

export default AnalyticsDashboard;

import React, { useMemo, useState, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell, LabelList } from 'recharts';
import { CarrierData, ExpenseRecord, ActiveFilters, FilterCategory } from '../types';
import { getAIInsights } from '../services/geminiService';
import MetricTable from './MetricTable';
import DashboardFilters from './DashboardFilters';
import FilterSummary from './FilterSummary';
import DetailsTable from './DetailsTable';
import { formatCurrency, formatNumber } from '../utils/formatters';

const WelcomeScreen: React.FC = () => (
  <div className="text-center p-10 bg-white rounded-xl shadow-lg animate-fade-in">
    <h2 className="text-3xl font-bold text-slate-800 mb-4">Bienvenido al Dashboard de Transporte</h2>
    <p className="text-slate-600 max-w-2xl mx-auto">
      Para comenzar, por favor agregue los datos de una transportadora usando el botón "Añadir Datos" en el menú lateral. Podrá visualizar y analizar sus gastos de envío de manera eficiente.
    </p>
  </div>
);

const AIInsights: React.FC<{ carriers: CarrierData[] }> = ({ carriers }) => {
  const [insights, setInsights] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  const handleGetInsights = useCallback(async () => {
    setIsLoading(true);
    try {
        const result = await getAIInsights(carriers);
        setInsights(result);
    } catch (e) {
        setInsights("Ocurrió un error al contactar el servicio de IA.");
    } finally {
        setIsLoading(false);
    }
  }, [carriers]);

  const formatInsights = (text: string) => {
    return text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line)
      .map((line, index) => {
        if (line.startsWith('**') && line.endsWith('**')) {
          return <h4 key={index} className="font-bold text-lg mt-4 mb-2 text-slate-700">{line.replace(/\*\*/g, '')}</h4>;
        }
        if (line.startsWith('* ')) {
          return <li key={index} className="ml-5 list-disc">{line.substring(2)}</li>;
        }
        if (/^\d+\./.test(line)) {
            const headingText = line.substring(line.indexOf(' ')+1);
            return <h4 key={index} className="font-bold text-lg mt-4 mb-2 text-slate-700">{headingText}</h4>
        }
        return <p key={index} className="mb-2">{line}</p>;
      });
  };

  return (
    <div className="bg-white p-6 rounded-xl shadow-lg mt-8">
      <h3 className="text-xl font-bold text-slate-800 mb-4">Análisis con IA</h3>
      {insights ? (
        <div className="prose prose-slate max-w-none text-slate-600">{formatInsights(insights)}</div>
      ) : (
        <>
          <p className="text-slate-600 mb-4">
            Obtenga observaciones clave, oportunidades de ahorro y posibles anomalías en sus datos de gastos de transporte.
          </p>
          <button
            onClick={handleGetInsights}
            disabled={isLoading}
            className="px-5 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:bg-slate-400 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Analizando...' : 'Generar Análisis'}
          </button>
        </>
      )}
    </div>
  );
};

interface DashboardProps {
  carriers: CarrierData[];
}

const Dashboard: React.FC<DashboardProps> = ({ carriers }) => {
  const [selectedYear, setSelectedYear] = useState('all');
  const [selectedMonth, setSelectedMonth] = useState('all');
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>({
    carriers: [], concepts: [], destinations: [], months: []
  });

  const allYears = useMemo(() => {
    const years = new Set<string>();
    carriers.forEach(c => c.data.forEach(d => {
      if (d.fecha && d.fecha.length >= 4) {
        years.add(d.fecha.substring(0, 4));
      }
    }));
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [carriers]);

  const handleFilterChange = useCallback((category: FilterCategory, value: string) => {
    setActiveFilters(prev => {
        const currentValues = prev[category];
        const newValues = currentValues.includes(value)
            ? currentValues.filter(v => v !== value)
            : [...currentValues, value];
        return { ...prev, [category]: newValues };
    });
  }, []);

  const clearAllFilters = useCallback(() => {
    setActiveFilters({ carriers: [], concepts: [], destinations: [], months: [] });
  }, []);

  // 1. Base data filtered by dropdowns
  const baseFilteredRecords = useMemo(() => {
    return carriers.flatMap(carrier =>
      carrier.data
        .map(record => ({ ...record, carrierName: carrier.name, carrierColor: carrier.color }))
        .filter(record => {
          if (!record.fecha || record.fecha.length < 7) return false;
          const year = record.fecha.substring(0, 4);
          const month = record.fecha.substring(5, 7);
          const yearMatch = selectedYear === 'all' || year === selectedYear;
          const monthMatch = selectedMonth === 'all' || month === selectedMonth;
          return yearMatch && monthMatch;
        })
    );
  }, [carriers, selectedYear, selectedMonth]);

  // 2. Interactively filtered data for KPIs
  const kpiFilteredRecords = useMemo(() => {
    return baseFilteredRecords.filter(record => {
        const carrierMatch = activeFilters.carriers.length === 0 || activeFilters.carriers.includes(record.carrierName);
        const conceptMatch = activeFilters.concepts.length === 0 || activeFilters.concepts.includes(record.concepto || 'Sin Concepto');
        const destinationMatch = activeFilters.destinations.length === 0 || activeFilters.destinations.includes(record.destino || 'Sin Destino');
        const monthMatch = activeFilters.months.length === 0 || activeFilters.months.includes(record.fecha.substring(0, 7));
        return carrierMatch && conceptMatch && destinationMatch && monthMatch;
    });
  }, [baseFilteredRecords, activeFilters]);

  // KPI calculations
  const totalCost = useMemo(() => kpiFilteredRecords.reduce((acc, r) => acc + r.costo, 0), [kpiFilteredRecords]);
  const totalShipments = useMemo(() => kpiFilteredRecords.length, [kpiFilteredRecords]);
  const avgCost = useMemo(() => totalShipments > 0 ? totalCost / totalShipments : 0, [totalCost, totalShipments]);
  const carrierCount = useMemo(() => new Set(kpiFilteredRecords.map(r => r.carrierName)).size, [kpiFilteredRecords]);
  
  // 3. Logic for each chart/table to be filtered by everything EXCEPT its own category
  const createFilteredDataFor = (excludeCategory: FilterCategory | null) => {
      if (!excludeCategory) return kpiFilteredRecords;
      return baseFilteredRecords.filter(record => {
          const carrierMatch = excludeCategory === 'carriers' || activeFilters.carriers.length === 0 || activeFilters.carriers.includes(record.carrierName);
          const conceptMatch = excludeCategory === 'concepts' || activeFilters.concepts.length === 0 || activeFilters.concepts.includes(record.concepto || 'Sin Concepto');
          const destinationMatch = excludeCategory === 'destinations' || activeFilters.destinations.length === 0 || activeFilters.destinations.includes(record.destino || 'Sin Destino');
          const monthMatch = excludeCategory === 'months' || activeFilters.months.length === 0 || activeFilters.months.includes(record.fecha.substring(0, 7));
          return carrierMatch && conceptMatch && destinationMatch && monthMatch;
      });
  };

  const dataByCarrier = useMemo(() => {
    const data = createFilteredDataFor('carriers');
    const carrierMap = new Map<string, { total: number, color: string }>();
    data.forEach(record => {
      const current = carrierMap.get(record.carrierName) || { total: 0, color: record.carrierColor };
      current.total += record.costo;
      carrierMap.set(record.carrierName, current);
    });
    return Array.from(carrierMap.entries())
      .map(([name, { total, color }]) => ({ name, total, color }))
      .sort((a, b) => b.total - a.total);
  }, [baseFilteredRecords, activeFilters]);
  
  const dataByConcept = useMemo(() => {
    const data = createFilteredDataFor('concepts');
    const conceptMap = new Map<string, number>();
    data.forEach(record => {
        const concept = record.concepto || 'Sin Concepto';
        conceptMap.set(concept, (conceptMap.get(concept) || 0) + record.costo);
    });
    const total = Array.from(conceptMap.values()).reduce((sum, val) => sum + val, 0);
    return Array.from(conceptMap.entries())
      .map(([name, totalValue]) => ({ name, total: totalValue, percentage: total > 0 ? totalValue / total : 0 }))
      .sort((a, b) => b.total - a.total);
  }, [baseFilteredRecords, activeFilters]);

  const dataByDestination = useMemo(() => {
    const data = createFilteredDataFor('destinations');
    const destMap = new Map<string, number>();
    data.forEach(record => {
        const dest = record.destino || 'Sin Destino';
        destMap.set(dest, (destMap.get(dest) || 0) + record.costo);
    });
    const total = Array.from(destMap.values()).reduce((sum, val) => sum + val, 0);
    return Array.from(destMap.entries())
      .map(([name, totalValue]) => ({ name, total: totalValue, percentage: total > 0 ? totalValue / total : 0 }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 100);
  }, [baseFilteredRecords, activeFilters]);

  const monthlyData = useMemo(() => {
    const data = createFilteredDataFor('months');
    const monthMap = new Map<string, number>();
    data.forEach(record => {
      if (record.fecha && record.fecha.length >= 7) {
        const monthKey = record.fecha.substring(0, 7);
        monthMap.set(monthKey, (monthMap.get(monthKey) || 0) + record.costo);
      }
    });
    
    const sortedEntries = Array.from(monthMap.entries()).sort(([a], [b]) => a.localeCompare(b));
    const totalSpend = sortedEntries.reduce((sum, [, total]) => sum + total, 0);

    return sortedEntries.map(([monthKey, total]) => {
      const [year, month] = monthKey.split('-');
      const date = new Date(parseInt(year), parseInt(month) - 1);
      const monthName = date.toLocaleString('es-CO', { month: 'short' });
      const yearShort = year.substring(2);
      const uniqueName = `${monthName.charAt(0).toUpperCase() + monthName.slice(1)} '${yearShort}`;
      
      return {
        name: uniqueName,
        total,
        monthKey,
        percentage: totalSpend > 0 ? total / totalSpend : 0,
      };
    });
  }, [baseFilteredRecords, activeFilters]);

  // FIX: Cast result of Object.values to help TypeScript infer the correct type.
  const isFiltered = (Object.values(activeFilters) as string[][]).some(arr => arr.length > 0);

  if (carriers.length === 0) {
    return <WelcomeScreen />;
  }

  return (
    <div className="space-y-6">
      <DashboardFilters
        years={allYears}
        selectedYear={selectedYear}
        onYearChange={(year) => { setSelectedYear(year); clearAllFilters(); }}
        selectedMonth={selectedMonth}
        onMonthChange={(month) => { setSelectedMonth(month); clearAllFilters(); }}
      />

      {isFiltered && <FilterSummary activeFilters={activeFilters} onClear={handleFilterChange} onClearAll={clearAllFilters} />}
      
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="bg-white p-6 rounded-xl shadow-lg">
              <h4 className="text-sm font-medium text-slate-500">Gasto Total</h4>
              <p className="text-3xl font-bold text-slate-800 mt-1">{formatCurrency(totalCost)}</p>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-lg">
              <h4 className="text-sm font-medium text-slate-500">Envíos Totales</h4>
              <p className="text-3xl font-bold text-slate-800 mt-1">{formatNumber(totalShipments)}</p>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-lg">
              <h4 className="text-sm font-medium text-slate-500">Costo Promedio</h4>
              <p className="text-3xl font-bold text-slate-800 mt-1">{formatCurrency(avgCost)}</p>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-lg">
              <h4 className="text-sm font-medium text-slate-500">Transportadoras</h4>
              <p className="text-3xl font-bold text-slate-800 mt-1">{formatNumber(carrierCount)}</p>
          </div>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-lg h-[400px]">
        <h3 className="text-xl font-bold text-slate-800 mb-4">Gasto Mensual</h3>
        <ResponsiveContainer width="100%" height="90%">
            <AreaChart data={monthlyData} margin={{ top: 20, right: 20, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{fontSize: 12}} />
                <YAxis tickFormatter={(val) => formatCurrency(val, true)} />
                <Tooltip formatter={(value: number) => formatCurrency(value)} />
                <Area type="monotone" dataKey="total" stroke="#3b82f6" fill="#bfdbfe">
                  <LabelList dataKey="total" position="top" formatter={(value: number) => formatCurrency(value, true)} style={{fontSize: '11px', fill: '#475569'}}/>
                </Area>
            </AreaChart>
        </ResponsiveContainer>
      </div>
      <MetricTable 
        title="Gasto por Mes" 
        data={monthlyData} 
        headers={['Mes', 'Total', '% del Total']} 
        onRowClick={(name) => {
          const month = monthlyData.find(d => d.name === name);
          if (month) {
            handleFilterChange('months', month.monthKey);
          }
        }} 
        selectedItems={activeFilters.months.map(key => {
          const month = monthlyData.find(d => d.monthKey === key);
          return month ? month.name : '';
        }).filter(Boolean)} 
      />
      
      <div className="bg-white p-6 rounded-xl shadow-lg h-[400px]">
        <h3 className="text-xl font-bold text-slate-800 mb-4">Gasto por Transportadora</h3>
        <ResponsiveContainer width="100%" height="90%">
          <BarChart data={dataByCarrier} layout="vertical" barSize={20} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" tickFormatter={(val) => formatCurrency(val, true)} />
            <YAxis type="category" dataKey="name" width={120} tick={{fontSize: 12}} />
            <Tooltip formatter={(value: number) => formatCurrency(value)} />
            <Bar dataKey="total" fill="#8884d8" onClick={(data) => handleFilterChange('carriers', data.name)}>
               {dataByCarrier.map((entry, index) => (
                  <Cell 
                    cursor="pointer" 
                    fill={activeFilters.carriers.length === 0 || activeFilters.carriers.includes(entry.name) ? entry.color : '#e2e8f0'} 
                    key={`cell-${index}`} 
                  />
               ))}
                <LabelList dataKey="total" position="right" formatter={(val: number) => formatCurrency(val, true)} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <MetricTable 
          title="Costo por Concepto" 
          data={dataByConcept} 
          headers={['Concepto', 'Total', '% del Total']} 
          onRowClick={(name) => handleFilterChange('concepts', name)} 
          selectedItems={activeFilters.concepts} 
        />
        <MetricTable 
          title="Top 100 Destinos por Costo" 
          data={dataByDestination} 
          headers={['Destino', 'Total', '% del Total']}
          onRowClick={(name) => handleFilterChange('destinations', name)} 
          selectedItems={activeFilters.destinations} 
        />
      </div>

      <DetailsTable records={kpiFilteredRecords} />

      {carriers.length > 0 && <AIInsights carriers={carriers} />}

    </div>
  );
};

export default Dashboard;


import React, { useMemo, useState, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend, Cell } from 'recharts';
import { CarrierData, ActiveFilters, FilterCategory } from '../types';
import { getAIComparativeInsights } from '../services/geminiService';
import FilterSummary from './FilterSummary';
import DetailsTable from './DetailsTable';
import ComparativeMetricCard from './ComparativeMetricCard';
import ComparativeBreakdown from './ComparativeBreakdown';
import { formatCurrency, formatNumber } from '../utils/formatters';

const WelcomeScreen: React.FC = () => (
  <div className="text-center p-10 bg-white rounded-xl shadow-lg animate-fade-in">
    <h2 className="text-3xl font-bold text-slate-800 mb-4">Análisis Comparativo Anual</h2>
    <p className="text-slate-600 max-w-2xl mx-auto">
      Para comenzar, cargue los datos de al menos dos años consecutivos usando el botón "Añadir Datos". Este dashboard le permitirá comparar métricas clave año contra año para identificar tendencias.
    </p>
  </div>
);

const AIComparativeInsights: React.FC<{ 
    carriers: CarrierData[], 
    currentRecords: any[], 
    previousRecords: any[], 
    year: string 
}> = ({ carriers, currentRecords, previousRecords, year }) => {
  const [insights, setInsights] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  const handleGetInsights = useCallback(async () => {
    setIsLoading(true);
    try {
        const result = await getAIComparativeInsights(carriers, currentRecords, previousRecords, year);
        setInsights(result);
    } catch (e) {
        setInsights("Ocurrió un error al contactar el servicio de IA.");
    } finally {
        setIsLoading(false);
    }
  }, [carriers, currentRecords, previousRecords, year]);

  const formatInsights = (text: string) => {
    return text.split('\n').map((line, index) => {
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
      <h3 className="text-xl font-bold text-slate-800 mb-4">Análisis Comparativo con IA</h3>
      {insights ? (
        <div className="prose prose-slate max-w-none text-slate-600">{formatInsights(insights)}</div>
      ) : (
        <>
          <p className="text-slate-600 mb-4">
            Compare los dos períodos para obtener observaciones sobre cambios en gastos, riesgos y oportunidades de ahorro.
          </p>
          <button
            onClick={handleGetInsights}
            disabled={isLoading}
            className="px-5 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:bg-slate-400 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Analizando...' : 'Generar Comparativa'}
          </button>
        </>
      )}
    </div>
  );
};


const ComparativeDashboard: React.FC<{ carriers: CarrierData[] }> = ({ carriers }) => {
  const allYears = useMemo(() => {
    const years = new Set<string>();
    carriers.forEach(c => c.data.forEach(d => years.add(d.fecha.substring(0, 4))));
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [carriers]);

  const [selectedYear, setSelectedYear] = useState(allYears[0] || new Date().getFullYear().toString());
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>({ carriers: [], concepts: [], destinations: [], months: [] });

  const previousYear = (parseInt(selectedYear, 10) - 1).toString();

  const handleFilterChange = useCallback((category: FilterCategory, value: string) => {
    setActiveFilters(prev => ({
        ...prev,
        [category]: prev[category].includes(value) ? prev[category].filter(v => v !== value) : [...prev[category], value]
    }));
  }, []);

  const clearAllFilters = useCallback(() => setActiveFilters({ carriers: [], concepts: [], destinations: [], months: [] }), []);

  const baseRecords = useMemo(() => carriers.flatMap(c => c.data.map(r => ({ ...r, carrierName: c.name, carrierColor: c.color }))), [carriers]);

  const latestMonthInCurrentYear = useMemo(() => {
    const currentYearRecords = baseRecords.filter(r => r.fecha.startsWith(selectedYear));
    if (currentYearRecords.length === 0) {
      return 0; // No data for the current year
    }
    // Find the maximum month number in the current year's data
    return currentYearRecords.reduce((maxMonth, record) => {
        const month = parseInt(record.fecha.substring(5, 7), 10);
        return month > maxMonth ? month : maxMonth;
    }, 0);
  }, [baseRecords, selectedYear]);


  const [baseFilteredCurrent, baseFilteredPrevious] = useMemo(() => {
      if (latestMonthInCurrentYear === 0) {
          return [[], []]; // Return empty arrays if no data in current year
      }
      
      const current = baseRecords.filter(r => 
        r.fecha.startsWith(selectedYear) && 
        parseInt(r.fecha.substring(5, 7), 10) <= latestMonthInCurrentYear
      );
      const previous = baseRecords.filter(r => 
        r.fecha.startsWith(previousYear) &&
        parseInt(r.fecha.substring(5, 7), 10) <= latestMonthInCurrentYear
      );
      return [current, previous];
  }, [baseRecords, selectedYear, previousYear, latestMonthInCurrentYear]);

  const createFilteredDataFor = (excludeCategory: FilterCategory | null, dataSet: 'current' | 'previous') => {
      const baseData = dataSet === 'current' ? baseFilteredCurrent : baseFilteredPrevious;
      return baseData.filter(record => {
          const carrierMatch = excludeCategory === 'carriers' || activeFilters.carriers.length === 0 || activeFilters.carriers.includes(record.carrierName);
          const conceptMatch = excludeCategory === 'concepts' || activeFilters.concepts.length === 0 || activeFilters.concepts.includes(record.concepto || 'Sin Concepto');
          const destinationMatch = excludeCategory === 'destinations' || activeFilters.destinations.length === 0 || activeFilters.destinations.includes(record.destino || 'Sin Destino');
          const monthMatch = excludeCategory === 'months' || activeFilters.months.length === 0 || activeFilters.months.includes(record.fecha.substring(0, 7));
          return carrierMatch && conceptMatch && destinationMatch && monthMatch;
      });
  };
  
  const kpiFilteredCurrent = useMemo(() => createFilteredDataFor(null, 'current'), [baseFilteredCurrent, activeFilters]);
  const kpiFilteredPrevious = useMemo(() => createFilteredDataFor(null, 'previous'), [baseFilteredPrevious, activeFilters]);

  const { totalCostCurrent, totalCostPrevious } = useMemo(() => ({
    totalCostCurrent: kpiFilteredCurrent.reduce((acc, r) => acc + r.costo, 0),
    totalCostPrevious: kpiFilteredPrevious.reduce((acc, r) => acc + r.costo, 0),
  }), [kpiFilteredCurrent, kpiFilteredPrevious]);

  const { totalShipmentsCurrent, totalShipmentsPrevious } = useMemo(() => ({
    totalShipmentsCurrent: kpiFilteredCurrent.length,
    totalShipmentsPrevious: kpiFilteredPrevious.length,
  }), [kpiFilteredCurrent, kpiFilteredPrevious]);
  
  const avgCostCurrent = totalShipmentsCurrent > 0 ? totalCostCurrent / totalShipmentsCurrent : 0;
  const avgCostPrevious = totalShipmentsPrevious > 0 ? totalCostPrevious / totalShipmentsPrevious : 0;
  const carrierCountCurrent = new Set(kpiFilteredCurrent.map(r => r.carrierName)).size;
  const carrierCountPrevious = new Set(kpiFilteredPrevious.map(r => r.carrierName)).size;

  const monthlyTrendData = useMemo(() => {
    const dataCurrent = createFilteredDataFor('months', 'current');
    const dataPrevious = createFilteredDataFor('months', 'previous');
    const trendMap = new Map<string, { current: number, previous: number, name: string }>();
    
    for (let i = 1; i <= 12; i++) {
        const month = i.toString().padStart(2, '0');
        const monthName = new Date(2000, i - 1, 1).toLocaleString('es-CO', { month: 'short' });
        trendMap.set(month, { current: 0, previous: 0, name: monthName });
    }

    dataCurrent.forEach(r => {
        const month = r.fecha.substring(5, 7);
        const entry = trendMap.get(month);
        if(entry) entry.current += r.costo;
    });

    dataPrevious.forEach(r => {
        const month = r.fecha.substring(5, 7);
        const entry = trendMap.get(month);
        if(entry) entry.previous += r.costo;
    });

    return Array.from(trendMap.entries()).map(([, values]) => values);
  }, [baseFilteredCurrent, baseFilteredPrevious, activeFilters]);

  const dataByCarrier = useMemo(() => {
    const dataCurrent = createFilteredDataFor('carriers', 'current');
    const dataPrevious = createFilteredDataFor('carriers', 'previous');
    const carrierMap = new Map<string, { current: number, previous: number, color: string }>();

    [...dataCurrent, ...dataPrevious].forEach(r => {
        if (!carrierMap.has(r.carrierName)) {
            carrierMap.set(r.carrierName, { current: 0, previous: 0, color: r.carrierColor });
        }
    });

    dataCurrent.forEach(r => {
        const entry = carrierMap.get(r.carrierName);
        if (entry) entry.current += r.costo;
    });
    dataPrevious.forEach(r => {
        const entry = carrierMap.get(r.carrierName);
        if (entry) entry.previous += r.costo;
    });

    return Array.from(carrierMap.entries())
        .map(([name, values]) => ({ name, ...values }))
        .sort((a, b) => b.current - a.current);
  }, [baseFilteredCurrent, baseFilteredPrevious, activeFilters]);

  const dataByConcept = useMemo(() => {
    const dataCurrent = createFilteredDataFor('concepts', 'current');
    const dataPrevious = createFilteredDataFor('concepts', 'previous');
    const conceptMap = new Map<string, { current: number, previous: number }>();
    
    [...dataCurrent, ...dataPrevious].forEach(r => {
        const concept = r.concepto || 'Sin Concepto';
        if (!conceptMap.has(concept)) conceptMap.set(concept, { current: 0, previous: 0 });
    });
    
    dataCurrent.forEach(r => {
        const entry = conceptMap.get(r.concepto || 'Sin Concepto');
        if (entry) entry.current += r.costo;
    });
    dataPrevious.forEach(r => {
        const entry = conceptMap.get(r.concepto || 'Sin Concepto');
        if (entry) entry.previous += r.costo;
    });

    return Array.from(conceptMap.entries())
        .map(([name, values]) => ({ name, ...values }))
        .sort((a, b) => b.current - a.current);
  }, [baseFilteredCurrent, baseFilteredPrevious, activeFilters]);

  const dataByDestination = useMemo(() => {
    const dataCurrent = createFilteredDataFor('destinations', 'current');
    const dataPrevious = createFilteredDataFor('destinations', 'previous');
    const destMap = new Map<string, { current: number, previous: number }>();

    [...dataCurrent, ...dataPrevious].forEach(r => {
        const dest = r.destino || 'Sin Destino';
        if (!destMap.has(dest)) destMap.set(dest, { current: 0, previous: 0 });
    });
    
    dataCurrent.forEach(r => {
        const entry = destMap.get(r.destino || 'Sin Destino');
        if (entry) entry.current += r.costo;
    });
    dataPrevious.forEach(r => {
        const entry = destMap.get(r.destino || 'Sin Destino');
        if (entry) entry.previous += r.costo;
    });

    return Array.from(destMap.entries())
        .map(([name, values]) => ({ name, ...values }))
        .sort((a, b) => b.current - a.current).slice(0, 100);
  }, [baseFilteredCurrent, baseFilteredPrevious, activeFilters]);


  if (carriers.length === 0) return <WelcomeScreen />;

  return (
    <div className="space-y-6">
       <div className="bg-white p-4 rounded-xl shadow-lg">
          <div className="w-full sm:w-1/2 md:w-1/4">
              <label htmlFor="year-filter" className="block text-sm font-medium text-slate-700">Año de Comparación</label>
              <select
                  id="year-filter"
                  value={selectedYear}
                  onChange={(e) => { setSelectedYear(e.target.value); clearAllFilters(); }}
                  className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-slate-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
              >
                  {allYears.map(year => <option key={year} value={year}>{year}</option>)}
              </select>
          </div>
      </div>

      <FilterSummary activeFilters={activeFilters} onClear={handleFilterChange} onClearAll={clearAllFilters} />
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ComparativeMetricCard title="Gasto Total" currentValue={totalCostCurrent} previousValue={totalCostPrevious} formatFn={formatCurrency} />
        <ComparativeMetricCard title="Envíos Totales" currentValue={totalShipmentsCurrent} previousValue={totalShipmentsPrevious} formatFn={formatNumber} />
        <ComparativeMetricCard title="Costo Promedio" currentValue={avgCostCurrent} previousValue={avgCostPrevious} formatFn={formatCurrency} />
        <ComparativeMetricCard title="Transportadoras" currentValue={carrierCountCurrent} previousValue={carrierCountPrevious} formatFn={formatNumber} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-lg h-[400px]">
          <h3 className="text-xl font-bold text-slate-800 mb-4">Gasto Mensual ({selectedYear} vs {previousYear})</h3>
          <ResponsiveContainer width="100%" height="90%">
            <AreaChart data={monthlyTrendData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis tickFormatter={(val) => new Intl.NumberFormat('es-CO', { notation: 'compact', compactDisplay: 'short' }).format(val)} />
              <Tooltip formatter={(value: number) => value.toLocaleString('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 })} />
              <Legend />
              <Area type="monotone" dataKey="previous" name={previousYear} stroke="#8884d8" fill="#8884d8" fillOpacity={0.3} />
              <Area type="monotone" dataKey="current" name={selectedYear} stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.6} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        
        <ComparativeBreakdown 
          title="Costo por Transportadora" 
          data={dataByCarrier} 
          onRowClick={(name) => handleFilterChange('carriers', name)} 
          selectedItems={activeFilters.carriers} 
        />
        
        <div className="lg:col-span-2">
            <ComparativeBreakdown 
                title="Costo por Concepto" 
                data={dataByConcept} 
                onRowClick={(name) => handleFilterChange('concepts', name)} 
                selectedItems={activeFilters.concepts}
                fullHeight={true} 
            />
        </div>
        
        <div className="lg:col-span-2">
            <ComparativeBreakdown 
                title="Top Destinos por Costo" 
                data={dataByDestination} 
                onRowClick={(name) => handleFilterChange('destinations', name)} 
                selectedItems={activeFilters.destinations}
                fullHeight={true}
            />
        </div>
      </div>
      
      <AIComparativeInsights carriers={carriers} currentRecords={kpiFilteredCurrent} previousRecords={kpiFilteredPrevious} year={selectedYear} />

    </div>
  );
};

export default ComparativeDashboard;
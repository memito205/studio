
import React, { useState, useMemo, useEffect } from 'react';
import { Transaction, TransactionType, Filters, FilterCategory } from '../../types';
import { KpiCard } from '../KpiCard';
import { AnnualSummaryTable } from './AnnualSummaryTable';
import { TopItemsTable } from '../TopItemsTable';
import { PdvFilter } from './PdvFilter';
import { DollarSignIcon, PercentIcon, FileTextIcon } from './icons';
import dynamic from 'next/dynamic';
import { ChartType } from './ComparativeTrendChart';

const MonthlyAnalysisChart = dynamic(() => import('./MonthlyAnalysisChart').then(mod => mod.MonthlyAnalysisChart), {
  ssr: false,
  loading: () => <div className="h-[400px] w-full bg-slate-100 dark:bg-slate-800 rounded-lg flex items-center justify-center"><p>Cargando gráfico...</p></div>,
});

const ComparativeTrendChart = dynamic(() => import('./ComparativeTrendChart').then(mod => mod.ComparativeTrendChart), {
  ssr: false,
  loading: () => <div className="h-[300px] w-full bg-slate-100 dark:bg-slate-800 rounded-lg flex items-center justify-center"><p>Cargando gráfico...</p></div>,
});


interface DashboardProps {
  data: Transaction[];
  isPrinting?: boolean;
  onStateChange: (state: { year: number, filters: Filters }) => void;
  initialState?: { year: number, filters: Filters } | null;
}

/** Línea de flete en referencia: cuenta en KPIs globales pero no en tops de producto (marca/género/grupo/ref). */
function isFreightReferenceRow(d: Transaction): boolean {
  return String(d.reference ?? "").trim().toUpperCase() === "FLETE";
}

const TOP_CATEGORIES_EXCLUDING_FREIGHT: FilterCategory[] = ["reference", "brand", "gender", "group"];

const calculateTopItems = (
    category: FilterCategory,
    allFilters: Filters,
    sourceData: Transaction[]
) => {
    const { [category]: _, ...otherFilters } = allFilters;
    const activeFilterKeys = Object.keys(otherFilters) as FilterCategory[];

    let dataForThisTable = sourceData.filter(d => {
        if (activeFilterKeys.length === 0) return true;
        return activeFilterKeys.every(key => {
            const filterValues = otherFilters[key];
            if (!filterValues || !filterValues.length) return true;
            const transactionValue = d[key];
            return transactionValue ? filterValues.includes(String(transactionValue)) : false;
        });
    });

    if (TOP_CATEGORIES_EXCLUDING_FREIGHT.includes(category)) {
        dataForThisTable = dataForThisTable.filter((d) => !isFreightReferenceRow(d));
    }

    const itemMap = new Map<string, { quantity: number; value: number }>();
    dataForThisTable
        .filter(d => d.type === TransactionType.Return && d[category])
        .forEach(d => {
            const name = String(d[category]);
            const entry = itemMap.get(name) || { quantity: 0, value: 0 };
            entry.quantity += d.quantity;
            entry.value += d.value;
            itemMap.set(name, entry);
        });

    return Array.from(itemMap.entries())
        .map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 10);
};

export const Dashboard: React.FC<DashboardProps> = ({ data, onStateChange, initialState, isPrinting }) => {
  const availableYears = useMemo(() => {
    const years = new Set(data.map(d => d.date.getFullYear()));
    return Array.from(years).sort((a, b) => b - a);
  }, [data]);

  const [selectedYear, setSelectedYear] = useState<number>(initialState?.year || availableYears[0] || new Date().getFullYear());
  const [filters, setFilters] = useState<Filters>(initialState?.filters || {});

  useEffect(() => {
    onStateChange({ year: selectedYear, filters });
  }, [selectedYear, filters, onStateChange]);
  
  useEffect(() => {
    if (availableYears.length > 0 && !availableYears.includes(selectedYear)) {
      setSelectedYear(availableYears[0]);
    }
  }, [availableYears, selectedYear]);


  const handleFilterChange = (category: FilterCategory, value: string) => {
    setFilters(prevFilters => {
      const currentCategoryFilters = prevFilters[category] || [];
      const newCategoryFilters = currentCategoryFilters.includes(value)
        ? currentCategoryFilters.filter(item => item !== value)
        : [...currentCategoryFilters, value];
      
      if (newCategoryFilters.length === 0) {
        const { [category]: _, ...rest } = prevFilters;
        return rest;
      }

      return {
        ...prevFilters,
        [category]: newCategoryFilters,
      };
    });
  };

  const yearFilteredData = useMemo(() => {
    return {
        currentYearData: data.filter(d => d.date.getFullYear() === selectedYear),
        previousYearData: data.filter(d => d.date.getFullYear() === selectedYear - 1)
    };
  }, [data, selectedYear]);
  
  const allPdvs = useMemo(() => 
    Array.from(new Set(yearFilteredData.currentYearData.map(d => d.pdv)))
    .sort((a,b) => a.localeCompare(b)), [yearFilteredData.currentYearData]);

  const fullyFilteredData = useMemo(() => {
    const activeFilterKeys = Object.keys(filters) as FilterCategory[];
    if (activeFilterKeys.length === 0) {
      return yearFilteredData;
    }

    const applyFilters = (d: Transaction) => {
      return activeFilterKeys.every(key => {
        const filterValues = filters[key];
        if (!filterValues || filterValues.length === 0) return true;
        const transactionValue = d[key];
        return transactionValue ? filterValues.includes(String(transactionValue)) : false;
      });
    };

    return {
      currentYearData: yearFilteredData.currentYearData.filter(applyFilters),
      previousYearData: yearFilteredData.previousYearData.filter(applyFilters),
    };
  }, [yearFilteredData, filters]);

  const kpiData = useMemo(() => {
    const sales = fullyFilteredData.currentYearData.filter(d => d.type === TransactionType.Sale);
    const returns = fullyFilteredData.currentYearData.filter(d => d.type === TransactionType.Return);
    
    const totalSales = sales.reduce((sum, item) => sum + item.value, 0);
    const totalReturns = returns.reduce((sum, item) => sum + item.value, 0);
    const returnRate = totalSales > 0 ? totalReturns / totalSales : 0;
    
    return {
      totalSales,
      totalReturns,
      returnRate,
      invoiceCount: sales.length,
      creditNoteCount: returns.length,
    };
  }, [fullyFilteredData.currentYearData]);

  /** Base para % Part. en tops de producto: mismas devoluciones filtradas que el KPI, sin líneas FLETE. */
  const totalReturnsExcludingFreightForProductTops = useMemo(() => {
    return fullyFilteredData.currentYearData
      .filter((d) => d.type === TransactionType.Return && !isFreightReferenceRow(d))
      .reduce((s, d) => s + d.value, 0);
  }, [fullyFilteredData.currentYearData]);

  const topReturnReasons = useMemo(() => calculateTopItems('returnReason', filters, yearFilteredData.currentYearData), [filters, yearFilteredData.currentYearData]);
  const topReturnedBrands = useMemo(() => calculateTopItems('brand', filters, yearFilteredData.currentYearData), [filters, yearFilteredData.currentYearData]);
  const topReturnedGenders = useMemo(() => calculateTopItems('gender', filters, yearFilteredData.currentYearData), [filters, yearFilteredData.currentYearData]);
  const topReturnedGroups = useMemo(() => calculateTopItems('group', filters, yearFilteredData.currentYearData), [filters, yearFilteredData.currentYearData]);
  const topReturnedPdvs = useMemo(() => calculateTopItems('pdv', filters, yearFilteredData.currentYearData), [filters, yearFilteredData.currentYearData]);
  const topReturnedReferences = useMemo(() => calculateTopItems('reference', filters, yearFilteredData.currentYearData), [filters, yearFilteredData.currentYearData]);
    
  const hasFilters = Object.keys(filters).length > 0;

  return (
    <>
        {/* Layout for Screen (Interactive) */}
        <div className={isPrinting ? 'hidden' : ''}>
            <div className="space-y-6">
                <div className="bg-white dark:bg-slate-800 p-4 rounded-lg shadow-md space-y-4">
                    <div className="flex flex-wrap justify-between items-center gap-4">
                        <div className="flex-grow min-w-[200px]">
                            {hasFilters && <h4 className="text-sm font-semibold text-slate-500 dark:text-slate-400 mb-2">Filtros Activos:</h4>}
                            {hasFilters ? (
                                <div className="flex flex-wrap gap-2">
                                    {Object.entries(filters).flatMap(([category, values]) =>
                                        values.map(value => (
                                            <span key={`${category}-${value}`} className="flex items-center bg-indigo-100 text-indigo-800 text-xs font-semibold pl-2.5 pr-1 py-1 rounded-full dark:bg-indigo-900 dark:text-indigo-300">
                                                <span className="capitalize font-normal mr-1">{category.replace('returnReason', 'Motivo')}:</span> {value}
                                                <button onClick={() => handleFilterChange(category as FilterCategory, value)} className="ml-1 flex-shrink-0 text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-300 rounded-full hover:bg-indigo-200 dark:hover:bg-indigo-700 p-0.5">
                                                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"></path></svg>
                                                </button>
                                            </span>
                                        ))
                                    )}
                                </div>
                            ) : <div className="h-9"></div>}
                        </div>
                        <div className="flex items-center gap-4 flex-shrink-0">
                            {hasFilters && (
                                <button
                                    onClick={() => setFilters({})}
                                    className="bg-rose-500 text-white font-semibold px-4 py-2 rounded-lg shadow-md hover:bg-rose-600 transition-colors text-sm"
                                >
                                    Limpiar Filtros
                                </button>
                            )}
                            <PdvFilter
                                allPdvs={allPdvs}
                                selectedPdvs={filters.pdv || []}
                                onPdvChange={(pdv) => handleFilterChange('pdv', pdv)}
                            />
                            {availableYears.length > 0 && <select
                                value={selectedYear}
                                onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}
                                className="bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm px-4 py-2 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            >
                                {availableYears.map(year => (
                                    <option key={year} value={year}>Año {year}</option>
                                ))}
                            </select>}
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
                    <KpiCard title="Valor Total Ventas" value={kpiData.totalSales} year={selectedYear} type="currency" Icon={DollarSignIcon} valueClassName="text-sales" />
                    <KpiCard title="Valor Total Devoluciones" value={kpiData.totalReturns} year={selectedYear} type="currency" Icon={DollarSignIcon} valueClassName="text-returns" />
                    <KpiCard title="% Devolución sobre Ventas" value={kpiData.returnRate} year={selectedYear} type="percentage" Icon={PercentIcon} valueClassName="text-returns" />
                    <KpiCard title="Cantidad Facturas (FVE)" value={kpiData.invoiceCount} year={selectedYear} type="number" Icon={FileTextIcon} />
                    <KpiCard title="Cantidad Notas Crédito (NCE)" value={kpiData.creditNoteCount} year={selectedYear} type="number" Icon={FileTextIcon} />
                </div>
                
                <AnnualSummaryTable currentYearData={fullyFilteredData.currentYearData} previousYearData={fullyFilteredData.previousYearData} currentYear={selectedYear} />
                <MonthlyAnalysisChart data={fullyFilteredData.currentYearData} year={selectedYear} />
                <ComparativeTrendChart currentYearData={fullyFilteredData.currentYearData} previousYearData={fullyFilteredData.previousYearData} currentYear={selectedYear} type={ChartType.ReturnRate} />
                <ComparativeTrendChart currentYearData={fullyFilteredData.currentYearData} previousYearData={fullyFilteredData.previousYearData} currentYear={selectedYear} type={ChartType.Sales} />
                <ComparativeTrendChart currentYearData={fullyFilteredData.currentYearData} previousYearData={fullyFilteredData.previousYearData} currentYear={selectedYear} type={ChartType.Returns} />
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <TopItemsTable title="Top 10 Motivos de Devolución" data={topReturnReasons} totalValue={kpiData.totalReturns} filterCategory="returnReason" onFilterChange={handleFilterChange} activeFilters={filters} />
                    <TopItemsTable title="Top 10 Marcas Devueltas" data={topReturnedBrands} totalValue={totalReturnsExcludingFreightForProductTops} filterCategory="brand" onFilterChange={handleFilterChange} activeFilters={filters} />
                    <TopItemsTable title="Top 10 Géneros Devueltos" data={topReturnedGenders} totalValue={totalReturnsExcludingFreightForProductTops} filterCategory="gender" onFilterChange={handleFilterChange} activeFilters={filters} />
                    <TopItemsTable title="Top 10 Grupos Devueltos" data={topReturnedGroups} totalValue={totalReturnsExcludingFreightForProductTops} filterCategory="group" onFilterChange={handleFilterChange} activeFilters={filters} />
                    <TopItemsTable title="Top 10 PDV / Grupos Devueltos" data={topReturnedPdvs} totalValue={kpiData.totalReturns} filterCategory="pdv" onFilterChange={handleFilterChange} activeFilters={filters} />
                    <TopItemsTable title="Top 10 Referencias Devueltas" data={topReturnedReferences} totalValue={totalReturnsExcludingFreightForProductTops} filterCategory="reference" onFilterChange={handleFilterChange} activeFilters={filters} />
                </div>
            </div>
        </div>

        {/* Layout for Printing (Simplified, hidden on screen) */}
        <div id="dashboard-for-print" className={isPrinting ? 'block' : 'hidden'}>
            <div className="print-page-break p-4">
                <h2 className="text-xl font-bold mb-4">Indicadores Clave de Rendimiento ({selectedYear})</h2>
                <div className="grid grid-cols-3 gap-6">
                    <KpiCard title="Valor Total Ventas" value={kpiData.totalSales} year={selectedYear} type="currency" Icon={DollarSignIcon} valueClassName="text-sales" />
                    <KpiCard title="Valor Total Devoluciones" value={kpiData.totalReturns} year={selectedYear} type="currency" Icon={DollarSignIcon} valueClassName="text-returns" />
                    <KpiCard title="% Devolución sobre Ventas" value={kpiData.returnRate} year={selectedYear} type="percentage" Icon={PercentIcon} valueClassName="text-returns" />
                    <KpiCard title="Cantidad Facturas (FVE)" value={kpiData.invoiceCount} year={selectedYear} type="number" Icon={FileTextIcon} />
                    <KpiCard title="Cantidad Notas Crédito (NCE)" value={kpiData.creditNoteCount} year={selectedYear} type="number" Icon={FileTextIcon} />
                </div>
            </div>
            <div className="print-page-break p-4"><AnnualSummaryTable currentYearData={fullyFilteredData.currentYearData} previousYearData={fullyFilteredData.previousYearData} currentYear={selectedYear} /></div>
            <div className="print-page-break p-4 flex justify-center"><MonthlyAnalysisChart data={fullyFilteredData.currentYearData} year={selectedYear} isPrinting={true} /></div>
            <div className="print-page-break p-4 flex justify-center"><ComparativeTrendChart currentYearData={fullyFilteredData.currentYearData} previousYearData={fullyFilteredData.previousYearData} currentYear={selectedYear} type={ChartType.ReturnRate} isPrinting={true} /></div>
            <div className="print-page-break p-4 flex justify-center"><ComparativeTrendChart currentYearData={fullyFilteredData.currentYearData} previousYearData={fullyFilteredData.previousYearData} currentYear={selectedYear} type={ChartType.Sales} isPrinting={true} /></div>
            <div className="print-page-break p-4 flex justify-center"><ComparativeTrendChart currentYearData={fullyFilteredData.currentYearData} previousYearData={fullyFilteredData.previousYearData} currentYear={selectedYear} type={ChartType.Returns} isPrinting={true} /></div>
            <div className="print-page-break p-4"><TopItemsTable title="Top 10 Motivos de Devolución" data={topReturnReasons} totalValue={kpiData.totalReturns} filterCategory="returnReason" onFilterChange={handleFilterChange} activeFilters={filters} isPrinting={true} /></div>
            <div className="print-page-break p-4"><TopItemsTable title="Top 10 Marcas Devueltas" data={topReturnedBrands} totalValue={totalReturnsExcludingFreightForProductTops} filterCategory="brand" onFilterChange={handleFilterChange} activeFilters={filters} isPrinting={true} /></div>
            <div className="print-page-break p-4"><TopItemsTable title="Top 10 Géneros Devueltos" data={topReturnedGenders} totalValue={totalReturnsExcludingFreightForProductTops} filterCategory="gender" onFilterChange={handleFilterChange} activeFilters={filters} isPrinting={true} /></div>
            <div className="print-page-break p-4"><TopItemsTable title="Top 10 Grupos Devueltos" data={topReturnedGroups} totalValue={totalReturnsExcludingFreightForProductTops} filterCategory="group" onFilterChange={handleFilterChange} activeFilters={filters} isPrinting={true} /></div>
            <div className="print-page-break p-4"><TopItemsTable title="Top 10 PDV / Grupos Devueltos" data={topReturnedPdvs} totalValue={kpiData.totalReturns} filterCategory="pdv" onFilterChange={handleFilterChange} activeFilters={filters} isPrinting={true} /></div>
            <div className="p-4"><TopItemsTable title="Top 10 Referencias Devueltas" data={topReturnedReferences} totalValue={totalReturnsExcludingFreightForProductTops} filterCategory="reference" onFilterChange={handleFilterChange} activeFilters={filters} isPrinting={true} /></div>
        </div>
    </>
  );
};

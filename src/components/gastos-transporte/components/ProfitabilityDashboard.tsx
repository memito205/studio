
import React, { useState, useCallback, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { IncomeRecord, ExpenseRecord, ReconciledTransaction, CarrierData, ActiveFilters, JustificationRecord } from '../types';
import { parseFiles } from '../services/csvParser';
import { formatCurrency, formatNumber } from '../utils/formatters';
import FilterSummary from './FilterSummary';

interface ProfitabilityDashboardProps {
    incomeRecords: IncomeRecord[];
    carriers: CarrierData[];
    siopRecords: any[];
    setSiopRecords: (records: any[]) => void;
    justifications?: JustificationRecord[];
}

const SimplePaginatedTable: React.FC<{ title: string; records: any[]; headers: {key: string; label: string}[]; formatters?: {[key:string]: (val: any) => string} }> = 
({ title, records, headers, formatters }) => {
    const [currentPage, setCurrentPage] = useState(1);
    const RECORDS_PER_PAGE = 10;
    const totalPages = Math.ceil(records.length / RECORDS_PER_PAGE);
    const paginatedRecords = records.slice((currentPage - 1) * RECORDS_PER_PAGE, currentPage * RECORDS_PER_PAGE);
    if (records.length === 0) return null;
    return (
        <div className="bg-white p-6 rounded-xl shadow-lg">
            <h3 className="text-xl font-bold text-slate-800 mb-4">{title} ({formatNumber(records.length)})</h3>
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                     <thead className="bg-slate-50">
                        <tr>
                            {headers.map(h => <th key={h.key} className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">{h.label}</th>)}
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-200">
                        {paginatedRecords.map((record, index) => (
                            <tr key={index} className="hover:bg-slate-50">
                                {headers.map(h => (
                                    <td key={h.key} className="px-4 py-4 whitespace-nowrap text-sm text-slate-700">
                                        {formatters && formatters[h.key] ? formatters[h.key](record[h.key]) : record[h.key]}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
             {totalPages > 1 && (
                 <div className="flex items-center justify-between pt-4 border-t border-slate-200 mt-4">
                    <span className="text-sm text-slate-600">Página {currentPage} de {totalPages}</span>
                    <div className="flex items-center space-x-2">
                         <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="px-3 py-1 border rounded-md text-sm disabled:opacity-50">Anterior</button>
                         <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="px-3 py-1 border rounded-md text-sm disabled:opacity-50">Siguiente</button>
                    </div>
                </div>
            )}
        </div>
    );
};

const ResultsDashboard: React.FC<{ 
    allReconciled: ReconciledTransaction[],
    allUnreconciledIncome: IncomeRecord[],
    allUnreconciledExpenses: (ExpenseRecord & { carrierName: string })[],
    allJustifiedExpenses: (ExpenseRecord & { carrierName: string, motivo: string })[],
    onUpdateSiop: () => void
}> = ({ allReconciled, allUnreconciledIncome, allUnreconciledExpenses, allJustifiedExpenses, onUpdateSiop }) => {

    const allYears = useMemo(() => {
        const years = new Set<string>(allReconciled.map(tx => tx.fechaIngreso.substring(0, 4)));
        if (years.size === 0) return [new Date().getFullYear().toString()];
        return Array.from(years).sort((a,b) => b.localeCompare(a)).slice(0, 2);
    }, [allReconciled]);

    const [selectedYear, setSelectedYear] = useState(allYears[0]);
    const [activeFilters, setActiveFilters] = useState<ActiveFilters>({ carriers: [], concepts: [], destinations: [], months: [] });

    const handleFilterChange = useCallback((value: string) => {
        setActiveFilters(prev => {
            const currentValues = prev.carriers;
            const newValues = currentValues.includes(value) ? currentValues.filter(v => v !== value) : [...currentValues, value];
            return { ...prev, carriers: newValues };
        });
    }, []);

    const reconciledForYear = useMemo(() => allReconciled.filter(tx => tx.fechaIngreso.startsWith(selectedYear)), [allReconciled, selectedYear]);
    const unreconciledExpensesForYear = useMemo(() => allUnreconciledExpenses.filter(exp => exp.fecha.startsWith(selectedYear)), [allUnreconciledExpenses, selectedYear]);
    const justifiedExpensesForYear = useMemo(() => allJustifiedExpenses.filter(exp => exp.fecha.startsWith(selectedYear)), [allJustifiedExpenses, selectedYear]);

    const filteredReconciled = useMemo(() => activeFilters.carriers.length === 0 ? reconciledForYear : reconciledForYear.filter(tx => activeFilters.carriers.includes(tx.carrierName || '')), [reconciledForYear, activeFilters]);
    const filteredUnreconciledExpenses = useMemo(() => activeFilters.carriers.length === 0 ? unreconciledExpensesForYear : unreconciledExpensesForYear.filter(exp => activeFilters.carriers.includes(exp.carrierName)), [unreconciledExpensesForYear, activeFilters]);
    const filteredJustifiedExpenses = useMemo(() => activeFilters.carriers.length === 0 ? justifiedExpensesForYear : justifiedExpensesForYear.filter(exp => activeFilters.carriers.includes(exp.carrierName)), [justifiedExpensesForYear, activeFilters]);

    const generalSummary = useMemo(() => {
        const totalIncome = filteredReconciled.reduce((sum, tx) => sum + tx.montoIngreso, 0);
        const reconciledExpense = filteredReconciled.reduce((sum, tx) => sum + (tx.costoGasto || 0), 0);
        const unreconciledExpense = filteredUnreconciledExpenses.reduce((sum, exp) => sum + exp.costo, 0);
        const justifiedExpense = filteredJustifiedExpenses.reduce((sum, exp) => sum + exp.costo, 0);
        const totalExpense = reconciledExpense + unreconciledExpense + justifiedExpense;
        const utility = totalIncome - totalExpense;
        return { totalIncome, totalExpense, utility, reconciledExpense, unreconciledExpense, justifiedExpense, margin: totalIncome > 0 ? utility / totalIncome : 0 };
    }, [filteredReconciled, filteredUnreconciledExpenses, filteredJustifiedExpenses]);

    const monthlyTrend = useMemo(() => {
        const dataMap = new Map<string, { income: number, expense: number, justified: number }>();
        filteredReconciled.forEach(tx => {
            const m = tx.fechaIngreso.substring(0, 7);
            const cur = dataMap.get(m) || { income: 0, expense: 0, justified: 0 };
            cur.income += tx.montoIngreso;
            cur.expense += tx.costoGasto || 0;
            dataMap.set(m, cur);
        });
        filteredUnreconciledExpenses.forEach(exp => {
            const m = exp.fecha.substring(0, 7);
            const cur = dataMap.get(m) || { income: 0, expense: 0, justified: 0 };
            cur.expense += exp.costo;
            dataMap.set(m, cur);
        });
        filteredJustifiedExpenses.forEach(exp => {
            const m = exp.fecha.substring(0, 7);
            const cur = dataMap.get(m) || { income: 0, expense: 0, justified: 0 };
            cur.justified += exp.costo;
            dataMap.set(m, cur);
        });
        return Array.from(dataMap.entries()).sort().map(([key, val]) => ({
            name: new Date(`${key}-02`).toLocaleString('es-CO', { month: 'short' }),
            ...val
        }));
    }, [filteredReconciled, filteredUnreconciledExpenses, filteredJustifiedExpenses]);

    return (
        <div className="space-y-6">
            <div className="bg-white p-4 rounded-xl shadow-lg flex justify-between items-center flex-wrap gap-4">
                <div className="flex items-center space-x-4">
                    <div className="w-32">
                        <label className="block text-xs font-medium text-slate-500 uppercase">Año</label>
                        <select value={selectedYear} onChange={e => setSelectedYear(e.target.value)} className="mt-1 block w-full border rounded-md p-1.5 text-sm">
                            {allYears.map(year => <option key={year} value={year}>{year}</option>)}
                        </select>
                    </div>
                    <button onClick={onUpdateSiop} className="px-4 py-2 mt-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md text-sm font-medium transition-colors flex items-center">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                        </svg>
                        Actualizar SIOP
                    </button>
                </div>
                <div className="flex space-x-4">
                    <div className="text-center px-4 border-r"><p className="text-xs text-slate-500 uppercase">Guías Cruzadas</p><p className="text-xl font-bold">{formatNumber(allReconciled.length)}</p></div>
                    <div className="text-center px-4"><p className="text-xs text-indigo-500 uppercase">Justificadas</p><p className="text-xl font-bold text-indigo-600">{formatNumber(allJustifiedExpenses.length)}</p></div>
                </div>
            </div>

            <FilterSummary activeFilters={activeFilters} onClear={(_, val) => handleFilterChange(val)} onClearAll={() => setActiveFilters({carriers:[], concepts:[], destinations:[], months:[]})} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                 <div className="bg-white p-6 rounded-xl shadow-lg border-t-4 border-blue-500">
                    <h3 className="text-xl font-bold text-slate-800 mb-4">Estado de Resultados Operativos</h3>
                    <table className="min-w-full"><tbody className="divide-y divide-slate-200">
                        <tr><td className="py-2 text-slate-600">Ingreso Operativo Cruzado</td><td className="text-right font-bold text-green-600">{formatCurrency(generalSummary.totalIncome)}</td></tr>
                        <tr className="text-sm"><td className="py-1 pl-4">-- Costo Transporte (Operativo)</td><td className="text-right text-slate-500">{formatCurrency(generalSummary.reconciledExpense)}</td></tr>
                        <tr className="text-sm bg-indigo-50"><td className="py-1 pl-4 font-medium text-indigo-700">-- Inversión Campañas (Justificado)</td><td className="text-right text-indigo-700">{formatCurrency(generalSummary.justifiedExpense)}</td></tr>
                        <tr className="text-sm"><td className="py-1 pl-4 text-red-500 italic">-- Gasto No Identificado (Fuga)</td><td className="text-right text-red-500">{formatCurrency(generalSummary.unreconciledExpense)}</td></tr>
                        <tr className="border-t-2 font-bold text-lg"><td className="py-3">Utilidad Real</td><td className={`text-right ${generalSummary.utility < 0 ? 'text-red-600' : 'text-slate-800'}`}>{formatCurrency(generalSummary.utility)}</td></tr>
                        <tr className="font-bold"><td className="py-2">Margen Real Final</td><td className={`text-right text-xl ${generalSummary.margin < 0 ? 'text-red-600' : 'text-indigo-600'}`}>{(generalSummary.margin * 100).toFixed(2)}%</td></tr>
                    </tbody></table>
                </div>
                <div className="bg-white p-6 rounded-xl shadow-lg h-[400px]">
                    <h3 className="text-xl font-bold mb-4">Composición de Gastos Mensual</h3>
                    <ResponsiveContainer width="100%" height="90%">
                        <BarChart data={monthlyTrend}>
                            <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis tickFormatter={v => formatCurrency(v, true)} />
                            <Tooltip formatter={v => formatCurrency(v as number)} /><Legend />
                            <Bar dataKey="income" name="Ingreso" fill="#10b981" />
                            <Bar dataKey="expense" name="Gasto Operativo + Fuga" fill="#ef4444" stackId="a" />
                            <Bar dataKey="justified" name="Justificación Campaña" fill="#6366f1" stackId="a" />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <SimplePaginatedTable title="Detalle Campañas" records={filteredJustifiedExpenses} headers={[{key:'fecha', label:'Fecha'}, {key:'guia', label:'Guía'}, {key:'motivo', label:'Campaña'}, {key:'costo', label:'Costo'}]} formatters={{costo: v => formatCurrency(v)}} />
                <SimplePaginatedTable title="Gastos Sin Identificar" records={filteredUnreconciledExpenses} headers={[{key:'fecha', label:'Fecha'}, {key:'guia', label:'Guía'}, {key:'costo', label:'Costo'}]} formatters={{costo: v => formatCurrency(v)}} />
                <SimplePaginatedTable title="Ingresos Pendientes" records={allUnreconciledIncome.filter(i => i.fecha.startsWith(selectedYear))} headers={[{key:'fecha', label:'Fecha'}, {key:'ordenDeCompra', label:'Pedido'}, {key:'monto', label:'Monto'}]} formatters={{monto: v => formatCurrency(v)}} />
            </div>
        </div>
    );
};

const ProfitabilityDashboard: React.FC<ProfitabilityDashboardProps> = ({ incomeRecords, carriers, siopRecords, setSiopRecords, justifications = [] }) => {
    const [isParsing, setIsParsing] = useState(false);
    const [forceShowUpload, setForceShowUpload] = useState(false);
    
    const expenseRecords = useMemo(() => carriers.flatMap(c => c.data.map(r => ({ ...r, carrierName: c.name }))), [carriers]);

    const cleanStr = (s: any) => String(s || '').trim().replace('DDD-', '').replace(/-/g, '');
    const siopMap = useMemo(() => new Map(siopRecords.map(r => [cleanStr(r.PED_GUIA_TTE), cleanStr(r.PED_ID)])), [siopRecords]);
    const justMap = useMemo(() => new Map(justifications.map(j => [cleanStr(j.pedId), j.motivo])), [justifications]);

    const handleSiopFileParse = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;
        setIsParsing(true);
        try {
            const parsedData = await parseFiles(files);
            const cleanedRecords = parsedData.records.map(record => ({
                'PED_ID': cleanStr(record['PED_ID']),
                'PED_GUIA_TTE': cleanStr(record['PED_GUIA_TTE'])
            })).filter(r => r.PED_ID && r.PED_GUIA_TTE);
            setSiopRecords(cleanedRecords);
            setForceShowUpload(false);
        } catch (e) {
            console.error(e);
        } finally { setIsParsing(false); }
    };

    const enrichedIncomeRecords = useMemo(() => {
        const orderToGuiaMap = new Map(siopRecords.map(r => [cleanStr(r.PED_ID), cleanStr(r.PED_GUIA_TTE)]));
        return incomeRecords.map(income => {
            const pedId = cleanStr(income.ordenDeCompra);
            return { ...income, guia: orderToGuiaMap.get(pedId) || 'NO EN SIOP' };
        });
    }, [incomeRecords, siopRecords]);

    const reconciledTransactions = useMemo((): ReconciledTransaction[] => {
        const expenseMap = new Map<string, (ExpenseRecord & { carrierName: string })>(expenseRecords.map(e => [cleanStr(e.guia), e]));
        const transactions: ReconciledTransaction[] = [];
        enrichedIncomeRecords.forEach(income => {
            if (income.guia && income.guia !== 'NO EN SIOP') {
                const matchingExpense = expenseMap.get(cleanStr(income.guia));
                if (matchingExpense) {
                    const utilidad = income.monto - matchingExpense.costo;
                    transactions.push({
                        id: `${income.co}-${income.contable}`,
                        fechaIngreso: income.fecha,
                        nroDocumento: `${income.co}-${income.contable}`,
                        guia: income.guia,
                        montoIngreso: income.monto,
                        fechaGasto: matchingExpense.fecha,
                        costoGasto: matchingExpense.costo,
                        utilidad,
                        margen: income.monto !== 0 ? utilidad / income.monto : 0,
                        carrierName: matchingExpense.carrierName
                    });
                }
            }
        });
        return transactions;
    }, [enrichedIncomeRecords, expenseRecords]);

    const { unreconciledIncome, unreconciledExpenses, justifiedExpenses } = useMemo(() => {
        const reconciledGuiaSet = new Set(reconciledTransactions.map(t => cleanStr(t.guia)));
        const incomeNoMatch = enrichedIncomeRecords.filter(r => r.guia && r.guia !== 'NO EN SIOP' && !reconciledGuiaSet.has(cleanStr(r.guia)));
        const expensesLeft = expenseRecords.filter(r => r.guia && !reconciledGuiaSet.has(cleanStr(r.guia)) && r.concepto === 'TRANSPORTE ECOMMERCE');
        
        const justs: (ExpenseRecord & { carrierName: string, motivo: string })[] = [];
        const unrecExps: (ExpenseRecord & { carrierName: string })[] = [];

        expensesLeft.forEach(exp => {
            const pedId = siopMap.get(cleanStr(exp.guia));
            const motivo = pedId ? justMap.get(pedId) : null;
            if (motivo) justs.push({ ...exp, motivo });
            else unrecExps.push(exp);
        });

        return { unreconciledIncome: incomeNoMatch, unreconciledExpenses: unrecExps, justifiedExpenses: justs };
    }, [reconciledTransactions, enrichedIncomeRecords, expenseRecords, siopMap, justMap]);

    // LÓGICA DE VISUALIZACIÓN CORREGIDA:
    // Si no hay SIOP o se pulsa el botón de actualizar, mostramos la carga.
    if (siopRecords.length === 0 || forceShowUpload) {
        return (
            <div className="bg-white p-10 rounded-xl shadow-lg text-center animate-fade-in max-w-4xl mx-auto">
                <div className="mb-8">
                    <div className="bg-blue-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                    </div>
                    <h2 className="text-3xl font-bold text-slate-800 mb-4">Cargar Archivo Maestro (SIOP)</h2>
                    <p className="text-slate-600 max-w-lg mx-auto mb-8">
                        Para realizar el análisis de rentabilidad real y cruzar las justificaciones de campañas, es necesario el archivo SIOP con las columnas <strong>PED_ID</strong> y <strong>PED_GUIA_TTE</strong>.
                    </p>
                </div>
                
                <div className="flex flex-col items-center space-y-4">
                    <input type="file" id="siopInputFinal" onChange={handleSiopFileParse} className="hidden" />
                    <label htmlFor="siopInputFinal" className="px-10 py-4 bg-blue-600 text-white rounded-lg font-bold cursor-pointer hover:bg-blue-700 transition-all shadow-md active:scale-95">
                        {isParsing ? 'Procesando Archivo...' : 'Seleccionar Archivo SIOP'}
                    </label>
                    {siopRecords.length > 0 && (
                        <button onClick={() => setForceShowUpload(false)} className="text-slate-500 hover:text-slate-700 text-sm font-medium underline">
                            Volver al reporte actual
                        </button>
                    )}
                </div>
            </div>
        );
    }

    return <ResultsDashboard 
        allReconciled={reconciledTransactions} 
        allUnreconciledIncome={unreconciledIncome} 
        allUnreconciledExpenses={unreconciledExpenses} 
        allJustifiedExpenses={justifiedExpenses}
        onUpdateSiop={() => setForceShowUpload(true)}
    />
};

export default ProfitabilityDashboard;

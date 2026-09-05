
import React, { useState, useMemo, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { IncomeRecord, ExpenseRecord, ReconciledTransaction, CarrierData, ActiveFilters, JustificationRecord } from '../types';
import { formatCurrency, formatNumber } from '../utils/formatters';
import FilterSummary from './FilterSummary';

interface ExpenseProfitabilityDashboardProps {
    incomeRecords: IncomeRecord[];
    carriers: CarrierData[];
    siopRecords: any[];
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
                        <tr>{headers.map(h => <th key={h.key} className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">{h.label}</th>)}</tr>
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
    allJustifiedExpenses: (ExpenseRecord & { carrierName: string, motivo: string })[]
}> = ({ allReconciled, allUnreconciledIncome, allUnreconciledExpenses, allJustifiedExpenses }) => {

    const allYears = useMemo(() => {
        const years = new Set<string>(allReconciled.map(tx => tx.fechaGasto?.substring(0, 4)).filter((y): y is string => !!y));
        if (years.size === 0) return [new Date().getFullYear().toString()];
        return Array.from(years).sort((a,b) => b.localeCompare(a)).slice(0, 2);
    }, [allReconciled]);

    const [selectedYear, setSelectedYear] = useState(allYears[0]);
    const [activeFilters, setActiveFilters] = useState<ActiveFilters>({ carriers: [], concepts: [], destinations: [], months: [] });

    const reconciledForYear = useMemo(() => allReconciled.filter(tx => tx.fechaGasto?.startsWith(selectedYear)), [allReconciled, selectedYear]);
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
            if (tx.fechaGasto) {
                const m = tx.fechaGasto.substring(0, 7);
                const cur = dataMap.get(m) || { income: 0, expense: 0, justified: 0 };
                cur.income += tx.montoIngreso;
                cur.expense += tx.costoGasto || 0;
                dataMap.set(m, cur);
            }
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
            <div className="bg-white p-4 rounded-xl shadow-lg flex justify-between items-center">
                <div className="w-1/4">
                    <label className="block text-xs font-medium text-slate-500 uppercase">Año del Gasto</label>
                    <select value={selectedYear} onChange={e => setSelectedYear(e.target.value)} className="mt-1 block w-full border rounded-md p-2 text-sm">
                        {allYears.map(year => <option key={year} value={year}>{year}</option>)}
                    </select>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-white p-6 rounded-xl shadow-lg border-b-4 border-green-500"><p className="text-xs text-slate-500 uppercase">Ingreso Generado</p><p className="text-2xl font-bold">{formatCurrency(generalSummary.totalIncome)}</p></div>
                <div className="bg-white p-6 rounded-xl shadow-lg border-b-4 border-slate-500"><p className="text-xs text-slate-500 uppercase">Gasto Operativo</p><p className="text-2xl font-bold">{formatCurrency(generalSummary.reconciledExpense)}</p></div>
                <div className="bg-white p-6 rounded-xl shadow-lg border-b-4 border-indigo-500"><p className="text-xs text-indigo-500 uppercase">Inversión Campañas</p><p className="text-2xl font-bold text-indigo-600">{formatCurrency(generalSummary.justifiedExpense)}</p></div>
                <div className="bg-white p-6 rounded-xl shadow-lg border-b-4 border-red-500"><p className="text-xs text-red-500 uppercase">Gasto No Identificado</p><p className="text-2xl font-bold text-red-600">{formatCurrency(generalSummary.unreconciledExpense)}</p></div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-xl shadow-lg">
                    <h3 className="text-xl font-bold mb-4 text-slate-800">Análisis de Utilidad Real</h3>
                    <table className="min-w-full divide-y divide-slate-200">
                        <tbody className="divide-y divide-slate-200">
                            <tr className="font-bold text-lg"><td className="py-2">Margen Final</td><td className={`text-right ${generalSummary.margin < 0 ? 'text-red-600' : 'text-green-600'}`}>{(generalSummary.margin * 100).toFixed(2)}%</td></tr>
                            <tr><td className="py-2">Utilidad Neta Real</td><td className="text-right font-bold">{formatCurrency(generalSummary.utility)}</td></tr>
                        </tbody>
                    </table>
                </div>
                <div className="bg-white p-6 rounded-xl shadow-lg h-[400px]">
                    <h3 className="text-xl font-bold mb-4 text-slate-800">Impacto Mensual del Gasto</h3>
                    <ResponsiveContainer width="100%" height="90%">
                        <BarChart data={monthlyTrend}>
                            <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis tickFormatter={v => formatCurrency(v, true)} />
                            <Tooltip formatter={v => formatCurrency(v as number)} /><Legend />
                            <Bar dataKey="income" name="Ingreso" fill="#10b981" />
                            <Bar dataKey="expense" name="Gasto Operativo + Fuga" fill="#ef4444" stackId="a" />
                            <Bar dataKey="justified" name="Justificado (Campañas)" fill="#6366f1" stackId="a" />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <SimplePaginatedTable title="Gastos Salvados" records={filteredJustifiedExpenses} headers={[{key:'fecha', label:'Fecha'}, {key:'carrierName', label:'Carrier'}, {key:'motivo', label:'Campaña'}, {key:'costo', label:'Costo'}]} formatters={{costo: v => formatCurrency(v)}} />
                <SimplePaginatedTable title="Gastos Sin Identificar" records={filteredUnreconciledExpenses} headers={[{key:'fecha', label:'Fecha'}, {key:'carrierName', label:'Carrier'}, {key:'guia', label:'Guía'}, {key:'costo', label:'Costo'}]} formatters={{costo: v => formatCurrency(v)}} />
            </div>
        </div>
    );
};

const ExpenseProfitabilityDashboard: React.FC<ExpenseProfitabilityDashboardProps> = ({ incomeRecords, carriers, siopRecords, justifications = [] }) => {
    
    const expenseRecords = useMemo(() => carriers.flatMap(c => c.data.map(r => ({ ...r, carrierName: c.name }))), [carriers]);
    const arePrerequisitesMet = incomeRecords.length > 0 && expenseRecords.length > 0;

    const cleanStr = (s: any) => String(s || '').trim().replace('DDD-', '').replace(/-/g, '');
    const siopMap = useMemo(() => new Map(siopRecords.map(r => [cleanStr(r.PED_GUIA_TTE), cleanStr(r.PED_ID)])), [siopRecords]);
    const justMap = useMemo(() => new Map(justifications.map(j => [cleanStr(j.pedId), j.motivo])), [justifications]);

    const enrichedIncomeRecords = useMemo(() => {
        const orderToGuiaMap = new Map(siopRecords.map(r => [cleanStr(r.PED_ID), cleanStr(r.PED_GUIA_TTE)]));
        return incomeRecords.map(income => ({ ...income, guia: orderToGuiaMap.get(cleanStr(income.ordenDeCompra)) || 'NO EN SIOP' }));
    }, [incomeRecords, siopRecords]);

    const reconciledTransactions = useMemo((): ReconciledTransaction[] => {
        const expenseMap = new Map<string, (ExpenseRecord & { carrierName: string })>(expenseRecords.map(e => [cleanStr(e.guia), e]));
        const transactions: ReconciledTransaction[] = [];
        enrichedIncomeRecords.forEach(income => {
            if (income.guia && income.guia !== 'NO EN SIOP') {
                const matchingExpense = expenseMap.get(cleanStr(income.guia));
                if (matchingExpense) {
                    transactions.push({
                        id: `${income.co}-${income.contable}`,
                        fechaIngreso: income.fecha,
                        nroDocumento: `${income.co}-${income.contable}`,
                        guia: income.guia,
                        montoIngreso: income.monto,
                        fechaGasto: matchingExpense.fecha,
                        costoGasto: matchingExpense.costo,
                        utilidad: income.monto - matchingExpense.costo,
                        margen: income.monto !== 0 ? (income.monto - matchingExpense.costo) / income.monto : 0,
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
    
    // Si no hay SIOP, pedir que se cargue en la vista principal de rentabilidad
    if (siopRecords.length === 0) {
        return (
            <div className="text-center p-20 bg-white rounded-xl shadow-lg max-w-2xl mx-auto">
                <div className="bg-amber-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                </div>
                <h2 className="text-2xl font-bold text-slate-800 mb-4">Requiere Archivo SIOP</h2>
                <p className="text-slate-600">
                    Este reporte no puede generarse sin el archivo maestro. Por favor, cargue el <strong>SIOP</strong> en la sección <strong>Rentabilidad (Ingreso)</strong> primero.
                </p>
            </div>
        );
    }

    if (!arePrerequisitesMet) {
        return (
            <div className="text-center p-10 bg-white rounded-xl shadow-lg max-w-2xl mx-auto">
                <h2 className="text-3xl font-bold text-slate-800 mb-4">Faltan Datos</h2>
                <p className="text-slate-600">Por favor, cargue ingresos y gastos para ver este reporte.</p>
            </div>
        );
    }

    return (
        <ResultsDashboard 
            allReconciled={reconciledTransactions} 
            allUnreconciledIncome={unreconciledIncome}
            allUnreconciledExpenses={unreconciledExpenses}
            allJustifiedExpenses={justifiedExpenses}
        />
    );
};

export default ExpenseProfitabilityDashboard;


import React, { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { IncomeRecord, CarrierData, ReconciledTransaction } from '../types';
import { formatCurrency, formatNumber } from '../utils/formatters';

interface AccrualMatchingDashboardProps {
  incomeRecords: IncomeRecord[];
  carriers: CarrierData[];
  siopRecords: any[];
}

const AccrualMatchingDashboard: React.FC<AccrualMatchingDashboardProps> = ({ incomeRecords, carriers, siopRecords }) => {
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());

  const cleanStr = (s: any) => String(s || '').trim().replace('DDD-', '').replace(/-/g, '');
  
  const orderToGuiaMap = useMemo(() => new Map(siopRecords.map(r => [cleanStr(r.PED_ID), cleanStr(r.PED_GUIA_TTE)])), [siopRecords]);
  const expenseRecords = useMemo(() => carriers.flatMap(c => c.data.map(r => ({ ...r, carrierName: c.name }))), [carriers]);
  const expenseMap = useMemo(() => new Map(expenseRecords.map(e => [cleanStr(e.guia), e])), [expenseRecords]);

  const reconciledTransactions = useMemo((): ReconciledTransaction[] => {
    const transactions: ReconciledTransaction[] = [];
    incomeRecords.forEach(income => {
      const pedId = cleanStr(income.ordenDeCompra);
      const guia = orderToGuiaMap.get(pedId);
      if (guia) {
        const matchingExpense = expenseMap.get(cleanStr(guia));
        if (matchingExpense) {
          const utilidad = income.monto - matchingExpense.costo;
          transactions.push({
            id: `${income.co}-${income.contable}`,
            fechaIngreso: income.fecha,
            nroDocumento: `${income.co}-${income.contable}`,
            guia: guia,
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
  }, [incomeRecords, orderToGuiaMap, expenseMap]);

  const unmatchedExpenses = useMemo(() => {
    const reconciledGuiaSet = new Set(reconciledTransactions.map(t => cleanStr(t.guia)));
    return expenseRecords.filter(exp => 
      exp.fecha.startsWith(selectedYear) && 
      exp.concepto === 'TRANSPORTE ECOMMERCE' && 
      !reconciledGuiaSet.has(cleanStr(exp.guia))
    );
  }, [expenseRecords, reconciledTransactions, selectedYear]);

  const accrualData = useMemo(() => {
    const filtered = reconciledTransactions.filter(t => t.fechaIngreso.startsWith(selectedYear));
    
    // Cross-month transactions: Income in month X, Expense in month Y (X != Y or Year X != Year Y)
    const crossMonth = filtered.filter(t => {
      const incomeMonth = t.fechaIngreso.substring(0, 7);
      const expenseMonth = t.fechaGasto?.substring(0, 7);
      return incomeMonth !== expenseMonth;
    });

    const monthlyStats = Array.from({ length: 12 }, (_, i) => {
      const month = (i + 1).toString().padStart(2, '0');
      return {
        month,
        name: new Date(2000, i, 1).toLocaleString('es-CO', { month: 'short' }),
        income: 0,
        expenseMatched: 0, // Expense matched to this income month
        unmatchedExpense: 0, // Expense without income in this month
        crossMonthCount: 0
      };
    });

    filtered.forEach(t => {
      const monthIndex = parseInt(t.fechaIngreso.substring(5, 7)) - 1;
      monthlyStats[monthIndex].income += t.montoIngreso;
      monthlyStats[monthIndex].expenseMatched += t.costoGasto || 0;
      
      const incomeMonth = t.fechaIngreso.substring(0, 7);
      const expenseMonth = t.fechaGasto?.substring(0, 7);
      if (incomeMonth !== expenseMonth) {
        monthlyStats[monthIndex].crossMonthCount++;
      }
    });

    // Add unmatched expenses to monthly stats based on their own date
    unmatchedExpenses.forEach(exp => {
      const monthIndex = parseInt(exp.fecha.substring(5, 7)) - 1;
      monthlyStats[monthIndex].unmatchedExpense += exp.costo;
    });

    return { monthlyStats, crossMonth, totalMatched: filtered.length };
  }, [reconciledTransactions, selectedYear, unmatchedExpenses]);

  const totalUnmatchedExpense = useMemo(() => unmatchedExpenses.reduce((acc, exp) => acc + exp.costo, 0), [unmatchedExpenses]);

  const allYears = useMemo(() => {
    const years = new Set<string>(reconciledTransactions.map(t => t.fechaIngreso.substring(0, 4)));
    if (years.size === 0) return [new Date().getFullYear().toString()];
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [reconciledTransactions]);

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-xl shadow-lg flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Devengado / Cruce de Mes</h2>
          <p className="text-slate-500">Análisis de ingresos y gastos cruzados por fecha de ingreso</p>
        </div>
        <div className="w-48">
          <label className="block text-xs font-medium text-slate-500 uppercase">Año de Ingreso</label>
          <select 
            value={selectedYear} 
            onChange={e => setSelectedYear(e.target.value)}
            className="mt-1 block w-full border rounded-md p-2 text-sm"
          >
            {allYears.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-lg border-l-4 border-emerald-500">
          <h4 className="text-sm font-medium text-slate-500 uppercase">Total Ingreso Cruzado</h4>
          <p className="text-2xl font-bold text-emerald-600 mt-1">
            {formatCurrency(accrualData.monthlyStats.reduce((acc, m) => acc + m.income, 0))}
          </p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-lg border-l-4 border-rose-500">
          <h4 className="text-sm font-medium text-slate-500 uppercase">Gasto Total</h4>
          <p className="text-2xl font-bold text-rose-600 mt-1">
            {formatCurrency(accrualData.monthlyStats.reduce((acc, m) => acc + (m.expenseMatched + m.unmatchedExpense), 0))}
          </p>
          <p className="text-xs text-slate-400">Cruzado + No Cruzado</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-lg border-l-4 border-amber-500">
          <h4 className="text-sm font-medium text-slate-500 uppercase">Gasto No Cruzado (Fuga)</h4>
          <p className="text-2xl font-bold text-amber-600 mt-1">{formatCurrency(totalUnmatchedExpense)}</p>
          <p className="text-xs text-slate-400">{unmatchedExpenses.length} guías sin ingreso</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-lg border-l-4 border-indigo-500">
          <h4 className="text-sm font-medium text-slate-500 uppercase">Diferido Mes</h4>
          <p className="text-2xl font-bold text-indigo-600 mt-1">{formatNumber(accrualData.crossMonth.length)}</p>
          <p className="text-xs text-slate-400">Ingreso vs Gasto en meses distintos</p>
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-lg h-[400px]">
        <h3 className="text-xl font-bold text-slate-800 mb-4">Ingreso vs Gasto (Cruzado y No Cruzado)</h3>
        <ResponsiveContainer width="100%" height="90%">
          <BarChart data={accrualData.monthlyStats}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" />
            <YAxis tickFormatter={v => formatCurrency(v, true)} />
            <Tooltip formatter={v => formatCurrency(v as number)} />
            <Legend />
            <Bar dataKey="income" name="Ingreso Generado" fill="#10b981" radius={[4, 4, 0, 0]} />
            <Bar dataKey="expenseMatched" name="Gasto Cruzado" fill="#f43f5e" radius={[4, 4, 0, 0]} />
            <Bar dataKey="unmatchedExpense" name="Gasto No Cruzado" fill="#fbbf24" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-lg">
          <h3 className="text-xl font-bold text-slate-800 mb-4">Detalle de Cruce de Mes (Diferidos)</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Guía</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Mes Ingreso</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Mes Gasto</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Costo</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-200">
                {accrualData.crossMonth.length > 0 ? (
                  accrualData.crossMonth.map((t, i) => (
                    <tr key={i} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-slate-900">{t.guia}</td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-slate-600">
                        {new Date(t.fechaIngreso + 'T00:00:00').toLocaleString('es-CO', { month: 'short', year: '2-digit' })}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-slate-600">
                        {t.fechaGasto ? new Date(t.fechaGasto + 'T00:00:00').toLocaleString('es-CO', { month: 'short', year: '2-digit' }) : '-'}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-right text-rose-600 font-semibold">{formatCurrency(t.costoGasto || 0)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-slate-500 italic">No hay diferidos.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-lg">
          <h3 className="text-xl font-bold text-slate-800 mb-4">Gastos No Cruzados (Sin Ingreso)</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Guía</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Fecha</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Costo</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Transportadora</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-200">
                {unmatchedExpenses.length > 0 ? (
                  unmatchedExpenses.slice(0, 50).map((e, i) => (
                    <tr key={i} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-slate-900">{e.guia}</td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-slate-600">{e.fecha}</td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-right text-rose-600 font-semibold">{formatCurrency(e.costo)}</td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-slate-600">{e.carrierName}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-slate-500 italic">Todos los gastos están cruzados.</td>
                  </tr>
                )}
              </tbody>
            </table>
            {unmatchedExpenses.length > 50 && (
              <p className="text-xs text-slate-400 mt-2 italic text-center">Mostrando los primeros 50 de {unmatchedExpenses.length} registros.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AccrualMatchingDashboard;

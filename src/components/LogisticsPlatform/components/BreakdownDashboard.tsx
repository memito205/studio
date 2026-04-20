import React, { useState, useMemo } from 'react';
import type { BreaksReportData, EmployeePerformance, DailyAnalysis, EmployeeDailyAnalysis } from '../types';
import { UtensilsCrossedIcon, ChevronDownIcon, ShieldCheckIcon, AlertTriangleIcon, UserCheckIcon, LineChartIcon, PencilIcon, FileClockIcon } from './icons';
import { ResponsiveContainer, ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';
import ExcessPodium from './ExcessPodium';

const KPI_CARD_STYLES = {
  compliance: { iconBg: 'bg-green-100', iconText: 'text-green-600' },
  exceeded: { iconBg: 'bg-red-100', iconText: 'text-red-600' },
  avgTime: { iconBg: 'bg-blue-100', iconText: 'text-blue-600' },
  employees: { iconBg: 'bg-indigo-100', iconText: 'text-indigo-600' },
  partial: { iconBg: 'bg-yellow-100', iconText: 'text-yellow-600' },
};

const KpiCard: React.FC<{ title: string; value: string; icon: React.ReactNode; type: keyof typeof KPI_CARD_STYLES }> = ({ title, value, icon, type }) => (
    <div className="bg-white rounded-lg shadow p-5 flex items-start">
        <div className={`rounded-full p-3 mr-4 ${KPI_CARD_STYLES[type].iconBg}`}>
            <div className={`h-6 w-6 ${KPI_CARD_STYLES[type].iconText}`}>{icon}</div>
        </div>
        <div>
            <p className="text-sm font-medium text-gray-500 truncate">{title}</p>
            <p className="mt-1 text-3xl font-semibold text-gray-900">{value}</p>
        </div>
    </div>
);

const WeeklyTrendsChart: React.FC<{ trends: BreaksReportData['weeklyTrends'] }> = ({ trends }) => (
    <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-800 flex items-center mb-4">
            <LineChartIcon className="h-6 w-6 mr-3 text-green-600" />
            Tendencias Semanales
        </h3>
        <div style={{ width: '100%', height: 300 }}>
            <ResponsiveContainer>
                <ComposedChart data={trends} margin={{ top: 5, right: 20, left: -10, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="week" tick={{ fontSize: 12 }} />
                    <YAxis yAxisId="left" stroke="#4ade80" label={{ value: 'Tasa (%)', angle: -90, position: 'insideLeft', style: {textAnchor: 'middle', fill: '#888'} }} />
                    <YAxis yAxisId="right" orientation="right" stroke="#60a5fa" label={{ value: 'Minutos', angle: -90, position: 'insideRight', style: {textAnchor: 'middle', fill: '#888'} }} />
                    <Tooltip contentStyle={{ backgroundColor: 'rgba(255, 255, 255, 0.9)', border: '1px solid #ccc', borderRadius: '0.5rem' }} formatter={(value: number, name: string) => [`${value.toFixed(1)}${name.includes('Tasa') ? '%' : ' min'}`, name]}/>
                    <Legend wrapperStyle={{fontSize: "12px"}}/>
                    <Line yAxisId="left" type="monotone" dataKey="complianceRate" name="Tasa Cumplimiento" stroke="#4ade80" strokeWidth={2} dot={{ r: 4 }} />
                    <Line yAxisId="right" type="monotone" dataKey="avgBreakTime" name="Tiempo Prom." stroke="#60a5fa" strokeWidth={2} dot={{ r: 4 }} />
                </ComposedChart>
            </ResponsiveContainer>
        </div>
    </div>
);

const EmployeePerformanceTable: React.FC<{ employees: EmployeePerformance[] }> = ({ employees }) => (
    <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-800 flex items-center mb-4">
            <UserCheckIcon className="h-6 w-6 mr-3 text-green-600" />
            Desempeño por Empleado
        </h3>
        <div className="max-h-80 overflow-y-auto">
            <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50 sticky top-0">
                    <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Empleado</th>
                        <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider" title="Tiempo Promedio de Descanso">T. Prom.</th>
                        <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider" title="Días con Exceso de Tiempo (>60min)">Días Exceso</th>
                        <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider" title="Días con Marcaciones Parciales">Marc. Parciales</th>
                        <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider" title="Días con Descansos Faltantes">Días Faltas</th>
                    </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                    {employees.map(emp => (
                        <tr key={emp.employeeName} className="hover:bg-gray-50">
                            <td className="px-4 py-2 whitespace-nowrap text-sm font-medium text-gray-800">{emp.employeeName}</td>
                            <td className="px-4 py-2 whitespace-nowrap text-sm text-center text-gray-600">{emp.avgTime.toFixed(0)} min</td>
                            <td className={`px-4 py-2 whitespace-nowrap text-sm text-center font-bold ${emp.totalExceededDays > 0 ? 'text-red-500' : 'text-green-600'}`}>{emp.totalExceededDays}</td>
                            <td className={`px-4 py-2 whitespace-nowrap text-sm text-center font-bold ${emp.totalPartialDays > 0 ? 'text-yellow-600' : 'text-green-600'}`}>{emp.totalPartialDays}</td>
                            <td className={`px-4 py-2 whitespace-nowrap text-sm text-center font-bold ${emp.totalMissedDays > 0 ? 'text-orange-600' : 'text-green-600'}`}>{emp.totalMissedDays}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    </div>
);

const DailyBreakdownTable: React.FC<{ analyses: EmployeeDailyAnalysis[] }> = ({ analyses }) => {
    const MEAL_TYPES = ['desayuno', 'almuerzo', 'refrigerio'];
    const INDIVIDUAL_MEAL_EXCESS_THRESHOLD = 75; // Defines a highly unusual duration for a single meal

    const getStatus = (analysis: EmployeeDailyAnalysis) => {
        if (analysis.exceededTotalTime) {
            return { text: 'Exceso', color: 'bg-red-100 text-red-800' };
        }
        if (analysis.missedBreaks.length > 0 || analysis.partialMarkingsCount > 0) {
            return { text: 'Faltas o Parciales', color: 'bg-yellow-100 text-yellow-800' };
        }
        return { text: 'Cumple', color: 'bg-green-100 text-green-800' };
    };

    return (
        <div className="p-4 bg-slate-50/50 overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-100">
                    <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Empleado</th>
                        <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Estado</th>
                        <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Total Diario</th>
                        <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Desayuno</th>
                        <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Almuerzo</th>
                        <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Refrigerio</th>
                        <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Otros</th>
                    </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                    {analyses.map(analysis => {
                        const status = getStatus(analysis);
                        
                        const breaksByMealType = analysis.completedBreaks.reduce((acc, b) => {
                            const mealType = b.mealType.toLowerCase().trim();
                            if (!acc[mealType]) {
                                acc[mealType] = 0;
                            }
                            acc[mealType] += b.duration;
                            return acc;
                        }, {} as Record<string, number>);

                        const knownMealTypesSet = new Set(MEAL_TYPES);
                        const otherBreaksDuration = Object.entries(breaksByMealType)
                            .filter(([mealType]) => !knownMealTypesSet.has(mealType))
                            // FIX: Cast duration to Number to resolve type inference issue.
                            .reduce((sum, [, duration]) => sum + Number(duration), 0);
                        
                        return (
                            <tr key={analysis.employeeName} className="hover:bg-gray-50">
                                <td className="px-3 py-2 whitespace-nowrap text-sm font-medium text-gray-800">{analysis.employeeName}</td>
                                <td className="px-3 py-2 whitespace-nowrap text-sm text-center">
                                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${status.color}`}>
                                        {status.text}
                                    </span>
                                </td>
                                <td className={`px-3 py-2 whitespace-nowrap text-sm text-center font-bold ${analysis.exceededTotalTime ? 'text-red-500' : 'text-green-600'}`}>
                                    {analysis.totalMinutes} min
                                </td>
                                {MEAL_TYPES.map(meal => {
                                    const duration = breaksByMealType[meal];
                                    const isExcessive = typeof duration === 'number' && duration > INDIVIDUAL_MEAL_EXCESS_THRESHOLD;
                                    return (
                                        <td key={meal} className="px-3 py-2 whitespace-nowrap text-sm text-center text-gray-600">
                                            {typeof duration === 'number' ? (
                                                <span className={isExcessive ? 'font-bold text-red-500 p-1 bg-red-50 rounded' : ''}>
                                                    {duration} min
                                                </span>
                                            ) : (
                                                <span className="text-gray-400">-</span>
                                            )}
                                        </td>
                                    );
                                })}
                                <td className="px-3 py-2 whitespace-nowrap text-sm text-center text-gray-600">
                                    {otherBreaksDuration > 0 ? (
                                        <span>{otherBreaksDuration} min</span>
                                    ) : (
                                        <span className="text-gray-400">-</span>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
};


const DailyBreakdownAccordion: React.FC<{ analyses: DailyAnalysis[] }> = ({ analyses }) => {
    const [expandedDates, setExpandedDates] = useState<string[]>([analyses[0]?.date].filter(Boolean));

    const toggleDate = (date: string) => {
        setExpandedDates(prev =>
            prev.includes(date) ? prev.filter(d => d !== date) : [...prev, date]
        );
    };
    
    return (
    <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
        <div className="flex items-center mb-4">
            <UtensilsCrossedIcon className="h-6 w-6 text-green-600 mr-3" />
            <h2 className="text-xl font-bold text-gray-800">Desglose Diario de Descansos</h2>
        </div>
        <div className="space-y-4">
            {analyses.map(day => {
                const isExpanded = expandedDates.includes(day.date);
                return (
                    <div key={day.date} className="border border-gray-200 rounded-lg overflow-hidden">
                        <button onClick={() => toggleDate(day.date)} className="w-full flex justify-between items-center p-4 bg-gray-50 hover:bg-gray-100 focus:outline-none" aria-expanded={isExpanded}>
                            <div className="font-semibold text-gray-800 text-left">
                                {day.date}
                                <div className="text-xs font-normal text-gray-500 flex flex-wrap gap-x-4 gap-y-1 mt-1">
                                    <span>{day.stats.totalEmployees} Empleados</span>
                                    <span className={day.stats.employeesExceedingTime > 0 ? 'text-red-600 font-medium' : ''}>Excesos: {day.stats.employeesExceedingTime}</span>
                                    <span className={day.stats.employeesWithPartialRegs > 0 ? 'text-yellow-600 font-medium' : ''}>Parciales: {day.stats.employeesWithPartialRegs}</span>
                                    <span className={day.stats.employeesWithMissedBreaks > 0 ? 'text-orange-600 font-medium' : ''}>Con Faltas: {day.stats.employeesWithMissedBreaks}</span>
                                </div>
                            </div>
                            <ChevronDownIcon className={`h-6 w-6 text-gray-600 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
                        </button>
                        {isExpanded && <DailyBreakdownTable analyses={day.employeesAnalysis} />}
                    </div>
                );
            })}
        </div>
    </div>
    );
};


const BreakdownDashboard: React.FC<{ data: BreaksReportData }> = ({ data }) => {
    if (!data) return null;
    const { kpis, weeklyTrends, employeePerformances, dailyAnalyses } = data;

    return (
        <div className="space-y-8">
             <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6">
                <KpiCard title="Cumplimiento (3 descansos)" value={`${kpis.complianceRate.toFixed(1)}%`} icon={<ShieldCheckIcon />} type="compliance" />
                <KpiCard title="Tasa de Excesos (>60min)" value={`${kpis.exceededRate.toFixed(1)}%`} icon={<AlertTriangleIcon />} type="exceeded" />
                <KpiCard title="Tasa de Marc. Parciales" value={`${kpis.partialMarkingRate.toFixed(1)}%`} icon={<FileClockIcon />} type="partial" />
                <KpiCard title="Tiempo Prom. Descanso" value={`${kpis.avgBreakTime.toFixed(0)} min`} icon={<UtensilsCrossedIcon />} type="avgTime" />
                <KpiCard title="Empleados Analizados" value={String(kpis.totalEmployeesWithBreaks)} icon={<UserCheckIcon />} type="employees" />
            </div>

            <ExcessPodium employees={employeePerformances} />

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 items-start">
                <WeeklyTrendsChart trends={weeklyTrends} />
                <EmployeePerformanceTable employees={employeePerformances} />
            </div>

            <DailyBreakdownAccordion analyses={dailyAnalyses} />
        </div>
    );
};

export default BreakdownDashboard;

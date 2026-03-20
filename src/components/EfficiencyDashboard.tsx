/** @jsxImportSource react */
"use client";

import React, { useState, useMemo, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList } from 'recharts';
import { format, isSameDay, startOfDay, endOfDay, startOfWeek, endOfWeek } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { StatCard } from '@/components/StatCard';
import { ShieldCheck, Timer, TimerOff, BarChart2 } from 'lucide-react';
import type { EcommerceOrder, DelayedOrderLog, DateRange } from '@/types';
import { calculateSlaHours } from '@/lib/parsingUtils';

const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-background p-2 border rounded-md shadow-lg">
          <p className="label font-bold">{`${label}`}</p>
          {payload.map((entry: any, index: number) => (
             <p key={`item-${index}`} style={{ color: entry.color }}>
                {`${entry.name}: ${entry.value.toFixed(1)}%`}
             </p>
          ))}
        </div>
      );
    }
    return null;
  };

interface EfficiencyDashboardProps {
    orders: EcommerceOrder[];
    logs: DelayedOrderLog[];
    holidays: Date[];
    // We will add filters here in the next steps
}

export const EfficiencyDashboard: React.FC<EfficiencyDashboardProps> = ({ orders, logs, holidays }) => {
    
    // We will get dateRange and storeFilter from props later. For now, it will show all data.
    const dateFilteredData = orders; 
    const logMap = useMemo(() => new Map(logs.map(log => [log.orderId, log])), [logs]);

    const wasDispatchedLate = useCallback((order: EcommerceOrder): boolean => {
        if (!order.dispatchDate || !order.fechaPedido) return false;
        
        const orderDate = new Date(order.fechaPedido);
        const dispatchDate = new Date(order.dispatchDate);

        const storeTimeLimits: { [key: string]: number } = { 'ADDI': 48, 'DAF': 48, 'FALABELLA': 48, 'MLB': 48, };
        const defaultTimeLimit = 48;
        const tienda = order.tienda?.trim().toUpperCase() ?? '';
        const tiendaKey = Object.keys(storeTimeLimits).find(key => tienda.includes(key));
        const limitHours = tiendaKey ? storeTimeLimits[tiendaKey] : defaultTimeLimit;
        
        const timeDiffHours = calculateSlaHours(orderDate, dispatchDate, holidays);
        
        return timeDiffHours > limitHours;

    }, [holidays]);

    const historicalOnTimeRate = useMemo(() => {
        const allDispatchedOrders = dateFilteredData.filter(o => o.dispatchDate && (o.tienda?.toUpperCase().trim() ?? '') !== 'UNOE');
        if (allDispatchedOrders.length === 0) return 100;
        const onTimeDispatchedOrders = allDispatchedOrders.filter(o => !wasDispatchedLate(o));
        return (onTimeDispatchedOrders.length / allDispatchedOrders.length) * 100;
    }, [dateFilteredData, wasDispatchedLate]);

    const overallAverageDispatchDays = useMemo(() => {
        const dispatchedOrders = dateFilteredData.filter(o => o.dispatchDate && o.fechaPedido);
        if (dispatchedOrders.length === 0) return 0;

        const totalDays = dispatchedOrders.reduce((sum, order) => {
            const days = calculateSlaHours(new Date(order.fechaPedido!), new Date(order.dispatchDate!), holidays) / 24;
            return sum + days;
        }, 0);

        return totalDays / dispatchedOrders.length;
    }, [dateFilteredData, holidays]);
    
    const isCurrentlyDelayed = useCallback((order: EcommerceOrder, referenceDate: Date): boolean => {
        const excludedStates = ['en transporte externo', 'en tienda', 'entregado', 'cancelado', 'pendiente pago', 'pendiente cancelar'];
        const estado = (order.estado || '').trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, ' ');
        if (excludedStates.includes(estado) || order.dispatchDate) return false;
        if (!order.fechaPedido) return false;

        const orderDate = new Date(order.fechaPedido);
        const storeTimeLimits: { [key: string]: number } = { 'ADDI': 48, 'DAF': 48, 'FALABELLA': 48, 'MLB': 48, };
        const defaultTimeLimit = 48;
        const tienda = order.tienda?.trim().toUpperCase() ?? '';
        const tiendaKey = Object.keys(storeTimeLimits).find(key => tienda.includes(key));
        const limitHours = tiendaKey ? storeTimeLimits[tiendaKey] : defaultTimeLimit;
        const timeDiffHours = calculateSlaHours(orderDate, referenceDate, holidays);
        return timeDiffHours > limitHours;
    }, [holidays]);
    
    const avgTimeToResolveByStore = useMemo(() => {
        const atRiskOrders = dateFilteredData.filter(order => isCurrentlyDelayed(order, new Date()) || wasDispatchedLate(order));
        
        const storeStats = new Map<string, { totalDays: number; count: number; withCrm: number }>();

        atRiskOrders.forEach(order => {
            if (!order.fechaPedido || !order.tienda) return;
            const log = logMap.get(order.id);
            const crmJustification = log?.justifications?.slice().reverse().find(j => j.bitrixTaskCreationDate);
            let resolutionDate: Date | undefined;
            let hasCrm = false;

            if (crmJustification?.bitrixTaskCreationDate) {
                resolutionDate = new Date(crmJustification.bitrixTaskCreationDate);
                hasCrm = true;
            } else if (order.dispatchDate) {
                resolutionDate = new Date(order.dispatchDate);
            }

            if (resolutionDate) {
                const startDate = new Date(order.fechaPedido);
                if (!isNaN(startDate.getTime()) && resolutionDate > startDate) {
                    const store = order.tienda;
                    const stats = storeStats.get(store) || { totalDays: 0, count: 0, withCrm: 0 };
                    stats.totalDays += calculateSlaHours(startDate, resolutionDate, holidays) / 24;
                    stats.count++;
                    if (hasCrm) stats.withCrm++;
                    storeStats.set(store, stats);
                }
            }
        });

        return Array.from(storeStats.entries()).map(([storeName, stats]) => ({
            name: storeName,
            averageDays: stats.count > 0 ? stats.totalDays / stats.count : 0,
            count: stats.count,
            withCrmPercentage: stats.count > 0 ? (stats.withCrm / stats.count) * 100 : 0,
        })).sort((a,b) => b.averageDays - a.averageDays);
    }, [dateFilteredData, logMap, holidays, isCurrentlyDelayed, wasDispatchedLate]);
    
     const overallAvgTimeToResolve = useMemo(() => {
        if (!avgTimeToResolveByStore || avgTimeToResolveByStore.length === 0) return 0;
        const totalDays = avgTimeToResolveByStore.reduce((sum, s) => sum + (s.averageDays * s.count), 0);
        const totalCount = avgTimeToResolveByStore.reduce((sum, s) => sum + s.count, 0);
        return totalCount > 0 ? totalDays / totalCount : 0;
    }, [avgTimeToResolveByStore]);
    
    const avgBitrixToDispatchDays = useMemo(() => {
        const ordersWithBitrixAndDispatch = dateFilteredData.filter(order => {
            const log = logMap.get(order.id);
            const bitrixDate = log?.justifications?.find(j => j.bitrixTaskCreationDate)?.bitrixTaskCreationDate;
            return bitrixDate && order.dispatchDate;
        });

        if (ordersWithBitrixAndDispatch.length === 0) return 0;

        const totalDays = ordersWithBitrixAndDispatch.reduce((sum, order) => {
            const log = logMap.get(order.id)!;
            const bitrixDate = new Date(log.justifications.find(j => j.bitrixTaskCreationDate)!.bitrixTaskCreationDate!);
            const dispatchDate = new Date(order.dispatchDate!);
            const hours = calculateSlaHours(bitrixDate, dispatchDate, holidays);
            return sum + (hours / 24);
        }, 0);

        return totalDays / ordersWithBitrixAndDispatch.length;
    }, [dateFilteredData, logMap, holidays]);
    
    const dispatchTimeRangesByWeek = useMemo(() => {
        const dispatchedOrders = dateFilteredData.filter(o => o.dispatchDate && o.fechaPedido);
        const weekStats = new Map<string, { startDate: Date; endDate: Date; '0-1 Días': number; '1-2 Días': number; '2-3 Días': number; '>3 Días': number; total: number; totalDispatchDays: number; }>();
        dispatchedOrders.forEach(order => {
            const dispatchDate = new Date(order.dispatchDate!);
            const weekStart = startOfWeek(dispatchDate, { weekStartsOn: 1 });
            const weekEnd = endOfWeek(dispatchDate, { weekStartsOn: 1 });
            const weekKey = format(weekStart, 'yyyy-MM-dd');
            if (!weekStats.has(weekKey)) weekStats.set(weekKey, { startDate: weekStart, endDate: weekEnd, '0-1 Días': 0, '1-2 Días': 0, '2-3 Días': 0, '>3 Días': 0, total: 0, totalDispatchDays: 0, });
            const weekData = weekStats.get(weekKey)!;
            weekData.total++;
            const days = calculateSlaHours(new Date(order.fechaPedido!), dispatchDate, holidays) / 24;
            weekData.totalDispatchDays += days;
            if (days <= 1) weekData['0-1 Días']++; else if (days <= 2) weekData['1-2 Días']++; else if (days <= 3) weekData['2-3 Días']++; else weekData['>3 Días']++;
        });
        return Array.from(weekStats.entries()).map(([weekKey, stats]) => {
            const total = stats.total;
            return {
                weekKey,
                weekLabel: `Semana del ${format(stats.startDate, 'dd MMM', { locale: es })} al ${format(stats.endDate, 'dd MMM yyyy', { locale: es })}`,
                ...stats,
                averageDispatchDays: total > 0 ? stats.totalDispatchDays / total : 0,
                '0-1 Días %': total > 0 ? (stats['0-1 Días'] / total) * 100 : 0,
                '1-2 Días %': total > 0 ? (stats['1-2 Días'] / total) * 100 : 0,
                '2-3 Días %': total > 0 ? (stats['2-3 Días'] / total) * 100 : 0,
                '>3 Días %': total > 0 ? (stats['>3 Días'] / total) * 100 : 0,
            };
        }).sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
    }, [dateFilteredData, holidays]);
    
    const dispatchTimeRangesByStore = useMemo(() => {
        const dispatchedOrders = dateFilteredData.filter(o => o.dispatchDate && o.fechaPedido);
        const storeRanges = new Map<string, { '0-1 Días': number; '1-2 Días': number; '2-3 Días': number; '>3 Días': number; total: number; totalDispatchDays: number; }>();
        dispatchedOrders.forEach(order => {
            const store = order.tienda || 'Sin Tienda';
            if (!storeRanges.has(store)) storeRanges.set(store, { '0-1 Días': 0, '1-2 Días': 0, '2-3 Días': 0, '>3 Días': 0, total: 0, totalDispatchDays: 0 });
            const storeData = storeRanges.get(store)!;
            storeData.total++;
            const days = calculateSlaHours(new Date(order.fechaPedido!), new Date(order.dispatchDate!), holidays) / 24;
            storeData.totalDispatchDays += days;
            if (days <= 1) storeData['0-1 Días']++; else if (days <= 2) storeData['1-2 Días']++; else if (days <= 3) storeData['2-3 Días']++; else storeData['>3 Días']++;
        });
        return Array.from(storeRanges.entries()).map(([store, ranges]) => ({
            store, ...ranges,
            averageDispatchDays: ranges.total > 0 ? ranges.totalDispatchDays / ranges.total : 0,
            '0-1 Días %': ranges.total > 0 ? (ranges['0-1 Días'] / ranges.total) * 100 : 0,
            '1-2 Días %': ranges.total > 0 ? (ranges['1-2 Días'] / ranges.total) * 100 : 0,
            '2-3 Días %': ranges.total > 0 ? (ranges['2-3 Días'] / ranges.total) * 100 : 0,
            '>3 Días %': ranges.total > 0 ? (ranges['>3 Días'] / ranges.total) * 100 : 0,
        })).sort((a,b) => b.total - a.total);
    }, [dateFilteredData, holidays]);
    
    const effectivenessByDay = useMemo(() => {
        const dayStats = new Map<string, { total: number, onTime: number }>();
        dateFilteredData.forEach(order => {
            if (order.dispatchDate) {
                const dayKey = format(new Date(order.dispatchDate), 'yyyy-MM-dd');
                const stats = dayStats.get(dayKey) || { total: 0, onTime: 0 };
                stats.total++;
                if (!wasDispatchedLate(order)) stats.onTime++;
                dayStats.set(dayKey, stats);
            }
        });
        return Array.from(dayStats.entries()).map(([day, stats]) => ({
            name: format(new Date(day + 'T00:00:00'), 'dd/MMM', { locale: es }),
            date: day,
            Efectividad: stats.total > 0 ? (stats.onTime / stats.total) * 100 : 0,
        })).sort((a, b) => a.date.localeCompare(b.date));
    }, [dateFilteredData, wasDispatchedLate]);
    
     const effectivenessByMonth = useMemo(() => {
        const monthStats = new Map<string, { total: number, onTime: number }>();
        dateFilteredData.forEach(order => {
            if(order.dispatchDate) {
                const monthKey = format(new Date(order.dispatchDate), 'yyyy-MM');
                const stats = monthStats.get(monthKey) || { total: 0, onTime: 0 };
                stats.total++;
                if (!wasDispatchedLate(order)) stats.onTime++;
                monthStats.set(monthKey, stats);
            }
        });
        return Array.from(monthStats.entries()).map(([month, stats]) => ({
            name: format(new Date(month + '-02'), 'MMM yyyy', { locale: es }),
            date: month,
            "Efectividad Mensual": stats.total > 0 ? (stats.onTime / stats.total) * 100 : 0,
        })).sort((a,b) => a.date.localeCompare(b.date));
    }, [dateFilteredData, wasDispatchedLate]);
    
    const storeDispatchPerformance = useMemo(() => {
        let dispatchedOrders = dateFilteredData.filter(o => o.dispatchDate && (o.tienda?.toUpperCase().trim() ?? '') !== 'UNOE');
        const storeMap = new Map<string, { totalDispatched: number; onTime: number }>();
        dispatchedOrders.forEach(order => {
            const store = order.tienda || 'Sin Tienda';
            const entry = storeMap.get(store) || { totalDispatched: 0, onTime: 0 };
            entry.totalDispatched++;
            if (!wasDispatchedLate(order)) entry.onTime++;
            storeMap.set(store, entry);
        });
        return Array.from(storeMap.entries()).map(([tienda, data]) => ({
            tienda, ...data,
            efficiency: data.totalDispatched > 0 ? (data.onTime / data.totalDispatched) * 100 : 100,
        })).sort((a, b) => b.totalDispatched - a.totalDispatched);
    }, [dateFilteredData, wasDispatchedLate]);

    const getComplianceColor = (compliance: number): string => {
        if (compliance >= 95) return 'text-green-500';
        if (compliance >= 85) return 'text-amber-500';
        return 'text-red-500';
    };

    return (
        <div className="space-y-8">
            <div className="pdf-section-efficiency-stats grid grid-cols-1 md:grid-cols-4 gap-8">
                <StatCard
                    title="Eficiencia Histórica de Despacho"
                    description="De todos los despachos en el rango, % que salió a tiempo (lógica estricta por hora)."
                    value={`${historicalOnTimeRate.toFixed(1)}%`}
                    icon={<ShieldCheck />}
                    color={getComplianceColor(historicalOnTimeRate)}
                    subtitle="Basado en el SLA estricto por hora"
                />
                 <StatCard 
                    title="Promedio Días Despacho" 
                    value={`${overallAverageDispatchDays.toFixed(1)} días`} 
                    icon={<Timer />}
                    subtitle="Tiempo hábil desde pedido a despacho (general)."
                />
                 <StatCard 
                    title="Tiempo Prom. de Resolución" 
                    value={`${overallAvgTimeToResolve.toFixed(1)} días`} 
                    icon={<TimerOff />}
                    subtitle="Promedio para resolver pedidos con atraso."
                />
                <StatCard
                    title="Tiempo Prom. Gestión (Bitrix)"
                    value={`${avgBitrixToDispatchDays.toFixed(1)} días`}
                    icon={<BarChart2 />}
                    subtitle="Tiempo hábil desde tarea en CRM a despacho."
                />
            </div>
             <div className="pdf-section-time-to-resolve">
                <Card>
                    <CardHeader>
                        <CardTitle>Tiempo Promedio de Resolución por Tienda</CardTitle>
                        <CardDescription>Días hábiles promedio que tardan los pedidos con atraso en resolverse (sea por tarea en CRM o por despacho).</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader><TableRow><TableHead>Tienda</TableHead><TableHead className="text-right">Pedidos Medidos</TableHead><TableHead className="text-right">% con Tarea CRM</TableHead><TableHead className="text-right">Tiempo Promedio (días)</TableHead></TableRow></TableHeader>
                            <TableBody>
                                {avgTimeToResolveByStore.length > 0 ? (
                                    avgTimeToResolveByStore.map(store => (
                                        <TableRow key={store.name}><TableCell>{store.name}</TableCell><TableCell className="text-right">{store.count}</TableCell><TableCell className="text-right">{store.withCrmPercentage.toFixed(1)}%</TableCell><TableCell className="text-right font-semibold">{store.averageDays.toFixed(1)}</TableCell></TableRow>
                                    ))
                                ) : ( <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground h-24">No hay datos de resolución para el período seleccionado.</TableCell></TableRow> )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>
            <div className="pdf-section-dispatch-ranges-by-week">
                <Card>
                    <CardHeader>
                        <CardTitle>Resumen Semanal de Tiempos de Despacho</CardTitle>
                        <CardDescription>
                            Evolución semanal de la velocidad de despacho para el período seleccionado.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Semana</TableHead>
                                    <TableHead className="text-right">Total Despachos</TableHead>
                                    <TableHead className="text-right">Promedio Días</TableHead>
                                    <TableHead className="text-right">0-1 Días</TableHead>
                                    <TableHead className="text-right">1-2 Días</TableHead>
                                    <TableHead className="text-right">2-3 Días</TableHead>
                                    <TableHead className="text-right">&gt;3 Días</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {dispatchTimeRangesByWeek.map(row => (
                                    <TableRow key={row.weekKey}>
                                        <TableCell className="font-medium">{row.weekLabel}</TableCell>
                                        <TableCell className="text-right font-bold">{row.total.toLocaleString()}</TableCell>
                                        <TableCell className="text-right font-bold">{row.averageDispatchDays.toFixed(1)}</TableCell>
                                        <TableCell className="text-right">{row['0-1 Días'].toLocaleString()} <span className="text-xs text-muted-foreground">({row['0-1 Días %'].toFixed(1)}%)</span></TableCell>
                                        <TableCell className="text-right">{row['1-2 Días'].toLocaleString()} <span className="text-xs text-muted-foreground">({row['1-2 Días %'].toFixed(1)}%)</span></TableCell>
                                        <TableCell className="text-right">{row['2-3 Días'].toLocaleString()} <span className="text-xs text-muted-foreground">({row['2-3 Días %'].toFixed(1)}%)</span></TableCell>
                                        <TableCell className="text-right">{row['>3 Días'].toLocaleString()} <span className="text-xs text-muted-foreground">({row['>3 Días %'].toFixed(1)}%)</span></TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>
             <div className="pdf-section-efficiency-charts grid grid-cols-1 gap-8">
              <Card>
                  <CardHeader><CardTitle>Eficiencia de Despacho por Día</CardTitle><CardDescription>Porcentaje de despachos puntuales basado en el día en que se realizó el envío.</CardDescription></CardHeader>
                  <CardContent className="h-[350px]">
                      <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={effectivenessByDay}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis domain={[0, 100]} unit="%" /><Tooltip content={<CustomTooltip />} /><Legend /><Line type="monotone" dataKey="Efectividad" stroke="hsl(var(--chart-1))" strokeWidth={2} ><LabelList dataKey="Efectividad" position="top" formatter={(value: number) => `${value.toFixed(0)}%`} style={{ fontSize: '10px' }} /></Line></LineChart>
                      </ResponsiveContainer>
                  </CardContent>
              </Card>
              <Card>
                  <CardHeader><CardTitle>Eficiencia de Despacho por Mes</CardTitle><CardDescription>Porcentaje de despachos puntuales por mes.</CardDescription></CardHeader>
                  <CardContent className="h-[350px]">
                      <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={effectivenessByMonth}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis domain={[0, 100]} unit="%" /><Tooltip content={<CustomTooltip />} /><Legend /><Line type="monotone" dataKey="Efectividad Mensual" stroke="hsl(var(--chart-2))" strokeWidth={2} ><LabelList dataKey="Efectividad Mensual" position="top" formatter={(value: number) => `${value.toFixed(0)}%`} style={{ fontSize: '10px' }} /></Line></LineChart>
                      </ResponsiveContainer>
                  </CardContent>
              </Card>
            </div>
            <div className="pdf-section-dispatch-ranges">
                <Card>
                    <CardHeader><CardTitle>Rangos de Tiempo de Despacho por Tienda</CardTitle><CardDescription>Distribución de los despachos por tienda según el tiempo hábil que tardaron desde el pedido.</CardDescription></CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader><TableRow><TableHead>Tienda</TableHead><TableHead className="text-right">Total Despachos</TableHead><TableHead className="text-right">Promedio Días Despacho</TableHead><TableHead className="text-right">0-1 Días</TableHead><TableHead className="text-right">1-2 Días</TableHead><TableHead className="text-right">2-3 Días</TableHead><TableHead className="text-right">&gt;3 Días</TableHead></TableRow></TableHeader>
                            <TableBody>
                                {dispatchTimeRangesByStore.map(row => (
                                    <TableRow key={row.store}><TableCell className="font-medium">{row.store}</TableCell><TableCell className="text-right font-bold">{row.total.toLocaleString()}</TableCell><TableCell className="text-right font-bold">{row.averageDispatchDays.toFixed(1)}</TableCell><TableCell className="text-right">{row['0-1 Días'].toLocaleString()} <span className="text-xs text-muted-foreground">({row['0-1 Días %'].toFixed(1)}%)</span></TableCell><TableCell className="text-right">{row['1-2 Días'].toLocaleString()} <span className="text-xs text-muted-foreground">({row['1-2 Días %'].toFixed(1)}%)</span></TableCell><TableCell className="text-right">{row['2-3 Días'].toLocaleString()} <span className="text-xs text-muted-foreground">({row['2-3 Días %'].toFixed(1)}%)</span></TableCell><TableCell className="text-right">{row['>3 Días'].toLocaleString()} <span className="text-xs text-muted-foreground">({row['>3 Días %'].toFixed(1)}%)</span></TableCell></TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>
              <div className="pdf-section-store-dispatch-efficiency">
                <Card>
                    <CardHeader><CardTitle>Eficiencia Histórica de Despacho por Tienda</CardTitle><CardDescription>Analiza únicamente los pedidos despachados para calcular el % que salió a tiempo (lógica estricta por hora).</CardDescription></CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader><TableRow><TableHead>Tienda</TableHead><TableHead className="text-right">Total Despachado</TableHead><TableHead className="text-right">A Tiempo</TableHead><TableHead className="text-right">Eficiencia</TableHead></TableRow></TableHeader>
                            <TableBody>
                                {storeDispatchPerformance.map(store => (<TableRow key={store.tienda}><TableCell>{store.tienda}</TableCell><TableCell className="text-right">{store.totalDispatched}</TableCell><TableCell className="text-right text-green-600 font-semibold">{store.onTime}</TableCell><TableCell className={cn("text-right font-bold text-lg", getComplianceColor(store.efficiency))}>{store.efficiency.toFixed(1)}%</TableCell></TableRow>))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
              </div>
        </div>
    );
};

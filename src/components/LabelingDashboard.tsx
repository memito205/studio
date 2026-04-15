/** @jsxImportSource react */
"use client";

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell, PieChart, Pie, LineChart, Line } from 'recharts';
import { format, startOfDay, endOfDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { StatCard } from '@/components/StatCard';
import { Loader2, ArrowLeft, Calendar as CalendarIcon, FileDown, Users, Target, Timer, Zap } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import type { LabelingDashboardData, LabelingEmployeePerformance } from '@/types';
import { getLabelingDashboardData } from '@/app/reception/actions'; // I named it getLabelingHistoricalData in actions.ts, wait
import { getLabelingHistoricalData } from '@/app/reception/actions'; // Correcting name
import { useToast } from '@/hooks/use-toast';

interface LabelingDashboardProps {
    onReturn: () => void;
}

const COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff8042', '#0088fe', '#00c49f', '#ffbb28'];

export const LabelingDashboard: React.FC<LabelingDashboardProps> = ({ onReturn }) => {
    const { toast } = useToast();
    const [dateRange, setDateRange] = useState<{ from: Date; to?: Date | null }>({ from: new Date() });
    const [data, setData] = useState<LabelingDashboardData | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        const result = await getLabelingHistoricalData(dateRange);
        if (result.success && result.data) {
            setData(result.data);
        } else {
            toast({ variant: 'destructive', title: 'Error', description: result.error || 'No se pudieron cargar los datos del dashboard.' });
        }
        setIsLoading(false);
    }, [dateRange, toast]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const getEfficiencyColor = (efficiency: number) => {
        if (efficiency >= 100) return 'text-green-500';
        if (efficiency >= 80) return 'text-amber-500';
        return 'text-red-500';
    };

    if (isLoading && !data) {
        return (
            <div className="flex flex-col items-center justify-center h-96 gap-4">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                <p className="text-muted-foreground animate-pulse">Cargando analíticas de etiquetado...</p>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Header & Filters */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-card p-6 rounded-xl border shadow-sm">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Análisis de Etiquetado</h2>
                    <p className="text-muted-foreground">Productividad y eficiencia de operarios internos y externos.</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button variant="outline" className="w-[280px] justify-start text-left font-normal border-primary/20 hover:border-primary">
                                <CalendarIcon className="mr-2 h-4 w-4 text-primary" />
                                {dateRange.from ? (
                                    dateRange.to ? (
                                        <>
                                            {format(dateRange.from, "LLL dd, y", { locale: es })} -{" "}
                                            {format(dateRange.to, "LLL dd, y", { locale: es })}
                                        </>
                                    ) : (
                                        format(dateRange.from, "LLL dd, y", { locale: es })
                                    )
                                ) : (
                                    <span>Seleccionar fecha</span>
                                )}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="end">
                            <Calendar
                                initialFocus
                                mode="range"
                                defaultMonth={dateRange.from}
                                selected={{ from: dateRange.from, to: dateRange.to || undefined }}
                                onSelect={(range) => setDateRange({ from: range?.from || new Date(), to: range?.to })}
                                numberOfMonths={2}
                                locale={es}
                            />
                        </PopoverContent>
                    </Popover>
                    <Button onClick={onReturn} variant="ghost" className="hover:bg-accent">
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Volver
                    </Button>
                </div>
            </div>

            {data && (
                <>
                    {/* Summary Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        <StatCard 
                            title="Producción Total" 
                            value={data.summary.totalUnits.toLocaleString()} 
                            icon={<Zap className="text-amber-500" />} 
                            subtitle="Unidades terminadas"
                        />
                        <StatCard 
                            title="Eficiencia Global" 
                            value={`${data.summary.efficiency.toFixed(1)} u/h`} 
                            icon={<Target className="text-primary" />} 
                            color={getEfficiencyColor(data.summary.efficiency)}
                            subtitle="Promedio por hora activa"
                        />
                        <StatCard 
                            title="Personal Mixto" 
                            value={`${((data.summary.externalUnits / data.summary.totalUnits) * 100 || 0).toFixed(0)}%`} 
                            icon={<Users className="text-blue-500" />} 
                            subtitle="Cuota de producción externa"
                        />
                        <StatCard 
                            title="Tiempo Productivo" 
                            value={`${(data.summary.totalActiveMinutes / 60).toFixed(1)}h`} 
                            icon={<Timer className="text-green-500" />} 
                            subtitle="Horas hombre registradas"
                        />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        {/* Hourly Chart */}
                        <Card className="shadow-sm">
                            <CardHeader>
                                <CardTitle className="text-lg font-bold">Producción por Horas</CardTitle>
                                <CardDescription>Distribución horaria de unidades finalizadas.</CardDescription>
                            </CardHeader>
                            <CardContent className="h-[350px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={data.hourlyData}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                                        <XAxis dataKey="hour" fontSize={12} tickLine={false} axisLine={false} />
                                        <YAxis fontSize={12} tickLine={false} axisLine={false} />
                                        <Tooltip 
                                            cursor={{ fill: 'hsl(var(--primary)/.1)' }}
                                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                                        />
                                        <Bar dataKey="units" name="Unidades" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} barSize={24} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>

                        {/* Downtime Reasons */}
                        <Card className="shadow-sm">
                            <CardHeader>
                                <CardTitle className="text-lg font-bold">Motivos de Pausas</CardTitle>
                                <CardDescription>Análisis de incidencias y tiempos muertos.</CardDescription>
                            </CardHeader>
                            <CardContent className="h-[350px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={data.pauseReasons}
                                            dataKey="totalMinutes"
                                            nameKey="reason"
                                            cx="50%"
                                            cy="50%"
                                            outerRadius={100}
                                            innerRadius={60}
                                            paddingAngle={5}
                                            label={({ reason, percent }) => `${reason} (${(percent * 100).toFixed(0)}%)`}
                                        >
                                            {data.pauseReasons.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip 
                                            formatter={(value: number) => [`${value.toFixed(1)} min`, 'Tiempo Total']}
                                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                                        />
                                        <Legend verticalAlign="bottom" height={36}/>
                                    </PieChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Employee Performance Table */}
                    <Card className="shadow-sm overflow-hidden">
                        <CardHeader className="bg-muted/30">
                            <CardTitle>Rendimiento por Operario</CardTitle>
                            <CardDescription>Detalle individual de productividad y tiempos.</CardDescription>
                        </CardHeader>
                        <CardContent className="p-0">
                            <Table>
                                <TableHeader>
                                    <TableRow className="hover:bg-transparent">
                                        <TableHead className="pl-6">Nombre / Operario</TableHead>
                                        <TableHead>Tipo</TableHead>
                                        <TableHead className="text-right">Unidades</TableHead>
                                        <TableHead className="text-right">Horas Activas</TableHead>
                                        <TableHead className="text-right">Eficiencia (u/h)</TableHead>
                                        <TableHead className="text-right pr-6">Pausas</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {data.employeePerformance.map((emp) => (
                                        <TableRow key={emp.id} className="group transition-colors">
                                            <TableCell className="pl-6 font-medium">{emp.name}</TableCell>
                                            <TableCell>
                                                <span className={cn(
                                                    "px-2 py-1 rounded-full text-xs font-semibold",
                                                    emp.type === 'Interno' ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" : "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400"
                                                )}>
                                                    {emp.type}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-right font-bold">{emp.totalUnits.toLocaleString()}</TableCell>
                                            <TableCell className="text-right">{(emp.activeMinutes / 60).toFixed(2)}h</TableCell>
                                            <TableCell className={cn("text-right font-bold", getEfficiencyColor(emp.efficiency))}>
                                                {emp.efficiency.toFixed(1)}
                                            </TableCell>
                                            <TableCell className="text-right pr-6 text-muted-foreground">{emp.pausesCount}</TableCell>
                                        </TableRow>
                                    ))}
                                    {data.employeePerformance.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={6} className="text-center h-24 text-muted-foreground">
                                                No hay actividad registrada en este período.
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </>
            )}
        </div>
    );
};
